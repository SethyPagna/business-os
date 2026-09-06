import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { selectInChunks } from '../lib/sqlBinding'
import { localDateAtOrAfter, localDateAtOrBefore, localDateExpr, localDateRangeClause } from '../lib/businessDateWindow'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { sendReturnTelegramEvent, sendTelegramEvent, formatSaleTelegramLines } from '../lib/telegram'
import { getPermissionTier, getActionTier } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { buildLikeAliasClause, tokenizeSearchTermGroups, normalizeSearchText } from '../lib/searchMatch'
import { receiveBatchStock, removeStockFromBatch, InsufficientBatchStockError, readFifoLotAvailabilityForCart, allocateAcrossLots, decrementBatchStockStatement, decrementBatchStockStrictStatement } from '../lib/productBatches'
import {
  normalizeStockAction, resolveRefundUnitPrice, planReturnLot, ReturnLotRequiredError,
  createDamagedLot, reverseDamagedLots, applyReplacementStock, listOpenDamagedLots,
  ConsumedDamagedStockError, DAMAGE_IN_MOVEMENT, DAMAGE_REVERSAL_MOVEMENT,
  REPLACEMENT_OUT_MOVEMENT,
} from '../lib/returnsStock'
import { uniqueBusinessDateTimeNumber } from '../lib/receiptNumber'
import { computeSaleTotals } from '../lib/saleTotals'
import { applyReturnBulkAction, notifyReturnBulkAction, ReturnBulkError } from '../lib/returnBulkAction'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'

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

// The tender a replacement sale defaults to when the client names none. A
// replacement is an ORDINARY sale -- the customer pays for it the ordinary
// way -- so its payment method is one of the shop's real methods, not a
// bespoke "Return Exchange" label standing in for money that never moved.
// (Rows written before this carry that old label and an amount_paid of only
// the price difference; lib/salesAnalytics.ts's collectedExpr keeps reading
// them correctly.)
const DEFAULT_REPLACEMENT_PAYMENT_METHOD = 'Cash'

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'
const RETURN_REASON_PRESETS_KEY = 'return_reason_presets'

type ReturnReasonPresets = {
  customer: string[]
  supplier: string[]
}

function normalizeReferenceName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function normalizeReasonList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const label = String(typeof entry === 'object' && entry !== null && 'label' in entry
      ? (entry as { label?: unknown }).label
      : entry ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
    const key = normalizeReferenceName(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(label)
  }
  return output
}

function normalizeReturnReasonPresets(value: unknown): ReturnReasonPresets {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { parsed = null }
  }
  if (Array.isArray(parsed)) {
    // Compatibility with the brief early shape where one customer list was
    // stored directly. The first explicit save rewrites it to the shared,
    // two-scope object without duplicating entries.
    return { customer: normalizeReasonList(parsed), supplier: [] }
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  return {
    customer: normalizeReasonList(record.customer),
    supplier: normalizeReasonList(record.supplier),
  }
}

async function loadReturnReasonPresets(env: Env): Promise<{ configured: boolean; presets: ReturnReasonPresets }> {
  const row = await getDb(env).prepare('SELECT value FROM settings WHERE key = @key').get<{ value: string }>({ key: RETURN_REASON_PRESETS_KEY })
  return { configured: !!row, presets: normalizeReturnReasonPresets(row?.value) }
}

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
  replacement_sale_id?: number | null
  replacement_receipt_number?: string | null
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
  // 11.13: 'none' | 'restock' | 'damaged'; absent falls back to the
  // return_to_stock boolean's historical meaning (see normalizeStockAction).
  stock_action?: string
  branch_id?: number
  // The lot the operator picked for this line's restock. Only sent when the
  // original sale line cannot say which lot the units came from (see
  // planReturnLot): a lot-tracked product with no answer either way is
  // refused rather than restocked onto unspecified stock.
  batch_id?: number
}

// Looks up which batch/lot (if any) each of the given sale_item_ids was
// originally sold from -- customer returns reference a sale_item, never a
// batch directly (see the file-level note), so restoring the *specific*
// lot's quantity on a return requires this join back to sale_items every
// time, the same as a fresh create and a PATCH /:id re-apply both need it
// independently. Products import's cost_price backfill (lib/importEngine.
// ts's classifySales) uses the same "batch-fetch once, Map lookup per row"
// shape for the same reason: avoids one query per line item.
// It reads the line's PRICE in the same pass: the refund a return pays is
// whatever the original sale charged for those units, and the only place
// that number lives is this row. Reading it here (rather than trusting the
// posted applied_price_*) is what makes the refund unspoofable by a stale or
// edited client payload, and immune to the product's price having moved
// since the sale.
type SaleLineInfo = {
  batch_id: number | null
  batch_label: string | null
  batch_expiry_date: string | null
  applied_price_usd: number | null
  applied_price_khr: number | null
}

async function fetchSaleItemBatchInfo(
  db: ReturnType<typeof getDb>,
  saleItemIds: number[],
): Promise<Map<number, SaleLineInfo>> {
  const map = new Map<number, SaleLineInfo>()
  const ids = [...new Set(saleItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  // Chunked for D1's 100-bound-parameter ceiling (see lib/sqlBinding.ts).
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT id, batch_id, batch_label, batch_expiry_date, applied_price_usd, applied_price_khr FROM sale_items WHERE id IN (${chunk.map(() => '?').join(',')})`)
    .all<{ id: number } & SaleLineInfo>(chunk))
  for (const row of rows) {
    map.set(row.id, {
      batch_id: row.batch_id ?? null,
      batch_label: row.batch_label ?? null,
      batch_expiry_date: row.batch_expiry_date ?? null,
      applied_price_usd: row.applied_price_usd ?? null,
      applied_price_khr: row.applied_price_khr ?? null,
    })
  }
  return map
}

// Z0: the lot(s) each sale line actually drew from, in draw order, with the
// units still OUT (quantity - released_quantity). A multi-lot line's
// sale_items.batch_id is NULL (no single lot), so a return of it must split
// the restock across these -- reverse order (last-drawn first), matching the
// cancel path in saleTransitions.ts. Empty for old sales / legacy-stock lines.
async function fetchSaleItemAllocations(
  db: ReturnType<typeof getDb>,
  saleItemIds: number[],
): Promise<Map<number, Array<{ batch_id: number; outstanding: number }>>> {
  const map = new Map<number, Array<{ batch_id: number; outstanding: number }>>()
  const ids = [...new Set(saleItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT sale_item_id, batch_id, quantity, released_quantity FROM sale_item_batch_allocations WHERE sale_item_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`)
    .all<{ sale_item_id: number; batch_id: number; quantity: number; released_quantity: number }>(chunk))
  for (const row of rows) {
    const outstanding = Math.max(0, (Number(row.quantity) || 0) - (Number(row.released_quantity) || 0))
    if (outstanding <= 0) continue
    const list = map.get(Number(row.sale_item_id)) || []
    list.push({ batch_id: Number(row.batch_id), outstanding })
    map.set(Number(row.sale_item_id), list)
  }
  return map
}

// The lot(s) a sellable restock actually put stock into, per return_item.
// return_items.batch_id holds only ONE lot, but a return of a multi-lot sale
// line restocks several -- recording the real split here (into the
// return_item_batch_allocations table that has existed unused since the
// original schema, mirroring sale_item_batch_allocations on the sale side) is
// what lets a later PATCH /:id reverse each EXACT lot instead of pulling the
// whole quantity out of one and drifting per-lot stock.
type ReturnBatchSplit = { batchId: number; branchId: number | null; quantity: number; saleItemId: number | null }

async function fetchReturnItemBatchAllocations(
  db: ReturnType<typeof getDb>,
  returnItemIds: number[],
): Promise<Map<number, Array<{ batch_id: number; branch_id: number | null; quantity: number }>>> {
  const map = new Map<number, Array<{ batch_id: number; branch_id: number | null; quantity: number }>>()
  const ids = [...new Set(returnItemIds)].filter((id) => Number.isFinite(id) && id > 0)
  if (!ids.length) return map
  const rows = await selectInChunks(ids, 0, (chunk) => db
    .prepare(`SELECT return_item_id, batch_id, branch_id, quantity FROM return_item_batch_allocations WHERE return_item_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id ASC`)
    .all<{ return_item_id: number; batch_id: number; branch_id: number | null; quantity: number }>(chunk))
  for (const row of rows) {
    const list = map.get(Number(row.return_item_id)) || []
    list.push({ batch_id: Number(row.batch_id), branch_id: row.branch_id ?? null, quantity: Number(row.quantity) || 0 })
    map.set(Number(row.return_item_id), list)
  }
  return map
}

