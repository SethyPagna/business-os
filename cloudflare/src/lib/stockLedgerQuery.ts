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
import { localDateAtOrAfter, localDateAtOrBefore, localTimeRangeClause } from './businessDateWindow'
// N13: sale/return-family movements stamp branch_id but not branch_name, so
// the ledger rendered their Branch column empty. Resolved through the id here
// (snapshot-first) -- see lib/movementBranchName.ts for why it is read-side.
import { movementBranchNameSql } from './movementBranchName'
// N13: the acting account's USERNAME, resolved through user_id for the rows
// whose snapshot predates the username rule -- see lib/movementActorName.ts.
import { movementActorNameSql } from './movementActorName'
// N13: the receipt (sales.receipt_number / returns.return_number) that the
// row's reference_id names -- see lib/movementReference.ts for the type
// mapping and why the ambiguous types resolve by product membership.
import { movementReferenceSelectSql } from './movementReference'
import { STOCK_RECEIPT_MOVEMENT_TYPES } from './stockInSessionsQuery'

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
  // Optional local (UTC+7) wall-clock bound, 'HH:MM', ADDITIONAL to the
  // calendar-day bound above (e.g. "every day, but only 9am-6pm shifts").
  // Both must be present and valid to take effect -- see the route's own
  // regex gate, same pattern sales.ts's appendLocalTimeRange already uses.
  // Independent of startDate/endDate: a time-only range with no date bound
  // scopes every day in the ledger to that daily window.
  startTime?: string
  endTime?: string
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
// The receipt types a shared-lot count must see -- 'add' plus the legacy
// 'stock_in' string the unified session used to write (see
// stockInSessionsQuery.ts). Counting only 'add' under-reported the number of
// receipts into a lot, which is exactly the number the header-edit guard
// trusts to decide whether an edit could spill into another session.
const RECEIPT_LIST = STOCK_RECEIPT_MOVEMENT_TYPES.map((t) => `'${t}'`).join(', ')

/** A movement's quantity with the direction its type implies (see LEDGER_OUT_TYPES). */
export function movementSignedQuantitySql(movement: string): string {
  return `CASE WHEN ${movement}.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(${movement}.quantity, 0)) ELSE ABS(COALESCE(${movement}.quantity, 0)) END`
}

// after_qty: walk BACKWARD from the product's CURRENT stock (the one
// authoritative number) through every movement NEWER than this row;
// before_qty = after_qty - signed delta (attachBeforeQty below).
// Movements store no before/after; deriving from current stock stays
// consistent even where pre-migration history is a snapshot with no
// movement rows -- the oldest derived "before" then reads as the
// baseline the recorded actions imply: the honest best available
// number, never a fabricated one. Correlated per row over
// idx_inventory_movements_product_created_pg.
//
// ONE expression for every surface that shows a movement's before -> after
// (the Stock Changes ledger and a stock-in session line), so the same
// movement can never read two different balances on two screens.
export function movementStockAfterSql(movement: string, product: string): string {
  return `COALESCE(${product}.stock_quantity, 0) - COALESCE((
        SELECT SUM(${movementSignedQuantitySql('mn')})
        FROM inventory_movements mn
        WHERE mn.product_id = ${movement}.product_id
          AND (mn.created_at > ${movement}.created_at OR (mn.created_at = ${movement}.created_at AND mn.id > ${movement}.id))
      ), 0)`
}

