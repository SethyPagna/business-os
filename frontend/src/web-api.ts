/**
 * web-api.ts - Browser API bootstrap.
 *
 * FIX: window.api is now installed SYNCHRONOUSLY via static imports.
 * The original used a dynamic import() which is async ??this caused
 * AppContext's polling loop to sometimes run before window.api existed,
 * leaving the app stuck on the loading screen.
 *
 * Architecture:
 *   api/http.ts      - apiFetch, route(), read cache
 *   api/websocket.ts - WebSocket connection manager
 *   api/localDb.ts   - Dexie (IndexedDB) schema + helpers
 *   api/methods.ts   - all domain API methods
 */

import { apiFetch, setSyncServerUrl, setSyncToken, getSyncServerUrl, getCallLog, clearCallLog, startHealthCheck, cacheClearAll, pingServerHealth } from './api/http.ts'
import { connectWS, disconnectWS, reconnectWS, resumeWS, scheduleConnectWS } from './api/websocket.ts'
import {
  dispatchSyncUpdates,
  emitSyncQueueChanged,
  hasStoredUserSession,
  registerOutboxBackgroundSync,
} from './api/syncRuntime.ts'
import { STORAGE_KEYS }            from './constants.ts'
import { sanitizeSyncServerUrl }   from './platform/runtime/clientRuntime.ts'
import {
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier'

type AnyRecord = Record<string, any>
type LazyApiMethod = (...args: any[]) => Promise<any>
type MethodsModule = Record<string, (...args: any[]) => any>
type AppBootstrapModule = typeof import('./api/appBootstrapTransport.ts')
type AuthTransportModule = typeof import('./api/authTransport.ts')
type PortalTransportModule = typeof import('./api/portalTransport.ts')
type SystemRuntimeModule = typeof import('./api/systemRuntime.ts')
type SaleWriteTransportModule = typeof import('./api/saleWriteTransport.ts')
type OfflineSnapshotTransportModule = typeof import('./api/offlineSnapshotTransport.ts')
type NotificationSummaryModule = typeof import('./api/notificationSummary.ts')
type SettingsTransportModule = typeof import('./api/settingsTransport.ts')
type ProductReadTransportModule = typeof import('./api/productReadTransport.ts')
type ProductWriteTransportModule = typeof import('./api/productWriteTransport.ts')
type LookupTransportModule = typeof import('./api/lookupTransport.ts')
type BranchTransportModule = typeof import('./api/branchTransport.ts')
type UserReadTransportModule = typeof import('./api/userReadTransport.ts')
type ActionHistoryTransportModule = typeof import('./api/actionHistoryTransport.ts')
type NotesTransportModule = typeof import('./api/notesTransport.ts')
type ProductQueryParams = Parameters<ProductReadTransportModule['searchProducts']>[0]
type OfflineVaultKey = CryptoKey | null
type OfflineRow = AnyRecord & {
  _seq?: number
  id?: string
  key?: string
  value?: any
  status?: string
  upload_id?: string
  chunk_index?: number
  encrypted_payload?: string
  iv?: string
}
type OfflineOperation = AnyRecord & {
  operation_id?: string
  type?: string
  payload?: AnyRecord
  id?: string
  client_request_id?: string
  schema_version?: number
  base_updated_at?: string
  updated_at?: string
  entity_table?: string
  entity?: string
  entity_id?: string | number | null
  entity_label?: string
}
type OfflineSyncOptions = { limit?: number; force?: boolean }
type OfflineFileOwner = OfflineOperation & { upload_id?: string }

const OFFLINE_REFRESH_INTERVAL_MS = 5 * 60_000
const OFFLINE_SNAPSHOT_IDLE_DELAY_MS = 30_000
const OFFLINE_SNAPSHOT_FORCE_DELAY_MS = 12_000
const INITIAL_OFFLINE_MAINTENANCE_DELAY_MS = 45_000
const INITIAL_OFFLINE_MAINTENANCE_IDLE_TIMEOUT_MS = 60_000
const BOOTSTRAP_STORAGE_MAINTENANCE_DELAY_MS = 2200
const BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS = 9000
const BOOTSTRAP_OFFLINE_DB_WRITE_DELAY_MS = 45_000
const BOOTSTRAP_OFFLINE_DB_WRITE_IDLE_TIMEOUT_MS = 60_000
const SERVICE_WORKER_UPDATE_INTERVAL_MS = 15 * 60_000
const OFFLINE_VAULT_IDLE_LOCK_MS = 15 * 60_000
const OFFLINE_FILE_CHUNK_SIZE = 1024 * 1024
const OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY = 3
const PENDING_SYNC_PREVIEW_LIMIT = 25
let offlineMaintenanceStarted = false
let initialOfflineMaintenanceScheduled = false
let lastServiceWorkerUpdateAt = 0
let offlineSnapshotTimer: number = 0
let offlineSnapshotIdleId: number = 0
let offlineVaultKey: OfflineVaultKey = null
let offlineVaultUnlockedAt = 0
let offlineVaultIdleTimer: number | null = null
let sessionRecoveryListenersRegistered = false
let methodsModulePromise: Promise<MethodsModule> | null = null
let appBootstrapModulePromise: Promise<AppBootstrapModule> | null = null
let authTransportModulePromise: Promise<AuthTransportModule> | null = null
let portalTransportModulePromise: Promise<PortalTransportModule> | null = null
let systemRuntimeModulePromise: Promise<SystemRuntimeModule> | null = null
let saleWriteTransportModulePromise: Promise<SaleWriteTransportModule> | null = null
let offlineSnapshotTransportModulePromise: Promise<OfflineSnapshotTransportModule> | null = null
let notificationSummaryModulePromise: Promise<NotificationSummaryModule> | null = null
let settingsTransportModulePromise: Promise<SettingsTransportModule> | null = null
let productReadTransportModulePromise: Promise<ProductReadTransportModule> | null = null
let productWriteTransportModulePromise: Promise<ProductWriteTransportModule> | null = null
let lookupTransportModulePromise: Promise<LookupTransportModule> | null = null
let branchTransportModulePromise: Promise<BranchTransportModule> | null = null
let notesTransportModulePromise: Promise<NotesTransportModule> | null = null
let userReadTransportModulePromise: Promise<UserReadTransportModule> | null = null
let actionHistoryTransportModulePromise: Promise<ActionHistoryTransportModule> | null = null
let localDbPromise: Promise<any> | null = null
const lazyApiMethodCache = new Map<string, LazyApiMethod>()

function sanitizeBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/$/, '')
}

