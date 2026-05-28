import { STORAGE_KEYS } from '../../constants.ts'
import { resetLocalMirrorDb } from '../../api/localDb.ts'

type RuntimeDescriptor = {
  serverStartTime: string
  storageVersion: string
  dataRootKey: string
  organizationPublicId: string
}

type RuntimeDescriptorInput = Partial<RuntimeDescriptor> & {
  organization_public_id?: unknown
  [key: string]: unknown
}

type RuntimeResetOptions = {
  preserveDeviceSettings?: boolean
  preserveSyncServer?: boolean
  preserveSessionDuration?: boolean
  preserveRuntimeMeta?: boolean
  preserveOrganization?: boolean
  preserveAuth?: boolean
  clearAuth?: boolean
}

type StorageEntry = [string, string | null]

const BUSINESS_OS_STORAGE_PREFIXES = ['businessos_', 'business_os_']
const RUNTIME_CLEANUP_CONCURRENCY = 2

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined'
}

function isBusinessOsStorageKey(key: unknown): boolean {
  const value = String(key || '').trim().toLowerCase()
  return BUSINESS_OS_STORAGE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function sanitizeText(value: unknown): string {
  return String(value || '').trim()
}

export function sanitizeSyncServerUrl(value: unknown, fallback = ''): string {
  const raw = sanitizeText(value)
  if (!raw || !canUseBrowserStorage()) return raw || fallback
  try {
    const url = new URL(raw, window.location.origin)
    if (!/^https?:$/i.test(url.protocol)) return sanitizeText(fallback)
    return url.origin.replace(/\/$/, '')
  } catch (_) {
    return sanitizeText(fallback)
  }
}

export function normalizeRuntimeDescriptor(input: RuntimeDescriptorInput = {}): RuntimeDescriptor {
  return {
    serverStartTime: sanitizeText(input?.serverStartTime),
    storageVersion: sanitizeText(input?.storageVersion),
    dataRootKey: sanitizeText(input?.dataRootKey),
    organizationPublicId: sanitizeText(input?.organizationPublicId || input?.organization_public_id),
  }
}

export function readStoredRuntimeDescriptor(): RuntimeDescriptor {
  if (!canUseBrowserStorage()) return normalizeRuntimeDescriptor()
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLIENT_RUNTIME) || ''
    if (!raw) return normalizeRuntimeDescriptor()
    return normalizeRuntimeDescriptor(JSON.parse(raw))
  } catch (_) {
    return normalizeRuntimeDescriptor()
  }
}

export function writeStoredRuntimeDescriptor(input: RuntimeDescriptorInput = {}): RuntimeDescriptor {
  if (!canUseBrowserStorage()) return normalizeRuntimeDescriptor(input)
  const descriptor = normalizeRuntimeDescriptor(input)
  const hasValue = Object.values(descriptor).some(Boolean)
  try {
    if (!hasValue) {
      localStorage.removeItem(STORAGE_KEYS.CLIENT_RUNTIME)
    } else {
      localStorage.setItem(STORAGE_KEYS.CLIENT_RUNTIME, JSON.stringify(descriptor))
    }
  } catch (_) {}
  return descriptor
}

export function shouldResetForRuntimeChange(
  currentInput: RuntimeDescriptorInput = {},
  nextInput: RuntimeDescriptorInput = {},
): boolean {
  const current = normalizeRuntimeDescriptor(currentInput)
  const next = normalizeRuntimeDescriptor(nextInput)
  if (!Object.values(next).some(Boolean)) return false
  if (!Object.values(current).some(Boolean)) return false

  const hardKeys: Array<keyof RuntimeDescriptor> = ['storageVersion', 'dataRootKey', 'organizationPublicId']
  if (hardKeys.some((key) => current[key] && next[key] && current[key] !== next[key])) {
    return true
  }

  return false
}

export function buildQueuedOperationScope(extra: Record<string, unknown> = {}): RuntimeDescriptor & Record<string, unknown> {
  return {
    ...readStoredRuntimeDescriptor(),
    queuedAt: new Date().toISOString(),
    ...extra,
  }
}

export function doesQueuedScopeMatchCurrent(
  scope: RuntimeDescriptorInput,
  currentScope: RuntimeDescriptorInput = readStoredRuntimeDescriptor(),
): boolean {
  const queued = normalizeRuntimeDescriptor(scope)
  const current = normalizeRuntimeDescriptor(currentScope)
  if (!queued.serverStartTime || !queued.storageVersion || !queued.dataRootKey) return false
  if (!current.serverStartTime || !current.storageVersion || !current.dataRootKey) return false

  if (queued.serverStartTime !== current.serverStartTime) return false
  if (queued.storageVersion !== current.storageVersion) return false
  if (queued.dataRootKey !== current.dataRootKey) return false
  if (queued.organizationPublicId && current.organizationPublicId && queued.organizationPublicId !== current.organizationPublicId) {
    return false
  }
  return true
}

