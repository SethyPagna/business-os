// K1: lib/httpCache.ts -- the /api Cache-Control policy table and middleware.
//
// What this pins, and why each is a real failure mode:
// - Unclassified GETs default to `private, no-store`: a new route nobody
//   thought about must not become storable by accident.
// - Only class E is public, and no PII/transaction path can reach a public
//   rule. Checked against concrete paths (portal account/membership, customer
//   membership lookup, sales, returns ...), not just the rule list, because a
//   broad E regex is exactly how a customer's data would end up in a shared
//   cache.
// - Writes are no-store even on an E path; errors are no-store even on E; a
//   Set-Cookie response is never public.
// - The middleware never overwrites a route's own Cache-Control, and stamps
//   X-BOS-Build even on immutable responses.
// - Every GET route literally registered today (scanned from index.ts mounts
//   and routes/*.ts) resolves to a class; a cached portal route resolves to E.
//
// Run: node scripts/test-http-cache-policy-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const srcDir = path.join(__dirname, '..', 'src')
const libDir = path.join(srcDir, 'lib')
const loaded = new Map()
function loadLib(name) {
  if (loaded.has(name)) return loaded.get(name).exports
  const sourcePath = path.join(libDir, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  loaded.set(name, moduleObj)
  const localRequire = (request) => (request.startsWith('./') ? loadLib(request.slice(2)) : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, localRequire, moduleObj, sourcePath, libDir,
  )
  return moduleObj.exports
}
const http = loadLib('httpCache')

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
  } catch (error) {
    failures++
    console.log('FAIL', name, '-', error && error.message)
  }
}

const PII_AND_TRANSACTION_PATHS = [
  '/api/portal/auth/me', '/api/portal/account/cart', '/api/portal/account/wishlist',
  '/api/portal/membership/000123', '/api/portal/submissions/review', '/api/portal/submissions/4/screenshot/0',
  '/api/customers', '/api/customers/membership/000123', '/api/customers/points-summary', '/api/customers/5/rename-impact',
  '/api/suppliers', '/api/suppliers/3/purchases', '/api/delivery-contacts',
  '/api/sales', '/api/sales/9/records', '/api/sales/export', '/api/sales/daily-report',
  '/api/returns', '/api/returns/7', '/api/returns/receipt-lookup', '/api/shifts/current', '/api/reports/overview',
  '/api/reports/business-summary/sales', '/api/fees/report', '/api/notes', '/api/files/2/download',
  '/api/action-history', '/api/notifications/summary', '/api/auth/me', '/api/auth/devices/sessions',
  '/api/users', '/api/users/1/profile', '/api/products/4/sales-detail', '/api/products/4/cost-breakdown',
  '/api/products/stock-ledger', '/api/inventory/movements', '/api/ai/responses', '/api/review/mine',
  '/api/system/audit-logs', '/api/backups', '/api/import-jobs/3/errors.csv',
]