// Records the per-lot restock split for a freshly-written set of return_items.
// Called AFTER the return_items rows are inserted (their ids don't exist
// before): every returned line inserts exactly one return_items row in body
// order, so fetching them back ordered by id lines them up 1:1 with
// perItemSplits. Refuses to write on any count mismatch rather than risk
// attributing a split to the wrong line.
async function recordReturnItemBatchAllocations(
  db: ReturnType<typeof getDb>,
  returnId: number | string,
  perItemSplits: ReturnBatchSplit[][],
): Promise<void> {
  if (!perItemSplits.some((splits) => splits.length > 0)) return
  const rows = await db.prepare('SELECT id FROM return_items WHERE return_id = ? ORDER BY id ASC').all<{ id: number }>([returnId])
  const returnItemIds = (rows || []).map((row) => Number(row.id))
  if (returnItemIds.length !== perItemSplits.length) return
  const inserts: Array<{ sql: string; params: Record<string, unknown> }> = []
  for (let index = 0; index < perItemSplits.length; index += 1) {
    for (const split of perItemSplits[index]) {
      if (!(split.quantity > 0) || !(split.batchId > 0)) continue
      inserts.push({
        sql: `INSERT INTO return_item_batch_allocations (return_item_id, sale_item_id, batch_id, branch_id, quantity)
              VALUES (@return_item_id, @sale_item_id, @batch_id, @branch_id, @quantity)`,
        params: {
          return_item_id: returnItemIds[index],
          sale_item_id: split.saleItemId ?? null,
          batch_id: split.batchId,
          branch_id: split.branchId ?? null,
          quantity: split.quantity,
        },
      })
    }
  }
  if (inserts.length) await db.batch(inserts)
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

  const sale = await db.prepare('SELECT id, sale_status FROM sales WHERE id = ?').get<{ id: number; sale_status: string | null }>([saleId])
  if (!sale) throw new Error('Original sale not found')
  // A cancelled sale's stock was already ADDED BACK by the cancellation
  // itself (routes/sales.ts PATCH /:id/status) -- recording a return on
  // top would restock the same units twice. Un-cancel first if the sale
  // is live again and genuinely has a return.
  if ((sale.sale_status || 'completed') === 'cancelled') {
    throw new Error('This sale is cancelled -- its stock was already added back when it was cancelled, so a return cannot be recorded against it.')
  }

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

// The Returns list shows one row per return, never its lines, so a damaged
// item was invisible there unless someone opened the return. This counts the
// return's damaged lines in the list read itself -- the list carries a flag,
// not a second round trip and not the whole item set. It matches
// lib/returnsStock.ts's normalizeStockAction: an explicit 'damaged' only.
const DAMAGED_ITEM_COUNT_SQL = `(
      SELECT COUNT(*) FROM return_items dri
      WHERE dri.return_id = r.id AND lower(COALESCE(dri.stock_action, '')) = 'damaged'
    ) AS damaged_item_count`

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
  if (query.startDate) { where.push(localDateAtOrAfter('r.created_at')); params.startDate = query.startDate }
  if (query.endDate) { where.push(localDateAtOrBefore('r.created_at')); params.endDate = query.endDate }
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
    // Same bounded SQL shape as Sales: one shallow concatenated haystack
    // per row context avoids repeating the full diacritic REPLACE chain
    // for every column/word, which exceeds D1's statement-size limit at
    // production scale. Catalog-side normalized fields retain folded
    // product-name and compact-brand matching without the query-time tree.
    // r.search_normalized (migration 0082) is the write-time diacritic-folded
    // form of the return's own text fields, PREPENDED to the unchanged raw
    // concatenation exactly as buildSalesSearchWhere does -- additive, so a
    // folded query matches folded storage while a row without a blob still
    // searches through the raw columns as before. See the migration comment.
    const flatHaystack = `(
      COALESCE(r.search_normalized, '') || ' ' ||
      COALESCE(r.return_number, '') || ' ' || CAST(r.id AS TEXT) || ' ' ||
      COALESCE(r.receipt_number, '') || ' ' || COALESCE(r.cashier_name, '') || ' ' ||
      COALESCE(r.customer_name, '') || ' ' || COALESCE(r.supplier_name, '') || ' ' ||
      COALESCE(r.reason, '') || ' ' || COALESCE(r.notes, '') || ' ' ||
      COALESCE(r.return_type, '') || ' ' || COALESCE(r.supplier_settlement, '')
    )`
    const itemHaystack = `(
      COALESCE(rii.product_name, '') || ' ' || COALESCE(rip.sku, '') || ' ' ||
      COALESCE(rip.barcode, '') || ' ' || COALESCE(rip.brand, '') || ' ' ||
      COALESCE(rip.name_normalized, '') || ' ' || COALESCE(rip.brand_compact, '')
    )`
    let groupIndex = 0
    const groupClauses = searchGroups.map((words) => {
      let wordIndex = 0
      const wordClauses = words.map((word) => {
        const keyBase = `rsrch${groupIndex}_${wordIndex}`
        wordIndex += 1
        const flatClause = buildLikeAliasClause(word, [flatHaystack], params, `${keyBase}_f`, true)
        const itemClause = buildLikeAliasClause(word, [itemHaystack], params, `${keyBase}_i`, true)
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
    SELECT r.*, replacement_sale.receipt_number AS replacement_receipt_number,
      ${DAMAGED_ITEM_COUNT_SQL}
    FROM returns r
    LEFT JOIN sales replacement_sale ON replacement_sale.id = r.replacement_sale_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC LIMIT @limit
  `).all<ReturnRow>(params)

  if (!includeItems || returns.length === 0) return c.json(returns)

  const ids = returns.map((r) => r.id)
  const itemRows = await selectInChunks(ids, 0, (chunk) => db.prepare(`SELECT * FROM return_items WHERE return_id IN (${chunk.map(() => '?').join(',')}) ORDER BY return_id ASC, id ASC`).all<{ return_id: number; [key: string]: unknown }>(chunk))
  const itemsByReturn = new Map<number, unknown[]>()
  for (const row of itemRows) {
    if (!itemsByReturn.has(row.return_id)) itemsByReturn.set(row.return_id, [])
    itemsByReturn.get(row.return_id)!.push(row)
  }
  const replacementRows = await selectInChunks(ids, 0, (chunk) => db.prepare(`SELECT * FROM return_replacement_items WHERE return_id IN (${chunk.map(() => '?').join(',')}) ORDER BY return_id ASC, id ASC`).all<{ return_id: number; [key: string]: unknown }>(chunk))
  const replacementsByReturn = new Map<number, unknown[]>()
  for (const row of replacementRows) {
    if (!replacementsByReturn.has(row.return_id)) replacementsByReturn.set(row.return_id, [])
    replacementsByReturn.get(row.return_id)!.push(row)
  }
  return c.json(returns.map((r) => ({ ...r, items: itemsByReturn.get(r.id) || [], replacement_items: replacementsByReturn.get(r.id) || [] })))
})

// GET /api/returns/damaged-lots?product_id=&branch_id= -- open damaged
// lots (quantity_remaining > 0) for one product. Registered before /:id
// so the param route doesn't swallow it. Carries no cost by design.
app.get('/damaged-lots', async (c) => {
  const db = getDb(c.env)
  const productId = Number(c.req.query('product_id'))
  if (!Number.isFinite(productId) || productId <= 0) return c.json({ error: 'product_id is required' }, 400)
  const branchIdRaw = Number(c.req.query('branch_id'))
  const lots = await listOpenDamagedLots(db, { productId, branchId: Number.isFinite(branchIdRaw) && branchIdRaw > 0 ? branchIdRaw : null })
  return c.json(lots)
})

// --- Receipt typeahead ------------------------------------------------------
// The new-return flow used to pull 500 sales to the browser and Array.find()
// the receipt out of them, so a receipt older than that window was simply
// "not found" and nothing ever listed the candidates. This is the server-side
// lookup behind the typeahead: matching receipts only, newest first, capped.
//
// Three number shapes have to match here:
//   - the current bare `YYYYMMDD-HHMMSS`, including a partial-digit type-ahead
//     ("2026090" or "0903-1430"),
//   - the legacy `NNNNNN@YYYY-MM-DD` numbers still in production history,
//   - and whatever the receipt lane's migration 0107 moves into
//     sales.legacy_receipt_number.
// The last of those may or may not exist when this Worker runs, so the column
// is probed once instead of being assumed: a build of this route that runs
// against a pre-0107 database must still answer, not 500 on "no such column".
const LEGACY_RECEIPT_COLUMN = 'legacy_receipt_number'
const LEGACY_COLUMN_RECHECK_MS = 60_000
let legacyReceiptColumnState: { present: boolean; checkedAt: number } | null = null

// Strip the separators the two formats use so a digits-only query
// ("202609031430") still matches "20260903-143000" and "123456@2026-09-03".
function receiptDigitsExpr(column: string): string {
  return `REPLACE(REPLACE(REPLACE(COALESCE(${column}, ''), '-', ''), '@', ''), ':', '')`
}

export async function salesHasLegacyReceiptColumn(db: ReturnType<typeof getDb>): Promise<boolean> {
  const now = Date.now()
  // A `true` never becomes false again (columns are not dropped here), so it
  // is cached for the isolate's life; a `false` is re-probed, because 0107 can
  // land while this isolate is still warm.
  if (legacyReceiptColumnState?.present) return true
  if (legacyReceiptColumnState && now - legacyReceiptColumnState.checkedAt < LEGACY_COLUMN_RECHECK_MS) return false
  try {
    const rows = await db.prepare('PRAGMA table_info("sales")').all<{ name?: string }>()
    const present = (Array.isArray(rows) ? rows : []).some((row) => String(row?.name || '') === LEGACY_RECEIPT_COLUMN)
    legacyReceiptColumnState = { present, checkedAt: now }
    return present
  } catch {
    // A probe failure must not take the lookup down with it -- answer without
    // the legacy column rather than 500.
    legacyReceiptColumnState = { present: false, checkedAt: now }
    return false
  }
}

// Exported for the pure test: builds exactly the SQL + bindings the route
// runs, so both column shapes can be exercised against a real database.
export function buildReceiptLookupQuery(input: { query: string; limit: number; hasLegacyColumn: boolean }): { sql: string; params: Record<string, unknown> } | null {
  const raw = String(input.query ?? '').trim()
  if (raw.length < 2) return null
  const digits = raw.replace(/\D+/g, '')
  const params: Record<string, unknown> = { like: `%${raw.toLowerCase()}%`, limit: input.limit }
  const clauses = [`lower(COALESCE(s.receipt_number, '')) LIKE @like`]
  if (digits.length >= 4) {
    params.digitsLike = `%${digits}%`
    clauses.push(`${receiptDigitsExpr('s.receipt_number')} LIKE @digitsLike`)
  }
  if (/^\d{1,15}$/.test(raw)) {
    params.saleId = Number(raw)
    clauses.push('s.id = @saleId')
  }
  if (input.hasLegacyColumn) {
    clauses.push(`lower(COALESCE(s.${LEGACY_RECEIPT_COLUMN}, '')) LIKE @like`)
    if (digits.length >= 4) clauses.push(`${receiptDigitsExpr(`s.${LEGACY_RECEIPT_COLUMN}`)} LIKE @digitsLike`)
  }
  const legacySelect = input.hasLegacyColumn ? `s.${LEGACY_RECEIPT_COLUMN}` : `NULL AS ${LEGACY_RECEIPT_COLUMN}`
  const sql = `
    SELECT s.id, s.receipt_number, ${legacySelect}, s.created_at, s.customer_name,
           s.branch_id, s.branch_name, s.total_usd, s.total_khr, s.sale_status
    FROM sales s
    WHERE COALESCE(s.sale_status, 'completed') <> 'cancelled'
      AND (${clauses.join(' OR ')})
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT @limit
  `
  return { sql, params }
}

export const RECEIPT_LOOKUP_MAX_ROWS = 20

// GET /api/returns/receipt-lookup?query=&limit= -- registered before /:id so
// the param route does not swallow it. Gated by the returns-permission
// middleware at the top of this file like every other route here: this is a
// staff lookup, never a customer-facing one.
app.get('/receipt-lookup', async (c) => {
  const db = getDb(c.env)
  const raw = String(c.req.query('query') || c.req.query('q') || '')
  const requested = Number.parseInt(String(c.req.query('limit') || RECEIPT_LOOKUP_MAX_ROWS), 10)
  const limit = Math.min(RECEIPT_LOOKUP_MAX_ROWS, Math.max(1, Number.isFinite(requested) ? requested : RECEIPT_LOOKUP_MAX_ROWS))
  const hasLegacyColumn = await salesHasLegacyReceiptColumn(db)
  const built = buildReceiptLookupQuery({ query: raw, limit, hasLegacyColumn })
  if (!built) return c.json([])
  const rows = await db.prepare(built.sql).all<Record<string, unknown>>(built.params)
  return c.json(Array.isArray(rows) ? rows : [])
})

// GET /api/returns/report?startDate&endDate&branchId -- customer-return
// (refund) totals over a range for the Reports hub: range totals, a per-day
// series, and reason/type breakdowns. Scoped to customer returns
// (return_scope='customer'), where total_refund_usd is the money refunded to
// customers; supplier returns carry compensation/loss instead and are not
// refunds. Cancelled returns are excluded, matching the sales report's
// hide-cancelled default. Registered before /:id so 'report' is not eaten by
// the id param route. Auto-gated by the returns-permission middleware above.
app.get('/report', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const startDate = String(query.startDate || '').slice(0, 10)
  const endDate = String(query.endDate || '').slice(0, 10)
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
    return c.json({ error: 'startDate/endDate must use YYYY-MM-DD' }, 400)
  }
  // scope=supplier reports return-to-supplier cases (compensation / business
  // loss) with the SAME response shape -- customer rows simply carry zero in
  // the supplier money columns and vice versa, so one reader serves both the
  // Reports hub (customer) and the Returns page's scope-aware stats strip.
  const scope = String(query.scope || 'customer') === 'supplier' ? 'supplier' : 'customer'
  const clauses = [
    `COALESCE(return_scope, 'customer') = @scope`,
    `COALESCE(status, 'completed') <> 'cancelled'`,
  ]
  const params: Record<string, unknown> = { scope }
  if (startDate) { clauses.push(localDateAtOrAfter('created_at')); params.startDate = startDate }
  if (endDate) { clauses.push(localDateAtOrBefore('created_at')); params.endDate = endDate }
  if (query.branchId) { clauses.push('branch_id = @branchId'); params.branchId = query.branchId }
  const where = clauses.join(' AND ')
  // Sum BOTH currencies (Part 553): refunds/compensation/loss can be recorded
  // in KHR, and a USD-only sum showed "$0.00" for real KHR returns (same class
  // of bug the fees report had). No conversion -- the UI shows "$X · Y៛".
  const moneySums = `ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd,
    ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS refund_khr,
    ROUND(COALESCE(SUM(supplier_compensation_usd), 0), 2) AS compensation_usd,
    ROUND(COALESCE(SUM(supplier_compensation_khr), 0), 0) AS compensation_khr,
    ROUND(COALESCE(SUM(supplier_loss_usd), 0), 2) AS loss_usd,
    ROUND(COALESCE(SUM(supplier_loss_khr), 0), 0) AS loss_khr`
  const [totals, days, byReason, byType] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where}`).get<Record<string, number>>(params),
    db.prepare(`SELECT ${localDateExpr('created_at')} AS date, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY ${localDateExpr('created_at')} ORDER BY ${localDateExpr('created_at')} DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT COALESCE(NULLIF(TRIM(reason), ''), '—') AS reason, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY COALESCE(NULLIF(TRIM(reason), ''), '—') ORDER BY refund_usd DESC, count DESC`).all<Record<string, unknown>>(params),
    db.prepare(`SELECT COALESCE(NULLIF(TRIM(return_type), ''), 'restock') AS return_type, COUNT(*) AS count, ${moneySums} FROM returns WHERE ${where} GROUP BY COALESCE(NULLIF(TRIM(return_type), ''), 'restock') ORDER BY count DESC`).all<Record<string, unknown>>(params),
  ])
  const money = (row: Record<string, unknown> | null | undefined) => ({
    refund_usd: Number(row?.refund_usd || 0),
    refund_khr: Number(row?.refund_khr || 0),
    compensation_usd: Number(row?.compensation_usd || 0),
    compensation_khr: Number(row?.compensation_khr || 0),
    loss_usd: Number(row?.loss_usd || 0),
    loss_khr: Number(row?.loss_khr || 0),
  })
  return c.json({
    startDate,
    endDate,
    scope,
    totals: { count: Number(totals?.count || 0), ...money(totals) },
    days: (days || []).map((d) => ({ date: String(d.date || ''), count: Number(d.count || 0), ...money(d) })),
    by_reason: (byReason || []).map((r) => ({ reason: String(r.reason || ''), count: Number(r.count || 0), ...money(r) })),
    by_type: (byType || []).map((r) => ({ return_type: String(r.return_type || ''), count: Number(r.count || 0), ...money(r) })),
  })
})

