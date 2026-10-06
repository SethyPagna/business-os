// Stock notifications are SALE EVENTS (NOTIF-V2, owner 6 Oct 2026): "the
// notification should trigger if the stock when make sale shows in low stock or
// out of stock, instead of showing everything in notifications."
//
// WHAT COUNTS AS A CROSSING. The Dashboard's low / out-of-stock cards classify a
// product FAMILY (same name key, lib/familyStockStats.ts) by "best status wins"
// over its members' products.stock_quantity:
//   healthy (2) -- some member is above BOTH its out-of-stock and low thresholds
//   low     (1) -- none healthy, some member above out-of-stock but at/under low
//   out     (0) -- every member at/under its out-of-stock threshold
// A sale CROSSES when the family's rank after the sale is lower than before it:
// healthy -> low, healthy -> out, low -> out. Nothing else notifies: a sale on a
// family that is already low (or already out) leaves the rank where it was, and
// a restock lifts the rank so the NEXT sale that drops it again is a new
// crossing. Thresholds come from lowStockThresholdSql / out_of_stock_threshold,
// the same fragments the Dashboard SQL uses, so the card and the bell agree.
//
// WHERE IT RUNS. planSaleStockAlertStatement() is ONE INSERT ... SELECT that the
// sale routes put in the SAME atomic D1 batch as the stock deductions, BEFORE
// the first of them. Placed there it reads the true pre-sale rollup
// (products.stock_quantity, the figure the Dashboard classifies) and derives the
// post-sale figure the way the deduction statements do: `MAX(0, stock - units)`
// for units taken, `stock + units` for units given back. That is exact even when
// two sales race (D1 serialises batches), and it does not misreport a rollup the
// clamp held at 0: a rollup that was already 0 while a branch still held units
// stays 0, so no crossing happened and none is written. (Working backwards from
// the post-sale rollup, "after + units", cannot tell a clamped deduction from a
// whole one.) A rolled-back sale leaves no event; a committed sale always has
// its event. Manual adjustments, transfers, imports and returns never call it.
//
// COST. The statement touches only the sold products' families: an indexed
// name_key / parent_id probe per family, then a primary-key lookup per member.
// `candidates CROSS JOIN products` pins that order: left to itself SQLite
// scanned every active product (idx_products_active_grouped_pg) and built an
// automatic index over the candidates, so a sale paid for the whole catalog.
// test-sale-stock-alert-cost-native.cjs pins the plan and the rows read.
import type { LowStockConfig } from './lowStockSettings'
import { lowStockThresholdSql } from './lowStockSettings'
import { FAMILY_ROOT_KEY_SQL } from './familyPagination'

/**
 * Net units one batch took out of branch stock for a product: positive when it
 * deducted, negative when the same batch gave units back (a replaced line
 * restores one product while its replacement deducts another).
 */
export type SaleStockAlertLine = { product_id: number; branch_id: number | null; quantity: number }
/** The sale that caused the crossing: by id, by its create-batch write key, or null for a group action over several sales. */
export type SaleStockAlertSale = { saleId: number | null } | { saleWriteKey: string }
type Statement = { sql: string; params: Record<string, unknown> }

/** How far back the bell looks. An event older than this has been seen or is the Dashboard's job. */
export const STOCK_ALERT_WINDOW_DAYS = 3
/** Matches the scheduled retention sweep in lib/ephemeralRetention.ts. */
export const STOCK_ALERT_RETENTION_DAYS = 30

// Same member rule as familyStockStats.ts: active rows, group-header
// placeholders excluded, family identity from FAMILY_ROOT_KEY_SQL.
const MEMBER_ELIGIBLE_SQL = `p.is_active = 1 AND NOT (COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0)`

/**
 * `candidates` + `members` CTEs for the families named by a `roots(family_root_id)`
 * CTE the caller defines. Candidates are found through the name_key and
 * parent_id indexes (and the row id for a nameless 'id:<n>' family); `members`
 * then applies the exact FAMILY_ROOT_KEY_SQL equality, so the family is the
 * Dashboard's family and the index probes are only a way to reach it cheaply.
 *
 * `qty.before` / `qty.after` are the member's quantity before and after the
 * batch's deduction (SQL over `p`); the read side has no deduction and passes
 * the current quantity for both.
 */
