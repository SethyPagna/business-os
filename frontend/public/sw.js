/**
 * Business OS offline app shell service worker.
 *
 * This caches only the application shell and static build assets. API calls,
 * uploads, and user media always go to the live server or fail so business data
 * cannot be silently replaced by stale HTTP responses.
 */

const APP_SHELL_VERSION = 'business-os-app-shell-v2'
const APP_SHELL_CACHE = APP_SHELL_VERSION
const STATIC_CACHE = 'business-os-static-v5'
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icon.png']
const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
const DB_NAME = 'BusinessOS'
const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const RETRY_DELAY_MS = 30_000
const OFFLINE_FILE_CHUNK_SIZE = 1024 * 1024
const FILE_CHUNK_ENDPOINTS = {
  init: '/api/sync/files/chunks/init',
  chunk: '/api/sync/files/chunks/:uploadId/chunk',
  complete: '/api/sync/files/chunks/:uploadId/complete',
}

function openBusinessDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'))
    request.onsuccess = () => resolve(request.result)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

async function readSetting(db, key) {
  if (!db.objectStoreNames.contains('settings')) return ''
  const tx = db.transaction('settings', 'readonly')
  const row = await requestResult(tx.objectStore('settings').get(key)).catch(() => null)
  return row?.value || ''
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

async function sha256(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readQueuedBusinessOutbox(db) {
  if (!db.objectStoreNames.contains('sync_outbox')) return []
  const tx = db.transaction('sync_outbox', 'readonly')
  const rows = await requestResult(tx.objectStore('sync_outbox').getAll())
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => ['pending', 'failed', 'syncing'].includes(String(row.status || 'pending')))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

async function putBusinessOutboxRow(db, row, updates = {}) {
  if (!db.objectStoreNames.contains('sync_outbox')) return
  const tx = db.transaction('sync_outbox', 'readwrite')
  tx.objectStore('sync_outbox').put({ ...row, ...updates, updated_at: new Date().toISOString() })
  await txDone(tx)
}

async function deleteBusinessOutboxRow(db, row) {
  if (!db.objectStoreNames.contains('sync_outbox') || row?._seq == null) return
  const tx = db.transaction('sync_outbox', 'readwrite')
  tx.objectStore('sync_outbox').delete(row._seq)
  await txDone(tx)
}

async function readPendingFileChunks(db) {
  if (!db.objectStoreNames.contains('offline_file_chunks')) return []
  const tx = db.transaction('offline_file_chunks', 'readonly')
  const rows = await requestResult(tx.objectStore('offline_file_chunks').getAll())
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => ['pending', 'failed', 'manifest'].includes(String(row.status || 'pending')))
    .sort((a, b) => String(a.upload_id || '').localeCompare(String(b.upload_id || '')) || Number(a.chunk_index || 0) - Number(b.chunk_index || 0))
}

async function readQueuedSales(db) {
  if (!db.objectStoreNames.contains('sync_queue')) return []
  const tx = db.transaction('sync_queue', 'readonly')
  const store = tx.objectStore('sync_queue')
  const rows = store.indexNames.contains('channel')
    ? await requestResult(store.index('channel').getAll(OFFLINE_SALE_QUEUE_CHANNEL))
    : await requestResult(store.getAll())
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.channel === OFFLINE_SALE_QUEUE_CHANNEL && row.payload)
    .filter((row) => ['pending', 'failed', 'syncing'].includes(String(row.status || 'pending')))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

async function putQueueRow(db, row, updates = {}) {
  if (!db.objectStoreNames.contains('sync_queue')) return
  const tx = db.transaction('sync_queue', 'readwrite')
  tx.objectStore('sync_queue').put({
    ...row,
    ...updates,
    updated_at: new Date().toISOString(),
  })
  await txDone(tx)
}

async function deleteQueueRow(db, row) {
  if (!db.objectStoreNames.contains('sync_queue') || row?._seq == null) return
  const tx = db.transaction('sync_queue', 'readwrite')
  tx.objectStore('sync_queue').delete(row._seq)
  await txDone(tx)
}

function broadcastSyncEvent(type, detail = {}) {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => {
      clients.forEach((client) => client.postMessage({
        type,
        detail: { ...detail, ts: Date.now() },
      }))
    })
    .catch(() => {})
}

function nextRetryAt(row) {
  const retryCount = Math.max(0, Number(row?.retry_count || 0) + 1)
  const delay = Math.min(5 * 60_000, RETRY_DELAY_MS * Math.max(1, retryCount))
  return {
    retry_count: retryCount,
    retry_at: new Date(Date.now() + delay).toISOString(),
  }
}

async function markQueueFailure(db, row, error, reason = 'sync_failed') {
  await putQueueRow(db, row, {
    status: 'failed',
    error: error?.message || String(error || 'Sync failed'),
    reason,
    ...nextRetryAt(row),
  })
}

