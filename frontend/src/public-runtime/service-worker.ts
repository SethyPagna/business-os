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
const OFFLINE_OWNER_REVIEW_MESSAGE = 'Keep this pending sale. Sign in to its original account and server to sync it. Older unowned sales need review in the current app; do not recreate or discard them.'

// Standalone public runtime: parity-tested against offlineQueueOwnership.ts.
function normalizeOfflineSaleOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const owner = value
  if (owner.version !== 1 || !Number.isSafeInteger(owner.actor_id) || Number(owner.actor_id) <= 0) return null
  if (owner.organization_id !== null && (!Number.isSafeInteger(owner.organization_id) || Number(owner.organization_id) <= 0)) return null
  if (owner.runtime !== 'cloudflare-workers' || typeof owner.authority !== 'string') return null
  try {
    const url = new URL(owner.authority)
    if (!/^https?:$/.test(url.protocol) || url.origin !== owner.authority) return null
  } catch { return null }
  return { version: 1, actor_id: Number(owner.actor_id), organization_id: owner.organization_id, authority: owner.authority, runtime: 'cloudflare-workers' }
}

function offlineSaleOwnersMatch(left, right) {
  const a = normalizeOfflineSaleOwner(left)
  const b = normalizeOfflineSaleOwner(right)
  return Boolean(a && b && a.actor_id === b.actor_id && a.organization_id === b.organization_id && a.authority === b.authority && a.runtime === b.runtime)
}

function sameQueuedSaleRevision(left, right) {
  return Boolean(left && left._seq === right._seq && left.id === right.id && left.updated_at === right.updated_at
    && left.status === right.status && left.sync_lease === right.sync_lease
    && JSON.stringify(left.payload) === JSON.stringify(right.payload))
}

async function currentSaleReplayOwner(base) {
  const response = await fetch(`${base}/api/sync/owner`, { credentials: 'include', cache: 'no-store', redirect: 'error' })
  if (!response.ok) return null
  const owner = normalizeOfflineSaleOwner((await response.json()).owner)
  return owner?.authority === new URL(base).origin ? owner : null
}

async function saleReplayAuthorityUnchanged(db, base) {
  const current = String(await readSetting(db, 'sync_server_url') || self.location.origin || '').replace(/\/$/, '')
  return current === base
}
const OFFLINE_FILE_CHUNK_SIZE = 1024 * 1024
const PRECACHE_CONCURRENCY = 4
// P4-4b fix 5: the deferred (non-eager) chunks are never a paint-blocking or
// install-blocking gate -- they only need to be ready before the user
// happens to open that route offline -- so they run at a lower concurrency
// than the install-time precache to leave more of a constrained iOS
// connection free for whatever the user is actually doing right after an
// update installs.
const DEFERRED_PRECACHE_CONCURRENCY = 2
const CACHE_METADATA_URL = '/__business_os_cache_metadata__'
const SHELL_POLICY = 1
const INCUMBENT_METADATA_URL = '/__business_os_incumbent__'

function validShellVersion(version) {
  return typeof version === 'string' && /^business-os-app-shell-[A-Za-z0-9_-]{1,128}$/.test(version)
}

// Ask the actual active worker, not a page or the most recently created cache.
// The legacy version protocol already supports transferred reply ports.
function probeIncumbent(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    let finished = false
    const finish = (value) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      channel.port1.close()
      channel.port2.close()
      resolve(value)
    }
    const deadline = setTimeout(() => finish(null), 1500)
    channel.port1.onmessage = (event) => {
      const reply = event.data
      finish(reply?.type === 'BUSINESS_OS_APP_VERSION' && validShellVersion(reply.version)
        ? { version: reply.version, legacy: reply.shellPolicy === undefined } : null)
    }
    try { worker.postMessage({ type: 'BUSINESS_OS_APP_VERSION_REQUEST' }, [channel.port2]) }
    catch { finish(null) }
  })
}

