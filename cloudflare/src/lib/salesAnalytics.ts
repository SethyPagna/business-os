// Single source of truth for how "revenue", "COGS", and "profit" are
// defined and computed from sales/sale_items, shared by the Dashboard
// analytics endpoint (routes/compat.ts) and the Sales export/stats
// endpoints (routes/sales.ts). Both previously computed these numbers
// independently and disagreed with each other -- see progress.md for the
// specific bugs this replaces.
//
// Ground truth, read from routes/sales.ts's create-sale handler:
//   sales.subtotal_usd        = SUM of line totals (already net of each
//                                item's own product/manual discount)
//   sales.discount_usd        = cashier-entered whole-sale ("store") discount
//   sales.membership_discount_usd = points-redemption discount
//   sales.tax_usd              = tax charged on the sale
//   sales.total_usd            = subtotal - discount - membership_discount + tax
//                                 + customer-paid delivery_fee_usd
//   sales.delivery_fee_usd     = delivery fee, only meaningful when
//                                 is_delivery=1; delivery_fee_paid_by is
//                                 'customer' (customer pays it, on top of
//                                 total_usd) or 'store' (store absorbs it --
//                                 a real cost, not collected from anyone)
//   sale_items.cost_price_usd * quantity = COGS for that line
//
// Definitions used everywhere below (canonical revenue = NET SALES, user
// directive Sep 1 2026 -- see the "Canonical revenue" block further down):
//   gross_sales_usd   = SUM(subtotal_usd)                     -- pre-discount, all sales
//   discount_usd      = store_discount_usd + membership_discount_usd
//   revenue_usd        = SUM over RECOGNIZED sales (neither cancelled nor
//                         awaiting_payment) of (subtotal - store discount -
//                         membership discount), minus customer refunds --
//                         "Net sales", excluding tax and delivery
//   pending_revenue_usd = the same net basis for awaiting_payment (unpaid
//                         credit) sales -- NOT revenue until paid
//   collected_total_usd = revenue_usd + tax_usd + delivery_usd  -- secondary
//                         "total collected": what actually changed hands with
//                         the customer (delivery_usd = customer-paid only)
//   cost_usd           = SUM(sale_items.cost_price_usd * quantity) over recognized sales
//   profit_usd         = revenue_usd - cost_usd - store_delivery_usd
//                         (store-absorbed delivery is a real cost, so it comes
//                         out of profit even though it never touched revenue)
import { getDb } from './db'
import type { Env } from '../index'
import {
  localDateExpr,
  localMonthExpr,
  localWeekExpr,
  localDateRangeClause,
  localDateAtOrAfter,
  localDateAtOrBefore,
  localTimeRangeClause,
  localHourExpr,
} from './businessDateWindow'

export interface SalesFilters {
  startDate?: string | null
  endDate?: string | null
  branchId?: string | number | null
  // Optional time-of-day window ('HH:MM'), evaluated in the FIXED business
  // timezone UTC+7 (Cambodia) -- created_at is stored UTC, so the clause shifts
  // by +7h before comparing (see businessDateWindow.ts). A window that crosses
  // midnight (start > end, e.g. 22:00–02:00) wraps. Callers that don't pass
  // these (Dashboard, /stats) are byte-for-byte unchanged.
  startTime?: string | null
  endTime?: string | null
  // Accepted for backward compatibility but IGNORED: the business is a single
  // fixed timezone, so a viewer-supplied offset must never re-anchor the data
  // (user, Sep 1 2026: "based on UTC+7 ... all Cambodia ... not other timezone").
  tzOffsetMinutes?: number | null
  // Optional report filters (Reports view). Absent on every existing caller
  // (Dashboard, /stats, per-contact drills), so those stay byte-for-byte
  // unchanged. `status` is matched against COALESCE(sale_status,'completed');
  // when set it REPLACES the default hide-cancelled guard, so picking
  // 'cancelled' actually surfaces cancelled sales. `paymentMethod` matches
  // the same normalized label the payment-method breakdown groups by.
  status?: string | null
  paymentMethod?: string | null
  // Optional immutable upper bound used by paged exports. Sales IDs are
  // monotonic, so page 1 can freeze a snapshot and every aggregate/detail
  // query in later pages stays on the same receipt set even while new sales
  // are being created. Absent for normal reports/dashboard paths.
  maxSaleId?: number | null
}

export interface SalesTotals {
  tx_count: number
  gross_sales_usd: number
  store_discount_usd: number
  membership_discount_usd: number
  discount_usd: number
  tax_usd: number
  delivery_usd: number
  store_delivery_usd: number
  // P6: the courier money actually paid out (staff-only surface; NULL rows
  // don't count -- delivery_actual_cost_count says how many sales carried
  // one, vs delivery_sale_count deliveries total, so a partial record is
  // visible instead of read as profit). Display-only: deliberately NOT
  // folded into profit_usd (standing rule: existing calculations don't
  // change without an explicit ask).
  delivery_actual_cost_usd: number
  delivery_actual_cost_count: number
  delivery_sale_count: number
  delivery_margin_usd: number
  // Canonical revenue = NET SALES (user directive Sep 1 2026): subtotal net of
  // both discounts, minus customer refunds, over RECOGNIZED sales only (neither
  // cancelled nor awaiting_payment). Tax and delivery fees are NOT revenue.
  refund_usd: number
  revenue_usd: number
  // Unpaid credit (awaiting_payment) is NOT revenue -- it is surfaced here as a
  // separate figure on the same net basis, and only becomes revenue once paid.
  pending_revenue_usd: number
  // Secondary "total collected" figure (Option 3): recognized revenue plus the
  // tax and customer-paid delivery fee actually taken in. Never the headline.
  collected_total_usd: number
  cost_usd: number
  profit_usd: number
  avg_order_usd: number
}

export interface SalesPeriodRow {
  period: string
  date: string
  count: number
  tx_count: number
  revenue_usd: number
  discount_usd: number
  tax_usd: number
  delivery_usd: number
  cost_usd: number
  profit_usd: number
}