function familyMembersCtes(lowStock: LowStockConfig, qty: { before: string; after: string }): string {
  return `
    candidates AS (
      SELECT p.id AS id, r.family_root_id AS family_root_id
        FROM roots r CROSS JOIN products p ON p.name_key = r.family_root_id
      UNION
      SELECT c.id, r.family_root_id
        FROM roots r CROSS JOIN products par ON par.name_key = r.family_root_id
        CROSS JOIN products c ON c.parent_id = par.id
      UNION
      SELECT p.id, r.family_root_id
        FROM roots r CROSS JOIN products p ON r.family_root_id LIKE 'id:%' AND p.id = CAST(substr(r.family_root_id, 4) AS INTEGER)
      UNION
      SELECT p.id, r.family_root_id
        FROM roots r CROSS JOIN products p ON r.family_root_id LIKE 'id:%' AND p.parent_id = CAST(substr(r.family_root_id, 4) AS INTEGER)
    ),
    members AS (
      SELECT cand.family_root_id,
             ${qty.after} AS qty_after,
             ${qty.before} AS qty_before,
             COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
             ${lowStockThresholdSql(lowStock, 'p.low_stock_threshold')} AS low_threshold
      FROM candidates cand
      CROSS JOIN products p ON p.id = cand.id
      LEFT JOIN products parent ON parent.id = p.parent_id
      WHERE ${MEMBER_ELIGIBLE_SQL}
        AND ${FAMILY_ROOT_KEY_SQL} = cand.family_root_id
    )`
}

/** Net units per product+branch, so two lines of one product count once and a restore cancels a deduction of the same product. */
export function aggregateSaleStockAlertLines(lines: SaleStockAlertLine[]): SaleStockAlertLine[] {
  const merged = new Map<string, SaleStockAlertLine>()
  for (const line of lines) {
    const productId = Number(line.product_id)
    const quantity = Number(line.quantity)
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity === 0) continue
    const branchId = line.branch_id == null ? null : Number(line.branch_id)
    const key = `${productId}:${branchId ?? ''}`
    const existing = merged.get(key)
    if (existing) existing.quantity += quantity
    else merged.set(key, { product_id: productId, branch_id: branchId, quantity })
  }
  return [...merged.values()].filter((line) => line.quantity !== 0)
}

/**
 * The crossing INSERT for one sale batch, or null when no line took stock out.
 * Must sit in the same db.batch BEFORE its first branch_stock /
 * products.stock_quantity statement (see `insertStockAlertStatement`): it reads
 * the pre-sale rollup. `lines` must be exactly the units the batch moves (the
 * callers pass the same list they built the stock statements from, so the two
 * cannot disagree).
 */
export function planSaleStockAlertStatement(input: {
  lines: SaleStockAlertLine[]
  lowStock: LowStockConfig
  sale: SaleStockAlertSale
}): Statement | null {
  const lines = aggregateSaleStockAlertLines(input.lines)
  if (!lines.length) return null
  // One JSON parameter instead of three per line keeps the statement inside
  // D1's 100-bound-parameter ceiling however many products a sale carries.
  const payload = JSON.stringify(lines.map((line) => ({ p: line.product_id, b: line.branch_id, q: line.quantity })))
  const saleIdSql = 'saleId' in input.sale
    ? '@alert_sale_id'
    : `(SELECT id FROM sales WHERE client_request_id = @alert_sale_write_key AND client_request_id <> '')`
  const params: Record<string, unknown> = { alert_lines: payload }
  if ('saleId' in input.sale) params.alert_sale_id = input.sale.saleId
  else params.alert_sale_write_key = input.sale.saleWriteKey
  return {
    sql: `
    WITH lines AS (
      SELECT CAST(json_extract(j.value, '$.p') AS INTEGER) AS product_id,
             CAST(json_extract(j.value, '$.b') AS INTEGER) AS branch_id,
             CAST(json_extract(j.value, '$.q') AS REAL) AS qty
      FROM json_each(@alert_lines) j
    ),
    sold AS (
      SELECT l.product_id, MIN(l.branch_id) AS branch_id, ${FAMILY_ROOT_KEY_SQL} AS family_root_id
      FROM lines l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN products parent ON parent.id = p.parent_id
      GROUP BY l.product_id
    ),
    roots AS (SELECT DISTINCT family_root_id FROM sold),
    ${familyMembersCtes(input.lowStock, {
      before: 'COALESCE(p.stock_quantity, 0)',
      // Units taken clamp at 0 exactly like the deduction statements; units given back add.
      after: `CASE WHEN COALESCE((SELECT SUM(l.qty) FROM lines l WHERE l.product_id = p.id), 0) > 0
                   THEN MAX(0, COALESCE(p.stock_quantity, 0) - (SELECT SUM(l.qty) FROM lines l WHERE l.product_id = p.id))
                   ELSE COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(l.qty) FROM lines l WHERE l.product_id = p.id), 0) END`,
    })},
    families AS (
      SELECT family_root_id,
             SUM(qty_after) AS total_after,
             CASE WHEN MAX(CASE WHEN qty_after > out_threshold AND qty_after > low_threshold THEN 1 ELSE 0 END) = 1 THEN 2
                  WHEN MAX(CASE WHEN qty_after > out_threshold AND qty_after <= low_threshold THEN 1 ELSE 0 END) = 1 THEN 1
                  ELSE 0 END AS rank_after,
             CASE WHEN MAX(CASE WHEN qty_before > out_threshold AND qty_before > low_threshold THEN 1 ELSE 0 END) = 1 THEN 2
                  WHEN MAX(CASE WHEN qty_before > out_threshold AND qty_before <= low_threshold THEN 1 ELSE 0 END) = 1 THEN 1
                  ELSE 0 END AS rank_before
      FROM members
      GROUP BY family_root_id
    ),
    representative AS (
      SELECT family_root_id, MIN(product_id) AS product_id, branch_id FROM sold GROUP BY family_root_id
    )
    INSERT INTO stock_alert_events (family_root_id, product_id, product_name, branch_id, alert_state, quantity_after, sale_id)
    SELECT f.family_root_id, rep.product_id, p.name, rep.branch_id,
           CASE f.rank_after WHEN 0 THEN 'out' ELSE 'low' END,
           f.total_after, ${saleIdSql}
    FROM families f
    JOIN representative rep ON rep.family_root_id = f.family_root_id
    JOIN products p ON p.id = rep.product_id
    WHERE f.rank_after < f.rank_before`,
    params,
  }
}

