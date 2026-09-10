import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

export function withDashboardRangeScope(params: QueryParams = {}): QueryParams {
  const hasStart = Object.prototype.hasOwnProperty.call(params, 'startDate')
  const hasEnd = Object.prototype.hasOwnProperty.call(params, 'endDate')
  const startDate = String(params.startDate ?? '').trim()
  const endDate = String(params.endDate ?? '').trim()
  return hasStart && hasEnd && !startDate && !endDate
    ? { ...params, rangeScope: 'all' }
    : params
}

export function getDashboard(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(withDashboardRangeScope(params), { skipEmpty: false })
  return route(
    `dashboard:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/dashboard', query)),
  )
}

export type DashboardStockAlertState = 'low' | 'out'

export type DashboardStockAlertPage = {
  items: unknown[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasMore: boolean
}

export type DashboardLegacyGrossMetrics = Record<string, unknown> & {
  gross_sales_usd?: number
  discount_usd?: number
  item_discount_usd?: number
  total_discount_usd?: number
}

function finiteMoney(value: unknown): number | null {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

/**
 * The analytics wire contract keeps gross_sales_usd at the legacy post-item-
 * discount value. Normalize only at the dashboard presentation boundary so
 * gross is the pre-discount amount and total discounts include item discounts
 * exactly once. Other analytics/report consumers retain the legacy contract.
 */
export function normalizeDashboardGrossMetrics<T extends DashboardLegacyGrossMetrics>(metrics: T): T {
  const legacyGross = finiteMoney(metrics.gross_sales_usd) ?? 0
  const invoiceDiscount = finiteMoney(metrics.discount_usd) ?? 0
  const itemDiscount = finiteMoney(metrics.item_discount_usd) ?? 0
  const explicitTotalDiscount = finiteMoney(metrics.total_discount_usd)
  const totalDiscount = explicitTotalDiscount ?? (invoiceDiscount + itemDiscount)
  return {
    ...metrics,
    gross_sales_usd: legacyGross + itemDiscount,
    discount_usd: totalDiscount,
    total_discount_usd: totalDiscount,
  }
}

export async function getDashboardStockAlerts(params: QueryParams & { state: DashboardStockAlertState }): Promise<DashboardStockAlertPage> {
  const query = buildQueryString(params, { skipEmpty: false })
  const result = await route<DashboardStockAlertPage>(
    `dashboard:stock-alerts:${query}`,
    () => apiFetch('GET', appendQuery('/api/dashboard/stock-alerts', query)),
  )
  if (!result || !Array.isArray(result.items)) throw new Error('Dashboard stock alerts returned an invalid response')
  return {
    items: result.items,
    total: Math.max(0, Number(result.total) || 0),
    page: Math.max(1, Number(result.page) || 1),
    pageSize: Math.max(1, Number(result.pageSize) || 1),
    totalPages: Math.max(1, Number(result.totalPages) || 1),
    hasMore: Boolean(result.hasMore),
  }
}

export function getAnalytics(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(withDashboardRangeScope(params), { skipEmpty: false })
  return route(
    `analytics:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/analytics', query)),
  )
}

export function getDashboardStartup(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(withDashboardRangeScope(params), { skipEmpty: false })
  return route(
    `dashboard:startup:${query}`,
    () => apiFetch('GET', appendQuery('/api/dashboard/startup', query)),
  )
}
