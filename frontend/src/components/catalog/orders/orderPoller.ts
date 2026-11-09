import { POLL_GRACE_AFTER_EXPIRY_MS, isFinishedState, nextPollDelayMs } from './orderLogic.ts'
import type { OrderApiResult, OrderStatusPoll } from './orderTypes.ts'

// Watches one order's light status endpoint while its QR is on screen.
//
// Rules, each pinned by tests/orderPoller.test.ts:
//  - one read in flight at a time, the next scheduled only after the last finished (never a tight loop, never two at once);
//  - a modest cadence (orderLogic.nextPollDelayMs) that doubles after a failed read, up to a cap;
//  - nothing runs while the tab is hidden (the timer is cleared, not skipped); coming back reads once, at once, if a read came due;
//  - it stops by itself when the order reaches a state that needs no watching, and shortly after the QR's own expiry;
//  - stop() is final: a read that lands after it reports nothing.
// The host is injected so a test drives the clock; the page passes the browser's.

export type PollHost = {
  now: () => number
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  isHidden: () => boolean
  onVisibilityChange: (listener: () => void) => () => void
}

export type OrderPollerOptions = {
  host: PollHost
  read: () => Promise<OrderApiResult<OrderStatusPoll>>
  /** Called with every successful read, in order. */
  onStatus: (status: OrderStatusPoll) => void
  /** Epoch ms after which watching ends (the QR's expiry plus a grace), or null to watch until the order is finished. */
  giveUpAt?: () => number | null
}

export type OrderPoller = { start: () => void; stop: () => void; readonly running: boolean }

export function createOrderPoller({ host, read, onStatus, giveUpAt }: OrderPollerOptions): OrderPoller {
  let timer: number | null = null
  let inFlight = false
  let stopped = true
  let startedAt = 0
  let failures = 0
  let dueWhileHidden = false
  let unsubscribe: (() => void) | null = null

  const clearTimer = () => {
    if (timer !== null) { host.clearTimeout(timer); timer = null }
  }

  const schedule = () => {
    clearTimer()
    if (stopped) return
    if (host.isHidden()) { dueWhileHidden = true; return }
    timer = host.setTimeout(tick, nextPollDelayMs(host.now() - startedAt, failures))
  }

  const tick = async () => {
    timer = null
    if (stopped || inFlight) return
    if (host.isHidden()) { dueWhileHidden = true; return }
    const limit = giveUpAt?.() ?? null
    if (limit !== null && host.now() > limit) { stop(); return }
    inFlight = true
    let result: OrderApiResult<OrderStatusPoll>
    try {
      result = await read()
    } catch {
      result = { ok: false, code: 'network', status: 0, retryable: true, extra: {}, token: null, orderNo: null }
    } finally {
      inFlight = false
    }
    if (stopped) return
    if (result.ok) {
      failures = 0
      onStatus(result.data)
      if (isFinishedState(result.data.state)) { stop(); return }
    } else if (result.status === 404) {
      // The order is gone or the link is wrong: asking again cannot help.
      stop()
      return
    } else {
      failures += 1
    }
    schedule()
  }

  const onVisibility = () => {
    if (stopped || host.isHidden()) { clearTimer(); return }
    if (dueWhileHidden || timer === null) {
      dueWhileHidden = false
      clearTimer()
      void tick()
    }
  }

  function stop() {
    stopped = true
    clearTimer()
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      failures = 0
      dueWhileHidden = false
      startedAt = host.now()
      unsubscribe = host.onVisibilityChange(onVisibility)
      schedule()
    },
    stop,
    get running() { return !stopped },
  }
}

/** The moment to stop watching an order whose QR expires at `expiresAtMs`: shortly after, so a payment made in the last seconds is still seen. */
export const giveUpTimeFor = (expiresAtMs: number | null): number | null => (expiresAtMs === null ? null : expiresAtMs + POLL_GRACE_AFTER_EXPIRY_MS)

export function browserPollHost(): PollHost {
  return {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}
