import { getNotificationSummary } from '../api/notificationSummary.ts'
import { withLoaderTimeout } from './loaders.ts'
import { runWhenVisible, startVisibleInterval, type VisibilityHost } from './visibilityPolling.ts'
import { subscribeSyncSignals } from './syncSignals.ts'

// ONE shared read of GET /api/notifications/summary for the whole app (it costs about
// 56k D1 rows). The bell used to read it per component, on every sale push of every tab.
// Now:
//   - at most one read per POLL_INTERVAL_MS while the page is visible, none while hidden
//     (the first tick back after a long absence is one catch-up read);
//   - a read when the panel opens, unless one finished a few seconds ago;
//   - a push on the 'notifications' channel (device approvals) reads at once;
//   - other tabs of the same browser share the result instead of reading it again.
// Sale/stock pushes do not read it: the counts may lag by up to one interval.
export const NOTIFICATION_POLL_INTERVAL_MS = 60_000
// A read this young is reused by an open or a push.
export const NOTIFICATION_OPEN_MAX_AGE_MS = 10_000
const NOTIFICATION_SUMMARY_TIMEOUT_MS = 8000

export type NotificationSummaryState = {
  data: unknown | null
  at: number
  loading: boolean
}

type SharedResult = { type: 'summary'; at: number; data: unknown }
type ShareChannel = {
  post: (message: SharedResult) => void
  onMessage: (listener: (message: SharedResult) => void) => () => void
}

export type NotificationSummaryStoreDeps = {
  fetchSummary: () => Promise<unknown>
  now?: () => number
  visibilityHost?: VisibilityHost | null
  share?: ShareChannel | null
  /** Subscribes to pushes; defaults to the window sync signals. */
  onNotificationsPush?: (listener: () => void) => () => void
}

export function createNotificationSummaryStore(deps: NotificationSummaryStoreDeps) {
  const now = deps.now || Date.now
  const listeners = new Set<(state: NotificationSummaryState) => void>()
  let state: NotificationSummaryState = { data: null, at: 0, loading: false }
  let inFlight: Promise<void> | null = null
  let stopPolling: (() => void) | null = null
  let cancelFirstRead: (() => void) | null = null
  let stopPush: (() => void) | null = null
  let stopShare: (() => void) | null = null

  const publish = (next: Partial<NotificationSummaryState>) => {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener(state)
  }

  function refresh({ force = false, maxAgeMs = 0 }: { force?: boolean; maxAgeMs?: number } = {}): Promise<void> {
    if (inFlight) return inFlight
    if (!force && state.data && now() - state.at < maxAgeMs) return Promise.resolve()
    publish({ loading: true })
    const request = (async () => {
      try {
        const data = await deps.fetchSummary()
        const at = now()
        publish({ data, at, loading: false })
        deps.share?.post({ type: 'summary', at, data })
      } catch {
        // Best effort: the badge keeps its last count and the next tick tries again.
        publish({ loading: false })
      } finally {
        inFlight = null
      }
    })()
    inFlight = request
    return request
  }

  function start() {
    // A result another tab just read is as good as our own.
    stopShare = deps.share?.onMessage((message) => {
      if (message.at > state.at) publish({ data: message.data, at: message.at })
    }) || null
    stopPush = deps.onNotificationsPush?.(() => { void refresh({ maxAgeMs: 5_000 }) }) || null
    const catchUpAge = NOTIFICATION_POLL_INTERVAL_MS - 5_000
    stopPolling = startVisibleInterval(() => { void refresh({ maxAgeMs: catchUpAge }) }, NOTIFICATION_POLL_INTERVAL_MS, { host: deps.visibilityHost })
    cancelFirstRead = runWhenVisible(() => { void refresh({ maxAgeMs: catchUpAge }) }, deps.visibilityHost)
  }

  function stop() {
    stopPolling?.()
    cancelFirstRead?.()
    stopPush?.()
    stopShare?.()
    stopPolling = cancelFirstRead = stopPush = stopShare = null
  }

  return {
    getState: () => state,
    refresh,
    /** Listener runs now with the current state, then on every change. Returns the unsubscribe. */
    subscribe(listener: (next: NotificationSummaryState) => void): () => void {
      listeners.add(listener)
      if (listeners.size === 1) start()
      listener(state)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }
}

// Opened on the first subscriber and closed with the last, so importing this module holds nothing open.
function browserShare(): ShareChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  let channel: BroadcastChannel | null = null
  return {
    post: (message) => { try { channel?.postMessage(message) } catch { /* a closed channel only costs the sharing */ } },
    onMessage: (listener) => {
      const open = new BroadcastChannel('bos-notification-summary')
      channel = open
      const handler = (event: MessageEvent) => {
        const message = event.data as SharedResult | null
        if (message?.type === 'summary') listener(message)
      }
      open.addEventListener('message', handler)
      return () => {
        open.removeEventListener('message', handler)
        open.close()
        if (channel === open) channel = null
      }
    },
  }
}

export const notificationSummaryStore = createNotificationSummaryStore({
  fetchSummary: () => withLoaderTimeout(() => getNotificationSummary(), 'Notifications', NOTIFICATION_SUMMARY_TIMEOUT_MS),
  share: browserShare(),
  onNotificationsPush: (listener) => subscribeSyncSignals((signal) => {
    if (signal.type === 'update' && signal.channel === 'notifications') listener()
  }),
})
