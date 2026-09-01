// D1 (Part 415): the Stock Change ledger's query kernel -- pure SQL/param
// building over the EXISTING inventory_movements history, shared by the
// /products/stock-ledger route and driven directly (compiled, real SQL on
// real migrations) by test-stock-ledger-pure.cjs. No reads here mutate.
//
// Sign semantics MIRROR frontend movementGroups.ts's movementSign(): the
// types below net stock DOWN, everything else nets UP. `quantity` is stored
// as a magnitude by MOST writers (a few store a signed value), so the
// ledger re-derives the sign from movement_type here and the stored sign is
// irrelevant. If a movement_type is ever added there, update this list in
// the same change -- the pure test pins the two lists equal by reading both
// sources.
//
// Part 553: the list was COMPLETED. `move_out` (move-row out leg),
// `damage_out` (damaged goods pulled off sellable stock), `replacement_out`
// (exchange replacement given out) and the CSV-import `out` string were all
// missing, so those genuine outflows were mis-counted as Stock In -- part of
// the reported "70+ in vs very few out" skew was this bug, not just data.
// `row_move_out` and `write_off` are kept for any legacy rows even though
// current code writes `move_out` / `return_reversal` instead.
import { localDateAtOrAfter, localDateAtOrBefore } from './businessDateWindow'

export const LEDGER_OUT_TYPES = [
  'remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
  'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out',
] as const

// Part 553: the ledger is now a two-column In / Out split (user, Aug 31:
// "remove the Adjustments mini section since everything seems to move to
// stock out or stock in"). Every movement classifies as Out when its type is
// in LEDGER_OUT_TYPES, else In -- so the former 'adjustment'/'set' rows fold
// into In. That is truthful for the only two writers of those types: a
// duplicate-merge 'adjustment' is a real stock carry-in, and a legacy batch
// 'set' correction lost its direction at write time (batches.ts stores
// Math.abs(delta)), so the ledger can only show the increase its stored
// magnitude implies -- that write-path sign loss is flagged separately.
export type StockLedgerView = 'all' | 'in' | 'out'

export type StockLedgerFilters = {
  view?: StockLedgerView
  productId?: number
  branchId?: number
  startDate?: string
  endDate?: string
  search?: string
  // D2a (0084): filter by the supplier attributed to the movement's lot.
  // Only movements stamped with a batch_id can match -- unattributed rows
  // (multi-lot, legacy aggregate) are honestly excluded, never guessed in.
  supplierId?: number
}

export type StockLedgerQuery = {
  whereSql: string
  // The same filters WITHOUT the In/Out view predicate. The stats summary
  // always reports BOTH columns for the current date/search/branch/supplier
  // scope, regardless of which view chip is selected, so the person can see
  // the In-vs-Out breakdown that explains an imbalance.
  baseWhereSql: string
  params: Record<string, unknown>
  countSql: string
  rowsSql: string
  summarySql: string
}

const OUT_LIST = LEDGER_OUT_TYPES.map((t) => `'${t}'`).join(', ')

// One join clause, shared by every statement below so the row list, the
// count and the summary can never join differently (the supplier filter and
// the barcode search both reach through these joins).
const LEDGER_FROM = `
    FROM inventory_movements m
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN product_batches b ON b.id = m.batch_id`

