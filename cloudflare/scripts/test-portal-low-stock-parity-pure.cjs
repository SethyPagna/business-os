const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// THE STOREFRONT LOW-STOCK PARITY TEST.
//
// The public storefront's low / out-of-stock label must be the shop's ONE rule (owner, 15 Nov 2026): the same as the notification bell, the
// Dashboard and the admin lists (lib/lowStockSettings.ts: the Settings alert switch, the threshold mode, the global number, the per-product
// override, and the per-product out threshold). It used to carry a rule of its own, a literal 10 plus a customer_portal_* triple, so a shop that set
// its threshold to 3 still saw 'low' at 10 on the storefront.
//
// This file loads the REAL routes/portal.ts (the harness of test-portal-search-relevance-order-pure.cjs) and the REAL lib/lowStockSettings.ts,
// and compares, for every combination of the three Settings rows (unset, valid, zero, negative, fractional, junk, null) x per-product overrides x
// out thresholds x quantities: (1) the label function against the shared rule; (2) the real search endpoint's stock_status, its per-branch
// availability and its stockState filter pills against the same rule, over seeded products. It also pins that exact quantities, thresholds and the
// branch ledger never appear in the public payload.
//
// Mutant (kept honest by the controls below): the literal 10 back in portalStockStatusFor / the stockState SQL turns this red.
//
// Run from the cloudflare directory: node scripts/test-portal-low-stock-parity-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
// Load the actual dependency before any permissive per-module shim is active.
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const db = openDb(loadAll())
assert.throws(() => db.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(), /stock_transaction_required/)
const fakeEnv = { DB: db, ASSETS: null, CACHE: { get: async () => null, put: async () => {} } }

function transpile(relPath) {
  const sourcePath = path.join(root, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(root, 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (['./moneyPrecision', '../lib/moneyPrecision', './moneyPrecision.ts', '../lib/moneyPrecision.ts'].includes(request)) return moneyPrecision
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

// Every module that decides an ORDER is the real one. Only the surrounding
// plumbing (auth, cache, uploads, sessions) is stubbed -- stubbing any of the
// four below would test the stub's idea of the ranking instead of the app's.
const searchMatch = loadReal('lib/searchMatch.ts')
const productSearchQuery = loadReal('lib/productSearchQuery.ts', { './searchMatch': searchMatch, './productStockGuard': require('./harness/product_stock_guard.cjs') })
const familyPagination = loadReal('lib/familyPagination.ts')
const promotionRulesSql = loadReal('lib/promotionRulesSql.ts', { './promotionRules': loadReal('lib/promotionRules.ts') })

const { paginateProductFamilies } = familyPagination
const { loadActivePromotionRules, productPromotedSql } = promotionRulesSql
const { normalizeSearchText } = searchMatch

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const portalRoute = loadReal('routes/portal.ts', {
  '../lib/loyaltyEligibility': loadReal('lib/loyaltyEligibility.ts'),
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  '../lib/requestBodyGuard': loadReal('lib/requestBodyGuard.ts'),
  '../lib/db': { getDb: () => db },
  '../lib/sqlBinding': loadReal('lib/sqlBinding.ts'),
  '../lib/lowStockSettings': loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => db } }),
  '../lib/familyPagination': familyPagination,
  '../lib/searchMatch': searchMatch,
  '../lib/productSearchQuery': productSearchQuery,
  // Real, not a constant: the promoted key is half of what this file is
  // about (it must lead WITHIN a tier and never above one), so stubbing
  // productPromotedSql to '0' would delete the assertion.
  '../lib/promotionRulesSql': promotionRulesSql,
  '../lib/cache': { isUnsafeVersion: () => false, deploymentId: () => 'dev',
    cachedJsonResponse: async (_req, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0', getVersionsWithFallback: async () => [],
  },
  '../lib/auth': { requireAuth: async (c, next) => next() },
  '../lib/permissions': { hasPermission: () => true },
  '../lib/audit': { audit: async () => {} },
  '../lib/readSwitches': { readDataEpoch: async () => 'a'.repeat(32) },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
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
  '../lib/phone': { canonicalizePhone: (v) => String(v || '').replace(/[^0-9]/g, '') || null },
  '../lib/fileAssets': { buildUniqueStoredName: (name) => name },
  '../lib/media': { sanitizeMediaList: (list) => list },
  '../lib/uploadSecurity': { detectBufferKind: () => null },
  '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/portalAi': { generatePortalAiResponse: async () => ({}), getPortalAiUsageStatus: () => ({}) },
  '../lib/importImageMatch': { MAX_IMAGES_PER_PRODUCT: 3, ADMIN_MAX_IMAGES_PER_PRODUCT: 5 },
})

const app = portalRoute.default
const { buildPortalProductFilters } = portalRoute
const fakeExecutionCtx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}) }, passThroughOnException: () => {} }

const portalSrc = fs.readFileSync(path.join(root, 'src', 'routes', 'portal.ts'), 'utf8')

const lowStockLib = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => db } })
const { resolveLowStockConfig, isLowStock } = lowStockLib
const { portalStockStatusFor } = portalRoute

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

