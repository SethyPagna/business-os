// Polling that never runs in a hidden tab (F2, idle cost).
//
// A till tab can sit open for a whole business day, often behind another tab
// or on a locked phone. Every interval that reads the server from such a tab
// costs Worker requests (and D1 reads) that nobody sees. The rule is: no poll
// runs while document.visibilityState is 'hidden'; when the tab is shown
// again it catches up with ONE immediate read and then resumes its cadence.
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
  // Run `tick` once as soon as a hidden tab is shown again (default true).
  // Turn off only where another owner already refreshes on resume.
  refreshOnVisible?: boolean
  host?: VisibilityHost | null
}

// setInterval that is paused while the tab is hidden. Returns stop().
export function startVisibleInterval(
  tick: () => void,
  intervalMs: number,
  options: VisibleIntervalOptions = {},
): () => void {
  const host = options.host === undefined ? browserHost() : options.host
  if (!host) return () => {}
  const refreshOnVisible = options.refreshOnVisible !== false
  let intervalId: number | null = null
  let stopped = false

  const start = () => {
    if (stopped || intervalId != null) return
    intervalId = host.setInterval(() => {
      // Belt and braces: a tick queued just before 'hidden' was announced.
      if (!host.isHidden()) tick()
    }, intervalMs)
  }
  const pause = () => {
    if (intervalId == null) return
    host.clearInterval(intervalId)
    intervalId = null
  }
  const unsubscribe = host.onVisibilityChange(() => {
    if (stopped) return
    if (host.isHidden()) {
      pause()
      return
    }
    // A repeated 'visible' while already running is not a resume.
    if (intervalId != null) return
    if (refreshOnVisible) tick()
    start()
  })

  if (!host.isHidden()) start()

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