export function emptySalesTotals(): SalesTotals {
  return {
    tx_count: 0, gross_sales_usd: 0, store_discount_usd: 0, membership_discount_usd: 0,
    discount_usd: 0, tax_usd: 0, delivery_usd: 0, store_delivery_usd: 0,
    delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0, delivery_sale_count: 0, delivery_margin_usd: 0,
    refund_usd: 0, revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0, cost_usd: 0, profit_usd: 0, avg_order_usd: 0,
  }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---- Canonical revenue = NET SALES (user directive, Sep 1 2026) ------------
// One definition, used identically by every surface below so the Sales-page
// header and the Reports kernel can never disagree:
//   revenue = SUM over RECOGNIZED sales of (subtotal - store discount -
//             membership discount) - customer refunds
// A RECOGNIZED sale is neither cancelled nor awaiting_payment. Tax and delivery
// fees are excluded from revenue; unpaid credit (awaiting_payment) is surfaced
// separately as pending_revenue and only becomes revenue once paid. These are
// SQL-fragment builders (never user input) so string-building them is safe.
// `p` is the table-alias prefix for the `sales` row, e.g. '', 's.' or 'sales.'.
//
// The status is normalised exactly as GET /api/sales/stats does --
// COALESCE(NULLIF(...,''),'completed') -- so a blank status counts as completed
// on BOTH surfaces and the two revenue numbers converge to the byte.
export function saleStatusExpr(p: string): string { return `COALESCE(NULLIF(${p}sale_status, ''), 'completed')` }
export function recognizedExpr(p: string): string { return `${saleStatusExpr(p)} NOT IN ('cancelled', 'awaiting_payment')` }
export function awaitingExpr(p: string): string { return `${saleStatusExpr(p)} = 'awaiting_payment'` }
// Net sale value (subtotal minus both discounts) -- tax and delivery excluded.
export function netSaleExpr(p: string): string {
  return `(COALESCE(${p}subtotal_usd, 0) - COALESCE(${p}discount_usd, 0) - COALESCE(${p}membership_discount_usd, 0))`
}
// Money the till actually took for one sale row.
//
// For an ordinary sale that is total_usd, and a replacement sale written
// under the CURRENT model is an ordinary sale: the customer pays for it in
// full, so returns.ts records amount_paid_usd == total_usd and this CASE is a
// no-op for those rows.
//
// It still has to exist for HISTORY. Replacement rows written under the old
// exchange model (returns.ts wrote them with sales.source_return_id set,
// migration 0106, and an amount_paid of only the price difference the
// customer topped up) really did collect less than total_usd -- an even
// exchange collected $0 even though total_usd carried the full value of what
// left the shelf. Reading amount_paid_usd for source_return_id rows keeps
// those old days reporting the money the till actually took, while the sale
// is still COUNTED (goods really moved) rather than dropped from the
// breakdown.
//
// Revenue is untouched by this: the sale's value and the return's refund are
// each recognized on their own through CUSTOMER_REFUND_JOIN.
export function collectedExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}source_return_id, 0) <> 0 THEN COALESCE(${p}amount_paid_usd, 0) ELSE COALESCE(${p}total_usd, 0) END`
}
// The delivery fee the CUSTOMER paid (a store-absorbed fee was never collected).
export function customerDeliveryFeeExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE COALESCE(${p}delivery_fee_usd, 0) END`
}
// The delivery fee the SHOP absorbed (customer not charged) -- a cost, not revenue.
function storeDeliveryExpr(p: string): string {
  return `CASE WHEN COALESCE(${p}delivery_fee_paid_by, 'customer') = 'store' THEN COALESCE(${p}delivery_fee_usd, 0) ELSE 0 END`
}
// Pre-aggregated customer refunds per sale (non-cancelled customer returns), so
// a sale carrying two returns still subtracts once. Refunds attribute to the
// SALE's date bucket via sale_id -- identical to GET /api/sales/stats. Join it
// as `rf` and read COALESCE(rf.refund_usd, 0).
export const CUSTOMER_REFUND_JOIN = `LEFT JOIN (
      SELECT sale_id, SUM(total_refund_usd) AS refund_usd
      FROM returns
      WHERE COALESCE(status, 'completed') <> 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
      GROUP BY sale_id
    ) rf ON rf.sale_id = `

// Builds the shared WHERE clause + bound params for "active sales in this
// date range (and optional branch)". `alias` lets callers use this against
// either a bare `sales` table or an aliased `s` in a join.
function whereActiveSales(alias: string, f: SalesFilters) {
  const params: Record<string, unknown> = {}
  const clauses: string[] = []
  // Local-day range, bucketed in the fixed business timezone UTC+7 (Cambodia).
  // Both endpoints are optional so the Reports hub can represent true all-time
  // (or a one-sided range) without inventing a fake historical boundary.
  if (f.startDate && f.endDate) {
    params.startDate = f.startDate
    params.endDate = f.endDate
    clauses.push(localDateRangeClause(`${alias}.created_at`))
  } else if (f.startDate) {
    params.startDate = f.startDate
    clauses.push(localDateAtOrAfter(`${alias}.created_at`))
  } else if (f.endDate) {
    params.endDate = f.endDate
    clauses.push(localDateAtOrBefore(`${alias}.created_at`))
  }
  // Status: an explicit filter wins over the default hide-cancelled guard, so
  // a caller asking for 'cancelled' actually gets cancelled sales. Bound as a
  // param -- never interpolated -- so an arbitrary value is injection-safe and
  // simply matches nothing.
  const status = typeof f.status === 'string' ? f.status.trim() : ''
  if (status) {
    clauses.push(`COALESCE(${alias}.sale_status, 'completed') = @status`)
    params.status = status
  } else {
    clauses.push(`COALESCE(${alias}.sale_status, 'completed') <> 'cancelled'`)
  }
  // Payment method: matched against the same normalized label the breakdown
  // groups by (trimmed, empty -> 'Unknown'), so the dropdown values line up.
  const paymentMethod = typeof f.paymentMethod === 'string' ? f.paymentMethod.trim() : ''
  if (paymentMethod) {
    clauses.push(`COALESCE(NULLIF(TRIM(${alias}.payment_method), ''), 'Unknown') = @paymentMethod`)
    params.paymentMethod = paymentMethod
  }
  if (f.branchId) {
    clauses.push(`${alias}.branch_id = @branchId`)
    params.branchId = f.branchId
  }
  if (Number.isSafeInteger(Number(f.maxSaleId)) && Number(f.maxSaleId) > 0) {
    clauses.push(`${alias}.id <= @maxSaleId`)
    params.maxSaleId = Number(f.maxSaleId)
  }
  const validTime = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
  if (validTime(f.startTime) && validTime(f.endTime)) {
    // The time-of-day window is interpreted in the FIXED business timezone
    // (UTC+7), NOT the viewer's offset -- created_at is stored UTC, so shift by
    // +7h before taking time(). f.tzOffsetMinutes is deliberately ignored.
    params.startTime = f.startTime
    params.endTime = f.endTime
    clauses.push(localTimeRangeClause(`${alias}.created_at`))
  }
  return { sql: clauses.join(' AND '), params }
}