/**
 * Put the alert statement into a batch's statement list ahead of the first stock
 * statement (`stockStart` is the list length before that statement was pushed).
 * Only statements already queued before `stockStart` keep their position, so a
 * caller that remembers an index of a LATER statement must read it after this.
 */
export function insertStockAlertStatement(statements: Statement[], stockStart: number, alert: Statement | null): void {
  if (alert) statements.splice(Math.min(Math.max(0, stockStart), statements.length), 0, alert)
}

export type StockAlertFeedRow = {
  id: number
  product_id: number
  product_name: string | null
  branch_id: number | null
  branch_name: string | null
  alert_state: 'low' | 'out'
  quantity_after: number
  total_now: number
  sale_id: number | null
  receipt_number: string | null
  created_at: string
  out_total: number
  matched_total: number
}

/**
 * The bell's stock feed: the newest event per family inside the window, kept
 * only while the family is STILL in the state that event announced (an event
 * whose family was restocked, or has since got worse, is not the current
 * story). Out events first, then newest. `matched_total` / `out_total` are
 * window aggregates over the rows that passed the filter, so the section's
 * count is exact even when only `@limit` rows come back.
 * Params: @since (UTC 'YYYY-MM-DD HH:MM:SS'), @limit.
 */
export function stockAlertFeedSql(lowStock: LowStockConfig): string {
  return `
    WITH recent AS (
      SELECT id, family_root_id, product_id, product_name, branch_id, alert_state, quantity_after, sale_id, created_at,
             ROW_NUMBER() OVER (PARTITION BY family_root_id ORDER BY id DESC) AS recency
      FROM stock_alert_events
      WHERE created_at >= @since
    ),
    latest AS (SELECT * FROM recent WHERE recency = 1),
    roots AS (SELECT family_root_id FROM latest),
    ${familyMembersCtes(lowStock, { before: 'COALESCE(p.stock_quantity, 0)', after: 'COALESCE(p.stock_quantity, 0)' })},
    families AS (
      SELECT family_root_id,
             SUM(qty_after) AS total_now,
             MAX(CASE WHEN qty_after > out_threshold AND qty_after > low_threshold THEN 1 ELSE 0 END) AS has_healthy,
             MAX(CASE WHEN qty_after > out_threshold AND qty_after <= low_threshold THEN 1 ELSE 0 END) AS has_low
      FROM members
      GROUP BY family_root_id
    )
    SELECT l.id, l.product_id, l.product_name, l.branch_id, b.name AS branch_name, l.alert_state,
           l.quantity_after, f.total_now, l.sale_id, s.receipt_number, l.created_at,
           SUM(CASE WHEN l.alert_state = 'out' THEN 1 ELSE 0 END) OVER () AS out_total,
           COUNT(*) OVER () AS matched_total
    FROM latest l
    JOIN families f ON f.family_root_id = l.family_root_id
    LEFT JOIN sales s ON s.id = l.sale_id
    LEFT JOIN branches b ON b.id = l.branch_id
    WHERE (l.alert_state = 'out' AND f.has_healthy = 0 AND f.has_low = 0)
       OR (l.alert_state = 'low' AND f.has_healthy = 0 AND f.has_low = 1)
    ORDER BY CASE l.alert_state WHEN 'out' THEN 0 ELSE 1 END, l.id DESC
    LIMIT @limit`
}
