import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { getPermissionTier } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { buildLikeAliasClause, tokenizeSearchTermGroups } from '../lib/searchMatch'
import { receiveBatchStock, removeStockFromBatch, InsufficientBatchStockError } from '../lib/productBatches'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// Gates every returns endpoint (reads and writes alike) behind its own
// 'returns' permission, matching the frontend's own
// PAGE_PERMISSIONS.returns = 'returns' gate (see AppContext.tsx/
// navigationConfig.ts) and the same router-level pattern already used by
// inventory.ts/contacts.ts. This was previously shared with the 'sales'
// permission (same key gated both pages) -- split into its own key so
// Sales (Full/None only) and Returns (which will get a Review Required
// tier once that system is built) can be granted independently. Anyone
// who already had 'sales' before this split loses implicit Returns access
// and needs 'returns' granted explicitly; this is intentional now that the
// two are meant to diverge, not a regression.
//
// Part 154 fix: same class of bug found and fixed on inventory.ts in Part
// 153 -- this used the strict `hasPermission()` (=== true only), which
// 403'd a Review Required-tier user out of every returns route, including
// plain reads. Contradicts the spec's own "Review Required can add/view/
// search directly" for Returns. Switched to `getPermissionTier(...) !==
// 'none'`, same pattern as inventory.ts/products.ts.
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'returns') === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

// ---------------------------------------------------------------------------
// What's simplified vs. the original backend/src/routes/returns.ts (1152
// lines) -- read this before relying on edge cases:
//
// 1. Batch/lot-aware restock (closed -- was open, see history below). A
//    customer return whose item has a resolvable sale_item_id now restocks
//    into the *exact* batch that sale_item was originally sold from
//    (fetchSaleItemBatchInfo below joins sale_items.batch_id), via
//    lib/productBatches.ts's receiveBatchStock -- same helper
//    routes/inventory.ts's own /adjust uses for a manual add. The resolved
//    batch_id is stored on the return_items row itself (migration 0026) so
//    a later PATCH /:id edit can reverse the *same* batch instead of
//    guessing. Falls back to the old plain branch_stock bump only when no
//    batch can be resolved -- no sale_item_id (a manual/no-sale return), or
//    the sale predates the batch/lot system (sale_items.batch_id NULL,
//    same as sale_items.batch_id already being nullable for the same
//    reason). This does NOT implement the original backend's fuller
//    sale_item_batch_allocations/return_item_batch_allocations tables (a
//    sale line that itself FIFO-drained across *multiple* batches isn't
//    split back across all of them on return -- it restocks the single
//    batch sale_items.batch_id names) -- that finer-grained multi-batch
//    allocation is still not ported, only the common single-batch-per-line
//    case sales.ts's own POST / already produces.
// 2. No returnsListCache (the original's 5s in-memory Map cache for GET
//    /returns). A Worker isolate isn't guaranteed to live long enough for
//    that cache to pay for itself, and D1 reads are already fast; dropped
//    rather than porting a cache whose main job was easing load on a
//    long-running Node/better-sqlite3 process.
// 3. No recordActionHistory (undo/redo) calls -- that infrastructure has
//    still not been ported to any route in this Worker (grep cloudflare/src
//    confirms), so none is added here either, to avoid a route silently
//    depending on infrastructure that doesn't exist. broadcast() (WebSocket
//    push), however, *has* since been added to most other domains
//    (branches.ts, inventory.ts, products.ts, contacts.ts, promotions.ts,
//    settings.ts, users.ts, devices.ts, files.ts, importJobs.ts,
//    lookups.ts, portal.ts) -- this route was missed when that landed, so
//    a Dashboard/Products/Inventory/Sales page open on a different device
//    from the one processing a return wouldn't see it live. Added below on
//    the same channels those other domains already use for stock/product
//    changes ('inventory', 'products') plus a 'returns'/'sales' channel so
//    the Returns and Sales/Dashboard pages themselves refresh too.
// 4. Idempotency (client_request_id dedupe) is kept, since the returns
//    table already has the column and the original backend's
//    idempotency.ts is a two-line normalizer -- reproduced inline below
//    rather than pulled in as its own lib for two call sites.
// ---------------------------------------------------------------------------

function normalizeClientRequestId(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized
}