async function readIncumbentVersion() {
  const proof = await caches.open(APP_SHELL_CACHE)
    .then((cache) => cache.match(INCUMBENT_METADATA_URL))
    .then((response) => response?.json()).catch(() => null)
  return proof?.schema === 1 && proof.current === APP_SHELL_VERSION
    && validShellVersion(proof.previous) && proof.previous !== APP_SHELL_VERSION ? proof.previous : null
}

async function retainedStaticCaches() {
  const proof = await caches.open(APP_SHELL_CACHE).then((cache) => cache.match(INCUMBENT_METADATA_URL))
    .then((response) => response?.json()).catch(() => null)
  if (proof?.schema !== 1 || proof.current !== APP_SHELL_VERSION || !validShellVersion(proof.previous)) return []
  const incumbent = proof.previous.replace('business-os-app-shell-', 'business-os-static-')
  return [incumbent, ...(Array.isArray(proof.migrationStaticCaches) ? proof.migrationStaticCaches : [])]
    .filter((name, index, names) => typeof name === 'string' && /^business-os-static-[A-Za-z0-9_-]{1,128}$/.test(name) && names.indexOf(name) === index)
}
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
  if (!['pending', 'failed', 'retry', 'syncing', 'quarantined'].includes(status)) return false
  if (status === 'syncing') {
    const claimedAt = Date.parse(String(row?.updated_at || row?.created_at || ''))
    if (Number.isFinite(claimedAt) && Date.now() - claimedAt < SYNC_LEASE_MS) return false
  }
  const retryAt = row?.retry_at ? Date.parse(String(row.retry_at)) : 0
  return !Number.isFinite(retryAt) || retryAt <= Date.now()
}

async function putQueueRow(db, row, updates = {}, tableName = 'sync_queue') {
  if (!db.objectStoreNames.contains(tableName) || row?._seq == null) return null
  const tx = db.transaction(tableName, 'readwrite')
  const done = txDone(tx)
  const store = tx.objectStore(tableName)
  let next = null
  const request = store.get(row._seq)
  request.onsuccess = () => {
    if (!sameQueuedSaleRevision(request.result, row)) return
    next = { ...request.result, ...updates, updated_at: new Date().toISOString() }
    store.put(next)
  }
  await done
  return next
}

