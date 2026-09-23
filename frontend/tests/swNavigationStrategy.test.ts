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

async function runTestAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
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
    assert.match(body, /(?:const|let) cached = await cache\.match\('\/index\.html'\) \|\| await cache\.match\('\/'\)/, 'must read the cache before touching the network')
    assert.match(body, /if \(cached\) \{/, 'must branch on a cache hit')
    const cacheHitBranch = body.slice(body.indexOf('if (cached) {'), body.indexOf('return cached') + 'return cached'.length)
    assert.doesNotMatch(cacheHitBranch, /await fetch/, 'a cache hit must not await the network -- that is exactly the round-trip lag this fix removes')
    assert.match(cacheHitBranch, /event\.waitUntil\(revalidate\)/, 'the network refresh must run in the background via waitUntil, not block the response')
  })

  runTest(`only the real app shell overwrites the cached shell (${label})`, () => {
    const body = functionBody(source, 'async function appShellFallback', 'async function cacheFirstStatic')
    assert.match(body, /await isAppShellDocument\(response\)/, 'a Cloudflare Access/login redirect, an app error page or a 200 challenge interstitial must not overwrite a good cached shell')
  })

  runTest(`every write of the cached shell goes through the one shell-content check (${label})`, () => {
    // Part 628 ticket 2: a 200 challenge interstitial passes
    // isValidDocumentResponse. One writer left on that check is enough to
    // store it as the shell, so none may be: recovery, revalidation, cache
    // miss and stale-asset refresh all write /index.html, and each write must
    // sit directly behind the body check.
    const writes = [...source.matchAll(/cache\.put\('\/index\.html'/g)]
    assert.equal(writes.length, 4, 'recovery, revalidation, cache miss and stale-asset refresh -- a new writer needs the same gate')
    for (const write of writes) {
      const lead = source.slice(Math.max(0, write.index - 120), write.index)
      assert.match(lead, /if \(await isAppShellDocument\(\w+\)\)\s*\{?\s*await $/, `unguarded shell write: ...${lead.slice(-80)}`)
    }
    const install = functionBody(source, 'async function precacheAppShell', 'async function cacheNamesToRetain')
    assert.match(install, /url === '\/' \|\| url === '\/index\.html'\s*\?\s*await isAppShellDocument\(response\)/, 'install admits / and /index.html through the same check')
  })

  runTest(`the navigation handler passes the request event through (${label})`, () => {
    assert.match(source, /event\.respondWith\(appShellFallback\(request, event\)\)/, 'appShellFallback needs the event to call waitUntil on the background revalidation')
  })

  runTest(`every cacheable static path (not just hashed chunks) is cache-first (${label})`, () => {
    assert.doesNotMatch(source, /function isHashedBuildAsset/, 'the hashed/unhashed split is gone')
    assert.doesNotMatch(source, /function networkFirstStatic/, 'networkFirstStatic is dead now that its only caller was removed')
    assert.match(source, /if \(!isCacheableStaticPath\(url\.pathname\)\)[\s\S]{0,20}return[;\s]*\n[\s\S]{0,700}event\.respondWith\(cacheFirstStatic\(request, event\)\)/, 'the dispatcher must send every cacheable static path through cacheFirstStatic')
  })

  runTest(`a redirected response is never stored as the shell, and never served as one (${label})`, () => {
    // Owner (Sep 17): "the response served by the service worker has
    // redirections". Serving a response whose `redirected` flag is set to a
    // NAVIGATION request is a network error by spec -- the page is blank, and
    // because the poisoned entry is in the cache, it is blank on every reload.
    // cache.add() follows redirects and stores the result flag and all, so the
    // install path is where it got in.
    const guard = functionBody(source, 'function isValidDocumentResponse', 'function isValidStaticResponse')
    const isValid = new Function(`${guard}
return isValidDocumentResponse`)() as (response: unknown) => boolean
    const res = (over: Record<string, unknown>) =>
      ({ ok: true, type: 'basic', redirected: false, headers: new Headers({ 'content-type': 'text/html' }), ...over })
    assert.equal(isValid(res({})), true, 'a plain 200 shell is what the cache is for')
    assert.equal(
      isValid(res({ redirected: true })),
      false,
      'a redirected response is exactly the one that blanks the page -- it must never be stored or served',
    )
    assert.equal(isValid(res({ ok: false })), false, 'an error page must not become the shell')
    assert.equal(isValid(res({ type: 'opaqueredirect' })), false, 'a Cloudflare Access hop must not become the shell')
    assert.equal(isValid(undefined), false, 'no response at all is not a shell')

    const install = functionBody(source, 'async function precacheAppShell', 'async function cacheNamesToRetain')
    // The prose above the fix names cache.add(); only the CODE must be free of it.
    const installCode = install.split(String.fromCharCode(10)).filter((line) => !line.trim().startsWith('//')).join(String.fromCharCode(10))
    assert.doesNotMatch(
      installCode,
      /cache\.add\(/,
      'cache.add() follows redirects and stores them -- the install path must fetch and check first',
    )
    assert.match(install, /await isAppShellDocument\(response\)/, 'the install path must apply the guard')

    // The fix must also HEAL the devices already holding a poisoned entry:
    // they cannot reach the app to accept an update, so nothing else will.
    const body = functionBody(source, 'async function appShellFallback', 'async function fetchAndCacheShell')
    assert.match(
      body,
      /if \(cached && !isValidDocumentResponse\(cached\)\) \{[\s\S]{0,200}cache\.delete\('\/index\.html'\)[\s\S]{0,200}cache\.delete\('\/'\)/,
      'a cached shell that cannot answer a navigation must be dropped, not served again',
    )
    // Part 628 ticket 1: and dropping it leaves a plain cache miss, so a
    // recovery navigation still goes out as a navigation below -- not as the
    // worker-context read of /index.html this branch used to return.
    assert.match(body, /cache\.delete\('\/'\)[\s\S]{0,40}cached = undefined/, 'the dropped entry must fall through as a cache miss')
  })
  runTest(`a chunk the deploy deleted refreshes the cached shell before the response returns (${label})`, () => {
    const body = functionBody(source, 'async function cacheFirstStatic', 'function isStaleBuildAsset')
    assert.match(body, /else if \(isStaleBuildAsset\(request, response\)\) \{[\s\S]{0,40}await recoverStaleShell\(event\)/, 'the network-miss branch must await the shell recovery on a stale asset')
    const guard = functionBody(source, 'function isStaleBuildAsset', 'async function recoverStaleShell')
    assert.match(guard, /startsWith\('\/assets\/'\)/, 'only hashed build assets count -- icons and manifests are unhashed')
    // Sep 17 outage: wrangler.toml sets not_found_handling =
    // "single-page-application", so a chunk the deploy deleted is NOT a 404 --
    // the asset layer answers with index.html at status 200 and the page dies
    // on "Expected a JavaScript-or-Wasm module script". Recognising only the
    // 404 is what left every cached shell unable to recover, and this test
    // used to pin that. Run the real function against both shapes instead of
    // matching its text, so the wrong implementation and the right one
    // actually disagree here.
    const isStale = new Function('self', `${guard}
return isStaleBuildAsset`)({ location: { origin: 'https://admin.example.com' } }) as
      (request: { url: string }, response: unknown) => boolean
    const res = (status: number, contentType: string) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? contentType : null) },
    })
    const chunk = { url: 'https://admin.example.com/assets/AdminRoot-AyyEAtBX.js' }
    assert.equal(isStale(chunk, res(404, 'text/plain')), true, 'a 404 on a chunk is still a stale build')
    assert.equal(isStale(chunk, res(200, 'text/html; charset=utf-8')), true, 'the SPA fallback answering a chunk with HTML is the shape that actually happens')
    assert.equal(isStale(chunk, res(200, 'text/javascript')), false, 'a real chunk must never be treated as stale')
    assert.equal(isStale(chunk, res(500, 'text/html')), false, 'a server error is not evidence that the build moved on')
    assert.equal(
      isStale({ url: 'https://admin.example.com/index.html' }, res(200, 'text/html')),
      false,
      'the app shell itself is HTML by definition -- only /assets/ counts',
    )
    const recover = functionBody(source, 'async function recoverStaleShell', "self.addEventListener('fetch'")
    assert.match(recover, /caches\.open\(APP_SHELL_CACHE\)/, 'the shell cache is what goes stale')
    assert.match(recover, /fetch\('\/index\.html', \{ cache: 'no-store' \}\)/, 'the fresh shell must bypass HTTP caches')
    assert.match(recover, /await isAppShellDocument\(response\)/, 'a redirect, error page or challenge interstitial must not replace the shell')
    const release = functionBody(source, 'async function releaseNewBuildForRecovery', 'async function recoverStaleShell')
    assert.match(release, /self\.registration\.update\(\)/, 'the new worker must still be requested, not left to the periodic check')
    // Sep 23: update() re-fetches /sw.js. Awaiting it here held the 404 the
    // page is blocked on for a whole round trip, spent against the lazy
    // import timeout. Requesting the new worker is a background concern.
    assert.match(recover, /event\.waitUntil\(releaseNewBuildForRecovery\(\)\)/, 'the new-worker request runs off the response path')
    assert.doesNotMatch(recover, /await releaseNewBuildForRecovery/, 'and is never awaited before the 404 returns')
    assert.match(recover, /event\.waitUntil\(refresh\)[\s\S]{0,20}await refresh/, 'the SHELL refresh is still awaited so the reload that follows sees the fresh shell')
  })
}

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  await runTestAsync(`migration uses direct incumbent capability, never cache poisoning as authority (${label})`, async () => {
    const probe = functionBody(source, 'function validShellVersion', 'async function readIncumbentVersion')
    const ask = new Function(`${probe};return probeIncumbent`)()
    const reply = (data: unknown) => ({ postMessage: (_: unknown, ports: MessagePort[]) => ports[0].postMessage(data) })
    const valid = { type: 'BUSINESS_OS_APP_VERSION', version: 'business-os-app-shell-old' }
    assert.deepEqual(await ask(reply(valid)), { version: valid.version, legacy: true })
    for (const shellPolicy of [1, 2, null, 'unknown']) assert.deepEqual(await ask(reply({ ...valid, shellPolicy })), { version: valid.version, legacy: false })
    assert.equal(await ask(reply({ ...valid, version: '../private' })), null)
    assert.equal(await ask(reply({ ...valid, type: 'wrong' })), null)
    assert.equal(await ask({ postMessage() {} }), null, 'silent incumbent has bounded timeout')
    const install = functionBody(source, "self.addEventListener('install'", "self.addEventListener('activate'")
    assert.match(install, /identity\?\.legacy && self\.registration\.active === incumbent/)
    assert.doesNotMatch(install, /priorShellIsUnservable/)
  })
}
if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All swNavigationStrategy tests passed')
}