function normalizeScope(value: unknown, fallback: string = CUSTOMER_SCOPE): string {
  const scope = String(value || '').trim().toLowerCase()
  if (scope === 'all') return 'all'
  if (scope === SUPPLIER_SCOPE) return SUPPLIER_SCOPE
  if (scope === CUSTOMER_SCOPE) return CUSTOMER_SCOPE
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

type ReturnRow = Record<string, unknown> & {
  id: number
  sale_id: number | null
  return_number: string | null
  return_scope: string | null
  branch_id: number | null
  branch_name: string | null
  reason: string | null
  updated_at: string | null
}

type ReturnItemInput = {
  sale_item_id?: number
  product_id?: number
  product_name?: string
  quantity: number
  applied_price_usd?: number
  applied_price_khr?: number
  cost_price_usd?: number
  cost_price_khr?: number
  unit_cost_usd?: number
  unit_cost_khr?: number
  return_to_stock?: boolean
  branch_id?: number
}

// Looks up which batch/lot (if any) each of the given sale_item_ids was
// originally sold from -- customer returns reference a sale_item, never a
// batch directly (see the file-level note), so restoring the *specific*
// lot's quantity on a return requires this join back to sale_items every
// time, the same as a fresh create and a PATCH /:id re-apply both need it
// independently. Products import's cost_price backfill (lib/importEngine.
// ts's classifySales) uses the same "batch-fetch once, Map lookup per row"
// shape for the same reason: avoids one query per line item.
async function fetchSaleItemBatchInfo(
  db: ReturnType<typeof getDb>,
  saleItemIds: number[],
): Promise<Map<number, { batch_id: number | null; batch_label: string | null; batch_expiry_date: string | null }>> {
  const map = new Map<number, { batch_id: number | null; batch_label: string | null; batch_expiry_date: string | null }>()
  const ids = [...new Set(saleItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db
    .prepare(`SELECT id, batch_id, batch_label, batch_expiry_date FROM sale_items WHERE id IN (${placeholders})`)
    .all<{ id: number; batch_id: number | null; batch_label: string | null; batch_expiry_date: string | null }>(ids)
  for (const row of rows) map.set(row.id, { batch_id: row.batch_id ?? null, batch_label: row.batch_label ?? null, batch_expiry_date: row.batch_expiry_date ?? null })
  return map
}

// Validate requested return quantities against what's actually returnable
// (sold minus already-returned), mirroring assertReturnableItems in the
// original. `excludeReturnId` lets an update re-validate without double
// counting the return being edited against itself.
async function assertReturnableItems(
  db: ReturnType<typeof getDb>,
  saleId: number | null,
  items: ReturnItemInput[],
  excludeReturnId: number | null = null,
): Promise<void> {
  for (const item of items) {
    const qty = Number(item.quantity)
    if (!qty || qty <= 0) throw new Error('Return quantity must be greater than zero')
  }
  if (!saleId) return

  const sale = await db.prepare('SELECT id FROM sales WHERE id = ?').get<{ id: number }>([saleId])
  if (!sale) throw new Error('Original sale not found')

  for (const item of items) {
    const qty = Number(item.quantity) || 0

    if (item.sale_item_id) {
      const saleItem = await db.prepare('SELECT id, quantity, product_name FROM sale_items WHERE id = ? AND sale_id = ?').get<{ id: number; quantity: number; product_name: string | null }>([item.sale_item_id, saleId])
      if (!saleItem) throw new Error('Sale item not found for this return')

      const returnedRow = excludeReturnId
        ? await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get<{ qty: number }>([saleId, item.sale_item_id, excludeReturnId])
        : await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.sale_item_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get<{ qty: number }>([saleId, item.sale_item_id])
      const returned = returnedRow?.qty || 0
      const remaining = Math.max(0, (saleItem.quantity || 0) - returned)
      if (qty > remaining) throw new Error(`Cannot return ${qty} of ${saleItem.product_name || 'this item'} — only ${remaining} remaining`)
      continue
    }

    if (item.product_id) {
      const soldRow = await db.prepare('SELECT COALESCE(SUM(quantity), 0) AS qty FROM sale_items WHERE sale_id = ? AND product_id = ?').get<{ qty: number }>([saleId, item.product_id])
      const returnedRow = excludeReturnId
        ? await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
              AND r.id != ?
          `).get<{ qty: number }>([saleId, item.product_id, excludeReturnId])
        : await db.prepare(`
            SELECT COALESCE(SUM(ri.quantity), 0) AS qty
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            WHERE r.sale_id = ? AND ri.product_id = ?
              AND COALESCE(r.status, 'completed') != 'cancelled'
              AND COALESCE(r.return_scope, 'customer') = 'customer'
          `).get<{ qty: number }>([saleId, item.product_id])
      const remaining = Math.max(0, (soldRow?.qty || 0) - (returnedRow?.qty || 0))
      if (qty > remaining) throw new Error(`Cannot return ${qty} of this product — only ${remaining} remaining`)
    }
  }
}

// GET /api/returns
app.get('/', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const scope = normalizeScope(query.scope, CUSTOMER_SCOPE)
  const search = String(query.search || query.q || '').trim().toLowerCase()
  const typeValues = String(query.type || query.returnType || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v && v !== 'all')
  const includeItems = Boolean(query.saleId) || ['1', 'true', 'yes'].includes(String(query.includeItems || '').trim().toLowerCase())
  const limit = Math.min(1000, Math.max(1, Number.parseInt(String(query.limit || '500'), 10) || 500))

  const where: string[] = ['1=1']
  const params: Record<string, unknown> = { limit }
  if (query.startDate) { where.push('date(r.created_at) >= @startDate'); params.startDate = query.startDate }
  if (query.endDate) { where.push('date(r.created_at) <= @endDate'); params.endDate = query.endDate }
  if (query.saleId) { where.push('r.sale_id = @saleId'); params.saleId = query.saleId }
  if (scope !== 'all') { where.push(`COALESCE(r.return_scope, 'customer') = @scope`); params.scope = scope }
  if (typeValues.length === 1) {
    where.push(scope === SUPPLIER_SCOPE
      ? `lower(COALESCE(r.supplier_settlement, 'refund')) = @type`
      : `lower(COALESCE(r.return_type, 'manual')) = @type`)
    params.type = typeValues[0]
  } else if (typeValues.length > 1) {
    const typeExpr = scope === SUPPLIER_SCOPE
      ? `lower(COALESCE(r.supplier_settlement, 'refund'))`
      : `lower(COALESCE(r.return_type, 'manual'))`
    const keys = typeValues.map((value, index) => {
      const key = `type${index}`
      params[key] = value
      return `@${key}`
    })
    where.push(`${typeExpr} IN (${keys.join(', ')})`)
  }
  // Same comma-groups-of-words syntax as products/sales search
  // (tokenizeSearchTermGroups: comma splits GROUPS, space is ordinary
  // word-spacing within one) instead of the old flat "every space-split
  // word must match" version, plus two real coverage gaps closed: the
  // return's own numeric id (CAST to text -- SQLite's LIKE operator does
  // not reliably coerce an INTEGER-affinity column the way `=` does, so
  // this must be explicit rather than assumed to already work), and the
  // product the return is actually for (product_name was already on
  // return_items, but sku/barcode/brand live on products and were never
  // reachable from here at all -- joined in via return_items.product_id,
  // the same shape sales.ts's buildSalesSearchWhere uses for sale_items).
  // No searchMode UI toggle exists on the Returns page (see Products.tsx's
  // SearchModeToggle) so this defaults to 'AND', matching Products' own
  // default, but still reads an optional searchMode param for the same
  // forward-compatibility reason sales.ts's builder does.
  const searchGroups = tokenizeSearchTermGroups(search)
  if (searchGroups.length) {
    const searchMode = String(query.searchMode || query.search_mode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
    const flatColumns = [
      'r.return_number',
      "CAST(r.id AS TEXT)",
      'r.receipt_number',
      'r.cashier_name',
      'r.customer_name',
      'r.supplier_name',
      'r.reason',
      'r.notes',
      "COALESCE(r.return_type, '')",
      "COALESCE(r.supplier_settlement, '')",
    ]
    const itemColumns = [
      "COALESCE(rii.product_name, '')",
      "COALESCE(rip.sku, '')",
      "COALESCE(rip.barcode, '')",
      "COALESCE(rip.brand, '')",
    ]
    let groupIndex = 0
    const groupClauses = searchGroups.map((words) => {
      let wordIndex = 0
      const wordClauses = words.map((word) => {
        const keyBase = `rsrch${groupIndex}_${wordIndex}`
        wordIndex += 1
        const flatClause = buildLikeAliasClause(word, flatColumns, params, `${keyBase}_f`)
        const itemClause = buildLikeAliasClause(word, itemColumns, params, `${keyBase}_i`)
        return `(${flatClause} OR EXISTS (
          SELECT 1 FROM return_items rii
          LEFT JOIN products rip ON rip.id = rii.product_id
          WHERE rii.return_id = r.id AND ${itemClause}
        ))`
      })
      groupIndex += 1
      return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
    })
    const joiner = searchMode === 'OR' ? ' OR ' : ' AND '
    where.push(groupClauses.length > 1 ? groupClauses.map((c) => `(${c})`).join(joiner) : groupClauses[0])
  }

  const returns = await db.prepare(`
    SELECT r.* FROM returns r WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC LIMIT @limit
  `).all<ReturnRow>(params)

  if (!includeItems || returns.length === 0) return c.json(returns)

  const ids = returns.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const itemRows = await db.prepare(`SELECT * FROM return_items WHERE return_id IN (${placeholders}) ORDER BY return_id ASC, id ASC`).all<{ return_id: number; [key: string]: unknown }>(ids)
  const itemsByReturn = new Map<number, unknown[]>()
  for (const row of itemRows) {
    if (!itemsByReturn.has(row.return_id)) itemsByReturn.set(row.return_id, [])
    itemsByReturn.get(row.return_id)!.push(row)
  }
  return c.json(returns.map((r) => ({ ...r, items: itemsByReturn.get(r.id) || [] })))
})

// GET /api/returns/:id
app.get('/:id', async (c) => {
  const db = getDb(c.env)
  const id = c.req.param('id')
  const row = await db.prepare('SELECT * FROM returns WHERE id = ?').get<ReturnRow>([id])
  if (!row) return c.json({ error: 'Return not found' }, 404)
  const items = await db.prepare('SELECT * FROM return_items WHERE return_id = ?').all([id])
  return c.json({ ...row, items })
})

// POST /api/returns -- create a customer return, restocking branch_stock
// for any item with return_to_stock !== false, and rolling the parent
// sale's sale_status to 'partial_return' or 'returned' once everything
// sold on it has been accounted for.
app.post('/', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const body = await c.req.json<{
    items: ReturnItemInput[]
    sale_id?: number
    receipt_number?: string
    customer_id?: number
    customer_name?: string
    branch_id?: number
    reason?: string
    return_type?: string
    notes?: string
    total_refund_usd?: number
    total_refund_khr?: number
    exchange_rate?: number
    return_number?: string
    client_request_id?: string
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (!Array.isArray(body.items) || body.items.length === 0) return c.json({ error: 'Return items required' }, 400)
  if (!body.reason) return c.json({ error: 'Reason is required' }, 400)

  if (clientRequestId) {
    const existing = await db.prepare('SELECT id, return_number FROM returns WHERE client_request_id = ? LIMIT 1').get<{ id: number; return_number: string }>([clientRequestId])
    if (existing) return c.json({ id: existing.id, returnNumber: existing.return_number, duplicate: true })
  }

  try {
    await assertReturnableItems(db, body.sale_id || null, body.items)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }

  const returnNumber = body.return_number?.trim() || `RET-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  let saleMeta: { receipt_number?: string; customer_id?: number; customer_name?: string; branch_id?: number; branch_name?: string; exchange_rate?: number } = {}
  if (body.sale_id) {
    const sale = await db.prepare('SELECT receipt_number, customer_id, customer_name, branch_id, branch_name, exchange_rate FROM sales WHERE id = ?').get<typeof saleMeta>([body.sale_id])
    if (sale) saleMeta = sale
  }
  const branchId = body.branch_id || saleMeta.branch_id || null
  const branchName = branchId
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([branchId]))?.name || saleMeta.branch_name || null
    : saleMeta.branch_name || null

  const productIds = [...new Set(body.items.map((i) => Number(i.product_id)).filter((id) => Number.isFinite(id) && id > 0))]
  const productMap = new Map<number, { id: number; name: string; cost_price_usd: number; cost_price_khr: number }>()
  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT id, name, cost_price_usd, cost_price_khr FROM products WHERE id IN (${placeholders})`).all<typeof productMap extends Map<number, infer V> ? V : never>(productIds)
    for (const row of rows) productMap.set(row.id, row)
  }

  // Insert the return header first (mirrors sales.ts's POST / -- a single
  // statement can't share a D1 batch() with the item/stock writes below
  // since we need its lastInsertRowid first; see lib/db.ts).
  const returnInsert = await db.prepare(`
    INSERT INTO returns (
      return_number, client_request_id, sale_id, receipt_number, cashier_id, cashier_name,
      customer_id, customer_name, branch_id, branch_name, return_scope, reason, return_type,
      notes, total_refund_usd, total_refund_khr, exchange_rate, status
    ) VALUES (@return_number, @client_request_id, @sale_id, @receipt_number, @cashier_id, @cashier_name,
      @customer_id, @customer_name, @branch_id, @branch_name, @return_scope, @reason, @return_type,
      @notes, @total_refund_usd, @total_refund_khr, @exchange_rate, 'completed')
  `).run({
    return_number: returnNumber,
    client_request_id: clientRequestId,
    sale_id: body.sale_id || null,
    receipt_number: body.receipt_number || saleMeta.receipt_number || null,
    cashier_id: user?.id ?? null,
    cashier_name: user?.name ?? null,
    customer_id: body.customer_id || saleMeta.customer_id || null,
    customer_name: body.customer_name || saleMeta.customer_name || null,
    branch_id: branchId,
    branch_name: branchName,
    return_scope: CUSTOMER_SCOPE,
    reason: body.reason,
    return_type: body.return_type || 'restock',
    notes: body.notes || null,
    total_refund_usd: body.total_refund_usd || 0,
    total_refund_khr: body.total_refund_khr || 0,
    exchange_rate: body.exchange_rate || saleMeta.exchange_rate || 4100,
  })
  const returnId = returnInsert.lastInsertRowid

  try {
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    const touchedProductIds = new Set<number>()

    // Resolve once, up front, which batch (if any) each returned line's
    // sale_item_id was originally sold from -- see fetchSaleItemBatchInfo's
    // own comment for why this is a batch-fetch-once/Map-lookup shape.
    const saleItemBatchInfo = await fetchSaleItemBatchInfo(
      db,
      body.items.map((i) => i.sale_item_id).filter((id): id is number => Number.isFinite(id) && Number(id) > 0),
    )

    // Insert-return-items statements share the outer db.batch() below, but
    // a batch-aware restock (receiveBatchStock) runs its own separate
    // atomic write -- same non-atomic-across-both-steps tradeoff
    // routes/inventory.ts's /adjust already accepts for the same helper.
    // Awaited inline per item, before the outer batch(), so the resolved
    // batch_id is known in time to store on each return_items row.
    for (const item of body.items) {
      const quantity = Number(item.quantity) || 0
      const totalUsd = (item.applied_price_usd || 0) * quantity
      const totalKhr = (item.applied_price_khr || 0) * quantity
      const returnToStock = item.return_to_stock !== false
      const itemBranchId = item.branch_id || branchId || null
      const productMeta = item.product_id ? productMap.get(item.product_id) : undefined
      const safeProductName = (item.product_name && item.product_name.trim()) || productMeta?.name || (item.product_id ? `product #${item.product_id}` : 'Product')
      let costUsd = item.cost_price_usd || 0
      let costKhr = item.cost_price_khr || 0
      if (!costUsd && productMeta) costUsd = productMeta.cost_price_usd || 0
      if (!costKhr && productMeta) costKhr = productMeta.cost_price_khr || 0

      let resolvedBatchId: number | null = null
      if (returnToStock && item.product_id && itemBranchId) {
        const originalBatchId = item.sale_item_id ? (saleItemBatchInfo.get(item.sale_item_id)?.batch_id ?? null) : null
        if (originalBatchId != null) {
          try {
            const received = await receiveBatchStock(db, {
              productId: item.product_id,
              branchId: itemBranchId,
              quantity,
              batchId: originalBatchId,
            })
            resolvedBatchId = received.batchId
          } catch (_err) {
            // The exact batch this item was sold from no longer belongs to
            // this product (rare -- e.g. a merge-duplicates run since the
            // sale). Fall through to the plain branch_stock bump below
            // rather than fail the whole return over a batch-ledger
            // nicety.
            resolvedBatchId = null
          }
        }
        if (resolvedBatchId == null) {
          statements.push({
            sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
                  ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
            params: { product_id: item.product_id, branch_id: itemBranchId, quantity },
          })
        }
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
                VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
          params: {
            product_id: item.product_id,
            product_name: safeProductName,
            branch_id: itemBranchId,
            quantity,
            unit_cost_usd: costUsd,
            unit_cost_khr: costKhr,
            reason: `Return: ${body.reason}`,
            reference_id: returnId,
            user_id: user?.id ?? null,
            user_name: user?.name ?? null,
          },
        })
        touchedProductIds.add(item.product_id)
      }

      statements.push({
        sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, branch_id, batch_id)
              VALUES (@return_id, @sale_item_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @return_to_stock, @branch_id, @batch_id)`,
        params: {
          return_id: returnId,
          sale_item_id: item.sale_item_id || null,
          product_id: item.product_id || null,
          product_name: safeProductName,
          quantity,
          applied_price_usd: item.applied_price_usd || 0,
          applied_price_khr: item.applied_price_khr || 0,
          cost_price_usd: costUsd,
          cost_price_khr: costKhr,
          total_usd: totalUsd,
          total_khr: totalKhr,
          return_to_stock: returnToStock ? 1 : 0,
          branch_id: itemBranchId,
          batch_id: resolvedBatchId,
        },
      })
    }

    // receiveBatchStock already keeps branch_stock/products.stock_quantity
    // in lockstep for the batch-resolved items above -- only re-derive the
    // aggregate here for products that took the plain-bump fallback path.
    for (const productId of touchedProductIds) {
      statements.push({
        sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
        params: { productId },
      })
    }

    await db.batch(statements)

    if (body.sale_id) {
      const saleItems = await db.prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?').all<{ product_id: number; quantity: number }>([body.sale_id])
      const returnedRows = await db.prepare(`
        SELECT ri.product_id, SUM(ri.quantity) AS total_qty
        FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE r.sale_id = ? AND COALESCE(r.status, 'completed') != 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
        GROUP BY ri.product_id
      `).all<{ product_id: number; total_qty: number }>([body.sale_id])
      const returnedMap = new Map(returnedRows.map((r) => [r.product_id, r.total_qty]))
      const fullyReturned = saleItems.every((si) => (returnedMap.get(si.product_id) || 0) >= si.quantity)
      await db.prepare("UPDATE sales SET sale_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run([fullyReturned ? 'returned' : 'partial_return', body.sale_id])
    }
  } catch (error) {
    await db.prepare('DELETE FROM returns WHERE id = ?').run([returnId])
    return c.json({ error: `Failed to record return items: ${(error as Error).message}` }, 500)
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'return', returnId, { returnNumber, saleId: body.sale_id || null, reason: body.reason })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: body.sale_id || null }))
  return c.json({ id: returnId, returnNumber })
})

// POST /api/returns/supplier -- "process" a supplier return: pull stock out
// (it's leaving via the supplier, not going back on the shelf) and record
// how the supplier is settling it (refund / credit / replacement / writeoff),
// tracking any shortfall as supplier_loss_usd/khr.
app.post('/supplier', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const body = await c.req.json<{
    items: Array<{ product_id: number; product_name?: string; quantity: number; cost_price_usd?: number; cost_price_khr?: number; unit_cost_usd?: number; unit_cost_khr?: number; branch_id?: number }>
    branch_id?: number
    reason?: string
    notes?: string
    supplier_id?: number
    supplier_name?: string
    settlement?: string
    supplier_compensation_usd?: number
    supplier_compensation_khr?: number
    exchange_rate?: number
    return_number?: string
    client_request_id?: string
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (!Array.isArray(body.items) || body.items.length === 0) return c.json({ error: 'Return items required' }, 400)
  if (!body.reason) return c.json({ error: 'Reason is required' }, 400)

  if (clientRequestId) {
    const existing = await db.prepare('SELECT id, return_number FROM returns WHERE client_request_id = ? LIMIT 1').get<{ id: number; return_number: string }>([clientRequestId])
    if (existing) return c.json({ id: existing.id, returnNumber: existing.return_number, duplicate: true })
  }

  const settlement = ['refund', 'credit', 'replacement', 'writeoff'].includes(String(body.settlement || '').toLowerCase())
    ? String(body.settlement).toLowerCase()
    : 'refund'

  // Stock check first (plain read, before any writes -- same shape as
  // sales.ts's POST /).
  for (const item of body.items) {
    const qty = toNumber(item.quantity, 0)
    if (!qty || qty <= 0) return c.json({ error: 'Return quantity must be greater than zero' }, 400)
    if (!item.product_id) return c.json({ error: 'Product is required for supplier return' }, 400)
    const branchId = item.branch_id || body.branch_id || null
    if (!branchId) return c.json({ error: 'Branch is required for supplier return' }, 400)
    const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get<{ quantity: number }>([item.product_id, branchId])
    const available = stockRow?.quantity || 0
    if (qty > available) {
      return c.json({ error: `Insufficient stock for ${item.product_name || `product #${item.product_id}`} in selected branch: requested ${qty}, available ${available}` }, 409)
    }
  }

  let totalCostUsd = 0
  let totalCostKhr = 0
  for (const item of body.items) {
    const qty = toNumber(item.quantity, 0)
    totalCostUsd += qty * toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
    totalCostKhr += qty * toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
  }
  const defaultCompensationUsd = ['refund', 'credit'].includes(settlement) ? totalCostUsd : 0
  const defaultCompensationKhr = ['refund', 'credit'].includes(settlement) ? totalCostKhr : 0
  const supplierCompensationUsd = toNumber(body.supplier_compensation_usd, defaultCompensationUsd)
  const supplierCompensationKhr = toNumber(body.supplier_compensation_khr, defaultCompensationKhr)
  const supplierLossUsd = Math.max(0, Number((totalCostUsd - supplierCompensationUsd).toFixed(2)))
  const supplierLossKhr = Math.max(0, Math.round(totalCostKhr - supplierCompensationKhr))

  const returnNumber = body.return_number?.trim() || `SRET-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const branchName = body.branch_id
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null
    : null

  const returnInsert = await db.prepare(`
    INSERT INTO returns (
      return_number, client_request_id, cashier_id, cashier_name, branch_id, branch_name,
      return_scope, reason, return_type, notes, total_refund_usd, total_refund_khr, exchange_rate,
      supplier_id, supplier_name, supplier_settlement, supplier_compensation_usd, supplier_compensation_khr,
      supplier_loss_usd, supplier_loss_khr, status
    ) VALUES (@return_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
      @return_scope, @reason, 'supplier_return', @notes, 0, 0, @exchange_rate,
      @supplier_id, @supplier_name, @settlement, @supplier_compensation_usd, @supplier_compensation_khr,
      @supplier_loss_usd, @supplier_loss_khr, 'completed')
  `).run({
    return_number: returnNumber,
    client_request_id: clientRequestId,
    cashier_id: user?.id ?? null,
    cashier_name: user?.name ?? null,
    branch_id: body.branch_id || null,
    branch_name: branchName,
    return_scope: SUPPLIER_SCOPE,
    reason: body.reason,
    notes: body.notes || null,
    exchange_rate: body.exchange_rate || 4100,
    supplier_id: body.supplier_id || null,
    supplier_name: body.supplier_name || null,
    settlement,
    supplier_compensation_usd: supplierCompensationUsd,
    supplier_compensation_khr: supplierCompensationKhr,
    supplier_loss_usd: supplierLossUsd,
    supplier_loss_khr: supplierLossKhr,
  })
  const returnId = returnInsert.lastInsertRowid

  const productIds = [...new Set(body.items.map((i) => Number(i.product_id)))]
  const productNameMap = new Map<number, string>()
  if (productIds.length) {
    const placeholders = productIds.map(() => '?').join(',')
    const rows = await db.prepare(`SELECT id, name FROM products WHERE id IN (${placeholders})`).all<{ id: number; name: string }>(productIds)
    for (const row of rows) productNameMap.set(row.id, row.name)
  }

  try {
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    const touchedProductIds = new Set<number>()
    for (const item of body.items) {
      const qty = toNumber(item.quantity, 0)
      const unitCostUsd = toNumber(item.cost_price_usd ?? item.unit_cost_usd, 0)
      const unitCostKhr = toNumber(item.cost_price_khr ?? item.unit_cost_khr, 0)
      const totalUsd = Number((qty * unitCostUsd).toFixed(2))
      const totalKhr = Math.round(qty * unitCostKhr)
      const itemBranchId = item.branch_id || body.branch_id || null
      const safeProductName = item.product_name?.trim() || productNameMap.get(Number(item.product_id)) || `product #${item.product_id}`

      statements.push({
        sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, branch_id)
              VALUES (@return_id, NULL, @product_id, @product_name, @quantity, @unit_cost_usd, @unit_cost_khr, @unit_cost_usd, @unit_cost_khr, @total_usd, @total_khr, 0, @branch_id)`,
        params: {
          return_id: returnId,
          product_id: item.product_id,
          product_name: safeProductName,
          quantity: qty,
          unit_cost_usd: unitCostUsd,
          unit_cost_khr: unitCostKhr,
          total_usd: totalUsd,
          total_khr: totalKhr,
          branch_id: itemBranchId,
        },
      })
      // Supplier returns leave the branch entirely -- deduct, don't restore.
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, branch_stock.quantity - @quantity)`,
        params: { product_id: item.product_id, branch_id: itemBranchId, quantity: qty },
      })
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
              VALUES (@product_id, @product_name, @branch_id, 'supplier_return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
        params: {
          product_id: item.product_id,
          product_name: safeProductName,
          branch_id: itemBranchId,
          quantity: -qty,
          unit_cost_usd: unitCostUsd,
          unit_cost_khr: unitCostKhr,
          reason: `Supplier return (${settlement}): ${body.reason}`,
          reference_id: returnId,
          user_id: user?.id ?? null,
          user_name: user?.name ?? null,
        },
      })
      if (item.product_id) touchedProductIds.add(item.product_id)
    }
    for (const productId of touchedProductIds) {
      statements.push({
        sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
        params: { productId },
      })
    }
    await db.batch(statements)
  } catch (error) {
    await db.prepare('DELETE FROM returns WHERE id = ?').run([returnId])
    return c.json({ error: `Failed to record supplier return items: ${(error as Error).message}` }, 500)
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'create', 'supplier_return', returnId, { returnNumber, settlement, supplierName: body.supplier_name || null, supplierLossUsd })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'supplier_return', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: returnId }))
  return c.json({ id: returnId, returnNumber })
})