async function deleteQueueRow(db, row) {
  if (!db.objectStoreNames.contains('sync_queue') || row?._seq == null) return false
  const tx = db.transaction('sync_queue', 'readwrite')
  const done = txDone(tx)
  const store = tx.objectStore('sync_queue')
  let deleted = false
  const request = store.get(row._seq)
  request.onsuccess = () => {
    if (!sameQueuedSaleRevision(request.result, row)) return
    store.delete(row._seq)
    deleted = true
  }
  await done
  return deleted
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

// Owner (Sep 17): "the response served by the service worker has
// redirections". That is not a warning -- it is fatal. The spec makes a
// NAVIGATION request answered with a response whose `redirected` flag is
// set a network error, so the page is blank and stays blank: the poisoned
// entry lives in the cache, and every reload serves it again.
//
// A shell response gets that flag whenever the fetch behind it followed a
// redirect -- a Cloudflare Access or login hop, a host-level rewrite, a
// trailing-slash normalisation. `cache.add()` follows redirects silently
// and stores the result, flag and all, which is how it got in.
function isValidDocumentResponse(response) {
  return isValidTransportResponse(response)
    && String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'text/html'
}

function isValidTransportResponse(response) {
  return Boolean(response && response.ok && response.type === 'basic' && !response.redirected)
}

function isValidStaticResponse(request, response) {
  if (!isValidTransportResponse(response)) return false
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

// Set by precacheAppShell() during install, consumed by precacheDeferredAssets()
// after activate. Module-scoped because the two run in different event
// handlers of the same worker instance; a fresh install always overwrites it
// before activate can read it.
let pendingDeferredAssets = []

async function precacheDeferredAssets() {
  const assets = pendingDeferredAssets
  pendingDeferredAssets = []
  if (!assets.length) return
  const staticCache = await caches.open(STATIC_CACHE)
  // Soft-fail, same as the optional assets this replaces: a missing/failed
  // deferred chunk must never throw and take the worker down -- it is only
  // ever a route the user has not visited yet.
  await mapWithConcurrency(assets, DEFERRED_PRECACHE_CONCURRENCY, (url) => cacheVerifiedStaticAsset(staticCache, url))
}

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE)
  // One missing optional icon or manifest must not strand a new worker in
  // "waiting" forever. Cache every URL independently, then require only an
  // actual navigation shell before activating. This is especially important
  // on iOS, where the install worker may get very little execution time.
  // NOT cache.add(): it follows redirects and stores the redirected response,
  // and a redirected document served for a navigation is a network error --
  // a permanently blank page (isValidDocumentResponse above says why). Fetch
  // and store only what is safe to serve back.
  await Promise.allSettled(APP_SHELL_URLS.map(async (url) => {
    const request = new Request(url, { cache: 'reload' })
    const response = await fetch(request)
    const valid = url === '/' || url === '/index.html'
      ? isValidDocumentResponse(response)
      : isValidStaticResponse(request, response)
    if (!valid) throw new Error(`Unusable shell response: ${url}`)
    await cache.put(request, response.clone())
  }))
  const shell = await cache.match('/index.html') || await cache.match('/')
  if (!isValidDocumentResponse(shell)) throw new Error('Application shell could not be cached')

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
  // P4-4b fix 5: an older/degraded manifest without eager/deferred fields
  // (a manifest fetched before this worker's own build, or a manifest a
  // future rollback serves) falls back to treating every generated asset as
  // eager -- the pre-fix behaviour -- rather than silently dropping the
  // deferred half of the app forever.
  const eagerAssets = Array.isArray(precachePayload?.eager)
    ? precachePayload.eager.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
    : generatedAssets
  const deferredAssets = Array.isArray(precachePayload?.deferred)
    ? precachePayload.deferred.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
    : []
  const staticCache = await caches.open(STATIC_CACHE)
  const requiredStartupAssets = Array.isArray(precachePayload?.required)
    ? precachePayload.required.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
    : []
  const requiredEntryAssets = [...new Set([...htmlEntryAssets, ...requiredStartupAssets])]
  const entryResults = await mapWithConcurrency(
    requiredEntryAssets,
    PRECACHE_CONCURRENCY,
    (url) => cacheVerifiedStaticAsset(staticCache, url),
  )
  if (entryResults.some((result) => result.status === 'rejected')) {
    throw new Error('Application entry assets could not be cached')
  }
  // The eager set (app shell + entry + active language packs + the routes an
  // offline POS needs) makes install take a little longer than the bare
  // shell, but still nowhere near the old "every generated chunk" precache --
  // and it must not be a hard install gate either: a single optional/missing
  // chunk should never prevent a new worker from installing on a memory- or
  // network-constrained iPhone.
  const optionalEagerAssets = [...new Set(eagerAssets.filter((url) => !requiredEntryAssets.includes(url)))]
  await mapWithConcurrency(optionalEagerAssets, PRECACHE_CONCURRENCY, (url) => cacheVerifiedStaticAsset(staticCache, url))
  await cache.put(CACHE_METADATA_URL, new Response(JSON.stringify({
    version: APP_SHELL_VERSION,
    installedAt: Date.now(),
  }), { headers: { 'Content-Type': 'application/json' } }))
  // Everything else is real but non-urgent: precached in the background after
  // activation (precacheDeferredAssets), never blocking install/activate, so
  // a fresh build does not saturate the connection before the app the user is
  // already looking at finishes loading.
  pendingDeferredAssets = [...new Set(deferredAssets.filter((url) => (
    !requiredEntryAssets.includes(url) && !optionalEagerAssets.includes(url)
  )))]
}

