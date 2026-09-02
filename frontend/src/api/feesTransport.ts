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
    // route() uses this channel as both its 20-second cache key and its
    // in-flight de-duplication key. Include every effective list parameter;
    // otherwise page 2, a new page size, or a changed filter can reuse page
    // 1's cached response and make the pagination controls look broken.
    `fees:get:${query || 'all'}`,
    () => apiFetch('GET', appendQuery('/api/fees', query)),
    () => ({ fees: [], total: 0, limit: 100, offset: 0, summary: [] }),
    { raceLocalFallback: false },
  ) as Promise<FeeListResult>
}

// Fetch EVERY expense record matching the given filters (for CSV export),
// paginating past the server's 500-row cap (routes/fees.ts clamps limit to
// 500). Two deliberate choices keep the result complete and correct:
//   - It calls apiFetch directly rather than filling the interactive list's
//     short-lived route cache with every export page. apiFetch's GET de-dupe
//     key includes the offset in the path, so every page is distinct.
//   - The loop is driven by the server's reported `total`, so it stops exactly
//     when every matching row has been gathered and never truncates a real
//     set; a page ceiling derived from that same total guards against a
//     malformed response spinning forever.
export async function getAllFeesForExport(
  params: Omit<FeeListParams, 'limit' | 'offset'> = {},
  onProgress?: (loaded: number, total: number) => void,
): Promise<FeeRecord[]> {
  const PAGE = 500
  const all: FeeRecord[] = []
  let offset = 0
  let total = 0
  let pagesRemaining = 1
  do {
    const query = buildQueryString({ ...params, limit: PAGE, offset } as QueryParams)
    const result = (await apiFetch('GET', appendQuery('/api/fees', query))) as FeeListResult | null
    const rows = Array.isArray(result?.fees) ? result!.fees : []
    if (offset === 0) {
      total = Number(result?.total) || rows.length
      pagesRemaining = Math.max(1, Math.ceil(total / PAGE))
    }
    all.push(...rows)
    onProgress?.(all.length, total)
    offset += PAGE
    pagesRemaining -= 1
    if (rows.length < PAGE) break // server ran out early -- nothing more to page
  } while (all.length < total && pagesRemaining > 0)
  return all
}

// Every distinct saved label with its usage count and dominant fee type,
// most-used first (GET /api/fees/labels). FeeForm offers these as
// suggestions and auto-picks the dominant type when a known label is chosen.
export type FeeLabelSuggestion = {
  label: string
  uses: number
  fee_type: FeeType
  type_counts?: Array<{ fee_type: FeeType; uses: number }>
}

export function getFeeLabels(): Promise<{ labels: FeeLabelSuggestion[] }> {
  return route(
    'fees:labels',
    () => apiFetch('GET', '/api/fees/labels'),
    () => ({ labels: [] }),
    { raceLocalFallback: false },
  ) as Promise<{ labels: FeeLabelSuggestion[] }>
}

export function getFeeLabelImpact(from: string, to: string): Promise<unknown> {
  const query = new URLSearchParams({ from, to })
  return apiFetch('GET', `/api/fees/labels/impact?${query.toString()}`)
}

export function replaceFeeLabel(from: string, to: string): Promise<unknown> {
  return apiFetch('POST', '/api/fees/labels/replace', { from, to })
}

export type FeeLabelTypeImpact = {
  label: string
  linked_records: number
  type_counts: Array<{ fee_type: FeeType; uses: number }>
  historical_snapshots_preserved: string[]
}

export function getFeeLabelTypeImpact(label: string): Promise<FeeLabelTypeImpact> {
  const query = new URLSearchParams({ label })
  return apiFetch('GET', `/api/fees/labels/type-impact?${query.toString()}`) as Promise<FeeLabelTypeImpact>
}

export function classifyFeeLabel(label: string, feeType: FeeType): Promise<{ success: boolean; changed: number; label: string; fee_type: FeeType }> {
  return apiFetch('POST', '/api/fees/labels/classify', { label, fee_type: feeType }) as Promise<{ success: boolean; changed: number; label: string; fee_type: FeeType }>
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
