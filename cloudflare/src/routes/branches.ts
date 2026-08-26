import { Hono } from 'hono'
import { getDb, toDbBool } from '../lib/db'
import { buildInClause, selectInChunks } from '../lib/sqlBinding'
import type { D1Compat } from '../lib/db'
import { paginateProductFamilies } from '../lib/familyPagination'
import { getFamilyStockStats } from '../lib/familyStockStats'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getPermissionTier } from '../lib/permissions'
import { maybeQueueForReview } from '../lib/reviewGate'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { audit } from '../lib/audit'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { findIdentityMatch, findIdentityMatches, type ProductIdentityRow } from '../lib/productIdentity'
import { decrementBatchStockStatement, incrementBatchStockStatement, resolveDestinationBatch } from '../lib/productBatches'
import type { Env } from '../index'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function getDefaultBranch(db: D1Compat) {
  return db.prepare(`SELECT id, name FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1`).get<{ id: number; name: string }>()
}

// Same misplaced-stock preview/confirm shape as the original: computing the
// exact same hash server-side for both the GET (preview) and POST (repair)
// calls means a repair can only run against the rows that were actually
// shown to the person who confirmed it -- if stock changed in between
// (another sale, another transfer), the token won't match and the repair
// is rejected rather than silently moving different rows than reviewed.
async function buildStockIntegrityPreview(rows: Array<{ product_id: number; branch_id: number; quantity: number }>, defaultBranchId: number) {
  const payloadRows = rows.map((r) => [r.product_id, r.branch_id, r.quantity])
  let totalQuantity = 0
  for (const row of rows) totalQuantity += Number(row.quantity || 0)
  const previewToken = await sha256Hex(`${defaultBranchId}:${JSON.stringify(payloadRows)}`)
  return { previewToken, totalQuantity }
}

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

type BranchInput = {
  name?: string
  location?: string
  phone?: string
  manager?: string
  notes?: string
  is_default?: unknown
  is_active?: unknown
}

app.get('/', async (c) => {
  const db = getDb(c.env)
  const branches = await db.prepare('SELECT * FROM branches ORDER BY is_default DESC, name').all()
  return c.json(branches)
})

// GET /api/branches/summary -- was returning an ARRAY of per-branch rows
// with fields (stock_quantity, product_count) that don't match anything the
// frontend reads. Branches.tsx (and the dashboard) read a single aggregate
// OBJECT with { branch_count, total_products, in_stock, low_stock,
// out_of_stock, stock_value_usd }, matching backend/src/businessMetrics.js's
// getStockMetrics() + branch_count. Because an array has none of those
// properties, every stat tile except ones with a `|| 0` fallback rendered
// blank/undefined instead of a real number. Ported to return the same
// aggregate shape, computed here against the flat branch_stock table (this
// codebase has not yet adopted the batch-stock tables used by
// backend/src/businessMetrics.js -- see the backend-port checkpoint).
app.get('/summary', async (c) => {
  // Read-only -- tier-aware (Review Required can view, per the Branch
  // section's spec: "the user can only view + submit"). Was the strict
  // hasPermission() boolean, which would have 403'd a Review Required
  // user out of a plain read, same class of bug Parts 152-156 already
  // fixed for products/inventory/returns/contacts/library.
  if (getPermissionTier(c.get('user'), 'branches') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const db = getDb(c.env)
  // This is an org-wide summary (no branchId param -- getBranchSummary() on
  // the frontend never sends one), so it must count each product once, not
  // once per branch it's stocked in. It previously did
  // `LEFT JOIN branch_stock bs ON bs.product_id = p.id` with no branch
  // scoping at all: a product carried in 3 branches has 3 branch_stock
  // rows, so that join fanned out into 3 result rows for one product --
  // COUNT(*) overcounted total_products, and a product that was e.g.
  // in-stock in one branch and out-of-stock in another got counted into
  // *both* buckets simultaneously (each fanned-out row evaluated the
  // CASE/SUM independently). That's the "branch stats look mixed"
  // behavior. Fixed by summing p.stock_quantity -- the product's own
  // denormalized total-across-all-branches column -- exactly the same
  // pattern routes/inventory.ts's GET /stats already uses for its
  // unscoped (no branchId) case, so this stays consistent with the one
  // other place in the app that computes the same kind of aggregate.
  // Family-aware (see familyStockStats.ts), same reasoning as
  // routes/inventory.ts's /stats and /bootstrap and compat.ts's dashboard
  // summary: a flat COUNT(*) here counted every variant row (and
  // group-header placeholder rows) individually, overcounting vs. the
  // family-grouped pagination total Products/Inventory's listings show.
  const familyStats = await getFamilyStockStats({
    db,
    joinSql: '',
    whereSql: 'WHERE p.is_active = 1',
    params: {},
    qtyExpr: 'COALESCE(p.stock_quantity, 0)',
  })
  const branchCount = await db.prepare('SELECT COUNT(*) AS count FROM branches WHERE is_active = 1').get<{ count: number }>()
  return c.json({
    total_products: familyStats.total_products,
    in_stock: familyStats.in_stock,
    healthy: familyStats.healthy,
    low_stock: familyStats.low_stock,
    out_of_stock: familyStats.out_of_stock,
    stock_value_usd: familyStats.stock_value_usd,
    branch_count: Number(branchCount?.count || 0),
  })
})

// GET /api/branches/stock-integrity -- was stubbed to always return an
// empty result (`{ ok: true, issues: [], items: [] }`), which is why the
// "repair" screen always showed nothing to fix even on databases that
// genuinely had stock parked in the wrong branch. Ported from
// backend/src/routes/branches.ts's real implementation: finds stock sitting
// in any non-default branch and previews moving it back to the default branch.
app.get('/stock-integrity', async (c) => {
  // Read-only preview -- tier-aware, same reasoning as GET /summary above.
  if (getPermissionTier(c.get('user'), 'branches') === 'none') {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'branches' }, 403)
  }
  const db = getDb(c.env)
  const defaultBranch = await getDefaultBranch(db)
  if (!defaultBranch) return c.json({ success: true, defaultBranch: null, issues: [], preview_token: null })

  const rows = await db.prepare(`
    SELECT bs.product_id, p.name AS product_name, bs.branch_id, b.name AS branch_name, bs.quantity,
           COALESCE(default_bs.quantity, 0) AS default_quantity
    FROM branch_stock bs
    JOIN products p ON p.id = bs.product_id
    JOIN branches b ON b.id = bs.branch_id
    LEFT JOIN branch_stock default_bs ON default_bs.product_id = bs.product_id AND default_bs.branch_id = @defaultBranchId
    WHERE bs.branch_id != @defaultBranchId
      AND COALESCE(bs.quantity, 0) > 0
      AND p.is_active = 1
    ORDER BY b.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC
    LIMIT 5000
  `).all<{ product_id: number; product_name: string; branch_id: number; branch_name: string; quantity: number; default_quantity: number }>({ defaultBranchId: defaultBranch.id })

  const preview = await buildStockIntegrityPreview(rows, defaultBranch.id)
  return c.json({
    success: true,
    defaultBranch,
    issues: rows,
    summary: { misplacedRows: rows.length, totalQuantity: preview.totalQuantity },
    preview_token: preview.previewToken,
  })
})