// Sale-header-level aggregate. Deliberately has NO join to sale_items --
// joining would fan out one row per line item and inflate every SUM here by
// however many items each sale has (the bug this file replaces).
async function salesLevelTotals(env: Env, f: SalesFilters) {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const row = await db.prepare(`
    SELECT COUNT(*) AS tx_count,
           COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
           COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
           COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
           COALESCE(SUM(tax_usd), 0) AS tax_usd,
           COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
           COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
           COALESCE(SUM(delivery_actual_cost_usd), 0) AS delivery_actual_cost_usd,
           COALESCE(SUM(CASE WHEN delivery_actual_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS delivery_actual_cost_count,
           COALESCE(SUM(CASE WHEN COALESCE(is_delivery, 0) = 1 THEN 1 ELSE 0 END), 0) AS delivery_sale_count,
           -- Canonical net-sales revenue components (recognized = not cancelled/awaiting):
           COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS recognized_net_usd,
           COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS pending_revenue_usd,
           COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN tax_usd ELSE 0 END), 0) AS recognized_tax_usd,
           COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS recognized_delivery_usd,
           COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${storeDeliveryExpr('')} ELSE 0 END), 0) AS recognized_store_delivery_usd,
           COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_usd
    FROM sales
    ${CUSTOMER_REFUND_JOIN}sales.id
    WHERE ${whereSql}
  `).get<Record<string, number>>(params)
  return row || {}
}

// Item-level cost aggregate. Joins to sales only to apply the date/branch/
// status filter -- the summed field itself (cost_price_usd * quantity)
// is per-item, so there's no fan-out to worry about here. COGS is counted over
// RECOGNIZED sales only (excludes awaiting_payment as well as cancelled), so
// profit = recognized revenue - recognized cost stays a matched pair -- unpaid
// credit contributes neither revenue nor cost until it is paid.
async function salesCost(env: Env, f: SalesFilters): Promise<number> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const row = await db.prepare(`
    SELECT COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql} AND ${recognizedExpr('s.')}
  `).get<{ cost_usd: number }>(params)
  return num(row?.cost_usd)
}

export function deriveTotals(level: Record<string, number>, costUsd: number): SalesTotals {
  const txCount = num(level.tx_count)
  const grossSalesUsd = num(level.gross_sales_usd)
  const storeDiscountUsd = num(level.store_discount_usd)
  const membershipDiscountUsd = num(level.membership_discount_usd)
  const discountUsd = storeDiscountUsd + membershipDiscountUsd
  const taxUsd = num(level.tax_usd)
  const deliveryUsd = num(level.delivery_usd)
  const storeDeliveryUsd = num(level.store_delivery_usd)
  const deliveryActualCostUsd = num(level.delivery_actual_cost_usd)
  // Canonical revenue = NET SALES over recognized sales, minus customer refunds
  // (user directive Sep 1 2026). The `recognized_*` fields exclude awaiting_payment
  // (unpaid credit) and cancelled; when a caller doesn't supply them we fall back
  // to the old gross-minus-discount basis so no other consumer of deriveTotals
  // silently zeroes out. gross_sales_usd / tax_usd / delivery_usd stay the full
  // display line items and are intentionally NOT changed.
  const hasRecognized = level.recognized_net_usd !== undefined && level.recognized_net_usd !== null
  const recognizedNetUsd = hasRecognized ? num(level.recognized_net_usd) : grossSalesUsd - discountUsd
  const refundUsd = num(level.refund_usd)
  const pendingRevenueUsd = num(level.pending_revenue_usd)
  const recognizedTaxUsd = hasRecognized ? num(level.recognized_tax_usd) : taxUsd
  const recognizedDeliveryUsd = hasRecognized ? num(level.recognized_delivery_usd) : deliveryUsd
  const recognizedStoreDeliveryUsd = hasRecognized ? num(level.recognized_store_delivery_usd) : storeDeliveryUsd
  const revenueUsd = recognizedNetUsd - refundUsd
  // "Total collected" (secondary): recognized revenue + tax + customer delivery fee.
  const collectedTotalUsd = revenueUsd + recognizedTaxUsd + recognizedDeliveryUsd
  const profitUsd = revenueUsd - costUsd - recognizedStoreDeliveryUsd
  return {
    tx_count: txCount,
    gross_sales_usd: round2(grossSalesUsd),
    store_discount_usd: round2(storeDiscountUsd),
    membership_discount_usd: round2(membershipDiscountUsd),
    discount_usd: round2(discountUsd),
    tax_usd: round2(taxUsd),
    delivery_usd: round2(deliveryUsd),
    store_delivery_usd: round2(storeDeliveryUsd),
    delivery_actual_cost_usd: round2(deliveryActualCostUsd),
    delivery_actual_cost_count: num(level.delivery_actual_cost_count),
    delivery_sale_count: num(level.delivery_sale_count),
    // Margin over the CHARGED fees: what customers paid for delivery minus
    // what the couriers were actually paid.
    delivery_margin_usd: round2(deliveryUsd - deliveryActualCostUsd),
    refund_usd: round2(refundUsd),
    revenue_usd: round2(revenueUsd),
    pending_revenue_usd: round2(pendingRevenueUsd),
    collected_total_usd: round2(collectedTotalUsd),
    cost_usd: round2(costUsd),
    profit_usd: round2(profitUsd),
    avg_order_usd: txCount > 0 ? round2(revenueUsd / txCount) : 0,
  }
}

export async function getSalesTotals(env: Env, f: SalesFilters): Promise<SalesTotals> {
  const [level, costUsd] = await Promise.all([salesLevelTotals(env, f), salesCost(env, f)])
  return deriveTotals(level, costUsd)
}

