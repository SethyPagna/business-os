// Storefront follow-ups from the a77883c78 security review, on the REAL routes/portal.ts over SQLite with every
// migration applied:
//   - "Show selling prices" off must hold on the SERVER: no selling_price_* / discount_amount_* in any public product
//     response (bootstrap, catalog page, search incl. one product by id and the typo fallback), and the cached body
//     must follow the setting through the settings version in its edge key;
//   - /promotions must not publish a deactivated linked product;
//   - the public config must not carry loyalty rates while the programme is off;
//   - /ai/status (anonymous) is answered from a short edge cache, so a flood does not reach D1.
// Run (from cloudflare/): node scripts/test-portal-public-followup-a-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const productStockGuard = require('./harness/product_stock_guard.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const tokens = { products: 'p1', settings: 's1', promotions: 'm1', stock: 't1' }
let versionReads = 0
const edge = new Map()
globalThis.caches = { default: {
  match: async (key) => { const hit = edge.get(key.url); return hit ? hit.clone() : undefined },
  put: async (key, response) => { edge.set(key.url, response) },
} }
const fakeEnv = { DB: db, ASSETS: null, CACHE: { get: async () => null, put: async () => {} }, BUSINESS_OS_PUBLIC_URL: 'https://shop.test', CF_VERSION_METADATA: { id: 'deploy-1' } }
const pending = []
const fakeCtx = { waitUntil: (promise) => { pending.push(Promise.resolve(promise).catch(() => {})) }, passThroughOnException: () => {} }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  }).outputText
}
function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './productStockGuard') return productStockGuard
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(relPath))(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const searchMatch = loadReal('lib/searchMatch.ts')
const portalRoute = loadReal('routes/portal.ts', {
  '../lib/loyaltyEligibility': loadReal('lib/loyaltyEligibility.ts'),
  // buildPortalConfig falls back to the configured shop name (Oct 22 2026).
  '../lib/clientIdentity': loadReal('lib/clientIdentity.ts'),
  '../lib/actorSnapshot': loadReal('lib/actorSnapshot.ts'),
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': { getDb: () => db },
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/familyPagination': loadReal('lib/familyPagination.ts'),
  '../lib/cache': {
    getVersionsWithFallback: async (_env, namespaces) => { versionReads += 1; return namespaces.map((namespace) => tokens[namespace]) },
    getVersionWithFallback: async () => '0',
    bumpVersion: async () => {},
  },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getClientNetworkKey: () => '127.0.0.1', peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {} },
  '../lib/planTier': { getPlanLimits: () => ({ portalAiDailyMax: 100, portalAiVisitorDailyMax: 10 }) },
  '../lib/businessDateWindow': { BUSINESS_UTC_OFFSET_MINUTES: 420, businessToday: () => '2026-01-01' },
  '../lib/portalAbuseKey': loadReal('lib/portalAbuseKey.ts'),
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
  '../lib/portalText': loadReal('lib/portalText.ts'),
  '../lib/portalImagePrivacy': loadReal('lib/portalImagePrivacy.ts'),
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (value) => String(value || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (name) => name },
  '../lib/media': { sanitizeMediaList: (list) => list },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), listPortalAiProviderDisclosures: async () => [] },
  '../lib/searchMatch': searchMatch,
  '../lib/productSearchQuery': loadReal('lib/productSearchQuery.ts', { './searchMatch': searchMatch }),
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})
const { Hono } = require('hono')
// Mounted where the Worker mounts it, so the route's own path rules (public reads, private AI paths) see /api/portal/...
const app = new Hono()
app.route('/api/portal', portalRoute.default)

async function get(url) {
  const res = await app.request(`https://shop.test/api/portal${url}`, { method: 'GET' }, fakeEnv, fakeCtx)
  await Promise.all(pending.splice(0))
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null }
}
const exec = (sql) => db.exec(sql)
const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run({ key, value: String(value) })
const queries = () => { let count = 0; const wrap = db.prepare.bind(db); db.prepare = (sql) => { count += 1; return wrap(sql) }; return { count: () => count, stop: () => { db.prepare = wrap } } }

const PRICE_FIELD = /^(selling_price|discount_amount)_(usd|khr)$/
const PRICE_NUMBERS = ['17.31', '70971', '3.77', '15457', '23.45', '96145']
const priceKeys = (items) => items.flatMap((item) => Object.keys(item).filter((key) => PRICE_FIELD.test(key)))

