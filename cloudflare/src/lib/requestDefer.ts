// The request's own `waitUntil`, reachable from code that has no Hono context.
//
// A side effect that must not hold a user's response -- today the review queue's Telegram alert
// (lib/reviewAlert.ts) -- is created deep inside lib code (lib/reviewGate.ts has no `c`). index.ts registers the
// request's `executionCtx.waitUntil` ONCE, around every /api request, in an AsyncLocalStorage scope (nodejs_compat is
// on in both wrangler configs; the same arrangement as lib/requestMetrics.ts and lib/auth.ts), and
// deferRequestWork() finds it from anywhere inside that request's promise chain.
//
// Outside a request (a test, a cron step, a queue consumer) there is no scope, and the work is awaited instead, so a
// caller never loses it and a test sees its effects without a fake ExecutionContext.

import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestWaitUntil = (work: Promise<unknown>) => void

const scope = new AsyncLocalStorage<RequestWaitUntil>()

/** Runs `next` with the request's `waitUntil` in scope for everything it awaits. */
export function runWithRequestDefer<T>(waitUntil: RequestWaitUntil, next: () => T): T {
  return scope.run(waitUntil, next)
}

/** True inside a request that registered its `waitUntil` (exported for the tests). */
export function hasRequestDefer(): boolean {
  return scope.getStore() !== undefined
}

/**
 * Hands `work` to the request's `waitUntil` and returns at once; with no scope, awaits it. NEVER rejects: the work is
 * a side channel, and a failure in it must not become a failure of the request that triggered it. The failure is
 * logged by name and message only.
 */
export async function deferRequestWork(work: () => Promise<unknown>): Promise<void> {
  const settled = (async () => {
    try { await work() } catch (error) {
      console.warn('[request-defer] deferred work failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error')
    }
  })()
  const waitUntil = scope.getStore()
  if (waitUntil) {
    try { waitUntil(settled); return } catch { /* a context that refuses waitUntil: wait for it here instead */ }
  }
  await settled
}