/**
 * U-records: before/after for an arbitrary set of movement ids (a stock-in
 * session's received lines, a Movements-tab record), SET-BASED -- one
 * statement for any number of lines, never one correlated walk per line.
 *
 * Owner, 26 Sep: before/after shows BOTH numbers -- the movement's own
 * branch first ("Shop 10 -> 7"), the total across branches under it
 * ("Total 18 -> 15"). Both pairs come out of the SAME statement:
 *
 *   total  -- the product's current stock_quantity minus the sum of every
 *             STRICTLY NEWER movement of the product, ordered exactly as
 *             movementStockAfterSql defines "newer" (created_at, then id).
 *             Identical to the Stock Changes ledger's correlated expression
 *             (proved on the real migration chain by
 *             scripts/test-stock-in-line-balance-pure.cjs).
 *   branch -- the same walk partitioned by (product, branch), starting from
 *             that branch's branch_stock row. When the movement has no
 *             branch, or a NEWER movement of the product has none (its
 *             branch cannot be walked back through), the branch pair is
 *             null: the caller shows "—", never a guess.
 *
 * The ids travel as ONE bound JSON array (@movementIds via json_each), so the
 * statement never chunks against D1's bound-parameter cap. For the products
 * those movements touch it range-reads each product's movements from the
 * oldest requested one onward (idx_inventory_movements_product_created_pg);
 * the branch_stock read is the unique (product_id, branch_id) index. The
 * count of ACTIVE branches rides along so a caller can collapse to one line
 * once the business runs a single branch -- derived from data, not a flag.
 */
export const MOVEMENT_STOCK_BALANCES_SQL = `
    WITH target AS (
      SELECT m.id, m.product_id, m.created_at
      FROM inventory_movements m
      WHERE m.id IN (SELECT CAST(value AS INTEGER) FROM json_each(@movementIds))
    ),
    scope AS (
      SELECT product_id, MIN(created_at) AS since
      FROM target
      WHERE product_id IS NOT NULL AND created_at IS NOT NULL
      GROUP BY product_id
    ),
    walk AS (
      SELECT mn.id, mn.product_id, mn.branch_id,
             ${movementSignedQuantitySql('mn')} AS signed_quantity,
             SUM(${movementSignedQuantitySql('mn')}) OVER (
               PARTITION BY mn.product_id
               ORDER BY mn.created_at DESC, mn.id DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS newer_sum,
             SUM(${movementSignedQuantitySql('mn')}) OVER (
               PARTITION BY mn.product_id, mn.branch_id
               ORDER BY mn.created_at DESC, mn.id DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS branch_newer_sum,
             SUM(CASE WHEN mn.branch_id IS NULL THEN 1 ELSE 0 END) OVER (
               PARTITION BY mn.product_id
               ORDER BY mn.created_at DESC, mn.id DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS newer_unbranched
      FROM scope s
      JOIN inventory_movements mn ON mn.product_id = s.product_id AND mn.created_at >= s.since
    )
    SELECT w.id, w.branch_id, w.signed_quantity,
           COALESCE(p.stock_quantity, 0) - COALESCE(w.newer_sum, 0) AS after_qty,
           CASE WHEN w.branch_id IS NULL OR COALESCE(w.newer_unbranched, 0) > 0 THEN NULL
                ELSE COALESCE(bs.quantity, 0) - COALESCE(w.branch_newer_sum, 0) END AS branch_after_qty,
           (SELECT COUNT(*) FROM branches b WHERE COALESCE(b.is_active, 1) = 1) AS active_branch_count
    FROM walk w
    JOIN target t ON t.id = w.id
    LEFT JOIN products p ON p.id = w.product_id
    LEFT JOIN branch_stock bs ON bs.product_id = w.product_id AND bs.branch_id = w.branch_id`

/** The minimal D1 surface loadMovementStockBalances needs (lib/db.ts's D1Compat satisfies it). */
export type MovementBalanceDb = {
  prepare(sql: string): { all<T = Record<string, unknown>>(params?: Record<string, unknown>): Promise<T[]> }
}

/**
 * One movement's stock before -> after, twice. before_qty/after_qty are the
 * TOTAL pair (the name every existing reader already uses); the branch pair
 * is null when it cannot be walked back (see MOVEMENT_STOCK_BALANCES_SQL).
 */
export type MovementStockBalance = {
  before_qty: number
  after_qty: number
  branch_before_qty: number | null
  branch_after_qty: number | null
}

