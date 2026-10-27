import { isNetErr, isInvalidSessionError } from '../../api/http.ts'
import { planThrottledSyncReload } from '../../api/syncRuntime.ts'
import type { SyncSignal } from '../../utils/syncSignals.ts'

// When and how the Dashboard re-reads GET /api/dashboard/startup. One read costs
// about 140k D1 rows, so the rules below are about reading it exactly once per
// reason and never reading it for a reason the page cannot show.

// Channels whose change alters a Dashboard figure.
export const DASHBOARD_REFRESH_CHANNELS: ReadonlySet<string> = new Set([
  'sales', 'products', 'returns', 'inventory', 'dashboard', 'settings',
])
// A burst of events (a tab resume sends 22 channels) is one trailing refresh.
export const DASHBOARD_SYNC_DEBOUNCE_MS = 300
// At most one sync-driven read per this long, however busy the tills are.
export const DASHBOARD_SYNC_MIN_INTERVAL_MS = 5000
// A transient failure is retried after these waits, then handed to the person.
export const DASHBOARD_RETRY_DELAYS_MS: readonly number[] = [2000, 6000]

export function nextRetryDelayMs(failuresSoFar: number): number | null {
  return DASHBOARD_RETRY_DELAYS_MS[failuresSoFar] ?? null
}

// Right after sign-in the app resets its read scope, which rejects a read already in flight with
// this code. Nothing is wrong: the same read, sent again, succeeds.
export function isStaleReadScopeError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'stale_read_scope'
}

// Worth trying again by itself: the request never got a verdict (timeout, no
// network, gateway/5xx) or the server asked to come back (409 snapshot_changed
// while tills are ringing, 429). 413/422 and the rest would fail the same way.
export function isTransientLoadError(error: unknown): boolean {
  if (!error || isInvalidSessionError(error)) return false
  const { code, status, transientGateway } = error as { code?: unknown; status?: unknown; transientGateway?: unknown }
  if (code === 'loader_timeout' || transientGateway === true) return true
  const httpStatus = Number(status) || 0
  if (httpStatus) return httpStatus === 409 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500
  return isNetErr(error)
}

type RefreshTimerHost = {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (timer: unknown) => void
  now: () => number
}

const browserTimers: RefreshTimerHost = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export type DashboardRefreshScheduler = {
  signal: (signal: SyncSignal) => void
  /** Tell the scheduler a read started for any reason, so sync reads count from it. */
  noteLoad: () => void
  dispose: () => void
}

export function createDashboardRefreshScheduler(
  run: () => void,
  host: RefreshTimerHost = browserTimers,
): DashboardRefreshScheduler {
  let debounceTimer: unknown = null
  let waitTimer: unknown = null
  let lastLoadAt = -Infinity
  const start = () => {
    lastLoadAt = host.now()
    run()
  }
  const fire = () => {
    debounceTimer = null
    const plan = planThrottledSyncReload('dashboard', host.now() - lastLoadAt, DASHBOARD_SYNC_MIN_INTERVAL_MS, new Set())
    if (plan.runNow) { start(); return }
    waitTimer = host.setTimeout(() => { waitTimer = null; start() }, plan.delayMs)
  }
  const request = () => {
    // A read already waiting out the interval covers this event as well.
    if (waitTimer != null) return
    if (debounceTimer != null) host.clearTimeout(debounceTimer)
    debounceTimer = host.setTimeout(fire, DASHBOARD_SYNC_DEBOUNCE_MS)
  }
  return {
    signal(signal) {
      if (signal.type === 'update') {
        if (DASHBOARD_REFRESH_CHANNELS.has(signal.channel)) request()
        return
      }
      // A reconnect right after a read adds nothing: that read began after the
      // socket dropped, so it already holds what the missed pushes announced.
      if (host.now() - lastLoadAt >= DASHBOARD_SYNC_MIN_INTERVAL_MS) request()
    },
    noteLoad() { lastLoadAt = host.now() },
    dispose() {
      if (debounceTimer != null) host.clearTimeout(debounceTimer)
      if (waitTimer != null) host.clearTimeout(waitTimer)
      debounceTimer = null
      waitTimer = null
    },
  }
}
