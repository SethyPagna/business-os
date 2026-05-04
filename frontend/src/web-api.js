/**
 * web-api.js ??Browser API bootstrap.
 *
 * FIX: window.api is now installed SYNCHRONOUSLY via static imports.
 * The original used a dynamic import() which is async ??this caused
 * AppContext's polling loop to sometimes run before window.api existed,
 * leaving the app stuck on the loading screen.
 *
 * Architecture:
 *   api/http.js      ??apiFetch, route(), read cache
 *   api/websocket.js ??WebSocket connection manager
 *   api/localDb.js   ??Dexie (IndexedDB) schema + helpers
 *   api/methods.js   ??all domain API methods
 */

import { apiFetch, setSyncServerUrl, setSyncToken, getCallLog, clearCallLog, startHealthCheck, cacheClearAll } from './api/http.js'
import { connectWS, disconnectWS, reconnectWS } from './api/websocket.js'
import { dexieDb }                 from './api/localDb.js'
import * as methods                from './api/methods.js'
import { STORAGE_KEYS }            from './constants.js'
import { sanitizeSyncServerUrl }   from './platform/runtime/clientRuntime.js'
import {
  shouldSuppressRuntimeError,
  shouldSuppressSecurityPolicyViolation,
} from './runtime/runtimeErrorClassifier.mjs'

const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
const OFFLINE_REFRESH_INTERVAL_MS = 5 * 60_000
const SERVICE_WORKER_UPDATE_INTERVAL_MS = 15 * 60_000
const OFFLINE_VAULT_IDLE_LOCK_MS = 15 * 60_000
const OFFLINE_FILE_CHUNK_SIZE = 1024 * 1024
let offlineMaintenanceStarted = false
let lastServiceWorkerUpdateAt = 0
let offlineVaultKey = null
let offlineVaultUnlockedAt = 0
let offlineVaultIdleTimer = null

function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index])
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function deriveOfflineVaultKey(pin, saltBase64) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pin || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltBase64), iterations: 250_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptOfflineVaultValue(value, key = offlineVaultKey) {
  if (!key) throw new Error('Offline vault is locked.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value ?? null))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { iv: bytesToBase64(iv), encrypted_payload: bytesToBase64(encrypted) }
}

async function decryptOfflineVaultValue(record, key = offlineVaultKey) {
  if (!key) throw new Error('Offline vault is locked.')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record?.iv || '') },
    key,
    base64ToBytes(record?.encrypted_payload || ''),
  )
  return JSON.parse(new TextDecoder().decode(decrypted))
}

async function requestOfflinePersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return { supported: false, persistent: false }
  const persistent = await navigator.storage.persist().catch(() => false)
  const estimate = await navigator.storage.estimate?.().catch(() => null)
  return { supported: true, persistent: !!persistent, estimate }
}

function dispatchVaultLocked(reason = 'idle') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('offline:vault-locked', { detail: { reason, ts: Date.now() } }))
}

function scheduleOfflineVaultIdleLock() {
  if (typeof window === 'undefined') return
  window.clearTimeout(offlineVaultIdleTimer)
  offlineVaultIdleTimer = window.setTimeout(() => lockOfflineVault('idle'), OFFLINE_VAULT_IDLE_LOCK_MS)
}

function lockOfflineVault(reason = 'manual') {
  offlineVaultKey = null
  offlineVaultUnlockedAt = 0
  if (typeof window !== 'undefined') window.clearTimeout(offlineVaultIdleTimer)
  dispatchVaultLocked(reason)
}

async function unlockOfflineVault(pin) {
  if (!String(pin || '').trim()) throw new Error('PIN is required to unlock offline mode.')
  let saltRow = await dexieDb.offline_vault.get('device_salt').catch(() => null)
  if (!saltRow?.value) {
    saltRow = {
      key: 'device_salt',
      value: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
      status: 'active',
      updated_at: new Date().toISOString(),
    }
    await dexieDb.offline_vault.put(saltRow)
  }
  offlineVaultKey = await deriveOfflineVaultKey(pin, saltRow.value)
  offlineVaultUnlockedAt = Date.now()
  scheduleOfflineVaultIdleLock()
  const storage = await requestOfflinePersistentStorage()
  await dexieDb.offline_vault.put({
    key: 'storage_status',
    value: storage,
    status: storage.persistent ? 'persistent' : 'eviction_possible',
    updated_at: new Date().toISOString(),
  }).catch(() => {})
  return { success: true, unlocked: true, storage }
}