/** The wire shape of a balance: both pairs, the total pair twice (before_qty/after_qty stay for compatibility). */
export function movementBalanceFields(balance: MovementStockBalance | undefined): Record<string, number | null> {
  return {
    before_qty: balance ? balance.before_qty : null,
    after_qty: balance ? balance.after_qty : null,
    total_before_qty: balance ? balance.before_qty : null,
    total_after_qty: balance ? balance.after_qty : null,
    branch_before_qty: balance ? balance.branch_before_qty : null,
    branch_after_qty: balance ? balance.branch_after_qty : null,
  }
}

/**
 * Stock before -> after for each movement id, branch and total, in ONE
 * statement regardless of how many ids (the session-lines route's speed test
 * counts the prepares). Ids without a derivable balance are absent from the
 * map; activeBranchCount is null when nothing was read.
 */
export async function loadMovementStockBalances(db: MovementBalanceDb, movementIds: readonly number[]): Promise<{ balances: Map<number, MovementStockBalance>; activeBranchCount: number | null }> {
  const balances = new Map<number, MovementStockBalance>()
  const ids = [...new Set(movementIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return { balances, activeBranchCount: null }
  const rows = await db.prepare(MOVEMENT_STOCK_BALANCES_SQL).all<{ id: number; signed_quantity: number; after_qty: number; branch_after_qty: number | null; active_branch_count: number }>({ movementIds: JSON.stringify(ids) })
  let activeBranchCount: number | null = null
  for (const row of attachBeforeQty(rows)) {
    const signed = Number(row.signed_quantity || 0)
    const branchAfter = row.branch_after_qty == null ? null : Number(row.branch_after_qty)
    balances.set(Number(row.id), {
      before_qty: row.before_qty,
      after_qty: Number(row.after_qty),
      branch_before_qty: branchAfter == null ? null : branchAfter - signed,
      branch_after_qty: branchAfter,
    })
    if (activeBranchCount == null && row.active_branch_count != null) activeBranchCount = Number(row.active_branch_count)
  }
  return { balances, activeBranchCount }
}

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
  const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const startTime = String(filters.startTime || '').trim()
  const endTime = String(filters.endTime || '').trim()
  if (LOCAL_TIME_RE.test(startTime) && LOCAL_TIME_RE.test(endTime)) {
    base.push(localTimeRangeClause('m.created_at'))
    params.startTime = startTime
    params.endTime = endTime
  }
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

  const rowsSql = `
    SELECT
      m.id, m.product_id, m.product_name, p.barcode, p.unit, p.brand, p.category, p.tag_label,
      m.branch_id, ${movementBranchNameSql('m')} AS branch_name, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS quantity,
      ${movementSignedQuantitySql('m')} AS signed_quantity,
      m.unit_cost_usd, m.unit_cost_khr, m.total_cost_usd, m.total_cost_khr,
      m.reason, m.reference_id, ${movementActorNameSql('m')} AS user_name, m.created_at,
      ${movementReferenceSelectSql('m')},
      m.batch_id, b.lot_code AS batch_lot_code, b.received_at AS batch_received_at,
      b.supplier_id AS batch_supplier_id, b.supplier_name AS batch_supplier_name,
      b.payment_status AS batch_payment_status, b.credit_due_date AS batch_credit_due_date,
      b.unit_cost_usd AS batch_unit_cost_usd, b.received_cost_usd AS batch_received_cost_usd,
      b.expiry_date AS batch_expiry_date, b.updated_at AS batch_updated_at,
      (SELECT COUNT(DISTINCT COALESCE(mx.reference_id, -mx.id))
       FROM inventory_movements mx
       WHERE mx.batch_id = m.batch_id AND mx.movement_type IN (${RECEIPT_LIST})) AS batch_receipt_session_count,
      CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 'out' ELSE 'in' END AS ledger_bucket,
      ${movementStockAfterSql('m', 'p')} AS after_qty${LEDGER_FROM}
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