// Period-bucketed trend series (for the Dashboard revenue/cost/profit line
// chart and count bar chart). Sale-level sums and item-level cost are
// queried and grouped separately, then merged by period key in JS -- same
// fan-out-avoidance reasoning as getSalesTotals above, just bucketed.
export async function getSalesPeriodSeries(env: Env, f: SalesFilters, granularity: 'day' | 'week' | 'month'): Promise<SalesPeriodRow[]> {
  const db = getDb(env)
  // Buckets are the LOCAL (UTC+7) day/week/month, matching the date window.
  const periodExprS = granularity === 'month' ? localMonthExpr('sales.created_at')
    : granularity === 'week' ? localWeekExpr('sales.created_at')
      : localDateExpr('sales.created_at')
  const periodExprJoined = granularity === 'month' ? localMonthExpr('s.created_at')
    : granularity === 'week' ? localWeekExpr('s.created_at')
      : localDateExpr('s.created_at')

  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows] = await Promise.all([
    db.prepare(`
      SELECT ${periodExprS} AS period, COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             -- Same canonical net-sales revenue basis as the headline, so the
             -- per-period trend sums back to getSalesTotals' revenue_usd.
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS recognized_net_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN tax_usd ELSE 0 END), 0) AS recognized_tax_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS recognized_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${storeDeliveryExpr('')} ELSE 0 END), 0) AS recognized_store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_usd
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY ${periodExprS}
    `).all<Record<string, number> & { period: string }>(paramsLevel),
    db.prepare(`
      SELECT ${periodExprJoined} AS period,
             COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${recognizedExpr('s.')}
      GROUP BY ${periodExprJoined}
    `).all<{ period: string; cost_usd: number }>(paramsCost),
  ])

  const costByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.cost_usd)]))
  const rows = (levelRows || []).map((r) => {
    const totals = deriveTotals(r, costByPeriod.get(r.period) || 0)
    return {
      period: r.period,
      date: r.period,
      count: totals.tx_count,
      tx_count: totals.tx_count,
      revenue_usd: totals.revenue_usd,
      discount_usd: totals.discount_usd,
      tax_usd: totals.tax_usd,
      delivery_usd: totals.delivery_usd,
      cost_usd: totals.cost_usd,
      profit_usd: totals.profit_usd,
    }
  })
  return rows.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
}

// ---- Phase X (Part 395): daily report + per-contact delivery totals -------
// Same single-source rule as everything above: these are KERNEL functions so
// the Sales daily report, the delivery-contact drill and any export all
// agree. USD-centric like the rest of the file (KHR derives at display).

export interface PaymentMethodBreakdownRow {
  payment_method: string
  tx_count: number
  // What actually changed hands for these sales: total_usd plus the
  // customer-PAID delivery fee (a store-absorbed fee was never collected).
  collected_usd: number
  total_usd: number
}

export interface DeliveryContactTotalsRow {
  delivery_contact_id: number | null
  delivery_contact_name: string
  deliveries: number
  charged_fee_usd: number
  absorbed_fee_usd: number
  // NULL actual costs don't count (same honesty rule as SalesTotals):
  // actual_cost_count says how many deliveries carried a recorded cost.
  actual_cost_usd: number
  actual_cost_count: number
  linked_expense_count: number
  linked_expense_usd: number
  linked_expense_khr: number
  margin_usd: number
  last_delivery_at: string | null
  last_expense_at: string | null
}

// One receipt inside a day's drill. revenue_usd is computed the SAME way the
// kernel defines revenue -- net sale (subtotal minus both discounts) minus this
// sale's own customer refunds, and 0 for a non-recognized (awaiting_payment /
// cancelled) sale -- so these rows sum to the day's revenue_usd. The
// single-source rule applied per row: the per-sale breakdown can never disagree
// with the day total above it.
export interface SalesDayRow {
  id: number
  receipt_number: string
  created_at: string
  customer_name: string
  payment_method: string
  sale_status: string
  revenue_usd: number
  discount_usd: number
  collected_usd: number
}

export interface SalesDayReport {
  date: string
  totals: SalesTotals
  payment_methods: PaymentMethodBreakdownRow[]
  delivery_contacts: DeliveryContactTotalsRow[]
  discounts: {
    store_usd: number
    membership_usd: number
    store_tx_count: number
    membership_tx_count: number
  }
  // The individual receipts making up the day (newest first, capped).
  sales: SalesDayRow[]
}

