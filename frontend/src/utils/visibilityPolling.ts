// Polling that never runs in a hidden tab (F2, idle cost).
//
// A till tab can sit open for a whole business day, often behind another tab
// or on a locked phone. Every interval that reads the server from such a tab
// costs Worker requests (and D1 reads) that nobody sees. The rule is: no poll
// runs while document.visibilityState is 'hidden'; when the tab is shown
// again it catches up with ONE immediate read -- if a tick came due while it
// was hidden -- and then resumes its cadence. A tab hidden for less than one
// interval just finishes the interval it was in, so flicking between tabs
// never costs more requests than leaving the tab open would have.
//
// Pausing clears the timer outright rather than skipping ticks, so a hidden
// tab does not even wake up to decide to do nothing.
//
// Not for keep-alives: the sync socket's 25 s ping (api/websocket.ts) is what
// keeps realtime updates arriving, and the hub answers it without waking
// (Durable Object auto-response). Not for local clocks either -- a 1 s
// "elapsed" counter costs no request.

export interface VisibilityHost {
  isHidden: () => boolean
  // Subscribe to visibility changes; returns the unsubscribe function.
  onVisibilityChange: (listener: () => void) => () => void
  setInterval: (callback: () => void, ms: number) => number
  clearInterval: (id: number) => void
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  now?: () => number
}

export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function browserHost(): VisibilityHost | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  return {
    isHidden: isDocumentHidden,
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  }
}

export interface VisibleIntervalOptions {
  // Run `tick` once as soon as a hidden tab is shown again, when at least one
  // tick came due while it was hidden (default true). Turn off only where
  // another owner already refreshes on resume.
  refreshOnVisible?: boolean
  host?: VisibilityHost | null
}

// setInterval that is paused while the tab is hidden. Returns stop().
// The first tick is one interval after the start: callers read once
// themselves when they mount, exactly as with setInterval.
export function startVisibleInterval(
  tick: () => void,
  intervalMs: number,
  options: VisibleIntervalOptions = {},
): () => void {
  const host = options.host === undefined ? browserHost() : options.host
  if (!host) return () => {}
  const now = host.now || Date.now
  const refreshOnVisible = options.refreshOnVisible !== false
  let intervalId: number | null = null
  let timeoutId: number | null = null
  let stopped = false
  let lastTickAt = now()

  const runTick = () => {
    lastTickAt = now()
    tick()
  }
  const startInterval = () => {
    intervalId = host.setInterval(() => {
      // Belt and braces: a tick queued just before 'hidden' was announced.
      if (!host.isHidden()) runTick()
    }, intervalMs)
  }
  const running = () => intervalId != null || timeoutId != null
  // Arms the cadence with the next tick `firstDelayMs` from now.
  const arm = (firstDelayMs: number) => {
    if (stopped || running()) return
    if (firstDelayMs >= intervalMs) {
      startInterval()
      return
    }
    timeoutId = host.setTimeout(() => {
      timeoutId = null
      if (stopped || host.isHidden()) return
      runTick()
      startInterval()
    }, Math.max(0, firstDelayMs))
  }
  const pause = () => {
    if (intervalId != null) host.clearInterval(intervalId)
    if (timeoutId != null) host.clearTimeout(timeoutId)
    intervalId = null
    timeoutId = null
  }
  const unsubscribe = host.onVisibilityChange(() => {
    if (stopped) return
    if (host.isHidden()) {
      pause()
      return
    }
    // A repeated 'visible' while already running is not a resume.
    if (running()) return
    const elapsed = now() - lastTickAt
    if (elapsed < intervalMs) {
      arm(intervalMs - elapsed)
      return
    }
    if (refreshOnVisible) runTick()
    else lastTickAt = now()
    arm(intervalMs)
  })

  if (!host.isHidden()) arm(intervalMs)

  return () => {
    if (stopped) return
    stopped = true
    pause()
    unsubscribe()
  }
}

// Runs `callback` now if the tab is visible, otherwise once when it is next
// shown. Returns cancel().
export function runWhenVisible(callback: () => void, host: VisibilityHost | null = browserHost()): () => void {
  if (!host || !host.isHidden()) {
    callback()
    return () => {}
  }
  let done = false
  const unsubscribe = host.onVisibilityChange(() => {
    if (done || host.isHidden()) return
    done = true
    unsubscribe()
    callback()
  })
  return () => {
    if (done) return
    done = true
    unsubscribe()
  }
}

// setTimeout for self-rescheduling poll chains: waits `delayMs`, then waits
// for the tab to be visible before calling. Returns cancel().
export function visibleTimeout(callback: () => void, delayMs: number, host: VisibilityHost | null = browserHost()): () => void {
  if (!host) return () => {}
  let cancelWait: (() => void) | null = null
  let timerId: number | null = host.setTimeout(() => {
    timerId = null
    cancelWait = runWhenVisible(callback, host)
  }, delayMs)
  return () => {
    if (timerId != null) host.clearTimeout(timerId)
    timerId = null
    cancelWait?.()
    cancelWait = null
  }
}
