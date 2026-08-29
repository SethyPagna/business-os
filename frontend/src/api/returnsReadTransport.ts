import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

function encodeId(id: number | string): string {
  return encodeURIComponent(String(id))
}

export function getReturns(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  const cacheKey = query ? `returns:get:${query}` : 'returns:get'
  return route(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/returns', query)),
    () => null,
  )
}

export function getReturn(id: number | string): Promise<unknown> {
  return route(
    'returns:getOne',
    () => apiFetch('GET', `/api/returns/${encodeId(id)}`),
    () => null,
  )
}

// Reports hub: customer-return (refund) totals over a range. Mirrors the
// sales daily-report transport shape (startDate/endDate/branchId).
export function getReturnsReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `returns:report:${query}`,
    () => apiFetch('GET', appendQuery('/api/returns/report', query)),
    () => null,
  )
}
