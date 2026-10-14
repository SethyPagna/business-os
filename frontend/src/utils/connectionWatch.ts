type Listener = (event: Event) => void

export interface ConnectionWatchTarget {
  addEventListener(type: string, listener: Listener): void
  removeEventListener(type: string, listener: Listener): void
}

export interface ConnectionProbeResult {
  online: boolean
  cloudflareAccessRequired?: boolean
  runtimeMismatch?: boolean
}

export interface ConnectionWatch {
  recheck: () => Promise<boolean>
  dispose: () => void
}

const WRITE_BLOCKED_RECHECK_GAP_MS = 4_000
const BLOCKED_REPROBE_BACKOFF_MS = [5_000, 15_000, 30_000]

export interface ConnectionWatchOptions {
  pageVisible?: () => boolean
  schedule?: (run: () => void, delayMs: number) => () => void
}

const defaultPageVisible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

// One reader of "can this device reach the server": the browser's offline event, the page loading offline, a blocked write and
// every /health probe set the unreachable flag; a successful probe, an online event or the Check connection action clear it.
// navigator.onLine is only a hint (a VPN adapter or an iOS PWA can leave it false with a working server), so it never keeps
// the flag set once /health answers. A probe that found a runtime mismatch leaves the flag alone: the server is reachable,
// but this build must not write to it. While the flag blocks saving, a visible page re-probes on a short backoff (5 s, 15 s, then
// every 30 s), one probe at a time, and the first good answer clears it; an unblocked page never probes from here.
export function watchConnection(
  target: ConnectionWatchTarget,
  setUnreachable: (unreachable: boolean) => void,
  browserOnline: () => boolean,
  probe: () => Promise<ConnectionProbeResult>,
  now: () => number = Date.now,
  options: ConnectionWatchOptions = {},
): ConnectionWatch {
  const pageVisible = options.pageVisible ?? defaultPageVisible
  const schedule = options.schedule ?? defaultSchedule
  let inFlight: Promise<boolean> | null = null
  let lastBlockedRecheckAt = -Infinity
  let unreachable = false
  let disposed = false
  let cancelReprobe: (() => void) | null = null
  let reprobeStep = 0

  const stopReprobe = () => {
    cancelReprobe?.()
    cancelReprobe = null
    reprobeStep = 0
  }
  const armReprobe = () => {
    if (cancelReprobe || disposed || !unreachable) return
    const delay = BLOCKED_REPROBE_BACKOFF_MS[Math.min(reprobeStep, BLOCKED_REPROBE_BACKOFF_MS.length - 1)]
    cancelReprobe = schedule(() => {
      cancelReprobe = null
      if (disposed || !unreachable) return
      if (!pageVisible()) { armReprobe(); return }
      reprobeStep += 1
      void recheck().then(armReprobe)
    }, delay)
  }
  const publish = (value: boolean) => {
    unreachable = value
    setUnreachable(value)
    if (value) armReprobe()
    else stopReprobe()
  }

  const apply = (result: ConnectionProbeResult): boolean => {
    if (result.cloudflareAccessRequired || result.runtimeMismatch) return result.online
    publish(!result.online)
    return result.online
  }
  const recheck = (): Promise<boolean> => {
    if (inFlight) return inFlight
    inFlight = probe().then(apply, () => { publish(true); return false }).finally(() => { inFlight = null })
    return inFlight
  }

  const onOffline = () => publish(true)
  const onOnline = () => { void recheck() }
  const onProbe = (event: Event) => {
    const detail = (event as CustomEvent<ConnectionProbeResult | undefined>).detail
    if (detail && typeof detail.online === 'boolean') apply(detail)
  }
  const onWriteBlocked = () => {
    publish(true)
    const at = now()
    if (at - lastBlockedRecheckAt < WRITE_BLOCKED_RECHECK_GAP_MS) return
    lastBlockedRecheckAt = at
    void recheck()
  }

  target.addEventListener('offline', onOffline)
  target.addEventListener('online', onOnline)
  target.addEventListener('server:probe', onProbe)
  target.addEventListener('sync:write-blocked', onWriteBlocked)
  if (!browserOnline()) {
    publish(true)
    void recheck()
  }
  return {
    recheck,
    dispose: () => {
      disposed = true
      stopReprobe()
      target.removeEventListener('offline', onOffline)
      target.removeEventListener('online', onOnline)
      target.removeEventListener('server:probe', onProbe)
      target.removeEventListener('sync:write-blocked', onWriteBlocked)
    },
  }
}
