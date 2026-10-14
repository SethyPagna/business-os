type Listener = (event: Event) => void

export interface ConnectionWatchTarget {
  addEventListener(type: string, listener: Listener): void
  removeEventListener(type: string, listener: Listener): void
}

export function watchConnection(target: ConnectionWatchTarget, setUnreachable: (unreachable: boolean) => void, browserOnline: () => boolean): () => void {
  const onOffline = () => setUnreachable(true)
  const onProbe = (event: Event) => {
    if ((event as CustomEvent<{ online?: boolean }>).detail?.online === false) setUnreachable(true)
  }
  target.addEventListener('offline', onOffline)
  target.addEventListener('server:probe', onProbe)
  if (!browserOnline()) setUnreachable(true)
  return () => {
    target.removeEventListener('offline', onOffline)
    target.removeEventListener('server:probe', onProbe)
  }
}
