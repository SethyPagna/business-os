import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

// Frontend transport for the Fees page (cloudflare/src/routes/fees.ts).
// No local/offline mirror -- same reasoning as notesTransport.ts: a failed
// fee save while offline just surfaces as a normal error rather than
// needing an outbox/sync story like sales or inventory writes, since fees
// aren't part of the POS checkout critical path.

export type FeeType = 'tax' | 'delivery' | 'change' | 'other'

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
  return route(
    'fees:get-one',
    () => apiFetch('GET', `/api/fees/${encodeURIComponent(String(id))}`),
    null,
    { raceLocalFallback: false },
  ) as Promise<{ fee: FeeRecord }>
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
