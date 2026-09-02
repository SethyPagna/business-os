import { STORAGE_KEYS } from '../constants.ts'

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

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: {
    register: (tag: string) => Promise<void>
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

export function dispatchSyncUpdates(channels: readonly string[] = [], reason = ''): void {
  if (typeof window === 'undefined') return
  const ts = Date.now()
  for (const channel of channels) {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, reason, ts },
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
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  navigator.serviceWorker.ready
    .then((registration) => {
      const syncRegistration = registration as SyncRegistration
      if (syncRegistration?.sync?.register) {
        syncRegistration.sync.register(OUTBOX_SYNC_TAG).catch(() => {})
      }
      registration?.active?.postMessage({ type: 'BUSINESS_OS_SYNC_NOW' })
    })
    .catch(() => {})
}
