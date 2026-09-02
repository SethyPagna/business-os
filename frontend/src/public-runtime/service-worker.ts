/**
 * Business OS offline app shell service worker.
 *
 * This caches only the application shell and static build assets. API calls,
 * uploads, and user media always go to the live server or fail so business data
 * cannot be silently replaced by stale HTTP responses.
 */

const BUILD_HASH = '__BUSINESS_OS_BUILD_HASH__'
const APP_SHELL_VERSION = `business-os-app-shell-${BUILD_HASH}`
const APP_SHELL_CACHE = APP_SHELL_VERSION
const STATIC_CACHE = `business-os-static-${BUILD_HASH}`
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json', '/portal-manifest.json', '/business-os-precache.json', '/icon.png', '/icon-192.png', '/icon-512.png', '/icon-192-maskable.png', '/icon-512-maskable.png', '/apple-touch-icon.png', '/leang-cosmetics-icon-192.png', '/leang-cosmetics-icon-512.png', '/leang-cosmetics-icon-192-maskable.png', '/leang-cosmetics-icon-512-maskable.png', '/leang-cosmetics-apple-touch-icon-v1.png']
const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'
const DB_NAME = 'BusinessOS'
const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const RETRY_DELAY_MS = 30_000
const SYNC_LEASE_MS = 60_000
const OFFLINE_FILE_CHUNK_SIZE = 1024 * 1024
const PRECACHE_CONCURRENCY = 4
const CACHE_METADATA_URL = '/__business_os_cache_metadata__'
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
    .filter((row) => isReplayEligible(row))
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
    .filter((row) => isReplayEligible(row))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

function isReplayEligible(row) {
  const status = String(row?.status || 'pending')
  if (!['pending', 'failed', 'retry', 'syncing'].includes(status)) return false
  if (status === 'syncing') {
    const claimedAt = Date.parse(String(row?.updated_at || row?.created_at || ''))
    if (Number.isFinite(claimedAt) && Date.now() - claimedAt < SYNC_LEASE_MS) return false
  }
  const retryAt = row?.retry_at ? Date.parse(String(row.retry_at)) : 0
  return !Number.isFinite(retryAt) || retryAt <= Date.now()
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
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => {
      clients.forEach((client) => client.postMessage({
        type,
        detail: { ...detail, ts: Date.now() },
      }))
    })
    .catch(() => {})
}

function isValidStaticResponse(request, response) {
  if (!response || !response.ok || response.type !== 'basic' || response.redirected) return false
  const pathname = new URL(request.url || request, self.location.origin).pathname.toLowerCase()
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (pathname.endsWith('.js')) return contentType.includes('javascript') || contentType.includes('ecmascript')
  if (pathname.endsWith('.css')) return contentType.includes('text/css')
  return true
}

async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0
  const results = new Array(items.length)
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function cacheVerifiedStaticAsset(cache, url) {
  const existingCacheNames = (await caches.keys()).filter((name) => (
    name.startsWith('business-os-static-') && name !== STATIC_CACHE
  ))
  for (const cacheName of existingCacheNames) {
    const prior = await caches.open(cacheName).then((candidate) => candidate.match(url)).catch(() => null)
    if (prior && isValidStaticResponse(new Request(url), prior)) {
      await cache.put(url, prior.clone())
      return
    }
  }
  const request = new Request(url, { cache: 'reload' })
  const response = await fetch(request)
  if (!isValidStaticResponse(request, response)) {
    throw new Error(`Invalid static asset response: ${url}`)
  }
  await cache.put(request, response.clone())
}

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE)
  // One missing optional icon or manifest must not strand a new worker in
  // "waiting" forever. Cache every URL independently, then require only an
  // actual navigation shell before activating. This is especially important
  // on iOS, where the install worker may get very little execution time.
  await Promise.allSettled(APP_SHELL_URLS.map((url) => (
    cache.add(new Request(url, { cache: 'reload' }))
  )))
  const shell = await cache.match('/index.html') || await cache.match('/')
  if (!shell) throw new Error('Application shell could not be cached')

  // The worker is registered after the first page load, so those entry files
  // were fetched before this worker controlled the page. Discover the hashed
  // JS/CSS references from the cached HTML and explicitly precache them; a
  // fresh iOS install can then be terminated and reopened offline without
  // rendering an inert HTML shell.
  const html = await shell.clone().text().catch(() => '')
  const htmlEntryAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'#?]+(?:\?[^"']*)?)["']/g)]
    .map((match) => match[1])
  const precacheResponse = await cache.match('/business-os-precache.json')
  const precachePayload = precacheResponse
    ? await precacheResponse.clone().json().catch(() => null)
    : null
  const generatedAssets = Array.isArray(precachePayload?.assets)
    ? precachePayload.assets.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
    : []
  const staticCache = await caches.open(STATIC_CACHE)
  const requiredEntryAssets = [...new Set(htmlEntryAssets)]
  const entryResults = await mapWithConcurrency(
    requiredEntryAssets,
    PRECACHE_CONCURRENCY,
    (url) => cacheVerifiedStaticAsset(staticCache, url),
  )
  if (entryResults.some((result) => result.status === 'rejected')) {
    throw new Error('Application entry assets could not be cached')
  }
  // Lazy route chunks make offline navigation richer, but they must not be a
  // hard install gate. A single optional/missing chunk should never prevent a
  // new worker from installing on a memory- or network-constrained iPhone.
  const optionalAssets = [...new Set(generatedAssets.filter((url) => !requiredEntryAssets.includes(url)))]
  await mapWithConcurrency(optionalAssets, PRECACHE_CONCURRENCY, (url) => cacheVerifiedStaticAsset(staticCache, url))
  await cache.put(CACHE_METADATA_URL, new Response(JSON.stringify({
    version: APP_SHELL_VERSION,
    installedAt: Date.now(),
  }), { headers: { 'Content-Type': 'application/json' } }))
}

