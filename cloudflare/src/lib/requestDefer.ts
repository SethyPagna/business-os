// The request's own waitUntil for lib code with no Hono context. index.ts opens the scope around every /api request;
// outside one (a test, a cron step) the work is awaited instead, so it is never lost.

import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestWaitUntil = (work: Promise<unknown>) => void

const scope = new AsyncLocalStorage<RequestWaitUntil>()

export function runWithRequestDefer<T>(waitUntil: RequestWaitUntil, next: () => T): T {
  return scope.run(waitUntil, next)
}

export function hasRequestDefer(): boolean {
  return scope.getStore() !== undefined
}

/** Defers `work` past the response, or awaits it with no scope. Never rejects: a side channel must not fail its request. */
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