function seed() {
  seedStockFixture(db, () => exec('DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM settings; DELETE FROM promotions;'))
  const branchId = seedStockFixture(db, () => db.prepare("INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id").get()).id
  const rows = [
    // fixed discount: both the price and the amount off are numbers a hidden-price store must not publish
    { name: 'Serum Alpha', brand: 'Acme', usd: 17.31, khr: 70971, type: 'fixed', pct: 0, amtUsd: 3.77, amtKhr: 15457 },
    { name: 'Cream Beta', brand: 'Zed', usd: 23.45, khr: 96145, type: 'percent', pct: 15, amtUsd: 0, amtKhr: 0 },
  ]
  const ids = rows.map((row) => {
    const id = seedStockFixture(db, () => db.prepare(
      `INSERT INTO products (name, brand, selling_price_usd, selling_price_khr, is_active, stock_quantity, out_of_stock_threshold,
         discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label)
       VALUES (@name, @brand, @usd, @khr, 1, 10, 0, 1, @type, @pct, @amtUsd, @amtKhr, 'Sale') RETURNING id`).get(row)).id
    seedStockFixture(db, () => db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 10)').run({ id, branchId }))
    return id
  })
  return ids
}

let passed = 0
const failures = []
// A red base should name every half that fails, so a failure is recorded and the next check still runs.
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok ${name}`) } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(`       ${String(error.message).split('\n')[0]}`)
  }
}

async function run() {
  const [serumId] = seed()
  const surfaces = {
    bootstrap: async () => { const r = await get('/bootstrap'); return { status: r.status, items: r.json.catalog.items, text: r.text, extra: r.json.products } },
    'catalog page': async () => { const r = await get('/catalog/products'); return { status: r.status, items: r.json.items, text: r.text } },
    search: async () => { const r = await get('/catalog/products/search'); return { status: r.status, items: r.json.items, text: r.text } },
    'one product by id': async () => { const r = await get(`/catalog/products/search?productId=${serumId}`); return { status: r.status, items: r.json.items, text: r.text } },
    'typo fallback': async () => { const r = await get('/catalog/products/search?query=serun'); return { status: r.status, items: r.json.items, text: r.text } },
  }

  await check('controls: with prices shown every surface carries the price and the discount amount', async () => {
    for (const [name, load] of Object.entries(surfaces)) {
      const { status, items, text } = await load()
      assert.equal(status, 200, name)
      assert.ok(items.length > 0, `${name}: has products`)
      assert.ok(priceKeys(items).length >= 2, `${name}: price fields present`)
      assert.ok(text.includes('17.31'), `${name}: the price number is on the wire`)
    }
  })

  await check('prices hidden: no surface publishes a price, a discount amount, or the number itself', async () => {
    setSetting('customer_portal_show_prices', '0')
    tokens.settings = 's2' // what PUT /api/settings does (bumpVersion('settings'))
    for (const [name, load] of Object.entries(surfaces)) {
      const { status, items, text, extra } = await load()
      assert.equal(status, 200, name)
      assert.ok(items.length > 0, `${name}: still lists products`)
      assert.deepStrictEqual(priceKeys(items), [], `${name}: price fields`)
      if (extra) assert.deepStrictEqual(priceKeys(extra), [], `${name}: products alias`)
      for (const number of PRICE_NUMBERS) assert.ok(!text.includes(number), `${name}: ${number} must not be on the wire`)
      assert.ok(items.every((item) => item.name && item.id), `${name}: the card still has its name and id`)
    }
    const cream = (await get('/catalog/products/search')).json.items.find((item) => item.name === 'Cream Beta')
    assert.equal(cream.discount_percent, 15, 'a percent badge is not a price and stays')
    assert.equal(cream.discount_enabled, 1)
  })

  await check('the cached body follows the setting through the settings version in its key', async () => {
    // Same URL, same isolate, prices shown then hidden: only the settings token moved.
    setSetting('customer_portal_show_prices', '1'); tokens.settings = 's3'
    const shown = await get('/catalog/products/search?query=serum')
    assert.ok(priceKeys(shown.json.items).length >= 2)
    setSetting('customer_portal_show_prices', '0'); tokens.settings = 's4'
    const hidden = await get('/catalog/products/search?query=serum')
    assert.deepStrictEqual(priceKeys(hidden.json.items), [], 'a new settings version never reads the old body')
    assert.ok(edge.size >= 2, 'both generations were stored under different keys')
    const keys = [...edge.keys()].filter((url) => url.includes('/__portal-edge/body/search') && url.includes('query=serum'))
    assert.ok(keys.some((url) => url.includes('s3')) && keys.some((url) => url.includes('s4')), 'the settings token is in the key')
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
    assert.match(source, /body: \['portal-body-v2', deploy, version\('products'\), version\('settings'\)/, 'the body key is built from the settings version')
  })

  await check('/promotions does not publish a deactivated linked product', async () => {
    const [activeId, hiddenId] = [serumId, seedStockFixture(db, () => db.prepare(
      "INSERT INTO products (name, brand, selling_price_usd, is_active, image_path) VALUES ('Retired Lotion', 'Old', 5, 0, '/uploads/retired.jpg') RETURNING id").get()).id]
    exec(`INSERT INTO promotions (title, link_type, link_product_id, is_active, sort_order) VALUES
      ('Live link', 'product', ${activeId}, 1, 1), ('Dead link', 'product', ${hiddenId}, 1, 2), ('Plain', 'none', NULL, 1, 3)`)
    tokens.promotions = 'm2'
    const { status, json, text } = await get('/promotions')
    assert.equal(status, 200)
    const byTitle = Object.fromEntries(json.items.map((item) => [item.title, item]))
    assert.equal(byTitle['Live link'].link_product_name, 'Serum Alpha', 'control: an active product is still named')
    assert.equal(byTitle['Dead link'].link_product_name, null, 'a deactivated product is not named')
    assert.equal(byTitle['Dead link'].link_product_image, null, 'nor its image shown')
    assert.equal(byTitle['Dead link'].link_product_id, null, 'nor its id handed to the page')
    assert.ok(!text.includes('Retired Lotion') && !text.includes('retired.jpg'))
    assert.equal(byTitle.Plain.link_product_id, null)
  })

  await check('loyalty off: the public config carries no earning or redeeming rates', async () => {
    setSetting('customer_portal_points_per_usd', '7'); setSetting('customer_portal_redeem_points', '250')
    setSetting('customer_portal_redeem_value_usd', '3'); setSetting('customer_portal_submission_reward_points', '40')
    setSetting('loyalty_points_enabled', 'false'); tokens.settings = 's5'
    const off = (await get('/config')).json
    assert.equal(off.loyaltyPointsEnabled, false, 'the page still learns the programme is off')
    for (const key of ['pointsBasis', 'pointsPerUsd', 'pointsPerKhr', 'redeemPoints', 'redeemValueUsd', 'redeemValueKhr', 'submissionRewardPoints']) {
      assert.ok(!(key in off), `${key} must not be published while loyalty is off`)
    }
    assert.ok(!(await get('/bootstrap')).text.includes('"pointsPerUsd"'))
    setSetting('loyalty_points_enabled', 'true'); tokens.settings = 's6'
    const on = (await get('/config')).json
    assert.equal(on.pointsPerUsd, 7, 'control: with the programme on the rates are published as before')
    assert.equal(on.redeemPoints, 250)
    assert.equal(on.submissionRewardPoints, 40)
  })

  await check('/ai/status is answered from the edge for a short while (a flood does not reach D1)', async () => {
    setSetting('customer_portal_ai_enabled', 'true'); tokens.settings = 's7'
    const counter = queries()
    try {
      const first = await get('/ai/status')
      assert.equal(first.status, 200)
      const afterFirst = counter.count()
      assert.ok(afterFirst > 0, 'the first answer is built from D1')
      for (let i = 0; i < 20; i += 1) {
        const again = await get(`/ai/status?cachebust=${i}`)
        assert.equal(again.status, 200)
        assert.deepStrictEqual(again.json, first.json, 'same answer')
      }
      assert.equal(counter.count(), afterFirst, '20 more calls (each with a different query string) read nothing from D1')
    } finally { counter.stop() }
    setSetting('customer_portal_ai_enabled', 'false'); tokens.settings = 's8'
    assert.equal((await get('/ai/status')).json.enabled, false, 'a settings change is seen at once (the version moved)')
  })

  console.log(`\n${passed} checks passed, ${failures.length} failed`)
  if (failures.length) process.exitCode = 1
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