async function cacheNamesToRetain(keys) {
  const retained = new Set([APP_SHELL_CACHE, STATIC_CACHE])
  const priorShells = keys.filter((key) => key.startsWith('business-os-app-shell-') && key !== APP_SHELL_CACHE)
  const records = await Promise.all(priorShells.map(async (name) => {
    const metadata = await caches.open(name)
      .then((cache) => cache.match(CACHE_METADATA_URL))
      .then((response) => response?.json?.())
      .catch(() => null)
    return { name, installedAt: Number(metadata?.installedAt || 0) }
  }))
  records.sort((a, b) => b.installedAt - a.installedAt)
  const previous = records[0]?.name
  if (previous) {
    retained.add(previous)
    retained.add(previous.replace('business-os-app-shell-', 'business-os-static-'))
  }
  return retained
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
  // Round-trip through JSON so the digest is computed over the SAME bytes the
  // server will re-digest from the parsed request body. A structured-clone of
  // the sale keeps undefined-valued keys (POS sets `delivery_actual_cost_usd:
  // undefined` on every non-delivery sale), but `JSON.stringify` on the wire
  // drops them -- so digesting `row.payload` directly produced a hash the
  // server could never reproduce and EVERY such sale came back
  // `payload_digest_failed`. Cleaning first makes both sides agree.
  const payload = JSON.parse(JSON.stringify(row.payload || {}))
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

  // CRITICAL: the outbox endpoint returns HTTP 200 with { success:false,
  // results:[...] } for a per-operation rejection or failure -- only a true
  // write conflict is 409. So `response.ok` is NOT proof the sale was applied.
  // Inspect the per-operation result and delete the queued sale ONLY when it
  // genuinely landed (status === 'applied'); otherwise the sale is preserved
  // and retried. Deleting on a bare 200 discarded digest-rejected/validation-
  // rejected sales as "synced" and lost the revenue with no trace.
  const result = Array.isArray(responsePayload?.results) ? responsePayload.results[0] : null
  const applied = status < 400 && (result ? result.status === 'applied' : response.ok && result === null && responsePayload?.success !== false)

  if (applied) {
    await deleteQueueRow(db, row)
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', {
      channel: row.channel,
      entity_name: row.entity_name || responsePayload?.receiptNumber || responsePayload?.receipt_number || null,
    })
    return true
  }

  if (status === 409 || result?.status === 'conflict' || result?.code === 'write_conflict') {
    await putQueueRow(db, row, {
      status: 'conflict',
      retry_at: null,
      conflict: true,
      reason: 'server_newer_version',
      error: result?.error || responsePayload?.error || text || 'Server has a newer version. Review before syncing.',
    })
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_CONFLICT', {
      channel: row.channel,
      entity_name: row.entity_name || null,
    })
    return false
  }

  if (status === 401 || status === 403 || result?.code === 'auth_required') {
    await putQueueRow(db, row, {
      status: 'failed',
      retry_at: null,
      reason: 'auth_required',
      error: result?.error || responsePayload?.error || text || 'Sign in again before background sync can continue.',
    })
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_AUTH_REQUIRED', { channel: row.channel })
    return false
  }

  // Anything else -- a digest rejection, a validation failure, a transient
  // error -- keeps the sale queued (markQueueFailure preserves the row with
  // backoff), so it is retried rather than silently dropped.
  throw new Error(result?.error || result?.code || responsePayload?.error || text || `Sync failed with HTTP ${status || 'error'}`)
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
      const responseText = await response.text().catch(() => '')
      const responsePayload = (() => { try { return JSON.parse(responseText) } catch (_) { return null } })()
      const result = Array.isArray(responsePayload?.results) ? responsePayload.results[0] : null
      const status = Number(response.status || 0)
      const applied = status < 400 && (
        result
          ? result.status === 'applied'
          : response.ok && responsePayload?.success !== false
      )
      if (applied) {
        await deleteBusinessOutboxRow(db, row)
        broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', { channel: row.operation_id, entity_name: row.entity_label || null })
      } else if (status === 409 || result?.status === 'conflict' || result?.code === 'write_conflict') {
        await putBusinessOutboxRow(db, row, { status: 'conflict', conflict: true, retry_at: null, reason: 'write_conflict' })
        broadcastSyncEvent('BUSINESS_OS_OUTBOX_CONFLICT', { channel: row.operation_id, entity_name: row.entity_label || null })
      } else if (status === 401 || status === 403 || result?.code === 'auth_required') {
        await putBusinessOutboxRow(db, row, {
          status: 'failed',
          error: result?.error || responsePayload?.error || responseText || 'Sign in again before background sync can continue.',
          retry_at: null,
          reason: 'auth_required',
        })
        broadcastSyncEvent('BUSINESS_OS_OUTBOX_AUTH_REQUIRED', { channel: row.operation_id })
      } else {
        await putBusinessOutboxRow(db, row, {
          status: 'failed',
          error: result?.error || result?.code || responsePayload?.error || responseText || `Sync failed with HTTP ${status || 'error'}`,
          ...nextRetryAt(row),
        })
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

let syncOutboxPromise = null

function syncOutboxOnce() {
  if (!syncOutboxPromise) {
    syncOutboxPromise = syncOutbox().finally(() => {
      syncOutboxPromise = null
    })
  }
  return syncOutboxPromise
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheAppShell()
    // Do not take over a live checkout or editor mid-session. Updated workers
    // wait until the user closes the old client or explicitly chooses Update;
    // the first install still activates normally because there is no incumbent.
    if (self.registration.active) {
      await broadcastSyncEvent('BUSINESS_OS_APP_UPDATE_AVAILABLE', {
        version: APP_SHELL_VERSION,
        message: 'New version ready',
        waiting: true,
      })
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    // Keep the immediately previous generation so an older, still-open tab
    // can finish a checkout or lazy import after another tab accepts Update.
    // Older generations are removed to keep iOS storage bounded.
    const retained = await cacheNamesToRetain(keys)
    await Promise.all(
      keys
        .filter((key) => key.startsWith('business-os-') && !retained.has(key))
        .map((key) => caches.delete(key))
    )
    await self.clients.claim()
    await broadcastSyncEvent('BUSINESS_OS_APP_UPDATE_AVAILABLE', {
      version: APP_SHELL_VERSION,
      message: 'New version ready',
    })
  })())
})

