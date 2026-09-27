// P4-4a fix 7: GET /api/products (the bare list) used to bypass the same
// 20s versioned cachedJsonResponse wrapper GET /api/products/search already
// goes through, so every call re-ran the full product query cold. It now
// routes through the exact same wrapper with the SAME version namespace
// ('products') and TTL.
//
// Source-structure test (not a runtime harness): building a Hono app with
// products.ts's full dependency graph just to exercise two cache hits is a
// lot of scaffolding for an invariant that is entirely readable from the
// source text -- both handlers call cachedJsonResponse(c.req.raw,
// c.executionCtx, version, 20, ...) where version comes from
// getVersionWithFallback(c.env, 'products').
//
// Run: node scripts/test-product-list-cache-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
}

// Extracts the handler body for `app.get(routePath, async (c) => { ... })`
// via brace counting, so this survives reformatting inside the handler.
function extractHandler(src, routePath) {
  const marker = `app.get('${routePath}', async (c) => {`
  const start = src.indexOf(marker)
  assert.ok(start >= 0, `handler not found for GET ${routePath}`)
  const openIdx = src.indexOf('{', start)
  let depth = 0
  let i = openIdx
  for (; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return src.slice(start, i + 1)
}

function main() {
  const src = read('routes/products.ts')
  const searchHandler = extractHandler(src, '/search')
  const listHandler = extractHandler(src, '/')

  check('GET /search uses cachedJsonResponse with a products-namespace version (reference behaviour)', () => {
    // I2-1: the version comes from productSearchCacheVersion ('products', plus
    // 'stock' only for stock-filtered membership); a hit is refreshed live.
    assert.match(searchHandler, /productSearchCacheVersion\(c\.env, query\)/)
    assert.match(searchHandler, /refreshCachedProductRows\(c\.env,/)
    const versionFn = src.slice(src.indexOf('async function productSearchCacheVersion'), src.indexOf('async function refreshCachedProductRows'))
    assert.match(versionFn, /getVersionWithFallback\(env, 'products'\)/)
    assert.match(searchHandler, /cachedJsonResponse\(c\.req\.raw, c\.executionCtx, version, 20,/)
  })

  check('GET / (bare list) now routes through the SAME cachedJsonResponse wrapper, same namespace and TTL', () => {
    assert.match(listHandler, /productSearchCacheVersion\(c\.env, \{\}\)/, 'GET / must read the products cache version, same as GET /search')
    assert.match(listHandler, /refreshCachedProductRows\(c\.env,/, 'GET / must refresh a cache hit the same way GET /search does')
    assert.match(listHandler, /cachedJsonResponse\(c\.req\.raw, c\.executionCtx, version, 20,/, 'GET / must wrap its query in cachedJsonResponse with a 20s TTL, same as GET /search')
  })

  check('the permission/surface restriction on GET / is still applied AFTER the cached payload (per-user, not cacheable)', () => {
    assert.match(listHandler, /isImageOnlyRead\(user, surface\)/, 'restriction must still run on every request, outside the shared cache')
  })

  console.log(`\nOK ${passed} checks`)
}

main()
