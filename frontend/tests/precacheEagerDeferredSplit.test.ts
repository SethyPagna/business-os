import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 5: the pre-fix service worker precached EVERY generated build
// asset (274 assets / 7.92 MB at the time this was measured) synchronously
// during install, so a new build saturated a cellular/iOS connection before
// the app shell could even finish activating -- the same "takes a while to
// load, completed etc" lag fix 4 addressed for navigations, but for the
// precache pass instead. Now only the app shell, entry chunks, the active
// language packs and the routes an offline POS needs (POS route chunks) are
// precached synchronously at install; everything else is precached in the
// background AFTER activation, at a lower concurrency, never blocking
// install/activate/clients.claim().
//
// No DOM/ServiceWorker runtime is available in this harness, so this is a
// source-assertion test in the project's existing style (see
// tests/swNavigationStrategy.test.ts, tests/hotRowMemoBoundaries.test.ts).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const viteConfig = readFrontend('vite.config.ts')
const swSource = readFrontend('src/public-runtime/service-worker.ts')
const builtSw = readFrontend('public/sw.js')

runTest('vite.config.ts computes an eager precache chunk set from the existing route-preload lists', () => {
  assert.match(viteConfig, /const eagerPrecacheChunkNames = \[\.\.\.new Set\(\[/, 'must reuse a chunk-name list, not invent a new classification mechanism')
  assert.match(viteConfig, /\.\.\.routePreloadChunkNames\.admin,/, 'the app shell chunks must be eager')
  assert.match(viteConfig, /\.\.\.routePreloadChunkNames\.pos,/, 'the POS route chunks must be eager so an offline POS keeps working after an update')
  assert.match(viteConfig, /'lang-en',/, 'the English language pack must be eager')
  assert.match(viteConfig, /'lang-km',/, 'the Khmer language pack must be eager -- both packs, not an English-only fast path')
  // I6-2: generic 'vendor' left the admin preload list, so it has to be named
  // here or receipt printing and QR codes would stop working offline.
  const eagerListStart = viteConfig.indexOf('const eagerPrecacheChunkNames')
  const eagerList = viteConfig.slice(eagerListStart, viteConfig.indexOf('])]', eagerListStart))
  assert.match(eagerList, /^\s*'vendor',\r?$/m, 'the print/QR vendor chunk must stay in the eager offline set')
})

runTest('vite.config.ts emits eager and deferred asset lists in the precache manifest, entry chunks always eager', () => {
  assert.match(viteConfig, /toRoutePreloadFiles\(bundle, eagerPrecacheChunkNames\)/, 'the manifest must reuse toRoutePreloadFiles, not a new bundle-walking helper')
  assert.match(viteConfig, /output\.isEntry/, 'entry chunks must always be classified eager, matching the hard install gate')
  assert.match(viteConfig, /eager: eagerAssetUrls,/, 'the manifest JSON must carry the eager list')
  assert.match(viteConfig, /deferred: deferredAssetUrls,/, 'the manifest JSON must carry the deferred list')
  // Positive control: the pre-fix manifest had only a flat `assets` list with
  // no split at all.
  assert.doesNotMatch(viteConfig, /source: JSON\.stringify\(\{ hash: buildHash, assets: offlineAssetUrls \}, null, 2\)/, 'the pre-fix flat unsplit manifest literal must be gone')
})

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  runTest(`precacheAppShell only synchronously precaches the eager set at install (${label})`, () => {
    assert.match(source, /const eagerAssets = Array\.isArray\(precachePayload\?\.eager\)/, 'must read the eager list from the manifest')
    assert.match(source, /const deferredAssets = Array\.isArray\(precachePayload\?\.deferred\)/, 'must read the deferred list from the manifest')
    assert.match(source, /const optionalEagerAssets = \[\.\.\.new Set\(eagerAssets\.filter/, 'only the eager set (minus the already-required entry assets) is awaited during install')
    // Positive control: the pre-fix code awaited ALL generated assets
    // (`generatedAssets.filter(...)`) inside install, not just the eager
    // subset -- this is exactly the "saturates the connection at install"
    // behaviour the fix removes.
    assert.doesNotMatch(source, /const optionalAssets = \[\.\.\.new Set\(generatedAssets\.filter/, 'the pre-fix all-assets-at-install precache must be gone')
  })

  runTest(`the remaining (deferred) assets are stashed for after activation, not awaited during install (${label})`, () => {
    assert.match(source, /pendingDeferredAssets = \[\.\.\.new Set\(deferredAssets\.filter/, 'the deferred assets must be queued, not precached inline')
    const precacheAppShellBody = source.slice(source.indexOf('async function precacheAppShell'), source.indexOf('async function cacheNamesToRetain'))
    assert.doesNotMatch(precacheAppShellBody, /mapWithConcurrency\(deferredAssets/, 'precacheAppShell itself must never await the deferred set -- that would put it right back on the install-blocking path')
  })

  runTest(`a low-concurrency background pass precaches the deferred assets after activate, without blocking it (${label})`, () => {
    assert.match(source, /const DEFERRED_PRECACHE_CONCURRENCY = 2/, 'the deferred pass must run at lower concurrency than the install-time precache')
    assert.match(source, /async function precacheDeferredAssets\(\)/, 'a dedicated deferred-precache function must exist')
    assert.match(source, /mapWithConcurrency\(assets, DEFERRED_PRECACHE_CONCURRENCY, \(url\) => cacheVerifiedStaticAsset\(staticCache, url\)\)/, 'the deferred pass must reuse the existing soft-fail asset caching helper, not a new one')
    // It must be triggered from activate, but NOT be part of activate's
    // event.waitUntil (that would delay clients.claim() and the update
    // broadcast for optional, not-yet-visited route chunks).
    const activateBlock = source.slice(source.indexOf("addEventListener('activate'"), source.indexOf("addEventListener('sync'"))
    assert.match(activateBlock, /precacheDeferredAssets\(\)\.catch\(\(\) => \{\s*\}\);?/, 'activate must kick off the deferred pass')
    const waitUntilBody = activateBlock.slice(activateBlock.indexOf('event.waitUntil((async'), activateBlock.indexOf('})())'))
    assert.doesNotMatch(waitUntilBody, /precacheDeferredAssets/, 'the deferred pass must run OUTSIDE the waitUntil that gates clients.claim(), or a slow background precache would delay taking over existing tabs')
  })
}

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All precacheEagerDeferredSplit tests passed')
}
