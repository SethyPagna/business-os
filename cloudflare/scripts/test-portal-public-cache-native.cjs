// Storefront edge caching end to end (6.0.889): the REAL routes/portal.ts and
// lib/cache.ts version reader over a real migrated SQLite database, a Cache API
// fake that honours max-age on a controllable clock, and KV versions in a Map.
//
//   - a sale (stock version bump) does NOT rebuild the catalog body, and the
//     badge shows the sale at once;
//   - with the stock version unchanged (KV not yet propagated) the badge is
//     stale for at most PORTAL_STOCK_TTL_SECONDS, then live;
//   - a catalog edit (products bump) does rebuild the body;
//   - hidden out-of-stock products leave the grid within the same bound;
//   - stored entries and responses carry no Set-Cookie and no private field;
//   - ETag + If-None-Match -> 304 on the storefront host; the admin host is
//     private, no-store; anything session-bound is private, no-store;
//   - an unknown parameter is refused before any database read;
//   - nothing on the storefront can take stock: no portal route writes it.
//
// Run (from cloudflare/): node scripts/test-portal-public-cache-native.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert/strict')
const Module = require('module')
const { Hono } = require('hono')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const productStockGuard = require('./harness/product_stock_guard.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const realDb = openDb(loadAll())
const statements = []
const db = {
  prepare(sql) { statements.push(sql); return realDb.prepare(sql) },
  batch: (items) => { for (const item of items) statements.push(item.sql || ''); return realDb.batch(items) },
  exec: (sql) => realDb.exec(sql),
  get staging() { return this },
}

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './productStockGuard') return productStockGuard
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const dbModule = { getDb: () => db }
const searchMatch = loadReal('lib/searchMatch.ts')
const cache = loadReal('lib/cache.ts', { './db': dbModule, './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) } })
const portalRoute = loadReal('routes/portal.ts', {
  '../lib/clientIdentity': loadReal('lib/clientIdentity.ts'),
  '../lib/loyaltyEligibility': loadReal('lib/loyaltyEligibility.ts'),
  '../lib/actorSnapshot': loadReal('lib/actorSnapshot.ts'),
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': dbModule,
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/familyPagination': loadReal('lib/familyPagination.ts'),
  '../lib/cache': cache,
  '../lib/auth': { requireAuth: async (c) => c.json({ error: 'auth' }, 401) },
  '../lib/permissions': { hasPermission: () => false },
  '../lib/audit': { audit: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientNetworkKey: () => '127.0.0.1', peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {}, releaseRateLimitSlot: async () => {} },
  '../lib/planTier': { getPlanLimits: () => ({ portalAiDailyMax: 100, portalAiVisitorDailyMax: 10 }) },
  '../lib/businessDateWindow': { BUSINESS_UTC_OFFSET_MINUTES: 420, businessToday: () => '2026-01-01' },
  '../lib/portalAbuseKey': { portalAbuseKey: async () => 'k' },
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
  '../lib/portalText': loadReal('lib/portalText.ts'),
  '../lib/portalImagePrivacy': loadReal('lib/portalImagePrivacy.ts'),
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': {
    createPortalSession: async () => ({}), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {},
    getPortalAccountState: async () => ({ status: 'unauthenticated', account: null }),
  },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false }), recordPortalFailure: async () => ({}), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => v },
  '../lib/fileAssets': { buildUniqueStoredName: (n) => n },
  '../lib/media': { sanitizeMediaList: (l) => l },
  '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), listPortalAiProviderDisclosures: async () => [] },
  '../lib/searchMatch': searchMatch,
  '../lib/productSearchQuery': loadReal('lib/productSearchQuery.ts', { './searchMatch': searchMatch }),
  '../lib/importImageMatch': { ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})
const { PORTAL_STOCK_TTL_SECONDS, PORTAL_BODY_TTL_SECONDS } = portalRoute
const app = new Hono().route('/api/portal', portalRoute.default)

// Cache API fake: keyed by URL, honours max-age, refuses a Set-Cookie response.
let clockMs = 0
const edge = new Map()
global.caches = { default: {
  async match(request) {
    const entry = edge.get(request.url)
    if (!entry || clockMs >= entry.expiresAt) return undefined
    return new Response(entry.body, { headers: entry.headers })
  },
  async put(request, response) {
    assert.equal(response.headers.get('set-cookie'), null, 'a stored entry never carries Set-Cookie')
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1])
    assert.ok(maxAge > 0)
    edge.set(request.url, { body: await response.text(), headers: [...response.headers], expiresAt: clockMs + maxAge * 1000 })
  },
} }

