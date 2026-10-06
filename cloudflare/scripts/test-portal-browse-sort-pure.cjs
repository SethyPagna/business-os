// PUBLIC-FILTER-MENU (owner, 5 Oct): the storefront's View + Sort live in the
// filter menu and reach the Worker as `view` and `sort` on
// GET /catalog/products/search.
//
// Same technique as test-portal-catalog-sort-pure.cjs: the REAL routes/portal.ts
// is transpiled and called through its own Hono app against real SQLite with
// every real migration applied, so the ORDER BY under test is the one the
// route builds -- nothing here re-implements it.
//
// What this exists to prove:
//  1. no params = the original brand-first order (the default VIEW is brand);
//  2. view=category groups by category (blank last), name A-Z inside;
//  3. view=all is one flat list under every sort;
//  4. sort orders INSIDE a group (name A-Z / Z-A, price low / high), and a
//     family sorts by its HIGHEST-priced row because that is the price its
//     one card shows;
//  5. a view or sort outside the allowlist -- including an injection string --
//     falls back to the default, answers 200, is reported back in
//     `browse`, and leaves the products table intact;
//  6. a price sort on a store that hides its prices is treated as unknown;
//  7. an explicit sort outranks search relevance, the default does not.
//
// NON-VACUITY: the fixture is built so that brand order, category order,
// name order and price order all disagree with each other. If a future edit
// made two of them agree, the "differs from" controls below go red instead of
// the suite passing while proving nothing.
//
// Run (from cloudflare/): node scripts/test-portal-browse-sort-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const fakeEnv = { DB: db, ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const searchMatch = loadReal('lib/searchMatch.ts')

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const portalRoute = loadReal('routes/portal.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': { getDb: () => db },
  // Real, pure -- its chunking is what keeps these reads inside D1's
  // 100-bound-parameter limit, so a stub would test the stub.
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  // Real, pure -- 6.5 made the portal paginate by GROUP through this
  // shared helper; stubbing it would test the stub's idea of paging.
  '../lib/familyPagination': loadReal('lib/familyPagination.ts'),
  // Caching is transparent to what this test asserts (sort order), so the
  // producer is invoked directly -- exercising the real Cache API here would
  // test Workers, not this route's SQL.
  '../lib/cache': {
    cachedJsonResponse: async (_req, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0',
  },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  // K3 Part 417: portal.ts enqueues on-upload image normalization; this
  // test asserts catalog sort, so a no-op stub is honest.
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  // G1: rules load stubbed empty + promoted-SQL collapsed to a constant --
  // this test asserts pre-existing behavior (sort/wiring), not promotion
  // ranking; test-promotion-rules-pure.cjs covers the real SQL against the
  // real kernel.
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },

  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1', getClientNetworkKey: () => '127.0.0.1', peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {} }, '../lib/planTier': { getPlanLimits: () => ({ portalAiDailyMax: 100, portalAiVisitorDailyMax: 10 }) }, '../lib/businessDateWindow': { BUSINESS_UTC_OFFSET_MINUTES: 420, businessToday: () => '2026-01-01' },
  '../lib/portalAbuseKey': loadReal('lib/portalAbuseKey.ts'),
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
  '../lib/portalText': loadReal('lib/portalText.ts'),
  ...(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'portalImagePrivacy.ts'))
    ? { '../lib/portalImagePrivacy': loadReal('lib/portalImagePrivacy.ts') }
    : {}),
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (name) => name },
  '../lib/media': { sanitizeMediaList: (list) => list },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/searchMatch': searchMatch,
  // routes/portal.ts's search tail and its relevance ordering come from
  // this shared module (the same one products.ts/inventory.ts/branches.ts
  // use). Real, not stubbed: the ORDER BY it produces is exactly what the
  // assertions below are about.
  '../lib/productSearchQuery': loadReal('lib/productSearchQuery.ts', { './searchMatch': searchMatch }),
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const app = portalRoute.default
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function get(url) {
  const res = await app.request(url, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function exec(sql) { db.exec(sql) }

let branchId
function seed() {
  exec('DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM settings;')
  branchId = db.prepare(
    "INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id"
  ).get().id
  // brand / category / price are deliberately uncorrelated with the name order.
  const rows = [
    { name: 'Cream', category: 'Skincare', brand: 'Zed', price: 30 },
    { name: 'Alpha Cream', category: 'Hair', brand: 'Acme', price: 20 },
    { name: 'Zeta Cream', category: 'Skincare', brand: 'Acme', price: 5 },
    { name: 'Mango Mist', category: '', brand: '', price: 10 },
    { name: 'Beta Balm', category: 'Hair', brand: 'Zed', price: 12 },
    { name: 'Gamma Gel', category: 'Bath', brand: 'Bold', price: 99 },
    // A two-row name group: the card shows the 40 row, so it sorts as 40.
    { name: 'Delta Duo', category: 'Bath', brand: 'Bold', price: 2, barcode: 'd1' },
    { name: 'Delta Duo', category: 'Bath', brand: 'Bold', price: 40, barcode: 'd2' },
  ]
  for (const r of rows) {
    const id = db.prepare(
      `INSERT INTO products (name, category, brand, barcode, selling_price_usd, is_active, stock_quantity, out_of_stock_threshold)
       VALUES (@name, @category, @brand, @barcode, @price, 1, 10, 0) RETURNING id`
    ).get({ barcode: null, ...r })?.id
    db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 10)').run({ id, branchId })
  }
}

// One entry per CARD (a name group is one card), in server order.
const cards = (json) => [...new Set(json.items.map((p) => p.name))]
const order = async (query) => {
  const { status, json } = await get('/catalog/products/search?page=1&pageSize=50' + query)
  assert.equal(status, 200, query)
  return { names: cards(json), json }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log('  \u2713 ' + name)
}

async function run() {
  seed()

  const brandFirst = ['Alpha Cream', 'Zeta Cream', 'Delta Duo', 'Gamma Gel', 'Beta Balm', 'Cream', 'Mango Mist']
  const byCategory = ['Delta Duo', 'Gamma Gel', 'Alpha Cream', 'Beta Balm', 'Cream', 'Zeta Cream', 'Mango Mist']
  const flatAz = ['Alpha Cream', 'Beta Balm', 'Cream', 'Delta Duo', 'Gamma Gel', 'Mango Mist', 'Zeta Cream']

  await check('no params: the default VIEW is brand (Acme, Bold, Zed, blank last), name A-Z inside', async () => {
    const { names, json } = await order('')
    assert.deepStrictEqual(names, brandFirst)
    assert.deepStrictEqual(json.browse, { view: 'brand', sort: 'featured' })
  })

  await check('view=category groups by category A-Z, blank last, name A-Z inside', async () => {
    const { names, json } = await order('&view=category')
    assert.deepStrictEqual(names, byCategory)
    assert.deepStrictEqual(json.browse, { view: 'category', sort: 'featured' })
    assert.notDeepStrictEqual(names, brandFirst, 'control: category order must differ from brand order')
  })

  await check('view=all is one flat A-Z list, and name_desc reverses it', async () => {
    assert.deepStrictEqual((await order('&view=all')).names, flatAz)
    assert.deepStrictEqual((await order('&view=all&sort=name_asc')).names, flatAz)
    assert.deepStrictEqual((await order('&view=all&sort=name_desc')).names, [...flatAz].reverse())
    assert.notDeepStrictEqual(flatAz, brandFirst, 'control: flat order must differ from brand order')
  })

  await check('sort works INSIDE a group: brand view keeps brand order, name Z-A within each brand', async () => {
    const { names } = await order('&view=brand&sort=name_desc')
    assert.deepStrictEqual(names, ['Zeta Cream', 'Alpha Cream', 'Gamma Gel', 'Delta Duo', 'Cream', 'Beta Balm', 'Mango Mist'])
  })

  await check('price sort inside a group, and a family sorts by its HIGHEST-priced row', async () => {
    // Bold: Delta Duo (rows 2 and 40 -> sorts as 40) vs Gamma Gel 99.
    const asc = await order('&view=brand&sort=price_asc')
    assert.deepStrictEqual(asc.names, ['Zeta Cream', 'Alpha Cream', 'Delta Duo', 'Gamma Gel', 'Beta Balm', 'Cream', 'Mango Mist'])
    const desc = await order('&view=brand&sort=price_desc')
    assert.deepStrictEqual(desc.names, ['Alpha Cream', 'Zeta Cream', 'Gamma Gel', 'Delta Duo', 'Cream', 'Beta Balm', 'Mango Mist'])
    // Control: ordered by the group's LOWEST row (2), Delta Duo would lead the
    // whole catalog in view=all price_asc. By the highest row (40) it does not.
    const flat = await order('&view=all&sort=price_asc')
    assert.deepStrictEqual(flat.names, ['Zeta Cream', 'Mango Mist', 'Beta Balm', 'Alpha Cream', 'Cream', 'Delta Duo', 'Gamma Gel'])
    assert.deepStrictEqual((await order('&view=all&sort=price_desc')).names, [...flat.names].reverse())
  })

  await check('view=category with a price sort groups first, prices inside', async () => {
    const { names } = await order('&view=category&sort=price_desc')
    assert.deepStrictEqual(names, ['Gamma Gel', 'Delta Duo', 'Alpha Cream', 'Beta Balm', 'Cream', 'Zeta Cream', 'Mango Mist'])
  })

  await check('an unknown view or sort falls back to the default, answers 200, and is reported back', async () => {
    for (const bad of [
      '&sort=bogus', '&view=bogus', '&sort=', '&view=&sort=',
      '&sort=' + encodeURIComponent('name_asc; DROP TABLE products;--'),
      '&sort=' + encodeURIComponent("price_asc' OR 1=1 --"),
      '&view=' + encodeURIComponent('brand); DELETE FROM products;--'),
      '&sort=__proto__', '&sort=constructor', '&view=toString',
    ]) {
      const { names, json } = await order(bad)
      assert.deepStrictEqual(names, brandFirst, 'fallback order for ' + bad)
      assert.deepStrictEqual(json.browse, { view: 'brand', sort: 'featured' }, 'reported fallback for ' + bad)
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 8, 'no injected statement ran')
    // Case and padding of a REAL key are tolerated.
    assert.deepStrictEqual((await order('&view=ALL&sort=%20Name_Desc%20')).names, [...flatAz].reverse())
  })

  await check('a price sort is treated as unknown while the store hides its prices', async () => {
    exec("INSERT INTO settings (key, value) VALUES ('customer_portal_show_prices', '0')")
    const { names, json } = await order('&view=all&sort=price_desc')
    assert.deepStrictEqual(names, flatAz, 'price order must not leak through the grid')
    assert.deepStrictEqual(json.browse, { view: 'all', sort: 'featured' })
    // A name sort is not price data, so it still applies.
    assert.deepStrictEqual((await order('&view=all&sort=name_desc')).names, [...flatAz].reverse())
    exec("DELETE FROM settings WHERE key = 'customer_portal_show_prices'")
    assert.deepStrictEqual((await order('&view=all&sort=price_desc')).json.browse, { view: 'all', sort: 'price_desc' })
  })

  await check('an explicit sort outranks search relevance; the default keeps relevance first', async () => {
    // 'Cream' is the EXACT-name hit (tier 1); the other two only contain the word.
    const relevance = await order('&q=cream')
    assert.equal(relevance.names[0], 'Cream', 'default: exact name leads')
    const priced = await order('&q=cream&view=all&sort=price_asc')
    assert.deepStrictEqual(priced.names, ['Zeta Cream', 'Alpha Cream', 'Cream'], 'explicit price sort wins over relevance')
    assert.notEqual(priced.names[0], relevance.names[0], 'control: the two orders must disagree')
  })

  await check('paging stays total under every view/sort (no repeated or missing card across pages)', async () => {
    for (const q of ['', '&view=category', '&view=all&sort=price_desc', '&view=brand&sort=name_desc']) {
      const seen = []
      for (const page of [1, 2, 3, 4]) {
        const { json } = await get('/catalog/products/search?pageSize=2&page=' + page + q)
        seen.push(...cards(json))
      }
      assert.equal(seen.length, 7, 'every card appears once for ' + q)
      assert.equal(new Set(seen).size, 7, 'no card repeats across pages for ' + q)
    }
  })

  console.log('\n' + passed + ' checks passed.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
