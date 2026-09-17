// Owner (Sep 17): "there seems to be circular problem, package/vite etc...
// the website can't be reached/not working."
//
// Root cause. `[assets] not_found_handling = "single-page-application"` is
// correct for app ROUTES -- /products must render the shell, not 404 -- and
// catastrophic for hashed build chunks. A deploy replaces /assets/*, and any
// client still holding an older shell (a service worker serving its cached
// index.html; an iOS PWA keeping one for days) requests a chunk that no
// longer exists and receives index.html at status 200. The browser refuses
// "Expected a JavaScript-or-Wasm module script but the server responded with
// a MIME type of text/html", the page stays blank, and BOTH recovery paths
// the app owns -- the service worker's recoverStaleShell and
// frontend/src/utils/chunkReloadGuard.ts -- were written against a 404 that
// never arrives. Measured live on admin.leangbeauty.com the same day:
// GET /assets/definitely-missing-chunk-xyz.js -> 200 text/html.
//
// A test that merely asserted "the handler exists" would pass against the
// broken build too, since the broken build also served /assets/. So this runs
// the real handler from src/index.ts against both shapes -- the fallback
// document and a genuine chunk -- where the right and wrong implementations
// disagree.
//
// Run (from cloudflare/): node scripts/test-stale-build-asset-404-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const root = path.join(__dirname, '..')
const index = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8')

// --- 1. Extract the real handler ------------------------------------------
const marker = "app.on(['GET', 'HEAD'], '/assets/*', async (c) => {"
const start = index.indexOf(marker)
assert.ok(start >= 0, 'FAIL: no /assets/* handler in src/index.ts -- a deleted chunk would answer with the SPA document again')
const bodyStart = index.indexOf('{', start + marker.length - 1)
let depth = 0
let end = -1
for (let i = bodyStart; i < index.length; i++) {
  if (index[i] === '{') depth++
  else if (index[i] === '}') {
    depth--
    if (depth === 0) { end = i; break }
  }
}
assert.ok(end > bodyStart, 'FAIL: could not read the handler body')
const handlerSource = index.slice(start + marker.indexOf('async (c) => {'), end + 1)
const handler = new Function(`return ${handlerSource}`)()

// --- 2. A fake context, exactly as thin as the handler needs ---------------
function makeResponse(status, contentType, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    headers: { get: (key) => (String(key).toLowerCase() === 'content-type' ? contentType : null) },
  }
}
function makeContext(assetResponse, { bound = true } = {}) {
  const raw = { url: 'https://admin.leangbeauty.com/assets/AdminRoot-AyyEAtBX.js' }
  return {
    env: { STATIC_ASSETS: bound ? { fetch: async () => assetResponse } : undefined },
    req: { raw },
    text: (body, status, headers) => ({ synthesized: true, body, status, headers: headers || {} }),
  }
}

// --- 3. The behaviour ------------------------------------------------------
;(async () => {
  const fallback = await handler(makeContext(makeResponse(200, 'text/html; charset=utf-8', '<!doctype html>')))
  check('the SPA document answering a build chunk becomes an honest 404',
    fallback.synthesized === true && fallback.status === 404)
  check('that 404 is never cached, so the client re-probes after the next deploy',
    String(fallback.headers['Cache-Control'] || '').includes('no-store'))

  const chunkResponse = makeResponse(200, 'text/javascript', 'export default 1')
  const chunk = await handler(makeContext(chunkResponse))
  check('a real chunk is passed through untouched -- same object, same headers',
    chunk === chunkResponse)

  // Anything the asset layer produces that is not the fallback document is
  // its business, not ours: a revalidation and a range request must survive.
  const notModified = makeResponse(304, 'text/javascript', null)
  check('a 304 revalidation is passed through, not rewritten',
    (await handler(makeContext(notModified))) === notModified)
  const partial = makeResponse(206, 'text/javascript', 'par')
  check('a 206 range response is passed through, not rewritten',
    (await handler(makeContext(partial))) === partial)
  const serverError = makeResponse(500, 'text/html', 'error page')
  check('a 500 error page stays a 500 -- a failing origin is not evidence the build moved on',
    (await handler(makeContext(serverError))) === serverError)

  const unbound = await handler(makeContext(null, { bound: false }))
  check('a deployment with no asset binding says so instead of throwing',
    unbound.synthesized === true && unbound.status === 503)

  // --- 4. The route must actually reach the Worker ------------------------
  // A handler that wrangler never routes to the Worker is dead code: the
  // asset layer answers first and the fallback document comes back at 200.
  for (const file of ['wrangler.toml', 'wrangler.free.toml']) {
    const toml = fs.readFileSync(path.join(root, file), 'utf8')
    const list = toml.slice(toml.indexOf('run_worker_first = ['), toml.indexOf(']', toml.indexOf('run_worker_first = [')))
    check(`${file} routes /assets/* to the Worker`, /"\/assets\/\*"/.test(list))
  }

  // --- 5. Both halves of the recovery, not just this one ------------------
  // The Worker's 404 rescues clients running an OLDER service worker, which
  // already recognises a 404. The shipped worker additionally recognises the
  // HTML-for-JS shape, because a client can also be served that document
  // from its own cache with no network round trip at all.
  const sw = fs.readFileSync(path.join(root, '..', 'frontend', 'public', 'sw.js'), 'utf8')
  check("the shipped service worker also treats an HTML answer to an /assets/ request as stale",
    /contentType\.includes\('text\/html'\)/.test(sw.slice(sw.indexOf('function isStaleBuildAsset'), sw.indexOf('async function recoverStaleShell'))))

  console.log(`\nAll ${checks} checks passed.`)
})().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