export async function getPaymentMethodBreakdown(env: Env, f: SalesFilters): Promise<PaymentMethodBreakdownRow[]> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const rows = await db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
           COUNT(*) AS tx_count,
           COALESCE(SUM(total_usd), 0) AS total_usd,
           COALESCE(SUM(${collectedExpr('')}), 0) AS collected_usd
    FROM sales
    WHERE ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown')
    ORDER BY collected_usd DESC
  `).all<Record<string, unknown>>(params)
  return (rows || []).map((r) => ({
    payment_method: String(r.payment_method || 'Unknown'),
    tx_count: num(r.tx_count),
    collected_usd: round2(num(r.collected_usd)),
    total_usd: round2(num(r.total_usd)),
  }))
}

// Per-courier totals over a range -- X3's "check expenses of delivery by
// contact". Grouped by the LINK (delivery_contact_id) with the name snapshot
// merged per id in JS, so a renamed contact still shows as one line under
// its latest name; unlinked deliveries group by their name snapshot alone
// (imported history links by id where the contact exists -- T3).
export async function getDeliveryContactTotals(
  env: Env,
  f: SalesFilters & { contactId?: number | string | null },
): Promise<DeliveryContactTotalsRow[]> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const clauses = [whereSql, 'COALESCE(sales.is_delivery, 0) = 1']
  if (f.contactId != null && f.contactId !== '') {
    clauses.push('sales.delivery_contact_id = @contactId')
    params.contactId = f.contactId
  }
  const rows = await db.prepare(`
    SELECT delivery_contact_id,
           COALESCE(NULLIF(TRIM(delivery_contact_name), ''), '') AS delivery_contact_name,
           COUNT(*) AS deliveries,
           COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE COALESCE(delivery_fee_usd, 0) END), 0) AS charged_fee_usd,
           COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN COALESCE(delivery_fee_usd, 0) ELSE 0 END), 0) AS absorbed_fee_usd,
           COALESCE(SUM(delivery_actual_cost_usd), 0) AS actual_cost_usd,
           COALESCE(SUM(CASE WHEN delivery_actual_cost_usd IS NOT NULL THEN 1 ELSE 0 END), 0) AS actual_cost_count,
           MAX(created_at) AS last_delivery_at
    FROM sales
    WHERE ${clauses.join(' AND ')}
    GROUP BY delivery_contact_id, LOWER(TRIM(COALESCE(delivery_contact_name, '')))
  `).all<Record<string, unknown>>(params)

  // Standalone courier payments are expense rows, not sale rows.  Keep the
  // accounting amounts separate from charged/absorbed sale fees so reports
  // never double-count or silently reinterpret an Expense-classified label.
  // fee_date owns the calendar-day filter; an optional time-of-day filter is
  // evaluated against the source-preserved created_at timestamp in UTC+7.
  const feeClauses: string[] = ['fees.delivery_contact_id IS NOT NULL']
  const feeParams: Record<string, unknown> = {}
  if (f.startDate) { feeClauses.push('fees.fee_date >= @feeStartDate'); feeParams.feeStartDate = f.startDate }
  if (f.endDate) { feeClauses.push('fees.fee_date <= @feeEndDate'); feeParams.feeEndDate = f.endDate }
  if (f.branchId) { feeClauses.push('fees.branch_id = @feeBranchId'); feeParams.feeBranchId = f.branchId }
  const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (validTime(f.startTime) && validTime(f.endTime)) {
    feeClauses.push(localTimeRangeClause('fees.created_at').replaceAll('@startTime', '@feeStartTime').replaceAll('@endTime', '@feeEndTime'))
    feeParams.feeStartTime = f.startTime
    feeParams.feeEndTime = f.endTime
  }
  if (f.contactId != null && f.contactId !== '') {
    feeClauses.push('fees.delivery_contact_id = @feeContactId')
    feeParams.feeContactId = f.contactId
  }
  const expenseRows = await db.prepare(`
    SELECT fees.delivery_contact_id,
           COALESCE(NULLIF(TRIM(dc.name), ''), '') AS delivery_contact_name,
           COUNT(*) AS linked_expense_count,
           COALESCE(SUM(fees.amount_usd), 0) AS linked_expense_usd,
           COALESCE(SUM(fees.amount_khr), 0) AS linked_expense_khr,
           MAX(fees.created_at) AS last_expense_at
    FROM fees
    JOIN delivery_contacts dc ON dc.id = fees.delivery_contact_id
    WHERE ${feeClauses.join(' AND ')}
    GROUP BY fees.delivery_contact_id, LOWER(TRIM(COALESCE(dc.name, '')))
  `).all<Record<string, unknown>>(feeParams)

  // Merge rows that share a real contact id (name-snapshot renames), keep
  // NULL-id rows separate per name.
  const merged = new Map<string, DeliveryContactTotalsRow & { _lastAt: string }>()
  for (const r of rows || []) {
    const id = r.delivery_contact_id == null ? null : Number(r.delivery_contact_id)
    const name = String(r.delivery_contact_name || '')
    const key = id != null ? `id:${id}` : `name:${name.toLowerCase()}`
    const lastAt = String(r.last_delivery_at || '')
    const existing = merged.get(key)
    const add = {
      deliveries: num(r.deliveries),
      charged: num(r.charged_fee_usd),
      absorbed: num(r.absorbed_fee_usd),
      actual: num(r.actual_cost_usd),
      actualCount: num(r.actual_cost_count),
    }
    if (!existing) {
      merged.set(key, {
        delivery_contact_id: id,
        delivery_contact_name: name,
        deliveries: add.deliveries,
        charged_fee_usd: add.charged,
        absorbed_fee_usd: add.absorbed,
        actual_cost_usd: add.actual,
        actual_cost_count: add.actualCount,
        linked_expense_count: 0,
        linked_expense_usd: 0,
        linked_expense_khr: 0,
        margin_usd: 0,
        last_delivery_at: lastAt || null,
        last_expense_at: null,
        _lastAt: lastAt,
      })
      continue
    }
    existing.deliveries += add.deliveries
    existing.charged_fee_usd += add.charged
    existing.absorbed_fee_usd += add.absorbed
    existing.actual_cost_usd += add.actual
    existing.actual_cost_count += add.actualCount
    if (lastAt > existing._lastAt) {
      existing._lastAt = lastAt
      existing.last_delivery_at = lastAt
      // Latest snapshot wins the display name for a renamed contact.
      if (name) existing.delivery_contact_name = name
    }
  }
  for (const r of expenseRows || []) {
    const id = Number(r.delivery_contact_id)
    const name = String(r.delivery_contact_name || '')
    const key = `id:${id}`
    const existing = merged.get(key)
    const expenseAt = String(r.last_expense_at || '')
    if (!existing) {
      merged.set(key, {
        delivery_contact_id: id,
        delivery_contact_name: name,
        deliveries: 0,
        charged_fee_usd: 0,
        absorbed_fee_usd: 0,
        actual_cost_usd: 0,
        actual_cost_count: 0,
        linked_expense_count: num(r.linked_expense_count),
        linked_expense_usd: num(r.linked_expense_usd),
        linked_expense_khr: num(r.linked_expense_khr),
        margin_usd: 0,
        last_delivery_at: null,
        last_expense_at: expenseAt || null,
        _lastAt: '',
      })
      continue
    }
    existing.linked_expense_count += num(r.linked_expense_count)
    existing.linked_expense_usd += num(r.linked_expense_usd)
    existing.linked_expense_khr += num(r.linked_expense_khr)
    existing.last_expense_at = expenseAt || existing.last_expense_at
    if (name) existing.delivery_contact_name = name
  }
  return [...merged.values()]
    .map(({ _lastAt, ...row }) => ({
      ...row,
      charged_fee_usd: round2(row.charged_fee_usd),
      absorbed_fee_usd: round2(row.absorbed_fee_usd),
      actual_cost_usd: round2(row.actual_cost_usd),
      linked_expense_usd: round2(row.linked_expense_usd),
      linked_expense_khr: round2(row.linked_expense_khr),
      margin_usd: round2(row.charged_fee_usd - row.actual_cost_usd),
    }))
    .sort((a, b) => (b.deliveries + b.linked_expense_count) - (a.deliveries + a.linked_expense_count))
}

// X4: per-customer purchase totals -- the "same for customer" leg of the
// per-contact drills (suppliers have D5's purchases; couriers have X3).
export interface CustomerSalesTotalsRow {
  tx_count: number
  collected_usd: number
  discount_usd: number
  membership_discount_usd: number
  points_redeemed: number
  first_sale_at: string | null
  last_sale_at: string | null
}

export async function getCustomerSalesTotals(
  env: Env,
  f: SalesFilters & { customerId: number | string },
): Promise<CustomerSalesTotalsRow> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  params.customerId = f.customerId
  const row = await db.prepare(`
    SELECT COUNT(*) AS tx_count,
           COALESCE(SUM(${collectedExpr('')}), 0) AS collected_usd,
           COALESCE(SUM(discount_usd), 0) AS discount_usd,
           COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
           COALESCE(SUM(membership_points_redeemed), 0) AS points_redeemed,
           MIN(created_at) AS first_sale_at,
           MAX(created_at) AS last_sale_at
    FROM sales
    WHERE ${whereSql} AND sales.customer_id = @customerId
  `).get<Record<string, unknown>>(params)
  return {
    tx_count: num(row?.tx_count),
    collected_usd: round2(num(row?.collected_usd)),
    discount_usd: round2(num(row?.discount_usd)),
    membership_discount_usd: round2(num(row?.membership_discount_usd)),
    points_redeemed: round2(num(row?.points_redeemed)),
    first_sale_at: row?.first_sale_at ? String(row.first_sale_at) : null,
    last_sale_at: row?.last_sale_at ? String(row.last_sale_at) : null,
  }
}

export async function getSalesDayReport(
  env: Env,
  day: string,
  opts: Pick<SalesFilters, 'branchId' | 'startTime' | 'endTime' | 'tzOffsetMinutes' | 'status' | 'paymentMethod'> = {},
): Promise<SalesDayReport> {
  const f: SalesFilters = { startDate: day, endDate: day, ...opts }
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('sales', f)
  const [totals, paymentMethods, deliveryContacts, discountCounts, saleRows] = await Promise.all([
    getSalesTotals(env, f),
    getPaymentMethodBreakdown(env, f),
    getDeliveryContactTotals(env, f),
    db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN COALESCE(discount_usd, 0) > 0 THEN 1 ELSE 0 END), 0) AS store_tx_count,
             COALESCE(SUM(CASE WHEN COALESCE(membership_discount_usd, 0) > 0 THEN 1 ELSE 0 END), 0) AS membership_tx_count
      FROM sales
      WHERE ${whereSql}
    `).get<Record<string, number>>(params),
    // Per-sale rows for the drill. Same date/branch/status/payment scope as
    // every figure above (whereActiveSales), and revenue computed identically
    // to deriveTotals so SUM(revenue_usd) == totals.revenue_usd. Capped: a
    // single day of one shop never approaches 1000 receipts.
    db.prepare(`
      SELECT sales.id AS id, receipt_number, created_at,
             COALESCE(NULLIF(TRIM(customer_name), ''), '') AS customer_name,
             COALESCE(NULLIF(TRIM(payment_method), ''), 'Unknown') AS payment_method,
             COALESCE(sale_status, 'completed') AS sale_status,
             -- Canonical net-sales revenue, per sale: recognized sales only
             -- (awaiting_payment / cancelled contribute 0), net of THIS sale's
             -- own customer refunds -- identical basis to deriveTotals, so
             -- SUM(revenue_usd) over the day == totals.revenue_usd.
             ROUND(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} - COALESCE(rf.refund_usd, 0) ELSE 0 END, 2) AS revenue_usd,
             ROUND(COALESCE(discount_usd, 0) + COALESCE(membership_discount_usd, 0), 2) AS discount_usd,
             ROUND(${collectedExpr('')}, 2) AS collected_usd
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereSql}
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1000
    `).all<Record<string, unknown>>(params),
  ])
  return {
    date: day,
    totals,
    payment_methods: paymentMethods,
    delivery_contacts: deliveryContacts,
    discounts: {
      store_usd: totals.store_discount_usd,
      membership_usd: totals.membership_discount_usd,
      store_tx_count: num(discountCounts?.store_tx_count),
      membership_tx_count: num(discountCounts?.membership_tx_count),
    },
    sales: (saleRows || []).map((r) => ({
      id: Number(r.id),
      receipt_number: String(r.receipt_number || ''),
      created_at: String(r.created_at || ''),
      customer_name: String(r.customer_name || ''),
      payment_method: String(r.payment_method || ''),
      sale_status: String(r.sale_status || 'completed'),
      revenue_usd: num(r.revenue_usd),
      discount_usd: num(r.discount_usd),
      collected_usd: num(r.collected_usd),
    })),
  }
}