// One persisted source for both customer- and supplier-return presets. The
// frontend supplies translated fallbacks only while this row is absent; the
// first edit writes the complete two-scope object, so legacy hard-coded lists
// migrate without creating a second store or duplicate values.
app.get('/reason-presets', async (c) => {
  return c.json(await loadReturnReasonPresets(c.env))
})

app.post('/reason-presets', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'edit') !== 'full') {
    return c.json({ error: 'Full Access to Returns is required to edit saved reasons.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const presets = normalizeReturnReasonPresets(body.presets ?? body)
  await getDb(c.env).prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run({ key: RETURN_REASON_PRESETS_KEY, value: JSON.stringify(presets) })
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'return_reason_presets', null, {
    customerCount: presets.customer.length,
    supplierCount: presets.supplier.length,
  })
  c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'return_reason_presets_update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reason_presets_update' }))
  return c.json({ success: true, configured: true, presets })
})

app.get('/reasons/impact', async (c) => {
  const returnScope: keyof ReturnReasonPresets = normalizeScope(c.req.query('return_scope')) === SUPPLIER_SCOPE ? 'supplier' : 'customer'
  const from = String(c.req.query('from') || '').trim()
  const to = String(c.req.query('to') || '').trim()
  if (!from || !to) return c.json({ error: 'Source and target reasons are required' }, 400)
  const fromKey = normalizeReferenceName(from)
  const toKey = normalizeReferenceName(to)
  const db = getDb(c.env)
  const scopeExpr = "COALESCE(NULLIF(lower(trim(return_scope)), ''), 'customer')"
  const linkedRecords = Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM returns
    WHERE ${scopeExpr} = @returnScope AND lower(trim(COALESCE(reason, ''))) = @from
  `).get<{ n: number }>({ returnScope, from: fromKey }))?.n || 0)
  const targetRecords = Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM returns
    WHERE ${scopeExpr} = @returnScope AND lower(trim(COALESCE(reason, ''))) = @to
  `).get<{ n: number }>({ returnScope, to: toKey }))?.n || 0)
  const { presets } = await loadReturnReasonPresets(c.env)
  return c.json({
    from,
    to,
    return_scope: returnScope,
    configured: presets[returnScope].some((reason) => normalizeReferenceName(reason) === fromKey),
    target_exists: presets[returnScope].some((reason) => normalizeReferenceName(reason) === toKey) || targetRecords > 0,
    linked_records: linkedRecords,
    live_snapshots: { returns: linkedRecords },
    historical_snapshots_preserved: ['audit_logs', 'action history payloads', 'inventory movements'],
  })
})

app.post('/reasons/replace', async (c) => {
  const user = c.get('user')
  if (getActionTier(user, 'returns', 'edit') !== 'full') {
    return c.json({ error: 'Full Access to Returns is required to replace saved reasons.' }, 403)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const returnScope: keyof ReturnReasonPresets = normalizeScope(body.return_scope) === SUPPLIER_SCOPE ? 'supplier' : 'customer'
  const from = String(body.from || '').trim().replace(/\s+/g, ' ').slice(0, 160)
  const to = String(body.to || '').trim().replace(/\s+/g, ' ').slice(0, 160)
  const replaceScope = body.scope === 'linked' ? 'linked' : 'presets_only'
  if (!from || !to) return c.json({ error: 'Source and target reasons are required' }, 400)
  const fromKey = normalizeReferenceName(from)
  const suppliedPresets = body.presets === undefined
    ? (await loadReturnReasonPresets(c.env)).presets
    : normalizeReturnReasonPresets(body.presets)
  const nextList = normalizeReasonList(suppliedPresets[returnScope].map((reason) => (
    normalizeReferenceName(reason) === fromKey ? to : reason
  )))
  if (!nextList.some((reason) => normalizeReferenceName(reason) === normalizeReferenceName(to))) nextList.push(to)
  const nextPresets: ReturnReasonPresets = { ...suppliedPresets, [returnScope]: nextList }
  const db = getDb(c.env)
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    params: { key: RETURN_REASON_PRESETS_KEY, value: JSON.stringify(nextPresets) },
  }]
  if (replaceScope === 'linked') {
    statements.push({
      sql: `UPDATE returns SET reason = @to, updated_at = CURRENT_TIMESTAMP
            WHERE COALESCE(NULLIF(lower(trim(return_scope)), ''), 'customer') = @returnScope
              AND lower(trim(COALESCE(reason, ''))) = @from`,
      params: { to, returnScope, from: fromKey },
    })
  }
  const results = await db.batch(statements)
  const linkedChanged = replaceScope === 'linked' ? Number(results[1]?.meta?.changes || 0) : 0
  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'replace', 'return_reason', null, {
    from, to, returnScope, scope: replaceScope, linkedChanged,
  })
  await Promise.all([bumpVersion(c.env, 'settings'), bumpVersion(c.env, 'returns')])
  c.executionCtx.waitUntil(broadcast(c.env, 'settings', { action: 'return_reason_replace', returnScope, from, to }))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'reason_replace', returnScope, from, to }))
  return c.json({ success: true, configured: true, presets: nextPresets, scope: replaceScope, linkedChanged })
})

// Conditional grouped action: every selected row is revision checked, while
// only rows whose chosen field still equals `source` move to `target`.
// applyReturnBulkAction owns the atomic stock/snapshot/idempotency contract;
// this route only translates typed business failures to HTTP responses.
app.post('/bulk', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  try {
    const result = await applyReturnBulkAction(c.env, c.get('user'), body)
    c.executionCtx.waitUntil(notifyReturnBulkAction(c.env))
    return c.json(result)
  } catch (error) {
    if (error instanceof ReturnBulkError) return c.json({ error: error.message, code: error.statusCode === 409 ? 'write_conflict' : 'invalid_bulk_action' }, error.statusCode)
    throw error
  }
})

// GET /api/returns/:id
app.get('/:id', async (c) => {
  const db = getDb(c.env)
  const id = c.req.param('id')
  const row = await db.prepare(`
    SELECT r.*, replacement_sale.receipt_number AS replacement_receipt_number,
      ${DAMAGED_ITEM_COUNT_SQL}
    FROM returns r
    LEFT JOIN sales replacement_sale ON replacement_sale.id = r.replacement_sale_id
    WHERE r.id = ?
  `).get<ReturnRow>([id])
  if (!row) return c.json({ error: 'Return not found' }, 404)
  const items = await db.prepare('SELECT * FROM return_items WHERE return_id = ?').all([id])
  const replacementItems = await db.prepare('SELECT * FROM return_replacement_items WHERE return_id = ?').all([id])
  return c.json({ ...row, items, replacement_items: replacementItems })
})

