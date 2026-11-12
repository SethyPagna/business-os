import { STORAGE_KEYS } from '../constants.ts'

export interface ClientDeviceInfo {
  clientTime: string
  deviceTz: string | null
  deviceName: string
}

export type ClientMetaHeaders = Partial<{
  'x-client-time': string
  'x-device-tz': string
  'x-device-name': string
}>

function getBrowserName(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/Chrome\//i.test(userAgent)) return 'Chrome'
  if (/Firefox\//i.test(userAgent)) return 'Firefox'
  if (/Safari\//i.test(userAgent)) return 'Safari'
  return 'Browser'
}

function getOperatingSystemName(userAgent: string): string {
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/iPhone|iPad/i.test(userAgent)) return 'iOS'
  if (/Mac OS X/i.test(userAgent)) return 'macOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Unknown'
}

// Browser APIs deliberately do not expose a reliable desktop hardware model.
// Keep the stable browser/OS label, but include the model family where the
// user agent genuinely provides one (mainly phones/tablets). This is display
// metadata for an administrator's approval decision, never a device key.
function getDeviceModelLabel(userAgent: string): string | null {
  const android = userAgent.match(/Android[^;]*;[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)
  if (android?.[1]) return android[1].trim()
  if (/iPad/i.test(userAgent)) return 'iPad'
  if (/iPhone/i.test(userAgent)) return 'iPhone'
  return null
}

export function getClientDeviceInfo(): ClientDeviceInfo {
  const ua = globalThis.navigator?.userAgent || ''
  const os = getOperatingSystemName(ua)
  const browser = getBrowserName(ua)
  const model = getDeviceModelLabel(ua)

  return {
    clientTime: new Date().toISOString(),
    deviceTz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    deviceName: `${browser} on ${os}${model ? ` (${model})` : ''}`,
  }
}

export function getClientMetaHeaders(): ClientMetaHeaders {
  try {
    const device = getClientDeviceInfo()
    return {
      'x-client-time': device.clientTime || '',
      'x-device-tz': device.deviceTz || '',
      'x-device-name': device.deviceName || '',
    }
  } catch (_) {
    return {}
  }
}

// Persisted, random device identifier used by the device-approval security
// feature (see cloudflare/src/lib/deviceTrust.ts). Generated once per browser
// and kept in localStorage, with a copy in IndexedDB and in module memory --
// deliberately NOT derived from the user agent, IP or any other fingerprintable
// signal, since those collide across identical devices and change on the same
// device. The Worker also pins the id in an HttpOnly cookie and returns the id
// it settled on; adoptServerDeviceId() stores that one.
//
// The key survives logout (platform/runtime/clientRuntime.ts keeps
// STORAGE_KEYS.DEVICE_ID): approval belongs to the physical browser, not to one
// login session. A cleared browser or a private window is still a new device.
const DEVICE_ID_STORAGE_KEY = STORAGE_KEYS.DEVICE_ID
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/
const BACKUP_DB_NAME = 'businessos_device'
const BACKUP_STORE_NAME = 'identity'
const BACKUP_RECORD_KEY = 'device_id'

let memoryDeviceId: string | null = null
let identityReady: Promise<void> | null = null

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}

function randomDeviceId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch (_) {
    // fall through to the manual fallback below
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function readStoredId(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY)
    return isValidDeviceId(stored) ? stored : null
  } catch (_) {
    return null
  }
}

function writeStoredId(id: string): void {
  try {
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, id)
  } catch (_) {
    // Full or blocked storage: the id stays in memory for this page's life.
  }
}

function openBackup(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const factory = globalThis.indexedDB
      if (!factory) return resolve(null)
      const request = factory.open(BACKUP_DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(BACKUP_STORE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch (_) {
      resolve(null)
    }
  })
}

async function readBackupId(): Promise<string | null> {
  const db = await openBackup()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction(BACKUP_STORE_NAME, 'readonly').objectStore(BACKUP_STORE_NAME).get(BACKUP_RECORD_KEY)
      request.onsuccess = () => {
        db.close()
        resolve(isValidDeviceId(request.result) ? request.result : null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    } catch (_) {
      resolve(null)
    }
  })
}

async function writeBackupId(id: string): Promise<void> {
  const db = await openBackup()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite')
      tx.objectStore(BACKUP_STORE_NAME).put(id, BACKUP_RECORD_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); resolve() }
    } catch (_) {
      resolve()
    }
  })
}

// Sign-in calls await this first: when localStorage was emptied but the
// IndexedDB copy survived, the old id is restored before any request carries a
// new one. It never mints an id.
// A hung indexedDB.open (some private modes and low-storage phones never answer) must not block sign-in:
// the restore gets this long, then sign-in goes on with the id it has.
const RESTORE_TIMEOUT_MS = 1000

export function deviceIdentityReady(): Promise<void> {
  identityReady ??= Promise.race([restoreIdentity(), new Promise<void>((resolve) => { setTimeout(resolve, RESTORE_TIMEOUT_MS) })]).catch(() => undefined)
  return identityReady
}

function restoreIdentity(): Promise<void> {
  return (async () => {
    const stored = readStoredId()
    const backup = await readBackupId()
    if (stored) {
      memoryDeviceId = stored
      if (backup !== stored) await writeBackupId(stored)
      return
    }
    if (backup && !memoryDeviceId) {
      memoryDeviceId = backup
      writeStoredId(backup)
      return
    }
    if (memoryDeviceId) await writeBackupId(memoryDeviceId)
  })()
}

// One id per page life: if storage refuses the write the id is still kept in
// memory, so /login and /otp/verify in the same attempt never differ.
export function getOrCreatePersistentDeviceId(): string {
  const stored = readStoredId()
  if (stored) {
    memoryDeviceId = stored
    return stored
  }
  if (memoryDeviceId) {
    writeStoredId(memoryDeviceId)
    return memoryDeviceId
  }
  const created = randomDeviceId()
  memoryDeviceId = created
  writeStoredId(created)
  void writeBackupId(created)
  return created
}

// The Worker answers with the id it settled on (the cookie's id wins when the
// two differ). Storing it keeps this browser and the server on one identity.
export function adoptServerDeviceId(value: unknown): void {
  if (!isValidDeviceId(value)) return
  memoryDeviceId = value
  writeStoredId(value)
  void writeBackupId(value)
}

export function adoptDeviceIdFromResponse(result: unknown): void {
  if (result && typeof result === 'object') adoptServerDeviceId((result as { deviceId?: unknown }).deviceId)
}