// Shifts [startDate, endDate] back by its own length, for a same-length
// "previous period" comparison (used for the Dashboard's trend arrows).
export function previousPeriodFilters(f: SalesFilters): SalesFilters {
  const start = new Date(`${f.startDate}T00:00:00Z`)
  const end = new Date(`${f.endDate}T00:00:00Z`)
  const spanMs = Math.max(0, end.getTime() - start.getTime()) + 24 * 60 * 60 * 1000
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  const prevStart = new Date(prevEnd.getTime() - spanMs + 24 * 60 * 60 * 1000)
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
    branchId: f.branchId,
  }
}

// D3 (Part 422): the product detail page's sales breakdown -- how much of
// ONE product sold per day and per month, through the SAME active-sales
// predicate every other number on the Sales surfaces uses (single-source
// rule; a cancelled sale never counts anywhere). Day rows cover the filter
// range; month rows aggregate the same range by month.
export type ProductSalesBreakdownRow = {
  period: string
  qty: number
  revenue_usd: number
  sale_count: number
}

export async function getProductSalesBreakdown(
  env: Env,
  productId: number,
  f: SalesFilters,
): Promise<{ by_day: ProductSalesBreakdownRow[]; by_month: ProductSalesBreakdownRow[] }> {
  const db = getDb(env)
  const { sql: activeSql, params } = whereActiveSales('s', f)
  const run = async (periodExpr: string): Promise<ProductSalesBreakdownRow[]> => {
    const rows = await db.prepare(`
      SELECT ${periodExpr} AS period,
             COALESCE(SUM(si.quantity), 0) AS qty,
             COALESCE(SUM(si.total_usd), 0) AS revenue_usd,
             COUNT(DISTINCT s.id) AS sale_count
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${activeSql} AND si.product_id = @productId
      GROUP BY period
      ORDER BY period DESC
    `).all<Record<string, unknown>>({ ...params, productId })
    return (rows || []).map((row) => ({
      period: String(row.period || ''),
      qty: num(row.qty),
      revenue_usd: round2(num(row.revenue_usd)),
      sale_count: num(row.sale_count),
    }))
  }
  return {
    by_day: await run(localDateExpr('s.created_at')),
    by_month: await run(localMonthExpr('s.created_at')),
  }
}

