// How long a camera may run without a read. A scanner left open on a counter
// would otherwise decode at full speed until the battery or the page gives out:
// full speed for the first 15 s, then twice a second, and at 60 s the camera is
// released into the existing "Camera paused" state (a tap on Start camera
// resumes it, and starts the clock again).

export const SCAN_FULL_SPEED_MS = 15_000
export const SCAN_PAUSE_AFTER_MS = 60_000
export const SCAN_SLOW_INTERVAL_MS = 500

export type ScanPace = 'full' | 'slow'

/** The timer functions the policy uses; a test passes a clock it controls. */
export interface IdleTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

// Looked up at call time so a replaced global timer is the one that is used.
const realTimers: IdleTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Minimum gap between two decoded frames: `fullSpeedMs` while the scan is
 * fresh, never less than 2 Hz once it has gone idle. */
export function scanIntervalMs(pace: ScanPace, fullSpeedMs: number): number {
  return pace === 'slow' ? Math.max(SCAN_SLOW_INTERVAL_MS, fullSpeedMs) : fullSpeedMs
}

export function createScanIdlePolicy(onPause: () => void, timers: IdleTimers = realTimers) {
  let pace: ScanPace = 'full'
  let handles: unknown[] = []
  const clear = (): void => {
    for (const handle of handles) timers.clearTimeout(handle)
    handles = []
  }
  return {
    pace: (): ScanPace => pace,
    /** Starts (or restarts) the clock from full speed. */
    start(): void {
      clear()
      pace = 'full'
      handles = [
        timers.setTimeout(() => { pace = 'slow' }, SCAN_FULL_SPEED_MS),
        timers.setTimeout(() => { clear(); onPause() }, SCAN_PAUSE_AFTER_MS),
      ]
    },
    stop(): void {
      clear()
      pace = 'full'
    },
  }
}
