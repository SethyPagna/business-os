import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth } from '../lib/auth'
import { hasPermission } from '../lib/permissions'
import { getDb } from '../lib/db'
import { audit } from '../lib/audit'
import { runDataIntegrityCheck } from '../lib/dataIntegrity'
import { listObjects, deleteObject } from '../lib/r2'
import { sanitizeMediaList } from '../lib/media'
import { ensureCoreDataInvariants, dropAllCustomTables, FACTORY_RESET_TABLES, PRODUCTS_RESET_TABLES } from '../lib/coreDataInvariants'
import { createCloudflareBackup, createSectionBackup } from '../lib/backup'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { reportError } from '../lib/errorReporting'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'

const app = new Hono<{ Bindings: Env; Variables: { user: any } }>()

app.use('*', requireAuth)

// Browser-side crash reporting. The frontend does NOT hold the Sentry DSN
// and does not talk to Sentry directly: the DSN stays out of the browser
// bundle, and PII scrubbing happens in exactly one place (lib/errorReporting)
// rather than being implemented twice and drifting apart.
//
// Behind requireAuth like the rest of this router, which also means it is
// not an open relay for anyone to push events into the project's quota.
// Rate-limited per user on top of that, because a crash loop in one browser
// tab could otherwise burn the whole Sentry allowance in a minute.
app.post('/client-error', async (c) => {
  const user = c.get('user')
  const clientKey = String(user?.id || getClientIp(c.req.raw))
  const limit = await checkRateLimit(c.env, 'client_error', clientKey, 20, 60_000)
  // Deliberately 200, not 429: this endpoint reports a crash that ALREADY
  // happened. Handing the browser an error here would mean the error
  // handler itself now has an error to handle.
  if (!limit.allowed) return c.json({ success: true, reported: false, reason: 'rate_limited' })

  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const message = String(body?.message || '').slice(0, 1000)
  if (!message) return c.json({ success: true, reported: false, reason: 'empty' })

  const error = new Error(message)
  if (body?.stack) error.stack = String(body.stack).slice(0, 4000)
  const reported = await reportError(c.env.SENTRY_DSN, error, {
    source: 'browser',
    // A page id, never a URL -- a URL carries the query string, which is
    // where search terms and membership lookups live.
    location: String(body?.page || '').slice(0, 120) || null,
    release: null,
    role: user?.role_code || null,
  })
  return c.json({ success: true, reported })
})

function denyUnlessBackupPermission(c: any) {
  const user = c.get('user')
  if (!hasPermission(user, 'backup')) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return null
}

// Simple fixed-window rate limit backed by the CACHE KV namespace. Mirrors
// the intent of backend's applyRouteRateLimit (5 resets / 10 min) -- not a
// byte-for-byte port, KV doesn't give us that, but it stops the same
// accidental-double-click / scripted-retry problem.
async function rateLimited(c: any, name: string, max: number, windowSeconds: number): Promise<boolean> {
  const user = c.get('user')
  const key = `ratelimit:${name}:${user?.id ?? 'anon'}`
  const raw = await c.env.CACHE.get(key)
  const count = raw ? Number(raw) || 0 : 0
  if (count >= max) return true
  await c.env.CACHE.put(key, String(count + 1), { expirationTtl: windowSeconds })
  return false
}