async function replayQueuedSale(db, row, base) {
  await putQueueRow(db, row, { status: 'syncing', error: null })
  const payload = row.payload || {}
  const operation = {
    id: row.id,
    client_request_id: row.client_request_id || row.id || `legacy_sale_${row._seq || Date.now()}`,
    operation_id: 'sales.create',
    schema_version: 1,
    base_updated_at: row.base_updated_at || row.created_at || new Date().toISOString(),
    payload_digest: await sha256(payload),
    payload,
  }
  const response = await fetch(`${base}/api/sync/outbox`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'bypass-tunnel-reminder': 'true',
    },
    body: JSON.stringify({ operations: [operation] }),
  })
  const text = await response.text().catch(() => '')
  const responsePayload = (() => { try { return JSON.parse(text) } catch (_) { return null } })()
  const status = Number(response.status || 0)

  if (response.ok) {
    await deleteQueueRow(db, row)
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', {
      channel: row.channel,
      entity_name: row.entity_name || responsePayload?.receiptNumber || responsePayload?.receipt_number || null,
    })
    return true
  }

  if (status === 409) {
    await putQueueRow(db, row, {
      status: 'conflict',
      retry_at: null,
      conflict: true,
      reason: 'server_newer_version',
      error: responsePayload?.error || text || 'Server has a newer version. Review before syncing.',
    })
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_CONFLICT', {
      channel: row.channel,
      entity_name: row.entity_name || null,
    })
    return false
  }

  if (status === 401 || status === 403) {
    await putQueueRow(db, row, {
      status: 'failed',
      retry_at: null,
      reason: 'auth_required',
      error: responsePayload?.error || text || 'Sign in again before background sync can continue.',
    })
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_AUTH_REQUIRED', { channel: row.channel })
    return false
  }

  throw new Error(responsePayload?.error || text || `Sync failed with HTTP ${status || 'error'}`)
}

async function syncOutbox() {
  let db = null
  try {
    db = await openBusinessDb()
    const base = String(await readSetting(db, 'sync_server_url') || self.location.origin || '').replace(/\/$/, '')
    if (!base) {
      broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
        reason: 'server_required',
      })
      return
    }

    const businessRows = await readQueuedBusinessOutbox(db)
    if (businessRows.some((row) => row.encrypted_payload)) {
      broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
        reason: 'vault_locked',
        error: 'Unlock the offline vault to sync encrypted offline edits.',
      })
    }
    const plaintextRows = businessRows.filter((row) => row.payload && !row.encrypted_payload)
    for (const row of plaintextRows) {
      await putBusinessOutboxRow(db, row, { status: 'syncing', error: null })
      const response = await fetch(`${base}/api/sync/outbox`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          operations: [{
            id: row.id,
            client_request_id: row.client_request_id || row.id,
            operation_id: row.operation_id,
            schema_version: row.schema_version || 1,
            base_updated_at: row.base_updated_at || row.created_at || new Date().toISOString(),
            payload_digest: row.payload_digest || await sha256(row.payload || {}),
            payload: row.payload || {},
          }],
        }),
      })
      if (response.ok) {
        await deleteBusinessOutboxRow(db, row)
        broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', { channel: row.operation_id, entity_name: row.entity_label || null })
      } else if (response.status === 409) {
        await putBusinessOutboxRow(db, row, { status: 'conflict', conflict: true, retry_at: null, reason: 'write_conflict' })
        broadcastSyncEvent('BUSINESS_OS_OUTBOX_CONFLICT', { channel: row.operation_id, entity_name: row.entity_label || null })
      } else {
        await putBusinessOutboxRow(db, row, { status: 'failed', error: `Sync failed with HTTP ${response.status}`, ...nextRetryAt(row) })
      }
    }

    const fileChunks = await readPendingFileChunks(db)
    if (fileChunks.length) {
      broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
        reason: 'file_chunks_waiting',
        chunkSize: OFFLINE_FILE_CHUNK_SIZE,
        error: 'Encrypted file chunks are queued and will sync after vault unlock.',
      })
    }

    const rows = await readQueuedSales(db)
    const dueRows = rows.filter((row) => {
      const retryAt = row.retry_at ? Date.parse(row.retry_at) : 0
      return !Number.isFinite(retryAt) || retryAt <= Date.now()
    })
    for (const row of dueRows) {
      try {
        await replayQueuedSale(db, row, base)
      } catch (error) {
        await markQueueFailure(db, row, error)
      }
    }
  } catch (error) {
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
      reason: 'sync_failed',
      error: error?.message || String(error || 'Sync failed'),
    })
  } finally {
    try { db?.close?.() } catch (_) {}
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('business-os-') && ![APP_SHELL_CACHE, STATIC_CACHE].includes(key))
        .map((key) => caches.delete(key))
    )
    await self.clients.claim()
    broadcastSyncEvent('BUSINESS_OS_APP_UPDATE_AVAILABLE', {
      version: APP_SHELL_VERSION,
      message: 'New version ready',
    })
  })())
})

self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) {
    event.waitUntil(syncOutbox())
  }
})

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'BUSINESS_OS_SYNC_NOW') {
    event.waitUntil?.(syncOutbox())
  }
  if (event?.data?.type === 'BUSINESS_OS_SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isSameOrigin(requestUrl) {
  try {
    return new URL(requestUrl).origin === self.location.origin
  } catch (_) {
    return false
  }
}

function isNeverCachedPath(pathname) {
  return pathname.startsWith('/api/')
    || pathname === '/health'
    || pathname.startsWith('/uploads/')
    || pathname.startsWith('/files/')
    || pathname.startsWith('/portal/uploads/')
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.json'
    || pathname === '/icon.png'
    || pathname === '/runtime-noise-guard.js'
    || pathname === '/theme-bootstrap.js'
}

async function appShellFallback(request) {
  const cache = await caches.open(APP_SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put('/index.html', response.clone()).catch(() => {})
    }
    return response
  } catch (error) {
    const cached = await cache.match('/index.html') || await cache.match('/')
    if (cached) return cached
    throw error
  }
}

async function networkFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)

  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (!isSameOrigin(request.url)) return

  const url = new URL(request.url)
  if (isNeverCachedPath(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(appShellFallback(request))
    return
  }

  if (!isCacheableStaticPath(url.pathname)) return
  event.respondWith(networkFirstStatic(request))
})