async function cacheNamesToRetain(keys) {
  const retained = new Set([APP_SHELL_CACHE, STATIC_CACHE])
  const previous = await readIncumbentVersion()
  // Unknown incumbent must not turn an identity timeout into draft-breaking
  // cache deletion. Timestamps can identify an abandoned waiting worker.
  if (!previous) return new Set(keys)
  for (const name of await retainedStaticCaches()) retained.add(name)
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
  const quarantine = (target) => putQueueRow(db, target, { status: 'quarantined', retry_at: null, reason: 'offline_owner_review', error: OFFLINE_OWNER_REVIEW_MESSAGE })
  const owner = normalizeOfflineSaleOwner(row.payload?.offline_owner)
  if (!owner || owner.authority !== new URL(base).origin || !await saleReplayAuthorityUnchanged(db, base)) { await quarantine(row); return false }
  const before = await currentSaleReplayOwner(base).catch(() => null)
  if (!offlineSaleOwnersMatch(owner, before)) { await quarantine(row); return false }
  const claimed = await putQueueRow(db, row, { status: 'syncing', error: null, sync_lease: crypto.randomUUID() })
  if (!claimed) return false
  row = claimed
  try {
  if (!await saleReplayAuthorityUnchanged(db, base)) { await quarantine(row); return false }
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
    redirect: 'error',
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
  const result = Array.isArray(responsePayload?.results) ? responsePayload.results.find((entry) => entry.client_request_id === operation.client_request_id && entry.operation_id === 'sales.create') : null
  const applied = response.ok && result?.status === 'applied'
    && result.response?.client_request_id === operation.client_request_id && offlineSaleOwnersMatch(owner, result.response?.offline_owner)

  if (applied) {
    const after = await currentSaleReplayOwner(base).catch(() => null)
    if (!offlineSaleOwnersMatch(owner, after) || !await saleReplayAuthorityUnchanged(db, base)) { await quarantine(row); return false }
    if (!await deleteQueueRow(db, row)) return false
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_SYNCED', {
      channel: row.channel,
      entity_name: row.entity_name || responsePayload?.receiptNumber || responsePayload?.receipt_number || null,
    })
    return true
  }

  if (status === 401 || status === 403 || result?.code === 'auth_required' || String(result?.code || '').startsWith('offline_owner_')) {
    await quarantine(row)
    return false
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

  // Anything else -- a digest rejection, a validation failure, a transient
  // error -- keeps the sale queued (markQueueFailure preserves the row with
  // backoff), so it is retried rather than silently dropped.
  throw new Error(result?.error || result?.code || responsePayload?.error || text || `Sync failed with HTTP ${status || 'error'}`)
  } catch (error) {
    // Only the exact claimed revision may be failed; never resurrect a row
    // that another runtime completed or replaced while this request waited.
    await markQueueFailure(db, row, error)
    return false
  }
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
      // Current sale admission uses sales:create in sync_queue, with its
      // owner-scoped lease and exact receipt checks above. Never send a legacy
      // generic outbox sale through the less strict generic acknowledgement.
      if (row.operation_id === 'sales.create') {
        await putQueueRow(db, row, { status: 'quarantined', retry_at: null, reason: 'offline_owner_review', error: OFFLINE_OWNER_REVIEW_MESSAGE }, 'sync_outbox')
        continue
      }
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

    // Do not replay legacy POS sales in a background event. Keep sync_queue
    // intact for explicit original-account recovery in the foreground.
  } catch (error) {
    broadcastSyncEvent('BUSINESS_OS_OUTBOX_WAITING', {
      reason: 'sync_failed',
      error: error?.message || String(error || 'Sync failed'),
    })
  } finally {
    try { db?.close?.() } catch (_) {}
  }
}

function syncOutboxOnce() {
  // Registrations/messages left by older clients must not replay ANY business
  // writes after this upgrade. Existing rows remain available for review.
  return Promise.resolve({ success: false, manual_recovery_required: true })
}

