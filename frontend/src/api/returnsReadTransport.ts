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
  // Per-id cache/dedupe key: a constant 'returns:getOne' made every return
  // share one 20s cache slot, so opening return B within the window rendered
  // return A. Write-invalidation is by 'returns' prefix, so per-id keys still
  // clear. (See feesTransport.getFee for the full reasoning.)
  return route(
    `returns:getOne:${encodeId(id)}`,
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
