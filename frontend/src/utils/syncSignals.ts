import * as syncRuntime from '../api/syncRuntime.ts'

// The one place the screens (Dashboard, Sales, the bell) learn that data may
// have changed. AppContext keeps a single `syncChannel` slot, so a burst of
// events (a tab resume dispatches 22 channels, a reconnect 17) leaves only the
// LAST channel visible to a page, and a page that gates on "sales" never sees
// it. These signals carry every channel instead, so none is lost.
//
// Preferred source: perf-transport's coalesced `subscribeSyncFlush` (one flush per burst, only
// for the channels asked for, bulk flushes staggered between pages). When that API is not in this
// build the raw window events are used, filtered to the same channels; the callers cannot tell.
export type SyncSignal =
  | { type: 'update'; channel: string; reason: string | null; remote: boolean }
  | { type: 'reconnected' }

type FlushDetail = { channels: string[]; remote: boolean; reason: string | null }
type FlushSubscribe = (channels: readonly string[], handler: (detail: FlushDetail) => void) => () => void

type SyncRuntimeSurface = { subscribeSyncFlush?: unknown; isRemoteSyncUpdate: (detail: unknown) => boolean }

export function createSyncSignalsSubscriber(runtime: SyncRuntimeSurface) {
  return function subscribe(channels: Iterable<string>, listener: (signal: SyncSignal) => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const wanted = new Set([...channels].map((channel) => String(channel).split(':')[0]))
    const onReconnected = () => listener({ type: 'reconnected' })
    window.addEventListener('sync:reconnected', onReconnected)
    let stopUpdates: () => void
    const flushSubscribe = typeof runtime.subscribeSyncFlush === 'function' ? runtime.subscribeSyncFlush as FlushSubscribe : null
    if (flushSubscribe) {
      stopUpdates = flushSubscribe([...wanted], (flush) => {
        for (const channel of flush.channels) listener({ type: 'update', channel, reason: flush.reason ? String(flush.reason) : null, remote: flush.remote })
      })
    } else {
      const onUpdate = (event: Event) => {
        const detail = ((event as CustomEvent).detail || {}) as { channel?: unknown; reason?: unknown }
        // A cache-refresh is the echo of a read that already stored fresh data.
        if (detail.reason === 'cache-refresh') return
        const channel = String(detail.channel || '').split(':')[0]
        if (!channel || !wanted.has(channel)) return
        listener({ type: 'update', channel, reason: detail.reason ? String(detail.reason) : null, remote: runtime.isRemoteSyncUpdate(detail) })
      }
      window.addEventListener('sync:update', onUpdate)
      stopUpdates = () => window.removeEventListener('sync:update', onUpdate)
    }
    return () => {
      stopUpdates()
      window.removeEventListener('sync:reconnected', onReconnected)
    }
  }
}

// perf-transport's `subscribeSyncFlush` is used when this build has it; `in` keeps the missing export from failing the build.
export const subscribeSyncSignals = createSyncSignalsSubscriber({
  subscribeSyncFlush: 'subscribeSyncFlush' in syncRuntime ? (syncRuntime as unknown as Record<string, unknown>).subscribeSyncFlush : undefined,
  isRemoteSyncUpdate: syncRuntime.isRemoteSyncUpdate as (detail: unknown) => boolean,
})

// perf-transport ships the coalesced API and the route() re-issue of a stale_read_scope read in one
// release (6.0.1002), so the one is the tell for the other. When route() already re-sends such a read
// once, a screen must not send it a second time on top: its own silent retry is only for a build without.
export const transportReissuesStaleReadScope = typeof (syncRuntime as unknown as Record<string, unknown>).subscribeSyncFlush === 'function'

// A page that only needs "something I show changed": every update of one burst becomes ONE call
// (the channels that named it), however many channels the burst held. Used where there is no
// scheduler of its own (Sales).
export const SYNC_BURST_SETTLE_MS = 50

export function subscribeSyncBurst(channels: Iterable<string>, onBurst: (burst: { channels: string[]; reason: string | null }) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const held = new Set<string>()
  let reasons = new Set<string | null>()
  const stop = subscribeSyncSignals(channels, (signal) => {
    if (signal.type !== 'update') return
    held.add(signal.channel)
    reasons.add(signal.reason)
    if (timer != null) return
    timer = setTimeout(() => {
      timer = null
      const burst = { channels: [...held], reason: reasons.size === 1 ? [...reasons][0] : null }
      held.clear()
      reasons = new Set()
      onBurst(burst)
    }, SYNC_BURST_SETTLE_MS)
  })
  return () => {
    stop()
    if (timer != null) clearTimeout(timer)
    timer = null
    held.clear()
  }
}