// PATCH /api/returns/:id -- edit a customer return's items/reason/notes.
// Reverses the previous restock (deduct what it added back), re-validates
// against current sale quantities, replaces the return_items rows, and
// re-applies stock for the new item list. Supplier returns aren't editable
// from this route (matches the original).
app.patch('/:id', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  const id = c.req.param('id')
  // Part 154: editing a return reverses every previously-restocked item's
  // batch, then re-applies restocking with fresh batch resolution --
  // same live-state dependency (a batch's current available quantity,
  // which can move between when a Review Required user submits an edit
  // and when a reviewer approves it) that kept inventory.ts's /adjust,
  // /transfer, /move-row explicitly unwired in Part 153, and the spec's
  // own "Review Required can add/view/search directly; delete goes to
  // review" for Returns never actually lists edit as allowed. Blocked
  // outright for Review Required rather than assumed-safe or silently
  // left open now that the router-wide gate above admits review-tier
  // users at all.
  if (getPermissionTier(user, 'returns') === 'review') {
    return c.json({ error: 'Editing a return requires Full Access to Returns -- Review Required support for this action is not built yet.' }, 403)
  }
  const body = await c.req.json<{
    items?: ReturnItemInput[]
    reason?: string
    return_type?: string
    notes?: string
    total_refund_usd?: number
    total_refund_khr?: number
    branch_id?: number
    [key: string]: unknown
  }>().catch(() => ({} as Record<string, unknown>))

  const existing = await db.prepare('SELECT * FROM returns WHERE id = ?').get<ReturnRow>([id])
  if (!existing) return c.json({ error: 'Return not found' }, 404)
  if (normalizeScope(existing.return_scope, CUSTOMER_SCOPE) !== CUSTOMER_SCOPE) {
    return c.json({ error: 'Supplier returns cannot be edited from this form yet.' }, 400)
  }

  const existingItems = await db.prepare('SELECT * FROM return_items WHERE return_id = ?').all<{
    id: number; product_id: number | null; product_name: string | null; quantity: number
    return_to_stock: number; branch_id: number | null; cost_price_usd: number | null; cost_price_khr: number | null
    batch_id: number | null
  }>([id])
  const newItems: ReturnItemInput[] = Array.isArray(body.items) ? body.items : existingItems

  try {
    assertUpdatedAtMatch('return', existing, getExpectedUpdatedAt(body))
    await assertReturnableItems(db, existing.sale_id, newItems, Number(id))
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body: conflictBody, status } = writeConflictResponse(error)
      return c.json(conflictBody, status)
    }
    return c.json({ error: (error as Error).message }, 400)
  }

  const branchName = body.branch_id
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null
    : existing.branch_name

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
  const touchedProductIds = new Set<number>()

  // Reverse the stock effect of every existing item that had been
  // restocked. Batch-aware now: an item that recorded a batch_id (this
  // return originally restocked a specific lot, see migration 0026 /
  // POST /'s own comment) reverses out of that SAME batch via
  // removeStockFromBatch, instead of only ever touching the generic
  // branch_stock aggregate.
  for (const item of existingItems) {
    if (!item.return_to_stock || !item.product_id || !item.branch_id) continue
    touchedProductIds.add(item.product_id)
    let reversedViaBatch = false
    if (item.batch_id != null) {
      try {
        await removeStockFromBatch(db, {
          batchId: item.batch_id,
          productId: item.product_id,
          branchId: item.branch_id,
          quantity: item.quantity,
        })
        reversedViaBatch = true
      } catch (err) {
        // Batch no longer has enough to reverse out of (some of it was
        // sold/moved again since this return was created) or no longer
        // belongs to this product. removeStockFromBatch validates and
        // throws BEFORE writing anything (see its own source), so nothing
        // was left half-applied here -- safe to fall through to the plain
        // aggregate decrement below instead, same as an item with no
        // batch_id at all.
        reversedViaBatch = false
        void err
      }
    }
    if (!reversedViaBatch) {
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, branch_stock.quantity - @quantity)`,
        params: { product_id: item.product_id, branch_id: item.branch_id, quantity: item.quantity },
      })
    }
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
            VALUES (@product_id, @product_name, @branch_id, 'return_reversal', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
      params: {
        product_id: item.product_id,
        product_name: item.product_name,
        branch_id: item.branch_id,
        quantity: -item.quantity,
        unit_cost_usd: item.cost_price_usd || 0,
        unit_cost_khr: item.cost_price_khr || 0,
        reason: `Return #${existing.return_number} updated - reversing previous restock`,
        reference_id: id,
        user_id: user?.id ?? null,
        user_name: user?.name ?? null,
      },
    })
  }

  statements.push({ sql: 'DELETE FROM return_items WHERE return_id = @return_id', params: { return_id: id } })

  // Same batch resolution as POST / above: prefer the exact batch each
  // line's sale_item_id was sold from.
  const saleItemBatchInfoForEdit = await fetchSaleItemBatchInfo(
    db,
    newItems.map((i) => i.sale_item_id).filter((sid): sid is number => Number.isFinite(sid) && Number(sid) > 0),
  )

  let totalRefundUsd = 0
  let totalRefundKhr = 0
  for (const item of newItems) {
    const quantity = Number(item.quantity) || 0
    const totalUsd = (item.applied_price_usd || 0) * quantity
    const totalKhr = (item.applied_price_khr || 0) * quantity
    const returnToStock = item.return_to_stock !== false
    const itemBranchId = item.branch_id || existing.branch_id || null
    totalRefundUsd += totalUsd
    totalRefundKhr += totalKhr

    let resolvedBatchId: number | null = null
    if (returnToStock && item.product_id && itemBranchId) {
      const originalBatchId = item.sale_item_id ? (saleItemBatchInfoForEdit.get(item.sale_item_id)?.batch_id ?? null) : null
      if (originalBatchId != null) {
        try {
          const received = await receiveBatchStock(db, {
            productId: item.product_id,
            branchId: itemBranchId,
            quantity,
            batchId: originalBatchId,
          })
          resolvedBatchId = received.batchId
        } catch (_err) {
          resolvedBatchId = null
        }
      }
      if (resolvedBatchId == null) {
        statements.push({
          sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
          params: { product_id: item.product_id, branch_id: itemBranchId, quantity },
        })
      }
      touchedProductIds.add(item.product_id)
    }

    statements.push({
      sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, branch_id, batch_id)
            VALUES (@return_id, @sale_item_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @return_to_stock, @branch_id, @batch_id)`,
      params: {
        return_id: id,
        sale_item_id: item.sale_item_id || null,
        product_id: item.product_id || null,
        product_name: item.product_name || null,
        quantity,
        applied_price_usd: item.applied_price_usd || 0,
        applied_price_khr: item.applied_price_khr || 0,
        cost_price_usd: item.cost_price_usd || 0,
        cost_price_khr: item.cost_price_khr || 0,
        total_usd: totalUsd,
        total_khr: totalKhr,
        return_to_stock: returnToStock ? 1 : 0,
        branch_id: itemBranchId,
        batch_id: resolvedBatchId,
      },
    })

    if (returnToStock && item.product_id && itemBranchId) {
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name)
              VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name || null,
          branch_id: itemBranchId,
          quantity,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason: `Return #${existing.return_number} updated: ${body.reason || existing.reason}`,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: user?.name ?? null,
        },
      })
    }
  }

  for (const productId of touchedProductIds) {
    statements.push({
      sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
      params: { productId },
    })
  }

  statements.push({
    sql: `UPDATE returns SET reason=@reason, return_type=@return_type, notes=@notes,
          total_refund_usd=@total_refund_usd, total_refund_khr=@total_refund_khr,
          branch_id=@branch_id, branch_name=@branch_name, updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
    params: {
      reason: body.reason || existing.reason,
      return_type: body.return_type || existing.return_type,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      total_refund_usd: body.total_refund_usd !== undefined ? body.total_refund_usd : totalRefundUsd,
      total_refund_khr: body.total_refund_khr !== undefined ? body.total_refund_khr : totalRefundKhr,
      branch_id: body.branch_id || existing.branch_id,
      branch_name: branchName,
      id,
    },
  })

  await db.batch(statements)

  if (existing.sale_id) {
    const saleItems = await db.prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?').all<{ product_id: number; quantity: number }>([existing.sale_id])
    const returnedRows = await db.prepare(`
      SELECT ri.product_id, SUM(ri.quantity) AS total_qty
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.sale_id = ? AND COALESCE(r.status, 'completed') != 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
      GROUP BY ri.product_id
    `).all<{ product_id: number; total_qty: number }>([existing.sale_id])
    const returnedMap = new Map(returnedRows.map((r) => [r.product_id, r.total_qty]))
    const hasAny = returnedRows.length > 0
    const fullyReturned = saleItems.every((si) => (returnedMap.get(si.product_id) || 0) >= si.quantity)
    const newStatus = fullyReturned ? 'returned' : hasAny ? 'partial_return' : 'completed'
    await db.prepare("UPDATE sales SET sale_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run([newStatus, existing.sale_id])
  }

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'update', 'return', id, { reason: body.reason })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return_edit', id: Number(id) }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(bumpVersion(c.env, 'products'))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'update', id: Number(id) }))
  if (existing.sale_id) {
    c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: existing.sale_id }))
  }

  const updated = await db.prepare('SELECT id, updated_at FROM returns WHERE id = ?').get<{ id: number; updated_at: string }>([id])
  return c.json(updated || { id: Number(id) })
})

export default app
