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
  // One row by id: a Revert's "#N" link opens the row it reverts (and the
  // original its Revert) through the same kernel, so it carries every field.
  movementId?: number
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

/**
 * REVERT-FIX F4 (owner, 30 Sep 2026): a Revert is its own record. These read
 * the link from the immutable reference_id ('revert:<id>', lib/stockRevert.ts),
 * never from the editable reason: the row this Revert reverts, and the Revert
 * that reverted this row (one at most -- a second revert is refused).
 */
export function revertsMovementIdSql(movement: string): string {
  return `CASE WHEN ${movement}.reference_id = 'revert:' || CAST(CAST(SUBSTR(${movement}.reference_id, 8) AS INTEGER) AS TEXT)
    THEN CAST(SUBSTR(${movement}.reference_id, 8) AS INTEGER) END`
}

export function revertedByMovementIdSql(movement: string): string {
  return `(SELECT MIN(rv.id) FROM inventory_movements rv WHERE rv.reference_id = 'revert:' || CAST(${movement}.id AS TEXT))`
}

/** A movement's quantity with the direction its type implies (see LEDGER_OUT_TYPES). */
export function movementSignedQuantitySql(movement: string): string {
  return `CASE WHEN ${movement}.movement_type IN (${OUT_LIST}) THEN -ABS(COALESCE(${movement}.quantity, 0)) ELSE ABS(COALESCE(${movement}.quantity, 0)) END`
}

// A movement's INSTANT, for ordering. inventory_movements.created_at is a mix
// of 'YYYY-MM-DD HH:MM:SS' (CURRENT_TIMESTAMP writers) and ISO
// 'YYYY-MM-DDTHH:MM:SS.sssZ' (writers that stamp from JS). As raw strings an
// ISO row sorts AFTER every space-form row of the same day ('T' > ' '), so a
// sale synced late with an earlier ISO stamp was walked as the NEWEST
// movement. strftime normalises both (UTC, milliseconds kept); a value it
// cannot parse falls back to the raw string rather than vanishing.
export function movementInstantSql(movement: string): string {
  return `COALESCE(strftime('%Y-%m-%d %H:%M:%f', ${movement}.created_at), ${movement}.created_at)`
}

// The raw-string floor that keeps a walk a RANGE SEEK on
// idx_inventory_movements_product_created_pg while it compares instants: any
// row whose instant is at or after this one's has a raw created_at at or
// after the day BEFORE this one's UTC date, whichever format either row uses
// (the day of slack covers a stamp written with a local offset). The precise
// instant comparison then runs on the rows the seek returns.
function movementSeekFloorSql(movement: string): string {
  return `COALESCE(date(${movement}.created_at, '-1 day'), '')`
}

// The two legs of a branch transfer (transferOperation.ts writes them, and
// their reversal on undo, in ONE batch: same timestamp, contiguous ids, and
// the same product unless the stock lands on another product row). Owner,
// 26 Sep: Shop retires into Warehouse through exactly these rows.
const TRANSFER_LIST = `'transfer_out', 'transfer_in'`
function transferLegSql(movement: string): string {
  return `${movement}.movement_type IN (${TRANSFER_LIST})`
}

// after_qty: walk BACKWARD from the product's CURRENT stock (the one
// authoritative number) through every movement NEWER than this row;
// before_qty = after_qty - the row's total delta (attachBeforeQty below).
// Movements store no before/after; deriving from current stock stays
// consistent even where pre-migration history is a snapshot with no
// movement rows -- the oldest derived "before" then reads as the
// baseline the recorded actions imply: the honest best available
// number, never a fabricated one. Correlated per row over
// idx_inventory_movements_product_created_pg.
//
// "Newer" is by instant (movementInstantSql), then id. The legs of ONE
// transfer are one event: the product's total never passes through a state
// where the stock has left Shop but not reached Warehouse, so no leg of a
// transfer is newer than another, and every leg reads the total before and
// after the WHOLE transfer (movementTotalDeltaSql) -- unchanged for a transfer
// between branches of one product row, moved for one that lands on another
// row. The branch pair is still walked leg by leg (a leg really moves its
// branch).
//
// ONE definition for every surface that shows a movement's before -> after
// (the Stock Changes ledger and every record float), so the same movement
// can never read two different balances on two screens; the set-based
// MOVEMENT_STOCK_BALANCES_SQL below is pinned equal to it.
export function movementStockAfterSql(movement: string, product: string): string {
  return `COALESCE(${product}.stock_quantity, 0) - COALESCE((
        SELECT SUM(${movementSignedQuantitySql('mn')})
        FROM inventory_movements mn
        WHERE mn.product_id = ${movement}.product_id
          AND mn.created_at >= ${movementSeekFloorSql(movement)}
          AND (${movementInstantSql('mn')} > ${movementInstantSql(movement)}
            OR (${movementInstantSql('mn')} = ${movementInstantSql(movement)} AND mn.id > ${movement}.id
              AND NOT (${transferLegSql('mn')} AND ${transferLegSql(movement)})))
      ), 0)`
}