// ---------------------------------------------------------------------------
// Reports views (Sep 3 2026, lane sec-10 / session 8c). New EXPORTS only --
// nothing above this line changed. Grouped totals + product ranking for the
// Reports section's "by customer / cashier / payment / hour / weekday /
// branch" and "Products" views. Every grouped row is a full canonical
// SalesTotals built from the SAME per-sale expressions salesLevelTotals uses
// (recognized net sales - customer refunds = revenue; profit = revenue - COGS
// - store-paid delivery), so the rows of one view sum to getSalesTotals for
// the same filters -- one revenue definition, sliced, never re-derived.
// ---------------------------------------------------------------------------

export type SalesGroupKey = 'customer' | 'cashier' | 'payment_method' | 'hour' | 'weekday' | 'branch'
export const SALES_GROUP_KEYS: readonly SalesGroupKey[] = ['customer', 'cashier', 'payment_method', 'hour', 'weekday', 'branch']

export interface SalesGroupedRow extends SalesTotals {
  /** Stable group key ('id:12', 'name:walk in', '13' for an hour, '0'..'6' for a weekday, ...). */
  key: string
  /** Display label as stored on the sale (customer/cashier/branch/payment name; hour 'HH'; weekday '0'..'6'). */
  label: string
  entity_id: number | null
  cost_missing_snapshot_lines: number
}

function salesGroupExprs(alias: string, groupBy: SalesGroupKey): { key: string; label: string; id: string } {
  const a = alias ? `${alias}.` : ''
  const created = `${a}created_at`
  switch (groupBy) {
    case 'customer':
      // The customer id is the identity (a rename cascades to customer_name
      // snapshots); legacy sales without an id fall back to the name.
      return {
        key: `CASE WHEN ${a}customer_id IS NOT NULL THEN 'id:' || ${a}customer_id ELSE 'name:' || lower(trim(COALESCE(${a}customer_name, ''))) END`,
        label: `MAX(COALESCE(NULLIF(trim(${a}customer_name), ''), ''))`,
        id: `MAX(${a}customer_id)`,
      }
    case 'cashier':
      return {
        key: `CASE WHEN ${a}cashier_id IS NOT NULL THEN 'id:' || ${a}cashier_id ELSE 'name:' || lower(trim(COALESCE(${a}cashier_name, ''))) END`,
        label: `MAX(COALESCE(NULLIF(trim(${a}cashier_name), ''), ''))`,
        id: `MAX(${a}cashier_id)`,
      }
    case 'payment_method':
      return {
        key: `lower(trim(COALESCE(NULLIF(trim(${a}payment_method), ''), 'unknown')))`,
        label: `MAX(COALESCE(NULLIF(trim(${a}payment_method), ''), ''))`,
        id: 'NULL',
      }
    case 'hour':
      return { key: localHourExpr(created), label: `MAX(${localHourExpr(created)})`, id: 'NULL' }
    case 'weekday':
      // '0' (Sunday) .. '6' (Saturday) of the UTC+7 business date.
      return { key: `strftime('%w', ${localDateExpr(created)})`, label: `MAX(strftime('%w', ${localDateExpr(created)}))`, id: 'NULL' }
    case 'branch':
      return { key: `COALESCE(${a}branch_id, 0)`, label: `MAX(COALESCE(${a}branch_name, ''))`, id: `MAX(${a}branch_id)` }
  }
}

/**
 * Canonical SalesTotals per group. Same two-query shape as
 * getBusinessSummaryDayRows (sale level + item-level COGS, merged through
 * deriveTotals), only the bucket expression differs. Sorted by revenue
 * (desc) except hour/weekday which come back in clock order.
 */
export async function getSalesGroupedTotals(env: Env, f: SalesFilters, groupBy: SalesGroupKey, limit = 500): Promise<SalesGroupedRow[]> {
  const db = getDb(env)
  const level = salesGroupExprs('sales', groupBy)
  const joined = salesGroupExprs('s', groupBy)
  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows] = await Promise.all([
    db.prepare(`
      SELECT ${level.key} AS grp_key, ${level.label} AS grp_label, ${level.id} AS grp_id,
             COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS recognized_net_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS pending_revenue_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN tax_usd ELSE 0 END), 0) AS recognized_tax_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS recognized_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${storeDeliveryExpr('')} ELSE 0 END), 0) AS recognized_store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_usd
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY grp_key
    `).all<Record<string, number> & { grp_key: string | number | null; grp_label: string | null; grp_id: number | null }>(paramsLevel),
    db.prepare(`
      SELECT ${joined.key} AS grp_key,
             COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd,
             COALESCE(SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS missing_snapshot_lines
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${recognizedExpr('s.')}
      GROUP BY grp_key
    `).all<{ grp_key: string | number | null; cost_usd: number; missing_snapshot_lines: number }>(paramsCost),
  ])

  const keyOf = (v: string | number | null | undefined): string => (v == null ? '' : String(v))
  const costByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.cost_usd)]))
  const missingByKey = new Map((costRows || []).map((r) => [keyOf(r.grp_key), num(r.missing_snapshot_lines)]))
  const rows: SalesGroupedRow[] = (levelRows || []).map((r) => {
    const key = keyOf(r.grp_key)
    return {
      key,
      label: r.grp_label == null ? '' : String(r.grp_label),
      entity_id: r.grp_id == null ? null : Number(r.grp_id),
      cost_missing_snapshot_lines: missingByKey.get(key) || 0,
      ...deriveTotals(r, costByKey.get(key) || 0),
    }
  })
  if (groupBy === 'hour' || groupBy === 'weekday') {
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  } else {
    rows.sort((a, b) => b.revenue_usd - a.revenue_usd || b.tx_count - a.tx_count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  }
  const cap = Math.max(1, Math.min(2000, Math.trunc(limit) || 500))
  return rows.length > cap ? rows.slice(0, cap) : rows
}

export interface ProductSalesRankingRow {
  product_id: number | null
  product_name: string
  sale_count: number
  qty: number
  /** SUM(sale_items.total_usd): line totals after line discounts, before order-level store/membership discounts. */
  line_sales_usd: number
  cost_usd: number
  /** line_sales_usd - cost_usd (item-level gross profit; NULL cost snapshots count as 0 and are flagged). */
  profit_usd: number
  cost_missing_snapshot_lines: number
}