// Installation never reloads documents. Legacy shell-policy migration can
// replace the controller while old documents and drafts keep running; their
// exact incumbent static generation is retained. Normal capable upgrades wait.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Which of this generation's caches already existed. precacheAppShell
    // writes into BOTH caches before it can throw (a missing entry asset, a
    // killed iOS install), and nothing deleted the half-filled pair until some
    // later worker activated successfully -- so a phone that fails an install
    // twice carries two dead generations of storage into the next attempt,
    // which on iOS is exactly how the next install gets evicted. Delete only
    // what THIS attempt created; a same-hash reinstall must never take the
    // running worker's caches with it.
    const cacheNamesBeforeInstall = new Set(await caches.keys())
    try {
      await precacheAppShell()
    } catch (error) {
      await Promise.all([APP_SHELL_CACHE, STATIC_CACHE]
        .filter((name) => !cacheNamesBeforeInstall.has(name))
        .map((name) => caches.delete(name).catch(() => {})))
      throw error
    }
    await (await caches.open(APP_SHELL_CACHE)).delete(INCUMBENT_METADATA_URL)
    const incumbent = self.registration.active
    if (incumbent) {
      const identity = await probeIncumbent(incumbent)
      if (identity && self.registration.active === incumbent && identity.version !== APP_SHELL_VERSION) {
        const cache = await caches.open(APP_SHELL_CACHE)
        await cache.put(INCUMBENT_METADATA_URL, new Response(JSON.stringify({
          schema: 1, current: APP_SHELL_VERSION, previous: identity.version,
          // An old controller may have served newer HTML into a live draft.
          // Keep its already-existing static generations for this migration.
          migrationStaticCaches: identity.legacy ? (await caches.keys()).filter((name) => /^business-os-static-[A-Za-z0-9_-]{1,128}$/.test(name)) : [],
        }), { headers: { 'Content-Type': 'application/json' } }))
        if (self.registration.active !== incumbent) await cache.delete(INCUMBENT_METADATA_URL)
      }
      // One-time migration: legacy controllers can poison a healthy cache
      // AFTER this install. Waiting for corruption is therefore too late.
      // Take control, never reload documents or replay queued writes. Capable
      // future workers retain normal consent-based waiting.
      if (identity?.legacy && self.registration.active === incumbent && identity.version !== APP_SHELL_VERSION) {
        await self.skipWaiting()
        return
      }
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
  // Deliberately NOT inside the waitUntil above: the deferred chunks are
  // optional route assets the user has not opened yet, so this must not
  // delay clients.claim() or the update-ready broadcast. A worker killed
  // before this finishes just retries on the next activate/visit; nothing
  // here is a correctness requirement the way the app shell is.
  precacheDeferredAssets().catch(() => {})
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
  // Which build is this worker? A worker parked in 'waiting' since an
  // earlier session never re-broadcasts BUSINESS_OS_APP_UPDATE_AVAILABLE, so
  // index.tsx asks it directly and compares hashes before offering an update
  // -- without this reply it cannot tell a genuinely newer shell from the
  // build the page is already running, and would prompt for both.
  if (event?.data?.type === 'BUSINESS_OS_APP_VERSION_REQUEST') {
    event.ports?.[0]?.postMessage({ type: 'BUSINESS_OS_APP_VERSION', version: APP_SHELL_VERSION, shellPolicy: SHELL_POLICY })
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

function isAppDocumentPath(pathname) {
  // Match the app router's resource suffix rule, preserving deep SPA routes.
  // Query strings/fragments do not change whether a path is a document.
  let path
  try { path = decodeURIComponent(pathname).replace(/\/+$/g, '') || '/' } catch { return false }
  return path === '/index.html' || (!isNeverCachedPath(path)
    && !path.startsWith('/assets/') && !/\.[a-z0-9]+$/i.test(path))
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

// Every recovery reload the app issues carries __bos_reload: the nested lazy
// chunk guard (utils/lazyImport.ts), the page chunk guard (App.tsx) and the
// runtime build-mismatch reload (AppContext.tsx) all set it before navigating.
// It is the page telling this worker "the document you gave me cannot run".
function isRecoveryNavigation(request) {
  try {
    return new URL(request.url, self.location.origin).searchParams.has('__bos_reload')
  } catch (_) {
    return false
  }
}

// P4-4b: navigation used to be network-first with no timeout, so a
// slow-but-alive connection (the reported iOS lag) made every navigation
// wait for the full round trip before the shell could even start parsing.
// Serve the cached shell immediately when one exists and refresh it in the
// background instead. Canonical revalidation can fetch a newer HTML document
// while this worker still controls the tab: document and controller versions
// are intentionally distinct. Only verified HTML may replace the shell.
// BUSINESS_OS_APP_VERSION_REQUEST identifies the controller, not the document.
// Falls back
// to a live fetch (and its normal offline error) only when there is no
// cached shell yet, e.g. the very first navigation this worker serves.
async function appShellFallback(request, event) {
  const cache = await caches.open(APP_SHELL_CACHE)
  const cached = await cache.match('/index.html') || await cache.match('/')
  // A cached shell that cannot legally answer a navigation -- the redirected
  // response an older worker stored -- is dropped here rather than served.
  // Without this, a device already holding one never recovers on its own.
  if (cached && !isValidDocumentResponse(cached)) {
    await cache.delete('/index.html').catch(() => {})
    await cache.delete('/').catch(() => {})
    return fetchAndCacheShell(new Request(new URL('/index.html', self.location.origin)), cache)
  }
  // A recovery navigation says, in its own URL, that the build this worker is
  // serving is already proven broken. Answering it from APP_SHELL_CACHE hands
  // back the very document whose chunks the deploy deleted -- which is how the
  // guard spent its one allowed reload and still landed on the dead build
  // (Sep 23 incident). recoverStaleShell below tries to refresh the shell
  // first, but that refresh is a worker-context read of /index.html: an edge
  // POP still serving the previous document, a bot challenge, or any non-200
  // leaves the cache untouched, so recovery must not depend on it. Go to the
  // network for this one navigation and let the answer heal the cache; the
  // cached shell stays the fallback for a failed fetch (offline), never the
  // answer. App.tsx strips these keys on mount, so this covers one navigation.
  //
  // fetch(request) and NOT fetchAndCacheShell: any init object downgrades a
  // navigate-mode Request to 'same-origin' (Request constructor), and a
  // same-origin subresource read of the document is exactly the shape this
  // host answers with a bot challenge instead of the page. The recovery
  // navigation has to reach the origin as the navigation it is. /index.html
  // and / are served must-revalidate (frontend/public/_headers), and this URL
  // carries __bos_reload, so there is no stale HTTP-cache hit to guard.
  if (isRecoveryNavigation(request)) {
    const fresh = await fetch(request).catch(() => null)
    if (isValidDocumentResponse(fresh)) {
      await cache.put('/index.html', fresh.clone()).catch(() => {})
      return fresh
    }
  }
  if (cached) {
    const revalidate = fetch('/index.html', { cache: 'no-store' })
      .then(async (response) => {
        // Do not let a Cloudflare Access/login redirect or an app-owned HTTP
        // error overwrite a good cached shell -- only a real 200 updates it.
        if (isValidDocumentResponse(response)) {
          await cache.put('/index.html', response.clone()).catch(() => {})
        }
      })
      .catch(() => {})
    event.waitUntil(revalidate)
    return cached
  }
  return fetchAndCacheShell(request, cache)
}

async function fetchAndCacheShell(request, cache) {
  const response = await fetch(request, { cache: 'no-store' })
  if (isValidDocumentResponse(response)) {
    await cache.put('/index.html', response.clone()).catch(() => {})
  }
  return response
}

async function cacheFirstStatic(request, event) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  // An entry that is not what its own path claims to be -- the SPA fallback's
  // HTML stored under a .js key by an older worker -- is poison: serving it
  // fails the module parse on every load, forever. Drop it and go to network.
  if (cached && !isValidStaticResponse(request, cached)) {
    await cache.delete(request).catch(() => {})
    return await retainedStaticAsset(request) || fetchAndCacheStatic(request, event, cache)
  }
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

  return await retainedStaticAsset(request) || fetchAndCacheStatic(request, event, cache)
}

async function retainedStaticAsset(request) {
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !/^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)) return null
  for (const name of await retainedStaticCaches()) {
    const cache = await caches.open(name)
    const response = await cache.match(request)
    const mime = String(response?.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const validMime = url.pathname.endsWith('.css') ? mime === 'text/css' : /^(text|application)\/(javascript|ecmascript)$/.test(mime)
    if (validMime && isValidStaticResponse(request, response)) return response
  }
  return null
}

async function fetchAndCacheStatic(request, event, cache) {
  const response = await fetch(request)
  if (isValidStaticResponse(request, response)) {
    await cache.put(request, response.clone()).catch(() => {})
  } else if (isStaleBuildAsset(request, response)) {
    await recoverStaleShell(event)
    // Hand the page an honest failure instead of HTML it will try to parse as
    // a module. A network-shaped failure is what the recovery reload in
    // utils/chunkReloadGuard.ts listens for; a MIME parse error is not, which
    // is how a tab could sit blank across deploys.
    return new Response('', { status: 404, statusText: 'Stale build asset' })
  }
  return response
}

// A hashed /assets/ chunk the server no longer has means the shell that
// referenced it came from an earlier build (appShellFallback serves the
// cached shell first and only revalidates in the background). Refresh the
// cached shell before the 404 reaches the page and ask the browser for the
// new worker.
//
// This refresh is best effort, NOT the guarantee it was once described as:
// it is a worker-context read of /index.html, so an edge POP still serving
// the previous document, a bot challenge, or any non-200 leaves the cache
// exactly as stale as it was, silently. What actually makes the app's
// one-shot recovery reload (utils/chunkReloadGuard.ts) land on the current
// build is isRecoveryNavigation in appShellFallback above, which takes that
// navigation to the network instead of answering it from this cache.
function isStaleBuildAsset(request, response) {
  if (!response) return false
  const pathname = new URL(request.url, self.location.origin).pathname
  if (!pathname.startsWith('/assets/')) return false
  if (response.status === 404) return true
  // wrangler.toml sets not_found_handling = "single-page-application", so a
  // chunk the deploy deleted is NOT answered with 404: the asset layer
  // returns index.html with status 200. Recognising only the 404 is what let
  // a worker keep serving a shell whose chunks no longer exist -- the page
  // died on "Expected a JavaScript-or-Wasm module script" and the recovery
  // above never ran. The content type is the honest signal here.
  if (!response.ok) return false
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  return contentType.includes('text/html')
}

async function recoverStaleShell(event) {
  const refresh = (async () => {
    const cache = await caches.open(APP_SHELL_CACHE)
    const response = await fetch('/index.html', { cache: 'no-store' }).catch(() => null)
    if (isValidDocumentResponse(response)) {
      await cache.put('/index.html', response.clone()).catch(() => {})
    }
    await self.registration.update().catch(() => {})
    // A waiting worker normally stays parked until the user accepts Update
    // (the install handler's comment above says why). That politeness is
    // exactly wrong here: the shell this worker is serving cannot boot, so
    // there is no app left to show an Update prompt in, and nothing would
    // ever release the waiting build. Ask it to take over -- only on this
    // path, only when the running build is already proven broken.
    try {
      self.registration.waiting?.postMessage({ type: 'BUSINESS_OS_SKIP_WAITING' })
    } catch {
      // no waiting worker, or messaging unavailable -- the shell refresh
      // above is still the recovery.
    }
    await broadcastSyncEvent('BUSINESS_OS_STALE_ASSET', { build: BUILD_HASH })
  })()
  event.waitUntil(refresh)
  await refresh
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (!isSameOrigin(request.url)) return

  const url = new URL(request.url)
  if (isNeverCachedPath(url.pathname)) return

  if (request.mode === 'navigate') {
    if (!isAppDocumentPath(url.pathname)) return
    event.respondWith(appShellFallback(request, event))
    return
  }

  if (!isCacheableStaticPath(url.pathname)) return
  // P4-4b: every cacheable static path (hashed build assets AND the
  // unhashed manifest/icons/runtime-noise-guard.js/theme-bootstrap.js) is
  // now cache-first with background revalidation -- these were previously
  // split, with the unhashed set on networkFirstStatic (always paying the
  // round trip before the file could be used, even though STATIC_CACHE is
  // scoped per BUILD_HASH exactly like the app shell above, so there was no
  // staleness risk it was actually guarding against).
  event.respondWith(cacheFirstStatic(request, event))
})