/** What the movement did to the product's TOTAL: its own signed quantity, or for a transfer leg the net of every leg of that transfer on the product. */
export function movementTotalDeltaSql(movement: string): string {
  return `CASE WHEN ${transferLegSql(movement)} THEN COALESCE((
        SELECT SUM(${movementSignedQuantitySql('mt')})
        FROM inventory_movements mt
        WHERE mt.product_id = ${movement}.product_id
          AND mt.created_at >= ${movementSeekFloorSql(movement)}
          AND mt.created_at < COALESCE(date(${movement}.created_at, '+2 day'), '9999')
          AND ${transferLegSql('mt')}
          AND ${movementInstantSql('mt')} = ${movementInstantSql(movement)}
      ), 0) ELSE ${movementSignedQuantitySql(movement)} END`
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
 *             movementStockAfterSql defines "newer" (instant, then id; the
 *             legs of one transfer are ONE event -- a GROUPS frame over
 *             event_id -- so a transfer between branches reads the total
 *             unchanged on both legs).
 *             Identical to the Stock Changes ledger's correlated expression
 *             (proved on the real migration chain by
 *             scripts/test-stock-in-line-balance-pure.cjs).
 *   branch -- the same walk partitioned by (product, branch), starting from
 *             that branch's branch_stock row. When the movement has no
 *             branch, the branch has no branch_stock row (nothing to start
 *             from), or a NEWER movement of the product has no branch (its
 *             branch cannot be walked back through), the branch pair is
 *             null: the caller shows "—", never a guess.
 *
 * The ids travel as ONE bound JSON array (@movementIds via json_each), so the
 * statement never chunks against D1's bound-parameter cap. For the products
 * those movements touch it range-reads each product's movements from the day
 * before the oldest requested one onward (movementSeekFloorSql, over
 * idx_inventory_movements_product_created_pg) -- rows older than a target
 * never enter its newer-than sums, so the slack costs only reading;
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
      SELECT product_id, MIN(${movementSeekFloorSql('target')}) AS since
      FROM target
      WHERE product_id IS NOT NULL AND created_at IS NOT NULL
      GROUP BY product_id
    ),
    span AS (
      SELECT mn.id, mn.product_id, mn.branch_id,
             ${movementSignedQuantitySql('mn')} AS signed_quantity,
             ${movementInstantSql('mn')} AS instant,
             CASE WHEN ${transferLegSql('mn')} THEN 1 ELSE 0 END AS transfer_leg
      FROM scope s
      JOIN inventory_movements mn ON mn.product_id = s.product_id AND mn.created_at >= s.since
    ),
    event AS (
      SELECT sp.*,
             CASE WHEN transfer_leg = 1 THEN MIN(id) OVER (PARTITION BY product_id, instant, transfer_leg) ELSE id END AS event_id,
             CASE WHEN transfer_leg = 1 THEN SUM(signed_quantity) OVER (PARTITION BY product_id, instant, transfer_leg) ELSE signed_quantity END AS total_delta
      FROM span sp
    ),
    walk AS (
      SELECT id, product_id, branch_id, signed_quantity, total_delta,
             SUM(signed_quantity) OVER (
               PARTITION BY product_id
               ORDER BY instant DESC, event_id DESC
               GROUPS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS newer_sum,
             SUM(signed_quantity) OVER (
               PARTITION BY product_id, branch_id
               ORDER BY instant DESC, id DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS branch_newer_sum,
             SUM(CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END) OVER (
               PARTITION BY product_id
               ORDER BY instant DESC, id DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS newer_unbranched
      FROM event
    )
    SELECT w.id, w.branch_id, w.signed_quantity, w.total_delta,
           COALESCE(p.stock_quantity, 0) - COALESCE(w.newer_sum, 0) AS after_qty,
           CASE WHEN w.branch_id IS NULL OR bs.quantity IS NULL OR COALESCE(w.newer_unbranched, 0) > 0 THEN NULL
                ELSE bs.quantity - COALESCE(w.branch_newer_sum, 0) END AS branch_after_qty,
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
  const rows = await db.prepare(MOVEMENT_STOCK_BALANCES_SQL).all<{ id: number; signed_quantity: number; total_delta: number; after_qty: number; branch_after_qty: number | null; active_branch_count: number }>({ movementIds: JSON.stringify(ids) })
  let activeBranchCount: number | null = null
  for (const row of attachBeforeQty(rows)) {
    // the total moves by the whole event (attachBeforeQty reads total_delta);
    // the branch moves by this leg alone
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
  const movementId = Number(filters.movementId) || 0
  if (movementId > 0) { base.push('m.id = @movementId'); params.movementId = movementId }
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

  // The page is ordered by INSTANT (movementInstantSql), then id -- the order
  // the before/after walk uses -- so each row's "before" is the next older
  // row's "after". The raw created_at string is not that order: it mixes
  // 'YYYY-MM-DD HH:MM:SS' and ISO '...T...Z', and within one day every ISO
  // row sorts after every space-form row ('T' > ' ').
  //
  // Sorting the whole filtered history by an expression would give up the
  // ordered index walk that makes LIMIT/OFFSET cheap, so the page is found
  // in two index steps instead. Both forms are UTC and share the UTC date as
  // their first 10 characters, and raw strings order the DATES correctly --
  // they disagree with the instant only WITHIN a day. So the rows on each
  // date are the same in both orders, position for position:
  //   raw_page    the page in raw order, an ordered walk of
  //               idx_inventory_movements_created_pg -> its dates [lo, hi];
  //   page        the rows dated lo..hi (a range seek), sorted by instant,
  //               skipping those that precede the page: @offset minus the
  //               rows dated after hi (a range count) -- rows dated after hi
  //               precede the page in both orders.
  // Only the page's rows then run the correlated walk below.
  const windowWhere = (extra: string) => `WHERE ${[...whereClauses, extra].join(' AND ')}`
  const rowsSql = `
    WITH raw_page AS (
      SELECT m.created_at${LEDGER_FROM}
      ${whereSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT @limit OFFSET @offset
    ),
    day_window AS (
      SELECT MIN(substr(created_at, 1, 10)) AS lo, MAX(substr(created_at, 1, 10)) AS hi,
             MAX(created_at IS NULL) AS has_null
      FROM raw_page
    ),
    -- two arms, not one OR, so the date range stays a seek; a NULL
    -- created_at (the column allows it) sorts last in both orders
    page_rows AS (
      SELECT m.id, ${movementInstantSql('m')} AS instant${LEDGER_FROM}
      ${windowWhere(`m.created_at >= (SELECT lo FROM day_window) AND m.created_at < (SELECT hi FROM day_window) || '~'`)}
      UNION ALL
      SELECT m.id, NULL AS instant${LEDGER_FROM}
      ${windowWhere(`m.created_at IS NULL AND (SELECT has_null FROM day_window) = 1`)}
    ),
    page AS (
      SELECT id, instant FROM page_rows
      ORDER BY instant DESC, id DESC
      LIMIT @limit OFFSET MAX(0, @offset - (
        SELECT COUNT(*)${LEDGER_FROM}
        ${windowWhere(`m.created_at >= (SELECT CASE WHEN hi IS NULL THEN '' ELSE hi || '~' END FROM day_window)`)}
      ))
    )
    SELECT
      m.id, m.product_id, m.product_name, p.barcode, p.unit, p.brand, p.category, p.tag_label,
      m.branch_id, ${movementBranchNameSql('m')} AS branch_name, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS quantity,
      ${movementSignedQuantitySql('m')} AS signed_quantity,
      m.unit_cost_usd, m.unit_cost_khr, m.total_cost_usd, m.total_cost_khr,
      m.reason, m.reference_id, ${movementActorNameSql('m')} AS user_name, m.created_at,
      ${revertsMovementIdSql('m')} AS reverts_movement_id, ${revertedByMovementIdSql('m')} AS reverted_by_movement_id,
      ${movementReferenceSelectSql('m')},
      m.batch_id, b.lot_code AS batch_lot_code, b.received_at AS batch_received_at,
      b.supplier_id AS batch_supplier_id, b.supplier_name AS batch_supplier_name,
      b.payment_status AS batch_payment_status, b.credit_due_date AS batch_credit_due_date,
      b.unit_cost_usd AS batch_unit_cost_usd, b.received_cost_usd AS batch_received_cost_usd,
      b.expiry_date AS batch_expiry_date, b.updated_at AS batch_updated_at,
      (SELECT COUNT(DISTINCT COALESCE(mx.reference_id, -mx.id))
       FROM inventory_movements mx
       WHERE mx.batch_id = m.batch_id AND mx.movement_type IN (${RECEIPT_LIST})
         AND (mx.reference_id IS NULL OR CAST(mx.reference_id AS TEXT) NOT LIKE 'revert:%')) AS batch_receipt_session_count,
      CASE WHEN m.movement_type IN (${OUT_LIST}) THEN 'out' ELSE 'in' END AS ledger_bucket,
      ${movementTotalDeltaSql('m')} AS total_delta,
      ${movementStockAfterSql('m', 'p')} AS after_qty
    FROM page pg
    JOIN inventory_movements m ON m.id = pg.id
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN product_batches b ON b.id = m.batch_id
    ORDER BY pg.instant DESC, m.id DESC
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
// the "before = after - delta" arithmetic. The delta is the row's effect on
// the TOTAL (total_delta: for a transfer leg, its whole transfer) when the
// query selected it, else the row's own signed quantity.
export function attachBeforeQty<T extends { signed_quantity?: unknown; after_qty?: unknown; total_delta?: unknown }>(rows: T[]): Array<T & { before_qty: number }> {
  return (rows || []).map((row) => {
    const delta = row.total_delta == null ? Number(row.signed_quantity || 0) : Number(row.total_delta)
    const after = Number(row.after_qty || 0)
    return { ...row, before_qty: after - delta }
  })
}
