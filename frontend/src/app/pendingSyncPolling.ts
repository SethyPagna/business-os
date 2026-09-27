// Polling for the offline-sale queue banner (App.tsx useSyncErrorBanner).
//
// Offline mode was cancelled on 26 Sep 2026: a sale is never queued any more,
// so the queue can only hold sales retained from before, waiting for the one
// reviewed recovery. Each read costs an /api/sync/owner request plus an
// IndexedDB scan. Until F2 the banner re-read it every 20 s for the whole
// session, hidden or not, although once a read with a confirmed owner reports
// nothing pending there is nothing left for a poll to discover: every way the
// queue can change (recovery, discard, a service-worker outbox message)
// already announces itself with an event the banner listens to, and each of
// those reads again and can restart the poll.

import { startVisibleInterval, type VisibilityHost } from '../utils/visibilityPolling.ts'

export interface PendingSyncSnapshot {
  owner?: unknown
  total?: number
}

// Keep polling while there is something to watch drain, or while the read
// could not confirm who owns the queue (offline, session lookup failed) --
// its zero then means "unknown", not "empty".
export function pendingSyncNeedsPolling(state: PendingSyncSnapshot | null | undefined): boolean {
  if (!state || !state.owner) return true
  return Number(state.total || 0) > 0
}

export interface PendingSyncPoll {
  // Feed every completed read here; it starts or stops the interval.
  observe(state: PendingSyncSnapshot | null | undefined): void
  cancel(): void
  isPolling(): boolean
}

export function createPendingSyncPoll(
  refresh: () => void,
  intervalMs: number,
  host?: VisibilityHost | null,
): PendingSyncPoll {
  let stopInterval: (() => void) | null = null
  let cancelled = false

  const stop = () => {
    if (!stopInterval) return
    stopInterval()
    stopInterval = null
  }
  const start = () => {
    if (cancelled || stopInterval) return
    // Paused while the tab is hidden; one read when it is shown again.
    stopInterval = startVisibleInterval(refresh, intervalMs, { host })
  }

  return {
    observe(state) {
      if (pendingSyncNeedsPolling(state)) start()
      else stop()
    },
    cancel() {
      cancelled = true
      stop()
    },
    isPolling: () => stopInterval != null,
  }
}
