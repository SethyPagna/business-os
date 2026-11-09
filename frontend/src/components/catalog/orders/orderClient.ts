import { clockSkewMs } from './orderLogic.ts'
import { isOrderToken } from './orderPath.ts'
import type { OrderApiFailure, OrderApiResult, OrderStatusPoll, OrderView } from './orderTypes.ts'

// The storefront's client for /api/portal/orders (cloudflare/src/routes/portalOrders.ts). Same-origin JSON, no credentials of its own:
// the order link's token is the key. A signed-in shopper's cookie travels only on create, so the order can attach to the account.
//
// Every failure comes back as a value ({ ok: false, code }), never a throw, and `code` is what the screens translate: the server's
// English `error` sentence is deliberately dropped here, because the shopper may be reading Khmer.

export type OrderApiDeps = {
  fetch?: typeof fetch
  /** Defaults to this page's own origin. */
  baseUrl?: string
  timeoutMs?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 15_000
const PORTAL_HEADERS = { 'bypass-tunnel-reminder': 'true' }

type CreatedOrder = { order: OrderView; token: string }
type ViewOnly = { order: OrderView }

export type OrderApi = {
  create: (body: Record<string, unknown>) => Promise<OrderApiResult<CreatedOrder>>
  get: (token: string) => Promise<OrderApiResult<OrderView>>
  status: (token: string) => Promise<OrderApiResult<OrderStatusPoll>>
  edit: (token: string, body: Record<string, unknown>) => Promise<OrderApiResult<OrderView>>
  cancel: (token: string) => Promise<OrderApiResult<OrderView>>
  retry: (token: string) => Promise<OrderApiResult<OrderView>>
  topUp: (token: string, requestId: number) => Promise<OrderApiResult<OrderView>>
  request: (token: string, body: Record<string, unknown>) => Promise<OrderApiResult<OrderView>>
  withdraw: (token: string, requestId: number, phone: string) => Promise<OrderApiResult<OrderView>>
}

const failure = (code: string, status: number, retryable: boolean, body: Record<string, unknown> = {}): OrderApiFailure => {
  const { error: _error, code: _code, token, order_no: orderNo, retryable: bodyRetryable, ...extra } = body
  return {
    ok: false, code, status,
    retryable: typeof bodyRetryable === 'boolean' ? bodyRetryable : retryable,
    extra,
    token: typeof token === 'string' ? token : null,
    orderNo: typeof orderNo === 'string' ? orderNo : null,
  }
}

export function createOrderApi(deps: OrderApiDeps = {}): OrderApi {
  const fetchImpl = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  const base = (deps.baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = deps.now ?? Date.now

  async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, withCredentials = false): Promise<OrderApiResult<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${base}/api/portal/orders${path}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json', ...PORTAL_HEADERS } : PORTAL_HEADERS,
        ...(withCredentials ? { credentials: 'include' as const } : {}),
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: controller.signal,
        cache: 'no-store',
      })
      const receivedAt = now()
      const parsed = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!response.ok) {
        const code = parsed && typeof parsed.code === 'string' && parsed.code ? parsed.code : 'unknown'
        return failure(code, response.status, response.status >= 500 || response.status === 429, parsed ?? {})
      }
      if (!parsed || typeof parsed !== 'object') return failure('bad_response', response.status, true)
      return { ok: true, data: parsed as T, skewMs: clockSkewMs(response.headers.get('date'), receivedAt) }
    } catch (error) {
      const aborted = (error as { name?: string } | null)?.name === 'AbortError'
      return failure(aborted ? 'timeout' : 'network', 0, true)
    } finally {
      clearTimeout(timer)
    }
  }

  // A malformed token cannot be an order: answer "not found" without asking the server.
  const missing = <T>(): OrderApiResult<T> => failure('order_not_found', 404, false)
  const unwrap = async (result: Promise<OrderApiResult<ViewOnly>>): Promise<OrderApiResult<OrderView>> => {
    const done = await result
    if (!done.ok) return done
    return done.data.order ? { ok: true, data: done.data.order, skewMs: done.skewMs } : failure('bad_response', 200, true)
  }
  const withToken = <T>(token: string, run: (encoded: string) => Promise<OrderApiResult<T>>): Promise<OrderApiResult<T>> =>
    isOrderToken(token) ? run(encodeURIComponent(token)) : Promise.resolve(missing<T>())

  return {
    async create(body) {
      const done = await call<{ order?: OrderView; token?: string }>('POST', '', body, true)
      if (!done.ok) return done
      const { order, token } = done.data
      return order && typeof token === 'string' ? { ok: true, data: { order, token }, skewMs: done.skewMs } : failure('bad_response', 201, false)
    },
    get: (token) => withToken(token, (t) => unwrap(call<ViewOnly>('GET', `/${t}`))),
    status: (token) => withToken(token, (t) => call<OrderStatusPoll>('GET', `/${t}/status`)),
    edit: (token, body) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/edit`, body))),
    cancel: (token) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/cancel`, {}))),
    retry: (token) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/retry`, {}))),
    topUp: (token, requestId) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/topup`, { request_id: requestId }))),
    request: (token, body) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/requests`, body))),
    withdraw: (token, requestId, phone) => withToken(token, (t) => unwrap(call<ViewOnly>('POST', `/${t}/requests/${encodeURIComponent(String(requestId))}/withdraw`, { phone }))),
  }
}