// The shop's ONE rule, read from the shared module: out first, then low strictly above out.
function sharedState(config, qty, low, out) {
  const o = Number(out)
  if (Number(qty) <= (Number.isFinite(o) ? o : 0)) return 'out_of_stock'
  return isLowStock(config, qty, low, out) ? 'low_stock' : 'in_stock'
}

// Every combination of the Settings rows. `undefined` = the row was never written.
const ENABLED = [undefined, 'true', 'false', '0', '1', 'off', 'on', 'no', 'yes', '']
const MODE = [undefined, 'product', 'global', 'GLOBAL', 'nonsense']
const THRESHOLD = [undefined, '0', '1', '3', '10', '25', '1000000', '1000001', '-1', '-5', '2.5', 'abc', '', null]
function settingsFor(enabled, mode, threshold) {
  const map = {}
  if (enabled !== undefined) map.low_stock_alert_enabled = enabled
  if (mode !== undefined) map.low_stock_threshold_mode = mode
  if (threshold !== undefined) map.low_stock_threshold_default = threshold
  return map
}
const CONFIGS = []
for (const e of ENABLED) for (const m of MODE) for (const t of THRESHOLD) CONFIGS.push(settingsFor(e, m, t))

// Per-product overrides (null = the column is NULL), out thresholds, quantities.
const LOWS = [null, 0, 2, 3, 10, 2.5, 100]
const OUTS = [null, 0, 2, 5]
const QTYS = [-3, 0, 1, 2, 3, 4, 5, 6, 10, 11, 100, 101]

await_main().catch((error) => { console.error(error); process.exit(1) })

