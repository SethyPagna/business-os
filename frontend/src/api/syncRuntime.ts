import { STORAGE_KEYS, SYNC } from '../constants.ts'

// Pages to refresh after the legacy drain uploads a queued sale (saleWriteTransport.ts).
export const OFFLINE_SALE_SYNC_UPDATE_CHANNELS = ['sales', 'products', 'inventory', 'dashboard'] as const
export const FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS = [
  'settings',
  'products',
  'inventory',
  'sales',
  'returns',
  'customers',
  'suppliers',
  'deliveryContacts',
  'branches',
  'dashboard',
  'catalog',
  'files',
  'audit_log',
  'users',
  'categories',
  'units',
  'fees',
  'notifications',
  'portalSubmissions',
  'promotions',
  'roles',
  'pendingActions',
] as const

// A push from another device reaches the page as websocket.ts's { channel, payload }. Every local
// dispatch (this tab's own writes, resume, reconnect, cache refresh) carries no `payload` key.
// tests/requestLayerCoalescing.test.ts pins both sides of that contract.
export function isRemoteSyncUpdate(detail: unknown): boolean {
  return !!detail && typeof detail === 'object' && Object.hasOwn(detail, 'payload')
}

// Every sale pushes these channels to every device, often several per sale.
export const REMOTE_COALESCED_SYNC_CHANNELS: ReadonlySet<string> = new Set(['sales', 'inventory', 'returns'])

type SyncTimerHost = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (timer: number) => void
}

export type SyncChannelScheduler = {
  schedule: (channel: string, remote: boolean, source: string | null, publish: (source: string | null) => void) => void
  dispose: () => void
}

/**
 * Decides when a sync:update reaches the pages (one publish = one refresh per listening page).
 * Remote pushes on a busy channel wait REMOTE_EVENT_COALESCE_MS from the first push of a burst and
 * then publish once; later pushes in the burst join it instead of pushing it back, so a steady
 * stream still refreshes. Everything else, including this device's own writes, keeps the short
 * trailing debounce and replaces a slower remote wait already pending for the channel.
 * A publish stands for every change merged into it, so it carries a source only when all of them
 * share it; a mix publishes null. Pages skip their own echo by source (the POS skips 'pos-checkout'),
 * and a null source is never an echo, so a remote change merged with the till's own sale still reaches it.
 */
export function createSyncChannelScheduler(host: SyncTimerHost): SyncChannelScheduler {
  const pending = new Map<string, { timer: number; sources: Set<string | null> }>()
  const arm = (channel: string, sources: Set<string | null>, publish: (source: string | null) => void, delayMs: number) => {
    const timer = host.setTimeout(() => {
      pending.delete(channel)
      publish(sources.size === 1 ? [...sources][0] : null)
    }, delayMs)
    pending.set(channel, { timer, sources })
  }
  return {
    schedule(channel, remote, source, publish) {
      const current = pending.get(channel)
      const sources = current?.sources ?? new Set<string | null>()
      sources.add(source)
      if (remote && REMOTE_COALESCED_SYNC_CHANNELS.has(channel)) {
        // The publish already pending reads after this change as well.
        if (!current) arm(channel, sources, publish, SYNC.REMOTE_EVENT_COALESCE_MS)
        return
      }
      if (current) host.clearTimeout(current.timer)
      arm(channel, sources, publish, SYNC.EVENT_DEBOUNCE_MS)
    },
    dispose() {
      for (const { timer } of pending.values()) host.clearTimeout(timer)
      pending.clear()
    },
  }
}

/**
 * Whether a sync-driven reload may run now or must wait. A reload ran `msSinceLastLoad` ago;
 * channels in `immediateChannels` always run now. The returned delay lands on the end of the
 * interval, so repeated calls during one interval agree on a single trailing reload.
 */
export function planThrottledSyncReload(
  channel: string,
  msSinceLastLoad: number,
  minIntervalMs: number,
  immediateChannels: ReadonlySet<string>,
): { runNow: true } | { runNow: false; delayMs: number } {
  if (immediateChannels.has(channel) || msSinceLastLoad >= minIntervalMs) return { runNow: true }
  return { runNow: false, delayMs: minIntervalMs - msSinceLastLoad }
}

/** The owner's bound on the bell (11 Nov): never more than 5 minutes old. The Worker's entry lifetime is at most this on every plan (planTier.ts, test-plan-tier-pure). */
export const BELL_MAX_AGE_MS = 5 * 60 * 1000
/** Past the entry's expiry before the follow-up reads, so a client clock a few seconds ahead of the Worker still lands after the expiry. */
export const BELL_FOLLOW_UP_MARGIN_MS = 10_000
/** A follow-up that came back with the same entry (a client clock far ahead of the Worker) is tried once more, never sooner than this. */
export const BELL_FOLLOW_UP_RETRY_MIN_MS = 30_000
export const BELL_FOLLOW_UP_MAX_ATTEMPTS = 2