// POST /api/returns -- create a customer return, restocking branch_stock
// for any item with return_to_stock !== false, and rolling the parent
// sale's sale_status to 'partial_return' or 'returned' once everything
// sold on it has been accounted for.
app.post('/', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  // Per-action override (Part 546): 'returns:add' switched off for this
  // role blocks creating returns even though the tier admits them.
  if (getActionTier(user, 'returns', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
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
    // Replacement sale lines. They can be any active catalog product; the
    // server records them both beside the return and on a linked sale receipt.
    replacement_items?: Array<{ product_id: number; product_name?: string; branch_id?: number; batch_id?: number; quantity: number; applied_price_usd?: number; applied_price_khr?: number }>
    // How the customer settles the replacement SALE. It is an ordinary sale,
    // so it takes an ordinary tender, not a bespoke "exchange" label.
    replacement_payment_method?: string
  }>()

  const clientRequestId = normalizeClientRequestId(body.client_request_id)
  if (!Array.isArray(body.items) || body.items.length === 0) return c.json({ error: 'Return items required' }, 400)
  if (!body.reason) return c.json({ error: 'Reason is required' }, 400)
  const replacementInputs = Array.isArray(body.replacement_items) ? body.replacement_items : []
  for (const rep of replacementInputs) {
    if (!rep?.product_id || !(Number(rep.quantity) > 0)) {
      return c.json({ error: 'Each replacement line needs a product and a positive quantity' }, 400)
    }
  }
  if (clientRequestId) {
    // Keep the idempotency door as the exact partial-index lookup shared by
    // supplier returns. Only after a duplicate is found do we load the optional
    // replacement receipt; putting the LEFT JOIN in this hot-path query made
    // the indexed predicate drift and broke the cross-route contract.
    const existing = await db.prepare("SELECT id, return_number FROM returns WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1").get<{ id: number; return_number: string }>([clientRequestId])
    if (existing) {
      const replacement = await db.prepare(`
        SELECT r.replacement_sale_id, replacement_sale.receipt_number AS replacement_receipt_number
        FROM returns r
        LEFT JOIN sales replacement_sale ON replacement_sale.id = r.replacement_sale_id
        WHERE r.id = ? LIMIT 1
      `).get<{ replacement_sale_id: number | null; replacement_receipt_number: string | null }>([existing.id])
      return c.json({
        id: existing.id,
        returnNumber: existing.return_number,
        replacementSaleId: replacement?.replacement_sale_id || null,
        replacementReceiptNumber: replacement?.replacement_receipt_number || null,
        duplicate: true,
      })
    }
  }

  try {
    await assertReturnableItems(db, body.sale_id || null, body.items)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }

  // RET-YYYYMMDD-HHMMSS (Phnom Penh wall clock) -- same datetime-id shape
  // as sales receipts (lib/receiptNumber.ts); client-supplied numbers win.
  const returnNumber = body.return_number?.trim() || await uniqueBusinessDateTimeNumber(
    'RET',
    async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM returns WHERE return_number = ? LIMIT 1').get([candidate])),
  )

  let saleMeta: { receipt_number?: string; customer_id?: number; customer_name?: string; customer_phone?: string; customer_address?: string; branch_id?: number; branch_name?: string; exchange_rate?: number; sale_status?: string; status_before_return?: string } = {}
  if (body.sale_id) {
    const sale = await db.prepare('SELECT receipt_number, customer_id, customer_name, customer_phone, customer_address, branch_id, branch_name, exchange_rate, sale_status, status_before_return FROM sales WHERE id = ?').get<typeof saleMeta>([body.sale_id])
    if (sale) saleMeta = sale
  }
  const branchId = body.branch_id || saleMeta.branch_id || null
  const branchName = branchId
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([branchId]))?.name || saleMeta.branch_name || null
    : saleMeta.branch_name || null

  const productIds = [...new Set([
    ...body.items.map((i) => Number(i.product_id)),
    ...replacementInputs.map((rep) => Number(rep.product_id)),
  ].filter((id) => Number.isFinite(id) && id > 0))]
  const productMap = new Map<number, { id: number; name: string; cost_price_usd: number; cost_price_khr: number; selling_price_usd: number; selling_price_khr: number }>()
  if (productIds.length > 0) {
    const rows = await selectInChunks(productIds, 0, (chunk) => db.prepare(`SELECT id, name, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`).all<typeof productMap extends Map<number, infer V> ? V : never>(chunk))
    for (const row of rows) productMap.set(row.id, row)
  }

  // The replacement lines are an ORDINARY sale's lines: priced at what the
  // shop charges, drawn from a lot, and settled by the customer the ordinary
  // way. Nothing here nets against the return's refund.
  const replacementLines = replacementInputs.map((rep) => {
    const meta = productMap.get(Number(rep.product_id))
    const quantity = Number(rep.quantity) || 0
    const priceUsd = rep.applied_price_usd != null ? toNumber(rep.applied_price_usd, 0) : (meta?.selling_price_usd || 0)
    const priceKhr = rep.applied_price_khr != null ? toNumber(rep.applied_price_khr, 0) : (meta?.selling_price_khr || 0)
    return {
      productId: Number(rep.product_id),
      productName: rep.product_name?.trim() || meta?.name || `product #${rep.product_id}`,
      branchId: Number(rep.branch_id) || 0,
      batchId: Number.isFinite(Number(rep.batch_id)) && Number(rep.batch_id) > 0 ? Number(rep.batch_id) : null,
      quantity,
      priceUsd,
      priceKhr,
      totalUsd: Number((priceUsd * quantity).toFixed(2)),
      totalKhr: Math.round(priceKhr * quantity),
      unitCostUsd: meta?.cost_price_usd || 0,
      unitCostKhr: meta?.cost_price_khr || 0,
    }
  })
  // ── The return's own money, and its own lots ───────────────────────────
  // Both resolved BEFORE the first write, from the ORIGINAL sale rather than
  // from the posted payload, and neither one knows the replacement exists.
  //
  // Resolve once, up front, which batch (if any) each returned line's
  // sale_item_id was originally sold from -- see fetchSaleItemBatchInfo's
  // own comment for why this is a batch-fetch-once/Map-lookup shape.
  const returnSaleItemIds = body.items.map((i) => i.sale_item_id).filter((id): id is number => Number.isFinite(id) && Number(id) > 0)
  const saleItemBatchInfo = await fetchSaleItemBatchInfo(db, returnSaleItemIds)
  // Z0: multi-lot lines (sale_items.batch_id NULL) restock across their
  // recorded allocations instead of the plain branch_stock bump.
  const saleItemAllocations = await fetchSaleItemAllocations(db, returnSaleItemIds)

  // The refund per line: the ORIGINAL sale line's price, always. A manual
  // return (no sale line) has only the posted price to go on.
  const refundPrices = body.items.map((item) => resolveRefundUnitPrice({
    saleLine: item.sale_item_id ? saleItemBatchInfo.get(Number(item.sale_item_id)) ?? null : null,
    postedUsd: toNumber(item.applied_price_usd, 0),
    postedKhr: toNumber(item.applied_price_khr, 0),
  }))
  const totalRefundUsd = Number(body.items
    .reduce((sum, item, index) => sum + refundPrices[index].unitUsd * (Number(item.quantity) || 0), 0)
    .toFixed(2))
  const totalRefundKhr = Math.round(body.items
    .reduce((sum, item, index) => sum + refundPrices[index].unitKhr * (Number(item.quantity) || 0), 0))

  // The lot every restocked line goes back into, planned before any write so
  // a line with no answer is an answer ("pick the lot") and not a silent
  // write onto unspecified stock. `lotTracked` is per product: one that has
  // never had a lot keeps the plain aggregate bump it always had.
  const restockProductIds = [...new Set(body.items
    .filter((item) => normalizeStockAction(item) === 'restock' && Number(item.product_id) > 0)
    .map((item) => Number(item.product_id)))]
  const lotTrackedProducts = new Set<number>()
  for (const productId of restockProductIds) {
    // A product whose lots are all retired can no longer be restocked into
    // one, so it is not "lot tracked" for this decision -- refusing it would
    // be a dead end with nothing for the operator to pick.
    const row = await db.prepare('SELECT 1 AS found FROM product_batches WHERE variant_product_id = @productId AND is_active = 1 LIMIT 1')
      .get<{ found: number }>({ productId })
    if (row) lotTrackedProducts.add(productId)
  }
  const returnLotPlans: Array<{ splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }> = []
  for (const item of body.items) {
    const quantity = Number(item.quantity) || 0
    const productId = Number(item.product_id) || 0
    if (normalizeStockAction(item) !== 'restock' || !productId || !(item.branch_id || branchId)) {
      returnLotPlans.push({ splits: [], plainQuantity: 0 })
      continue
    }
    const operatorBatchId = Number.isFinite(Number(item.batch_id)) && Number(item.batch_id) > 0 ? Number(item.batch_id) : null
    const plan = planReturnLot({
      allocations: item.sale_item_id ? (saleItemAllocations.get(item.sale_item_id) || []) : [],
      saleLineBatchId: item.sale_item_id ? (saleItemBatchInfo.get(item.sale_item_id)?.batch_id ?? null) : null,
      operatorBatchId,
      quantity,
      lotTracked: lotTrackedProducts.has(productId),
    })
    if (plan.requiresLotPick) {
      const name = (item.product_name && item.product_name.trim()) || productMap.get(productId)?.name || `product #${productId}`
      const error = new ReturnLotRequiredError(name, quantity)
      return c.json({ error: error.message, code: error.code, product_id: productId }, 400)
    }
    returnLotPlans.push({ splits: plan.splits, plainQuantity: plan.plainQuantity })
  }

  type ReplacementLotTake = { batchId: number; lotCode: string | null; expiryDate: string | null; quantity: number }
  const replacementFifoTakes = new Map<number, ReplacementLotTake[]>()
  // Hand-picked lots, kept in their OWN map: these drain through
  // applyReplacementStock and are reversed by its own compensation entry, so
  // they must never be double-reversed by the FIFO branch_batch_stock
  // put-back below -- but they still owe the sale an allocation row.
  const replacementExplicitTakes = new Map<number, ReplacementLotTake[]>()

  // FIFO lot planning for the replacement lines, run BEFORE the first write.
  // Two reasons it lives here rather than inside the write block below:
  //
  //   1. A lot shortfall is an answer, not a rollback. `branch_stock` (the
  //      aggregate) and `branch_batch_stock` (the lots) can disagree on a
  //      batch-tracked product -- historical rows, an import, a manual
  //      aggregate adjustment. If the lots cover LESS than the aggregate says,
  //      draining the aggregate in full while drawing the lots only partly
  //      silently widens exactly that drift. `allocateAcrossLots` already
  //      reports the gap as `uncovered`; the caller was discarding it. We
  //      refuse instead, and say which product and how short, so the operator
  //      picks an explicit lot or fixes the count. (routes/sales.ts:365 takes
  //      the same shortcut on the POS path -- reported, not touched from here.)
  //   2. Refusing before the returns row exists means no compensation path has
  //      to run for it at all.
  const replacementFifoLots = await readFifoLotAvailabilityForCart(
    db,
    replacementLines
      .filter((line) => line.batchId == null)
      .map((line) => ({ productId: line.productId, branchId: line.branchId || Number(branchId) || 0 }))
      .filter((pair) => pair.branchId > 0),
  )
  for (const [lineIndex, line] of replacementLines.entries()) {
    if (line.batchId != null) continue
    const lineBranchId = line.branchId || Number(branchId) || 0
    const lots = replacementFifoLots.get(`${line.productId}:${lineBranchId}`) || []
    const { takes, uncovered } = allocateAcrossLots(lots, line.quantity)
    if (uncovered > 0 && takes.length > 0) {
      // Partially covered: the product IS lot-tracked at this branch but its
      // lots cannot cover the hand-out. Committing would decrement the
      // aggregate by the full quantity and the lots by less.
      return c.json({
        error: `Not enough lot stock to hand out ${line.quantity} of "${line.productName}": the tracked lots at this branch cover only ${line.quantity - uncovered}. Pick a specific lot, or reconcile this product's lot quantities first.`,
        code: 'replacement_lot_shortfall',
      }, 409)
    }
    replacementFifoTakes.set(lineIndex, takes)
    for (const take of takes) {
      const lot = lots.find((entry) => entry.batchId === take.batchId)
      if (lot) lot.available -= take.quantity
    }
  }

  // Insert the return header first (mirrors sales.ts's POST / -- a single
  // statement can't share a D1 batch() with the item/stock writes below
  // since we need its lastInsertRowid first; see lib/db.ts).
  const returnInsert = await db.prepare(`
    INSERT INTO returns (
      return_number, client_request_id, sale_id, receipt_number, cashier_id, cashier_name,
      customer_id, customer_name, branch_id, branch_name, return_scope, reason, return_type,
      notes, total_refund_usd, total_refund_khr, exchange_rate, status, search_normalized
    ) VALUES (@return_number, @client_request_id, @sale_id, @receipt_number, @cashier_id, @cashier_name,
      @customer_id, @customer_name, @branch_id, @branch_name, @return_scope, @reason, @return_type,
      @notes, @total_refund_usd, @total_refund_khr, @exchange_rate, 'completed', @search_normalized)
  `).run({
    return_number: returnNumber,
    client_request_id: clientRequestId,
    sale_id: body.sale_id || null,
    receipt_number: body.receipt_number || saleMeta.receipt_number || null,
    cashier_id: user?.id ?? null,
    cashier_name: actorSnapshot(user),
    customer_id: body.customer_id || saleMeta.customer_id || null,
    customer_name: body.customer_name || saleMeta.customer_name || null,
    branch_id: branchId,
    branch_name: branchName,
    return_scope: CUSTOMER_SCOPE,
    reason: body.reason,
    return_type: body.return_type || 'restock',
    notes: body.notes || null,
    // Write-time diacritic fold of this return's own searchable text fields
    // (migration 0082), read additively by the returns search builder.
    search_normalized: normalizeSearchText(
      [returnNumber, body.receipt_number || saleMeta.receipt_number, user?.name, body.customer_name || saleMeta.customer_name, branchName, body.reason, body.return_type || 'restock', body.notes]
        .filter(Boolean)
        .join(' '),
    ),
    // Server-derived from the ORIGINAL sale lines, never from the posted
    // totals: what the customer gets back is what the shop charged.
    total_refund_usd: totalRefundUsd,
    total_refund_khr: totalRefundKhr,
    exchange_rate: body.exchange_rate || saleMeta.exchange_rate || 4100,
    // settlement_mode / settlement_diff_* (migration 0074) are read-only
    // history now: a return is only a return, so there is nothing to settle
    // and nothing new to write into them.
  })
  const returnId = returnInsert.lastInsertRowid
  let replacementSaleId: number | null = null
  let replacementReceiptNumber: string | null = null

  // Compensation log (Part-77, write-path + batch-identity audits): every
  // stock write that lands OUTSIDE the outer db.batch() below --
  // receiveBatchStock restocks and applyReplacementStock drains are each
  // their own atomic write -- so the catch can reverse exactly what was
  // applied. Before this, the catch deleted the return's rows and left the
  // stock moved: phantom inventory from the restocks, destroyed inventory
  // from the replacement drains. Declared OUTSIDE the try so the catch can
  // read them.
  const appliedLotRestocks: Array<{ productId: number; batchId: number; branchId: number; quantity: number }> = []
  const appliedReplacements: Array<{ productId: number; productName: string; branchId: number; batchId: number | null; quantity: number }> = []
  let replacementBatchWritesCommitted = false
  let replacementSaleNotice: Parameters<typeof formatSaleTelegramLines>[0] | null = null

  try {
    // A hand-out is a real sale, not only an inventory movement. This makes
    // it visible in Sales, gives it a printable receipt, and lets the item be
    // returned later through the same ordinary sale-item path. Stock is still
    // drained below by the replacement kernel so the return + sale remain one
    // coordinated write flow and can share the compensation path.
    if (replacementLines.length) {
      replacementReceiptNumber = await uniqueBusinessDateTimeNumber(
        '',
        async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM sales WHERE receipt_number = ? LIMIT 1').get([candidate])),
      )
      const replacementSubtotalUsd = Number(replacementLines.reduce((sum, line) => sum + line.totalUsd, 0).toFixed(2))
      const replacementPaymentMethod = String(body.replacement_payment_method ?? '').trim() || DEFAULT_REPLACEMENT_PAYMENT_METHOD
      const exchangeRate = body.exchange_rate || saleMeta.exchange_rate || 4100
      const originalReceipt = body.receipt_number || saleMeta.receipt_number || null
      const replacementSaleNote = `Replacement for return ${returnNumber}${originalReceipt ? ` / receipt ${originalReceipt}` : ''}`
      // The money model, through the SAME kernel routes/sales.ts POST / uses,
      // so this row's totals are derived exactly as a POS sale's are (KHR from
      // the USD total at the sale's rate -- not a separate sum of per-line KHR
      // that can round away from it).
      //
      // The customer TENDERS the whole sale, exactly as they would at the
      // counter. Under the old exchange model this row claimed only the gap
      // between the goods going out and the goods coming back -- which is
      // what forced "customer pays the difference" onto the operator. There
      // is no gap any more: the return refunds its own lines in full, and
      // this sale collects its own lines in full, as two independent
      // movements of money.
      const customerTenderUsd = replacementSubtotalUsd
      const replacementTotals = computeSaleTotals({
        subtotalUsd: replacementSubtotalUsd,
        discountUsd: 0,
        membershipDiscountUsd: 0,
        taxUsd: 0,
        deliveryFeeUsd: 0,
        deliveryFeePaidBy: 'customer',
        isDelivery: false,
        exchangeRate,
        rawAmountPaidUsd: customerTenderUsd,
        rawAmountPaidKhr: 0,
      })
      const replacementSubtotalKhr = replacementTotals.totalKhr
      const replacementClientRequestId = clientRequestId
        ? `${clientRequestId.slice(0, 96)}:replacement`
        : `return_${returnId}_replacement`
      const replacementSaleInsert = await db.prepare(`
        INSERT INTO sales (
          receipt_number, client_request_id, cashier_id, cashier_name, branch_id, branch_name,
          customer_id, customer_name, customer_phone, customer_address,
          payment_method, payment_details, payment_currency, exchange_rate,
          subtotal_usd, subtotal_khr, discount_usd, discount_khr, tax_usd, tax_khr,
          total_usd, total_khr, amount_paid_usd, amount_paid_khr, change_usd, change_khr,
          membership_discount_usd, membership_discount_khr, membership_points_redeemed,
          is_delivery, loyalty_accrual, sale_status, notes, items, search_normalized,
          source_return_id, updated_at
        ) VALUES (
          @receipt_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
          @customer_id, @customer_name, @customer_phone, @customer_address,
          @payment_method, @payment_details, 'USD', @exchange_rate,
          @subtotal_usd, @subtotal_khr, 0, 0, 0, 0,
          @total_usd, @total_khr, @amount_paid_usd, @amount_paid_khr, 0, 0,
          0, 0, 0,
          0, 1, 'completed', @notes, @items, @search_normalized,
          @source_return_id, CURRENT_TIMESTAMP
        )
      `).run({
        receipt_number: replacementReceiptNumber,
        client_request_id: replacementClientRequestId,
        cashier_id: user?.id ?? null,
        cashier_name: actorSnapshot(user),
        branch_id: branchId,
        branch_name: branchName,
        customer_id: body.customer_id || saleMeta.customer_id || null,
        customer_name: body.customer_name || saleMeta.customer_name || null,
        customer_phone: saleMeta.customer_phone || null,
        customer_address: saleMeta.customer_address || null,
        payment_method: replacementPaymentMethod,
        payment_details: JSON.stringify(customerTenderUsd > 0
          ? [{ method: replacementPaymentMethod, amount_usd: customerTenderUsd, amount_khr: 0 }]
          : []),
        exchange_rate: exchangeRate,
        subtotal_usd: replacementSubtotalUsd,
        subtotal_khr: replacementSubtotalKhr,
        total_usd: replacementTotals.totalUsd,
        total_khr: replacementTotals.totalKhr,
        amount_paid_usd: replacementTotals.amountPaidUsd,
        amount_paid_khr: replacementTotals.amountPaidKhr,
        // The one auto note that makes this sale legible anywhere it turns up
        // -- Sales list, receipt, an audit trail months later. Deterministic
        // wording so it is greppable and testable, not free prose.
        notes: replacementSaleNote,
        items: JSON.stringify(replacementLines.map((line) => ({
          product_id: line.productId,
          product_name: line.productName,
          quantity: line.quantity,
          applied_price_usd: line.priceUsd,
          applied_price_khr: line.priceKhr,
          total_usd: line.totalUsd,
          total_khr: line.totalKhr,
          branch_id: line.branchId || branchId,
          batch_id: line.batchId,
        }))),
        search_normalized: normalizeSearchText([
          replacementReceiptNumber,
          returnNumber,
          body.receipt_number || saleMeta.receipt_number,
          actorSnapshot(user),
          body.customer_name || saleMeta.customer_name,
          branchName,
          ...replacementLines.map((line) => line.productName),
        ].filter(Boolean).join(' ')),
        source_return_id: returnId,
      })
      replacementSaleId = replacementSaleInsert.lastInsertRowid
      await db.prepare('UPDATE returns SET replacement_sale_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run([replacementSaleId, returnId])
      // A normal sale announces itself on the sales Telegram channel through
      // this exact shared formatter (routes/sales.ts POST /). A replacement is
      // a normal sale, so it announces itself the same way -- not silently,
      // and not through a bespoke second message format.
      replacementSaleNotice = {
        status: 'completed',
        createdAt: null,
        receiptNumber: replacementReceiptNumber,
        cashier: actorSnapshot(user),
        customer: body.customer_name || saleMeta.customer_name || null,
        phone: saleMeta.customer_phone || null,
        branch: branchName,
        items: replacementLines.map((line) => ({
          name: line.productName,
          quantity: line.quantity,
          unitPriceUsd: line.priceUsd,
          basePriceUsd: null,
          lineTotalUsd: line.totalUsd,
        })),
        exchangeRate,
        isDelivery: false,
        deliveryFeeUsd: 0,
        deliveryPaidBy: null,
        driver: null,
        subtotalUsd: replacementSubtotalUsd,
        discountUsd: 0,
        taxUsd: 0,
        totalUsd: replacementTotals.totalUsd,
        totalKhr: replacementTotals.totalKhr,
        paidUsd: replacementTotals.amountPaidUsd,
        paidKhr: replacementTotals.amountPaidKhr,
        changeUsd: 0,
        changeKhr: 0,
        paymentMethod: replacementPaymentMethod,
      }
      // The lot the operator picked by hand drains through
      // applyReplacementStock (not the FIFO allocator), so it has no entry in
      // replacementFifoTakes -- without this it would be the ONE replacement
      // shape whose sale line carried no sale_item_batch_allocations row, and
      // batch identity would end at the return instead of following the units
      // onto the sale the customer can later return.
      for (const [lineIndex, line] of replacementLines.entries()) {
        if (line.batchId == null) continue
        const lot = await db.prepare('SELECT lot_code, expiry_date FROM product_batches WHERE id = ?')
          .get<{ lot_code: string | null; expiry_date: string | null }>([line.batchId])
        replacementExplicitTakes.set(lineIndex, [{
          batchId: line.batchId,
          lotCode: lot?.lot_code ?? null,
          expiryDate: lot?.expiry_date ?? null,
          quantity: line.quantity,
        }])
      }
    }

    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    const touchedProductIds = new Set<number>()

    // (saleItemBatchInfo/saleItemAllocations and the per-line lot plan were
    // resolved above, before the first write -- see their comment there.)
    // K2b: the per-lot split each returned line restocked into, collected in
    // body-item order and written to return_item_batch_allocations after the
    // outer batch() below assigns the return_items their ids.
    const perItemBatchSplits: ReturnBatchSplit[][] = []

    // Insert-return-items statements share the outer db.batch() below, but
    // a batch-aware restock (receiveBatchStock) runs its own separate
    // atomic write -- same non-atomic-across-both-steps tradeoff
    // routes/inventory.ts's /adjust already accepts for the same helper.
    // Awaited inline per item, before the outer batch(), so the resolved
    // batch_id is known in time to store on each return_items row.
    for (const [itemIndex, item] of body.items.entries()) {
      const quantity = Number(item.quantity) || 0
      // The refund the ORIGINAL sale line dictates (resolveRefundUnitPrice
      // above), not the posted price and not the product's price today.
      const refundUnitUsd = refundPrices[itemIndex].unitUsd
      const refundUnitKhr = refundPrices[itemIndex].unitKhr
      const totalUsd = Number((refundUnitUsd * quantity).toFixed(2))
      const totalKhr = Math.round(refundUnitKhr * quantity)
      const stockAction = normalizeStockAction(item)
      const returnToStock = stockAction === 'restock'
      const itemBranchId = item.branch_id || branchId || null
      const productMeta = item.product_id ? productMap.get(item.product_id) : undefined
      const safeProductName = (item.product_name && item.product_name.trim()) || productMeta?.name || (item.product_id ? `product #${item.product_id}` : 'Product')
      let costUsd = item.cost_price_usd || 0
      let costKhr = item.cost_price_khr || 0
      if (!costUsd && productMeta) costUsd = productMeta.cost_price_usd || 0
      if (!costKhr && productMeta) costKhr = productMeta.cost_price_khr || 0

      const itemSplits: ReturnBatchSplit[] = []
      let resolvedBatchId: number | null = null
      if (returnToStock && item.product_id && itemBranchId) {
        // The plan resolved before the first write (planReturnLot): the lots
        // the sale actually drew from, last drawn first, or the one lot the
        // operator picked. A lot-tracked line with neither never reaches
        // here -- it was refused above.
        const plan = returnLotPlans[itemIndex] || { splits: [], plainQuantity: 0 }
        let restockRemaining = quantity
        for (const split of plan.splits) {
          try {
            const received = await receiveBatchStock(db, { productId: item.product_id, branchId: itemBranchId, quantity: split.quantity, batchId: split.batchId })
            if (resolvedBatchId == null) resolvedBatchId = received.batchId
            itemSplits.push({ batchId: received.batchId, branchId: itemBranchId, quantity: split.quantity, saleItemId: item.sale_item_id ?? null })
            appliedLotRestocks.push({ productId: item.product_id, batchId: received.batchId, branchId: itemBranchId, quantity: split.quantity })
            restockRemaining -= split.quantity
          } catch (_err) {
            // That lot no longer belongs to this product (rare -- a merge
            // since the sale). Leave the units for the fallback bump below.
            if (itemSplits.length === 0) resolvedBatchId = null
          }
        }
        // Untracked stock (the product has never had a lot), or a lot that
        // vanished between the plan and the write, lands on the plain
        // branch_stock aggregate.
        if (restockRemaining > 0) {
          statements.push({
            sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
                  ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
            params: { product_id: item.product_id, branch_id: itemBranchId, quantity: restockRemaining },
          })
        }
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
                VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
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
            user_name: actorSnapshot(user),
            // 0084: attributable only when the WHOLE restock landed on one
            // lot; a multi-lot split or a plain-bump remainder stays NULL
            // (the per-lot detail is in return_item_batch_allocations).
            batch_id: itemSplits.length === 1 && itemSplits[0].quantity === quantity ? itemSplits[0].batchId : null,
          },
        })
        touchedProductIds.add(item.product_id)
      }

      // 11.13(c): restock as DAMAGED -- a traceable lot tied to this
      // return/branch/(original sale batch), NEVER sellable branch_stock,
      // plus its damage entry in the product's movement trail.
      if (stockAction === 'damaged' && item.product_id && itemBranchId) {
        const originalBatchId = item.sale_item_id ? (saleItemBatchInfo.get(item.sale_item_id)?.batch_id ?? null) : null
        await createDamagedLot(db, {
          productId: item.product_id,
          productName: safeProductName,
          branchId: itemBranchId,
          batchId: originalBatchId,
          returnId,
          quantity,
          reason: body.reason,
          userId: user?.id ?? null,
          userName: actorSnapshot(user),
        })
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
                VALUES (@product_id, @product_name, @branch_id, '${DAMAGE_IN_MOVEMENT}', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
          params: {
            product_id: item.product_id,
            product_name: safeProductName,
            branch_id: itemBranchId,
            quantity,
            unit_cost_usd: costUsd,
            unit_cost_khr: costKhr,
            reason: `Return (damaged): ${body.reason}`,
            reference_id: returnId,
            user_id: user?.id ?? null,
            user_name: actorSnapshot(user),
            // 0084: the ORIGINAL sale lot these units belonged to -- the
            // same attribution the damaged lot itself records.
            batch_id: originalBatchId,
          },
        })
      }

      statements.push({
        sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, stock_action, branch_id, batch_id)
              VALUES (@return_id, @sale_item_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @return_to_stock, @stock_action, @branch_id, @batch_id)`,
        params: {
          return_id: returnId,
          stock_action: stockAction,
          sale_item_id: item.sale_item_id || null,
          product_id: item.product_id || null,
          product_name: safeProductName,
          quantity,
          applied_price_usd: refundUnitUsd,
          applied_price_khr: refundUnitKhr,
          cost_price_usd: costUsd,
          cost_price_khr: costKhr,
          total_usd: totalUsd,
          total_khr: totalKhr,
          return_to_stock: returnToStock ? 1 : 0,
          branch_id: itemBranchId,
          batch_id: resolvedBatchId,
        },
      })
      // Parallel to body.items order: one entry per returned line (empty for
      // non-restock lines), so recordReturnItemBatchAllocations can line each
      // split up with the return_items row it just inserted.
      perItemBatchSplits.push(itemSplits)
    }

    // 11.12: hand out the replacement lines -- stock leaves the POS way
    // (explicit batch drains that exact lot; otherwise a validated plain
    // branch_stock decrement). Same non-atomic-across-steps tradeoff as
    // receiveBatchStock above; a failure lands in the catch below, which
    // deletes this return's rows.
    for (const [lineIndex, line] of replacementLines.entries()) {
      const lineBranchId = line.branchId || Number(branchId) || 0
      if (!lineBranchId) throw new Error(`Replacement line for ${line.productName} needs a branch`)
      await applyReplacementStock(db, {
        productId: line.productId,
        productName: line.productName,
        branchId: lineBranchId,
        batchId: line.batchId,
        quantity: line.quantity,
        unitCostUsd: line.unitCostUsd,
        unitCostKhr: line.unitCostKhr,
        returnId,
        returnNumber,
        userId: user?.id ?? null,
        userName: actorSnapshot(user),
      })
      appliedReplacements.push({ productId: line.productId, productName: line.productName, branchId: lineBranchId, batchId: line.batchId, quantity: line.quantity })
      if (!replacementSaleId) throw new Error('Replacement sale header was not created')
      const fifoTakes = replacementFifoTakes.get(lineIndex) || []
      for (const take of fifoTakes) {
        statements.push(decrementBatchStockStrictStatement(take.batchId, lineBranchId, take.quantity))
      }
      const recordedBatchId = line.batchId
        || (fifoTakes.length === 1 && fifoTakes[0].quantity === line.quantity ? fifoTakes[0].batchId : null)
      statements.push({
        sql: `INSERT INTO sale_items (
                sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr,
                cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id,
                price_mode, base_price_usd, base_price_khr, batch_id
              ) VALUES (
                @sale_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr,
                @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @branch_id,
                'selling', @base_price_usd, @base_price_khr, @batch_id
              )`,
        params: {
          sale_id: replacementSaleId,
          product_id: line.productId,
          product_name: line.productName,
          quantity: line.quantity,
          applied_price_usd: line.priceUsd,
          applied_price_khr: line.priceKhr,
          cost_price_usd: line.unitCostUsd,
          cost_price_khr: line.unitCostKhr,
          total_usd: line.totalUsd,
          total_khr: line.totalKhr,
          branch_id: lineBranchId,
          base_price_usd: line.priceUsd,
          base_price_khr: line.priceKhr,
          batch_id: recordedBatchId,
        },
      })
      statements.push({
        sql: `INSERT INTO return_replacement_items (return_id, product_id, product_name, branch_id, batch_id, quantity, applied_price_usd, applied_price_khr, total_usd, total_khr)
              VALUES (@return_id, @product_id, @product_name, @branch_id, @batch_id, @quantity, @applied_price_usd, @applied_price_khr, @total_usd, @total_khr)`,
        params: {
          return_id: returnId,
          product_id: line.productId,
          product_name: line.productName,
          branch_id: lineBranchId,
          batch_id: line.batchId,
          quantity: line.quantity,
          applied_price_usd: line.priceUsd,
          applied_price_khr: line.priceKhr,
          total_usd: line.totalUsd,
          total_khr: line.totalKhr,
        },
      })
      touchedProductIds.add(line.productId)
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
    replacementBatchWritesCommitted = [...replacementFifoTakes.values()].some((takes) => takes.length > 0)

    if (replacementSaleId) {
      const [saleItems, replacementRows] = await Promise.all([
        db.prepare('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all<{ id: number }>([replacementSaleId]),
        db.prepare('SELECT id FROM return_replacement_items WHERE return_id = ? ORDER BY id ASC').all<{ id: number }>([returnId]),
      ])
      const linkStatements: Array<{ sql: string; params: Record<string, unknown> }> = replacementRows.slice(0, saleItems.length).map((row, index) => ({
        sql: 'UPDATE return_replacement_items SET sale_item_id = @sale_item_id WHERE id = @id',
        params: { sale_item_id: saleItems[index].id, id: row.id },
      }))
      for (const [lineIndex, saleItem] of saleItems.entries()) {
        for (const take of [...(replacementFifoTakes.get(lineIndex) || []), ...(replacementExplicitTakes.get(lineIndex) || [])]) {
          linkStatements.push({
            sql: `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity, released_at)
                  VALUES (@sale_item_id, @batch_id, @branch_id, @quantity, @lot_code, @expiry_date, 0, NULL)`,
            params: {
              sale_item_id: saleItem.id,
              batch_id: take.batchId,
              branch_id: replacementLines[lineIndex].branchId || Number(branchId) || 0,
              quantity: take.quantity,
              lot_code: take.lotCode,
              expiry_date: take.expiryDate,
            },
          })
        }
      }
      if (linkStatements.length) await db.batch(linkStatements)
    }

    // Now that the return_items rows have ids, persist which exact lot(s)
    // each sellable restock went into -- the trail a later edit reverses by.
    await recordReturnItemBatchAllocations(db, returnId, perItemBatchSplits)

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
      await db.prepare(`UPDATE sales SET
        status_before_return = CASE WHEN COALESCE(sale_status,'completed') NOT IN ('returned','partial_return') THEN COALESCE(sale_status,'completed') ELSE status_before_return END,
        sale_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run([fullyReturned ? 'returned' : 'partial_return', body.sale_id])
    }
  } catch (error) {
    // Reverse the stock FIRST, then delete the rows (Part-77): the restocks
    // and replacement drains above each committed as their own write, so
    // deleting the return's rows alone left the stock moved -- phantom
    // inventory from restocks, destroyed inventory from replacements.
    // Best-effort per write, LOUDLY reported: a reversal can legitimately
    // fail (e.g. a concurrent sale already consumed the restocked units) and
    // that must reach the operator and the audit log, never be swallowed.
    const unreversed: string[] = []
    if (replacementBatchWritesCommitted) {
      for (const [lineIndex, takes] of [...replacementFifoTakes.entries()].reverse()) {
        const line = replacementLines[lineIndex]
        const lineBranchId = line.branchId || Number(branchId) || 0
        for (const take of [...takes].reverse()) {
          try {
            await db.prepare(`
              INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batch_id, @branch_id, @quantity)
              ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = branch_batch_stock.quantity + @quantity
            `).run({ batch_id: take.batchId, branch_id: lineBranchId, quantity: take.quantity })
          } catch (_) {
            unreversed.push(`replacement lot allocation of ${take.quantity} from lot #${take.batchId} (product #${line.productId})`)
          }
        }
      }
    }
    for (const restock of [...appliedLotRestocks].reverse()) {
      try {
        await removeStockFromBatch(db, { batchId: restock.batchId, productId: restock.productId, branchId: restock.branchId, quantity: restock.quantity })
      } catch (_) {
        unreversed.push(`restock of ${restock.quantity} into lot #${restock.batchId} (product #${restock.productId}, branch #${restock.branchId})`)
      }
    }
    for (const line of [...appliedReplacements].reverse()) {
      try {
        if (line.batchId != null) {
          await receiveBatchStock(db, { productId: line.productId, branchId: line.branchId, quantity: line.quantity, batchId: line.batchId })
        } else {
          await db.prepare(`
            INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity
          `).run({ product_id: line.productId, branch_id: line.branchId, quantity: line.quantity })
          await db.prepare(
            'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId), updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
          ).run({ productId: line.productId })
        }
      } catch (_) {
        unreversed.push(`replacement drain of ${line.quantity} of "${line.productName}" (branch #${line.branchId})`)
      }
    }
    // Movement rows the pre-batch writes recorded against this (about to be
    // deleted) return -- type-scoped so an unrelated entity sharing the
    // numeric reference_id is never touched.
    try {
      await db.prepare(`DELETE FROM inventory_movements WHERE reference_id = ? AND movement_type IN ('return', '${REPLACEMENT_OUT_MOVEMENT}', '${DAMAGE_IN_MOVEMENT}')`).run([returnId])
    } catch (_) {}
    await db.prepare('DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id = ?)').run([returnId])
    // return_items was missing from this cleanup entirely -- a failure AFTER
    // the outer batch (allocation recording, sale-status update) left its
    // rows orphaned under a deleted returns row.
    await db.prepare('DELETE FROM return_items WHERE return_id = ?').run([returnId])
    if (replacementSaleId) {
      await db.prepare('DELETE FROM sale_item_batch_allocations WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)').run([replacementSaleId])
      await db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run([replacementSaleId])
      await db.prepare('DELETE FROM sales WHERE id = ?').run([replacementSaleId])
    }
    await db.prepare('DELETE FROM returns WHERE id = ?').run([returnId])
    await db.prepare('DELETE FROM damaged_stock_lots WHERE return_id = ?').run([returnId])
    await db.prepare('DELETE FROM return_replacement_items WHERE return_id = ?').run([returnId])
    if (unreversed.length) {
      await audit(c.env, user?.id ?? null, actorSnapshot(user), 'return_rollback_incomplete', 'return', returnId, { unreversed })
    }
    return c.json({
      error: `Failed to record return items: ${(error as Error).message}`
        + (unreversed.length
          ? ` -- WARNING: ${unreversed.length} stock write(s) could not be reversed (recorded in the audit log; run Verify Integrity): ${unreversed.join('; ')}`
          : ''),
    }, 500)
  }

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'create', 'return', returnId, {
    returnNumber,
    saleId: body.sale_id || null,
    replacementSaleId,
    replacementReceiptNumber,
    reason: body.reason,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'returns'),
    bumpVersion(c.env, 'sales'),
  ]))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'create', id: returnId }))
  // Telegram: the return as a receipt summary (RET / INV / customer / lines
  // with refund and resulting on-hand / refund total) -- lib/telegram.ts
  // reads the recorded lines back, so this passes only the header.
  c.executionCtx.waitUntil(sendReturnTelegramEvent(c.env, returnId, {
    kind: 'customer', returnNumber, receiptNumber: body.receipt_number || saleMeta.receipt_number || null,
    party: body.customer_name || saleMeta.customer_name || null, branch: branchName, reason: body.reason || null,
    returnType: body.return_type || 'restock', refundUsd: totalRefundUsd, refundKhr: totalRefundKhr,
    by: actorSnapshot(user),
  }).catch((error) => console.error('[telegram] return notification failed', error)))
  // ...and the replacement sale announces itself as the ordinary sale it is,
  // on the SAME 'sales' channel and through the SAME shared formatter
  // routes/sales.ts uses. Without this the one sale the shop never typed into
  // POS was also the one sale that never reached the channel.
  if (replacementSaleNotice) {
    c.executionCtx.waitUntil(sendTelegramEvent(c.env, {
      type: 'sales',
      lines: formatSaleTelegramLines(replacementSaleNotice),
    }).catch((error) => console.error('[telegram] replacement sale notification failed', error)))
  }
  c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: body.sale_id || null }))
  return c.json({ id: returnId, returnNumber, replacementSaleId, replacementReceiptNumber })
})

