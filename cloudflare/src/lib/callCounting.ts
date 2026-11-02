import type { Context, Next } from 'hono'
import type { Env } from '../index'
import { resolvePlanTier } from './planTier'
import { readSwitch } from './readSwitches'
import { requestMetricsOf } from './requestMetrics'

// D1's per-invocation limit counts calls: a db.batch() is one, however many statements it holds. With call_counting ON,
// write-path admission charges a batch as one call; OFF keeps the statement count. Paid (1000) never consults the switch.
export const CALL_COUNTING_SWITCH = 'call_counting'
export const CALL_COUNTING_HOOK_KEY = 'business-os.call-counting.v1'

export async function callCountingOn(env: Env): Promise<boolean> {
  if (resolvePlanTier(env) !== 'free') return false
  try { return await readSwitch(env, CALL_COUNTING_SWITCH) } catch { return false }
}

/** Gives this request's metrics a once-per-request resolver; a route that never asks never reads the switch. */
export async function callCountingMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  const metrics = requestMetricsOf(c as unknown as Context)
  if (metrics && resolvePlanTier(c.env) === 'free') {
    let pending: Promise<boolean> | undefined
    metrics.callCounting = () => (pending ??= callCountingOn(c.env))
  }
  await next()
}

// Queue consumers (imports) have no request metrics and importEngine imports nothing from here, so they reach it through this global.
;(globalThis as unknown as Record<symbol, { on(env: Env): Promise<boolean> }>)[Symbol.for(CALL_COUNTING_HOOK_KEY)] = { on: callCountingOn }