/**
 * After a bell reload: when must one more read happen so the badge is never older than BELL_MAX_AGE_MS (plus the margin)?
 *
 * A sync-triggered reload can be served the Worker's cached entry, computed BEFORE the write that triggered it, and the next timed
 * refresh is two hours away. That is the only way the badge ends up older than the bound: a reload whose answer was computed at or
 * after the last sync event reflects that event, and a later write sends its own event. So a follow-up is due only when the entry
 * predates the last event, and it lands just after the entry expires (a read then recomputes; it is also the read anyone else would
 * make at that moment, so it adds at most one recompute per entry lifetime). Returns the delay in ms, or null when none is due.
 * `followUpsFired` counts follow-up timers already spent on this same entry.
 */
export function planBellStaleFollowUp(args: { generatedAtMs: number; lastEventAtMs: number; nowMs: number; followUpsFired: number }): number | null {
  const { generatedAtMs, lastEventAtMs, nowMs, followUpsFired } = args
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(lastEventAtMs) || lastEventAtMs <= 0) return null
  if (generatedAtMs >= lastEventAtMs) return null
  if (followUpsFired >= BELL_FOLLOW_UP_MAX_ATTEMPTS) return null
  const due = generatedAtMs + BELL_MAX_AGE_MS + BELL_FOLLOW_UP_MARGIN_MS - nowMs
  return Math.max(due, followUpsFired > 0 ? BELL_FOLLOW_UP_RETRY_MIN_MS : 1_000)
}

// ---- Coalesced sync events (lane 6.0.1002) ----
// One sale makes this tab dispatch `inventory` then `sales` (and a remote sale pushes several channels), and each
// `sync:update` used to reload every page that listens for it, so the Dashboard read its aggregates two or three times
// per sale. A burst of sync:update events now flushes ONCE as a `sync:flush` window event that carries the set of
// channels; subscribeSyncFlush() is how a page listens. sync:update itself is unchanged (cache invalidation stays immediate).
export const SYNC_FLUSH_EVENT = 'sync:flush'
const SYNC_FLUSH_LOCAL_MS = 250
// Resume, reconnect and refresh-all name 17-24 channels; a sale names 2-4 and an import 8.
const SYNC_FLUSH_BULK_CHANNELS = 10
const SYNC_FLUSH_STAGGER_MS = 400

export type SyncFlushDetail = {
  /** Distinct channels (the first segment of the name) that changed in the burst. For a subscriber: only the ones it asked for. */
  channels: string[]
  /** Every event in the burst was a push from another device; false when any was this tab's own write or refresh. */
  remote: boolean
  /** The reason every event shared, else null. */
  reason: string | null
  /** The source every event shared, else null (a page skips its own echo by source). */
  source: string | null
  /** 10 or more channels (resume, reconnect, refresh-all): subscribers are called one after another, not together. */
  bulk: boolean
  ts: number
}

export type SyncFlushEvent = { channel: string; remote: boolean; reason?: string | null; source?: string | null }

export type SyncFlushCollector = {
  note: (event: SyncFlushEvent) => void
  dispose: () => void
}

/**
 * Holds the sync:update events of one burst and emits them once. A burst with an own write or an ordinary channel
 * flushes SYNC_FLUSH_LOCAL_MS after the event that asked, and a later event never pushes that out, so a steady
 * stream flushes once per window instead of starving. A burst made only of remote pushes on the busy channels
 * (sales, inventory, returns) keeps the 1.5 s window the AppContext scheduler gives them, measured from the first
 * push, so the several pushes of one sale arrive in one flush.
 */