// POST /api/returns/supplier -- "process" a supplier return: pull stock out
// (it's leaving via the supplier, not going back on the shelf) and record
// how the supplier is settling it (refund / credit / replacement / writeoff),
// tracking any shortfall as supplier_loss_usd/khr.
app.post('/supplier', async (c) => {
  const db = getDb(c.env)
  const user = c.get('user')
  // Per-action override (Part 546): supplier returns are the same 'add'
  // action as customer returns -- one switch covers both create routes.
  if (getActionTier(user, 'returns', 'add') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
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
    const existing = await db.prepare("SELECT id, return_number FROM returns WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1").get<{ id: number; return_number: string }>([clientRequestId])
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

  // SRET-YYYYMMDD-HHMMSS, same convention as the customer-return path above.
  const returnNumber = body.return_number?.trim() || await uniqueBusinessDateTimeNumber(
    'SRET',
    async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM returns WHERE return_number = ? LIMIT 1').get([candidate])),
  )
  const branchName = body.branch_id
    ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null
    : null

  const returnInsert = await db.prepare(`
    INSERT INTO returns (
      return_number, client_request_id, cashier_id, cashier_name, branch_id, branch_name,
      return_scope, reason, return_type, notes, total_refund_usd, total_refund_khr, exchange_rate,
      supplier_id, supplier_name, supplier_settlement, supplier_compensation_usd, supplier_compensation_khr,
      supplier_loss_usd, supplier_loss_khr, status, search_normalized
    ) VALUES (@return_number, @client_request_id, @cashier_id, @cashier_name, @branch_id, @branch_name,
      @return_scope, @reason, 'supplier_return', @notes, 0, 0, @exchange_rate,
      @supplier_id, @supplier_name, @settlement, @supplier_compensation_usd, @supplier_compensation_khr,
      @supplier_loss_usd, @supplier_loss_khr, 'completed', @search_normalized)
  `).run({
    return_number: returnNumber,
    client_request_id: clientRequestId,
    cashier_id: user?.id ?? null,
    cashier_name: actorSnapshot(user),
    branch_id: body.branch_id || null,
    branch_name: branchName,
    return_scope: SUPPLIER_SCOPE,
    reason: body.reason,
    notes: body.notes || null,
    exchange_rate: body.exchange_rate || 4100,
    supplier_id: body.supplier_id || null,
    supplier_name: body.supplier_name || null,
    settlement,
    // Write-time diacritic fold of this supplier return's own searchable text
    // fields (migration 0082), read additively by the returns search builder.
    search_normalized: normalizeSearchText(
      [returnNumber, user?.name, branchName, body.reason, 'supplier_return', body.notes, body.supplier_name, settlement]
        .filter(Boolean)
        .join(' '),
    ),
    supplier_compensation_usd: supplierCompensationUsd,
    supplier_compensation_khr: supplierCompensationKhr,
    supplier_loss_usd: supplierLossUsd,
    supplier_loss_khr: supplierLossKhr,
  })
  const returnId = returnInsert.lastInsertRowid

  const productIds = [...new Set(body.items.map((i) => Number(i.product_id)))]
  const productNameMap = new Map<number, string>()
  if (productIds.length) {
    const rows = await selectInChunks(productIds, 0, (chunk) => db.prepare(`SELECT id, name FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`).all<{ id: number; name: string }>(chunk))
    for (const row of rows) productNameMap.set(row.id, row.name)
  }

  try {
    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    const touchedProductIds = new Set<number>()
    const supplierPerItemBatchSplits: ReturnBatchSplit[][] = []
    // Draw the deducted units out of the product's active lots FIFO, same as a
    // sale of a no-lot line, so a supplier return of a batch-tracked product
    // keeps branch_batch_stock in step with branch_stock instead of leaving the
    // lot ledger high (a product×branch lot drift). Fetched once for the return.
    const supplierFifoLots = await readFifoLotAvailabilityForCart(
      db,
      body.items.map((i) => ({ productId: Number(i.product_id), branchId: Number(i.branch_id || body.branch_id || 0) })),
    )
    // Part-77 (oversell-clamp audit): validate availability BEFORE composing
    // the deduction — a supplier return can never send back more units than
    // the branch holds, and the old MAX(0, ...) clamp silently floored the
    // overshoot instead of refusing it (stock loss with no error). Tracked
    // cumulatively so two lines of the same product+branch can't each pass
    // against the same units. The strict (unclamped) decrements below plus
    // 0058's CHECK(quantity >= 0) then abort the WHOLE atomic batch if a
    // concurrent sale wins the race between this read and the write.
    const supplierAvailability = new Map<string, number>()
    for (const item of body.items) {
      const qty = toNumber(item.quantity, 0)
      const itemBranchId = item.branch_id || body.branch_id || null
      if (!item.product_id || !itemBranchId || !(qty > 0)) continue
      const availabilityKey = `${item.product_id}:${itemBranchId}`
      if (!supplierAvailability.has(availabilityKey)) {
        const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @product_id AND branch_id = @branch_id')
          .get<{ quantity: number }>({ product_id: item.product_id, branch_id: itemBranchId })
        supplierAvailability.set(availabilityKey, Number(stockRow?.quantity) || 0)
      }
      const remaining = supplierAvailability.get(availabilityKey)!
      if (qty > remaining) {
        const shortName = item.product_name?.trim() || productNameMap.get(Number(item.product_id)) || `product #${item.product_id}`
        const insufficient = new Error(`Insufficient stock for supplier return of ${shortName}: ${remaining} available at this branch, ${qty} requested`)
        insufficient.name = 'SupplierReturnStockError'
        throw insufficient
      }
      supplierAvailability.set(availabilityKey, remaining - qty)
    }
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
      // Strict (unclamped) subtraction: availability was validated above, so
      // the only way this goes negative is a concurrent consumer winning the
      // race -- then 0058's CHECK aborts the whole atomic batch instead of
      // the old MAX(0, ...) clamp silently flooring the overshoot away.
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
        params: { product_id: item.product_id, branch_id: itemBranchId, quantity: qty },
      })
      // Lot-ledger parity: pull the same units out of the product's active lots
      // FIFO, strict for the same reason as the aggregate above (takes are
      // bounded by the just-read availability, so only a race can overdraw --
      // abort, don't clamp). The shared
      // availability is consumed so a second line of the same product at this
      // branch can't double-take a lot; any uncovered remainder is legacy
      // unlotted stock that rides branch_stock alone, matching the bump above.
      let supplierReturnTakes: Array<{ batchId: number; quantity: number }> = []
      if (itemBranchId) {
        const lots = supplierFifoLots.get(`${item.product_id}:${itemBranchId}`) || []
        const { takes } = allocateAcrossLots(lots, qty)
        supplierReturnTakes = takes
        for (const take of takes) {
          const lot = lots.find((entry) => entry.batchId === take.batchId)
          if (lot) lot.available -= take.quantity
          statements.push(decrementBatchStockStrictStatement(take.batchId, itemBranchId, take.quantity))
        }
      }
      supplierPerItemBatchSplits.push(supplierReturnTakes.map((take) => ({
        batchId: take.batchId,
        branchId: itemBranchId,
        quantity: take.quantity,
        saleItemId: null,
      })))
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, 'supplier_return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
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
          user_name: actorSnapshot(user),
          // 0084: attributable only when one lot covered the whole deduction.
          batch_id: supplierReturnTakes.length === 1 && supplierReturnTakes[0].quantity === qty ? supplierReturnTakes[0].batchId : null,
        },
      })
      if (item.product_id) touchedProductIds.add(item.product_id)
    }
    for (const [itemIndex, splits] of supplierPerItemBatchSplits.entries()) {
      for (const split of splits) {
        statements.push({
          sql: `INSERT INTO return_item_batch_allocations (return_item_id, sale_item_id, batch_id, branch_id, quantity)
                SELECT id, NULL, @batch_id, @branch_id, @quantity
                FROM return_items WHERE return_id = @return_id ORDER BY id ASC LIMIT 1 OFFSET @item_index`,
          params: {
            return_id: returnId,
            item_index: itemIndex,
            batch_id: split.batchId,
            branch_id: split.branchId,
            quantity: split.quantity,
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
    await db.batch(statements)
  } catch (error) {
    await db.prepare('DELETE FROM returns WHERE id = ?').run([returnId])
    // An availability refusal is the caller's input problem (400), not a
    // server failure -- everything composed after it never ran (the one
    // atomic batch at the end is all-or-nothing).
    const status = (error as Error)?.name === 'SupplierReturnStockError' ? 400 : 500
    return c.json({ error: `Failed to record supplier return items: ${(error as Error).message}` }, status)
  }

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'create', 'supplier_return', returnId, { returnNumber, settlement, supplierName: body.supplier_name || null, supplierLossUsd })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'supplier_return', id: returnId }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'returns'),
    bumpVersion(c.env, 'sales'),
  ]))
  // Telegram: supplier return = stock out with the settlement money.
  c.executionCtx.waitUntil(sendReturnTelegramEvent(c.env, returnId, {
    kind: 'supplier', returnNumber, party: body.supplier_name || null,
    branch: body.branch_id ? (await db.prepare('SELECT name FROM branches WHERE id = ?').get<{ name: string }>([body.branch_id]))?.name || null : null,
    reason: body.reason || null, settlement, compensationUsd: supplierCompensationUsd, compensationKhr: supplierCompensationKhr,
    lossUsd: supplierLossUsd, lossKhr: supplierLossKhr, by: actorSnapshot(user),
  }).catch((error) => console.error('[telegram] supplier return notification failed', error)))
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
  // Per-action override (Part 546): 'returns:edit' switched off.
  if (getActionTier(user, 'returns', 'edit') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
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
    return_to_stock: number; stock_action: string | null; branch_id: number | null; cost_price_usd: number | null; cost_price_khr: number | null
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

  // No settlement gate any more: a return is only a return and a replacement
  // is only a sale, so editing the returned side cannot "break an exchange".
  // The linked replacement sale is untouched by this edit -- it is a separate
  // sale with its own receipt, and a sale is corrected in Sales, not here.
  // The historical settlement_mode/settlement_diff_* on rows written under
  // the old model are left exactly as they were found (the UPDATE below no
  // longer names those columns), so an old return still reads correctly.
  //
  // What DOES stand in the old gate's place is the same pre-write pass POST /
  // runs: resolve each line's refund from the original sale line, and decide
  // the lot every restocked line goes back into. Both live up here, above the
  // damaged-lot reversal and every stock statement, so a line with no lot is
  // refused having touched nothing -- the Part-77 discipline the settlement
  // gate used to hold this slot for.
  const editSaleItemIds = newItems.map((i) => i.sale_item_id).filter((sid): sid is number => Number.isFinite(sid) && Number(sid) > 0)
  const saleItemBatchInfoForEdit = await fetchSaleItemBatchInfo(db, editSaleItemIds)
  const saleItemAllocationsForEdit = await fetchSaleItemAllocations(db, editSaleItemIds)

  // The refund per line: the ORIGINAL sale line's price, always -- an edit is
  // not a chance to restate what the customer paid. A manual return (no sale
  // line) has only the posted price to go on.
  const editRefundPrices = newItems.map((item) => resolveRefundUnitPrice({
    saleLine: item.sale_item_id ? saleItemBatchInfoForEdit.get(Number(item.sale_item_id)) ?? null : null,
    postedUsd: toNumber(item.applied_price_usd, 0),
    postedKhr: toNumber(item.applied_price_khr, 0),
  }))

  const editRestockProductIds = [...new Set(newItems
    .filter((item) => normalizeStockAction(item) === 'restock' && Number(item.product_id) > 0)
    .map((item) => Number(item.product_id)))]
  const editLotTrackedProducts = new Set<number>()
  for (const productId of editRestockProductIds) {
    const row = await db.prepare('SELECT 1 AS found FROM product_batches WHERE variant_product_id = @productId AND is_active = 1 LIMIT 1')
      .get<{ found: number }>({ productId })
    if (row) editLotTrackedProducts.add(productId)
  }
  const editLotPlans: Array<{ splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }> = []
  for (const item of newItems) {
    const quantity = Number(item.quantity) || 0
    const productId = Number(item.product_id) || 0
    const itemBranchId = item.branch_id || existing.branch_id || null
    if (normalizeStockAction(item) !== 'restock' || !productId || !itemBranchId) {
      editLotPlans.push({ splits: [], plainQuantity: 0 })
      continue
    }
    const operatorBatchId = Number.isFinite(Number(item.batch_id)) && Number(item.batch_id) > 0 ? Number(item.batch_id) : null
    const plan = planReturnLot({
      allocations: item.sale_item_id ? (saleItemAllocationsForEdit.get(item.sale_item_id) || []) : [],
      saleLineBatchId: item.sale_item_id ? (saleItemBatchInfoForEdit.get(item.sale_item_id)?.batch_id ?? null) : null,
      operatorBatchId,
      quantity,
      lotTracked: editLotTrackedProducts.has(productId),
    })
    if (plan.requiresLotPick) {
      const fallbackName = (await db.prepare('SELECT name FROM products WHERE id = ?').get<{ name: string }>([productId]))?.name
      const name = (item.product_name && item.product_name.trim()) || fallbackName || `product #${productId}`
      const error = new ReturnLotRequiredError(name, quantity)
      return c.json({ error: error.message, code: error.code, product_id: productId }, 400)
    }
    editLotPlans.push({ splits: plan.splits, plainQuantity: plan.plainQuantity })
  }

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
  const touchedProductIds = new Set<number>()

  // Compensation log (Part-77, same shape as POST /'s -- Part 523): every
  // stock write that lands OUTSIDE the final atomic batch, so a failure
  // anywhere in the edit can put the stock back exactly where it started.
  const editReversedRestocks: Array<{ productId: number; batchId: number; branchId: number; quantity: number }> = []
  const editReappliedRestocks: Array<{ productId: number; batchId: number; branchId: number; quantity: number }> = []
  let editReversedDamaged: Awaited<ReturnType<typeof reverseDamagedLots>> = []
  let editCreatedDamaged = false
  // Written inside the guarded stretch, read after it (the allocation
  // recording runs post-batch) -- declared here so both can see it.
  const perItemBatchSplits: ReturnBatchSplit[][] = []

  // 11.13: this return's damaged lots come back out before the re-apply.
  // A lot POS already drew from can't be un-damaged (that stock left the
  // building) -- ConsumedDamagedStockError blocks the edit outright.
  try {
    const reversedLots = await reverseDamagedLots(db, id)
    editReversedDamaged = reversedLots
    for (const lot of reversedLots) {
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, '${DAMAGE_REVERSAL_MOVEMENT}', @quantity, 0, 0, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: lot.product_id,
          product_name: lot.product_name,
          branch_id: lot.branch_id,
          quantity: -lot.quantity,
          reason: `Return #${existing.return_number} updated - reversing damaged stock`,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: actorSnapshot(user),
          // 0084: the original sale lot the damaged units belonged to.
          batch_id: lot.batch_id,
        },
      })
    }
  } catch (error) {
    if (error instanceof ConsumedDamagedStockError) return c.json({ error: error.message }, 400)
    throw error
  }

  // Everything from here through the atomic batch runs under ONE catch that
  // compensates the per-lot writes (they commit individually) -- see the
  // catch below. Interior deliberately not re-indented: the diff stays
  // reviewable and the block boundaries are these two comments.
  try {

  // Reverse the stock effect of every existing item that had been restocked.
  // Per-lot aware: a return that recorded its restock split into
  // return_item_batch_allocations (POST / and this edit both write it now)
  // reverses each EXACT lot it put stock into via removeStockFromBatch;
  // anything not covered by a recorded lot -- the plain-bump remainder, a lot
  // that has since been sold down, or a legacy return created before per-lot
  // recording -- falls back to the generic branch_stock aggregate. A legacy
  // return with only a single return_items.batch_id still reverses that one
  // lot, exactly as before.
  const existingItemIds = existingItems.map((it) => Number(it.id)).filter((n) => Number.isFinite(n) && n > 0)
  const existingReturnAllocations = await fetchReturnItemBatchAllocations(db, existingItemIds)
  for (const item of existingItems) {
    if (!item.return_to_stock || !item.product_id || !item.branch_id) continue
    touchedProductIds.add(item.product_id)
    const productId = item.product_id
    const branchIdForItem = item.branch_id
    let plainRemainder = Number(item.quantity) || 0
    // 0084: which lots this reversal actually drew from -- the movement row
    // stamps a batch_id only when ONE lot covered the whole quantity.
    const reversalLots: Array<{ batchId: number; quantity: number }> = []
    const recordedAllocs = existingReturnAllocations.get(Number(item.id)) || []
    if (recordedAllocs.length) {
      for (const alloc of recordedAllocs) {
        const give = Math.min(alloc.quantity, plainRemainder)
        if (give <= 0) continue
        try {
          await removeStockFromBatch(db, { batchId: alloc.batch_id, productId, branchId: branchIdForItem, quantity: give })
          reversalLots.push({ batchId: alloc.batch_id, quantity: give })
          editReversedRestocks.push({ productId, batchId: alloc.batch_id, branchId: branchIdForItem, quantity: give })
          plainRemainder -= give
        } catch (err) {
          // That lot was sold/moved down since, or no longer belongs here;
          // removeStockFromBatch throws before writing, so leave these units
          // for the aggregate decrement below.
          void err
        }
      }
    } else if (item.batch_id != null) {
      // Legacy return (no recorded split): reverse its single recorded lot.
      try {
        await removeStockFromBatch(db, { batchId: item.batch_id, productId, branchId: branchIdForItem, quantity: plainRemainder })
        reversalLots.push({ batchId: item.batch_id, quantity: plainRemainder })
        editReversedRestocks.push({ productId, batchId: item.batch_id, branchId: branchIdForItem, quantity: plainRemainder })
        plainRemainder = 0
      } catch (err) {
        void err
      }
    }
    if (plainRemainder > 0) {
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, branch_stock.quantity - @quantity)`,
        params: { product_id: productId, branch_id: branchIdForItem, quantity: plainRemainder },
      })
    }
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
            VALUES (@product_id, @product_name, @branch_id, 'return_reversal', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
      params: {
        product_id: productId,
        product_name: item.product_name,
        branch_id: branchIdForItem,
        quantity: -(Number(item.quantity) || 0),
        unit_cost_usd: item.cost_price_usd || 0,
        unit_cost_khr: item.cost_price_khr || 0,
        reason: `Return #${existing.return_number} updated - reversing previous restock`,
        reference_id: id,
        user_id: user?.id ?? null,
        user_name: actorSnapshot(user),
        // 0084: attributable only when one lot covered the whole reversal.
        batch_id: reversalLots.length === 1 && reversalLots[0].quantity === (Number(item.quantity) || 0) ? reversalLots[0].batchId : null,
      },
    })
  }

  // Old per-lot rows are reversed above; drop them before the re-apply writes
  // fresh ones for the edited item set (delete allocations first -- they
  // reference the return_items rows deleted on the next line).
  statements.push({ sql: 'DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM return_items WHERE return_id = @return_id)', params: { return_id: id } })
  statements.push({ sql: 'DELETE FROM return_items WHERE return_id = @return_id', params: { return_id: id } })

  let totalRefundUsd = 0
  let totalRefundKhr = 0
  for (const [itemIndex, item] of newItems.entries()) {
    const quantity = Number(item.quantity) || 0
    const refundUnitUsd = editRefundPrices[itemIndex]?.unitUsd ?? 0
    const refundUnitKhr = editRefundPrices[itemIndex]?.unitKhr ?? 0
    const totalUsd = Number((refundUnitUsd * quantity).toFixed(2))
    const totalKhr = Math.round(refundUnitKhr * quantity)
    const stockAction = normalizeStockAction(item)
    const returnToStock = stockAction === 'restock'
    const itemBranchId = item.branch_id || existing.branch_id || null
    totalRefundUsd += totalUsd
    totalRefundKhr += totalKhr

    const itemSplits: ReturnBatchSplit[] = []
    let resolvedBatchId: number | null = null
    if (returnToStock && item.product_id && itemBranchId) {
      // The lots were decided above, before any write: the sale's own lots
      // (last-drawn first), the operator's pick, or a refusal. Nothing here
      // invents a destination.
      const plan = editLotPlans[itemIndex] || { splits: [], plainQuantity: 0 }
      let restockRemaining = plan.plainQuantity
      for (const split of plan.splits) {
        try {
          const received = await receiveBatchStock(db, { productId: item.product_id, branchId: itemBranchId, quantity: split.quantity, batchId: split.batchId })
          if (resolvedBatchId == null) resolvedBatchId = received.batchId
          itemSplits.push({ batchId: received.batchId, branchId: itemBranchId, quantity: split.quantity, saleItemId: item.sale_item_id ?? null })
          editReappliedRestocks.push({ productId: item.product_id, batchId: received.batchId, branchId: itemBranchId, quantity: split.quantity })
        } catch (_err) {
          // Lot gone/merged since the sale -- leave for the aggregate bump.
          restockRemaining += split.quantity
        }
      }
      // Units not attributable to a lot land on the plain branch_stock total.
      if (restockRemaining > 0) {
        statements.push({
          sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
          params: { product_id: item.product_id, branch_id: itemBranchId, quantity: restockRemaining },
        })
      }
      touchedProductIds.add(item.product_id)
    }

    if (stockAction === 'damaged' && item.product_id && itemBranchId) {
      const originalBatchId = item.sale_item_id ? (saleItemBatchInfoForEdit.get(item.sale_item_id)?.batch_id ?? null) : null
      editCreatedDamaged = true
      await createDamagedLot(db, {
        productId: item.product_id,
        productName: item.product_name || null,
        branchId: itemBranchId,
        batchId: originalBatchId,
        returnId: id,
        quantity,
        reason: String(body.reason || existing.reason || '') || null,
        userId: user?.id ?? null,
        userName: actorSnapshot(user),
      })
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, '${DAMAGE_IN_MOVEMENT}', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name || null,
          branch_id: itemBranchId,
          quantity,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason: `Return #${existing.return_number} updated (damaged): ${body.reason || existing.reason}`,
          reference_id: id,
          user_id: user?.id ?? null,
          user_name: actorSnapshot(user),
          // 0084: the original sale lot, same as the create path.
          batch_id: originalBatchId,
        },
      })
    }

    statements.push({
      sql: `INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, stock_action, branch_id, batch_id)
            VALUES (@return_id, @sale_item_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr, @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @return_to_stock, @stock_action, @branch_id, @batch_id)`,
      params: {
        return_id: id,
        stock_action: stockAction,
        sale_item_id: item.sale_item_id || null,
        product_id: item.product_id || null,
        product_name: item.product_name || null,
        quantity,
        applied_price_usd: refundUnitUsd,
        applied_price_khr: refundUnitKhr,
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
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
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
          user_name: actorSnapshot(user),
          // 0084: same single-lot-covers-all rule as the create path.
          batch_id: itemSplits.length === 1 && itemSplits[0].quantity === quantity ? itemSplits[0].batchId : null,
        },
      })
    }
    // Parallel to newItems order -- recorded against the re-inserted
    // return_items after the batch below, same as the create path.
    perItemBatchSplits.push(itemSplits)
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
      // The refund is derived from the sale lines, not accepted from the
      // client: a posted total is exactly the "restate what was paid" the
      // line-level resolution above exists to prevent.
      total_refund_usd: Number(totalRefundUsd.toFixed(2)),
      total_refund_khr: Math.round(totalRefundKhr),
      branch_id: body.branch_id || existing.branch_id,
      branch_name: branchName,
      id,
    },
  })

  await db.batch(statements)

  } catch (error) {
    // Put the stock back exactly where the edit found it (Part-77, same
    // discipline as POST /'s catch -- Part 523). Everything in `statements`
    // rolled back atomically with the failed batch (incl. the return_items
    // rewrite, so the OLD rows are intact); only the per-lot writes above
    // committed on their own. Best-effort per write and LOUDLY reported --
    // anything unreversible reaches the audit log and the 500 message.
    const unreversed: string[] = []
    for (const applied of [...editReappliedRestocks].reverse()) {
      try {
        await removeStockFromBatch(db, { batchId: applied.batchId, productId: applied.productId, branchId: applied.branchId, quantity: applied.quantity })
      } catch (_) {
        unreversed.push(`re-applied restock of ${applied.quantity} into lot #${applied.batchId} (product #${applied.productId})`)
      }
    }
    for (const reversed of [...editReversedRestocks].reverse()) {
      try {
        await receiveBatchStock(db, { productId: reversed.productId, branchId: reversed.branchId, quantity: reversed.quantity, batchId: reversed.batchId })
      } catch (_) {
        unreversed.push(`reversal of ${reversed.quantity} out of lot #${reversed.batchId} (product #${reversed.productId})`)
      }
    }
    if (editCreatedDamaged) {
      // The fresh rows are unconsumed by construction, so this delete-them
      // reversal cannot hit ConsumedDamagedStockError.
      try {
        await reverseDamagedLots(db, id)
      } catch (_) {
        unreversed.push('newly created damaged lots')
      }
    }
    for (const lot of editReversedDamaged) {
      try {
        await createDamagedLot(db, {
          productId: lot.product_id,
          productName: lot.product_name,
          branchId: lot.branch_id,
          batchId: lot.batch_id,
          returnId: id,
          quantity: lot.quantity,
          reason: lot.reason,
          userId: lot.created_by_user_id,
          userName: lot.created_by_user_name,
        })
      } catch (_) {
        unreversed.push(`original damaged lot of ${lot.quantity} (product #${lot.product_id})`)
      }
    }
    if (unreversed.length) {
      await audit(c.env, user?.id ?? null, actorSnapshot(user), 'return_rollback_incomplete', 'return', id, { via: 'edit', unreversed })
    }
    return c.json({
      error: `Failed to update return: ${(error as Error).message}`
        + (unreversed.length
          ? ` -- WARNING: ${unreversed.length} stock write(s) could not be reversed (recorded in the audit log; run Verify Integrity): ${unreversed.join('; ')}`
          : ''),
    }, 500)
  }

  // Record the fresh per-lot split for the re-inserted return_items, same as
  // POST / -- so a subsequent edit reverses the right lots again.
  await recordReturnItemBatchAllocations(db, id, perItemBatchSplits)

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
    const saleState = await db.prepare('SELECT sale_status,status_before_return FROM sales WHERE id=?').get<{ sale_status: string | null; status_before_return: string | null }>([existing.sale_id])
    const newStatus = fullyReturned ? 'returned' : hasAny ? 'partial_return' : (saleState?.status_before_return || 'completed')
    await db.prepare(`UPDATE sales SET
      status_before_return = CASE WHEN COALESCE(sale_status,'completed') NOT IN ('returned','partial_return') THEN COALESCE(sale_status,'completed') ELSE status_before_return END,
      sale_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run([newStatus, existing.sale_id])
  }

  await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'return', id, { reason: body.reason })
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'return_edit', id: Number(id) }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(Promise.all([
    bumpVersion(c.env, 'products'),
    bumpVersion(c.env, 'returns'),
    bumpVersion(c.env, 'sales'),
  ]))
  c.executionCtx.waitUntil(broadcast(c.env, 'returns', { action: 'update', id: Number(id) }))
  if (existing.sale_id) {
    c.executionCtx.waitUntil(broadcast(c.env, 'sales', { action: 'update', id: existing.sale_id }))
  }

  const updated = await db.prepare('SELECT id, updated_at FROM returns WHERE id = ?').get<{ id: number; updated_at: string }>([id])
  return c.json(updated || { id: Number(id) })
})

export default app