async function queueBusinessOutboxOperation(operation = {}) {
  const operation_id = String(operation.operation_id || operation.type || '').trim()
  if (!operation_id) throw new Error('Offline operation id is required.')
  if (!offlineVaultKey) {
    dispatchVaultLocked('queue_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const now = new Date().toISOString()
  const payload = operation.payload || {}
  const encrypted = await encryptOfflineVaultValue(payload)
  const payload_digest = await sha256Hex(payload)
  const id = operation.id || operation.client_request_id || `business_outbox_operation_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await dexieDb.sync_outbox.put({
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
  window.dispatchEvent(new CustomEvent('sync:queue-changed', {
    detail: { reason: 'business_outbox_operation', operation_id, ts: Date.now() },
  }))
  return { success: true, queued: true, id, payload_digest }
}

async function queueOfflineFileChunks(file, ownerOperation = {}) {
  if (!file?.slice) throw new Error('A file is required for offline file sync.')
  if (!offlineVaultKey) {
    dispatchVaultLocked('file_queue_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
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
  await dexieDb.offline_file_chunks.put({
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
    await dexieDb.offline_file_chunks.put({
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

function dispatchOutboxProgress(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_PROGRESS', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function dispatchOutboxFileProgress(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_FILE_PROGRESS', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function dispatchOutboxConflict(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('BUSINESS_OS_OUTBOX_CONFLICT', {
    detail: { ts: Date.now(), ...detail },
  }))
}

function getSyncOutboxKey(row = {}) {
  return row._seq ?? row.id
}

async function syncUnlockedOfflineOutbox(options = {}) {
  if (!offlineVaultKey) {
    dispatchVaultLocked('sync_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const rows = (await dexieDb.sync_outbox.toArray().catch(() => []))
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
      await dexieDb.sync_outbox.update(getSyncOutboxKey(row), {
        status: 'syncing',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    } catch (error) {
      await dexieDb.sync_outbox.update(getSyncOutboxKey(row), {
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
  } catch (error) {
    if (Number(error?.status || 0) === 423 || error?.code === 'system_busy') {
      for (const operation of operations) {
        await dexieDb.sync_outbox.update(operation.row_key, {
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
      await dexieDb.sync_outbox.update(operation.row_key, {
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
  let synced = 0
  let conflicts = 0
  let failed = 0
  for (const result of results) {
    const matched = operations.find((operation) => operation.client_request_id === result.client_request_id)
    const id = matched?.row_key
    if (id == null) continue
    if (result.status === 'applied') {
      synced += 1
      await dexieDb.sync_outbox.update(id, {
        status: 'synced',
        server_response: result.response || null,
        updated_at: new Date().toISOString(),
      }).catch(() => {})
    } else if (result.code === 'write_conflict' || result.status === 'conflict') {
      conflicts += 1
      await dexieDb.sync_outbox.update(id, {
        status: 'conflict',
        conflict: result,
        error: result.error || 'Server value changed.',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
      dispatchOutboxConflict({ id, result })
    } else {
      failed += 1
      await dexieDb.sync_outbox.update(id, {
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

async function syncUnlockedOfflineFileChunks(options = {}) {
  if (!offlineVaultKey) {
    dispatchVaultLocked('file_sync_requires_unlock')
    return { success: false, locked: true, status: 'vault_locked' }
  }
  scheduleOfflineVaultIdleLock()
  const allRows = await dexieDb.offline_file_chunks.toArray().catch(() => [])
  const uploadIds = [...new Set(allRows.filter((row) => row.status !== 'synced').map((row) => row.upload_id).filter(Boolean))]
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
        await dexieDb.offline_file_chunks.update(row._seq, {
          status: 'synced',
          updated_at: new Date().toISOString(),
        }).catch(() => {})
        dispatchOutboxFileProgress({ upload_id: uploadId, status: 'chunk', chunk_index: row.chunk_index, chunk_count: manifest.chunk_count })
      }
      await apiFetch('POST', `/api/sync/files/chunks/${encodeURIComponent(uploadId)}/complete`, { upload_id: uploadId })
      await dexieDb.offline_file_chunks.update(manifestRow._seq, {
        status: 'synced',
        updated_at: new Date().toISOString(),
      }).catch(() => {})
      completed += 1
      dispatchOutboxFileProgress({ upload_id: uploadId, status: 'synced', completed, total: uploadIds.length })
    } catch (error) {
      failed += 1
      const paused = Number(error?.status || 0) === 423 || error?.code === 'system_busy'
      await Promise.all(rows.map((row) => dexieDb.offline_file_chunks.update(row._seq, {
        status: row.status === 'synced' ? 'synced' : (paused ? 'pending' : 'failed'),
        error: error?.message || (paused ? 'System maintenance is running. Offline file sync will retry.' : 'Offline file sync failed.'),
        updated_at: new Date().toISOString(),
      }).catch(() => {})))
      dispatchOutboxFileProgress({ upload_id: uploadId, status: paused ? 'paused' : 'failed', error: error?.message || (paused ? 'System maintenance is running.' : 'Offline file sync failed.') })
    }
  }
  return { success: failed === 0, completed, failed }
}

function registerOutboxBackgroundSync() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  navigator.serviceWorker.ready
    .then((registration) => {
      if (registration?.sync?.register) {
        registration.sync.register(OUTBOX_SYNC_TAG).catch(() => {})
      }
      registration?.active?.postMessage({ type: 'BUSINESS_OS_SYNC_NOW' })
    })
    .catch(() => {})
}

function refreshOfflineSnapshotSoon(force = false) {
  if (typeof window === 'undefined') return
  const run = () => {
    methods.refreshOfflineDeviceSnapshot?.({ force }).catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 5000 })
    return
  }
  window.setTimeout(run, 1500)
}

function refreshServiceWorkerSoon(force = false) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  const now = Date.now()
  if (!force && now - lastServiceWorkerUpdateAt < SERVICE_WORKER_UPDATE_INTERVAL_MS) return
  lastServiceWorkerUpdateAt = now
  navigator.serviceWorker.ready
    .then((registration) => registration.update?.())
    .catch(() => {})
}

function runOfflineMaintenance(force = false) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  methods.retryPendingSyncNow?.().catch(() => {})
  if (offlineVaultKey) {
    syncUnlockedOfflineOutbox({ force }).catch(() => {})
    syncUnlockedOfflineFileChunks({ force }).catch(() => {})
  }
  refreshOfflineSnapshotSoon(force)
  registerOutboxBackgroundSync()
  refreshServiceWorkerSoon(force)
}

function startOfflineMaintenanceLoop() {
  if (typeof window === 'undefined' || offlineMaintenanceStarted) return
  offlineMaintenanceStarted = true
  window.setInterval(() => {
    runOfflineMaintenance(false)
  }, OFFLINE_REFRESH_INTERVAL_MS)
}

function forwardServiceWorkerOutboxEvent(event) {
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
    ;['sales', 'products', 'inventory', 'dashboard'].forEach((channel) => {
      window.dispatchEvent(new CustomEvent('sync:update', {
        detail: { channel, reason: 'offline-background-sale-synced', ts: Date.now() },
      }))
    })
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

  window.dispatchEvent(new CustomEvent('sync:queue-changed', {
    detail: {
      reason: detail.reason || 'background-sync-waiting',
      error: detail.error || '',
      ts: detail.ts || Date.now(),
    },
  }))
}

// ?? Silence Capacitor/vendor bridge noise that fires in plain web context ??????
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

// ?? Synchronous window.api installation ??????????????????????????????????????
function forwardServiceWorkerAppEvent(event) {
  if (typeof window === 'undefined') return
  if (event?.data?.type !== 'BUSINESS_OS_APP_UPDATE_AVAILABLE') return
  window.dispatchEvent(new CustomEvent('sync:app-update-available', {
    detail: event?.data?.detail || {},
  }))
}

window.api = {

  setSyncServerUrl(url) {
    const clean = sanitizeSyncServerUrl(url)
    setSyncServerUrl(clean)
    if (clean) {
      dexieDb.settings.put({ key: 'sync_server_url', value: clean }).catch(() => {})
      cacheClearAll()   // flush stale in-memory cache whenever the server URL changes
      connectWS()
      startHealthCheck()
      runOfflineMaintenance(true)
    } else {
      dexieDb.settings.delete('sync_server_url').catch(() => {})
      disconnectWS()
    }
  },

  setSyncToken(token) {
    const clean = (token || '').trim()
    setSyncToken('')
    try {
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
    } catch (_) {}
    dexieDb.settings.delete('sync_token').catch(() => {})
    if (clean) {
      console.warn('[web-api] Sync token support has been retired in favor of user sign-in sessions.')
    }
  },

  useSessionSyncToken(token) {
    window.api.setSyncToken(token)
  },

  ...methods,
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

if (typeof window !== 'undefined') {
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerOutboxEvent)
  navigator.serviceWorker?.addEventListener?.('message', forwardServiceWorkerAppEvent)
  window.addEventListener('beforeunload', () => lockOfflineVault('tab_close'))
  window.addEventListener('online', () => {
    reconnectWS()
    startHealthCheck()
    runOfflineMaintenance(true)
  })
  window.addEventListener('focus', () => {
    connectWS()
    runOfflineMaintenance()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    connectWS()
    runOfflineMaintenance()
  })
  window.addEventListener('sync:reconnected', () => {
    runOfflineMaintenance(true)
  })
  startOfflineMaintenanceLoop()
}

// ?? Bootstrap: read stored token, auto-detect server URL from page origin ?????
// KEY FIX: When not in Vite dev mode the page is served BY the backend, so the
// current origin is always the correct API/WS server ??regardless of any stale
// URL that may be saved in localStorage from a previous session or a different
// device (e.g. localhost saved when first run locally, but accessed via Cloudflare
// on another device).  We always overwrite the stored URL with the current origin.
;(async () => {
  try {
    const isViteDev = location.hostname === 'localhost' &&
      (location.port === '5173' || location.port === '5174')

    try {
      localStorage.removeItem('businessos_auth_token')
      sessionStorage.removeItem('businessos_auth_token')
      localStorage.removeItem(STORAGE_KEYS.SYNC_TOKEN)
      sessionStorage.removeItem('businessos_sync_token_session')
      await dexieDb.settings.delete('sync_token')
    } catch (_) {}

    // Determine the correct sync server URL
    let url
    if (!isViteDev) {
      // Served by the Node backend ??current origin IS the server. Always use it.
      url = sanitizeSyncServerUrl(location.origin)
      try { localStorage.setItem('businessos_sync_server', url) } catch (_) {}
      try { await dexieDb.settings.put({ key: 'sync_server_url', value: url }) } catch (_) {}
    } else {
      // Vite dev ??use stored value (normally points to localhost:4000 backend)
      url = sanitizeSyncServerUrl(localStorage.getItem('businessos_sync_server') || '')
      try {
        const stored = await dexieDb.settings.bulkGet(['sync_server_url'])
        if (!url && stored[0]?.value) url = sanitizeSyncServerUrl(stored[0].value)
      } catch (_) {}
    }

    if (url) {
      setSyncServerUrl(url)
      connectWS()
      startHealthCheck()  // ping every 12 s so offline?nline recovery works
      runOfflineMaintenance()
    }
  } catch (e) {
    console.warn('[web-api] Bootstrap error:', e.message)
  }
})()
