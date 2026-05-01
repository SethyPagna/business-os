import { STORAGE_KEYS } from '../../constants.js'
import { resetLocalMirrorDb } from '../../api/localDb.js'

const BUSINESS_OS_STORAGE_PREFIXES = ['businessos_', 'business_os_']

function canUseBrowserStorage() {
  return typeof window !== 'undefined'
}

function isBusinessOsStorageKey(key) {
  const value = String(key || '').trim().toLowerCase()
  return BUSINESS_OS_STORAGE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function sanitizeText(value) {
  return String(value || '').trim()
}

export function sanitizeSyncServerUrl(value, fallback = '') {
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

export function normalizeRuntimeDescriptor(input = {}) {
  return {
    serverStartTime: sanitizeText(input?.serverStartTime),
    storageVersion: sanitizeText(input?.storageVersion),
    dataRootKey: sanitizeText(input?.dataRootKey),
    organizationPublicId: sanitizeText(input?.organizationPublicId || input?.organization_public_id),
  }
}

export function readStoredRuntimeDescriptor() {
  if (!canUseBrowserStorage()) return normalizeRuntimeDescriptor()
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLIENT_RUNTIME) || ''
    if (!raw) return normalizeRuntimeDescriptor()
    return normalizeRuntimeDescriptor(JSON.parse(raw))
  } catch (_) {
    return normalizeRuntimeDescriptor()
  }
}

export function writeStoredRuntimeDescriptor(input = {}) {
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

export function shouldResetForRuntimeChange(currentInput = {}, nextInput = {}) {
  const current = normalizeRuntimeDescriptor(currentInput)
  const next = normalizeRuntimeDescriptor(nextInput)
  if (!Object.values(next).some(Boolean)) return false
  if (!Object.values(current).some(Boolean)) return false

  const hardKeys = ['storageVersion', 'dataRootKey', 'organizationPublicId']
  if (hardKeys.some((key) => current[key] && next[key] && current[key] !== next[key])) {
    return true
  }

  return !!(current.serverStartTime && next.serverStartTime && current.serverStartTime !== next.serverStartTime)
}

export function buildQueuedOperationScope(extra = {}) {
  return {
    ...readStoredRuntimeDescriptor(),
    queuedAt: new Date().toISOString(),
    ...extra,
  }
}

export function doesQueuedScopeMatchCurrent(scope, currentScope = readStoredRuntimeDescriptor()) {
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

async function clearServiceWorkersAndCaches() {
  if (typeof window === 'undefined') return
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))
    }
  } catch (_) {}
  try {
    if (window.caches?.keys) {
      const cacheKeys = await window.caches.keys()
      await Promise.all(
        cacheKeys
          .filter((key) => String(key || '').toLowerCase().startsWith('business-os-'))
          .map((key) => window.caches.delete(key).catch(() => false)),
      )
    }
  } catch (_) {}
}

function snapshotStorage(storage, preserveKeys) {
  if (!storage) return []
  const kept = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key || !preserveKeys.has(key)) continue
      kept.push([key, storage.getItem(key)])
    }
  } catch (_) {}
  return kept
}

function clearStorage(storage, preserveKeys) {
  if (!storage) return
  const toDelete = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key || preserveKeys.has(key)) continue
      if (isBusinessOsStorageKey(key)) toDelete.push(key)
    }
    toDelete.forEach((key) => storage.removeItem(key))
  } catch (_) {}
}

function restoreStorage(storage, entries) {
  if (!storage || !Array.isArray(entries)) return
  entries.forEach(([key, value]) => {
    try {
      if (value == null) storage.removeItem(key)
      else storage.setItem(key, value)
    } catch (_) {}
  })
}

export async function resetClientRuntimeState(options = {}) {
  const preserveDeviceSettings = options.preserveDeviceSettings !== false
  const preserveSyncServer = options.preserveSyncServer !== false
  const preserveSessionDuration = options.preserveSessionDuration !== false
  const preserveRuntimeMeta = options.preserveRuntimeMeta === true
  const preserveOrganization = options.preserveOrganization === true
  const preserveAuth = options.preserveAuth === true

  const localPreserveKeys = new Set()
  const sessionPreserveKeys = new Set()

  if (preserveDeviceSettings) localPreserveKeys.add(STORAGE_KEYS.DEVICE_SETTINGS)
  if (preserveSyncServer) localPreserveKeys.add(STORAGE_KEYS.SYNC_SERVER)
  if (preserveSessionDuration) localPreserveKeys.add(STORAGE_KEYS.SESSION_DURATION)
  if (preserveRuntimeMeta) localPreserveKeys.add(STORAGE_KEYS.CLIENT_RUNTIME)
  if (preserveOrganization) localPreserveKeys.add(STORAGE_KEYS.ORGANIZATION)
  if (preserveAuth) {
    localPreserveKeys.add(STORAGE_KEYS.AUTH_TOKEN)
    localPreserveKeys.add(STORAGE_KEYS.USER)
    localPreserveKeys.add(STORAGE_KEYS.USER_EXPIRY)
    sessionPreserveKeys.add(STORAGE_KEYS.AUTH_TOKEN)
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