function isPublicRuntimePath(): boolean {
  if (typeof location === 'undefined') return false
  const pathname = String(location.pathname || '').toLowerCase()
  const hostname = String(location.hostname || '').toLowerCase()
  const publicRoot = hostname
    && hostname !== 'localhost'
    && hostname !== '127.0.0.1'
    && hostname !== '::1'
    && !hostname.startsWith('admin.')
  return (publicRoot && pathname === '/') || pathname === '/public' || pathname.startsWith('/public/')
}

function getOfflineDb(): Promise<any> {
  if (!localDbPromise) localDbPromise = import('./api/localDb.ts').then((module) => module.dexieDb as any)
  return localDbPromise
}

function loadMethodsModule(): Promise<MethodsModule> {
  if (!methodsModulePromise) methodsModulePromise = import('./api/methods.ts')
  return methodsModulePromise
}

function loadAppBootstrapModule(): Promise<AppBootstrapModule> {
  if (!appBootstrapModulePromise) appBootstrapModulePromise = import('./api/appBootstrapTransport.ts')
  return appBootstrapModulePromise
}

function loadAuthTransportModule(): Promise<AuthTransportModule> {
  if (!authTransportModulePromise) authTransportModulePromise = import('./api/authTransport.ts')
  return authTransportModulePromise
}

function loadPortalTransportModule(): Promise<PortalTransportModule> {
  if (!portalTransportModulePromise) portalTransportModulePromise = import('./api/portalTransport.ts')
  return portalTransportModulePromise
}

function loadSystemRuntimeModule(): Promise<SystemRuntimeModule> {
  if (!systemRuntimeModulePromise) systemRuntimeModulePromise = import('./api/systemRuntime.ts')
  return systemRuntimeModulePromise
}

function loadSaleWriteTransportModule(): Promise<SaleWriteTransportModule> {
  if (!saleWriteTransportModulePromise) saleWriteTransportModulePromise = import('./api/saleWriteTransport.ts')
  return saleWriteTransportModulePromise
}

function loadOfflineSnapshotTransportModule(): Promise<OfflineSnapshotTransportModule> {
  if (!offlineSnapshotTransportModulePromise) offlineSnapshotTransportModulePromise = import('./api/offlineSnapshotTransport.ts')
  return offlineSnapshotTransportModulePromise
}

function loadNotificationSummaryModule(): Promise<NotificationSummaryModule> {
  if (!notificationSummaryModulePromise) notificationSummaryModulePromise = import('./api/notificationSummary.ts')
  return notificationSummaryModulePromise
}

function loadSettingsTransportModule(): Promise<SettingsTransportModule> {
  if (!settingsTransportModulePromise) settingsTransportModulePromise = import('./api/settingsTransport.ts')
  return settingsTransportModulePromise
}

function loadProductReadTransportModule(): Promise<ProductReadTransportModule> {
  if (!productReadTransportModulePromise) productReadTransportModulePromise = import('./api/productReadTransport.ts')
  return productReadTransportModulePromise
}

function loadProductWriteTransportModule(): Promise<ProductWriteTransportModule> {
  if (!productWriteTransportModulePromise) productWriteTransportModulePromise = import('./api/productWriteTransport.ts')
  return productWriteTransportModulePromise
}

function loadLookupTransportModule(): Promise<LookupTransportModule> {
  if (!lookupTransportModulePromise) lookupTransportModulePromise = import('./api/lookupTransport.ts')
  return lookupTransportModulePromise
}

function loadBranchTransportModule(): Promise<BranchTransportModule> {
  if (!branchTransportModulePromise) branchTransportModulePromise = import('./api/branchTransport.ts')
  return branchTransportModulePromise
}

function loadNotesTransportModule(): Promise<NotesTransportModule> {
  if (!notesTransportModulePromise) notesTransportModulePromise = import('./api/notesTransport.ts')
  return notesTransportModulePromise
}

function loadUserReadTransportModule(): Promise<UserReadTransportModule> {
  if (!userReadTransportModulePromise) userReadTransportModulePromise = import('./api/userReadTransport.ts')
  return userReadTransportModulePromise
}

function loadActionHistoryTransportModule(): Promise<ActionHistoryTransportModule> {
  if (!actionHistoryTransportModulePromise) actionHistoryTransportModulePromise = import('./api/actionHistoryTransport.ts')
  return actionHistoryTransportModulePromise
}

