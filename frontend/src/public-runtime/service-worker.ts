/**
 * Business OS app shell service worker.
 *
 * This caches only the application shell and static build assets. API calls,
 * uploads, and user media always go to the live server or fail so business data
 * cannot be silently replaced by stale HTTP responses. Offline selling is
 * cancelled (26 Sep 2026): this worker never reads or replays queued writes.
 */

// tsconfig.sw.json typechecks this file against the WebWorker lib, whose self
// is a plain WorkerGlobalScope: no registration, clients or skipWaiting, and
// every event a bare Event. This is the scope a service worker actually runs
// in. Type-only; the emitted sw.js contains none of it.
declare const self: ServiceWorkerGlobalScope

const BUILD_HASH = '__BUSINESS_OS_BUILD_HASH__'
const APP_SHELL_VERSION = `business-os-app-shell-${BUILD_HASH}`
const APP_SHELL_CACHE = APP_SHELL_VERSION
const STATIC_CACHE = `business-os-static-${BUILD_HASH}`
const APP_SHELL_URLS = ['/', '/index.html', '/business-os-precache.json']
const STAFF_IDENTITY_URLS = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-192-maskable-v2.png', '/icon-512-maskable-v2.png', '/admin-apple-touch-icon-v1.png', '/admin-favicon-v1.ico']
const SHOP_MANIFEST_URL = '/portal-manifest.json'
// The shop's icons belong to the deployment, not to this build: their paths
// come from the identity block the Worker writes into the shell
// (cloudflare/src/lib/documentIdentity.ts). Every icon is a top-level file,
// and a shop's own icon names carry a version (-v2), so a conventional probe
// path whose bytes may change (/favicon.ico, /icon.png) is never kept.
const ROOT_ICON_PATH = /^\/[^/]+\.(?:png|ico)$/
const VERSIONED_ROOT_ICON_PATH = /^\/[^/]+-v\d+\.(?:png|ico)$/
const IDENTITY_BLOCK = /<script\b[^>]*\bid=["']business-os-identity["'][^>]*>([\s\S]*?)<\/script>/i
// The same host rule as isStaffHostname (app/clientIdentity.ts) and the
// index.html bootstrap. staffHost is the deployment's configured staff host
// (BM Shop's bm-admin.khshop.workers.dev), which only the shell's identity
// block carries: a worker cannot read the Worker's configuration.
function isAdminHost(hostname, staffHost = '') {
  const host = String(hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.startsWith('admin.')
    || (staffHost !== '' && host === staffHost)
}
function staffHostFromShell(html) {
  try {
    const staffHost = JSON.parse(IDENTITY_BLOCK.exec(html)?.[1] || '{}')?.staffHost
    return typeof staffHost === 'string' ? staffHost.toLowerCase().trim() : ''
  } catch {
    return ''
  }
}
// The install identity a host keeps beside the shell: the staff app's manifest
// and icons, or the shop's manifest and the icons its identity block names.
function identityUrlsForHost(hostname, html) {
  return isAdminHost(hostname, staffHostFromShell(html))
    ? STAFF_IDENTITY_URLS
    : [SHOP_MANIFEST_URL, ...shopIconUrlsFromShell(html)]
}
function shopIconUrlsFromShell(html) {
  let icons = {}
  try {
    icons = JSON.parse(IDENTITY_BLOCK.exec(html)?.[1] || '{}')?.shopIcons || {}
  } catch {
    icons = {}
  }
  return [...new Set(Object.values(icons).filter((url) => typeof url === 'string' && ROOT_ICON_PATH.test(url)))]
}
// How long the stale-asset recovery will wait for a newly requested build to
// finish installing before it gives up on handing control over (see
// releaseNewBuildForRecovery). Bounded so a worker stuck in its own install
// handler cannot hold a fetch event's lifetime open indefinitely.
const RECOVERY_TAKEOVER_TIMEOUT_MS = 30_000
// How long the one recovery navigation (__bos_reload) may wait on the network
// before the cached shell answers instead. An origin that accepts the
// connection and never replies -- a captive portal, a stalled radio, a hung
// edge -- is indistinguishable from a slow one until a clock says so, and
// navigator.onLine is still true, so nothing upstream refuses this reload.
// Long enough that a genuinely slow phone still gets the fresh document it
// needs (the cached shell is already proven dead, so giving up early is the
// expensive mistake here); short enough that the fallback still beats a
// browser's own navigation patience and the user never sees a blank tab.
const RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS = 8_000
const PRECACHE_CONCURRENCY = 4
// P4-4b fix 5: the deferred (non-eager) chunks are never a paint-blocking or
// install-blocking gate -- they only make a not-yet-opened staff route open
// from cache -- so they run at a lower concurrency
// than the install-time precache to leave more of a constrained iOS
// connection free for whatever the user is actually doing right after an
// update installs.
const DEFERRED_PRECACHE_CONCURRENCY = 2
const CACHE_METADATA_URL = '/__business_os_cache_metadata__'
const SHELL_POLICY = 1
const INCUMBENT_METADATA_URL = '/__business_os_incumbent__'
// The UI language whose pack the staff app last loaded. A worker cannot read
// the page's device settings, so it learns the language from the pack the page
// requests and precaches only that pack at the next install; the other pack
// stays on demand.
const UI_LANGUAGE_URL = '/__business_os_ui_language__'
const LANGUAGE_PACK_PATH = /^\/assets\/lang-([a-z]{2,3})-[A-Za-z0-9_-]{8}\.js$/

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

// Only the staff app remembers its language pack. A configured staff host
// (not admin.*) is known only from the cached shell's identity block.
async function rememberUiLanguageOnStaffHost(language) {
  const hostname = self.location.hostname
  if (!isAdminHost(hostname)) {
    const cache = await caches.open(APP_SHELL_CACHE)
    const shell = await cache.match('/index.html') || await cache.match('/')
    const html = shell ? await shell.clone().text().catch(() => '') : ''
    if (!isAdminHost(hostname, staffHostFromShell(html))) return
  }
  await rememberUiLanguage(language)
}

async function rememberUiLanguage(language) {
  const cache = await caches.open(APP_SHELL_CACHE)
  const saved = await cache.match(UI_LANGUAGE_URL).then((response) => response?.json()).catch(() => null)
  if (saved?.language === language) return
  await cache.put(UI_LANGUAGE_URL, new Response(JSON.stringify({ language, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))
}

// The newest choice across every shell generation: the incumbent's cache holds
// it while a new build installs.
async function rememberedUiLanguage() {
  const names = (await caches.keys().catch(() => [])).filter(validShellVersion)
  const saved = await Promise.all(names.map((name) => caches.open(name)
    .then((cache) => cache.match(UI_LANGUAGE_URL)).then((response) => response?.json()).catch(() => null)))
  const newest = saved.filter((entry) => typeof entry?.language === 'string' && /^[a-z]{2,3}$/.test(entry.language) && Number.isFinite(entry.at))
    .sort((a, b) => b.at - a.at)[0]
  return newest?.language || ''
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
  // A hashed font, image or other asset answered with HTML is the SPA
  // fallback, not the file. The immutable fast path in cacheFirstStatic
  // never refetches, so storing it would serve that page for the whole build.
  if (contentType.split(';')[0].trim() === 'text/html') return pathname === '/' || pathname.endsWith('.html')
  return true
}

// A same-origin 200 text/html answer passes every check above and can still
// be a page that is not this app: a Cloudflare "Just a moment..." challenge
// interstitial, a waiting-room queue. Stored as the shell, it answers every
// later navigation, offline too, where it can never pass. So every writer of
// the cached shell reads the body first and keeps only a document this app
// can boot from. id="root" is the element src/index.tsx mounts into and
// throws without ('Missing root element'), so every document that can run
// this app carries it -- the dev server's included, which loads
// /src/index.tsx rather than the built /assets/index-*.js, and this worker
// registers there too. tests/swShellContent.test.ts holds frontend/index.html
// to this check.
async function isAppShellDocument(response) {
  if (!isValidDocumentResponse(response)) return false
  return /\sid=["']root["']/.test(await response.clone().text().catch(() => ''))
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
let pendingDeferredAssets: unknown[] = []

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
  const cacheShellUrl = async (url) => {
    const request = new Request(url, { cache: 'reload' })
    const response = await fetch(request)
    const valid = url === '/' || url === '/index.html'
      ? await isAppShellDocument(response)
      : isValidStaticResponse(request, response)
    if (!valid) throw new Error(`Unusable shell response: ${url}`)
    await cache.put(request, response.clone())
  }
  await Promise.allSettled(APP_SHELL_URLS.map(cacheShellUrl))
  const shell = await cache.match('/index.html') || await cache.match('/')
  if (!shell || !isValidDocumentResponse(shell)) throw new Error('Application shell could not be cached')
  const html = await shell.clone().text().catch(() => '')
  // Which identity this host installs can depend on the configured staff
  // host, which only the shell carries, so the shell comes first.
  await Promise.allSettled(identityUrlsForHost(self.location.hostname, html).map(cacheShellUrl))

  // The worker is registered after the first page load, so those entry files
  // were fetched before this worker controlled the page. Discover the hashed
  // JS/CSS references from the cached HTML and explicitly precache them; a
  // fresh iOS install can then be terminated and reopened offline without
  // rendering an inert HTML shell.
  const htmlEntryAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'#?]+(?:\?[^"']*)?)["']/g)]
    .map((match) => match[1])
  const precacheResponse = await cache.match('/business-os-precache.json')
  const precachePayload = precacheResponse
    ? await precacheResponse.clone().json().catch(() => null)
    : null
  // Each host precaches its own plan: the storefront only its startup
  // closure, the staff host its shell plus the remembered UI language pack.
  // A manifest without host plans (a rollback, a test fixture) is one plan.
  const adminHost = isAdminHost(self.location.hostname, staffHostFromShell(html))
  const plan = precachePayload?.hosts?.[adminHost ? 'admin' : 'shop'] || precachePayload
  const assetUrls = (value) => (Array.isArray(value)
    ? value.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
    : [])
  // P4-4b fix 5: an older/degraded manifest without eager/deferred fields
  // falls back to treating every generated asset as eager -- the pre-fix
  // behaviour -- rather than silently dropping the deferred half forever.
  const eagerAssets = Array.isArray(plan?.eager) ? assetUrls(plan.eager) : assetUrls(plan?.assets)
  const deferredAssets = assetUrls(plan?.deferred)
  const staticCache = await caches.open(STATIC_CACHE)
  const requiredStartupAssets = assetUrls(plan?.required)
  const uiLanguage = adminHost ? await rememberedUiLanguage() : ''
  const languagePack = uiLanguage ? assetUrls([precachePayload?.languagePacks?.[uiLanguage]]) : []
  if (uiLanguage) await rememberUiLanguage(uiLanguage).catch(() => {})
  const requiredEntryAssets = [...new Set([...htmlEntryAssets, ...requiredStartupAssets])]
  const entryResults = await mapWithConcurrency(
    requiredEntryAssets,
    PRECACHE_CONCURRENCY,
    (url) => cacheVerifiedStaticAsset(staticCache, url),
  )
  if (entryResults.some((result) => result.status === 'rejected')) {
    throw new Error('Application entry assets could not be cached')
  }
  // The eager set (staff shell + the active language pack) must not be a hard
  // install gate: a single optional/missing chunk should never prevent a new
  // worker from installing on a memory- or network-constrained iPhone.
  const optionalEagerAssets = [...new Set([...eagerAssets, ...languagePack].filter((url) => !requiredEntryAssets.includes(url)))]
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
      // Typed here, not on probeIncumbent: tests run that function's source
      // as plain JavaScript.
      const identity = await probeIncumbent(incumbent) as { version: string, legacy: boolean } | null
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

self.addEventListener('message', (event) => {
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
    || STAFF_IDENTITY_URLS.includes(pathname)
    || pathname === SHOP_MANIFEST_URL
    || VERSIONED_ROOT_ICON_PATH.test(pathname)
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
  const cache = await caches.open(APP_SHELL_CACHE).catch(() => null)
  let cached = await cache?.match('/index.html').catch(() => undefined) || await cache?.match('/').catch(() => undefined)
  // A cached shell that cannot legally answer a navigation -- the redirected
  // response an older worker stored -- is dropped here rather than served.
  // Without this, a device already holding one never recovers on its own.
  // What is left is a plain cache miss and is handled as one below. It used
  // to answer with a worker-context read of /index.html instead, so a
  // recovery navigation on such a device never reached the origin as a
  // navigation -- the read this host answers with a bot challenge.
  if (cached && !isValidDocumentResponse(cached)) {
    await cache?.delete('/index.html').catch(() => {})
    await cache?.delete('/').catch(() => {})
    cached = undefined
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
    if (!cached) return fetchAndCacheShell(request, cache)
    // Bounded, because this is the only awaited fetch on the response path:
    // an origin that accepts the connection and never answers made
    // respondWith hang forever and the tab stayed blank -- strictly worse
    // than the stale shell this branch exists to avoid. On expiry the cached
    // shell answers, exactly as it does for a network error below.
    //
    // Only when there IS a cached shell to answer with. There is none after
    // App.tsx's page-chunk recovery (it deletes every shell cache before
    // this reload) or once a poisoned entry is dropped above, and then the
    // clock buys nothing: expiring it sent a second request through
    // fetchAndCacheShell -- init object, so same-origin, so challenged --
    // and threw away the navigation's own answer, so an origin slower than
    // the budget showed the bot challenge instead of the app. With nothing
    // to fall back to, wait for the navigation the way the browser itself
    // would without this worker.
    //
    // No AbortController: passing ANY init object (even { signal }) rebuilds
    // the Request and downgrades navigate mode to same-origin -- measured,
    // the origin sees sec-fetch-mode: same-origin -- which is the read this
    // host answers with a bot challenge instead of the page. The abandoned
    // fetch is left to the browser, which drops it when this worker goes
    // idle; keeping the navigation a navigation is worth that much more than
    // reclaiming one socket.
    const network = fetch(request).catch(() => null)
    let expireTimer
    const fresh = await Promise.race([network, new Promise<null>((resolve) => {
        expireTimer = setTimeout(() => resolve(null), RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS)
      })])
    clearTimeout(expireTimer)
    // Whatever the origin answered is what this navigation gets, exactly as
    // it would be with no worker at all; the cached shell answers only when
    // nothing did (a network failure, the budget above). The page has just
    // proven that shell dead and the guard has spent its one reload, so
    // handing it back for an answer the origin DID give is the same incident
    // by a different road. The answers that used to take that road:
    //   - a 3xx. A navigate-mode Request carries redirect: 'manual', so a host
    //     hop (HSTS, trailing slash, an edge rule, a sign-in bounce) arrives
    //     as an opaqueredirect -- status 0, ok false. Only a navigation may be
    //     answered with one, and the browser walks the hop itself. If the
    //     redirect keeps __bos_reload the follow-up re-enters this branch; if
    //     the host drops the query, the follow-up is an ordinary navigation
    //     served from cache, no worse than before.
    //   - the host's bot challenge (403 "Just a moment...", 503 on the legacy
    //     JS challenge). Shown, it clears itself and reloads this same URL,
    //     which comes back here with clearance.
    //   - an origin error page. Reloading it retries this recovery; reloading
    //     the dead shell cannot, because the guard will not reload again.
    if (fresh) {
      // Only the app itself is kept as the shell.
      if (cache && await isAppShellDocument(fresh)) await cache.put('/index.html', fresh.clone()).catch(() => {})
      return fresh
    }
  }
  if (cached) {
    const revalidate = fetch('/index.html', { cache: 'no-store' })
      .then(async (response) => {
        // Do not let a Cloudflare Access/login redirect, an app-owned HTTP
        // error or a 200 challenge interstitial overwrite a good cached
        // shell -- only the real app shell updates it.
        if (cache && await isAppShellDocument(response)) {
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
  // An init object rebuilds a navigation as a subresource Request. Preserve
  // its mode and headers; document URLs already use must-revalidate.
  const response = await fetch(request)
  if (cache && await isAppShellDocument(response)) {
    await cache.put('/index.html', response.clone()).catch(() => {})
  }
  return response
}

// vite.config.ts names every file it emits under /assets/
// `<name>-<8-character content hash>.<ext>` (chunkFileNames, entryFileNames,
// assetFileNames), so a path of that shape can only ever hold one set of
// bytes. The icons, manifests and runtime scripts in isCacheableStaticPath
// keep their names across builds and are NOT immutable.
function isImmutableBuildAsset(pathname) {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i.test(pathname)
}

async function cacheFirstStatic(request, event) {
  const cache = await caches.open(STATIC_CACHE).catch(() => null)
  const cached = await cache?.match(request).catch(() => undefined)
  // An entry that is not what its own path claims to be -- the SPA fallback's
  // HTML stored under a .js key by an older worker -- is poison: serving it
  // fails the module parse on every load, forever. Drop it and go to network.
  if (cached && !isValidStaticResponse(request, cached)) {
    await cache?.delete(request).catch(() => {})
    return await retainedStaticAsset(request) || fetchAndCacheStatic(request, event, cache)
  }
  if (cached) {
    // I6-4: content-hashed build output never changes under its URL, so the
    // cached copy already IS the network copy and a background refetch only
    // spends a request (about 40 per admin open) and a Worker invocation on
    // an edge-cache miss. A new build ships new file names, and reaches a
    // long-lived tab through the shell revalidation in appShellFallback and
    // the worker update check -- neither of which passes through here.
    if (isImmutableBuildAsset(new URL(request.url).pathname)) return cached
    const refresh = fetch(request)
      .then(async (response) => {
        if (isValidStaticResponse(request, response)) {
          await cache?.put(request, response.clone()).catch(() => {})
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
    const cache = await caches.open(name).catch(() => null)
    const response = await cache?.match(request).catch(() => undefined)
    const mime = String(response?.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const validMime = url.pathname.endsWith('.css') ? mime === 'text/css' : /^(text|application)\/(javascript|ecmascript)$/.test(mime)
    if (validMime && isValidStaticResponse(request, response)) return response
  }
  return null
}

async function fetchAndCacheStatic(request, event, cache) {
  const response = await fetch(request)
  if (isValidStaticResponse(request, response)) {
    await cache?.put(request, response.clone()).catch(() => {})
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

// A waiting worker normally stays parked until the user accepts Update (the
// install handler's comment says why). That politeness is exactly wrong on
// this one path: the shell this worker is serving cannot boot, so there is no
// app left to show an Update prompt in, and nothing would ever release the
// new build. Only here, only when the running build is already proven broken.
//
// This used to post to registration.waiting immediately after awaiting
// registration.update(), and that message almost always went nowhere: the
// spec resolves update()'s job promise once the new worker has been created
// and its install event fired, NOT after install finishes, so at that instant
// the new worker is `installing` and `waiting` is still null. That is why the
// Sep 23 incident needed a later manual navigation before the new build took
// over. Wait for the worker to actually reach 'installed'.
async function releaseNewBuildForRecovery() {
  const release = (worker) => {
    try {
      worker.postMessage({ type: 'BUSINESS_OS_SKIP_WAITING' })
    } catch (_) {
      // messaging unavailable -- the shell refresh is still the recovery
    }
  }
  await self.registration.update().catch(() => {})
  if (self.registration.waiting) return release(self.registration.waiting)
  const installing = self.registration.installing
  if (!installing) return
  if (installing.state === 'installed') return release(installing)
  if (installing.state !== 'installing') return
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(deadline)
      installing.removeEventListener('statechange', onStateChange)
      resolve(undefined)
    }
    const onStateChange = () => {
      if (installing.state === 'installed') release(installing)
      // installed / activating / activated / redundant: every exit from
      // 'installing' ends this wait, so the listener never outlives the
      // recovery it was created for.
      if (installing.state !== 'installing') finish()
    }
    // A worker that hangs in its own install handler, or a precache that
    // never finishes on a bad connection, must not hold this fetch event's
    // lifetime open for as long as the browser is willing to allow.
    const deadline = setTimeout(finish, RECOVERY_TAKEOVER_TIMEOUT_MS)
    installing.addEventListener('statechange', onStateChange)
  })
}

async function recoverStaleShell(event) {
  const refresh = (async () => {
    const cache = await caches.open(APP_SHELL_CACHE).catch(() => null)
    const response = cache ? await fetch('/index.html', { cache: 'no-store' }).catch(() => null) : null
    if (cache && response && await isAppShellDocument(response)) {
      await cache.put('/index.html', response.clone()).catch(() => {})
    }
    await broadcastSyncEvent('BUSINESS_OS_STALE_ASSET', { build: BUILD_HASH })
  })()
  // Deliberately NOT on the awaited path. registration.update() re-fetches
  // /sw.js, so awaiting it here made the page wait a full round trip -- on a
  // slow phone, seconds -- before it even learned the chunk was gone, and
  // that time is spent against the lazy-import timeout in
  // utils/lazyImport.ts. The page needs the honest 404 and the fresh shell;
  // fetching the new worker is a background concern.
  event.waitUntil(releaseNewBuildForRecovery())
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

  const language = url.pathname.match(LANGUAGE_PACK_PATH)?.[1]
  if (language) event.waitUntil(rememberUiLanguageOnStaffHost(language).catch(() => {}))
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
