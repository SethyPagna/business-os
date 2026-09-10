import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

function encodeId(id: number | string): string {
  return encodeURIComponent(String(id))
}

export type ReturnDetailReadOptions = {
  /** Bypass the shared 20-second read cache for an explicit restore/refresh. */
  fresh?: boolean
  signal?: AbortSignal
}

export type ReturnDetailRestoreOutcome = 'opened' | 'denied' | 'failed' | 'stale'
export type ReturnDetailRestoreInvalidation = 'superseded' | 'invalidated'

export type ReturnDetailRestoreAttempt<T> = {
  readFresh: (signal: AbortSignal) => Promise<T | null>
  isAllowed: () => boolean
  commit: (fresh: T) => void
  onDenied: () => void
  onFailure: () => void
  /** Put a dispatched chip back when a later operator intent supersedes it. */
  onInvalidate?: (reason: ReturnDetailRestoreInvalidation) => void
}

export type LatestReturnDetailRestoreRunner = {
  invalidate: () => void
  restore: <T>(attempt: ReturnDetailRestoreAttempt<T>) => Promise<ReturnDetailRestoreOutcome>
}

/**
 * Coordinates return-detail restores independently of React so the actual race
 * rules are executable in a focused test. Every new intent cancels and
 * invalidates the preceding one. Authority is checked once before I/O and
 * again at the final commit boundary, immediately before the host opens and
 * consumes the restore.
 */
export function createLatestReturnDetailRestoreRunner(): LatestReturnDetailRestoreRunner {
  let intent = 0
  let active: {
    intent: number
    controller: AbortController
    onInvalidate?: (reason: ReturnDetailRestoreInvalidation) => void
  } | null = null

  const invalidateActive = (reason: ReturnDetailRestoreInvalidation): void => {
    intent += 1
    const previous = active
    active = null
    if (!previous) return
    previous.controller.abort()
    previous.onInvalidate?.(reason)
  }
  const invalidate = (): void => invalidateActive('invalidated')

  const restore = async <T>(attempt: ReturnDetailRestoreAttempt<T>): Promise<ReturnDetailRestoreOutcome> => {
    invalidateActive('superseded')
    const currentIntent = intent
    const controller = new AbortController()
    active = { intent: currentIntent, controller, onInvalidate: attempt.onInvalidate }
    const isCurrent = (): boolean => (
      intent === currentIntent
      && active?.intent === currentIntent
      && !controller.signal.aborted
    )
    const finishCurrent = (): void => {
      if (active?.intent === currentIntent) active = null
    }

    if (!attempt.isAllowed()) {
      finishCurrent()
      attempt.onDenied()
      return 'denied'
    }

    try {
      const fresh = await attempt.readFresh(controller.signal)
      if (!isCurrent()) return 'stale'
      if (!attempt.isAllowed()) {
        finishCurrent()
        attempt.onDenied()
        return 'denied'
      }
      if (fresh == null) throw new Error('return missing')
      finishCurrent()
      attempt.commit(fresh)
      return 'opened'
    } catch {
      if (!isCurrent()) return 'stale'
      finishCurrent()
      attempt.onFailure()
      return 'failed'
    }
  }

  return { invalidate, restore }
}

export function getReturns(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  const cacheKey = query ? `returns:get:${query}` : 'returns:get'
  return route(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/returns', query)),
    () => null,
  )
}

export function getReturn(id: number | string, options: ReturnDetailReadOptions = {}): Promise<unknown> {
  // Per-id cache/dedupe key: a constant 'returns:getOne' made every return
  // share one 20s cache slot, so opening return B within the window rendered
  // return A. Write-invalidation is by 'returns' prefix, so per-id keys still
  // clear. (See feesTransport.getFee for the full reasoning.)
  const path = `/api/returns/${encodeId(id)}`
  if (options.fresh) {
    return apiFetch('GET', path, undefined, undefined, { signal: options.signal })
  }
  return route(
    `returns:getOne:${encodeId(id)}`,
    (signal) => apiFetch('GET', path, undefined, undefined, { signal }),
    () => null,
    { signal: options.signal },
  )
}

export function getReturnReasonPresets(): Promise<unknown> {
  return route(
    'returns:reason-presets',
    () => apiFetch('GET', '/api/returns/reason-presets'),
    () => ({ configured: false, presets: { customer: [], supplier: [] } }),
    { raceLocalFallback: false },
  )
}

// Reports hub: customer-return (refund) totals over a range. Mirrors the
// sales daily-report transport shape (startDate/endDate/branchId).
export function getReturnsReport(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `returns:report:${query}`,
    () => apiFetch('GET', appendQuery('/api/returns/report', query)),
    () => null,
  )
}

// Receipt typeahead for the New Return flow. The old flow pulled 500 sales to
// the browser and Array.find()'d them, so a receipt outside that page simply
// did not exist and nothing was shown while the operator typed. This asks the
// server, which matches the bare YYYYMMDD-HHMMSS number, a partial run of
// digits across its separators, the sale id, and the legacy NNNNNN@YYYY-MM-DD
// number -- capped server-side at 20 rows.
//
// Deliberately NOT routed through the shared 20s response cache: a receipt
// minted seconds ago has to be findable, and every keystroke is its own query
// anyway, so there is nothing to reuse.
export function lookupReturnReceipts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: true })
  return apiFetch('GET', appendQuery('/api/returns/receipt-lookup', query))
}
