import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

// Frontend transport for the Review/Approval queue page
// (cloudflare/src/routes/reviewQueue.ts). Step (3) of the "Permissions UI
// redesign" item in progress.md -- the approval page itself. No local/
// offline mirror, same reasoning as feesTransport.ts: reviewing/approving
// a queued write isn't part of the POS checkout critical path, so a
// failed request while offline just surfaces as a normal error.

export type PendingActionStatus = 'open' | 'approved' | 'rejected'

export type PendingActionRow = {
  id: number
  section: string
  action_type: string
  entity_type: string
  entity_id: number | null
  payload_json: string
  summary: string | null
  status: PendingActionStatus
  requested_by: number | null
  requested_by_name: string | null
  reviewed_by: number | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string
}

export type PendingActionListParams = {
  status?: PendingActionStatus | 'all'
  section?: string
}

export function getPendingActions(params: PendingActionListParams = {}): Promise<{ data: PendingActionRow[] }> {
  const query = buildQueryString(params as QueryParams)
  return route(
    `review:list:${query || 'all'}`,
    () => apiFetch('GET', appendQuery('/api/review', query)),
    () => ({ data: [] }),
    { raceLocalFallback: false },
  ) as Promise<{ data: PendingActionRow[] }>
}

export function getPendingAction(id: number): Promise<{ data: PendingActionRow }> {
  return route(
    `review:get-one:${id}`,
    () => apiFetch('GET', `/api/review/${encodeURIComponent(String(id))}`),
    null,
    { raceLocalFallback: false },
  ) as Promise<{ data: PendingActionRow }>
}

// A 501 ("no applier registered yet for this section/action/entity") and a
// 409 ("already reviewed by someone else") are both real, expected
// outcomes a caller should surface as-is rather than swallow -- apiFetch
// already throws on non-2xx with the server's own error message attached,
// same as every other write in this codebase.
export function approvePendingAction(id: number): Promise<{ success: boolean; data: PendingActionRow }> {
  return route(
    'review:approve',
    () => apiFetch('POST', `/api/review/${encodeURIComponent(String(id))}/approve`),
    null,
    true,
  ) as Promise<{ success: boolean; data: PendingActionRow }>
}

export function rejectPendingAction(id: number, reason?: string | null): Promise<{ success: boolean; data: PendingActionRow }> {
  return route(
    'review:reject',
    () => apiFetch('POST', `/api/review/${encodeURIComponent(String(id))}/reject`, reason ? { reason } : {}),
    null,
    true,
  ) as Promise<{ success: boolean; data: PendingActionRow }>
}