self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) {
    event.waitUntil(syncOutboxOnce())
  }
})

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'BUSINESS_OS_SYNC_NOW') {
    event.waitUntil?.(syncOutboxOnce())
  }
  if (event?.data?.type === 'BUSINESS_OS_SKIP_WAITING') {
    event.waitUntil?.(self.skipWaiting())
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
    || pathname === '/icon.png'
    || pathname === '/icon-192.png'
    || pathname === '/icon-512.png'
    || pathname === '/icon-192-maskable.png'
    || pathname === '/icon-512-maskable.png'
    || pathname === '/apple-touch-icon.png'
    || pathname === '/leang-cosmetics-icon-192.png'
    || pathname === '/leang-cosmetics-icon-512.png'
    || pathname === '/leang-cosmetics-icon-192-maskable.png'
    || pathname === '/leang-cosmetics-icon-512-maskable.png'
    || pathname === '/leang-cosmetics-apple-touch-icon-v1.png'
    || pathname === '/manifest.json'
    || pathname === '/portal-manifest.json'
    || pathname === '/runtime-noise-guard.js'
    || pathname === '/theme-bootstrap.js'
}

function isHashedBuildAsset(pathname) {
  return pathname.startsWith('/assets/')
}

async function appShellFallback(request) {
  const cache = await caches.open(APP_SHELL_CACHE)
  try {
    const response = await fetch(request, { cache: 'no-store' })
    const cached = await cache.match('/index.html') || await cache.match('/')
    if (response && response.ok && response.type === 'basic' && !response.redirected) {
      await cache.put('/index.html', response.clone()).catch(() => {})
      return response
    }
    // Do not hide Cloudflare Access/login redirects or app-owned HTTP errors
    // behind an old cached shell. Cached shell is only for true offline failure.
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
    const response = await fetch(request, { cache: 'no-store' })
    if (response && response.ok && response.type === 'basic' && !response.redirected) {
      await cache.put(request, response.clone()).catch(() => {})
      return response
    }
    // Returning the live error/redirect prevents stale hashed chunks from
    // masking an expired Access session or a bad deployment.
    return response
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

async function cacheFirstStatic(request, event) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) {
    const refresh = fetch(request)
      .then(async (response) => {
        if (isValidStaticResponse(request, response)) {
          await cache.put(request, response.clone()).catch(() => {})
        }
      })
      .catch(() => {})
    event.waitUntil(refresh)
    return cached
  }

  const response = await fetch(request)
  if (isValidStaticResponse(request, response)) {
    await cache.put(request, response.clone()).catch(() => {})
  }
  return response
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
  event.respondWith(isHashedBuildAsset(url.pathname)
    ? cacheFirstStatic(request, event)
    : networkFirstStatic(request))
})
