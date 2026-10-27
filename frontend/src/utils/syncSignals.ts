import { isRemoteSyncUpdate } from '../api/syncRuntime.ts'

// The one place the screens (Dashboard, Sales, the bell) learn that data may
// have changed. AppContext keeps a single `syncChannel` slot, so a burst of
// events (a tab resume dispatches 22 channels, a reconnect 17) leaves only the
// LAST channel visible to a page, and a page that gates on "sales" never sees
// it. These signals are the raw window events instead, so no channel is lost.
//
// Lane perf-transport will publish a coalesced subscribe API; switching to it
// is the body of subscribeSyncSignals and nothing else.
export type SyncSignal =
  | { type: 'update'; channel: string; reason: string | null; remote: boolean }
  | { type: 'reconnected' }

export function subscribeSyncSignals(listener: (signal: SyncSignal) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onUpdate = (event: Event) => {
    const detail = ((event as CustomEvent).detail || {}) as { channel?: unknown; reason?: unknown }
    // A cache-refresh is the echo of a read that already stored fresh data.
    if (detail.reason === 'cache-refresh') return
    const channel = String(detail.channel || '')
    if (!channel) return
    listener({ type: 'update', channel, reason: detail.reason ? String(detail.reason) : null, remote: isRemoteSyncUpdate(detail) })
  }
  const onReconnected = () => listener({ type: 'reconnected' })
  window.addEventListener('sync:update', onUpdate)
  window.addEventListener('sync:reconnected', onReconnected)
  return () => {
    window.removeEventListener('sync:update', onUpdate)
    window.removeEventListener('sync:reconnected', onReconnected)
  }
}
