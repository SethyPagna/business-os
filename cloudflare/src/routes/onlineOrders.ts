// /api/online-orders: what staff do with the storefront's paid-online orders (KHQR lane, slice S5). Logic lives in lib/onlineOrderStaff.ts.
//
// Who may call what is checked HERE, per route, from lib/onlineOrdersAccess.ts (no route trusts a screen):
//   view     GET /, GET /:id, POST /:id/recheck, POST /:id/note
//   decide   POST /:id/cancel, /:id/resolve, /:id/requests/:rid/decide, /:id/requests/:rid/apply
//   refund   POST /:id/refund-note
// Deciding and refunding also need view (a person who cannot see the order cannot act on it); Admin passes all. These routes ignore the customer-facing
// `online_orders` read switch: money already taken is always handled. The customer's phone is masked by the global response mask unless the caller holds
// "See full phone numbers"; the order's link token hash and the PayWay QR strings never leave the Worker.

import { Hono, type Context } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { canSeeFullPhones } from '../lib/phoneAccess'
import { getOnlineOrderAccess } from '../lib/onlineOrdersAccess'
import { paywayCredentialsFor } from '../lib/paywayConfig'
import { fetchPaywayTransport } from '../lib/paywayTransport'
import type { PaywayTransport } from '../lib/payway'
import { loadOrderSettings, OrderError, type OrderDeps } from '../lib/onlineOrderStore'
import { orderNotifier } from '../lib/onlineOrderAlerts'
import {
  applyRequest, cancelPaidOrder, decideRequest, listOrders, noteOrder, noteRefund, recheckOrder, resolveReview, staffDetail, type Actor,
} from '../lib/onlineOrderStaff'
import type { Env } from '../index'

export type OnlineOrdersRouteOptions = { transport?: PaywayTransport; now?: () => Date; random?: (length: number) => Uint8Array }
type Ctx = Context<{ Bindings: Env; Variables: { user: SessionUser } }>
type Need = 'view' | 'decide' | 'refund'

export function createOnlineOrdersRoute(options: OnlineOrdersRouteOptions = {}) {
  const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
  const transport = options.transport ?? fetchPaywayTransport
  const now = options.now ?? (() => new Date())
  const random = options.random ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)))
  app.use('*', requireAuth)
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('cache-control', 'private, no-store')
  })

  const depsFor = (c: Ctx): OrderDeps => ({ db: getDb(c.env), env: c.env, now, random, transport, origin: null, notify: orderNotifier(c.env) })
  const actorOf = (c: Ctx): Actor => { const user = c.get('user'); return { id: user.id, name: user.name || user.username || null } }
  const allowed = (c: Ctx, need: Need): boolean => {
    const access = getOnlineOrderAccess(c.get('user') as never)
    return need === 'view' ? access.canView : need === 'decide' ? access.canDecide : access.canRefund
  }
  const guard = (need: Need, work: (c: Ctx) => Promise<Response>) => async (c: Ctx): Promise<Response> => {
    if (!allowed(c, need)) return c.json({ error: 'You do not have access to online orders.', code: 'forbidden' }, 403)
    try { return await work(c) } catch (error) {
      if (!(error instanceof OrderError)) throw error
      return c.json({ error: error.message, code: error.code, ...error.extra }, error.status as 400 | 403 | 404 | 409 | 503)
    }
  }
  const body = async (c: Ctx): Promise<Record<string, unknown>> => {
    const parsed = await c.req.json<unknown>().catch(() => null)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  const record = (c: Ctx, action: string, id: unknown, details: Record<string, unknown> = {}) =>
    audit(c.env, c.get('user').id, c.get('user').name || null, action, 'online_order', Number(id) || null, details)

  app.get('/', guard('view', async (c) => c.json(await listOrders(getDb(c.env), c.env, { filter: c.req.query('filter'), cursor: c.req.query('cursor'), limit: c.req.query('limit'), q: c.req.query('q') }))))

  app.get('/:id', guard('view', async (c) => {
    const settings = await loadOrderSettings(getDb(c.env))
    return c.json(await staffDetail(getDb(c.env), c.req.param('id'), now(), settings.requestWindowDays, { fullPhones: canSeeFullPhones(c.get('user') as never) }))
  }))

  app.post('/:id/recheck', guard('view', async (c) => {
    const result = await recheckOrder(depsFor(c), paywayCredentialsFor(c.env), c.req.param('id'))
    await record(c, 'online_order_recheck', c.req.param('id'), { checked: result.checked })
    return c.json(result)
  }))

  app.post('/:id/note', guard('view', async (c) => {
    await noteOrder(depsFor(c), actorOf(c), c.req.param('id'), await body(c))
    await record(c, 'online_order_note', c.req.param('id'))
    return c.json({ ok: true }, 201)
  }))

  app.post('/:id/cancel', guard('decide', async (c) => {
    await cancelPaidOrder(depsFor(c), paywayCredentialsFor(c.env), actorOf(c), c.req.param('id'), await body(c))
    await record(c, 'online_order_cancel', c.req.param('id'))
    return c.json({ ok: true })
  }))

  app.post('/:id/resolve', guard('decide', async (c) => {
    await resolveReview(depsFor(c), actorOf(c), c.req.param('id'), await body(c))
    await record(c, 'online_order_resolve', c.req.param('id'))
    return c.json({ ok: true })
  }))

  app.post('/:id/refund-note', guard('refund', async (c) => {
    const input = await body(c)
    const result = await noteRefund(depsFor(c), actorOf(c), c.req.param('id'), input)
    await record(c, 'online_order_refund_note', c.req.param('id'), { amount_usd: Number(input.amount_usd) })
    return c.json({ ok: true, ...result }, 201)
  }))

  app.post('/:id/requests/:rid/decide', guard('decide', async (c) => {
    const input = await body(c)
    await decideRequest(depsFor(c), actorOf(c), c.req.param('id'), c.req.param('rid'), input)
    await record(c, 'online_order_request_decide', c.req.param('id'), { request_id: Number(c.req.param('rid')), decision: input.decision })
    return c.json({ ok: true })
  }))

  app.post('/:id/requests/:rid/apply', guard('decide', async (c) => {
    const result = await applyRequest(depsFor(c), paywayCredentialsFor(c.env), actorOf(c), c.req.param('id'), c.req.param('rid'), await body(c))
    await record(c, 'online_order_request_apply', c.req.param('id'), { request_id: Number(c.req.param('rid')), top_up_usd: result.top_up_usd })
    return c.json({ ok: true, ...result })
  }))

  return app
}

export default createOnlineOrdersRoute()