// POST /api/branches/stock-integrity/repair -- moves misplaced stock into
// the default branch. Requires the caller to re-submit the exact
// preview_token the GET above just returned, as confirmation they reviewed
// the same rows this will act on (see buildStockIntegrityPreview's comment).
app.post('/stock-integrity/repair', async (c) => {
  const user = c.get('user')
  const tier = getPermissionTier(user, 'branches')
  if (tier === 'none') {
    return c.json({ success: false, error: 'No permission', code: 'forbidden', permission: 'branches' }, 403)
  }
  // Deliberately NOT queued for review, unlike create/update below. This
  // moves real stock quantities between branches based on a preview token
  // tied to the exact state at preview time (see buildStockIntegrityPreview's
  // comment) -- the same "live-state dependency at apply time" reasoning
  // inventory.ts's adjust/transfer/move-row and returns.ts's PATCH /:id
  // are already deliberately left un-queued for. Blocked outright for
  // Review Required rather than left silently reachable as Full Access.
  if (tier === 'review') {
    return c.json({ success: false, error: 'Repairing misplaced stock requires Full Access to Branches -- Review Required support for this action is not built.', code: 'forbidden', permission: 'branches' }, 403)
  }
  const db = getDb(c.env)
  const defaultBranch = await getDefaultBranch(db)
  if (!defaultBranch) return c.json({ success: false, error: 'Default branch required' }, 400)

  const rows = await db.prepare(`
    SELECT bs.product_id, bs.branch_id, bs.quantity
    FROM branch_stock bs
    JOIN products p ON p.id = bs.product_id
    WHERE bs.branch_id != @defaultBranchId
      AND COALESCE(bs.quantity, 0) > 0
      AND p.is_active = 1
    ORDER BY bs.product_id ASC, bs.branch_id ASC
  `).all<{ product_id: number; branch_id: number; quantity: number }>({ defaultBranchId: defaultBranch.id })

  const preview = await buildStockIntegrityPreview(rows, defaultBranch.id)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  if (!body?.confirm || body?.preview_token !== preview.previewToken) {
    return c.json({ success: false, error: 'Run stock integrity check first, then confirm the matching preview token.' }, 400)
  }
  if (!rows.length) return c.json({ success: true, movedRows: 0, productCount: 0 })

  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  const touched = new Set<number>()
  for (const row of rows) {
    statements.push({
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId: row.product_id, branchId: defaultBranch.id, quantity: Number(row.quantity || 0) },
    })
    statements.push({
      sql: `UPDATE branch_stock SET quantity = 0 WHERE product_id = @productId AND branch_id = @branchId`,
      params: { productId: row.product_id, branchId: row.branch_id },
    })
    touched.add(row.product_id)
  }
  for (const productId of touched) {
    statements.push({
      sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
      params: { productId },
    })
  }
  await db.batch(statements)

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'repair', 'branch_stock_integrity', defaultBranch.id, { movedRows: rows.length, defaultBranchId: defaultBranch.id })
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'repair' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({ success: true, movedRows: rows.length, productCount: touched.size })
})

