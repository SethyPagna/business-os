import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

// Frontend transport for the Fees page (cloudflare/src/routes/fees.ts).
// No local/offline mirror -- same reasoning as notesTransport.ts: a failed
// fee save while offline just surfaces as a normal error rather than
// needing an outbox/sync story like sales or inventory writes, since fees
// aren't part of the POS checkout critical path.

// 'expense' joined the set with the old-system expense migration (Part 379):
// 4,240 historical expense entries carry fee_type='expense', and manual
// entry offers it too. The column is free text in D1; this union is the
// frontend's vocabulary.
export type FeeType = 'tax' | 'delivery' | 'change' | 'expense' | 'other'

export type FeeRecord = {
  id: number
  fee_type: FeeType
  label: string | null
  amount_usd: number
  amount_khr: number
  fee_date: string
  sale_id: number | null
  sale_receipt_number?: string | null
  branch_id: number | null
  branch_name?: string | null
  notes: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type FeeSummaryRow = {
  fee_type: FeeType
  count: number
  total_usd: number
  total_khr: number
}

export type FeeListResult = {
  fees: FeeRecord[]
  total: number
  limit: number
  offset: number
  summary: FeeSummaryRow[]
}

export type FeeListParams = {
  search?: string
  fee_type?: string
  from?: string
  to?: string
  sale_id?: number | string
  branch_id?: number | string
  limit?: number
  offset?: number
}

export type FeePayload = {
  fee_type?: FeeType | string
  label?: string | null
  amount_usd?: number
  amount_khr?: number
  fee_date?: string
  sale_id?: number | null
  branch_id?: number | null
  notes?: string | null
  expectedUpdatedAt?: string | null
}

export function getFees(params: FeeListParams = {}): Promise<FeeListResult> {
  const query = buildQueryString(params as QueryParams)
  return route(
    'fees:get',
    () => apiFetch('GET', appendQuery('/api/fees', query)),
    () => ({ fees: [], total: 0, limit: 100, offset: 0, summary: [] }),
    { raceLocalFallback: false },
  ) as Promise<FeeListResult>
}

export function getFee(id: number): Promise<{ fee: FeeRecord }> {
  // The channel string is BOTH the 20s read-cache key and the in-flight
  // dedupe key in route(); a constant 'fees:get-one' made every id share one
  // slot, so opening fee B within the cache window rendered fee A's data (the
  // same class as the fixed lots-per-channel bug). The id is part of the key
  // now. Write-invalidation still works: it clears by entity prefix
  // (getChannelRefreshKey splits on ':' -> 'fees'), which covers every
  // per-id entry.
  return route(
    `fees:get-one:${id}`,
    () => apiFetch('GET', `/api/fees/${encodeURIComponent(String(id))}`),
    null,
    { raceLocalFallback: false },
  ) as Promise<{ fee: FeeRecord }>
}

// Reports hub: fee totals over a range (startDate/endDate/branchId), keyed on
// fee_date. Mirrors the sales daily-report transport shape.
export function getFeesReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `fees:report:${query}`,
    () => apiFetch('GET', appendQuery('/api/fees/report', query)),
    null,
    { raceLocalFallback: false },
  )
}

export function createFee(payload: FeePayload): Promise<{ fee: FeeRecord }> {
  return route(
    'fees:create',
    () => apiFetch('POST', '/api/fees', payload),
    null,
    true,
  ) as Promise<{ fee: FeeRecord }>
}

export function updateFee(id: number, payload: FeePayload): Promise<{ fee: FeeRecord }> {
  return route(
    'fees:update',
    () => apiFetch('PUT', `/api/fees/${encodeURIComponent(String(id))}`, payload),
    null,
    true,
  ) as Promise<{ fee: FeeRecord }>
}

export function deleteFee(id: number): Promise<{ success: boolean }> {
  return route(
    'fees:delete',
    () => apiFetch('DELETE', `/api/fees/${encodeURIComponent(String(id))}`),
    null,
    true,
  ) as Promise<{ success: boolean }>
}
