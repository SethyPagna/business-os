import { STORAGE_KEYS, SYNC } from '../constants.ts'

export const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
export const DISCARD_SYNC_UPDATE_CHANNELS = ['products', 'sales', 'customers', 'suppliers', 'deliveryContacts', 'returns', 'inventory', 'dashboard'] as const
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

export type SyncQueueChangedDetail = Record<string, unknown>

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

export function emitSyncQueueChanged(detail: SyncQueueChangedDetail = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sync:queue-changed', {
    detail: { ts: Date.now(), ...detail },
  }))
}

export function hasStoredUserSession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !!(window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER))
  } catch (_) {
    return false
  }
}

export function registerOutboxBackgroundSync(): void {
  // Online-only writes. Existing offline work is retained for explicit,
  // original-account recovery; never schedule an unattended replay.
}
