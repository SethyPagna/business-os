// Runs a cheap "prepare ahead" task when the browser is idle, so the work a
// print needs is done before the cashier taps Print instead of after (I8,
// Sep 26 2026). A warm-up is only ever an optimisation: it never throws, and
// the returned cancel stops it if the component unmounts first.

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export const IDLE_WARMUP_TIMEOUT_MS = 2000
const IDLE_WARMUP_FALLBACK_DELAY_MS = 300

export function scheduleIdleWarmup(task: () => unknown, timeoutMs = IDLE_WARMUP_TIMEOUT_MS): () => void {
  if (typeof window === 'undefined') return () => {}
  const win = window as IdleWindow
  let done = false
  const run = () => {
    if (done) return
    done = true
    try {
      const result = task()
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => {})
    } catch { /* a warm-up failing only means the tap does the work itself */ }
  }
  if (typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(run, { timeout: timeoutMs })
    return () => {
      if (done) return
      done = true
      win.cancelIdleCallback?.(handle)
    }
  }
  // Safari (every iOS browser) has no requestIdleCallback.
  const timer = setTimeout(run, IDLE_WARMUP_FALLBACK_DELAY_MS)
  return () => {
    if (done) return
    done = true
    clearTimeout(timer)
  }
}