// NOTE: a GET /transfers/list route (transfer *history*, distinct from
// POST /transfer below which performs a transfer) used to live here too,
// added because "the transfer-history screen had nothing to load." It
// turned out to be a duplicate of GET /api/transfers in compat.ts (same
// query, same shape) -- the frontend's transfer-history screen
// (branchTransport.ts) has only ever called /api/transfers, never
// /api/branches/transfers/list, so the route here was dead on arrival.
// Removed rather than kept as a second, drifting copy of the same query.
// POST /api/branches/transfer -- moves stock from one branch to another.
// This never had a route on Cloudflare (frontend calls it from the
// inter-branch transfer screen), so every transfer attempt 404ed.
//
// Destination-side merge resolution: before writing the destination
// branch_stock row, check whether some OTHER product in the catalog is
// already the exact same real-world item (findIdentityMatch -- same
// name_key, cost, selling price, and barcode; see productIdentity.ts).
// This is the same identity rule CSV import now uses to decide "same
// product, just needs a branch_stock row for this branch" vs. "genuinely a
// different product" (see importEngine.ts's classifyProducts fallback) --
// applied here so a transfer self-heals a name-only duplicate instead of
// perpetuating it:
//   - Exact match exists somewhere in the catalog -> the transferred units
//     land on THAT product's branch_stock at the destination branch
//     (added to whatever it already has there), not a fresh branch_stock
//     row under the product that was actually selected to transfer.
//   - Same name but different details (or no match at all) -> nothing
//     changes from before: the destination write stays on the same
//     product_id that's being transferred. A same-name-different-details
//     product is already shown grouped with it on Products/Inventory via
//     name-based display grouping (utils/productGrouping.ts on the
//     frontend, name_key on the backend) -- no data linkage is needed for
//     that, only the create-vs-merge decision above.
// The source side is never redirected -- the units are physically leaving
// the exact row selected to transfer, so its own branch_stock at the
// source branch is always what gets decremented.
//
// Batch-aware transfer (optional `batchId` in the body): a batch-tracked
// product's stock lives in branch_batch_stock, per lot, alongside the
// plain branch_stock total -- a transfer of a specific lot has to move
// both in the same atomic batch, same as routes/sales.ts's sale/return
// deduct/restore. When the destination isn't redirected by the identity
// merge above, the transferred units stay in the exact same batch row
// (product_batches doesn't change, only which branch's
// branch_batch_stock has the quantity) -- "if it matches, it's the same
// batch" is trivially true here since nothing about the lot itself
// changed. When the merge DOES redirect the destination to a different
// product_id, resolveDestinationBatch (lib/productBatches.ts) finds or
// clones the equivalent batch under that product, same lot-code/expiry-
// date matching rule receiveBatchStock already uses for "is this the same
// lot" -- see that function's comment for the full reasoning.
app.post('/transfer', async (c) => {
  const user = c.get('user')
  const transferTier = getPermissionTier(user, 'branches')
  if (transferTier === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  // Same live-quantity-movement reasoning as stock-integrity/repair above
  // -- deliberately blocked, not queued, for Review Required.
  if (transferTier === 'review') {
    return c.json({ error: 'Transferring stock requires Full Access to Branches -- Review Required support for this action is not built.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const productId = Number.parseInt(String(body.productId ?? ''), 10)
  const fromBranchId = Number.parseInt(String(body.fromBranchId ?? ''), 10)
  const toBranchId = Number.parseInt(String(body.toBranchId ?? ''), 10)
  const quantity = Number(body.quantity)
  const note = body.note != null ? String(body.note).trim() || null : null
  // Optional batch/lot to transfer -- see this route's comment above for
  // why this has to move branch_batch_stock alongside the plain
  // branch_stock total, not instead of it.
  const batchId = body.batchId != null && body.batchId !== '' ? Number.parseInt(String(body.batchId), 10) : null

  if (!productId || !fromBranchId || !toBranchId || !Number.isFinite(quantity)) return c.json({ error: 'Missing required fields' }, 400)
  if (fromBranchId === toBranchId) return c.json({ error: 'Source and destination cannot be the same' }, 400)
  if (!(quantity > 0)) return c.json({ error: 'Transfer quantity must be greater than zero' }, 400)

  const db = getDb(c.env)
  const product = await db.prepare(`
    SELECT id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr
    FROM products WHERE id = @id
  `).get<{ id: number; name: string; barcode: string | null; cost_price_usd: number | null; cost_price_khr: number | null; selling_price_usd: number | null; selling_price_khr: number | null }>({ id: productId })
  if (!product) return c.json({ error: 'Product not found' }, 404)
  const fromStock = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = @branchId').get<{ quantity: number }>({ productId, branchId: fromBranchId })
  const available = fromStock ? Number(fromStock.quantity) || 0 : 0
  if (quantity > available) return c.json({ error: 'Insufficient stock in source branch' }, 400)

  let sourceBatch: { id: number; lot_code: string | null; expiry_date: string | null; notes: string | null } | null = null
  if (batchId) {
    sourceBatch = (await db.prepare(
      `SELECT id, lot_code, expiry_date, notes FROM product_batches WHERE id = @batchId AND variant_product_id = @productId AND is_active = 1`,
    ).get<{ id: number; lot_code: string | null; expiry_date: string | null; notes: string | null }>({ batchId, productId })) ?? null
    if (!sourceBatch) return c.json({ error: 'Batch not found for this product' }, 404)
    const batchStock = await db.prepare(
      'SELECT quantity FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = @branchId',
    ).get<{ quantity: number }>({ batchId, branchId: fromBranchId })
    const batchAvailable = batchStock ? Number(batchStock.quantity) || 0 : 0
    if (quantity > batchAvailable) return c.json({ error: 'Insufficient batch stock in source branch' }, 400)
  }

  const [fromBranch, toBranch, mergeTarget] = await Promise.all([
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: fromBranchId }),
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: toBranchId }),
    findIdentityMatch(db, product),
  ])
  const destProductId = mergeTarget?.id ?? productId
  const destProductName = mergeTarget?.name ?? product.name
  const mergedNote = mergeTarget ? `Added to existing product "${destProductName}" (#${destProductId}) at ${toBranch?.name || 'destination'}` : null
  const combinedNote = [note, mergedNote].filter(Boolean).join(' -- ') || null

  // Same batch when the destination product wasn't redirected (the lot
  // itself hasn't changed, only which branch's branch_batch_stock has the
  // quantity); resolved/cloned into an equivalent batch on destProductId
  // when it was.
  const destBatchId = sourceBatch
    ? (mergeTarget ? await resolveDestinationBatch(db, sourceBatch, destProductId) : sourceBatch.id)
    : null

  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = [
    { sql: 'UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = @productId AND branch_id = @branchId', params: { quantity, productId, branchId: fromBranchId } },
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId: destProductId, branchId: toBranchId, quantity },
    },
    {
      sql: `INSERT INTO stock_transfers (product_id, product_name, from_branch_id, to_branch_id, quantity, notes, user_id, user_name, created_at)
            VALUES (@productId, @productName, @fromBranchId, @toBranchId, @quantity, @note, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId, productName: product.name, fromBranchId, toBranchId, quantity, note: combinedNote, userId: user?.id ?? null, userName: user?.name ?? null },
    },
    {
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'transfer_out', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId, productName: product.name, branchId: fromBranchId, branchName: fromBranch?.name || null, quantity, reason: `Transfer out to ${toBranch?.name || 'destination'}${note ? ` - ${note}` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
    {
      // Recorded against destProductId -- this is a real per-product stock
      // audit trail (used to reconcile that product's own stock_quantity),
      // so it has to reflect whichever row's branch_stock actually gained
      // the quantity, not necessarily the row the operator picked.
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
            VALUES (@productId, @productName, @branchId, @branchName, 'transfer_in', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
      params: { productId: destProductId, productName: destProductName, branchId: toBranchId, branchName: toBranch?.name || null, quantity, reason: `Transfer in from ${fromBranch?.name || 'source'}${note ? ` - ${note}` : ''}${mergeTarget ? ` (merged from "${product.name}" #${productId})` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
    },
  ]
  // Track A/C audit (part 53) found this was missing: when the transfer
  // crosses a merge (destProductId !== productId), branch_stock's total for
  // *productId* actually decreases and *destProductId*'s actually increases
  // -- unlike a same-product branch-to-branch move, which is zero-sum for
  // the product's own total and needs no update here. Every other writer of
  // branch_stock (products.ts, returns.ts, inventory.ts, stock-integrity/
  // repair) recomputes/adjusts products.stock_quantity in the same batch;
  // this route never did for the merge case, so a merged transfer left both
  // products' denormalized stock_quantity stale -- wrong on the low-stock
  // notification (notifications.ts reads stock_quantity directly), the
  // Dashboard/Inventory stat tiles (getFamilyStockStats' global qtyExpr is
  // also `p.stock_quantity`), and POS's stock badge, until someone happened
  // to run the unrelated stock-integrity/repair tool.
  if (mergeTarget) {
    statements.push(
      { sql: 'UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @productId', params: { quantity, productId } },
      { sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @destProductId', params: { quantity, destProductId } },
    )
  }
  if (sourceBatch && destBatchId != null) {
    statements.push(
      decrementBatchStockStatement(sourceBatch.id, fromBranchId, quantity),
      incrementBatchStockStatement(destBatchId, toBranchId, quantity),
    )
  }

  await db.batch(statements)

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'transfer', 'stock', productId, { productName: product.name, quantity, fromBranchId, toBranchId, mergedIntoProductId: mergeTarget?.id ?? null, batchId: sourceBatch?.id ?? null, destBatchId })
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'transfer' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id: productId }))
  if (mergeTarget) c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update', id: destProductId }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json(mergeTarget ? { mergedIntoProductId: destProductId, mergedIntoProductName: destProductName, destBatchId } : { destBatchId })
})

