// Storefront cache hardening (6.0.896, security review of 6.0.889): the REAL
// routes/portal.ts, lib/cache.ts and routes/backups.ts over a real migrated
// SQLite database, a Cache API fake on a controllable clock, KV in a Map.
//
//   P1-1  a cold search over the per-network limit is a 429 with zero D1
//         statements while a warm hit still answers; cold searches past the
//         per-isolate cap are a 503; fuzzy fallback only for short text;
//   P2-1  a throwing KV falls back to D1, and a remembered version spends no
//         KV read; unreadable versions answer uncached instead of failing;
//   P2-2  a 150-character Khmer query with five Khmer categories is a 200;
//   P2-3  nothing is stored while maintenance is held; leaving maintenance
//         (restore end, force clear) moves every cache version;
//   P3-1  concurrent misses for one entry run its producer once;
//   P3-2  a translation key naming a private field never takes /config down;
//   P3-3  a new deploy (version id) never reads an older deploy's entries;
//   P3-4  HEAD strips Set-Cookie like GET;
//   P3-5  the widest filter combination binds at most 100 parameters;
//   note  with the stock-status switch off no stock field is published.
//
// Run (from cloudflare/): node scripts/test-portal-cache-hardening-native.cjs
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
let slowMs = 0
const later = (value) => (slowMs ? new Promise((resolve) => setTimeout(() => resolve(value), slowMs)) : value)
const db = {
  prepare(sql) {
    statements.push(sql)
    const statement = realDb.prepare(sql)
    return {
      all: (params) => later(statement.all(params)),
      get: (params) => later(statement.get(params)),
      run: (params) => statement.run(params),
      bind(params) { statement.bind(params); return this },
    }
  },
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

// The memo in lib/cache.ts reads Date.now(); this test owns the clock.
let clockMs = Date.UTC(2026, 9, 20, 12)
Date.now = () => clockMs

const dbModule = { getDb: () => db }
const searchMatch = loadReal('lib/searchMatch.ts')
const portalText = loadReal('lib/portalText.ts')
const cache = loadReal('lib/cache.ts', { './db': dbModule, './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) } })
const portalRoute = loadReal('routes/portal.ts', {
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
  '../lib/rateLimit': {
    checkRateLimit: async () => ({ allowed: true }), getClientNetworkKey: (request) => request.headers.get('cf-connecting-ip') || 'unknown-ip',
    peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {}, releaseRateLimitSlot: async () => {},
  },
  '../lib/planTier': { getPlanLimits: () => ({ portalAiDailyMax: 100, portalAiVisitorDailyMax: 10 }) },
  '../lib/businessDateWindow': { BUSINESS_UTC_OFFSET_MINUTES: 420, businessToday: () => '2026-01-01' },
  '../lib/portalAbuseKey': { portalAbuseKey: async () => 'k' },
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
  '../lib/portalText': portalText,
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
const { PORTAL_COLD_SEARCH_MAX_CONCURRENT } = portalRoute

// HEAD reaches the portal with a Set-Cookie already on the response, the way a
// session-refreshing middleware upstream would leave one.
const app = new Hono()
  .use('*', async (c, next) => {
    if (c.req.header('x-upstream-cookie')) c.res = new Response(null, { headers: { 'set-cookie': 'bos_session=refreshed' } })
    await next()
  })
  .route('/api/portal', portalRoute.default)

let edgeWrites = 0
const edge = new Map()
global.caches = { default: {
  async match(request) {
    const entry = edge.get(request.url)
    if (!entry || clockMs >= entry.expiresAt) return undefined
    return new Response(entry.body, { headers: entry.headers })
  },
  async put(request, response) {
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1])
    edgeWrites += 1
    edge.set(request.url, { body: await response.text(), headers: [...response.headers], expiresAt: clockMs + maxAge * 1000 })
  },
} }

const kv = new Map()
let kvThrows = false
let kvReads = 0
const limiterCounts = new Map()
let limiterLimit = Infinity
const env = {
  DB: realDb,
  BUSINESS_OS_PUBLIC_URL: 'https://shop.test',
  CF_VERSION_METADATA: { id: 'version-a', tag: '', timestamp: '' },
  CACHE: {
    get: async (key) => { kvReads += 1; if (kvThrows) throw new Error('KV unavailable'); return kv.get(key) ?? null },
    put: async (key, value) => { kv.set(key, String(value)) },
    delete: async (key) => { kv.delete(key) },
  },
  PORTAL_SEARCH_LIMITER: {
    async limit({ key }) {
      const count = (limiterCounts.get(key) || 0) + 1
      limiterCounts.set(key, count)
      return { success: count <= limiterLimit }
    },
  },
}

async function request(url, { headers = {}, method = 'GET' } = {}) {
  const pending = []
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} }
  const before = statements.length
  const response = await app.fetch(new Request(url, { headers, method }), env, ctx)
  await Promise.all(pending)
  const text = response.status === 304 || method === 'HEAD' ? '' : await response.text()
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null, sql: statements.slice(before) }
}
const shop = (route, options) => request(`https://shop.test/api/portal${route}`, options)
const fromIp = (ip) => ({ headers: { 'cf-connecting-ip': ip } })
const builtBody = (sql) => sql.some((s) => s.includes('GROUP BY value'))
const write = (fn) => seedStockFixture(realDb, fn)
const bump = (...namespaces) => cache.bumpVersions(env, namespaces)
const setSetting = (key, value) => write(() => realDb.prepare(`INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({ key, value }))

let productId
function seed() {
  const branchId = write(() => realDb.prepare(`INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id`).get()).id
  productId = write(() => {
    const id = realDb.prepare(`INSERT INTO products (name, brand, category, is_active, stock_quantity, out_of_stock_threshold, low_stock_threshold, selling_price_usd, cost_price_usd)
      VALUES ('Glow Serum', 'Brand', 'Skin', 1, 9, 0, 2, 9, 4) RETURNING id`).get().id
    realDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 9)').run({ id, branchId })
    return id
  })
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}\n  ${String(error.stack || error.message).split('\n').slice(0, 3).join('\n  ')}`)
  } finally {
    // A failed check must not leave a fault switched on for the next one.
    kvThrows = false
    slowMs = 0
    limiterLimit = Infinity
    write(() => realDb.prepare(`DELETE FROM system_flags WHERE key = 'maintenance'`).run())
  }
}