/**
 * Products ranked by line sales over RECOGNIZED sales only (the same
 * population revenue and COGS are computed from), respecting every
 * SalesFilters field through whereActiveSales.
 */
export async function getProductSalesRanking(env: Env, f: SalesFilters, limit = 200): Promise<ProductSalesRankingRow[]> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const cap = Math.max(1, Math.min(1000, Math.trunc(limit) || 200))
  const rows = await db.prepare(`
    SELECT si.product_id AS product_id,
           MAX(COALESCE(si.product_name, '')) AS product_name,
           COUNT(DISTINCT s.id) AS sale_count,
           COALESCE(SUM(si.quantity), 0) AS qty,
           COALESCE(SUM(si.total_usd), 0) AS line_sales_usd,
           COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd,
           COALESCE(SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS cost_missing_snapshot_lines
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql} AND ${recognizedExpr('s.')}
    GROUP BY COALESCE(si.product_id, 0), CASE WHEN si.product_id IS NULL THEN lower(trim(COALESCE(si.product_name, ''))) ELSE '' END
    ORDER BY line_sales_usd DESC, qty DESC
    LIMIT @limit
  `).all<{ product_id: number | null; product_name: string; sale_count: number; qty: number; line_sales_usd: number; cost_usd: number; cost_missing_snapshot_lines: number }>({ ...params, limit: cap })
  const r2 = (v: number) => Math.round(v * 100) / 100
  return (rows || []).map((r) => {
    const lineSales = r2(num(r.line_sales_usd))
    const cost = r2(num(r.cost_usd))
    return {
      product_id: r.product_id == null ? null : Number(r.product_id),
      product_name: String(r.product_name || ''),
      sale_count: num(r.sale_count),
      qty: num(r.qty),
      line_sales_usd: lineSales,
      cost_usd: cost,
      profit_usd: r2(lineSales - cost),
      cost_missing_snapshot_lines: num(r.cost_missing_snapshot_lines),
    }
  })
}

// Ported with the reports lane (S4-26): /periods builds its day rows from
// this one call, so a period roll-up can never disagree with the Sales header
// for the same range. Authored by the business-workbook lane; unchanged here.

// Section 5 (Business summary workbook, Sep 2): one row per BUSINESS DAY
// (UTC+7) carrying the FULL canonical SalesTotals shape, not the narrowed
// SalesPeriodRow getSalesPeriodSeries returns for the Dashboard chart. This
// is the Summary sheet's data source -- gross sales, both discount lines,
// tax, delivery, refunds, net revenue, pending (awaiting_payment) credit,
// collected total, cost and profit all come out of ONE call to deriveTotals
// per day, so the workbook can never disagree with the Sales-page header or
// the Dashboard for the same range (single-source rule). Only days that
// actually have at least one sale are returned -- same convention
// getSalesPeriodSeries already uses -- callers that need every calendar day
// in a range (e.g. to merge in expense-only days for Reconciliation) union
// this with their own day set.
// cost_missing_snapshot_lines: how many RECOGNIZED sold lines that day have
// no cost_price_usd snapshot (legacy/imported rows -- the live create-sale
// path always writes a numeric snapshot, see routes/sales.ts's `costPriceUsd:
// Number(product?.cost_price_usd || 0)`). Those lines contribute $0 to
// cost_usd via plain SQL SUM/COALESCE -- the EXACT same basis salesCost()
// (this file, used by getSalesTotals/getSalesPeriodSeries) already uses, so
// the workbook's COGS figure never drifts from the Dashboard/Sales-page
// figure for the same range. This count is purely a transparency signal for
// the Definitions/COGS sheet ("N sold lines have no cost snapshot and are
// counted as $0 COGS here, same as everywhere else in the app") -- it never
// changes cost_usd itself.
export type BusinessSummaryDayRow = { date: string; cost_missing_snapshot_lines: number } & SalesTotals

export async function getBusinessSummaryDayRows(env: Env, f: SalesFilters): Promise<BusinessSummaryDayRow[]> {
  const db = getDb(env)
  const periodExprS = localDateExpr('sales.created_at')
  const periodExprJoined = localDateExpr('s.created_at')
  const { sql: whereLevel, params: paramsLevel } = whereActiveSales('sales', f)
  const { sql: whereCost, params: paramsCost } = whereActiveSales('s', f)

  const [levelRows, costRows] = await Promise.all([
    db.prepare(`
      SELECT ${periodExprS} AS period, COUNT(*) AS tx_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_sales_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(tax_usd), 0) AS tax_usd,
             COALESCE(SUM(CASE WHEN COALESCE(delivery_fee_paid_by, 'customer') = 'store' THEN 0 ELSE delivery_fee_usd END), 0) AS delivery_usd,
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS recognized_net_usd,
             COALESCE(SUM(CASE WHEN ${awaitingExpr('')} THEN ${netSaleExpr('')} ELSE 0 END), 0) AS pending_revenue_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN tax_usd ELSE 0 END), 0) AS recognized_tax_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${customerDeliveryFeeExpr('')} ELSE 0 END), 0) AS recognized_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN ${storeDeliveryExpr('')} ELSE 0 END), 0) AS recognized_store_delivery_usd,
             COALESCE(SUM(CASE WHEN ${recognizedExpr('')} THEN COALESCE(rf.refund_usd, 0) ELSE 0 END), 0) AS refund_usd
      FROM sales
      ${CUSTOMER_REFUND_JOIN}sales.id
      WHERE ${whereLevel}
      GROUP BY ${periodExprS}
    `).all<Record<string, number> & { period: string }>(paramsLevel),
    db.prepare(`
      SELECT ${periodExprJoined} AS period,
             COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd,
             COALESCE(SUM(CASE WHEN si.cost_price_usd IS NULL THEN 1 ELSE 0 END), 0) AS missing_snapshot_lines
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost} AND ${recognizedExpr('s.')}
      GROUP BY ${periodExprJoined}
    `).all<{ period: string; cost_usd: number; missing_snapshot_lines: number }>(paramsCost),
  ])

  const costByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.cost_usd)]))
  const missingByPeriod = new Map((costRows || []).map((r) => [r.period, num(r.missing_snapshot_lines)]))
  const rows = (levelRows || []).map((r) => ({
    date: r.period,
    cost_missing_snapshot_lines: missingByPeriod.get(r.period) || 0,
    ...deriveTotals(r, costByPeriod.get(r.period) || 0),
  }))
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

