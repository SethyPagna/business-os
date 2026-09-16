// Transport for the "Business summary" workbook backend (Section 5, Sep 2
// 2026 RC) -- cloudflare/src/routes/reports.ts. Plain read-only GETs, no
// offline mirror/dedupe (this is an export-time report pull, not app state
// that needs to work while offline) -- same shape salesTransport.ts already
// uses for its own read-only aggregate endpoints (getSalesStatsStrip,
// getSalesDailyReport): apiFetch directly, no local fallback that could
// fabricate a zero/empty result and silently produce a wrong export.
import { apiFetch } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

export function getBusinessSummary(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/business-summary', query))
}

export function getBusinessSummarySalesPage(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/business-summary/sales', query))
}

export function getBusinessSummaryReturnsPage(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/business-summary/returns', query))
}

export function getBusinessSummaryExpensesPage(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/business-summary/expenses', query))
}

// Reports redesign (Sep 3 2026, rc/sec-10): the per-view read endpoints.
// Same read-only shape as the pages above -- no offline mirror, no fallback.
export function getReportOverview(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/overview', query))
}

export function getReportPeriods(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/periods', query))
}

export function getReportGrouped(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/reports/grouped', query))
}