// POST /api/branches/transfer-bulk -- same product-quantity move as
// POST /transfer above, but for many products from one source branch to
// one destination branch in a single request (multi-select branch-page
// transfer picker). Every item is matched by an existing product_id
// (there's no free-text/name-collision case here -- both sides are
// already definite product rows); the destination-side identity-merge
// resolution below is what "into group if name is same, new child row if
// details differ, add qty if everything matches" actually means for that
// case, same as /transfer.
//
// All-or-nothing: every item is validated against current stock *before*
// any write happens, then every write for every item goes into one
// db.batch() call -- D1's batch() is a real atomic transaction (see
// db.ts's batch() comment), so either the whole transfer lands or none of
// it does. No partial transfers on a mid-batch failure.
//
// Same destination-side merge resolution as the single-item /transfer
// route above (findIdentityMatches -- batched counterpart of
// findIdentityMatch, one query for every selected product instead of N):
// any item whose product is an exact identity match (name_key, cost,
// price, barcode) for some other product elsewhere in the catalog has its
// destination-side branch_stock, transfer_in movement, and stock_transfers
// note redirected to that other product, same as the single-item case.
// The source side is never redirected, for the same reason as /transfer.
//
// Batch-aware, same as /transfer: an item can optionally carry a batchId,
// and its branch_batch_stock moves alongside branch_stock -- same batch
// when the destination product isn't redirected, resolved/cloned via
// resolveDestinationBatch when it is.
const MAX_BULK_TRANSFER_ITEMS = 200