function getAuthTransportMethod<T extends keyof AuthTransportModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadAuthTransportModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getPortalTransportMethod<T extends keyof PortalTransportModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadPortalTransportModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getSystemRuntimeMethod<T extends keyof SystemRuntimeModule>(name: T): (...args: any[]) => Promise<any> {
  return (...args) =>
    loadSystemRuntimeModule().then((module) => {
      const fn = module?.[name]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${String(name)} is not available.`)
      }
      return (fn as (...methodArgs: any[]) => Promise<any>)(...args)
    })
}

function getLazyApiMethod(name: string): LazyApiMethod {
  if (!lazyApiMethodCache.has(name)) {
    lazyApiMethodCache.set(name, (...args) =>
      loadMethodsModule().then((module) => {
        const fn = module?.[name]
        if (typeof fn !== 'function') {
          throw new Error(`window.api.${name} is not available.`)
        }
        return fn(...args)
      }))
  }
  return lazyApiMethodCache.get(name) as LazyApiMethod
}

function serializePendingSyncPreview(rows: OfflineRow[] = []): AnyRecord[] {
  const preview: AnyRecord[] = []
  const limit = Math.min(PENDING_SYNC_PREVIEW_LIMIT, rows.length)
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || {}
    preview.push({
      _seq: row._seq,
      channel: row.channel,
      operation: row.operation || null,
      entity_table: row.entity_table || null,
      entity_id: row.entity_id ?? null,
      entity_name: row.entity_name || null,
      status: String(row.status || 'pending'),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      retry_count: Number(row.retry_count || 0),
      retry_at: row.retry_at || null,
      error: row.error || null,
    })
  }
  return preview
}

async function mapOfflineFileChunkStatusUpdates(
  rows: OfflineRow[] | unknown,
  mapper: (row: OfflineRow, index: number) => Promise<unknown> | unknown,
): Promise<void> {
  const list = Array.isArray(rows) ? rows : []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY, list.length) }, async () => {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      await mapper(list[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function bytesToBase64(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof Uint8Array
    ? bytes
    : ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes)
  let binary = ''
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index])
  return btoa(binary)
}

function base64ToBytes(value: unknown): Uint8Array {
  const binary = atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function stableStringify(value: any): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value))
  const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function deriveOfflineVaultKey(pin: unknown, saltBase64: unknown): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pin || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: asArrayBuffer(base64ToBytes(saltBase64)), iterations: 250_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptOfflineVaultValue(value: unknown, key: OfflineVaultKey = offlineVaultKey): Promise<{ iv: string; encrypted_payload: string }> {
  if (!key) throw new Error('Offline vault is locked.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value ?? null))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(iv) }, key, asArrayBuffer(encoded))
  return { iv: bytesToBase64(iv), encrypted_payload: bytesToBase64(encrypted) }
}

async function decryptOfflineVaultValue(record: OfflineRow, key: OfflineVaultKey = offlineVaultKey): Promise<any> {
  if (!key) throw new Error('Offline vault is locked.')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(base64ToBytes(record?.iv || '')) },
    key,
    asArrayBuffer(base64ToBytes(record?.encrypted_payload || '')),
  )
  return JSON.parse(new TextDecoder().decode(decrypted))
}

async function requestOfflinePersistentStorage(): Promise<{ supported: boolean; persistent: boolean; estimate?: StorageEstimate | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return { supported: false, persistent: false }
  const persistent = await navigator.storage.persist().catch(() => false)
  const estimate = await navigator.storage.estimate?.().catch(() => null)
  return { supported: true, persistent: !!persistent, estimate }
}

function dispatchVaultLocked(reason = 'idle'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('offline:vault-locked', { detail: { reason, ts: Date.now() } }))
}

function scheduleOfflineVaultIdleLock(): void {
  if (typeof window === 'undefined') return
  if (offlineVaultIdleTimer != null) window.clearTimeout(offlineVaultIdleTimer)
  offlineVaultIdleTimer = window.setTimeout(() => lockOfflineVault('idle'), OFFLINE_VAULT_IDLE_LOCK_MS)
}

function lockOfflineVault(reason = 'manual'): void {
  offlineVaultKey = null
  offlineVaultUnlockedAt = 0
  if (typeof window !== 'undefined' && offlineVaultIdleTimer != null) window.clearTimeout(offlineVaultIdleTimer)
  offlineVaultIdleTimer = null
  dispatchVaultLocked(reason)
}

async function unlockOfflineVault(pin: unknown): Promise<AnyRecord> {
  if (!String(pin || '').trim()) throw new Error('PIN is required to unlock offline mode.')
  const offlineDb = await getOfflineDb()
  let saltRow = await offlineDb.offline_vault.get('device_salt').catch(() => null)
  if (!saltRow?.value) {
    saltRow = {
      key: 'device_salt',
      value: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
      status: 'active',
      updated_at: new Date().toISOString(),
    }
    await offlineDb.offline_vault.put(saltRow)
  }
  offlineVaultKey = await deriveOfflineVaultKey(pin, saltRow.value)
  offlineVaultUnlockedAt = Date.now()
  scheduleOfflineVaultIdleLock()
  const storage = await requestOfflinePersistentStorage()
  await offlineDb.offline_vault.put({
    key: 'storage_status',
    value: storage,
    status: storage.persistent ? 'persistent' : 'eviction_possible',
    updated_at: new Date().toISOString(),
  }).catch(() => {})
  return { success: true, unlocked: true, storage }
}

async function queueBusinessOutboxOperation(operation: OfflineOperation = {}): Promise<AnyRecord> {
  const operation_id = String(operation.operation_id || operation.type || '').trim()
  if (!operation_id) throw new Error('Offline operation id is required.')
  if (!offlineVaultKey) {
    dispatchVaultLocked('queue_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const offlineDb = await getOfflineDb()
  const now = new Date().toISOString()
  const payload = operation.payload || {}
  const encrypted = await encryptOfflineVaultValue(payload)
  const payload_digest = await sha256Hex(payload)
  const id = operation.id || operation.client_request_id || `business_outbox_operation_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await offlineDb.sync_outbox.put({
    id,
    client_request_id: operation.client_request_id || id,
    operation_id,
    schema_version: Number(operation.schema_version || 1),
    base_updated_at: operation.base_updated_at || operation.updated_at || now,
    status: 'pending',
    created_at: now,
    updated_at: now,
    retry_at: null,
    entity_table: operation.entity_table || operation.entity || '',
    entity_id: operation.entity_id || payload.id || null,
    entity_label: operation.entity_label || payload.name || operation_id,
    payload_digest,
    encrypted_payload: encrypted.encrypted_payload,
    iv: encrypted.iv,
    business_outbox_operation: true,
  })
  registerOutboxBackgroundSync()
  emitSyncQueueChanged({ reason: 'business_outbox_operation', operation_id })
  return { success: true, queued: true, id, payload_digest }
}

async function queueOfflineFileChunks(file: File, ownerOperation: OfflineFileOwner = {}): Promise<AnyRecord> {
  if (!file?.slice) throw new Error('A file is required for offline file sync.')
  if (!offlineVaultKey) {
    dispatchVaultLocked('file_queue_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const offlineDb = await getOfflineDb()
  const upload_id = ownerOperation.upload_id || `offline_file_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const chunkCount = Math.ceil(Number(file.size || 0) / OFFLINE_FILE_CHUNK_SIZE)
  const wholeBytes = new Uint8Array(await file.arrayBuffer())
  const fileSha256 = await sha256Hex(wholeBytes)
  const createdAt = new Date().toISOString()
  const manifest = {
    upload_id,
    file_name: file.name || 'offline-upload.bin',
    mime: file.type || '',
    size: Number(file.size || wholeBytes.byteLength || 0),
    sha256: fileSha256,
    chunk_count: chunkCount,
    chunk_size: OFFLINE_FILE_CHUNK_SIZE,
    owner_operation_id: ownerOperation.operation_id || '',
    created_at: createdAt,
  }
  const encryptedManifest = await encryptOfflineVaultValue(manifest)
  await offlineDb.offline_file_chunks.put({
    upload_id,
    chunk_index: -1,
    status: 'manifest',
    created_at: createdAt,
    updated_at: createdAt,
    payload_digest: await sha256Hex(manifest),
    encrypted_payload: encryptedManifest.encrypted_payload,
    iv: encryptedManifest.iv,
  })
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * OFFLINE_FILE_CHUNK_SIZE
    const chunk = wholeBytes.slice(start, start + OFFLINE_FILE_CHUNK_SIZE)
    const encrypted = await encryptOfflineVaultValue({ chunk: bytesToBase64(chunk), chunk_index: index })
    await offlineDb.offline_file_chunks.put({
      upload_id,
      chunk_index: index,
      status: 'pending',
      created_at: createdAt,
      updated_at: createdAt,
      payload_digest: await sha256Hex(chunk),
      encrypted_payload: encrypted.encrypted_payload,
      iv: encrypted.iv,
    })
  }
  registerOutboxBackgroundSync()
  return { success: true, upload_id, chunkCount, sha256: fileSha256 }
}

function dispatchOutboxProgress(detail: AnyRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_PROGRESS', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function dispatchOutboxFileProgress(detail: AnyRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_FILE_PROGRESS', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function dispatchOutboxConflict(detail: AnyRecord = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_CONFLICT', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function getSyncOutboxKey(row: OfflineRow = {}): string | number | undefined {
  return row._seq ?? row.id
}

async function syncUnlockedOfflineOutbox(options: OfflineSyncOptions = {}): Promise<AnyRecord> {
  if (!offlineVaultKey) {
    dispatchVaultLocked('sync_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const offlineDb = await getOfflineDb()
  const rows = ((await offlineDb.sync_outbox.toArray().catch(() => [])) as OfflineRow[])
    .filter((row) => ['pending', 'failed', 'retry'].includes(String(row?.status || 'pending')))
    .sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')))
    .slice(0, Math.max(1, Number(options.limit || 25)))
  if (!rows.length) return { success: true, synced: 0, conflicts: 0, failed: 0 }

  const operations = []
  for (const row of rows) {
    try {
      const payload = await decryptOfflineVaultValue(row.encrypted_payload ? row : { encrypted_payload: row.encrypted_payload, iv: row.iv })
      operations.push({
        id: row.id,
        row_key: getSyncOutboxKey(row),
        client_request_id: row.client_request_id || row.id,
        operation_id: row.operation_id,
        schema_version: Number(row.schema_version || 1),
        base_updated_at: row.base_updated_at,
        entity_table: row.entity_table || '',
        entity_id: row.entity_id || null,
        payload_digest: row.payload_digest || await sha256Hex(payload),
        payload,
      })
      await offlineDb.sync_outbox.update(getSyncOutboxKey(row), {
        status: 'syncing',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    } catch (error: any) {
      await offlineDb.sync_outbox.update(getSyncOutboxKey(row), {
        status: 'integrity_failed',
        error: error?.message || 'Encrypted offline edit could not be opened.',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    }
  }
  if (!operations.length) return { success: false, synced: 0, conflicts: 0, failed: rows.length }

  dispatchOutboxProgress({ status: 'syncing', total: operations.length, completed: 0 })
  let response = null
  try {
    response = await apiFetch('POST', '/api/sync/outbox', { operations })
  } catch (error: any) {
    if (Number(error?.status || 0) === 423 || error?.code === 'system_busy') {
      for (const operation of operations) {
        await offlineDb.sync_outbox.update(operation.row_key, {
          status: 'retry',
          error: error?.message || 'System maintenance is running. Offline sync will retry.',
          retry_at: new Date(Date.now() + 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).catch(() => {})
      }
      dispatchOutboxProgress({ status: 'paused', code: 'system_busy', total: operations.length, failed: 0 })
      return { success: false, paused: true, status: 'system_busy', synced: 0, conflicts: 0, failed: 0 }
    }
    for (const operation of operations) {
      await offlineDb.sync_outbox.update(operation.row_key, {
        status: 'failed',
        error: error?.message || 'Offline sync failed.',
        retry_at: new Date(Date.now() + 30_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    }
    dispatchOutboxProgress({ status: 'failed', total: operations.length, failed: operations.length })
    return { success: false, synced: 0, conflicts: 0, failed: operations.length }
  }

  const results = Array.isArray(response?.results) ? response.results : []
  // Offline sync batches can grow into the hundreds after an extended
  // period offline; looking up each result's matching operation with
  // `.find()` was an O(operations x results) scan (they're typically
  // close to the same size), same shape as other per-item-scan fixes in
  // this project's Big-O sweep. A Map keyed by client_request_id gives
  // O(1) lookups instead.
  const operationsByClientRequestId = new Map(operations.map((operation) => [operation.client_request_id, operation]))
  let synced = 0
  let conflicts = 0
  let failed = 0
  for (const result of results) {
    const matched = operationsByClientRequestId.get(result.client_request_id)
    const id = matched?.row_key
    if (id == null) continue
    if (result.status === 'applied') {
      synced += 1
      await offlineDb.sync_outbox.update(id, {
        status: 'synced',
        server_response: result.response || null,
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    } else if (result.code === 'write_conflict' || result.status === 'conflict') {
      conflicts += 1
      await offlineDb.sync_outbox.update(id, {
        status: 'conflict',
        conflict: result,
        error: result.error || 'Server value changed.',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
      dispatchOutboxConflict({ id, result })
    } else {
      failed += 1
      await offlineDb.sync_outbox.update(id, {
        status: 'failed',
        error: result.error || result.code || 'Offline sync failed.',
        retry_at: new Date(Date.now() + 30_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    }
  }
  dispatchOutboxProgress({ status: conflicts ? 'conflict' : (failed ? 'failed' : 'synced'), total: operations.length, synced, conflicts, failed })
  return { success: failed === 0 && conflicts === 0, synced, conflicts, failed }
}

async function syncUnlockedOfflineFileChunks(options: OfflineSyncOptions = {}): Promise<AnyRecord> {
  if (!offlineVaultKey) {
    dispatchVaultLocked('file_sync_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const offlineDb = await getOfflineDb()
  const allRows = (await offlineDb.offline_file_chunks.toArray().catch(() => [])) as OfflineRow[]
  const uploadIds = [...new Set(allRows
    .filter((row) => row.status !== 'synced')
    .map((row) => row.upload_id)
    .filter((value): value is string => Boolean(value)))]
    .slice(0, Math.max(1, Number(options.limit || 5)))
  let completed = 0
  let failed = 0
  for (const uploadId of uploadIds) {
    const rows = allRows.filter((row) => row.upload_id === uploadId)
    const manifestRow = rows.find((row) => Number(row.chunk_index) === -1)
    if (!manifestRow) continue
    try {
      const manifest = await decryptOfflineVaultValue(manifestRow.encrypted_payload ? manifestRow : { encrypted_payload: manifestRow.encrypted_payload, iv: manifestRow.iv })
      dispatchOutboxFileProgress({ upload_id: uploadId, status: 'initializing', completed, total: uploadIds.length })
      await apiFetch('POST', '/api/sync/files/chunks/init', { manifest })
      const chunks = rows
        .filter((row) => Number(row.chunk_index) >= 0 && row.status !== 'synced')
        .sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index))
      for (const row of chunks) {
        const payload = await decryptOfflineVaultValue(row.encrypted_payload ? row : { encrypted_payload: row.encrypted_payload, iv: row.iv })
        const chunkBytes = base64ToBytes(payload.chunk)
        const chunkSha256 = await sha256Hex(chunkBytes)
        await apiFetch('POST', `/api/sync/files/chunks/${encodeURIComponent(uploadId)}/chunk`, {
          chunk_index: Number(row.chunk_index),
          chunk_sha256: chunkSha256,
          chunk: payload.chunk,
        })
        await offlineDb.offline_file_chunks.update(row._seq, {
          status: 'synced',
          updated_at: new Date().toISOString(),
        }).catch(() => {})
        dispatchOutboxFileProgress({ upload_id: uploadId, status: 'chunk', chunk_index: row.chunk_index, chunk_count: manifest.chunk_count })
      }
      await apiFetch('POST', `/api/sync/files/chunks/${encodeURIComponent(uploadId)}/complete`, { upload_id: uploadId })
      await offlineDb.offline_file_chunks.update(manifestRow._seq, {
        status: 'synced',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
      completed += 1
      dispatchOutboxFileProgress({ upload_id: uploadId, status: 'synced', completed, total: uploadIds.length })
    } catch (error: any) {
      failed += 1
      const paused = Number(error?.status || 0) === 423 || error?.code === 'system_busy'
      await mapOfflineFileChunkStatusUpdates(rows, (row) => offlineDb.offline_file_chunks.update(row._seq, {
        status: row.status === 'synced' ? 'synced' : (paused ? 'pending' : 'failed'),
        error: error?.message || (paused ? 'System maintenance is running. Offline file sync will retry.' : 'Offline file sync failed.'),
        updated_at: new Date().toISOString(),
      }).catch(() => {}))
      dispatchOutboxFileProgress({ upload_id: uploadId, status: paused ? 'paused' : 'failed', error: error?.message || (paused ? 'System maintenance is running.' : 'Offline file sync failed.') })
    }
  }
  return { success: failed === 0, completed, failed }
}

function refreshOfflineSnapshotSoon(force = false): void {
  if (typeof window === 'undefined') return
  if (offlineSnapshotTimer) {
    window.clearTimeout(offlineSnapshotTimer)
    offlineSnapshotTimer = 0
  }
  if (offlineSnapshotIdleId && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(offlineSnapshotIdleId)
    offlineSnapshotIdleId = 0
  }
  const run = () => {
    offlineSnapshotTimer = 0
    offlineSnapshotIdleId = 0
    if (document.visibilityState === 'hidden') {
      refreshOfflineSnapshotSoon(force)
      return
    }
    loadOfflineSnapshotTransportModule()
      .then((module) => module.refreshOfflineDeviceSnapshot({ force }))
      .catch(() => {})
  }
  const delay = force ? OFFLINE_SNAPSHOT_FORCE_DELAY_MS : OFFLINE_SNAPSHOT_IDLE_DELAY_MS
  if (typeof window.requestIdleCallback === 'function') {
    offlineSnapshotTimer = window.setTimeout(() => {
      offlineSnapshotIdleId = window.requestIdleCallback(run, { timeout: delay })
    }, delay)
    return
  }
  offlineSnapshotTimer = window.setTimeout(run, delay)
}

function refreshServiceWorkerSoon(force = false): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  const now = Date.now()
  if (!force && now - lastServiceWorkerUpdateAt < SERVICE_WORKER_UPDATE_INTERVAL_MS) return
  lastServiceWorkerUpdateAt = now
  navigator.serviceWorker.ready
    .then((registration) => registration.update?.())
    .catch(() => {})
}

function runOfflineMaintenance(force = false): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (!hasStoredUserSession()) return
  loadSaleWriteTransportModule()
    .then((module) => module.syncPendingSalesQueue({ force: true }))
    .catch(() => {})
  if (offlineVaultKey) {
    syncUnlockedOfflineOutbox({ force }).catch(() => {})
    syncUnlockedOfflineFileChunks({ force }).catch(() => {})
  }
  refreshOfflineSnapshotSoon(force)
  registerOutboxBackgroundSync()
  refreshServiceWorkerSoon(force)
}

function startOfflineMaintenanceLoop(): void {
  if (typeof window === 'undefined' || offlineMaintenanceStarted) return
  offlineMaintenanceStarted = true
  window.setInterval(() => {
    runOfflineMaintenance(false)
  }, OFFLINE_REFRESH_INTERVAL_MS)
}

function scheduleInitialOfflineMaintenance(): void {
  if (typeof window === 'undefined' || initialOfflineMaintenanceScheduled) return
  initialOfflineMaintenanceScheduled = true

  const run = () => {
    startOfflineMaintenanceLoop()
    runOfflineMaintenance(false)
  }
  const scheduleIdle = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.setTimeout(() => {
        window.requestIdleCallback(run, { timeout: INITIAL_OFFLINE_MAINTENANCE_IDLE_TIMEOUT_MS })
      }, INITIAL_OFFLINE_MAINTENANCE_DELAY_MS)
      return
    }
    window.setTimeout(run, INITIAL_OFFLINE_MAINTENANCE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    scheduleIdle()
    return
  }
  window.addEventListener('load', scheduleIdle, { once: true })
}

function ensureSessionRecoveryListeners(): void {
  if (typeof window === 'undefined' || sessionRecoveryListenersRegistered) return
  sessionRecoveryListenersRegistered = true
  window.addEventListener('online', () => {
    resumeWS()
    startHealthCheck()
    pingServerHealth(true).catch(() => {})
    runOfflineMaintenance(true)
  })
  window.addEventListener('focus', () => {
    resumeWS()
    pingServerHealth().catch(() => {})
    runOfflineMaintenance()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    resumeWS()
    pingServerHealth().catch(() => {})
    runOfflineMaintenance()
  })
  window.addEventListener('sync:reconnected', () => {
    runOfflineMaintenance(true)
  })
}

function scheduleBootstrapStorageMaintenance(task: () => void): void {
  if (typeof window === 'undefined') {
    task()
    return
  }

  const run = () => {
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(task, { timeout: BOOTSTRAP_STORAGE_MAINTENANCE_IDLE_TIMEOUT_MS })
        return
      }
      task()
    }, BOOTSTRAP_STORAGE_MAINTENANCE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    run()
    return
  }
  window.addEventListener('load', run, { once: true })
}

function scheduleBootstrapOfflineDbWrite(task: (db: any) => void | Promise<void>): void {
  if (typeof window === 'undefined') {
    getOfflineDb().then(task).catch(() => {})
    return
  }

  const run = () => {
    window.setTimeout(() => {
      const write = () => {
        if (document.visibilityState === 'hidden') return
        getOfflineDb().then(task).catch(() => {})
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(write, { timeout: BOOTSTRAP_OFFLINE_DB_WRITE_IDLE_TIMEOUT_MS })
        return
      }
      write()
    }, BOOTSTRAP_OFFLINE_DB_WRITE_DELAY_MS)
  }

  if (document.readyState === 'complete') {
    run()
    return
  }
  window.addEventListener('load', run, { once: true })
}

function forwardServiceWorkerOutboxEvent(event: MessageEvent): void {
  if (typeof window === 'undefined') return
  const type = event?.data?.type
  const detail = event?.data?.detail || {}
  if (!type || !String(type).startsWith('BUSINESS_OS_OUTBOX_')) return

  if (type === 'BUSINESS_OS_OUTBOX_SYNCED') {
    window.dispatchEvent(new CustomEvent('sync:offline-sale-synced', {
      detail: {
        channel: detail.channel || 'sales:create',
        receiptNumber: detail.entity_name || null,
        ts: detail.ts || Date.now(),
      },
    }))
    dispatchSyncUpdates(['sales', 'products', 'inventory', 'dashboard'], 'offline-background-sale-synced')
    return
  }

  if (type === 'BUSINESS_OS_OUTBOX_CONFLICT') {
    window.dispatchEvent(new CustomEvent('sync:write-conflict', {
      detail: {
        channel: detail.channel || 'sales:create',
        entity_name: detail.entity_name || null,
        refreshChannels: ['sales', 'products', 'inventory', 'dashboard'],
        ts: detail.ts || Date.now(),
      },
    }))
    return
  }

  emitSyncQueueChanged({
    reason: detail.reason || 'background-sync-waiting',
    error: detail.error || '',
    ts: detail.ts || Date.now(),
  })
}

// ?€?€ Silence Capacitor/vendor bridge noise that fires in plain web context ?€?€?€?€?€?€
// vendor.js emits "No Listener: tabs:outgoing.message.ready" as an unhandled
// rejection when Capacitor's tab-messaging bridge can't find a native listener.
// This is harmless in web-only mode.
//
// CRITICAL: useCapture=true (third arg) makes this handler run BEFORE React's
// scheduler picks up the rejection and tries to call an internal function that
// no longer exists in that error-path, which manifests as
// "TypeError: r is not a function" in minified builds.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    if (shouldSuppressRuntimeError({
      reason: e?.reason,
      message: e?.reason?.message || String(e?.reason || ''),
      stack: e?.reason?.stack,
      baseOrigin: window.location?.origin || '',
    })) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }, true /* capture phase */)

  window.addEventListener('error', (event) => {
    const message = String(event?.message || '')
    const fileName = String(event?.filename || '')
    const stack = String(event?.error?.stack || '')
    if (shouldSuppressRuntimeError({
      message,
      error: event?.error,
      filename: fileName,
      stack,
      baseOrigin: window.location?.origin || '',
    })) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)

  window.addEventListener('securitypolicyviolation', (event) => {
    if (!shouldSuppressSecurityPolicyViolation({
      violatedDirective: event?.violatedDirective,
      blockedURI: event?.blockedURI,
      sourceFile: event?.sourceFile,
      sample: event?.sample,
      baseOrigin: window.location?.origin || '',
    })) return
    event.stopImmediatePropagation()
  }, true)
}

// ---- Synchronous window.api installation ----
// The service worker's 'message' listener below is attached at module load,
// unconditionally -- so the underlying BUSINESS_OS_APP_UPDATE_AVAILABLE
// postMessage is never missed at the browser API level. But the re-dispatched
// 'sync:app-update-available' window CustomEvent IS a fire-and-forget signal,
// and the only consumer (App.tsx's useSyncStatus effect) only attaches its
// listener while a user is logged in. If the SW activates a new version while
// the tab is sitting on the login screen (or between logout and the next
// login), the event fires into a void with no listener, and the "Update Now"
// banner would silently never appear -- the user keeps running the stale
// in-memory JS bundle indefinitely even though the SW has already claimed the
// page under the new version. Buffer the most recent detail here so any
// consumer that mounts later (e.g. right after login) can pick up a
// already-fired update instead of losing it.
let pendingAppUpdateDetail: Record<string, unknown> | null = null

function forwardServiceWorkerAppEvent(event: MessageEvent): void {
  if (typeof window === 'undefined') return
  if (event?.data?.type !== 'BUSINESS_OS_APP_UPDATE_AVAILABLE') return
  const detail = event?.data?.detail || {}
  pendingAppUpdateDetail = detail
  window.dispatchEvent(new CustomEvent('sync:app-update-available', { detail }))
}

const staticApi = {
  login: getAuthTransportMethod('login'),
  logout: getAuthTransportMethod('logout'),
  resetPasswordWithOtp: getAuthTransportMethod('resetPasswordWithOtp'),
  requestPasswordResetEmail: getAuthTransportMethod('requestPasswordResetEmail'),
  completePasswordReset: getAuthTransportMethod('completePasswordReset'),
  updateSessionDuration: getAuthTransportMethod('updateSessionDuration'),
  getVerificationCapabilities: getAuthTransportMethod('getVerificationCapabilities'),
  otpSetup: getAuthTransportMethod('otpSetup'),
  otpConfirm: getAuthTransportMethod('otpConfirm'),
  otpDisable: getAuthTransportMethod('otpDisable'),
  otpVerify: getAuthTransportMethod('otpVerify'),
  otpStatus: getAuthTransportMethod('otpStatus'),
  startGoogleOauth: getAuthTransportMethod('startGoogleOauth'),
  completeGoogleOauth: getAuthTransportMethod('completeGoogleOauth'),
  unlinkGoogleOauth: getAuthTransportMethod('unlinkGoogleOauth'),
  getOrganizationBootstrap: getAuthTransportMethod('getOrganizationBootstrap'),
  searchOrganizations: getAuthTransportMethod('searchOrganizations'),
  getCurrentOrganization: getAuthTransportMethod('getCurrentOrganization'),
  getPortalConfig: getPortalTransportMethod('getPortalConfig'),
  getPortalBootstrap: getPortalTransportMethod('getPortalBootstrap'),
  getPortalCatalogMeta: getPortalTransportMethod('getPortalCatalogMeta'),
  getPortalCatalogProducts: getPortalTransportMethod('getPortalCatalogProducts'),
  searchPortalCatalogProducts: getPortalTransportMethod('searchPortalCatalogProducts'),
  lookupPortalMembership: getPortalTransportMethod('lookupPortalMembership'),
  createPortalSubmission: getPortalTransportMethod('createPortalSubmission'),
  getPortalAiStatus: getPortalTransportMethod('getPortalAiStatus'),
  askPortalAi: getPortalTransportMethod('askPortalAi'),
  getPortalSubmissionsForReview: getPortalTransportMethod('getPortalSubmissionsForReview'),
  reviewPortalSubmission: getPortalTransportMethod('reviewPortalSubmission'),
  getSystemConfig: getSystemRuntimeMethod('getSystemConfig'),
  getSystemBootstrap: getSystemRuntimeMethod('getSystemBootstrap'),
  getSystemDebugLog: getSystemRuntimeMethod('getSystemDebugLog'),
  testSyncServer: getSystemRuntimeMethod('testSyncServer'),

  setSyncServerUrl(url: unknown) {
    const clean = sanitizeSyncServerUrl(url)
    const previousSyncServerUrl = getSyncServerUrl()
    const syncServerChanged = previousSyncServerUrl !== clean
    setSyncServerUrl(clean)
    if (clean) {
      if (syncServerChanged) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.put({ key: 'sync_server_url', value: clean }))
        cacheClearAll()   // flush stale in-memory cache whenever the server URL changes
      }
      if (hasStoredUserSession()) {
        ensureSessionRecoveryListeners()
        scheduleConnectWS()
        startHealthCheck()
      }
      if (syncServerChanged && hasStoredUserSession()) {
        scheduleInitialOfflineMaintenance()
      }
    } else {
      if (syncServerChanged) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.delete('sync_server_url'))
        disconnectWS()
      }
    }
  },

  getSyncServerUrl() {
    return getSyncServerUrl()
  },

  setPublicAssetBaseUrl(url: unknown) {
    const clean = sanitizeBaseUrl(url)
    try {
      if (clean) localStorage.setItem(STORAGE_KEYS.PUBLIC_ASSET_BASE_URL, clean)
      else localStorage.removeItem(STORAGE_KEYS.PUBLIC_ASSET_BASE_URL)
    } catch (_) {}
    return clean
  },

  getPublicAssetBaseUrl() {
    try {
      return sanitizeBaseUrl(localStorage.getItem(STORAGE_KEYS.PUBLIC_ASSET_BASE_URL) || '')
    } catch (_) {
      return ''
    }
  },

  async getAppBootstrap() {
    const module = await loadAppBootstrapModule()
    return module.getAppBootstrap()
  },

  async getNotificationSummary() {
    const module = await loadNotificationSummaryModule()
    return module.getNotificationSummary()
  },

  // Synchronous, not async: this reads an in-memory buffer, not IndexedDB, so
  // there is no reason to make callers await a microtask for it. See the
  // pendingAppUpdateDetail comment above forwardServiceWorkerAppEvent for why
  // this buffer exists.
  getPendingAppUpdate() {
    return pendingAppUpdateDetail
  },

  clearPendingAppUpdate() {
    pendingAppUpdateDetail = null
  },

  async getPendingSyncState() {
    const db = await getOfflineDb()
    const rows = await db.sync_queue
      .orderBy('_seq')
      .toArray()
      .catch(() => [])
    const sorted = [...rows].sort((left, right) => {
      const byCreated = String(left?.created_at || '').localeCompare(String(right?.created_at || ''))
      if (byCreated !== 0) return byCreated
      return Number(left?._seq || 0) - Number(right?._seq || 0)
    }) as OfflineRow[]
    const counts = sorted.reduce((acc, item) => {
      const status = String(item?.status || 'pending')
      acc.total += 1
      if (status === 'syncing') acc.syncing += 1
      else if (status === 'conflict') acc.conflict += 1
      else if (status === 'failed') acc.failed += 1
      else acc.pending += 1
      return acc
    }, { total: 0, pending: 0, syncing: 0, failed: 0, conflict: 0 })
    return {
      ...counts,
      oldest_created_at: sorted[0]?.created_at || null,
      writes_require_server: true,
      items: serializePendingSyncPreview(sorted),
    }
  },

  async retryPendingSyncNow() {
    const module = await loadSaleWriteTransportModule()
    return module.syncPendingSalesQueue({ force: true })
  },

  async refreshOfflineDeviceSnapshot(options: unknown = {}) {
    const module = await loadOfflineSnapshotTransportModule()
    return module.refreshOfflineDeviceSnapshot(options as Record<string, unknown>)
  },

  async getSettings(options: unknown = {}) {
    const module = await loadSettingsTransportModule()
    return module.getSettings(options as Record<string, unknown>)
  },

  async saveSettings(updates: unknown = {}, options: unknown = {}) {
    const module = await loadSettingsTransportModule()
    return module.saveSettings(updates as Record<string, unknown>, options as Record<string, unknown>)
  },

  async getProducts() {
    const module = await loadProductReadTransportModule()
    return module.getProducts()
  },

  async searchProducts(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.searchProducts(params as ProductQueryParams)
  },

  async getProductBootstrap(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductBootstrap(params as ProductQueryParams)
  },

  async getProductsByIds(ids: unknown[] = [], params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductsByIds(ids, params as ProductQueryParams)
  },

  async getProductFilters(params: unknown = {}) {
    const module = await loadProductReadTransportModule()
    return module.getProductFilters(params as ProductQueryParams)
  },

  async getProductLookupUsage() {
    const module = await loadProductReadTransportModule()
    return module.getProductLookupUsage()
  },

  async createProduct(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.createProduct(payload as Record<string, unknown>)
  },

  async updateProduct(id: unknown, payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.updateProduct(id as string | number, payload as Record<string, unknown>)
  },

  async deleteProduct(id: unknown) {
    const module = await loadProductWriteTransportModule()
    return module.deleteProduct(id as string | number)
  },

  async createProductVariant(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.createProductVariant(payload as Record<string, unknown>)
  },

  async bulkImportProducts(payload: unknown = {}) {
    const module = await loadProductWriteTransportModule()
    return module.bulkImportProducts(payload as Record<string, unknown>)
  },

  async getCategories() {
    const module = await loadLookupTransportModule()
    return module.getCategories()
  },

  async getUnits() {
    const module = await loadLookupTransportModule()
    return module.getUnits()
  },

  async getBranches() {
    const module = await loadBranchTransportModule()
    return module.getBranches()
  },

  async getNotes() {
    const module = await loadNotesTransportModule()
    return module.getNotes()
  },

  async createNote(payload: unknown = {}) {
    const module = await loadNotesTransportModule()
    return module.createNote(payload as Parameters<NotesTransportModule['createNote']>[0])
  },

  async updateNote(id: unknown, payload: unknown = {}) {
    const module = await loadNotesTransportModule()
    return module.updateNote(id as number, payload as Parameters<NotesTransportModule['updateNote']>[1])
  },

  async deleteNote(id: unknown) {
    const module = await loadNotesTransportModule()
    return module.deleteNote(id as number)
  },

  async getUsers() {
    const module = await loadUserReadTransportModule()
    return module.getUsers()
  },

  async getActionHistory(scope: unknown = 'global', limit: unknown = 10, params: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.getActionHistory(
      scope as string | number,
      limit as string | number,
      params as Parameters<ActionHistoryTransportModule['getActionHistory']>[2],
    )
  },

  async getActionHistoryUsers() {
    const module = await loadActionHistoryTransportModule()
    return module.getActionHistoryUsers()
  },

  async createActionHistory(payload: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.createActionHistory(payload as Record<string, unknown>)
  },

  async updateActionHistory(id: unknown, payload: unknown = {}) {
    const module = await loadActionHistoryTransportModule()
    return module.updateActionHistory(id as string | number, payload as Record<string, unknown>)
  },

  async undoActionHistory(id: unknown) {
    const module = await loadActionHistoryTransportModule()
    return module.undoActionHistory(id as string | number)
  },

  async redoActionHistory(id: unknown) {
    const module = await loadActionHistoryTransportModule()
    return module.redoActionHistory(id as string | number)
  },

  setSyncToken(token: unknown) {
    const clean = String(token || '').trim()
    setSyncToken('')
    try {
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
    } catch (_) {}
    getOfflineDb().then((db) => db.settings.delete('sync_token')).catch(() => {})
    if (clean) {
      console.warn('[web-api] Sync token support has been retired in favor of user sign-in sessions.')
    }
  },

  useSessionSyncToken(token: unknown) {
    staticApi.setSyncToken(token)
  },

  ensureSessionRecoveryListeners,

  unlockOfflineVault,
  lockOfflineVault,
  getOfflineVaultState() {
    return {
      unlocked: !!offlineVaultKey,
      unlockedAt: offlineVaultUnlockedAt,
      idleLockMs: OFFLINE_VAULT_IDLE_LOCK_MS,
    }
  },
  queueBusinessOutboxOperation,
  queueOfflineFileChunks,
  syncUnlockedOfflineOutbox,
  syncUnlockedOfflineFileChunks,
  requestOfflinePersistentStorage,
  getCallLog,
  clearCallLog,
}

window.api = new Proxy(staticApi, {
  get(target, prop, receiver) {
    if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
    if (typeof prop !== 'string') return undefined
    return getLazyApiMethod(prop)
  },
})

if (typeof window !== 'undefined') {
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerOutboxEvent)
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerAppEvent)
  window.addEventListener('beforeunload', () => lockOfflineVault('tab_close'))
}

// ---- Bootstrap: read stored token, auto-detect server URL from page origin ----
// KEY FIX: When not in Vite dev mode the page is served BY the Cloudflare
// Worker (cloudflare/ -- there is no separate backend process anymore), so
// the current origin is always the correct API/WS server, regardless of any
// stale URL that may be saved in localStorage from a previous session or a
// different device (e.g. localhost saved when first run locally, but accessed
// via Cloudflare on another device). We use the current origin immediately,
// then persist it after first paint so storage writes do not compete with
// startup.
;(async () => {
  try {
    const isViteDev = location.hostname === 'localhost' &&
      (location.port === '5173' || location.port === '5174')
    const skipOfflineBootstrapDb = isPublicRuntimePath()

    scheduleBootstrapStorageMaintenance(() => {
      try {
        localStorage.removeItem('businessos_auth_token')
        sessionStorage.removeItem('businessos_auth_token')
        localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
        sessionStorage.removeItem('businessos_sync_token_session')
      } catch (_) {}
    })
    if (!skipOfflineBootstrapDb) {
      scheduleBootstrapOfflineDbWrite((db) => db.settings.delete('sync_token'))
    }

    // Determine the correct sync server URL
    let url = ''
    if (!isViteDev) {
      // Served by the Cloudflare Worker -- current origin IS the server. Always use it.
      url = sanitizeSyncServerUrl(location.origin)
      scheduleBootstrapStorageMaintenance(() => {
        try { localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, url) } catch (_) {}
      })
      if (!skipOfflineBootstrapDb) {
        scheduleBootstrapOfflineDbWrite((db) => db.settings.put({ key: 'sync_server_url', value: url }))
      }
    } else {
      // Vite dev -- use stored value (localhost:8787 for wrangler local
      // dev), falling back to the PRODUCTION admin origin (user, Part 388:
      // "default leangbeauty.com and admin.leangbeauty.com") so a fresh
      // checkout talks to the real server until someone points it
      // elsewhere on the Server page.
      url = sanitizeSyncServerUrl(localStorage.getItem(STORAGE_KEYS.SYNC_SERVER) || '')
      if (!skipOfflineBootstrapDb) {
        try {
          const db = await getOfflineDb()
          const stored = await db.settings.bulkGet(['sync_server_url'])
          if (!url && stored[0]?.value) url = sanitizeSyncServerUrl(stored[0].value)
        } catch (_) {}
      }
      if (!url) url = sanitizeSyncServerUrl('https://admin.leangbeauty.com')
    }

    if (url) {
      setSyncServerUrl(url)
      if (hasStoredUserSession()) {
        ensureSessionRecoveryListeners()
        scheduleConnectWS()
        startHealthCheck()
        scheduleInitialOfflineMaintenance()
      }
    }
  } catch (e: any) {
    console.warn('[web-api] Bootstrap error:', e.message)
  }
})()