export function createSyncFlushCollector(
  host: SyncTimerHost & { now: () => number },
  emit: (detail: SyncFlushDetail) => void,
): SyncFlushCollector {
  let channels = new Set<string>()
  let allRemote = true
  let reasons = new Set<string | null>()
  let sources = new Set<string | null>()
  let burstStartedAt = 0
  let deadline = 0
  let timer: number | null = null
  const reset = () => {
    channels = new Set(); allRemote = true; reasons = new Set(); sources = new Set(); timer = null
  }
  const flush = () => {
    const detail: SyncFlushDetail = {
      channels: [...channels],
      remote: allRemote,
      reason: reasons.size === 1 ? [...reasons][0] : null,
      source: sources.size === 1 ? [...sources][0] : null,
      bulk: channels.size >= SYNC_FLUSH_BULK_CHANNELS,
      ts: host.now(),
    }
    reset()
    emit(detail)
  }
  const arm = (at: number) => {
    if (timer !== null) host.clearTimeout(timer)
    deadline = at
    timer = host.setTimeout(flush, Math.max(0, at - host.now()))
  }
  return {
    note(event) {
      const channel = String(event.channel || '').split(':')[0]
      if (!channel) return
      const now = host.now()
      if (timer === null) burstStartedAt = now
      channels.add(channel)
      allRemote = allRemote && event.remote
      reasons.add(event.reason || null)
      sources.add(event.source || null)
      const at = event.remote && REMOTE_COALESCED_SYNC_CHANNELS.has(channel)
        ? burstStartedAt + SYNC.REMOTE_EVENT_COALESCE_MS
        : now + SYNC_FLUSH_LOCAL_MS
      if (timer === null || at < deadline) arm(at)
    },
    dispose() {
      if (timer !== null) host.clearTimeout(timer)
      reset()
    },
  }
}

let syncFlushWired = false

function ensureSyncFlushCollector(): void {
  if (syncFlushWired || typeof window === 'undefined') return
  syncFlushWired = true
  const collector = createSyncFlushCollector(
    { now: () => Date.now(), setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs), clearTimeout: (timer) => window.clearTimeout(timer) },
    (detail) => { window.dispatchEvent(new CustomEvent(SYNC_FLUSH_EVENT, { detail })) },
  )
  window.addEventListener('sync:update', (event) => {
    const detail = ((event as CustomEvent<{ channel?: unknown; reason?: unknown; source?: unknown }>).detail || {})
    // A cache-refresh is the echo of a background read that already stored fresh data, not a change.
    if (detail.reason === 'cache-refresh') return
    collector.note({
      channel: String(detail.channel || ''),
      remote: isRemoteSyncUpdate(detail),
      reason: typeof detail.reason === 'string' ? detail.reason : null,
      source: typeof detail.source === 'string' ? detail.source : null,
    })
  })
}

const syncFlushSubscribers = new Set<{ channels: ReadonlySet<string> }>()

/**
 * Calls `handler` once per flush that holds any of `channels`, with `detail.channels` cut to the ones asked for.
 * Returns the unsubscribe function (use it as a useEffect cleanup). A bulk flush reaches the subscribers it matches
 * one after another, SYNC_FLUSH_STAGGER_MS apart, so the heavy pages do not hit the server in the same instant.
 */
export function subscribeSyncFlush(channels: readonly string[], handler: (detail: SyncFlushDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  ensureSyncFlushCollector()
  const subscriber = { channels: new Set(channels.map((channel) => String(channel).split(':')[0])) }
  const pending = new Set<number>()
  const onFlush = (event: Event) => {
    const flush = (event as CustomEvent<SyncFlushDetail>).detail
    const matched = flush.channels.filter((channel) => subscriber.channels.has(channel))
    if (!matched.length) return
    const deliver = () => handler({ ...flush, channels: matched })
    const rank = flush.bulk
      ? [...syncFlushSubscribers].filter((other) => flush.channels.some((channel) => other.channels.has(channel))).indexOf(subscriber)
      : 0
    if (rank <= 0) { deliver(); return }
    const timer = window.setTimeout(() => { pending.delete(timer); deliver() }, rank * SYNC_FLUSH_STAGGER_MS)
    pending.add(timer)
  }
  syncFlushSubscribers.add(subscriber)
  window.addEventListener(SYNC_FLUSH_EVENT, onFlush)
  return () => {
    syncFlushSubscribers.delete(subscriber)
    window.removeEventListener(SYNC_FLUSH_EVENT, onFlush)
    for (const timer of pending) window.clearTimeout(timer)
    pending.clear()
  }
}

let persistentStorageRequest: Promise<boolean> | null = null

export function requestPersistentAppStorage(): Promise<boolean> {
  if (persistentStorageRequest) return persistentStorageRequest
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return Promise.resolve(false)
  persistentStorageRequest = navigator.storage.persist()
    .then((persistent) => Boolean(persistent))
    .catch(() => false)
  return persistentStorageRequest
}

export function dispatchSyncUpdates(channels: readonly string[] = [], reason = '', extra: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return
  const ts = Date.now()
  for (const channel of channels) {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { ...extra, channel, reason, ts },
    }))
  }
}

export function hasStoredUserSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !!(window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER))
  } catch (_) {
    return false
  }
}
