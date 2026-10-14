export interface TimeoutSignal {
  signal: AbortSignal | undefined
  clear: () => void
}

// AbortSignal.timeout needs Safari 16; the app still runs on 15.4, where calling it throws. Fall back to a controller and a timer.
export function timeoutSignal(ms: number): TimeoutSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), clear: () => {} }
  }
  if (typeof AbortController === 'undefined') return { signal: undefined, clear: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}
