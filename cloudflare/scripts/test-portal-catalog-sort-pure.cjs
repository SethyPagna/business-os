// Regression test for the public catalog's BRAND-first browsing order
// (G4, Part 399: was category-first from Part 226 until the user flipped
// the storefront to browse by brand)
// (routes/portal.ts's PORTAL_CATALOG_DEFAULT_ORDER_SQL) -- added when the
// admin Products/Inventory pages' own category-header sort (Part 226:
// category A-Z first, name A-Z within category, "Uncategorized" pinned
// last) was extended to the public customer catalog, which is server-
// paginated and needed a real backend ORDER BY rather than the admin
// side's client-side grouping.
//
// Same approach as test-reset-products-pure.cjs: transpile the REAL route
// file and run it against a real in-memory SQLite database with every real
// migration applied, calling the actual Hono app.request() the same way
// the real Worker would. This exercises both call sites that share the
// order constant: GET /catalog/products (buildPortalCatalog's bootstrap
// snapshot) and GET /catalog/products/search with no search term (the
// endpoint every page/filter change actually hits).
//
// What this exists to prove:
// 1. Categories sort A-Z (case-insensitive), and products sort A-Z within
//    each category -- a real two-level sort, not just "some order".
// 2. Products with a blank/whitespace-only category sort into a single
//    "Uncategorized" bucket at the END, not interleaved alphabetically
//    (which an empty string would otherwise do, since '' sorts before
//    every real category name).
// 3. Mixed-case category values ("Skincare" vs "skincare") are treated as
//    the same bucket for ordering purposes, matching the admin side's own
//    case-insensitive grouping.
// 4. An active search term switches the order to relevance-first (name
//    tiebreaker), NOT category-first -- confirming the two orders don't
//    collide when the FTS/matchRankSql path is taken instead.
//
// Run (from cloudflare/): node scripts/test-portal-catalog-sort-pure.cjs

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

const portalRoute = loadReal('routes/portal.ts', {
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

  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/portalAccounts': { signupPortalAccount: async () => ({ ok: false }), signinPortalAccount: async () => ({ ok: false }) },
  '../lib/portalSession': { createPortalSession: async () => ({ token: '', expiresAt: '' }), setPortalCookie: () => {}, clearPortalCookie: () => {}, revokePortalSession: async () => {}, getPortalAccount: async () => null },
  '../lib/portalAuthLockout': { getPortalLockoutState: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), recordPortalFailure: async () => ({ locked: false, failedCount: 0, retryAfterSeconds: 0 }), clearPortalLockout: async () => {} },
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/\D/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (name) => name },
  '../lib/media': { sanitizeMediaList: (list) => list },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
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
  exec(`DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches;`)
  branchId = db.prepare(
    `INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id`
  ).get().id

  // Deliberately inserted OUT of any sorted order, with mixed case and a
  // blank category, so a passing test can only mean the ORDER BY is doing
  // real work -- not accidentally matching insertion order.
  // Same adversarial shape as the category-first era, now on BRAND:
  // mixed case, blank and whitespace-only brands, inserted out of order.
  const rows = [
    { name: 'Zinc Cream', category: 'Skincare', brand: 'Sulwhasoo' },
    { name: 'Argan Oil', category: 'haircare', brand: 'dior' },
    { name: 'Rose Water', category: '', brand: '' },
    { name: 'Vitamin C Serum', category: 'skincare', brand: 'Dior' }, // same bucket as 'dior', different case
    { name: 'Shampoo Bar', category: 'Haircare', brand: 'DIOR' }, // same case-insensitive bucket
    { name: 'Lip Balm', category: '   ', brand: '   ' }, // whitespace-only -- blank-brand bucket
    { name: 'Body Lotion', category: 'Bath & Body', brand: 'Chanel' },
  ]
  for (const r of rows) {
    const id = db.prepare(
      `INSERT INTO products (name, category, brand, is_active, stock_quantity, out_of_stock_threshold)
       VALUES (@name, @category, @brand, 1, 10, 0) RETURNING id`
    ).get(r)?.id
    db.prepare(
      `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 10)`
    ).run({ id, branchId })
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  \u2713 ${name}`)
}

async function run() {
  seed()

  await check('bootstrap catalog (GET /catalog/products) is BRAND-first, name-second, case-insensitive, blank brands last', async () => {
    const { status, json } = await get('/catalog/products')
    assert.equal(status, 200)
    const names = json.items.map((p) => p.name)
    assert.deepStrictEqual(names, [
      'Body Lotion',       // Chanel
      'Argan Oil',         // dior (same case-insensitive bucket, name A-Z within)
      'Shampoo Bar',       // DIOR
      'Vitamin C Serum',   // Dior
      'Zinc Cream',        // Sulwhasoo
      'Lip Balm',          // blank brand (whitespace-only), name A-Z within
      'Rose Water',        // blank brand
    ])
  })

  await check('search endpoint, no search term, defaults to the same brand-first order', async () => {
    const { status, json } = await get('/catalog/products/search?page=1&pageSize=50')
    assert.equal(status, 200)
    const names = json.items.map((p) => p.name)
    assert.deepStrictEqual(names, [
      'Body Lotion', 'Argan Oil', 'Shampoo Bar', 'Vitamin C Serum', 'Zinc Cream', 'Lip Balm', 'Rose Water',
    ])
  })

  await check('search endpoint WITH a search term switches to relevance order, not brand order', async () => {
    // "Serum" only matches one product here -- what this actually proves
    // is that the search path takes a different, non-category-first code
    // branch at all (matchRankSql present), not the specific ranking of
    // multiple hits.
    const { status, json } = await get('/catalog/products/search?q=Serum')
    assert.equal(status, 200)
    assert.ok(json.items.some((p) => p.name === 'Vitamin C Serum'), 'expected the Serum product to be found via search')
  })

  await check('6.5: pagination counts GROUPS and a page carries every row of its groups', async () => {
    // 'Dior Lip Glow' = a 3-row name group; with the 7 visible singles
    // seeded above the catalog holds 8 CARDS over 10 rows. A row-paged
    // server used to report totals/pages from the 10.
    for (const barcode of ['g1', 'g2', 'g3']) {
      const id = db.prepare(
        `INSERT INTO products (name, category, brand, barcode, is_active, stock_quantity, out_of_stock_threshold)
         VALUES ('Dior Lip Glow', 'Lips', 'Dior', @barcode, 1, 4, 0) RETURNING id`
      ).get({ barcode })?.id
      db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 4)`).run({ id, branchId })
    }
    const { status, json } = await get('/catalog/products/search?page=1&pageSize=50')
    assert.equal(status, 200)
    assert.equal(json.total, 8, 'total counts groups (8 cards), not rows (10)')
    const glowRows = json.items.filter((p) => p.name === 'Dior Lip Glow')
    assert.equal(glowRows.length, 3, 'every row of an in-window group ships so the client merge has all variants')
    const page1 = await get('/catalog/products/search?page=1&pageSize=2')
    const distinctNames = new Set(page1.json.items.map((p) => p.name))
    assert.equal(distinctNames.size, 2, 'pageSize means CARDS: exactly 2 groups on the page')
    assert.equal(page1.json.totalPages, 4, '8 groups at 2 per page = 4 real pages')
  })

  console.log(`\n${passed} checks passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