app.post('/transfer-bulk', async (c) => {
  const user = c.get('user')
  const bulkTransferTier = getPermissionTier(user, 'branches')
  if (bulkTransferTier === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  // Same live-quantity-movement reasoning as stock-integrity/repair and
  // /transfer above -- deliberately blocked, not queued, for Review Required.
  if (bulkTransferTier === 'review') {
    return c.json({ error: 'Transferring stock requires Full Access to Branches -- Review Required support for this action is not built.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const fromBranchId = Number.parseInt(String(body.fromBranchId ?? ''), 10)
  const toBranchId = Number.parseInt(String(body.toBranchId ?? ''), 10)
  const note = body.note != null ? String(body.note).trim() || null : null
  const rawItems = Array.isArray(body.items) ? body.items : []

  if (!fromBranchId || !toBranchId) return c.json({ error: 'Missing required fields' }, 400)
  if (fromBranchId === toBranchId) return c.json({ error: 'Source and destination cannot be the same' }, 400)
  if (!rawItems.length) return c.json({ error: 'No products selected' }, 400)
  if (rawItems.length > MAX_BULK_TRANSFER_ITEMS) {
    return c.json({ error: `Too many products in one transfer (max ${MAX_BULK_TRANSFER_ITEMS}) -- split into more than one transfer` }, 400)
  }

  // Reject duplicate product entries outright rather than silently summing
  // or overwriting -- if the same product appears twice in one request
  // it's ambiguous which quantity was meant, so make the caller fix it.
  const seenProductIds = new Set<number>()
  const items: Array<{ productId: number; quantity: number; batchId: number | null }> = []
  for (const raw of rawItems) {
    const row = (raw ?? {}) as Record<string, unknown>
    const productId = Number.parseInt(String(row.productId ?? ''), 10)
    const quantity = Number(row.quantity)
    if (!productId || !Number.isFinite(quantity) || !(quantity > 0)) {
      return c.json({ error: 'Every selected product needs a valid quantity greater than zero' }, 400)
    }
    if (seenProductIds.has(productId)) {
      return c.json({ error: `Product ${productId} was selected more than once in the same transfer` }, 400)
    }
    seenProductIds.add(productId)
    const batchId = row.batchId != null && row.batchId !== '' ? Number.parseInt(String(row.batchId), 10) : null
    items.push({ productId, quantity, batchId })
  }

  const db = getDb(c.env)
  // A transfer can carry any number of lines, so both product lookups are
  // chunked to stay inside D1's 100-bound-parameter limit; @branchId is
  // reserved out of the stock query's budget.
  const productIds = items.map((item) => item.productId)

  const [products, stockRows, fromBranch, toBranch] = await Promise.all([
    selectInChunks(productIds, 0, (chunk) => {
      const { sql, params } = buildInClause('id', chunk)
      return db.prepare(`
        SELECT id, name, barcode, purchase_price_usd, purchase_price_khr, selling_price_usd, selling_price_khr
        FROM products WHERE id IN (${sql})
      `).all<ProductIdentityRow>(params)
    }),
    selectInChunks(productIds, 1, (chunk) => {
      const { sql, params } = buildInClause('id', chunk)
      return db.prepare(`SELECT product_id, quantity FROM branch_stock WHERE branch_id = @branchId AND product_id IN (${sql})`).all<{ product_id: number; quantity: number }>({ ...params, branchId: fromBranchId })
    }),
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: fromBranchId }),
    db.prepare('SELECT id, name FROM branches WHERE id = @id').get<{ id: number; name: string }>({ id: toBranchId }),
  ])

  const productById = new Map(products.map((product) => [product.id, product]))
  const stockByProductId = new Map(stockRows.map((row) => [row.product_id, Number(row.quantity) || 0]))

  const missing = items.filter((item) => !productById.has(item.productId))
  if (missing.length) {
    return c.json({ error: 'One or more selected products no longer exist', productIds: missing.map((item) => item.productId) }, 404)
  }

  const insufficient = items
    .map((item) => ({ ...item, available: stockByProductId.get(item.productId) || 0 }))
    .filter((item) => item.quantity > item.available)
  if (insufficient.length) {
    // The frontend's apiFetch only surfaces the top-level `error` string on
    // a thrown error (see createApiError in http.ts) -- the structured
    // `items` array below is kept for any future caller that wants it, but
    // the message itself has to be self-contained for the notify() the
    // transfer modal shows today.
    const detail = insufficient
      .map((item) => `${productById.get(item.productId)?.name || `#${item.productId}`} (need ${item.quantity}, have ${item.available})`)
      .join(', ')
    return c.json({
      error: `Insufficient stock for: ${detail}`,
      items: insufficient.map((item) => ({
        productId: item.productId,
        productName: productById.get(item.productId)?.name || null,
        requested: item.quantity,
        available: item.available,
      })),
    }, 400)
  }

  const mergeTargets = await findIdentityMatches(db, products)

  const batchItems = items.filter((item): item is typeof item & { batchId: number } => item.batchId != null)
  const batchById = new Map<number, { id: number; lot_code: string | null; expiry_date: string | null; notes: string | null }>()
  if (batchItems.length) {
    const batchIds = [...new Set(batchItems.map((item) => item.batchId))]
    const [batchRows, batchStockRows] = await Promise.all([
      selectInChunks(batchIds, 0, (chunk) => {
        const { sql, params } = buildInClause('bid', chunk)
        return db.prepare(`SELECT id, variant_product_id, lot_code, expiry_date, notes FROM product_batches WHERE id IN (${sql}) AND is_active = 1`)
          .all<{ id: number; variant_product_id: number; lot_code: string | null; expiry_date: string | null; notes: string | null }>(params)
      }),
      selectInChunks(batchIds, 1, (chunk) => {
        const { sql, params } = buildInClause('bid', chunk)
        return db.prepare(`SELECT batch_id, quantity FROM branch_batch_stock WHERE branch_id = @branchId AND batch_id IN (${sql})`)
          .all<{ batch_id: number; quantity: number }>({ ...params, branchId: fromBranchId })
      }),
    ])
    const batchRowById = new Map(batchRows.map((row) => [row.id, row]))
    const batchStockById = new Map(batchStockRows.map((row) => [row.batch_id, Number(row.quantity) || 0]))
    for (const item of batchItems) {
      const batchRow = batchRowById.get(item.batchId)
      if (!batchRow || batchRow.variant_product_id !== item.productId) {
        return c.json({ error: `Batch not found for product ${productById.get(item.productId)?.name || `#${item.productId}`}` }, 404)
      }
      const batchAvailable = batchStockById.get(item.batchId) || 0
      if (item.quantity > batchAvailable) {
        return c.json({ error: `Insufficient batch stock for ${productById.get(item.productId)?.name || `#${item.productId}`} (need ${item.quantity}, have ${batchAvailable})` }, 400)
      }
      batchById.set(item.batchId, { id: batchRow.id, lot_code: batchRow.lot_code, expiry_date: batchRow.expiry_date, notes: batchRow.notes })
    }
  }

  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  const merges: Array<{ productId: number; productName: string | null; mergedIntoProductId: number; mergedIntoProductName: string | null }> = []
  for (const item of items) {
    const product = productById.get(item.productId)!
    const mergeTarget = mergeTargets.get(item.productId)
    const destProductId = mergeTarget?.id ?? item.productId
    const destProductName = mergeTarget?.name ?? product.name
    const mergedNote = mergeTarget ? `Added to existing product "${destProductName}" (#${destProductId}) at ${toBranch?.name || 'destination'}` : null
    const combinedNote = [note, mergedNote].filter(Boolean).join(' -- ') || null
    if (mergeTarget) merges.push({ productId: item.productId, productName: product.name, mergedIntoProductId: destProductId, mergedIntoProductName: destProductName })

    statements.push(
      { sql: 'UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = @productId AND branch_id = @branchId', params: { quantity: item.quantity, productId: item.productId, branchId: fromBranchId } },
      {
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
        params: { productId: destProductId, branchId: toBranchId, quantity: item.quantity },
      },
      {
        sql: `INSERT INTO stock_transfers (product_id, product_name, from_branch_id, to_branch_id, quantity, notes, user_id, user_name, created_at)
              VALUES (@productId, @productName, @fromBranchId, @toBranchId, @quantity, @note, @userId, @userName, CURRENT_TIMESTAMP)`,
        params: { productId: item.productId, productName: product.name, fromBranchId, toBranchId, quantity: item.quantity, note: combinedNote, userId: user?.id ?? null, userName: user?.name ?? null },
      },
      {
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
              VALUES (@productId, @productName, @branchId, @branchName, 'transfer_out', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
        params: { productId: item.productId, productName: product.name, branchId: fromBranchId, branchName: fromBranch?.name || null, quantity: item.quantity, reason: `Transfer out to ${toBranch?.name || 'destination'}${note ? ` - ${note}` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
      },
      {
        // Recorded against destProductId, same as the single-item route --
        // this is a real per-product stock audit trail, so it has to
        // reflect whichever row's branch_stock actually gained the
        // quantity, not necessarily the row the operator selected.
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
              VALUES (@productId, @productName, @branchId, @branchName, 'transfer_in', @quantity, @reason, @userId, @userName, CURRENT_TIMESTAMP)`,
        params: { productId: destProductId, productName: destProductName, branchId: toBranchId, branchName: toBranch?.name || null, quantity: item.quantity, reason: `Transfer in from ${fromBranch?.name || 'source'}${note ? ` - ${note}` : ''}${mergeTarget ? ` (merged from "${product.name}" #${item.productId})` : ''}`, userId: user?.id ?? null, userName: user?.name ?? null },
      },
    )

    // Same fix as the single-item /transfer route above, applied per item:
    // a merge crossing item.productId -> destProductId is not zero-sum for
    // either product's own stock_quantity, so it needs its own explicit
    // update. This bulk route's per-item loop never had this -- found while
    // auditing this route against /transfer's contract/behavior for the
    // frontend<->backend payload-shape diff (progress.md), not from a
    // separate report, since the bug is identical and was easy to miss
    // here: unlike /transfer's single pair of statements, this loop pushes
    // per-item statements into one shared array across every item in the
    // request, so a merge-case fix has to be scoped to the right item
    // instead of just appended once at the end.
    if (mergeTarget) {
      statements.push(
        { sql: 'UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @productId', params: { quantity: item.quantity, productId: item.productId } },
        { sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @destProductId', params: { quantity: item.quantity, destProductId } },
      )
    }

    if (item.batchId != null) {
      const sourceBatch = batchById.get(item.batchId)!
      const destBatchId = mergeTarget ? await resolveDestinationBatch(db, sourceBatch, destProductId) : sourceBatch.id
      statements.push(
        decrementBatchStockStatement(sourceBatch.id, fromBranchId, item.quantity),
        incrementBatchStockStatement(destBatchId, toBranchId, item.quantity),
      )
    }
  }

  await db.batch(statements)

  await Promise.all(items.map((item) => audit(
    c.env,
    user?.id ?? null,
    user?.name ?? null,
    'transfer',
    'stock',
    item.productId,
    { productName: productById.get(item.productId)?.name, quantity: item.quantity, fromBranchId, toBranchId, bulk: true, mergedIntoProductId: mergeTargets.get(item.productId)?.id ?? null },
  )))

  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'transfer' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'update' }))
  return c.json({ success: true, transferredCount: items.length, merges })
})


// GET /api/branches/:id/stock -- was a stub: no pagination, no summary, no
// stockState filter, and it selected FROM branch_stock (so products with no
// row there at all never appeared) with a bare `quantity` column instead of
// `branch_quantity` -- the field name Branches.tsx actually reads. Because
// `product.branch_quantity` was always undefined, the "in stock" filter in
// the UI (`Number(product.branch_quantity || 0) > 0`) filtered out every
// row, and because the response was a bare array (no `.summary`), all of
// the branch stat tiles collapsed to 0 regardless of real stock. Ported
// from backend/src/routes/branches.ts's paged handler; also keeps the
// original's non-paged array response for any caller that doesn't send
// page/pageSize/stockState.
const PAGED_STOCK_QUERY_KEYS = ['page', 'pageSize', 'page_size', 'stockState', 'stock_state', 'query', 'q']

function normalizePositiveInt(value: unknown, fallback: number, { min = 1, max = 500 } = {}): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function buildBranchStockWhere(c: any, branchId: number, { includeStockState = true } = {}) {
  const where = ['p.is_active = 1']
  const params: Record<string, unknown> = { branchId }
  const query = String(c.req.query('query') || c.req.query('q') || '').trim().toLowerCase()
  if (query) {
    params.query = `%${query}%`
    where.push(`(
      lower(COALESCE(p.name, '')) LIKE @query
      OR lower(COALESCE(p.sku, '')) LIKE @query
      OR lower(COALESCE(p.barcode, '')) LIKE @query
      OR lower(COALESCE(p.brand, '')) LIKE @query
      OR lower(COALESCE(p.category, '')) LIKE @query
    )`)
  }
  const stockState = String(c.req.query('stockState') || c.req.query('stock_state') || 'positive').toLowerCase()
  if (includeStockState) {
    if (stockState === 'positive' || stockState === 'in_stock') where.push('COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)')
    // 'healthy' is the stricter subset of 'positive'/'in_stock' -- above the
    // low stock threshold, not just above zero/out threshold. See matching
    // comment in inventory.ts/products.ts.
    if (stockState === 'healthy') where.push('COALESCE(bs.quantity, 0) > COALESCE(p.low_stock_threshold, 10)')
    if (stockState === 'zero') where.push('COALESCE(bs.quantity, 0) = 0')
    if (stockState === 'low') where.push('COALESCE(bs.quantity, 0) > COALESCE(p.out_of_stock_threshold, 0) AND COALESCE(bs.quantity, 0) <= COALESCE(p.low_stock_threshold, 10)')
    if (stockState === 'out' || stockState === 'out_of_stock') where.push('COALESCE(bs.quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0)')
  }
  return { where, params, stockState }
}

app.get('/:id/stock', async (c) => {
  const id = c.req.param('id')
  const db = getDb(c.env)
  const wantsPaged = PAGED_STOCK_QUERY_KEYS.some((key) => c.req.query(key) !== undefined)

  if (!wantsPaged) {
    const rows = await db.prepare(`
      SELECT p.id, p.name, p.sku, p.unit, p.selling_price_usd, p.selling_price_khr,
             p.purchase_price_usd, p.purchase_price_khr, p.low_stock_threshold, p.out_of_stock_threshold,
             COALESCE(bs.quantity, 0) AS branch_quantity
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @id
      WHERE p.is_active = 1
      ORDER BY p.name
    `).all({ id })
    return c.json(rows || [])
  }

  const branchId = Number.parseInt(id, 10)
  const page = normalizePositiveInt(c.req.query('page'), 1, { min: 1, max: 100000 })
  const pageSize = normalizePositiveInt(c.req.query('pageSize') || c.req.query('page_size'), 20, { min: 1, max: 100 })
  const { where, params, stockState } = buildBranchStockWhere(c, branchId)
  const whereSql = `WHERE ${where.join(' AND ')}`
  const summaryWhere = buildBranchStockWhere(c, branchId, { includeStockState: false })
  const summaryWhereSql = `WHERE ${summaryWhere.where.join(' AND ')}`
  // INNER JOIN, not LEFT: a product only "belongs" to this branch's stats/
  // listing once it actually has a branch_stock row here (created by a
  // transfer, a stock adjustment, or the default-branch backfill). LEFT
  // JOIN previously matched every active catalog product against every
  // branch regardless of whether it had ever been stocked there, so a
  // brand-new branch with genuinely zero products showed total=out=(every
  // active product in the whole catalog) instead of 0 -- reported as
  // "Branch 2 has no products inside but shows the total of all branches".
  const branchStockJoinSql = 'JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId'

  // total_products/in_stock/low_stock/out_of_stock/total_value_usd are
  // family-aware (see familyStockStats.ts) so they agree with `total`
  // below (the family-grouped pagination count for this same branch's
  // stock listing) -- previously this was a flat COUNT(*)/SUM() over every
  // variant row, which overcounted vs. the listing whenever grouped
  // products existed. positive_products/positive_value_usd are a distinct
  // "has any stock at all" metric (no family-grouped equivalent shown
  // elsewhere to reconcile against) and stay row-based, unchanged.
  const [familyStats, positiveRow] = await Promise.all([
    getFamilyStockStats({
      db,
      joinSql: branchStockJoinSql,
      whereSql: summaryWhereSql,
      params: summaryWhere.params,
      qtyExpr: 'COALESCE(bs.quantity, 0)',
    }),
    db.prepare(`
      SELECT
        SUM(CASE WHEN COALESCE(bs.quantity, 0) > 0 THEN 1 ELSE 0 END) AS positive_products,
        COALESCE(SUM(CASE WHEN COALESCE(bs.quantity, 0) > 0 THEN COALESCE(bs.quantity, 0) * COALESCE(NULLIF(p.purchase_price_usd, 0), p.cost_price_usd, 0) ELSE 0 END), 0) AS positive_value_usd
      FROM products p
      LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
      ${summaryWhereSql}
    `).get(summaryWhere.params),
  ])
  const summary = {
    total_products: familyStats.total_products,
    in_stock_products: familyStats.in_stock,
    healthy_products: familyStats.healthy,
    low_stock_products: familyStats.low_stock,
    out_of_stock_products: familyStats.out_of_stock,
    positive_products: Number((positiveRow as Record<string, unknown>)?.positive_products || 0),
    positive_value_usd: Number((positiveRow as Record<string, unknown>)?.positive_value_usd || 0),
    total_value_usd: familyStats.stock_value_usd,
  }

  // Grouped products (parent_id families) are treated as a single unit for
  // paging here too, same rule and same helper as products.ts/inventory.ts.
  const { items, total, totalPages } = await paginateProductFamilies<Record<string, unknown>>({
    db,
    selectColumns: `p.id, p.name, p.sku, p.barcode, p.brand, p.category, p.unit, p.selling_price_usd, p.selling_price_khr,
           p.purchase_price_usd, p.purchase_price_khr, p.cost_price_usd, p.cost_price_khr,
           p.low_stock_threshold, p.out_of_stock_threshold,
           COALESCE(bs.quantity, 0) AS branch_quantity`,
    joinSql: branchStockJoinSql,
    whereSql,
    params,
    page,
    pageSize,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'lower(name) ASC, id ASC',
  })

  return c.json({
    items,
    total,
    page,
    pageSize,
    stockState,
    totalPages,
    summary: summary || {},
  })
})

app.post('/', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'branches') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const body = await c.req.json<BranchInput>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'Name required' }, 400)

  // Review Required tier: no live-state dependency (a straight insert with
  // an optional is_default reassignment), safe to queue and replay exactly
  // as-is later -- same reasoning as products.ts's create. maybeQueueForReview
  // is a no-op (returns null) for Full tier, so this doesn't change behavior
  // for anyone but a Review Required user.
  const pendingId = await maybeQueueForReview(c.env, user, 'branches', {
    actionType: 'create',
    entityType: 'branch',
    entityId: null,
    payload: body,
    summary: `Create branch "${name}"`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  const db = getDb(c.env)
  const defaultFlag = toDbBool(body.is_default, 0)
  const activeFlag = toDbBool(body.is_active, 1)

  // Matches the original's db.transaction(): if this branch is being set as
  // the new default, every other branch's is_default must clear first, in
  // the same atomic unit as the insert -- otherwise a request that fails
  // partway through could leave two branches both marked default.
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) {
    statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  }
  statements.push({
    sql: `INSERT INTO branches (name, location, phone, manager, notes, is_default, is_active, updated_at)
          VALUES (@name, @location, @phone, @manager, @notes, @is_default, @is_active, CURRENT_TIMESTAMP)`,
    params: {
      name,
      location: body.location || null,
      phone: body.phone || null,
      manager: body.manager || null,
      notes: body.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
    },
  })
  await db.batch(statements)

  const created = await db.prepare('SELECT id FROM branches WHERE name = ? ORDER BY id DESC LIMIT 1').get<{ id: number }>([name])
  if (created) {
    await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'branch', created.id, { name })
    // Real, confirmed gap: a brand-new branch previously got zero
    // branch_stock rows for the catalog that already existed -- only
    // products created AFTER this branch (via seedBranchStockForNewProduct
    // in lib/productWrites.ts) ever got one. Every existing product simply
    // had NO row for this branch_id at all, which any branch-scoped view
    // (POS's branch filter, Inventory's branch filter) reads as "doesn't
    // stock this branch" -- reported as "POS shows no products for this
    // branch even though the branch selector itself is populated
    // correctly." Seeding every active product at 0 here makes a new
    // branch start in the same state seedBranchStockForNewProduct already
    // gives a brand-new product: present, explicitly zero, adjustable from
    // there via a normal stock count/transfer -- not silently absent.
    c.executionCtx.waitUntil(
      db.prepare(
        `INSERT INTO branch_stock (product_id, branch_id, quantity)
         SELECT p.id, @branchId, 0 FROM products p
         WHERE p.is_active = 1
           AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = @branchId)`
      ).run({ branchId: created.id }).catch(() => {})
    )
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'create', id: created?.id ?? null }))
  return c.json({ id: created?.id ?? null })
})

app.put('/:id', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'branches') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = c.req.param('id')
  const body = await c.req.json<BranchInput & Record<string, unknown>>()
  const db = getDb(c.env)

  const current = await db.prepare('SELECT id, updated_at FROM branches WHERE id = ?').get<{ id: number; updated_at: string }>([id])
  try {
    assertUpdatedAtMatch('branch', current, getExpectedUpdatedAt(body))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }
  if (!current) return c.json({ error: 'Branch not found' }, 404)

  // Review Required tier: the conflict check above already confirmed the
  // request is against the current row, so queueing here is safe to
  // replay later exactly as-is -- same reasoning as the create path
  // above. Runs AFTER the conflict check (unlike products.ts's update,
  // which has no such check to run) so a stale edit is rejected up front
  // rather than queued and only discovered wrong at approval time.
  const pendingId = await maybeQueueForReview(c.env, user, 'branches', {
    actionType: 'update',
    entityType: 'branch',
    entityId: Number(id),
    payload: body,
    summary: `Update branch #${id}${body.name ? ` "${body.name}"` : ''}`,
  })
  if (pendingId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingId }, 202)
  }

  const defaultFlag = toDbBool(body.is_default, 0)
  const activeFlag = toDbBool(body.is_active, 1)
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  statements.push({
    sql: `UPDATE branches SET name=@name, location=@location, phone=@phone, manager=@manager, notes=@notes,
          is_default=@is_default, is_active=@is_active, updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
    params: {
      name: body.name,
      location: body.location || null,
      phone: body.phone || null,
      manager: body.manager || null,
      notes: body.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
      id,
    },
  })
  await db.batch(statements)

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'branch', id, { name: body.name })
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'update', id }))
  return c.json({})
})

app.delete('/:id', async (c) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'branches') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  const id = c.req.param('id')
  const db = getDb(c.env)

  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get<{ id: number; name: string; is_default: number; updated_at: string }>([id])
  if (!branch) return c.json({ error: 'Branch not found' }, 404)

  try {
    assertUpdatedAtMatch('branch', branch, getExpectedUpdatedAt(Object.fromEntries(new URL(c.req.url).searchParams)))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    throw error
  }
  if (branch.is_default) return c.json({ error: 'Cannot delete the default branch' }, 400)

  const stockCheck = await db.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE branch_id = ? AND quantity > 0').get<{ total: number | null }>([id])
  if (stockCheck && Number(stockCheck.total) > 0) {
    return c.json({ error: `Cannot delete branch - it still contains ${Math.round(Number(stockCheck.total))} unit(s) of stock. Transfer all stock to another branch first.` }, 400)
  }

  // Review Required tier: both safety checks above (not-default, no-stock)
  // already passed against the current row, so it's tempting to think this
  // is as safe to queue-and-replay-later as create/update -- it isn't,
  // because time can pass between queueing and a reviewer's approval and
  // either check could flip false in the meantime (someone makes this the
  // default branch, or stock gets transferred back into it). Unlike
  // stock-integrity/repair and transfer above (blocked outright), a delete
  // IS still queued here -- but its applier (lib/reviewApply.ts) re-runs
  // both checks itself against whatever the branch's state is AT APPROVAL
  // TIME, not the state captured when this was requested, and throws
  // (leaving the row 'open' rather than silently deleting something that
  // no longer qualifies) if either has changed. See that applier's own
  // comment for the exact re-check.
  const pendingDeleteId = await maybeQueueForReview(c.env, user, 'branches', {
    actionType: 'delete',
    entityType: 'branch',
    entityId: Number(id),
    payload: { id },
    summary: `Delete branch #${id} "${branch.name}"`,
  })
  if (pendingDeleteId != null) {
    return c.json({ success: true, pending: true, pendingActionId: pendingDeleteId }, 202)
  }

  await db.batch([
    { sql: 'DELETE FROM branch_stock WHERE branch_id = ?', params: [id] },
    { sql: 'DELETE FROM branches WHERE id = ?', params: [id] },
  ])
  await audit(c.env, user?.id ?? null, user?.name ?? null, 'delete', 'branch', id, { name: branch.name })
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'delete', id }))
  return c.json({})
})

export default app