// ---------------------------------------------------------------------------
// Reset business data.
// mode='sales'    -> clear transactional data (sales, returns, stock movements); zero stock
// mode='products' -> delete products + their own branch/batch stock and images;
//                    KEEP sales/returns/movements (all already store their own
//                    product_name/price snapshot, so they stay accurate and
//                    readable with no product row behind them) and everything
//                    else (customers, suppliers, contacts, settings, users,
//                    branches). Forces a fresh backup first -- see below.
//                    Three independent, additive toggles let the caller also
//                    fold in the movement/audit trail, sales & returns,
//                    and/or the stored image files themselves into the SAME
//                    atomic delete -- default (all false) keeps this mode's
//                    original narrow behavior unchanged for any existing
//                    caller that never sends them:
//                      includeMovements -> also delete inventory_movements,
//                        stock_row_moves, stock_transfers
//                      includeSales     -> also delete sales, sale_items,
//                        returns, return_items, and both *_batch_allocations
//                        tables
//                      includeImages    -> also delete the specific R2
//                        objects referenced by the products/product_images
//                        rows being removed (collected BEFORE the D1 delete
//                        runs, since the rows won't exist to read from
//                        after). This is a TARGETED delete of exactly the
//                        keys this reset's own products touched -- never a
//                        blanket 'uploads/' prefix wipe (that's what
//                        Factory Reset / mode='all' already do, and stays
//                        their job, not this toggle's). Restored -- an
//                        earlier session removed this flag entirely and the
//                        removal shipped without updating
//                        scripts/test-reset-products-pure.cjs, which still
//                        asserted the old contract and was quietly failing;
//                        re-added because the user explicitly asked for
//                        "products delete doesn't affect wired images,
//                        only when choosing delete images does it delete."
//                    Customers, suppliers, delivery_contacts, branches,
//                    categories, units, settings, and users are never
//                    touched by any of the three toggles -- this mode is
//                    scoped to "products and what only exists because of
//                    products", never contacts, same as its no-toggle
//                    behavior always was.
// mode='all'      -> also remove products, contacts, custom fields, import
//                    jobs, and file-library assets (file_assets, so no D1
//                    row is left pointing at an R2 object the 'uploads/'
//                    cleanup below just deleted); keep settings/users/branches
//
// All three modes force a fresh backup first (Part 248) -- 'products' had
// this from the start; 'sales'/'all' were missing it until Part 248, a real
// gap since they delete strictly more than 'products' does.
// ---------------------------------------------------------------------------
app.post('/reset-data', async (c) => {
  const denied = denyUnlessBackupPermission(c)
  if (denied) return denied
  if (await rateLimited(c, 'reset_data', 5, 600)) {
    return c.json({ error: 'Too many reset attempts. Wait a few minutes and try again.' }, 429)
  }

  const body = await c.req.json<{ mode?: string; includeMovements?: boolean; includeSales?: boolean; includeImages?: boolean }>().catch(() => ({}) as { mode?: string; includeMovements?: boolean; includeSales?: boolean; includeImages?: boolean })
  const mode = body.mode === 'all' ? 'all' : body.mode === 'products' ? 'products' : 'sales'
  const includeMovements = mode === 'products' && body.includeMovements === true
  const includeSales = mode === 'products' && body.includeSales === true
  const includeImages = mode === 'products' && body.includeImages === true
  const db = getDb(c.env)
  const user = c.get('user')

  if (mode === 'products') {
    // Hard prerequisite, not a checkbox: a fresh backup must actually
    // succeed before any delete runs. If this throws, the whole request
    // aborts here -- nothing below has touched the database yet.
    try {
      await createCloudflareBackup(c.env, 'manual')
    } catch (error) {
      return c.json({
        success: false,
        error: `Reset aborted: could not create a backup first (${(error as Error).message || 'unknown error'}). No data was changed.`,
      }, 500)
    }

    try {
      // includeImages: collect the exact R2 keys this reset's own rows
      // reference BEFORE the D1 delete runs below (the rows won't exist to
      // read from afterward). Two source columns -- products.image_path
      // (the primary/cover image) and product_images.image_path (gallery
      // rows) -- sanitized through the same sanitizeMediaPath() every other
      // image reference in this codebase goes through, then deduped and
      // stripped of their leading slash to match the bare 'uploads/...' key
      // shape deleteObject()/files.ts's own delete route already use.
      // When includeImages is false (the default), this list is simply
      // never collected and R2 is never touched, same as before.
      let imageKeysToDelete: string[] = []
      if (includeImages) {
        const [productRows, galleryRows] = await Promise.all([
          db.prepare('SELECT image_path FROM products WHERE image_path IS NOT NULL AND image_path != \'\'').all<{ image_path: string }>(),
          db.prepare('SELECT image_path FROM product_images WHERE image_path IS NOT NULL AND image_path != \'\'').all<{ image_path: string }>(),
        ])
        const rawPaths = [...productRows, ...galleryRows].map((r) => r.image_path)
        imageKeysToDelete = sanitizeMediaList(rawPaths).map((p) => p.replace(/^\/+/, ''))
      }

      const productResetStatements: Array<{ sql: string }> = [
        // Live inventory tied to products -- not snapshotted anywhere,
        // meaningless once the product is gone, so these always follow
        // the product regardless of any keep/delete toggle. Table list +
        // ordering lives in lib/coreDataInvariants.ts's
        // PRODUCTS_RESET_TABLES (also what the regression test runs
        // against), not duplicated here.
        ...PRODUCTS_RESET_TABLES.map((table) => ({ sql: `DELETE FROM "${table}"` })),
      ]

      // Optional add-on: movement/audit trail. Off by default (kept) --
      // all three tables already store their own product_name/branch_name
      // snapshot, so they stay accurate and readable even after the
      // product row above is gone.
      if (includeMovements) {
        productResetStatements.push(
          { sql: 'DELETE FROM inventory_movements' },
          { sql: 'DELETE FROM stock_row_moves' },
          { sql: 'DELETE FROM stock_transfers' },
        )
      }

      // Optional add-on: sales & returns. Off by default (kept) -- same
      // denormalization reasoning (product_name/applied_price/cost_price
      // all stored at time of sale), so Dashboard/Sales stats stay
      // accurate whether or not this toggle is used. Allocation tables
      // deleted first since they reference sale_items/return_items.
      if (includeSales) {
        productResetStatements.push(
          { sql: 'DELETE FROM return_item_batch_allocations' },
          { sql: 'DELETE FROM sale_item_batch_allocations' },
          { sql: 'DELETE FROM return_items' },
          { sql: 'DELETE FROM returns' },
          { sql: 'DELETE FROM sale_items' },
          { sql: 'DELETE FROM sales' },
        )
      }

      productResetStatements.push({ sql: 'DELETE FROM action_history' })

      await db.batch(productResetStatements)
      // Deliberately NOT touched by either toggle: customers, suppliers,
      // delivery_contacts, custom_fields, import job history, and every
      // settings/user/branch/category/unit table.
      //
      // rfid_events / rfid_session_items also left untouched (nullable
      // product_id, closer to a scan-history log than live state) --
      // BUT unlike the tables above, neither stores its own product_name
      // snapshot, so a dangling product_id there may show as a blank/lost
      // reference in the RFID admin screen rather than a readable
      // historical row. Flagged, not fixed -- needs a look at how that
      // screen actually renders a missing product before deciding whether
      // these two should follow rfid_tags instead.

      // R2 cleanup for this mode is best-effort and ONLY runs when
      // includeImages was explicitly true -- same "D1 correctness is
      // load-bearing, R2 cleanup is best-effort" split factory-reset uses:
      // a partial R2 failure here never rolls back or fails the D1 delete
      // that already succeeded, it's just reported back to the caller.
      const imageDeleteErrors: string[] = []
      if (includeImages && imageKeysToDelete.length) {
        await Promise.all(imageKeysToDelete.map(async (key) => {
          try {
            await deleteObject(c.env.ASSETS, key)
          } catch (error) {
            imageDeleteErrors.push(`${key}: ${(error as Error).message || 'unknown error'}`)
          }
        }))
      }

      const productResetLabelParts = ['products, batches, and branch/batch stock deleted']
      if (includeMovements) productResetLabelParts.push('movement/audit history deleted')
      if (includeSales) productResetLabelParts.push('sales and returns deleted')
      if (includeImages) productResetLabelParts.push(`${imageKeysToDelete.length} image file(s) deleted`)

      await audit(c.env, user?.id ?? null, user?.name ?? null, 'reset_data', 'system', null, {
        label: `Products reset - ${productResetLabelParts.join('; ')}`,
        mode,
        includeMovements,
        includeSales,
        includeImages,
        imageFilesDeleted: includeImages ? imageKeysToDelete.length : undefined,
        imageDeleteErrors: imageDeleteErrors.length || undefined,
      })

      c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'reset', mode }))
      c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'reset', mode }))
      if (includeMovements || includeSales) {
        c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'reset', mode }))
        c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reset', mode }))
      }
      c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))

      const keptParts = []
      if (!includeSales) keptParts.push('sales, returns')
      if (!includeMovements) keptParts.push('movements')
      if (!includeImages) keptParts.push('stored product image files')
      keptParts.push('contacts')
      const keptSuffix = keptParts.length ? `${keptParts.join(', ')} and everything else kept.` : 'Everything else kept.'

      return c.json({
        success: true,
        message: `Products reset complete - products, batches, and their branch stock deleted${includeMovements ? ', movement/audit history deleted' : ''}${includeSales ? ', sales and returns deleted' : ''}${includeImages ? `, ${imageKeysToDelete.length} image file(s) deleted` : ''}. ${keptSuffix} A fresh backup was taken first.${imageDeleteErrors.length ? ` Note: ${imageDeleteErrors.length} image file(s) failed to delete from storage (D1 data was still updated correctly).` : ''}`,
      })
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message || 'Reset failed' }, 500)
    }
  }

  // Same hard prerequisite as mode='products' above, extended to
  // mode='sales'/'all' -- the spec this was built against ("force a fresh
  // backup snapshot and confirm it completed before the delete is allowed
  // to proceed") was never actually scoped to just one mode, and these two
  // delete strictly more data than 'products' does. Previously only
  // 'products' had this gate, a real gap: a failed/missing backup let
  // 'sales' and 'all' proceed with no safety net at all. Same pattern --
  // if this throws, the request aborts here, nothing below has touched
  // the database yet.
  try {
    await createCloudflareBackup(c.env, 'manual')
  } catch (error) {
    return c.json({
      success: false,
      error: `Reset aborted: could not create a backup first (${(error as Error).message || 'unknown error'}). No data was changed.`,
    }, 500)
  }

  try {
    const statements: Array<{ sql: string }> = [
      { sql: 'DELETE FROM return_item_batch_allocations' },
      { sql: 'DELETE FROM sale_item_batch_allocations' },
      { sql: 'DELETE FROM return_items' },
      { sql: 'DELETE FROM returns' },
      { sql: 'DELETE FROM sale_items' },
      { sql: 'DELETE FROM sales' },
      { sql: 'DELETE FROM inventory_movements' },
      { sql: 'DELETE FROM stock_transfers' },
      { sql: 'DELETE FROM stock_row_moves' },
      { sql: 'UPDATE branch_stock SET quantity = 0, rfid_confirmed_qty = 0' },
      { sql: 'UPDATE branch_batch_stock SET quantity = 0' },
    ]

    if (mode === 'all') {
      statements.push(
        { sql: 'DELETE FROM product_batches' },
        { sql: 'DELETE FROM products' },
        { sql: 'DELETE FROM branch_stock' },
        { sql: 'DELETE FROM customers' },
        { sql: 'DELETE FROM suppliers' },
        { sql: 'DELETE FROM delivery_contacts' },
        { sql: 'DELETE FROM custom_fields' },
        { sql: 'DELETE FROM import_job_errors' },
        { sql: 'DELETE FROM import_job_batches' },
        { sql: 'DELETE FROM import_job_rows' },
        { sql: 'DELETE FROM import_job_files' },
        { sql: 'DELETE FROM import_jobs' },
        // Real bug fixed here (flagged but not fixed in Part 237): mode='all'
        // blanket-wipes every R2 object under 'uploads/' below, which
        // includes file-library assets, but never deleted their `file_assets`
        // D1 rows -- Library would show broken images pointing at objects
        // that no longer exist. `import_job_files.file_asset_id` is nullable
        // and already deleted above, so this has no dependency ordering
        // issue.
        { sql: 'DELETE FROM file_assets' },
        { sql: 'DELETE FROM action_history' },
        // Keep: branches, categories, units, settings, users, roles.
      )
    } else {
      statements.push(
        { sql: 'UPDATE products SET stock_quantity = 0' },
        { sql: 'DELETE FROM action_history' },
      )
    }

    await db.batch(statements)

    if (mode === 'all') {
      // Best-effort R2 cleanup -- not part of the atomic D1 batch (R2 has no
      // transactional link to D1), so failures here are logged but never
      // block the data reset from reporting success.
      //
      // Bug fixed here: this previously only cleaned 'imports/' (the raw
      // CSV/ZIP files a bulk import uploaded), never 'uploads/' (product
      // images, file-library assets, avatars). Since mode='all' deletes
      // every `products` row, `file_assets` row, etc. from D1, the R2
      // objects those rows pointed at became orphaned -- silently
      // undeletable garbage that survives a "full data reset" forever
      // (confirmed by checking the bucket directly: uploads/ objects were
      // still present after a full reset with no products left to
      // reference them). factory-reset already cleaned both prefixes;
      // reset-data was just missing the 'uploads/' one.
      //
      // **Gap found in Part 237, FIXED in Part 248:** the comment above
      // assumed `file_assets` rows got deleted too, but they didn't --
      // `statements` above now includes `DELETE FROM file_assets` for
      // exactly this reason. `file_assets` and `product_images` both store
      // their objects under the same flat `uploads/` prefix (confirmed
      // against `routes/files.ts`'s upload handler), so this blanket prefix
      // wipe now matches D1 state: no `file_assets` row is left pointing at
      // an object this cleanup just deleted. mode='products' below still
      // deliberately does NOT reuse this blanket-prefix pattern -- it never
      // touches `file_assets` at all, so it collects and deletes only the
      // specific keys the rows it's actually removing pointed to.
      try {
        const objects = await listObjects(c.env.ASSETS, 'uploads/')
        await Promise.all(objects.map((o) => deleteObject(c.env.ASSETS, o.key)))
      } catch (_) {
        // Non-fatal -- orphaned uploaded files in R2 don't affect app correctness.
      }
      try {
        const objects = await listObjects(c.env.ASSETS, 'imports/')
        await Promise.all(objects.map((o) => deleteObject(c.env.ASSETS, o.key)))
      } catch (_) {
        // Non-fatal -- orphaned import files in R2 don't affect app correctness.
      }
    }

    const label = mode === 'all'
      ? 'Full data reset - sales, returns, products, and contacts cleared'
      : 'Sales reset - sales, returns, and stock cleared'
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'reset_data', 'system', null, { label, mode })

    // Notify every connected page/device (Dashboard, Products, Inventory,
    // Sales, POS, Branches, Returns) that their data just changed out from
    // under them -- this is a destructive full-table wipe, so stale
    // cached/displayed numbers here would be actively misleading, not just
    // momentarily behind. Previously this route never broadcast or
    // invalidated the products search cache at all.
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'reset', mode }))
    c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'reset', mode }))
    c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'reset', mode }))
    c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reset', mode }))
    if (mode === 'all') {
      c.executionCtx.waitUntil(broadcast(c.env, 'customers', { action: 'reset', mode }))
      c.executionCtx.waitUntil(broadcast(c.env, 'suppliers', { action: 'reset', mode }))
    }
    c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))

    return c.json({
      success: true,
      message: mode === 'all'
        ? 'Reset complete - sales, returns, products, and contacts deleted. Settings, users, and branches kept.'
        : 'Sales reset - sales, returns, and stock cleared. Products and contacts kept.',
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Reset failed' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Reset a single, safe, self-contained section: Customers, Suppliers,
// Delivery Contacts, or Audit Log. Each one is a plain `DELETE FROM` on its
// own table (Customers also clears `customer_share_submissions`, which
// exists only because of a specific customer -- same "follows its parent,
// not independently meaningful" reasoning PRODUCTS_RESET_TABLES already
// uses for a product's own batches/branch-stock rows). None of these four
// ever needs a cascade: every table that references them (sales, returns,
// loyalty_point_adjustments) already stores its own denormalized name/
// phone/address snapshot at time of transaction, confirmed by reading
// their real column lists (see Part 262's scoping entry in progress.md,
// not re-derived here), so a dangling *_id on an old transaction row is
// harmless and stays readable.
//
// Deliberately a SEPARATE endpoint from /reset-data above rather than a
// 4th/5th/6th/7th value folded into that route's `mode` union -- these are
// simple, single-purpose, no-toggle deletes with none of reset-data's
// interacting options (includeMovements/includeSales/includeImages), and
// keeping them apart means this endpoint can never regress the existing,
// already-load-bearing reset-data contract just by adding a section here.
// Users is deliberately NOT one of the four sections this endpoint
// supports -- Part 262 found it needs real product decisions first (does
// it exclude the acting admin's own row, does it force-invalidate other
// users' sessions, does it need the same reseed factory-reset calls) that
// aren't guessable from the backlog note's wording alone.
// ---------------------------------------------------------------------------
const RESETTABLE_SECTIONS = ['customers', 'suppliers', 'delivery_contacts', 'audit_log'] as const
type ResettableSection = typeof RESETTABLE_SECTIONS[number]

const SECTION_CONFIG: Record<ResettableSection, { tables: string[]; label: string; broadcastChannel: import('../durable-objects/broadcastHub').BroadcastChannel | null }> = {
  customers: { tables: ['customer_share_submissions', 'customers'], label: 'Customers', broadcastChannel: 'customers' },
  suppliers: { tables: ['suppliers'], label: 'Suppliers', broadcastChannel: 'suppliers' },
  delivery_contacts: { tables: ['delivery_contacts'], label: 'Delivery contacts', broadcastChannel: 'deliveryContacts' },
  // No real-time broadcast channel exists for the audit log (see
  // BroadcastChannel's own union in broadcastHub.ts) -- the Audit Log page
  // already re-fetches on its own navigation/action-history triggers, so
  // this is left null rather than broadcasting on an invented channel name
  // no client listens for.
  audit_log: { tables: ['audit_logs'], label: 'Audit log', broadcastChannel: null },
}

app.post('/reset-section', async (c) => {
  const denied = denyUnlessBackupPermission(c)
  if (denied) return denied
  if (await rateLimited(c, 'reset_section', 10, 600)) {
    return c.json({ error: 'Too many reset attempts. Wait a few minutes and try again.' }, 429)
  }

  const body = await c.req.json<{ section?: string }>().catch(() => ({}) as { section?: string })
  const section = body.section as ResettableSection
  if (!RESETTABLE_SECTIONS.includes(section)) {
    return c.json({ error: `Unknown section. Must be one of: ${RESETTABLE_SECTIONS.join(', ')}` }, 400)
  }

  const config = SECTION_CONFIG[section]
  const db = getDb(c.env)
  const user = c.get('user')

  // Same hard prerequisite as every mode on /reset-data -- a fresh backup
  // must actually succeed before any delete runs. Deliberately a lightweight
  // `createSectionBackup` scoped to just this section's own tables, NOT the
  // full `createCloudflareBackup` -- see createSectionBackup's own comment
  // in backup.ts. The full backup's whole-database dump + R2 asset listing
  // was measured to exceed the Worker's CPU limit on a store with real
  // sales history, for a reset that only ever deletes 1-2 small tables.
  try {
    await createSectionBackup(c.env, config.tables, 'manual')
  } catch (error) {
    return c.json({
      success: false,
      error: `Reset aborted: could not create a backup first (${(error as Error).message || 'unknown error'}). No data was changed.`,
    }, 500)
  }

  try {
    await db.batch(config.tables.map((table) => ({ sql: `DELETE FROM "${table}"` })))

    await audit(c.env, user?.id ?? null, user?.name ?? null, 'reset_data', 'system', null, {
      label: `${config.label} reset - ${config.tables.join(', ')} cleared`,
      mode: `section:${section}`,
    })

    if (config.broadcastChannel) {
      c.executionCtx.waitUntil(broadcast(c.env, config.broadcastChannel, { action: 'reset', section }))
      c.executionCtx.waitUntil(bumpVersion(c.env, config.broadcastChannel))
    }

    return c.json({
      success: true,
      message: `${config.label} reset complete - all ${config.label.toLowerCase()} records deleted. Everything else kept. A fresh backup was taken first.`,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Reset failed' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Factory reset: wipe everything (all business data, users, roles, settings,
// uploaded files), then reseed a default org/branch/roles/admin so the
// operator isn't locked out. Same two-phase shape as the original backend
// (backend/src/routes/system/index.ts) -- wipe inside a batch, then call
// ensureCoreDataInvariants() -- ported to D1's async batch API, with
// dropAllCustomTables() added because this Worker (unlike the original)
// creates real per-row `CREATE TABLE` DDL for user-defined tables that a
// plain DELETE from custom_tables would leave orphaned.
// ---------------------------------------------------------------------------
app.post('/factory-reset', async (c) => {
  const denied = denyUnlessBackupPermission(c)
  if (denied) return denied
  // Matches backend's factory-reset rate limit (2 attempts / 30 minutes) --
  // deliberately tighter than reset-data's 5/10min since this is the more
  // destructive of the two.
  if (await rateLimited(c, 'factory_reset', 2, 30 * 60)) {
    return c.json({ error: 'Too many factory reset attempts. Wait a few minutes and try again.' }, 429)
  }

  const user = c.get('user')
  const db = getDb(c.env)

  try {
    const droppedCustomTables = await dropAllCustomTables(c.env)

    await db.batch(FACTORY_RESET_TABLES.map((table) => ({ sql: `DELETE FROM "${table}"` })))

    const invariants = await ensureCoreDataInvariants(c.env)

    // Best-effort R2 cleanup, same non-fatal spirit as reset-data above --
    // R2 has no transactional link to D1, so a partial failure here is
    // logged in the response but never blocks the reset from reporting
    // success (the D1 wipe + reseed is the part that must not half-finish).
    let deletedObjectCount = 0
    const r2Errors: string[] = []
    for (const prefix of ['uploads/', 'imports/']) {
      try {
        const objects = await listObjects(c.env.ASSETS, prefix)
        await Promise.all(objects.map((o) => deleteObject(c.env.ASSETS, o.key)))
        deletedObjectCount += objects.length
      } catch (error) {
        r2Errors.push(`${prefix}: ${(error as Error).message || 'unknown error'}`)
      }
    }

    await audit(c.env, user?.id ?? null, user?.name ?? null, 'factory_reset', 'system', null, {
      label: 'Factory reset completed',
      droppedCustomTables: droppedCustomTables.length,
      deletedObjectCount,
      r2Errors: r2Errors.length || undefined,
      adminUserCreated: invariants.adminUserCreated,
    })

    return c.json({
      success: true,
      message: 'Factory reset complete. All data and images wiped. Admin account and defaults restored.',
      // Only present the one time the admin row is actually (re)created --
      // this is the only path back into the app, so it has to be surfaced
      // here rather than left to a password the operator may not remember.
      admin: invariants.adminUserCreated
        ? { username: 'admin', password: invariants.adminPassword }
        : { username: 'admin', password: null },
      r2CleanupErrors: r2Errors.length ? r2Errors : undefined,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Factory reset failed' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Data integrity check & repair.
// ---------------------------------------------------------------------------
app.get('/verify-integrity', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'backup') && !hasPermission(user, 'settings')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  try {
    const result = await runDataIntegrityCheck(c.env, false)
    return c.json({ ...result, success: true })
  } catch (error) {
    return c.json({ success: false, error: `Integrity check failed: ${(error as Error).message}` }, 500)
  }
})

app.post('/repair-integrity', async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'backup') && !hasPermission(user, 'settings')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  try {
    const result = await runDataIntegrityCheck(c.env, true)
    if (result.repairs > 0) {
      await audit(c.env, user?.id ?? null, user?.name ?? null, 'repair', 'data-integrity', null, {
        repairs: result.repairs,
        errors: result.errors.length,
      })
    }
    return c.json({ ...result, success: true })
  } catch (error) {
    return c.json({ success: false, error: `Integrity repair failed: ${(error as Error).message}` }, 500)
  }
})

export default app
