// Pins a real fix to routes/portal.ts's initials/A-Z rail fan-out (item 10,
// p8/tests sweep, Sep 16 2026). buildPortalCatalog and
// runPortalProductSearch each fan the real catalog page (attachPortalStockStatus)
// and the brand-initials rail COUNT query out together in one Promise.all.
// Before this fix, a rejection from the initials query alone rejected the
// WHOLE Promise.all -- turning a degraded FACET (the A-Z rail) into a 500
// for the entire catalog page, even though the catalog page itself never
// touched the failing query. The fix settles the initials query
// independently (`.catch(() => [])`) so a shopper still gets their products,
// just without the letter rail.
//
// Same harness shape as test-portal-catalog-sort-pure.cjs: transpile the
// REAL route file against a real in-memory SQLite database, and drive the
// actual Hono app.request(). The ONLY override that differs is '../lib/db':
// its getDb() wraps the real D1Compat so that ONE specific query -- the
// initials rail (unmistakably identified by its `GROUP BY value` shape,
// which no other query in this route uses) -- rejects, while every other
// query (the catalog page itself) runs for real. This is deliberately NOT a
// full stub of the db, because a stub would prove nothing about which half
// of the Promise.all actually failed.
//
// Run (from cloudflare/): node scripts/test-portal-initials-fanout-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const realDb = openDb(loadAll())
const fakeEnv = { DB: realDb, ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

// Fails ONLY the initials-rail query; every other prepare() call (including
// the catalog page's own reads) goes straight through to the real DB.
const INITIALS_QUERY_FINGERPRINT = 'GROUP BY value'
const flakyDb = {
  prepare(sql) {
    if (sql.includes(INITIALS_QUERY_FINGERPRINT)) {
      return {
        bind: () => this,
        all: async () => { throw new Error('simulated D1 failure on the initials rail query') },
        get: async () => { throw new Error('simulated D1 failure on the initials rail query') },
        run: async () => { throw new Error('simulated D1 failure on the initials rail query') },
      }
    }
    return realDb.prepare(sql)
  },
  batch: (items) => realDb.batch(items),
  exec: (sql) => realDb.exec(sql),
  get staging() { return this },
}

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
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const portalRoute = loadReal('routes/portal.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': { getDb: () => flakyDb },
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/familyPagination': loadReal('lib/familyPagination.ts'),
  '../lib/cache': {
    cachedJsonResponse: async (_req, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0',
  },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/promotionRulesSql': { loadActivePromotionRules: async () => [], productPromotedSql: () => '0', productDiscountActiveSql: () => '0', anyRuleAppliesSql: () => '0', singleRuleAppliesSql: () => '0' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/portalAbuseKey': loadReal('lib/portalAbuseKey.ts'),
  '../lib/safeLinkUrl': loadReal('lib/safeLinkUrl.ts'),
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

let branchId
function seed() {
  realDb.exec(`DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches;`)
  branchId = realDb.prepare(
    `INSERT INTO branches (name, is_active, is_default) VALUES ('Main', 1, 1) RETURNING id`,
  ).get().id
  const rows = [
    { name: 'Zinc Cream', brand: 'Sulwhasoo' },
    { name: 'Argan Oil', brand: 'Dior' },
  ]
  for (const r of rows) {
    const id = realDb.prepare(
      `INSERT INTO products (name, brand, is_active, stock_quantity, out_of_stock_threshold)
       VALUES (@name, @brand, 1, 10, 0) RETURNING id`,
    ).get(r)?.id
    realDb.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 10)`).run({ id, branchId })
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function run() {
  seed()

  // Sanity: the fingerprinted fake really does reject on its own, so a green
  // result below is not just "the mock was a no-op".
  await check('sanity: the wrapped db really does reject the fingerprinted initials query', async () => {
    await assert.rejects(() => flakyDb.prepare('SELECT 1 GROUP BY value').all())
  })

  await check('GET /catalog/products (bootstrap) still returns the catalog page when the initials rail query rejects', async () => {
    const { status, json } = await get('/catalog/products')
    assert.equal(status, 200, 'a facet failure must never turn into a whole-catalog 500')
    const names = (json.items || []).map((p) => p.name)
    assert.deepStrictEqual(new Set(names), new Set(['Zinc Cream', 'Argan Oil']), 'the real catalog page must still be served')
    assert.deepStrictEqual(json.initials, [], 'the rail degrades to an empty array instead of taking the whole request down with it')
  })

  await check('GET /catalog/products/search still returns results when the initials rail query rejects', async () => {
    const { status, json } = await get('/catalog/products/search?page=1&pageSize=50')
    assert.equal(status, 200, 'a facet failure must never turn into a whole-search 500')
    const names = (json.items || []).map((p) => p.name)
    assert.deepStrictEqual(new Set(names), new Set(['Zinc Cream', 'Argan Oil']))
    assert.deepStrictEqual(json.initials, [])
  })

  console.log(`\n${passed} checks passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