export function buildStockLedgerQuery(filters: StockLedgerFilters = {}): StockLedgerQuery {
  // Base filters: everything EXCEPT the In/Out view predicate, kept separate
  // so the stats summary can report both columns over the same scope while
  // the row list narrows to the selected view.
  const base: string[] = []
  const params: Record<string, unknown> = {}
  const productId = Number(filters.productId) || 0
  const branchId = Number(filters.branchId) || 0
  if (productId > 0) { base.push('m.product_id = @productId'); params.productId = productId }
  if (branchId > 0) { base.push('m.branch_id = @branchId'); params.branchId = branchId }
  // Inclusive LOCAL (UTC+7) calendar-day bounds on the stored-UTC timestamp.
  // date(m.created_at,'+7 hours') is the shape-agnostic precise check
  // (inventory_movements.created_at is a MIX of ISO 'T'/'Z' and space forms, and
  // a raw string comparison would misfile the ISO rows); it is AND-ed with a
  // sargable date-only pre-filter on the raw column so
  // idx_inventory_movements_created_pg is still used instead of a full scan of
  // every movement row (see businessDateWindow.ts; proven in
  // test-stock-ledger-daterange-pure.cjs).
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.startDate || '')) ? String(filters.startDate) : ''
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.endDate || '')) ? String(filters.endDate) : ''
  if (startDate) { base.push(localDateAtOrAfter('m.created_at')); params.startDate = startDate }
  if (endDate) { base.push(localDateAtOrBefore('m.created_at')); params.endDate = endDate }
  const search = String(filters.search || '').trim().slice(0, 120)
  if (search) {
    // LIKE with ESCAPE, auditLogQuery.ts convention: user text matches
    // literally, % and _ included.
    base.push(`(m.product_name LIKE @search ESCAPE '\\' OR p.barcode LIKE @search ESCAPE '\\')`)
    params.search = `%${search.replace(/([\\%_])/g, '\\$1')}%`
  }
  const supplierId = Number(filters.supplierId) || 0
  if (supplierId > 0) {
    // Same supplier identity rule as D1b/D3: a lot matches by supplier_id
    // when attributed, else by its recorded name equalling that supplier's
    // name (name-only attribution -- D5a's match-only rule means the name
    // was a real suppliers-table match at receive time). Rows without a
    // batch_id cannot match: their lot -- and so their supplier -- was
    // never recorded, and guessing is worse than excluding.
    base.push(`(b.supplier_id = @supplierId OR (b.supplier_id IS NULL AND b.supplier_name IS NOT NULL
      AND lower(trim(b.supplier_name)) = (SELECT lower(trim(name)) FROM suppliers WHERE id = @supplierId)))`)
    params.supplierId = supplierId
  }
  const baseWhereSql = base.length ? `WHERE ${base.join(' AND ')}` : ''

  // The In/Out view predicate -- 'in' is everything that is NOT an outflow
  // (so merge carry-ins and legacy adjustments fold into In), 'out' is the
  // outflow types. Any other value (including the retired 'adjustments')
  // falls through to 'all'.
  const view: StockLedgerView = filters.view === 'in' || filters.view === 'out' ? filters.view : 'all'
  const viewPredicate = view === 'in'
    ? `m.movement_type NOT IN (${OUT_LIST})`
    : view === 'out'
      ? `m.movement_type IN (${OUT_LIST})`
      : ''
  const whereClauses = viewPredicate ? [...base, viewPredicate] : base
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const countSql = `
    SELECT COUNT(*) AS total${LEDGER_FROM}
    ${whereSql}
  `

  // after_qty: walk BACKWARD from the product's CURRENT stock (the one
  // authoritative number) through every movement NEWER than this row;
  // before_qty = after_qty - signed delta (added by the caller in JS).
  // Movements store no before/after; deriving from current stock stays
  // consistent even where pre-migration history is a snapshot with no
  // movement rows -- the oldest derived "before" then reads as the
  // baseline the recorded actions imply: the honest best available
  // number, never a fabricated one. Correlated per page row (<=100) over
  // idx_inventory_movements_product_created_pg.
  const rowsSql = `
    SELECT
      m.id, m.product_id, m.product_name, p.barcode, p.unit,
      m.branch_id, m.branch_name, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS quantity,
      CASE WHEN m.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(m.quantity, 0)) ELSE ABS(COALESCE(m.quantity, 0)) END AS signed_quantity,
      m.reason, m.reference_id, m.user_name, m.created_at,
      m.batch_id, b.lot_code AS batch_lot_code, b.received_at AS batch_received_at,
      b.supplier_id AS batch_supplier_id, b.supplier_name AS batch_supplier_name,
      CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 'out' ELSE 'in' END AS ledger_bucket,
      COALESCE(p.stock_quantity, 0) - COALESCE((
        SELECT SUM(CASE WHEN mn.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(mn.quantity, 0)) ELSE ABS(COALESCE(mn.quantity, 0)) END)
        FROM inventory_movements mn
        WHERE mn.product_id = m.product_id
          AND (mn.created_at > m.created_at OR (mn.created_at = m.created_at AND mn.id > m.id))
      ), 0) AS after_qty${LEDGER_FROM}
    ${whereSql}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT @limit OFFSET @offset
  `

  // Stats summary: one row carrying the In vs Out record counts and
  // magnitude totals over the BASE scope (it deliberately ignores the view
  // chip so the split is always visible -- that is what the user wants shown
  // inline instead of behind a Stats expander). Same joins as the row list
  // so the supplier/barcode filters resolve identically.
  const summarySql = `
    SELECT
      SUM(CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 0 ELSE 1 END) AS in_count,
      SUM(CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 1 ELSE 0 END) AS out_count,
      SUM(CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 0 ELSE ABS(COALESCE(m.quantity, 0)) END) AS in_qty,
      SUM(CASE WHEN m.movement_type IN (${OUT_LIST}) THEN ABS(COALESCE(m.quantity, 0)) ELSE 0 END) AS out_qty,
      COUNT(*) AS total${LEDGER_FROM}
    ${baseWhereSql}
  `

  return { whereSql, baseWhereSql, params, countSql, rowsSql, summarySql }
}

// before_qty derivation shared by the route and the test: one place owns
// the "before = after - signed" arithmetic.
export function attachBeforeQty<T extends { signed_quantity?: unknown; after_qty?: unknown }>(rows: T[]): Array<T & { before_qty: number }> {
  return (rows || []).map((row) => {
    const signed = Number(row.signed_quantity || 0)
    const after = Number(row.after_qty || 0)
    return { ...row, before_qty: after - signed }
  })
}
