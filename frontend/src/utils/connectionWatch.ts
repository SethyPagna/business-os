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

// One reader of "can this device reach the server": the browser's offline event, the page loading offline, a blocked write and
// every /health probe set the unreachable flag; a successful probe, an online event or the Check connection action clear it.
// navigator.onLine is only a hint (a VPN adapter or an iOS PWA can leave it false with a working server), so it never keeps
// the flag set once /health answers. A probe that found a runtime mismatch leaves the flag alone: the server is reachable,
// but this build must not write to it.
export function watchConnection(
  target: ConnectionWatchTarget,
  setUnreachable: (unreachable: boolean) => void,
  browserOnline: () => boolean,
  probe: () => Promise<ConnectionProbeResult>,
  now: () => number = Date.now,
): ConnectionWatch {
  let inFlight: Promise<boolean> | null = null
  let lastBlockedRecheckAt = -Infinity

  const apply = (result: ConnectionProbeResult): boolean => {
    if (result.cloudflareAccessRequired || result.runtimeMismatch) return result.online
    setUnreachable(!result.online)
    return result.online
  }
  const recheck = (): Promise<boolean> => {
    if (inFlight) return inFlight
    inFlight = probe().then(apply, () => { setUnreachable(true); return false }).finally(() => { inFlight = null })
    return inFlight
  }

  const onOffline = () => setUnreachable(true)
  const onOnline = () => { void recheck() }
  const onProbe = (event: Event) => {
    const detail = (event as CustomEvent<ConnectionProbeResult | undefined>).detail
    if (detail && typeof detail.online === 'boolean') apply(detail)
  }
  const onWriteBlocked = () => {
    setUnreachable(true)
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
    setUnreachable(true)
    void recheck()
  }
  return {
    recheck,
    dispose: () => {
      target.removeEventListener('offline', onOffline)
      target.removeEventListener('online', onOnline)
      target.removeEventListener('server:probe', onProbe)
      target.removeEventListener('sync:write-blocked', onWriteBlocked)
    },
  }
}
