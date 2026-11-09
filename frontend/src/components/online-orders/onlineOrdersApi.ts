import { apiFetch, route } from '../../api/http.ts'
import { appendQuery, buildQueryString } from '../../api/query.ts'
import type { OrderFilter, StaffOrderDetail, StaffOrderPage } from './onlineOrdersLogic.ts'

// What staff do with the storefront's paid-online orders (cloudflare/src/routes/onlineOrders.ts). Every route checks its own permission on the Worker; a
// refusal comes back as an Error with `.code` (forbidden, order_changed, refund_over_due, ...), which the screen turns into a sentence (staffErrorKey).

const base = '/api/online-orders'
const orderPath = (id: number) => `${base}/${encodeURIComponent(String(id))}`

/** A search (`q`) spans every state, so it is sent without a filter; a chip is sent without a search. */
export const listOnlineOrders = (filter: OrderFilter | null, q: string | null, cursor: string | null, signal?: AbortSignal): Promise<StaffOrderPage> =>
  apiFetch('GET', appendQuery(base, buildQueryString({ filter: q ? null : filter, q, cursor })), undefined, undefined, { signal })

export const getOnlineOrder = (id: number, signal?: AbortSignal): Promise<StaffOrderDetail> =>
  apiFetch('GET', orderPath(id), undefined, undefined, { signal })

async function write<T>(channel: string, path: string, body: unknown): Promise<T> {
  const result = await route<T>(channel, () => apiFetch('POST', path, body), null, true)
  if (result === null || result === undefined) throw Object.assign(new Error('The change was not confirmed.'), { outcome: 'unknown' })
  return result
}

export const recheckOnlineOrder = (id: number) => write<{ checked: number; outcomes: string[] }>('onlineOrders:recheck', `${orderPath(id)}/recheck`, {})
export const noteOnlineOrder = (id: number, body: { note: string }) => write<{ ok: true }>('onlineOrders:note', `${orderPath(id)}/note`, body)
export const cancelOnlineOrder = (id: number, body: { reason?: string; revision: number }) => write<{ ok: true }>('onlineOrders:cancel', `${orderPath(id)}/cancel`, body)
export const resolveOnlineOrder = (id: number, body: { note?: string; revision: number }) => write<{ ok: true }>('onlineOrders:resolve', `${orderPath(id)}/resolve`, body)
export const noteOnlineOrderRefund = (id: number, body: { amount_usd: number; reference?: string; note?: string }) =>
  write<{ ok: true; due_after_usd: number }>('onlineOrders:refund', `${orderPath(id)}/refund-note`, body)
export const decideOnlineOrderRequest = (id: number, requestId: number, body: { decision: 'accept' | 'reject'; public_comment?: string; internal_note?: string }) =>
  write<{ ok: true }>('onlineOrders:decide', `${orderPath(id)}/requests/${encodeURIComponent(String(requestId))}/decide`, body)
export const applyOnlineOrderRequest = (id: number, requestId: number, body: { revision: number }) =>
  write<{ ok: true; top_up_usd: number }>('onlineOrders:apply', `${orderPath(id)}/requests/${encodeURIComponent(String(requestId))}/apply`, body)