async function mapRuntimeCleanup<T>(items: readonly T[], worker: (item: T) => Promise<boolean>): Promise<boolean[]> {
  const queue = Array.isArray(items) ? [...items] : []
  if (!queue.length) return []
  const results: boolean[] = []
  const workers = Array.from({ length: Math.min(RUNTIME_CLEANUP_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (typeof item === 'undefined') continue
      try {
        results.push(await worker(item))
      } catch (_) {
        results.push(false)
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function unregisterServiceWorkers(registrations: readonly ServiceWorkerRegistration[]): Promise<boolean[]> {
  return mapRuntimeCleanup(registrations, (registration) => registration.unregister().catch(() => false))
}

async function deleteBusinessOsCaches(cacheKeys: string[]): Promise<boolean[]> {
  const keys = (Array.isArray(cacheKeys) ? cacheKeys : [])
    .filter((key) => String(key || '').toLowerCase().startsWith('business-os-'))
  return mapRuntimeCleanup(keys, (key) => window.caches.delete(key).catch(() => false))
}

async function clearServiceWorkersAndCaches(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await unregisterServiceWorkers(registrations)
    }
  } catch (_) {}
  try {
    if (window.caches?.keys) {
      const cacheKeys = await window.caches.keys()
      await deleteBusinessOsCaches(cacheKeys)
    }
  } catch (_) {}
}

function snapshotStorage(storage: Storage | null, preserveKeys: Set<string>): StorageEntry[] {
  if (!storage) return []
  const kept: StorageEntry[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key || !preserveKeys.has(key)) continue
      kept.push([key, storage.getItem(key)])
    }
  } catch (_) {}
  return kept
}

function clearStorage(storage: Storage | null, preserveKeys: Set<string>): void {
  if (!storage) return
  const toDelete: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key || preserveKeys.has(key)) continue
      if (isBusinessOsStorageKey(key)) toDelete.push(key)
    }
    toDelete.forEach((key) => storage.removeItem(key))
  } catch (_) {}
}

function restoreStorage(storage: Storage | null, entries: StorageEntry[]): void {
  if (!storage || !Array.isArray(entries)) return
  entries.forEach(([key, value]) => {
    try {
      if (value == null) storage.removeItem(key)
      else storage.setItem(key, value)
    } catch (_) {}
  })
}

export async function resetClientRuntimeState(options: RuntimeResetOptions = {}): Promise<void> {
  const preserveDeviceSettings = options.preserveDeviceSettings !== false
  const preserveSyncServer = options.preserveSyncServer !== false
  const preserveSessionDuration = options.preserveSessionDuration !== false
  const preserveRuntimeMeta = options.preserveRuntimeMeta === true
  const preserveOrganization = options.preserveOrganization === true
  const preserveAuth = options.preserveAuth === true || options.clearAuth === false

  const localPreserveKeys = new Set<string>()
  const sessionPreserveKeys = new Set<string>()

  if (preserveDeviceSettings) localPreserveKeys.add(STORAGE_KEYS.DEVICE_SETTINGS)
  if (preserveSyncServer) localPreserveKeys.add(STORAGE_KEYS.SYNC_SERVER)
  if (preserveSessionDuration) localPreserveKeys.add(STORAGE_KEYS.SESSION_DURATION)
  if (preserveRuntimeMeta) localPreserveKeys.add(STORAGE_KEYS.CLIENT_RUNTIME)
  if (preserveOrganization) localPreserveKeys.add(STORAGE_KEYS.ORGANIZATION)
  if (preserveAuth) {
    localPreserveKeys.add(STORAGE_KEYS.USER)
    localPreserveKeys.add(STORAGE_KEYS.USER_EXPIRY)
    sessionPreserveKeys.add(STORAGE_KEYS.USER)
    sessionPreserveKeys.add(STORAGE_KEYS.USER_EXPIRY)
  }

  const keptLocal = canUseBrowserStorage() ? snapshotStorage(window.localStorage, localPreserveKeys) : []
  const keptSession = canUseBrowserStorage() ? snapshotStorage(window.sessionStorage, sessionPreserveKeys) : []

  clearStorage(canUseBrowserStorage() ? window.localStorage : null, localPreserveKeys)
  clearStorage(canUseBrowserStorage() ? window.sessionStorage : null, sessionPreserveKeys)

  await clearServiceWorkersAndCaches()
  await resetLocalMirrorDb()

  restoreStorage(canUseBrowserStorage() ? window.localStorage : null, keptLocal)
  restoreStorage(canUseBrowserStorage() ? window.sessionStorage : null, keptSession)
}
