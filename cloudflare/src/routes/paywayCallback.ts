// POST /api/payway/callback?t=<tran_id>&s=<token>: ABA PayWay telling us a payment moved.
//
// A callback is only a nudge. Its token is a pure function of the transaction id and a key only this Worker holds (lib/payway.ts callbackUrlFor), so a
// request that does not carry it is refused before any read, and one that does carry it still proves nothing about the money: the Worker asks PayWay
// itself (check-transaction-2) and only an APPROVED answer for the exact amount makes a payment Paid. The request body is never read, so there is
// nothing in it to trust, log or leak. The answer is the same short JSON for every verified call, whatever happened, so a caller learns nothing.
//
// It ignores the `online_orders` read switch: money already taken is always handled. It does not use the browser guards (origin, JSON): the caller is
// ABA's server, not a browser. The shop host lets exactly this POST through (lib/publicHostGate.ts).

import { Hono } from 'hono'
import { getDb } from '../lib/db'
import type { Env } from '../index'
import { validTranId, verifyCallbackToken, type PaywayTransport } from '../lib/payway'
import { paywayCredentialsFor } from '../lib/paywayConfig'
import { fetchPaywayTransport } from '../lib/paywayTransport'
import { orderNotifier } from '../lib/onlineOrderAlerts'
import { settleByTranId, type SettleResult } from '../lib/onlineOrderSweep'
import type { OrderDeps } from '../lib/onlineOrderStore'

export type PaywayCallbackOptions = {
  transport?: PaywayTransport
  now?: () => Date
  /** Called after a payment was settled by this callback (Telegram notices, a later slice step). Never awaited by the answer. */
  onSettled?: (env: Env, result: SettleResult, waitUntil: (promise: Promise<unknown>) => void) => Promise<void>
}

export function createPaywayCallbackRoute(options: PaywayCallbackOptions = {}) {
  const app = new Hono<{ Bindings: Env }>()
  const transport = options.transport ?? fetchPaywayTransport
  const now = options.now ?? (() => new Date())

  app.post('/callback', async (c) => {
    const tranId = c.req.query('t')
    const token = c.req.query('s')
    if (!validTranId(tranId) || !(await verifyCallbackToken(c.env, tranId, token))) return c.json({ ok: false }, 403)
    // Whether ABA sent its signature header is worth knowing (it tells us if the signed callback is switched on at ABA). Only the yes/no is logged, never the
    // value, and it is not used to trust anything: the check-transaction answer is what decides.
    console.log('[payway-callback] signature header', c.req.header('x-payway-hmac-sha512') ? 'present' : 'absent')
    const creds = paywayCredentialsFor(c.env)
    // Without credentials nothing can be confirmed. ABA is told "received" so it stops retrying; the sweep and the customer's page settle it once keys exist.
    if (!creds) return c.json({ ok: true })
    const deps: OrderDeps = {
      db: getDb(c.env), env: c.env, now, random: (n) => crypto.getRandomValues(new Uint8Array(n)), transport, origin: null, notify: orderNotifier(c.env),
    }
    try {
      const result = await settleByTranId(deps, creds, tranId)
      if (options.onSettled) {
        const pending = options.onSettled(c.env, result, (promise) => { try { c.executionCtx.waitUntil(promise) } catch { void promise.catch(() => {}) } })
        try { c.executionCtx.waitUntil(pending.catch(() => {})) } catch { await pending.catch(() => {}) }
      }
    } catch (error) {
      // A D1 or PayWay failure must not make ABA retry in a storm: the sweep will find the payment within minutes.
      console.error('[payway-callback] settle failed', (error as Error)?.name || 'error')
    }
    return c.json({ ok: true })
  })

  return app
}

export default createPaywayCallbackRoute()
