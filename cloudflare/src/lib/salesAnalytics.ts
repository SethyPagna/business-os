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
//                                 (does NOT include delivery_fee_usd)
//   sales.delivery_fee_usd     = delivery fee, only meaningful when
//                                 is_delivery=1; delivery_fee_paid_by is
//                                 'customer' (customer pays it, on top of
//                                 total_usd) or 'store' (store absorbs it --
//                                 a real cost, not collected from anyone)
//   sale_items.cost_price_usd * quantity = COGS for that line
//
// Definitions used everywhere below:
//   gross_sales_usd   = SUM(subtotal_usd)                     -- pre-discount
//   discount_usd      = store_discount_usd + membership_discount_usd
//   revenue_usd        = gross_sales_usd - discount_usd         -- "Net revenue"
//                         (matches how Inventory/Products define revenue:
//                         item price net of discounts, excluding tax/delivery)
//   collected_total_usd = revenue_usd + tax_usd + delivery_usd  -- what actually
//                         changed hands with the customer (delivery_usd here
//                         is customer-paid delivery only)
//   cost_usd           = SUM(sale_items.cost_price_usd * quantity)
//   profit_usd         = revenue_usd - cost_usd - store_delivery_usd
//                         (store-absorbed delivery is a real cost, so it comes
//                         out of profit even though it never touched revenue)
import { getDb } from './db'
import type { Env } from '../index'

export interface SalesFilters {
  startDate: string
  endDate: string
  branchId?: string | number | null
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
  revenue_usd: number
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
    discount_usd: 0, tax_usd: 0, delivery_usd: 0, store_delivery_usd: 0, revenue_usd: 0,
    collected_total_usd: 0, cost_usd: 0, profit_usd: 0, avg_order_usd: 0,
  }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Builds the shared WHERE clause + bound params for "active sales in this
// date range (and optional branch)". `alias` lets callers use this against
// either a bare `sales` table or an aliased `s` in a join.
function whereActiveSales(alias: string, f: SalesFilters) {
  const clauses = [
    `date(${alias}.created_at) BETWEEN date(@startDate) AND date(@endDate)`,
    `COALESCE(${alias}.sale_status, 'completed') <> 'cancelled'`,
  ]
  const params: Record<string, unknown> = { startDate: f.startDate, endDate: f.endDate }
  if (f.branchId) {
    clauses.push(`${alias}.branch_id = @branchId`)
    params.branchId = f.branchId
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
           COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd
    FROM sales
    WHERE ${whereSql}
  `).get<Record<string, number>>(params)
  return row || {}
}

// Item-level cost aggregate. Joins to sales only to apply the date/branch/
// cancelled filter -- the summed field itself (cost_price_usd * quantity)
// is per-item, so there's no fan-out to worry about here.
async function salesCost(env: Env, f: SalesFilters): Promise<number> {
  const db = getDb(env)
  const { sql: whereSql, params } = whereActiveSales('s', f)
  const row = await db.prepare(`
    SELECT COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${whereSql}
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
  const revenueUsd = grossSalesUsd - discountUsd
  const collectedTotalUsd = revenueUsd + taxUsd + deliveryUsd
  const profitUsd = revenueUsd - costUsd - storeDeliveryUsd
  return {
    tx_count: txCount,
    gross_sales_usd: round2(grossSalesUsd),
    store_discount_usd: round2(storeDiscountUsd),
    membership_discount_usd: round2(membershipDiscountUsd),
    discount_usd: round2(discountUsd),
    tax_usd: round2(taxUsd),
    delivery_usd: round2(deliveryUsd),
    store_delivery_usd: round2(storeDeliveryUsd),
    revenue_usd: round2(revenueUsd),
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
  const periodExprS = granularity === 'month' ? "strftime('%Y-%m', sales.created_at)"
    : granularity === 'week' ? "strftime('%Y-W%W', sales.created_at)"
      : 'date(sales.created_at)'
  const periodExprJoined = granularity === 'month' ? "strftime('%Y-%m', s.created_at)"
    : granularity === 'week' ? "strftime('%Y-W%W', s.created_at)"
      : 'date(s.created_at)'

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
             COALESCE(SUM(CASE WHEN delivery_fee_paid_by = 'store' THEN delivery_fee_usd ELSE 0 END), 0) AS store_delivery_usd
      FROM sales
      WHERE ${whereLevel}
      GROUP BY ${periodExprS}
    `).all<Record<string, number> & { period: string }>(paramsLevel),
    db.prepare(`
      SELECT ${periodExprJoined} AS period,
             COALESCE(SUM(si.cost_price_usd * si.quantity), 0) AS cost_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${whereCost}
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