async function await_main() {
  // 1. The pure label function against the shared rule: every config x low x out x quantity.
  await check('the label equals the shared rule for every settings row, override, out threshold and quantity', () => {
    let compared = 0
    const seen = new Set()
    for (const settings of CONFIGS) {
      const config = resolveLowStockConfig(settings)
      for (const low of LOWS) for (const out of OUTS) for (const qty of QTYS) {
        const got = portalStockStatusFor(config, qty, low, out)
        const want = sharedState(config, qty, low, out)
        assert.equal(got, want, `config ${JSON.stringify(settings)} low=${low} out=${out} qty=${qty}`)
        seen.add(got)
        compared += 1
      }
    }
    assert.ok(compared > 100000, `the matrix must be large (${compared})`)
    assert.deepEqual([...seen].sort(), ['in_stock', 'low_stock', 'out_of_stock'], 'the matrix must reach all three labels')
  })

  // 2. It must really read the settings: a control that the literal 10 cannot pass.
  await check('CONTROL: a threshold other than 10 moves the label (the old fixed 10 would not)', () => {
    const at = (settings, qty, low) => portalStockStatusFor(resolveLowStockConfig(settings), qty, low, 0)
    assert.equal(at({ low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }, 5, 10), 'in_stock', 'global 3: five is healthy although the product says 10')
    assert.equal(at({ low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' }, 20, 0), 'low_stock', 'global 25: twenty is low')
    assert.equal(at({}, 20, null), 'in_stock', 'unset row, NULL override: the default of 10 applies')
    assert.equal(at({}, 10, null), 'low_stock')
    assert.equal(at({}, 5, 0), 'in_stock', 'a stored override of 0 is honoured, not turned into 10 (it used to be: Number(0 || 10))')
    assert.equal(at({ low_stock_alert_enabled: 'false' }, 1, 10), 'in_stock', 'alerts off: there is no low label')
    assert.equal(at({ low_stock_alert_enabled: 'false' }, 0, 10), 'out_of_stock', 'alerts off leaves out of stock alone')
  })

  // 3. The real endpoint: badge, filter pills and branch availability, over seeded products, for a spread of settings.
  const raw = db.db
  const BRANCH_IDS = [1, 2]
  seedStockFixture(raw, () => {
    raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)")
    raw.exec("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Second', 1, 0)")
  })
  const insert = raw.prepare(`INSERT INTO products
    (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold,
     is_active, name_normalized, name_key, selling_price_usd)
    VALUES (?, ?, ?, ?, 'B', '', 'pcs', ?, ?, ?, 1, ?, ?, 10)`)
  const stock = raw.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)')
  const products = []
  let nextId = 1000
  for (const low of LOWS) for (const out of OUTS) for (const qty of QTYS.filter((q) => q >= 0)) {
    const id = nextId += 1
    // Branch 1 holds the whole quantity, branch 2 holds one fewer (never below 0): two branches, two answers.
    products.push({ id, low, out, qty, branch2: Math.max(0, qty - 1) })
  }
  seedStockFixture(raw, () => {
    for (const p of products) {
      const name = `Fixture ${p.id}`
      insert.run(p.id, name, `S${p.id}`, `${9000000000000 + p.id}`, p.qty, p.low, p.out, name.toLowerCase(), name.toLowerCase())
      stock.run(p.id, 1, p.qty)
      stock.run(p.id, 2, p.branch2)
    }
  })
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM products').get().n, products.length)

  const setSettings = (map) => {
    raw.exec("DELETE FROM settings WHERE key IN ('low_stock_alert_enabled','low_stock_threshold_mode','low_stock_threshold_default')")
    const put = raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(map)) put.run(key, value === null ? null : String(value))
  }
  async function pages(query) {
    const items = []
    for (let page = 1; page < 40; page += 1) {
      const res = await app.request(`/catalog/products/search?${query}&page=${page}&pageSize=100`, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
      assert.equal(res.status, 200)
      const json = await res.json()
      items.push(...(json.items || []))
      if (page >= (json.totalPages || 1)) break
    }
    return items
  }

  // A representative spread of the settings (the full set is covered above against the same function the endpoint calls).
  const ENDPOINT_SETTINGS = [
    {},
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' },
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: '0' },
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' },
    { low_stock_threshold_mode: 'product', low_stock_threshold_default: '5' },
    { low_stock_alert_enabled: 'false' },
    { low_stock_alert_enabled: 'false', low_stock_threshold_mode: 'global', low_stock_threshold_default: '50' },
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: 'abc' },
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: '-4' },
    { low_stock_threshold_mode: 'global', low_stock_threshold_default: null },
    { low_stock_alert_enabled: 'true', low_stock_threshold_mode: 'bogus', low_stock_threshold_default: '2.5' },
  ]
  for (const settings of ENDPOINT_SETTINGS) {
    await check(`endpoint: badge, filter pills and branch availability follow the shared rule for ${JSON.stringify(settings)}`, async () => {
      setSettings(settings)
      const config = resolveLowStockConfig(settings)
      const wantByName = new Map(products.map((p) => [`Fixture ${p.id}`, p]))
      const all = await pages('q=')
      assert.equal(all.length, products.length, 'unfiltered search returns every product')
      const labelOf = new Map()
      for (const item of all) {
        const p = wantByName.get(item.name)
        assert.ok(p, `unknown item ${item.name}`)
        const want = sharedState(config, p.qty, p.low, p.out)
        assert.equal(item.stock_status, want, `${item.name} qty=${p.qty} low=${p.low} out=${p.out}`)
        labelOf.set(item.name, item.stock_status)
        const availability = Object.fromEntries((item.branch_availability || []).map((b) => [b.branch_id, b.status]))
        assert.equal(availability[1], sharedState(config, p.qty, p.low, p.out), `${item.name} branch 1`)
        assert.equal(availability[2], sharedState(config, p.branch2, p.low, p.out), `${item.name} branch 2`)
        // Redaction: neither exact quantities nor thresholds nor the ledger ride along.
        for (const key of ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold', 'branch_stock']) {
          assert.equal(Object.prototype.hasOwnProperty.call(item, key), false, `${key} must not be public`)
        }
        for (const b of item.branch_availability || []) assert.deepEqual(Object.keys(b).sort(), ['branch_id', 'status'])
      }
      const states = new Set(labelOf.values())
      // The filter pills must list exactly the products that wear that badge.
      for (const state of ['in_stock', 'low_stock', 'out_of_stock']) {
        const got = (await pages(`q=&stockState=${state}`)).map((item) => item.name).sort()
        const want = [...labelOf].filter(([, label]) => label === state).map(([name]) => name).sort()
        assert.deepEqual(got, want, `stockState=${state} must list exactly the ${state} badges`)
        if (state === 'low_stock' && settings.low_stock_alert_enabled === 'false') assert.equal(got.length, 0, 'alerts off: nobody is low')
      }
      // Per-branch filtered view: the badge and the pill are judged on that branch's quantity.
      const branchOne = await pages('q=&branchId=2&stockState=low_stock')
      for (const item of branchOne) {
        const p = wantByName.get(item.name)
        assert.equal(sharedState(config, p.branch2, p.low, p.out), 'low_stock', `${item.name} on branch 2`)
      }
      const expectedBranchTwoLow = products.filter((p) => sharedState(config, p.branch2, p.low, p.out) === 'low_stock').length
      assert.equal(branchOne.length, expectedBranchTwoLow, 'branch 2 low pill lists every low product of that branch')
      assert.ok(states.size >= 2, 'the fixture must exercise more than one label')
    })
  }

  // 4. The settings must reach the endpoint: the same product flips label when the shop changes its rule.
  await check('changing the shop rule changes the storefront label of one and the same product', async () => {
    const p = products.find((x) => x.low === 10 && x.out === 0 && x.qty === 5)
    assert.ok(p)
    const labelUnder = async (settings) => {
      setSettings(settings)
      const found = (await pages(`q=${encodeURIComponent(`Fixture ${p.id}`)}`)).find((item) => item.name === `Fixture ${p.id}`)
      return found.stock_status
    }
    assert.equal(await labelUnder({}), 'low_stock')
    assert.equal(await labelUnder({ low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }), 'in_stock')
    assert.equal(await labelUnder({ low_stock_alert_enabled: 'false' }), 'in_stock')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
  console.log('All storefront low-stock parity checks passed')
}
