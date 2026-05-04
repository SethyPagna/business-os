/**
 * Business OS offline app shell service worker.
 *
 * This caches only the application shell and static build assets. API calls,
 * uploads, and user media always go to the live server or fail so business data
 * cannot be silently replaced by stale HTTP responses.
 */

const APP_SHELL_CACHE = 'business-os-app-shell-v1'
const STATIC_CACHE = 'business-os-static-v4'
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icon.png']
const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
const DB_NAME = 'BusinessOS'
const OFFLINE_AUTH_SESSION_TOKEN_KEY = 'offline_auth_session_token'
const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const RETRY_DELAY_MS = 30_000

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

async function replayQueuedSale(db, row, base, authToken) {
  await putQueueRow(db, row, { status: 'syncing', error: null })
  const headers = {
    'Content-Type': 'application/json',
    'bypass-tunnel-reminder': 'true',
  }
  headers['x-auth-session'] = authToken
  const response = await fetch(`${base}/api/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row.payload || {}),
  })
  const text = await response.text().catch(() => '')
  const payload = (() => { try { return JSON.parse(text) } catch (_) { return null } })()
  const status = Number(response.status || 0)

  if (response.ok) {
    await deleteQueueRow(db, row)
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', {
      channel: row.channel,
      entity_name: row.entity_name || payload?.receiptNumber || payload?.receipt_number || null,
    })
    return true
  }

  if (status === 409) {
    await putQueueRow(db, row, {
      status: 'conflict',
      retry_at: null,
      conflict: true,
      reason: 'server_newer_version',
      error: payload?.error || text || 'Server has a newer version. Review before syncing.',
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
      error: payload?.error || text || 'Sign in again before background sync can continue.',
    })
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_AUTH_REQUIRED', { channel: row.channel })
    return false
  }

  throw new Error(payload?.error || text || `Sync failed with HTTP ${status || 'error'}`)
}

async function syncOutbox() {
  let db = null
  try {
    db = await openBusinessDb()
    const base = String(await readSetting(db, 'sync_server_url') || self.location.origin || '').replace(/\/$/, '')
    const authToken = String(await readSetting(db, OFFLINE_AUTH_SESSION_TOKEN_KEY) || '').trim()
    if (!base || !authToken) {
      broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
        reason: authToken ? 'server_required' : 'auth_required',
      })
      return
    }

    const rows = await readQueuedSales(db)
    const dueRows = rows.filter((row) => {
      const retryAt = row.retry_at ? Date.parse(row.retry_at) : 0
      return !Number.isFinite(retryAt) || retryAt <= Date.now()
    })
    for (const row of dueRows) {
      try {
        await replayQueuedSale(db, row, base, authToken)
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
