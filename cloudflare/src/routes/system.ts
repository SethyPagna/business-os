import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth } from '../lib/auth'
import { hasPermission } from '../lib/permissions'
import { getDb } from '../lib/db'
import { audit } from '../lib/audit'
import { runDataIntegrityCheck } from '../lib/dataIntegrity'
import { listObjects, deleteObject, deleteObjectsBulk } from '../lib/r2'
import { cleanOrphanImportStaging } from '../lib/importRetention'
import { sanitizeMediaList } from '../lib/media'
import { ensureCoreDataInvariants, dropAllCustomTables, FACTORY_RESET_TABLES, PRODUCTS_RESET_TABLES } from '../lib/coreDataInvariants'
import { createCloudflareBackup, createSectionBackup } from '../lib/backup'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { reportError } from '../lib/errorReporting'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'

// Each R2 delete is its own subrequest, and a Worker invocation has a
// hard ceiling on how many it may make. A catalog of ~6,700 products with
// up to three images each is ~20,000 objects, so firing them all off at
// once (which is what a single Promise.all over the whole list did) blows
// that ceiling and takes the whole request down AFTER the database delete
// has already committed -- the worst possible place to fail.
//
// So the deletes are capped and, crucially, REPORTED: whatever is left
// over is stated in the response rather than being silently treated as
// deleted. Those objects are no longer referenced by any product row, so
// they surface in the Library and can be removed there.
//
// A4 (session 05): 200 -> 500 under the Feb-2026 Paid limits (10,000
// subrequests/invocation, pinned in wrangler.toml -- 500 is 5% of it).
// The deletes below run SEQUENTIALLY, so the honest per-run bound is the
// admin's wall-clock wait: ~20-40ms per delete keeps 500 inside ~10-20s
// on top of an already-heavy reset. Deliberately NOT raised to "the whole
// catalog": a 20k-object sweep belongs to a continuation design, not one
// interactive request, and the leftover-reporting path already handles
// the remainder honestly.
const MAX_IMAGE_DELETES_PER_RESET = 500

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

