// P4-4b fix 4: the service worker's navigation handler (appShellFallback)
// used to be network-first with NO timeout, so a slow-but-alive iOS
// connection made every navigation wait for the full round trip before the
// shell could even start parsing -- the owner's reported "takes a while to
// load, completed etc" lag. It is now cache-first with background
// revalidation: a cache hit answers immediately and the network refresh
// happens after, off the response path (event.waitUntil), while a genuine
// cache miss (this worker's very first navigation) still falls back to a
// live fetch. The version boundary that matters -- never serving an OLD
// build's shell under a NEW build's version -- is enforced by
// APP_SHELL_CACHE being named after this worker's own BUILD_HASH, not by
// this function, so it is unaffected by the change.
//
// The same cache-first-with-revalidation strategy now also covers every
// OTHER cacheable static path (manifest/icons/runtime-noise-guard.js/
// theme-bootstrap.js), which used to sit on networkFirstStatic and pay the
// round trip on every visit even though STATIC_CACHE is scoped per
// BUILD_HASH exactly like the hashed build chunks that were already
// cache-first.
//
// Source-assertion style (see tests/swOfflineSaleReplay.test.ts): reads both
// the TS source of truth and the compiled public/sw.js the browser actually
// registers, so a build drift between them would show up as one side red.
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const swSource = fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8')
const builtSw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `could not find ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, `could not find ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  runTest(`appShellFallback answers a cache hit without awaiting the network (${label})`, () => {
    const body = functionBody(source, 'async function appShellFallback', 'async function cacheFirstStatic')
    assert.match(body, /const cached = await cache\.match\('\/index\.html'\) \|\| await cache\.match\('\/'\)/, 'must read the cache before touching the network')
    assert.match(body, /if \(cached\) \{/, 'must branch on a cache hit')
    const cacheHitBranch = body.slice(body.indexOf('if (cached) {'), body.indexOf('return cached') + 'return cached'.length)
    assert.doesNotMatch(cacheHitBranch, /await fetch/, 'a cache hit must not await the network -- that is exactly the round-trip lag this fix removes')
    assert.match(cacheHitBranch, /event\.waitUntil\(revalidate\)/, 'the network refresh must run in the background via waitUntil, not block the response')
  })

  runTest(`only a real 200 response overwrites the cached shell (${label})`, () => {
    const body = functionBody(source, 'async function appShellFallback', 'async function cacheFirstStatic')
    assert.match(body, /response\.ok && response\.type === 'basic' && !response\.redirected/, 'a Cloudflare Access/login redirect or app error page must not overwrite a good cached shell')
  })

  runTest(`the navigation handler passes the request event through (${label})`, () => {
    assert.match(source, /event\.respondWith\(appShellFallback\(request, event\)\)/, 'appShellFallback needs the event to call waitUntil on the background revalidation')
  })

  runTest(`every cacheable static path (not just hashed chunks) is cache-first (${label})`, () => {
    assert.doesNotMatch(source, /function isHashedBuildAsset/, 'the hashed/unhashed split is gone')
    assert.doesNotMatch(source, /function networkFirstStatic/, 'networkFirstStatic is dead now that its only caller was removed')
    assert.match(source, /if \(!isCacheableStaticPath\(url\.pathname\)\)[\s\S]{0,20}return[;\s]*\n[\s\S]{0,700}event\.respondWith\(cacheFirstStatic\(request, event\)\)/, 'the dispatcher must send every cacheable static path through cacheFirstStatic')
  })

  runTest(`a 404 on a hashed /assets/ chunk refreshes the cached shell before the response returns (${label})`, () => {
    const body = functionBody(source, 'async function cacheFirstStatic', 'function isStaleBuildAsset')
    assert.match(body, /else if \(isStaleBuildAsset\(request, response\)\) \{[\s\S]{0,40}await recoverStaleShell\(event\)/, 'the network-miss branch must await the shell recovery on a stale asset')
    const guard = functionBody(source, 'function isStaleBuildAsset', 'async function recoverStaleShell')
    assert.match(guard, /response\.status !== 404/, 'only a 404 marks a stale build asset')
    assert.match(guard, /startsWith\('\/assets\/'\)/, 'only hashed build assets count -- icons and manifests are unhashed')
    const recover = functionBody(source, 'async function recoverStaleShell', "self.addEventListener('fetch'")
    assert.match(recover, /caches\.open\(APP_SHELL_CACHE\)/, 'the shell cache is what goes stale')
    assert.match(recover, /fetch\('\/index\.html', \{ cache: 'no-store' \}\)/, 'the fresh shell must bypass HTTP caches')
    assert.match(recover, /response\.ok && response\.type === 'basic' && !response\.redirected/, 'a redirect or error page must not replace the shell')
    assert.match(recover, /self\.registration\.update\(\)/, 'the new worker must be requested, not left to the periodic check')
    assert.match(recover, /event\.waitUntil\(refresh\)[\s\S]{0,20}await refresh/, 'recovery is awaited so the reload that follows sees the fresh shell')
  })
}

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All swNavigationStrategy tests passed')
}