;(async () => {
  await check('an unclassified GET defaults to private, no-store', () => {
    assert.equal(http.classifyApiRoute('GET', '/api/some-future-thing'), null)
    assert.equal(http.cacheControlFor('GET', '/api/some-future-thing', 200), 'private, no-store')
    assert.equal(http.DEFAULT_CACHE_CONTROL, 'private, no-store')
  })

  await check('only class E is public, and its policy says so consistently', () => {
    for (const [letter, policy] of Object.entries(http.ROUTE_CLASS_POLICY)) {
      assert.equal(policy.public, /(^|,\s*)public(,|$)/.test(policy.cacheControl), `class ${letter} public flag`)
      assert.equal(policy.public, letter === 'E', `class ${letter} must ${letter === 'E' ? '' : 'not '}be public`)
    }
    assert.equal(http.ROUTE_CLASS_POLICY.E.cacheControl, 'public, max-age=15, stale-while-revalidate=60')
    assert.equal(http.ROUTE_CLASS_POLICY.F.cacheControl, 'private, no-cache')
    assert.equal(http.ROUTE_CLASS_POLICY.G.cacheControl, 'private, no-store')
    assert.equal(http.ROUTE_CLASS_POLICY.H.cacheControl, 'no-store')
  })

  await check('PII and transaction routes are never public', () => {
    for (const p of PII_AND_TRANSACTION_PATHS) {
      const value = http.cacheControlFor('GET', p, 200)
      assert.ok(!/public/.test(value), `${p} -> ${value}`)
      assert.ok(/no-store/.test(value), `${p} must be no-store, got ${value}`)
    }
  })

  await check('E matches exactly the anonymous storefront reads', () => {
    for (const p of ['/api/portal/config', '/api/portal/bootstrap', '/api/portal/catalog/meta', '/api/portal/catalog/products', '/api/portal/catalog/products/search', '/api/portal/promotions', '/api/portal/ai/status']) {
      assert.equal(http.classifyApiRoute('GET', p), 'E', p)
    }
    for (const p of ['/api/portal/config/x', '/api/portal/catalog/products/1', '/api/portal/catalog', '/api/portalx/config', '/api/products/search']) {
      assert.notEqual(http.classifyApiRoute('GET', p), 'E', p)
    }
  })

  await check('writes are no-store on every path, including E paths', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(http.classifyApiRoute(method, '/api/portal/config'), 'H')
      assert.equal(http.cacheControlFor(method, '/api/portal/config', 200), 'no-store')
      assert.equal(http.cacheControlFor(method, '/api/products', 201), 'no-store')
    }
  })

  await check('errors are no-store even on a public route; Set-Cookie is never public', () => {
    assert.equal(http.cacheControlFor('GET', '/api/portal/config', 500), 'no-store')
    assert.equal(http.cacheControlFor('GET', '/api/portal/config', 404), 'no-store')
    assert.equal(http.cacheControlFor('GET', '/api/products', 403), 'no-store')
    assert.equal(http.cacheControlFor('GET', '/api/portal/config', 304), http.ROUTE_CLASS_POLICY.E.cacheControl)
    assert.equal(http.cacheControlFor('GET', '/api/portal/config', 200, true), 'private, no-store')
  })

  await check('staff catalog/vocab/dashboard are F; live stock is D; carve-outs win over prefixes', () => {
    for (const p of ['/api/products', '/api/products/search', '/api/products/bootstrap', '/api/categories', '/api/units', '/api/dashboard', '/api/dashboard/startup', '/api/settings']) {
      assert.equal(http.classifyApiRoute('GET', p), 'F', p)
    }
    for (const p of ['/api/inventory/summary', '/api/batches/picker-lots', '/api/branches/2/stock', '/api/dashboard/stock-alerts']) {
      assert.equal(http.classifyApiRoute('GET', p), 'D', p)
    }
    assert.equal(http.ROUTE_CLASS_POLICY.D.stockBearing, true)
    assert.equal(http.classifyApiRoute('GET', '/api/products/12/sales-detail'), 'G')
    assert.equal(http.classifyApiRoute('GET', '/api/products/possible-duplicates'), 'C')
    assert.equal(http.classifyApiRoute('GET', '/api/runtime/version'), 'B')
    assert.equal(http.classifyApiRoute('GET', '/api/runtime/queues/status'), 'C')
  })

  await check('every GET route registered today resolves to a class; cached portal routes are E', () => {
    const index = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8')
    const mounts = []
    for (const m of index.matchAll(/app\.route\('([^']+)',\s*(\w+)/g)) mounts.push({ prefix: m[1], ident: m[2] })
    const imports = new Map()
    for (const m of index.matchAll(/import (\w+) from '\.\/routes\/(\w+)'/g)) imports.set(m[1], m[2])
    imports.set('createSyncRoute', 'sync')
    for (const m of index.matchAll(/app\.route\('([^']+)',\s*createSyncRoute/g)) mounts.push({ prefix: m[1], ident: 'createSyncRoute' })
    const unclassified = []
    let seen = 0
    for (const { prefix, ident } of mounts) {
      const file = imports.get(ident)
      if (!file) continue
      const source = fs.readFileSync(path.join(srcDir, 'routes', `${file}.ts`), 'utf8')
      for (const m of source.matchAll(/app\.get\('([^']*)'/g)) {
        const full = (prefix + (m[1] === '/' ? '' : m[1])).replace(/:(id|productId|reviewId)\b/g, '1').replace(/:[A-Za-z]+/g, 'x')
        seen++
        if (!http.classifyApiRoute('GET', full)) unclassified.push(full)
      }
    }
    assert.ok(seen > 150, `scanned ${seen} routes; the scanner itself must be working`)
    assert.deepEqual(unclassified, [], `unclassified GET routes: ${unclassified.join(', ')}`)
    const portal = fs.readFileSync(path.join(srcDir, 'routes', 'portal.ts'), 'utf8')
    const cachedPortal = Array.from(portal.matchAll(/app\.get\('([^']+)',[^\n]*\n[^\n]*\n?[^\n]*cachedJsonResponse/g)).map((m) => `/api/portal${m[1]}`)
    assert.ok(cachedPortal.length >= 4, `found ${cachedPortal.length} cached portal routes`)
    for (const p of cachedPortal) assert.equal(http.classifyApiRoute('GET', p), 'E', p)
  })

  await check('the middleware fills Cache-Control only when unset and stamps X-BOS-Build', async () => {
    const mw = http.createHttpCacheMiddleware({ buildHash: () => 'abc123' })
    const run = async (method, p, makeResponse) => {
      const c = { req: { raw: new Request(`https://x${p}`, { method }), path: p, method }, res: new Response(null) }
      await mw(c, async () => { c.res = makeResponse() })
      return c.res
    }
    const own = await run('GET', '/api/portal/config', () => new Response('{}', { headers: { 'Cache-Control': 'private, no-store' } }))
    assert.equal(own.headers.get('cache-control'), 'private, no-store', 'a route-set header is never overridden')
    assert.equal(own.headers.get('x-bos-build'), 'abc123')
    const filled = await run('GET', '/api/portal/config', () => new Response('{}'))
    assert.equal(filled.headers.get('cache-control'), 'public, max-age=15, stale-while-revalidate=60')
    const pii = await run('GET', '/api/customers', () => new Response('[]'))
    assert.equal(pii.headers.get('cache-control'), 'private, no-store')
    const write = await run('POST', '/api/sales', () => new Response('{}', { status: 201 }))
    assert.equal(write.headers.get('cache-control'), 'no-store')
    const immutable = await run('GET', '/api/files/1/download', () => Response.redirect('https://x/elsewhere', 302))
    assert.equal(immutable.headers.get('x-bos-build'), 'abc123', 'immutable headers still get the build stamp')
    assert.equal(immutable.headers.get('cache-control'), 'no-store', 'a redirect is not cacheable')
  })

  if (failures) {
    console.log(`\n${failures} check(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\nall http cache policy checks passed')
  }
})()