// Every route behind this helper DESTROYS data (reset-data, reset-section,
// finalize-migration, factory-reset, forced orphan cleanup), so it demands
// 'backup_restore' (restore/reset, sensitivity: critical) -- NOT 'backup',
// which is the EXPORT permission that is deliberately safe to hand to more
// people (see lib/permissions.ts's backup/backup_restore note and
// routes/backups.ts's restore branch, which draws the same line). Gating
// these on 'backup' let an export-only account wipe the database -- and
// factory-reset hands back the reseeded admin password, so that account
// also got full takeover (Part-77 CRITICAL, auth audit).
function denyUnlessRestorePermission(c: any) {
  const user = c.get('user')
  if (!hasPermission(user, 'backup_restore')) return c.json({ error: 'You do not have permission to perform this action' }, 403)
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
  const denied = denyUnlessRestorePermission(c)
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
    // ONE list, used for both the backup and the delete. Deriving them
    // separately is how a scoped backup ends up unable to undo the reset
    // it was taken for, so the toggles extend this array and both steps
    // read it.
    //
    // Table list + ordering for the base set lives in
    // lib/coreDataInvariants.ts's PRODUCTS_RESET_TABLES (also what the
    // regression test runs against), not duplicated here.
    const tablesToClear: string[] = [...PRODUCTS_RESET_TABLES]

    // Optional add-on: movement/audit trail. Off by default (kept) --
    // all three tables already store their own product_name/branch_name
    // snapshot, so they stay accurate and readable even after the
    // product row is gone.
    if (includeMovements) {
      tablesToClear.push('inventory_movements', 'stock_row_moves', 'stock_transfers')
    }

    // Optional add-on: sales & returns. Off by default (kept) -- same
    // denormalization reasoning (product_name/applied_price/cost_price
    // all stored at time of sale), so Dashboard/Sales stats stay accurate
    // whether or not this toggle is used. Allocation tables are listed
    // first since they reference sale_items/return_items.
    if (includeSales) {
      tablesToClear.push(
        'return_item_batch_allocations',
        'sale_item_batch_allocations',
        'return_items',
        'returns',
        'sale_items',
        'sales',
      )
    }

    tablesToClear.push('action_history')

    // Hard prerequisite, not a checkbox: a fresh backup must actually
    // succeed before any delete runs. If this throws, the whole request
    // aborts here -- nothing below has touched the database yet.
    //
    // SCOPED to the tables this reset will actually clear, not the whole
    // database. The full createCloudflareBackup walks all ~34 backup
    // tables and lists every object in the R2 bucket, and running that in
    // front of the reset is what produced the reported
    // `POST /api/system/reset-data - Exceeded CPU Limit`: the request died
    // inside the backup, before touching any data, so the reset never ran
    // at all. /reset-section hit the identical wall and was fixed the
    // identical way; this mode was simply missed.
    //
    // Correctness is not traded for the speed: a backup covering exactly
    // what is about to be deleted is precisely what is needed to undo it,
    // and restore already handles a partial table set (see
    // createSectionBackup's own comment). What it does NOT cover is the
    // rest of the database -- which this reset does not touch either.
    try {
      await createSectionBackup(c.env, tablesToClear, 'manual')
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

      await db.batch(tablesToClear.map((table) => ({ sql: `DELETE FROM "${table}"` })))
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
      let imagesDeleted = 0
      const imagesOverCap = Math.max(0, imageKeysToDelete.length - MAX_IMAGE_DELETES_PER_RESET)
      if (includeImages && imageKeysToDelete.length) {
        for (const key of imageKeysToDelete.slice(0, MAX_IMAGE_DELETES_PER_RESET)) {
          try {
            await deleteObject(c.env.ASSETS, key)
            imagesDeleted += 1
          } catch (error) {
            imageDeleteErrors.push(`${key}: ${(error as Error).message || 'unknown error'}`)
          }
        }
      }

      const productResetLabelParts = ['products, batches, and branch/batch stock deleted']
      if (includeMovements) productResetLabelParts.push('movement/audit history deleted')
      if (includeSales) productResetLabelParts.push('sales and returns deleted')
      if (includeImages) productResetLabelParts.push(`${imagesDeleted} image file(s) deleted`)

      await audit(c.env, user?.id ?? null, user?.name ?? null, 'reset_data', 'system', null, {
        label: `Products reset - ${productResetLabelParts.join('; ')}`,
        mode,
        includeMovements,
        includeSales,
        includeImages,
        imageFilesDeleted: includeImages ? imagesDeleted : undefined,
        imageFilesLeftOverCap: imagesOverCap || undefined,
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
        message: `Products reset complete - products, their received dates, and their branch stock deleted${includeMovements ? ', movement/audit history deleted' : ''}${includeSales ? ', sales and returns deleted' : ''}${includeImages ? `, ${imagesDeleted} image file(s) deleted` : ''}. ${keptSuffix} A fresh backup was taken first.${imagesOverCap ? ` Note: ${imagesOverCap} more image file(s) were left in storage -- a single request cannot delete more than ${MAX_IMAGE_DELETES_PER_RESET}. They are no longer referenced by any product and can be removed from the Library.` : ''}${imageDeleteErrors.length ? ` Note: ${imageDeleteErrors.length} image file(s) failed to delete from storage (the database was still updated correctly).` : ''}`,
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
        // Import bookkeeping added after the original reset route. Clear
        // every job-scoped ledger before deleting import_jobs so a genuine
        // "start over" does not leave materialized CSV rows, idempotency
        // commits, guards, grouping state, image plans, or merge evidence
        // from the previous run behind.
        { sql: 'DELETE FROM import_auto_merges' },
        { sql: 'DELETE FROM import_sales_commits' },
        { sql: 'DELETE FROM import_stock_action_guards' },
        { sql: 'DELETE FROM import_stock_action_commits' },
        { sql: 'DELETE FROM import_stock_action_groups' },
        { sql: 'DELETE FROM import_job_image_renames' },
        { sql: 'DELETE FROM import_job_image_matches' },
        { sql: 'DELETE FROM import_job_row_signatures' },
        { sql: 'DELETE FROM import_job_source_rows' },
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

    // mode 'all' wipes the import tables in `statements` above; the two BULK
    // members (import_job_rows, import_job_source_rows) live on the separate
    // import-staging DB (see lib/db.ts), so the DELETEs above hit only the
    // main DB's now-empty shells -- clear the real staging on its own DB.
    // No-op in single-DB environments where db.staging === db.
    if (mode === 'all') {
      await db.staging.batch([
        { sql: `DELETE FROM import_job_rows` },
        { sql: `DELETE FROM import_job_source_rows` },
      ])
    }

    const resetSweepErrors: string[] = []
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
      //
      // K4: chunked BULK deletes (deleteObjectsBulk) -- one subrequest per
      // 1,000 keys instead of one per object. The old per-object
      // Promise.all here was unbounded in both concurrency and subrequest
      // count, so a large catalog could blow the invocation's subrequest
      // ceiling AFTER the D1 wipe above had already committed. Still
      // non-fatal (orphaned R2 objects don't affect app correctness), but
      // failures are now counted in the audit record instead of vanishing.
      for (const prefix of ['uploads/', 'imports/']) {
        try {
          const objects = await listObjects(c.env.ASSETS, prefix)
          const result = await deleteObjectsBulk(c.env.ASSETS, objects.map((o) => o.key))
          resetSweepErrors.push(...result.errors.map((e) => `${prefix}: ${e}`))
        } catch (error) {
          resetSweepErrors.push(`${prefix}: ${(error as Error).message || 'unknown error'}`)
        }
      }
    }

    const label = mode === 'all'
      ? 'Full data reset - sales, returns, products, and contacts cleared'
      : 'Sales reset - sales, returns, and stock cleared'
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'reset_data', 'system', null, { label, mode, r2Errors: resetSweepErrors.length || undefined })

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
  const denied = denyUnlessRestorePermission(c)
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
// Finalize migration: the two operator steps from the old-system import
// runbook (Downloads/businessos-migration-aug28/IMPORT-MANIFEST.md) that
// used to be hand-typed `wrangler d1 execute` UPDATEs, surfaced as a
// guarded, backup-first endpoint so nobody edits production D1 by hand.
//
//   step='zero_stock'  -> Manifest Step 4d, part 1. Zero every live count
//                         (branch_stock.quantity + products.stock_quantity)
//                         so the follow-up Add/Update RE-IMPORT of the two
//                         product files lands exactly on the template totals
//                         instead of stacking on top of the history import's
//                         units. The re-import itself is a file upload the
//                         operator does next -- this endpoint only does the
//                         zeroing half that was raw SQL before.
//   step='park_lots'   -> Manifest Step 4e (optional, recommended). Zero the
//                         remaining counts on the historical `Unified stock
//                         import` lots so the POS lot picker skips them (the
//                         old system never tied sales to lots, so their
//                         remaining quantities aren't allocatable). Matches
//                         the manifest's `instr(notes,'Unified stock import')=1`
//                         predicate exactly -- the `Received via product
//                         import` opening lots are deliberately untouched, so
//                         migration 0081's lot-ledger reconcile (Step 4f)
//                         still works and re-running this is a no-op.
//   step='repair_sep23_subtotals' -> One allowlisted, manifest-bound repair
//                         for sale ids 16842-16863. The helper owns every
//                         guard and statement; this route accepts no SQL.
//
// The stock actions are idempotent (the `<> 0` guards mean a second run reports 0
// affected), take a fresh scoped backup first exactly like every reset
// above, and only zero quantities -- no row is ever deleted here.
// ---------------------------------------------------------------------------
const LEGACY_SUBTOTAL_REPAIR_STEP = 'repair_sep23_subtotals'
const MIGRATION_FINALIZE_STEPS = ['zero_stock', 'park_lots', LEGACY_SUBTOTAL_REPAIR_STEP] as const
type MigrationFinalizeStep = typeof MIGRATION_FINALIZE_STEPS[number]

app.get('/legacy-subtotal-repair/preview', async (c) => {
  c.header('Cache-Control', 'no-store')
  const denied = denyUnlessRestorePermission(c)
  if (denied) return denied
  if (await rateLimited(c, 'subtotal_repair_preview', 10, 600)) {
    return c.json({ success: false, error: 'Too many previews. Wait a few minutes and try again.' }, 429)
  }
  const repair = await import('../lib/legacySubtotalRepair')
  const user = c.get('user')
  try {
    return c.json(await repair.previewLegacySubtotalRepair(getDb(c.env), { id: user?.id, name: user?.name }))
  } catch (error) {
    if (error instanceof repair.LegacySubtotalRepairValidationError || error instanceof repair.LegacySubtotalRepairConflictError) {
      return c.json({ success: false, error: 'The fixed 22-sale cohort is not in the expected unrepaired state. No data was changed; inspect the recorded repair and current sale data.' }, 409)
    }
    return c.json({ success: false, error: 'Could not preview the subtotal repair. No data was changed.' }, 500)
  }
})

app.post('/finalize-migration', async (c) => {
  const denied = denyUnlessRestorePermission(c)
  if (denied) return denied
  if (await rateLimited(c, 'finalize_migration', 10, 600)) {
    return c.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429)
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const step = body.step as MigrationFinalizeStep
  if (!MIGRATION_FINALIZE_STEPS.includes(step)) {
    return c.json({ error: `Unknown step. Must be one of: ${MIGRATION_FINALIZE_STEPS.join(', ')}` }, 400)
  }

  const db = getDb(c.env)
  const user = c.get('user')

  if (step === LEGACY_SUBTOTAL_REPAIR_STEP) {
    // Loaded only for this one-off path so the long-lived finalize actions and
    // their small pure harness do not acquire an unrelated runtime dependency.
    const repair = await import('../lib/legacySubtotalRepair')
    let plan
    try {
      plan = await repair.prepareLegacySubtotalRepair(body, { id: user?.id, name: user?.name })
    } catch (error) {
      if (error instanceof repair.LegacySubtotalRepairValidationError) {
        return c.json({ success: false, error: error.message }, 400)
      }
      return c.json({ success: false, error: 'Could not validate the subtotal repair request. No data was changed.' }, 500)
    }

    try {
      await createSectionBackup(c.env, repair.LEGACY_SUBTOTAL_REPAIR_BACKUP_TABLES, 'manual')
    } catch (error) {
      return c.json({
        success: false,
        error: `Aborted: could not create a backup first (${(error as Error).message || 'unknown error'}). No data was changed.`,
      }, 500)
    }

    try {
      const result = await repair.applyLegacySubtotalRepair(db, plan)
      return c.json({
        success: true,
        outcome: result.outcome,
        affected: { sales: result.changedSales },
        plan_id: plan.planId,
        manifest_sha256: plan.manifestSha256,
        message: result.outcome === 'applied'
          ? 'Repaired the guarded 22-sale legacy subtotal cohort. A fresh backup was taken first.'
          : 'This exact guarded subtotal repair was already applied; no sale changed. A fresh backup was taken before verification.',
      })
    } catch (error) {
      if (error instanceof repair.LegacySubtotalRepairConflictError) {
        return c.json({ success: false, error: error.message }, 409)
      }
      return c.json({ success: false, error: 'Subtotal repair failed. The atomic batch changed no data.' }, 500)
    }
  }

  // Same hard prerequisite as every reset: a fresh, scoped backup must
  // succeed before any write runs, so the operation is always undoable.
  const backupTables = step === 'zero_stock' ? ['branch_stock', 'products'] : ['branch_batch_stock']
  try {
    await createSectionBackup(c.env, backupTables, 'manual')
  } catch (error) {
    return c.json({
      success: false,
      error: `Aborted: could not create a backup first (${(error as Error).message || 'unknown error'}). No data was changed.`,
    }, 500)
  }

  try {
    if (step === 'zero_stock') {
      const branchRows = await db.prepare('SELECT COUNT(*) AS n FROM branch_stock WHERE quantity <> 0').get<{ n: number }>()
      const productRows = await db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock_quantity <> 0').get<{ n: number }>()
      // One atomic batch: either both live-count tables zero or neither does,
      // so the catalog is never left half-zeroed if the request is cut off.
      await db.batch([
        { sql: 'UPDATE branch_stock SET quantity = 0 WHERE quantity <> 0' },
        { sql: 'UPDATE products SET stock_quantity = 0 WHERE stock_quantity <> 0' },
      ])
      const affected = { branch_stock: branchRows?.n ?? 0, products: productRows?.n ?? 0 }

      await audit(c.env, user?.id ?? null, user?.name ?? null, 'finalize_migration', 'system', null, {
        label: `Migration finalize: zeroed live stock (${affected.branch_stock} branch-stock rows, ${affected.products} products)`,
        step,
      })
      c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'reset', step }))
      c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'reset', step }))
      c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
      c.executionCtx.waitUntil(bumpVersion(c.env, 'inventory'))

      return c.json({
        success: true,
        affected,
        message: `Live stock zeroed (${affected.branch_stock} branch-stock rows, ${affected.products} products). Now re-import the two product files (Add / Update) so totals land on the template. A fresh backup was taken first.`,
      })
    }

    // step === 'park_lots'
    const parkable = await db.prepare(
      "SELECT COUNT(*) AS n FROM branch_batch_stock WHERE quantity <> 0 AND batch_id IN (SELECT id FROM product_batches WHERE instr(notes, 'Unified stock import') = 1)",
    ).get<{ n: number }>()
    await db.prepare(
      "UPDATE branch_batch_stock SET quantity = 0 WHERE quantity <> 0 AND batch_id IN (SELECT id FROM product_batches WHERE instr(notes, 'Unified stock import') = 1)",
    ).run()
    const affected = { branch_batch_stock: parkable?.n ?? 0 }

    await audit(c.env, user?.id ?? null, user?.name ?? null, 'finalize_migration', 'system', null, {
      label: `Migration finalize: parked ${affected.branch_batch_stock} historical lot rows`,
      step,
    })
    c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'reset', step }))
    c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'reset', step }))
    c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
    c.executionCtx.waitUntil(bumpVersion(c.env, 'inventory'))

    return c.json({
      success: true,
      affected,
      message: `Parked ${affected.branch_batch_stock} historical row(s) — the POS picker will now skip un-allocatable "Unified stock import" received dates. A fresh backup was taken first.`,
    })
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message || 'Finalize migration failed' }, 500)
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
  const denied = denyUnlessRestorePermission(c)
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
    // The two bulk import-staging tables live on the separate import-staging DB
    // (see lib/db.ts); FACTORY_RESET_TABLES' DELETE of import_job_rows hits only
    // the main DB's empty shell, so clear the real staging on its own DB. No-op
    // in single-DB environments.
    await db.staging.batch([
      { sql: `DELETE FROM import_job_rows` },
      { sql: `DELETE FROM import_job_source_rows` },
    ])

    const invariants = await ensureCoreDataInvariants(c.env)

    // Best-effort R2 cleanup, same non-fatal spirit as reset-data above --
    // R2 has no transactional link to D1, so a partial failure here is
    // logged in the response but never blocks the reset from reporting
    // success (the D1 wipe + reseed is the part that must not half-finish).
    let deletedObjectCount = 0
    const r2Errors: string[] = []
    // K4: chunked BULK deletes, same reasoning as reset-data's sweep above
    // (one subrequest per 1,000 keys; the old per-object Promise.all was
    // unbounded). deletedObjectCount now counts actual successes, not the
    // listing size.
    for (const prefix of ['uploads/', 'imports/']) {
      try {
        const objects = await listObjects(c.env.ASSETS, prefix)
        const result = await deleteObjectsBulk(c.env.ASSETS, objects.map((o) => o.key))
        deletedObjectCount += result.deleted
        r2Errors.push(...result.errors.map((e) => `${prefix}: ${e}`))
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
// K4: orphan import-staging cleanup. Job-scoped rows whose import_jobs row
// no longer exists -- left behind by the pre-K4 per-job delete, which
// skipped half the ledgers (signatures, commits, guards, groups, image
// plans). The Phase-0 audit measured these among the ~193MB of staging.
//
// Per the locked execution plan this cleanup is NEVER automatic: the
// default is a dry-run report; deleting requires BOTH dry_run:false and
// force:true in the body, and the operator is told to take a backup first.
// The ongoing retention sweep (lib/importRetention.ts) prevents NEW
// orphans, so this endpoint is a one-time-ish repair, not a schedule.
// ---------------------------------------------------------------------------
app.post('/import-retention/orphans', async (c) => {
  const denied = denyUnlessRestorePermission(c)
  if (denied) return denied
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const apply = body?.dry_run === false && body?.force === true
  const report = await cleanOrphanImportStaging(c.env, { apply })
  if (apply) {
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'import_orphan_staging_clean', 'system', null, {
      tables: report.tables,
      r2Keys: report.r2Keys,
      r2Deleted: report.r2Deleted,
      r2Errors: report.r2Errors?.length || undefined,
    })
  }
  return c.json({
    success: true,
    dry_run: !apply,
    ...(apply ? {} : { note: 'Dry run only. Take a backup, then re-send with dry_run:false and force:true to delete these rows.' }),
    ...report,
  })
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
