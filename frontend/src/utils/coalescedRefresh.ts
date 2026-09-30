// Collapses a burst of "something changed" signals into one refresh, and drops
// the signal entirely while the tab is hidden.
//
// One sale broadcasts on several sync channels within a moment; a component
// that re-reads the server on each of them pays for the same read many times,
// and a tab nobody is looking at pays for reads nobody sees. The refresh runs
// `quietMs` after the LAST signal (so it always follows the final write of a
// burst), but never later than `maxWaitMs` after the first, so a steady stream
// cannot postpone it forever. A hidden tab simply forgets the signal: whoever
// owns the component already reloads when the tab is shown again.

export interface CoalescedRefreshHost {
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  now: () => number
  isHidden: () => boolean
}

export interface CoalescedRefreshOptions {
  quietMs: number
  maxWaitMs: number
  host?: CoalescedRefreshHost
}

export interface CoalescedRefresh {
  request: () => void
  cancel: () => void
}

function browserHost(): CoalescedRefreshHost {
  return {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    now: () => Date.now(),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }
}

export function createCoalescedRefresh(run: () => void, options: CoalescedRefreshOptions): CoalescedRefresh {
  const host = options.host || browserHost()
  let timer: number | null = null
  let firstAt = 0

  const clear = () => {
    if (timer != null) host.clearTimeout(timer)
    timer = null
  }
  return {
    request() {
      if (host.isHidden()) {
        clear()
        return
      }
      const now = host.now()
      if (timer == null) firstAt = now
      clear()
      const wait = Math.max(0, Math.min(options.quietMs, firstAt + options.maxWaitMs - now))
      timer = host.setTimeout(() => {
        timer = null
        if (!host.isHidden()) run()
      }, wait)
    },
    cancel: clear,
  }
}