const kv = new Map()
// Through the real writer: a bump also drops this isolate's remembered versions (6.0.896 memo).
const bump = (namespace) => cache.bumpVersions(env, [namespace])
const env = {
  DB: realDb, BUSINESS_OS_PUBLIC_URL: 'https://shop.test',
  CACHE: { get: async (key) => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, String(value)) }, delete: async (key) => { kv.delete(key) } },
}

async function request(url, headers = {}) {
  const pending = []
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} }
  statements.length = 0
  const response = await app.fetch(new Request(url, { headers }), env, ctx)
  await Promise.all(pending)
  const text = response.status === 304 ? '' : await response.text()
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null, sql: [...statements] }
}
const shop = (route) => request(`https://shop.test/api/portal${route}`)
const builtCatalogBody = (sql) => sql.some((s) => s.includes('GROUP BY value'))
const readStock = (sql) => sql.some((s) => s.includes('FROM branch_stock'))
const write = (fn) => seedStockFixture(realDb, fn)

let branchId, soldId, otherId
function seed() {
  branchId = write(() => realDb.prepare(`INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id`).get()).id
  const insert = (name, quantity) => write(() => {
    const id = realDb.prepare(`INSERT INTO products (name, brand, is_active, stock_quantity, out_of_stock_threshold, low_stock_threshold, selling_price_usd, cost_price_usd)
      VALUES (@name, 'Brand', 1, @quantity, 0, 2, 9, 4) RETURNING id`).get({ name, quantity }).id
    realDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @quantity)').run({ id, branchId, quantity })
    return id
  })
  soldId = insert('Last Serum', 5)
  otherId = insert('Plenty Cream', 50)
}
function sellOut(id) {
  write(() => {
    realDb.prepare('UPDATE products SET stock_quantity = 0 WHERE id = @id').run({ id })
    realDb.prepare('UPDATE branch_stock SET quantity = 0 WHERE product_id = @id').run({ id })
  })
}
const statusOf = (items, id) => items.find((item) => item.id === id)?.stock_status

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}\n  ${String(error.message).split('\n')[0]}`)
  }
}

async function run() {
  seed()
  await cache.bumpVersions(env, ['products', 'settings', 'stock', 'promotions'])

  await check('first open builds body + stock; second open is served from the edge with zero D1 statements', async () => {
    const first = await shop('/bootstrap')
    assert.equal(first.status, 200)
    assert.ok(builtCatalogBody(first.sql) && readStock(first.sql))
    assert.equal(statusOf(first.json.products, soldId), 'in_stock')
    assert.deepEqual(first.json.products, first.json.catalog.items)
    const second = await shop('/bootstrap')
    assert.deepEqual(second.json, first.json)
    assert.deepEqual(second.sql.filter((s) => !s.includes('cache_versions')), [], 'a warm open reads nothing from D1')
  })

  await check('a sale (stock bump) keeps the catalog body and updates the badge at once', async () => {
    sellOut(soldId)
    await bump('stock')
    const after = await shop('/bootstrap')
    assert.equal(builtCatalogBody(after.sql), false, 'the sale did not rebuild the catalog body')
    assert.ok(readStock(after.sql), 'only the small stock entry was rebuilt')
    assert.equal(statusOf(after.json.products, soldId), 'out_of_stock')
    assert.equal(statusOf(after.json.products, otherId), 'in_stock')
    const search = await shop('/catalog/products/search?query=serum')
    assert.equal(statusOf(search.json.items, soldId), 'out_of_stock')
  })

  await check(`without a version bump (KV lag) a badge is stale for at most ${PORTAL_STOCK_TTL_SECONDS} s`, async () => {
    sellOut(otherId)
    clockMs += (PORTAL_STOCK_TTL_SECONDS - 1) * 1000
    assert.equal(statusOf((await shop('/bootstrap')).json.products, otherId), 'in_stock', 'still inside the bound')
    clockMs += 1000
    const fresh = await shop('/bootstrap')
    assert.equal(statusOf(fresh.json.products, otherId), 'out_of_stock', 'live once the stock entry expires')
    assert.equal(builtCatalogBody(fresh.sql), false, `the body lives ${PORTAL_BODY_TTL_SECONDS} s`)
  })

  await check('a catalog edit (products bump) rebuilds the body', async () => {
    write(() => realDb.prepare(`UPDATE products SET name = 'Last Serum Pro' WHERE id = @id`).run({ id: soldId }))
    await bump('products')
    const edited = await shop('/bootstrap')
    assert.ok(builtCatalogBody(edited.sql))
    assert.ok(edited.json.products.some((p) => p.name === 'Last Serum Pro'))
  })

  await check(`hidden out-of-stock products leave the grid within ${PORTAL_STOCK_TTL_SECONDS} s without any bump`, async () => {
    write(() => realDb.prepare(`INSERT INTO settings (key, value) VALUES ('customer_portal_show_out_of_stock_products', '0')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run())
    write(() => {
      realDb.prepare('UPDATE products SET stock_quantity = 7 WHERE id IN (@a, @b)').run({ a: soldId, b: otherId })
      realDb.prepare('UPDATE branch_stock SET quantity = 7 WHERE product_id IN (@a, @b)').run({ a: soldId, b: otherId })
    })
    await bump('settings')
    assert.equal((await shop('/catalog/products/search')).json.items.length, 2)
    sellOut(otherId)
    clockMs += (PORTAL_STOCK_TTL_SECONDS - 1) * 1000
    assert.equal((await shop('/catalog/products/search')).json.items.length, 2, 'inside the bound')
    clockMs += 1000
    const later = await shop('/catalog/products/search')
    assert.deepEqual(later.json.items.map((p) => p.id), [soldId], 'gone once the stock-dependent body expires')
  })

  await check('every stored entry and every public response is free of private fields and cookies', async () => {
    for (const route of ['/config', '/bootstrap', '/catalog/meta', '/catalog/products', '/catalog/products/search?query=serum', '/promotions']) {
      const response = await shop(route)
      assert.equal(response.status, 200, route)
      assert.equal(response.headers.get('set-cookie'), null, route)
      assert.equal(portalRoute.findForbiddenPublicKey(response.json), null, route)
      const text = JSON.stringify(response.json)
      for (const field of ['stock_quantity', 'cost_price', 'low_stock_threshold', 'out_of_stock_threshold', 'aiPrompt', 'aiProviderId']) assert.ok(!text.includes(field), `${route}: ${field}`)
    }
    for (const [url, entry] of edge) assert.equal(portalRoute.findForbiddenPublicKey(JSON.parse(entry.body)), null, url)
    assert.match(portalRoute.findForbiddenPublicKey({ items: [{ id: 1, cost_price_usd: 1 }] }), /cost_price_usd/)
    assert.match(portalRoute.findForbiddenPublicKey({ a: { wholesale_price: 1 } }), /wholesale/)
  })

  await check('ETag + If-None-Match answers 304 on the storefront host; the admin host is private, no-store', async () => {
    const first = await shop('/catalog/products/search?query=serum')
    const etag = first.headers.get('etag')
    assert.match(etag, /^W\/"[0-9a-f]{32}"$/)
    assert.equal(first.headers.get('cache-control'), 'public, no-cache')
    assert.equal(first.headers.get('vary'), null, 'the response varies on nothing but the canonical URL')
    const revalidated = await request('https://shop.test/api/portal/catalog/products/search?query=serum', { 'if-none-match': etag })
    assert.equal(revalidated.status, 304)
    assert.equal(revalidated.headers.get('etag'), etag)
    assert.equal((await request('https://shop.test/api/portal/catalog/products/search?query=serum', { 'if-none-match': 'W/"stale"' })).status, 200)
    const signedIn = await request('https://shop.test/api/portal/bootstrap', { cookie: 'bos_portal=abc; bos_session=xyz', authorization: 'Bearer t' })
    assert.deepEqual(signedIn.json, (await shop('/bootstrap')).json, 'cookies and authorization change nothing')
    const admin = await request('https://admin.shop.test/api/portal/bootstrap')
    assert.equal(admin.status, 200)
    assert.equal(admin.headers.get('cache-control'), 'private, no-store')
    assert.equal(admin.headers.get('etag'), null)
  })

  await check('session-bound portal endpoints are private, no-store', async () => {
    for (const route of ['/auth/me', '/account/cart', '/account/wishlist', '/membership/LC-00001', '/submissions/review', '/ai/status']) {
      const response = await shop(route)
      assert.equal(response.headers.get('cache-control'), 'private, no-store', route)
    }
  })

  await check('unknown, repeated or oversized parameters are refused before any database read', async () => {
    for (const route of ['/bootstrap?noise=1', '/config?_v=x', '/catalog/products/search?page=1&page=2', '/catalog/products/search?evil=1', `/catalog/products/search?query=${'x'.repeat(201)}`]) {
      const response = await shop(route)
      assert.equal(response.status, 400, route)
      assert.equal(response.json.code, 'portal_bad_query')
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(response.sql, [], route)
    }
  })

  await check('no storefront route can take stock: the sale is made at POS against live lots', async () => {
    const source = fs.readFileSync(path.join(SRC, 'routes', 'portal.ts'), 'utf8')
    assert.doesNotMatch(source, /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(sales|sale_items|branch_stock|product_batches|branch_batch_stock|inventory_movements)\b/i)
    assert.doesNotMatch(source, /\bUPDATE\s+products\b/i)
  })

  console.log(`\n${passed} checks passed, ${failed} failed.`)
  if (failed) process.exitCode = 1
}

run().catch((error) => { console.error(error); process.exit(1) })
