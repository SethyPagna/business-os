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

export function getReturnReasonPresets(): Promise<unknown> {
  return route(
    'returns:reason-presets',
    () => apiFetch('GET', '/api/returns/reason-presets'),
    () => ({ configured: false, presets: { customer: [], supplier: [] } }),
    { raceLocalFallback: false },
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

// Receipt typeahead for the New Return flow. The old flow pulled 500 sales to
// the browser and Array.find()'d them, so a receipt outside that page simply
// did not exist and nothing was shown while the operator typed. This asks the
// server, which matches the bare YYYYMMDD-HHMMSS number, a partial run of
// digits across its separators, the sale id, and the legacy NNNNNN@YYYY-MM-DD
// number -- capped server-side at 20 rows.
//
// Deliberately NOT routed through the shared 20s response cache: a receipt
// minted seconds ago has to be findable, and every keystroke is its own query
// anyway, so there is nothing to reuse.
export function lookupReturnReceipts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/returns/receipt-lookup', query))
}
