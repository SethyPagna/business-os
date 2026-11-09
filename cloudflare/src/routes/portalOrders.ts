// /api/portal/orders: the storefront's paid-online order API (KHQR lane, slice S3). The database half is lib/onlineOrderStore.ts.
//
//   POST /                          create an order and get its QR
//   GET  /:token                    the order as the customer reads it (with a throttled "has it been paid?" nudge)
//   GET  /:token/status             the light poll: one order row, the nudge when it is due
//   POST /:token/edit               change a waiting order directly (a new list means a new QR)
//   POST /:token/cancel             cancel a waiting order
//   POST /:token/retry              a new QR for the same amount (failed, or the time ran out)
//   POST /:token/topup              a new QR for an extra amount staff asked for
//   POST /:token/requests           ask for a change or a return after paying (the customer re-enters the order phone)
//   POST /:token/requests/:id/withdraw
//
// The link token is the customer's key to its own order: 128 random bits, only its SHA-256 is stored. A leaked link can read the order but cannot
// change a paid one: requests and withdrawals also need the order phone. Every write is a same-origin JSON POST (a cross-site form cannot send one).
// With the read switch `online_orders` off every WRITE answers 404 feature_off and nothing is read or written. Reading an existing order (the two GETs)
// stays open so a customer who paid can still see it; the PayWay callback, the sweep and the staff side (other slices) ignore the switch, so money
// already taken is always handled.

import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { getDb } from '../lib/db'
import type { Env } from '../index'
import { admitRequestBody, requireJsonSameOriginCredentialPost, SMALL_BODY_BYTES } from '../lib/requestBodyGuard'
import { readSwitch } from '../lib/readSwitches'
import { getClientNetworkKey } from '../lib/rateLimit'
import { portalAbuseKey } from '../lib/portalAbuseKey'
import { getPortalAccountState } from '../lib/portalSession'
import { hashOrderToken, isOrderToken } from '../lib/onlineOrders'
import { paywayCredentials, type PaywayCredentials, type PaywayTransport } from '../lib/payway'
import { fetchPaywayTransport } from '../lib/paywayTransport'
import { orderNotifier } from '../lib/onlineOrderAlerts'
import {
  OrderError, bundleFromToken, cancelOrder, createOrder, editOrder, loadOrderSettings, nudgeOrder, parseOrderInput, publicOrderView, resetNudgeThrottleForTests,
  retryOrderQr, retryTopUpQr, submitRequest, withdrawRequest, type OrderBundle, type OrderDeps,
} from '../lib/onlineOrderStore'

export const ORDER_FEATURE_SWITCH = 'online_orders'
const NO_STORE = 'private, no-store'
const PORTAL_COOKIE_NAME = 'bos_portal'

export type PortalOrdersOptions = {
  transport?: PaywayTransport
  now?: () => Date
  random?: (length: number) => Uint8Array
}

type OrderContext = Context<{ Bindings: Env }>