async function run() {
  seed()
  await bump('products', 'settings', 'stock', 'promotions')

  await check('P1-1: past the per-network limit a cold search is a 429 with zero D1 statements; a warm hit still answers', async () => {
    limiterLimit = 3
    limiterCounts.clear()
    for (const word of ['alpha', 'bravo', 'charlie']) assert.equal((await shop(`/catalog/products/search?query=${word}`, fromIp('198.51.100.7'))).status, 200, word)
    clockMs += 500
    const refused = await shop('/catalog/products/search?query=delta', fromIp('198.51.100.7'))
    assert.equal(refused.status, 429)
    assert.equal(refused.json.code, 'portal_search_rate_limited')
    assert.equal(refused.headers.get('cache-control'), 'private, no-store')
    assert.equal(refused.headers.get('retry-after'), '60')
    assert.deepEqual(refused.sql, [], 'the refusal reads nothing from D1')
    const warm = await shop('/catalog/products/search?query=alpha', fromIp('198.51.100.7'))
    assert.equal(warm.status, 200, 'an edge hit is never counted or refused')
    assert.deepEqual(warm.sql, [])
    assert.equal(limiterCounts.get('198.51.100.7'), 4, 'only the four cold searches were counted')
    assert.equal((await shop('/catalog/products/search?query=delta', fromIp('203.0.113.9'))).status, 200, 'another network is unaffected')
    assert.equal((await shop('/bootstrap', fromIp('198.51.100.7'))).status, 200, 'only search is limited')
    limiterLimit = Infinity
  })

  await check(`P1-1: more than ${PORTAL_COLD_SEARCH_MAX_CONCURRENT} concurrent cold searches in one isolate: the rest are 503`, async () => {
    slowMs = 30
    const words = Array.from({ length: PORTAL_COLD_SEARCH_MAX_CONCURRENT + 2 }, (_, index) => `busy${index}`)
    const results = await Promise.all(words.map((word) => shop(`/catalog/products/search?query=${word}`, fromIp('192.0.2.1'))))
    slowMs = 0
    const statuses = results.map((result) => result.status).sort()
    assert.equal(statuses.filter((status) => status === 200).length, PORTAL_COLD_SEARCH_MAX_CONCURRENT, statuses.join())
    assert.equal(statuses.filter((status) => status === 503).length, 2, statuses.join())
    const busy = results.find((result) => result.status === 503)
    assert.equal(busy.json.code, 'portal_search_busy')
    assert.equal(busy.headers.get('cache-control'), 'private, no-store')
    assert.equal((await shop('/catalog/products/search?query=busy0')).status, 200, 'the cap frees once they finish')
  })

  await check('P3-1: concurrent misses for one entry run the producer once', async () => {
    slowMs = 30
    statements.length = 0
    const results = await Promise.all([1, 2, 3].map(() => shop('/catalog/products/search?query=coalesce')))
    slowMs = 0
    for (const result of results) assert.equal(result.status, 200)
    assert.deepEqual(results[1].json, results[0].json)
    const producerRuns = statements.filter((sql) => sql.includes('GROUP BY value')).length
    statements.length = 0
    assert.equal(producerRuns, 1, `the rail query ran ${producerRuns} times`)
  })

  await check('P1-1: the fuzzy fallback runs only for 3-40 characters and at most 4 words', async () => {
    const fuzzyScan = (sql) => sql.some((s) => /ORDER BY p\.id ASC\s+LIMIT 3000/.test(s))
    assert.ok(fuzzyScan((await shop('/catalog/products/search?query=glwo')).sql), 'a typo still gets the fallback')
    assert.equal(fuzzyScan((await shop(`/catalog/products/search?query=${'zq'.repeat(21)}`)).sql), false, '42 characters: no scan')
    assert.equal(fuzzyScan((await shop('/catalog/products/search?query=aa+bb+cc+dd+ee')).sql), false, 'five words: no scan')
    assert.equal(fuzzyScan((await shop('/catalog/products/search?query=zq')).sql), false, 'two characters: no scan')
    assert.equal(portalRoute.portalFuzzyFallbackAllowed('glow serum cream mask'), true)
  })

  await check('P2-1: a throwing KV falls back to D1; a remembered version reads neither', async () => {
    kv.clear()
    write(() => realDb.exec(`INSERT INTO cache_versions (namespace, version, updated_at) VALUES
      ('products', 40, CURRENT_TIMESTAMP), ('settings', 41, CURRENT_TIMESTAMP), ('stock', 42, CURRENT_TIMESTAMP), ('promotions', 43, CURRENT_TIMESTAMP)
      ON CONFLICT(namespace) DO UPDATE SET version = excluded.version`))
    await bump('products') // drops the memo; D1 mode stays D1 mode
    clockMs += 10_000
    kvThrows = true
    const first = await shop('/catalog/products/search?query=serum')
    assert.equal(first.status, 200)
    assert.ok(first.sql.some((s) => s.includes('cache_versions')), 'the versions came from D1')
    assert.ok([...edge.keys()].some((url) => url.includes('d2%3A41')), 'the entry is keyed on the D1 versions')
    kvReads = 0
    clockMs += 1000
    const second = await shop('/catalog/products/search?query=serum')
    assert.equal(second.status, 200)
    assert.equal(kvReads, 0, 'the memo spent no KV read')
    assert.deepEqual(second.sql, [], 'nor any D1 statement')
    kvThrows = false
  })

  await check('P2-1: versions unreadable from both KV and D1 answer uncached instead of failing', async () => {
    write(() => realDb.exec(`DELETE FROM cache_versions`))
    await bump('products', 'settings', 'stock', 'promotions')
    clockMs += 10_000
    kvThrows = true
    const writes = edgeWrites
    const response = await shop('/bootstrap')
    kvThrows = false
    assert.equal(response.status, 200)
    assert.ok(builtBody(response.sql))
    assert.equal(edgeWrites, writes, 'no entry is stored without a safe key')
    assert.ok(response.json.products.some((product) => product.id === productId && product.stock_status === 'in_stock'))
  })

  await check('P2-2: a 150-character Khmer query with five Khmer categories is answered', async () => {
    const khmer = 'ថែរក្សាស្បែកមុខ'
    const query = khmer.repeat(Math.ceil(150 / khmer.length)).slice(0, 150)
    const categories = Array.from({ length: 5 }, (_, index) => `${khmer}${index}`).join(',')
    const url = `/catalog/products/search?query=${encodeURIComponent(query)}&category=${encodeURIComponent(categories)}`
    assert.ok(url.length > 1024, 'longer than the old encoded cap')
    const response = await shop(url)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    assert.ok(Array.isArray(response.json.items))
  })

  await check('P2-3: nothing is stored while maintenance is held', async () => {
    write(() => realDb.prepare(`INSERT INTO system_flags (key, value) VALUES ('maintenance', @value)`).run({ value: JSON.stringify({ mode: 'restore', token: 't', phase: 'inserting' }) }))
    const held = await shop('/catalog/products/search?query=maintenance')
    assert.equal(held.status, 200)
    assert.equal([...edge.keys()].some((url) => url.includes('/body/search?query=maintenance')), false, 'the body is not stored')
    write(() => realDb.prepare(`DELETE FROM system_flags WHERE key = 'maintenance'`).run())
    await shop('/catalog/products/search?query=maintenance')
    assert.ok([...edge.keys()].some((url) => url.includes('/body/search?query=maintenance')), 'stored once maintenance ends')
  })

  await check('P2-3: leaving maintenance after a restore (and on a force clear) moves every cache version', async () => {
    let released = true
    const backups = loadReal('routes/backups.ts', {
      '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 1, username: 'admin' }); return next() } },
      '../lib/audit': { audit: async () => {}, auditOrThrow: async () => {} },
      '../lib/permissions': { hasPermission: () => true },
      '../lib/acquisitionCostAccess': { canViewAcquisitionCosts: () => true, canEditAcquisitionCosts: () => true },
      '../lib/destructiveStepUp': { denyUnlessCurrentPassword: async () => null, denyUnlessDefaultAdmin: async () => null },
      '../lib/backup': {
        CLOUDFLARE_BACKUP_KEEP: 2, restoreCloudflareBackup: async (_env, key) => ({ key }), storeSystemJob: async (_env, job) => job,
      },
      '../lib/maintenance': {
        beginMaintenance: async () => ({ token: 'restore-token' }), updateMaintenance: async () => {},
        endMaintenance: async () => released, MaintenanceAdmissionConflictError: class extends Error {},
        getMaintenance: async () => ({ mode: 'restore', revision: 'r' }), maintenanceStatus: (state) => state,
      },
      '../lib/cache': cache,
    }).default
    const restoreEnv = { ...env, DB: { prepare: () => ({ first: async () => ({ n: 0 }) }) } }
    const call = (route, body) => backups.fetch(new Request(`https://admin.shop.test${route}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      restoreEnv, { waitUntil() {}, passThroughOnException() {} })
    const snapshot = () => Object.fromEntries(['products', 'settings', 'stock', 'promotions', 'sales', 'customers'].map((ns) => [ns, kv.get(`v2:${ns}`)]))

    let before = snapshot()
    assert.equal((await call('/', { type: 'import-folder', sourceDir: 'backup-1' })).status, 200)
    for (const [ns, value] of Object.entries(snapshot())) assert.notEqual(value, before[ns], `restore end moved ${ns}`)

    before = snapshot()
    assert.equal((await call('/maintenance/clear', { force: true })).status, 200)
    for (const [ns, value] of Object.entries(snapshot())) assert.notEqual(value, before[ns], `force clear moved ${ns}`)

    released = false
    before = snapshot()
    assert.equal((await call('/', { type: 'import-folder', sourceDir: 'backup-1' })).status, 409)
    assert.deepEqual(snapshot(), before, 'maintenance still held: nothing moves yet')
  })

  await check('P3-2: a stored translation key naming a private field never takes /config down', async () => {
    setSetting('customer_portal_translations', JSON.stringify({ km: { faqItems: { 'shipping-cost': { question: 'Q', answer: 'A' }, 'opening-hours': { question: 'ម៉ោង', answer: 'ចម្លើយ' } } } }))
    await bump('settings')
    try {
      for (const route of ['/config', '/bootstrap']) {
        const response = await shop(route)
        assert.equal(response.status, 200, `${route}: ${JSON.stringify(response.json)}`)
        const faq = (response.json.config || response.json).translations.km.faqItems
        assert.deepEqual(Object.keys(faq), ['opening-hours'], 'the private-named entry is dropped, the rest publish')
      }
    } finally {
      setSetting('customer_portal_translations', '{}')
      await bump('settings')
    }
    assert.equal(portalText.privateTranslationKey(JSON.stringify({ km: { promoItems: { 'supplier-deal': {} } } })), 'supplier-deal')
    assert.equal(portalText.privateTranslationKey(JSON.stringify({ km: { faqItems: { 'opening-hours': {} } } })), null)
  })

  await check('P3-3: a new deploy never reads an older deploy\'s entries', async () => {
    await shop('/catalog/meta')
    const warm = await shop('/catalog/meta')
    assert.deepEqual(warm.sql.filter((s) => !s.includes('cache_versions')), [], 'warm within one deploy')
    env.CF_VERSION_METADATA = { id: 'version-b', tag: '', timestamp: '' }
    const next = await shop('/catalog/meta')
    assert.ok(next.sql.some((s) => s.includes('FROM products')), 'the new deploy rebuilt the body')
  })

  await check('P3-4: HEAD strips an upstream Set-Cookie exactly like GET', async () => {
    for (const method of ['GET', 'HEAD']) {
      const response = await shop('/config', { method, headers: { 'x-upstream-cookie': '1' } })
      assert.equal(response.status, 200, method)
      assert.equal(response.headers.get('set-cookie'), null, `${method} carries no Set-Cookie`)
    }
  })

  await check('P3-5: the widest filter combination binds at most 100 parameters per statement', async () => {
    const list = (prefix) => Array.from({ length: 20 }, (_, index) => `${prefix}${index}`).join(',')
    const branches = Array.from({ length: 20 }, (_, index) => index + 1).join(',')
    // Six comma groups of eight words: the most search terms the query builder takes.
    const words = Array.from({ length: 6 }, (_, group) => Array.from({ length: 8 }, (_, word) => 'abcdefgh'[word] + 'pqrstu'[group]).join(' ')).join(', ')
    const url = `/catalog/products/search?query=${encodeURIComponent(words)}&brand=${list('brand')}&category=${list('category')}`
      + `&branchId=${branches}&stockState=in_stock,low_stock,out_of_stock&initial=A&promo=promoted&pageSize=100&page=3`
    const response = await shop(url)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    const bound = (sql) => new Set([...sql.replace(/'(?:[^']|'')*'/g, '').matchAll(/@(\w+)/g)].map((match) => match[1])).size
    const widest = Math.max(...response.sql.map(bound))
    assert.ok(widest <= 100, `a statement binds ${widest} parameters`)
    console.log(`  widest storefront statement binds ${widest} parameters`)
  })

  await check('note: with the stock-status switch off no stock field is published', async () => {
    setSetting('customer_portal_show_stock_status', 'false')
    await bump('settings')
    for (const route of ['/bootstrap', '/catalog/products', '/catalog/products/search?query=serum']) {
      const response = await shop(route)
      assert.equal(response.status, 200, route)
      const items = response.json.items || response.json.products
      assert.ok(items.length > 0, route)
      for (const item of items) {
        assert.equal('stock_status' in item, false, `${route}: stock_status`)
        assert.equal('branch_availability' in item, false, `${route}: branch_availability`)
      }
    }
    setSetting('customer_portal_show_stock_status', 'true')
    await bump('settings')
    const back = await shop('/catalog/products/search?query=serum')
    assert.equal(back.json.items[0].stock_status, 'in_stock', 'switching it back on restores the badge')
  })

  console.log(`\n${passed} checks passed, ${failed} failed.`)
  if (failed) process.exitCode = 1
}

run().catch((error) => { console.error(error); process.exit(1) })