export function createPortalOrdersRoute(options: PortalOrdersOptions = {}) {
  const app = new Hono<{ Bindings: Env }>()
  const transport = options.transport ?? fetchPaywayTransport
  const now = options.now ?? (() => new Date())
  const random = options.random ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)))

  const depsFor = (c: OrderContext): OrderDeps => {
    let origin: string | null = null
    try {
      const url = new URL(String(c.env.BUSINESS_OS_PUBLIC_URL ?? ''))
      origin = url.protocol === 'https:' ? url.origin : null
    } catch { origin = null }
    return { db: getDb(c.env), env: c.env, now, random, transport, origin, notify: orderNotifier(c.env) }
  }

  // An order's responses are about one customer: never stored by a browser or a shared cache.
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('cache-control', NO_STORE)
  })
  app.use('*', requireJsonSameOriginCredentialPost)
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const rejection = await admitRequestBody(c, SMALL_BODY_BYTES)
      if (rejection) return rejection
    }
    return next()
  })
  app.use('*', async (c, next) => {
    // Reading an order that exists stays open with the switch off (owner decision, 9 Nov): a customer who paid still sees it. Every write is closed.
    if (c.req.method !== 'GET' && !(await readSwitch(c.env, ORDER_FEATURE_SWITCH))) return c.json({ error: 'Online ordering is not available.', code: 'feature_off' }, 404)
    return next()
  })

  const fail = (c: OrderContext, error: unknown) => {
    if (!(error instanceof OrderError)) throw error
    return c.json({ error: error.message, code: error.code, ...error.extra }, error.status as 400 | 403 | 404 | 409 | 429 | 502 | 503)
  }
  const run = async (c: OrderContext, work: () => Promise<Response>): Promise<Response> => {
    try { return await work() } catch (error) { return fail(c, error) }
  }
  const readBody = async (c: OrderContext): Promise<Record<string, unknown>> => {
    const body = await c.req.json<unknown>().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new OrderError(400, 'invalid_json', 'We could not read your request. Please reload the page and try again.')
    }
    return body as Record<string, unknown>
  }
  /** Per network, through the Workers RateLimit binding: no D1 write. The limiter is a guard, not a dependency: its outage opens nothing and closes nothing. */
  const limited = async (c: OrderContext, scope: string, extra = ''): Promise<boolean> => {
    const limiter = c.env.ORDER_LIMITER
    if (!limiter) return false
    try {
      return !(await limiter.limit({ key: `${scope}:${getClientNetworkKey(c.req.raw)}${extra}` })).success
    } catch (error) {
      console.error('[online-orders] rate limiter unavailable', error)
      return false
    }
  }
  const tooMany = (c: OrderContext) => {
    c.header('Retry-After', '60')
    return c.json({ error: 'Too many attempts. Please wait a minute and try again.', code: 'rate_limited' }, 429)
  }
  const credentials = (c: OrderContext): PaywayCredentials | null => paywayCredentials(c.env)
  const needCredentials = (c: OrderContext): PaywayCredentials => {
    const creds = credentials(c)
    if (!creds) throw new OrderError(503, 'payway_not_configured', 'Online payment is not available right now. Please contact the shop.')
    return creds
  }
  const present = async (c: OrderContext, bundle: OrderBundle, status = 200, extra: Record<string, unknown> = {}) => {
    const settings = await loadOrderSettings(getDb(c.env))
    return c.json({ order: publicOrderView(bundle, now(), settings), ...extra }, status as 200 | 201)
  }
  /** After a nudge settled the order, the page must see the new state, so it is read again; otherwise the bundle in hand is the truth. */
  const nudged = async (c: OrderContext, bundle: OrderBundle): Promise<OrderBundle> => {
    const outcome = await nudgeOrder(depsFor(c), credentials(c), bundle.order)
    return outcome === 'none' ? bundle : await bundleFromToken(getDb(c.env), c.req.param('token'))
  }

  // ---- create ----
  app.post('/', (c) => run(c, async () => {
    if (await limited(c, 'create')) return tooMany(c)
    needCredentials(c)
    const body = await readBody(c)
    // The honeypot: a real visitor never sees this field. The answer is the same plain refusal as any other unreadable request.
    if (typeof body.website === 'string' && body.website.trim()) throw new OrderError(400, 'invalid_request', 'Something went wrong. Please reload the page and try again.')
    const input = parseOrderInput(body, c.env)
    const networkKey = await portalAbuseKey(c.env, 'online-order:network', getClientNetworkKey(c.req.raw))
    if (!networkKey) throw new OrderError(503, 'portal_privacy_unavailable', 'Online ordering is not available right now. Please try again later.')
    let portalAccountId: number | null = null
    if (getCookie(c, PORTAL_COOKIE_NAME)) {
      const state = await getPortalAccountState(c)
      portalAccountId = state.status === 'authenticated' && state.account ? Number((state.account as { id?: unknown }).id) || null : null
    }
    const clientRequestId = typeof body.client_request_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.client_request_id) ? body.client_request_id : null
    const created = await createOrder(depsFor(c), credentials(c), input, { networkKey, portalAccountId, clientRequestId })
    return present(c, created.bundle, 201, { token: created.token })
  }))

  // ---- reads ----
  app.get('/:token/status', (c) => run(c, async () => {
    const token = c.req.param('token')
    if (!isOrderToken(token)) throw new OrderError(404, 'order_not_found', 'We could not find this order. Check the link you were given.')
    const db = getDb(c.env)
    const hash = await hashOrderToken(token)
    const read = () => db.prepare('SELECT id, state, created_at, paid_at, revision, goods_total_usd FROM online_orders WHERE token_hash = @h')
      .get<{ id: number; state: string; created_at: string; paid_at: string | null; revision: number; goods_total_usd: number }>({ h: hash })
    let row = await read()
    if (!row) throw new OrderError(404, 'order_not_found', 'We could not find this order. Check the link you were given.')
    const outcome = await nudgeOrder(depsFor(c), credentials(c), row)
    if (outcome !== 'none') row = (await read()) ?? row
    return c.json({ state: row.state, revision: row.revision, paid_at: row.paid_at, total_usd: row.goods_total_usd })
  }))

  app.get('/:token', (c) => run(c, async () => {
    const bundle = await nudged(c, await bundleFromToken(getDb(c.env), c.req.param('token')))
    return present(c, bundle)
  }))

  // ---- writes on a waiting order ----
  app.post('/:token/edit', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    needCredentials(c)
    const body = await readBody(c)
    return present(c, await editOrder(depsFor(c), credentials(c), c.req.param('token'), body))
  }))
  app.post('/:token/cancel', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    await readBody(c)
    return present(c, await cancelOrder(depsFor(c), credentials(c), c.req.param('token')))
  }))
  app.post('/:token/retry', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    needCredentials(c)
    await readBody(c)
    return present(c, await retryOrderQr(depsFor(c), credentials(c), c.req.param('token')))
  }))
  app.post('/:token/topup', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    needCredentials(c)
    const body = await readBody(c)
    return present(c, await retryTopUpQr(depsFor(c), credentials(c), c.req.param('token'), body.request_id))
  }))

  // ---- requests after payment ----
  // Guessing the phone behind a leaked link is bounded per link as well as per network.
  app.post('/:token/requests', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    const token = c.req.param('token')
    if (isOrderToken(token) && await limited(c, 'phone', `:${(await hashOrderToken(token)).slice(0, 16)}`)) return tooMany(c)
    const body = await readBody(c)
    const networkKey = await portalAbuseKey(c.env, 'online-order:network', getClientNetworkKey(c.req.raw))
    return present(c, await submitRequest(depsFor(c), token, body, networkKey), 201)
  }))
  app.post('/:token/requests/:id/withdraw', (c) => run(c, async () => {
    if (await limited(c, 'write')) return tooMany(c)
    const token = c.req.param('token')
    if (isOrderToken(token) && await limited(c, 'phone', `:${(await hashOrderToken(token)).slice(0, 16)}`)) return tooMany(c)
    const body = await readBody(c)
    return present(c, await withdrawRequest(depsFor(c), token, c.req.param('id'), body.phone))
  }))

  return app
}

export { resetNudgeThrottleForTests }
export default createPortalOrdersRoute()
