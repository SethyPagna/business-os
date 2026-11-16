const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// THE STOREFRONT LOW-STOCK PARITY TEST.
//
// The public storefront's Low stock / Out of stock labels use the storefront's OWN levels, by owner decision of 16 Nov 2026 ("Website's own
// levels"): the Website Editor's customer_portal_* thresholds when the editor is set to website-wide thresholds ('global') and a level is filled
// in, and otherwise the SHOP's low-stock setting (lib/lowStockSettings.ts: alert switch, threshold mode, global number, per-product override,
// per-product out threshold) -- never a fixed 10. Inventory, the bell and the Dashboard keep the shop setting.
//
// This file loads the REAL routes/portal.ts (the harness of test-portal-search-relevance-order-pure.cjs) and the REAL lib/lowStockSettings.ts
// and compares, for every combination of the three website rows (set, empty, invalid) x the three shop rows x per-product overrides x out
// thresholds x quantities: (1) the label function against an independent oracle; (2) the real search endpoint's stock_status, its per-branch
// availability and its stockState filter pills against the same oracle, over seeded products. It also pins that exact quantities, thresholds
// and the branch ledger never appear in the public payload. The AI assistant's mapping is pinned by test-portal-ai-stock-status-pure.cjs.
//
// Mutants (kept honest by the controls below, and run by hand against this file): the literal 10 back in portalStockStatusFor or the stockState
// SQL; ignoring the website levels; ignoring the shop fallback; the old in_stock pill without the out clause.
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
const fakeExecutionCtx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}) }, passThroughOnException: () => {} }

const lowStockLib = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => db } })
const { resolveLowStockConfig, isLowStock } = lowStockLib
const { portalStockStatusFor, resolvePortalStockRule } = portalRoute
// The Website Editor preview's own resolver (it hides client-side from the status the server served), loaded as shipped.
const frontendPortal = require('../../frontend/src/components/catalog/portalCatalogDisplay.ts')

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

// ---- the oracle: written from the owner's rule, not from the implementation -------------------------------------------------------------
// A website level counts when it is a non-blank, finite, non-negative number. Only 'global' mode ("Use website-wide thresholds") uses the
// website levels at all. An empty website level falls back to the SHOP's rule (low) or to the product's own out threshold (out).
function websiteLevel(raw) {
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : null
}
function oracle(web, shop, qty, low, out) {
  const useWebsite = web.customer_portal_stock_threshold_mode === 'global'
  const webLow = useWebsite ? websiteLevel(web.customer_portal_low_stock_threshold) : null
  const webOut = useWebsite ? websiteLevel(web.customer_portal_out_of_stock_threshold) : null
  const productOut = Number(out)
  const outLevel = webOut !== null ? webOut : (Number.isFinite(productOut) ? productOut : 0)
  if (Number(qty) <= outLevel) return 'out_of_stock'
  if (webLow !== null) return Number(qty) <= webLow ? 'low_stock' : 'in_stock'
  // The shop's rule, from the shared module (the same one the bell and the admin lists use); qty is already above out here.
  return isLowStock(resolveLowStockConfig(shop), qty, low, 0) ? 'low_stock' : 'in_stock'
}
const merged = (web, shop) => ({ ...shop, ...web })

// Website rows. `undefined` = the row was never written.
function webFor(mode, low, out) {
  const map = {}
  if (mode !== undefined) map.customer_portal_stock_threshold_mode = mode
  if (low !== undefined) map.customer_portal_low_stock_threshold = low
  if (out !== undefined) map.customer_portal_out_of_stock_threshold = out
  return map
}
const WEB_LOWS = [undefined, '', '   ', '0', '5', '2.5', 'abc', '-3', null, '1e999']
const WEB_OUTS = [undefined, '0', '2', '', 'abc', '-1', '8']
const WEBSITE = []
for (const low of WEB_LOWS) for (const out of WEB_OUTS) WEBSITE.push(webFor('global', low, out))
// Anything but exactly 'global' leaves the editor's levels unused, even with numbers filled in.
for (const mode of [undefined, 'product', 'Global', 'nonsense']) WEBSITE.push(webFor(mode, '5', '2'))

// Shop rows, a spread of every kind of value.
const SHOP = []
for (const e of [undefined, 'false', 'off']) for (const m of [undefined, 'product', 'global', 'GLOBAL', 'nonsense']) {
  for (const t of [undefined, '0', '3', '25', '2.5', 'abc', '-1', null]) {
    const map = {}
    if (e !== undefined) map.low_stock_alert_enabled = e
    if (m !== undefined) map.low_stock_threshold_mode = m
    if (t !== undefined) map.low_stock_threshold_default = t
    SHOP.push(map)
  }
}
SHOP.push({ low_stock_alert_enabled: 'true', low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' })

// Per-product overrides (null = the column is NULL), out thresholds, quantities.
const LOWS = [null, 0, 2, 3, 10, 2.5, 100]
const OUTS = [null, 0, 2, 5]
const QTYS = [-3, 0, 1, 2, 3, 4, 5, 6, 10, 11, 100, 101]

await_main().catch((error) => { console.error(error); process.exit(1) })

async function await_main() {
  // 1. The pure label function against the oracle: every website row x shop row x low x out x quantity.
  await check('the label equals the owner rule for every website row (set, empty, invalid), shop row, override, out threshold and quantity', () => {
    let compared = 0
    const seen = new Set()
    for (const web of WEBSITE) for (const shop of SHOP) {
      const rule = resolvePortalStockRule(merged(web, shop))
      for (const low of LOWS) for (const out of OUTS) for (const qty of QTYS) {
        const got = portalStockStatusFor(rule, qty, low, out)
        const want = oracle(web, shop, qty, low, out)
        assert.equal(got, want, `web ${JSON.stringify(web)} shop ${JSON.stringify(shop)} low=${low} out=${out} qty=${qty}`)
        seen.add(got)
        compared += 1
      }
    }
    assert.ok(compared > 1000000, `the matrix must be large (${compared})`)
    assert.deepEqual([...seen].sort(), ['in_stock', 'low_stock', 'out_of_stock'], 'the matrix must reach all three labels')
  })

  // 2. Controls that the old behaviours cannot pass: a literal 10, ignoring the website levels, ignoring the shop fallback.
  const at = (settings, qty, low, out = 0) => portalStockStatusFor(resolvePortalStockRule(settings), qty, low, out)
  await check('CONTROL: the website levels move the label (a rule that ignores them, or a fixed 10, cannot pass)', () => {
    const web = { customer_portal_stock_threshold_mode: 'global', customer_portal_low_stock_threshold: '4', customer_portal_out_of_stock_threshold: '1' }
    assert.equal(at(web, 5, 10), 'in_stock', 'website low 4: five is healthy although the product says 10')
    assert.equal(at(web, 4, 100), 'low_stock', 'website low 4: four is low although the product says 100')
    assert.equal(at(web, 1, 0), 'out_of_stock', 'website out 1: one is out although the product says 0')
    assert.equal(at(web, 2, 0), 'low_stock')
    assert.equal(at({ ...web, customer_portal_stock_threshold_mode: 'product' }, 5, 10), 'low_stock', 'product mode: the website levels are not used')
    assert.equal(at({ ...web, customer_portal_low_stock_threshold: '25' }, 20, 0), 'low_stock', 'website low 25: twenty is low')
    assert.equal(at({ ...web, low_stock_alert_enabled: 'false' }, 4, 10), 'low_stock', 'the website level stands even when the shop alerts are off')
  })
  await check('CONTROL: an empty website level falls back to the SHOP setting, never a fixed 10', () => {
    const empty = { customer_portal_stock_threshold_mode: 'global', customer_portal_low_stock_threshold: '', customer_portal_out_of_stock_threshold: '' }
    assert.equal(at({ ...empty, low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }, 5, 10), 'in_stock', 'shop global 3: five is healthy')
    assert.equal(at({ ...empty, low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' }, 20, 0), 'low_stock', 'shop global 25: twenty is low')
    assert.equal(at({ ...empty, low_stock_alert_enabled: 'false' }, 1, 10), 'in_stock', 'shop alerts off: no low label')
    assert.equal(at({ ...empty, low_stock_alert_enabled: 'false' }, 0, 10), 'out_of_stock')
    assert.equal(at({ ...empty, low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }, 20, null), 'in_stock', 'an unset product override follows the shop global, not 10')
    assert.equal(at(empty, 5, 0), 'in_stock', 'a stored product override of 0 is honoured, not turned into 10')
    assert.equal(at({ customer_portal_stock_threshold_mode: 'global' }, 10, null), 'low_stock', 'nothing set anywhere: the shop default of 10 applies')
    assert.equal(at({ customer_portal_stock_threshold_mode: 'global', customer_portal_low_stock_threshold: 'abc' }, 5, 3, 0), 'in_stock', 'an invalid website level is ignored: the product 3 applies')
    assert.equal(at({ customer_portal_stock_threshold_mode: 'global', customer_portal_low_stock_threshold: '-3' }, 5, 3, 0), 'in_stock', 'a negative website level is ignored')
  })

  // 3. The real endpoint: badge, filter pills and branch availability, over seeded products, for a spread of settings.
  const raw = db.db
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

  const RULE_KEYS = ['low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default', 'customer_portal_stock_threshold_mode', 'customer_portal_low_stock_threshold', 'customer_portal_out_of_stock_threshold']
  const setSettings = (map) => {
    raw.exec(`DELETE FROM settings WHERE key IN (${RULE_KEYS.map((k) => `'${k}'`).join(',')})`)
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

  const G = (low, out) => webFor('global', low, out)
  const ENDPOINT = [
    // [website rows, shop rows]
    [{}, {}],
    [{}, { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }],
    [{}, { low_stock_alert_enabled: 'false' }],
    [G('5', '2'), {}],
    [G('5', '2'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' }],
    [G('5', '2'), { low_stock_alert_enabled: 'false' }],
    [G('', ''), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }],
    [G('', '3'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '25' }],
    [G('25', ''), { low_stock_alert_enabled: 'false' }],
    [G('0', '0'), {}],
    [G('2.5', '1'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '50' }],
    [G('abc', 'abc'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }],
    [G('-4', '-1'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }],
    [G(null, null), {}],
    [G('8', '8'), {}],
    [webFor('product', '5', '2'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }],
    [webFor('Global', '5', '2'), {}],
    [G('5', '2'), { low_stock_alert_enabled: 'true', low_stock_threshold_mode: 'bogus', low_stock_threshold_default: '2.5' }],
  ]
  for (const [web, shop] of ENDPOINT) {
    await check(`endpoint: badge, filter pills and branch availability follow the rule for website ${JSON.stringify(web)} shop ${JSON.stringify(shop)}`, async () => {
      setSettings(merged(web, shop))
      const wantByName = new Map(products.map((p) => [`Fixture ${p.id}`, p]))
      const all = await pages('q=')
      assert.equal(all.length, products.length, 'unfiltered search returns every product')
      const labelOf = new Map()
      for (const item of all) {
        const p = wantByName.get(item.name)
        assert.ok(p, `unknown item ${item.name}`)
        const want = oracle(web, shop, p.qty, p.low, p.out)
        assert.equal(item.stock_status, want, `${item.name} qty=${p.qty} low=${p.low} out=${p.out}`)
        labelOf.set(item.name, item.stock_status)
        const availability = Object.fromEntries((item.branch_availability || []).map((b) => [b.branch_id, b.status]))
        assert.equal(availability[1], oracle(web, shop, p.qty, p.low, p.out), `${item.name} branch 1`)
        assert.equal(availability[2], oracle(web, shop, p.branch2, p.low, p.out), `${item.name} branch 2`)
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
      }
      // Per-branch filtered view: the badge and the pill are judged on that branch's quantity.
      const branchTwo = await pages('q=&branchId=2&stockState=low_stock')
      for (const item of branchTwo) {
        const p = wantByName.get(item.name)
        assert.equal(oracle(web, shop, p.branch2, p.low, p.out), 'low_stock', `${item.name} on branch 2`)
      }
      const expectedBranchTwoLow = products.filter((p) => oracle(web, shop, p.branch2, p.low, p.out) === 'low_stock').length
      assert.equal(branchTwo.length, expectedBranchTwoLow, 'branch 2 low pill lists every low product of that branch')
      assert.ok(states.size >= 2, 'the fixture must exercise more than one label')
    })
  }

  // 4. The settings must reach the endpoint: the same product flips label when the website or the shop changes its rule.
  await check('changing the website or shop level changes the storefront label of one and the same product', async () => {
    const p = products.find((x) => x.low === 10 && x.out === 0 && x.qty === 5)
    assert.ok(p)
    const labelUnder = async (settings) => {
      setSettings(settings)
      const found = (await pages(`q=${encodeURIComponent(`Fixture ${p.id}`)}`)).find((item) => item.name === `Fixture ${p.id}`)
      return found.stock_status
    }
    assert.equal(await labelUnder({}), 'low_stock')
    assert.equal(await labelUnder({ low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }), 'in_stock', 'the shop level moves it')
    assert.equal(await labelUnder({ low_stock_alert_enabled: 'false' }), 'in_stock')
    assert.equal(await labelUnder(G('4', '')), 'in_stock', 'the website level moves it')
    assert.equal(await labelUnder({ ...G('6', ''), low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }), 'low_stock', 'the website level beats the shop level')
    assert.equal(await labelUnder({ ...G('', ''), low_stock_threshold_mode: 'global', low_stock_threshold_default: '3' }), 'in_stock', 'empty website levels: the shop level answers')
  })

  // 5. No leak: the public payloads carry no threshold keys or values beyond what base exposed (none).
  await check('no public payload carries a website or shop threshold row', async () => {
    setSettings(merged(G('4242', '2424'), { low_stock_threshold_mode: 'global', low_stock_threshold_default: '3737' }))
    for (const route of ['/config', '/bootstrap', '/catalog/products/search?q=&page=1&pageSize=20']) {
      const res = await app.request(route, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
      const text = await res.text()
      assert.equal(res.status, 200, route + ' must answer: ' + text.slice(0, 120))
      assert.ok(text.length > 20, route + ' must carry a body')
      for (const needle of ['customer_portal_low_stock_threshold', 'customer_portal_out_of_stock_threshold', 'customer_portal_stock_threshold_mode', 'low_stock_threshold_default', 'stockThresholdMode', 'lowStockThreshold', '4242', '2424', '3737']) {
        assert.ok(!text.includes(needle), `${route} must not carry ${needle}`)
      }
    }
  })

  // 6. "Hide out of stock products" uses the SAME out level as the badge (owner decision of 16 Nov 2026; routes/portal.ts portalVisibleProductFilter).
  // Website-wide mode, low 5, out 3, hide ON. A qty 2 / product out 0 is Out by the website level; B qty 4 / product out 5 is LOW by it (4 > 3); C is healthy;
  // D is empty. So the default list is B and C: before the fix A was listed wearing "Out of stock" and B was hidden from the default list.
  const hideFixture = [
    [3001, 'Hide A qty2 out0', 'HideCatA', 'HideBrandA', 2, 0],
    [3002, 'Hide B qty4 out5', 'HideCatB', 'HideBrandB', 4, 5],
    [3003, 'Hide C qty20 out0', 'HideCatC', 'HideBrandC', 20, 0],
    [3004, 'Hide D qty0 out0', 'HideCatD', 'HideBrandD', 0, 0],
  ]
  const hideInsert = raw.prepare(`INSERT INTO products
    (id, name, sku, barcode, brand, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold,
     is_active, name_normalized, name_key, selling_price_usd)
    VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, NULL, ?, 1, ?, ?, 10)`)
  seedStockFixture(raw, () => {
    // Earlier sections' products leave the storefront: emptied first (an active product with stock cannot be deactivated), then inactive.
    raw.exec('DELETE FROM branch_stock WHERE product_id < 3000')
    raw.exec('UPDATE products SET stock_quantity = 0 WHERE id < 3000')
    raw.exec('UPDATE products SET is_active = 0 WHERE id < 3000')
    for (const [id, name, category, brand, qty, out] of hideFixture) {
      hideInsert.run(id, name, `H${id}`, `${9200000000000 + id}`, brand, category, qty, out, name.toLowerCase(), name.toLowerCase())
      stock.run(id, 1, qty)
    }
  })
  const HIDE_KEYS = ['customer_portal_show_out_of_stock_products', 'customer_portal_show_stock_status']
  const setHide = (settings, show) => {
    setSettings(settings)
    raw.exec(`DELETE FROM settings WHERE key IN (${HIDE_KEYS.map((k) => `'${k}'`).join(',')})`)
    raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('customer_portal_show_out_of_stock_products', show)
  }
  const get = async (route) => {
    const res = await app.request(route, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
    assert.equal(res.status, 200, route)
    return res.json()
  }
  const names = (items) => (items || []).map((item) => item.name).sort()
  const clientVisible = (items) => items.filter((item) => frontendPortal.resolvePortalStockStatus(item, 'all') !== 'out_of_stock')
  const HIDE_SCENARIOS = [
    // [label, settings, expected default list, expected Out pill list]
    ['website-wide low 5 / out 3', G('5', '3'), ['Hide B qty4 out5', 'Hide C qty20 out0'], ['Hide A qty2 out0', 'Hide D qty0 out0']],
    ['website-wide, out level empty: the product out thresholds decide', G('5', ''), ['Hide A qty2 out0', 'Hide C qty20 out0'], ['Hide B qty4 out5', 'Hide D qty0 out0']],
    ['product mode: the website levels are not used', webFor('product', '5', '3'), ['Hide A qty2 out0', 'Hide C qty20 out0'], ['Hide B qty4 out5', 'Hide D qty0 out0']],
  ]
  for (const [label, settings, wantDefault, wantOut] of HIDE_SCENARIOS) {
    await check(`hide out of stock ON, ${label}: search, bootstrap, meta, AI catalog and the editor preview list what the badge allows`, async () => {
      setHide(settings, 'false')
      const search = await get('/catalog/products/search?q=&page=1&pageSize=100')
      assert.deepEqual(names(search.items), wantDefault, 'search, no pill')
      assert.equal(search.total, wantDefault.length, 'search total')
      assert.deepEqual(names((await get('/catalog/products/search?q=&stockState=out_of_stock&page=1&pageSize=100')).items), wantOut, 'the Out pill is the complement of the default list')
      const boot = await get('/bootstrap')
      assert.deepEqual(names(boot.catalog.items), wantDefault, 'bootstrap catalog')
      assert.equal(boot.catalog.total, wantDefault.length, 'bootstrap total')
      const standalone = await get('/catalog/products')
      assert.deepEqual(names(standalone.items), wantDefault, '/catalog/products')
      // Meta counts: a category and a brand appear only while a visible product carries them.
      const wantCats = hideFixture.filter(([, name]) => wantDefault.includes(name)).map(([, , category]) => category).sort()
      const wantBrands = hideFixture.filter(([, name]) => wantDefault.includes(name)).map(([, , , brand]) => brand).sort()
      for (const meta of [boot.meta, await get('/catalog/meta')]) {
        assert.deepEqual(meta.categories.map((row) => row.name).sort(), wantCats, 'meta categories')
        assert.deepEqual(meta.brands.map((row) => row.name).sort(), wantBrands, 'meta brands')
      }
      const ai = await portalRoute.loadPortalAiCatalog(fakeEnv, false, resolvePortalStockRule(settings))
      assert.deepEqual(names(ai), wantDefault, 'AI catalog')
      // The editor preview hides client-side (CatalogPage.tsx: status === 'out_of_stock'); every card the server listed must survive it.
      assert.deepEqual(names(clientVisible(search.items)), wantDefault, 'the preview hides nothing the server listed')
      assert.deepEqual(names(clientVisible(boot.catalog.items)), wantDefault, 'the preview hides nothing the bootstrap listed')
      // And no listed card wears "Out of stock" while hide is on.
      for (const item of [...search.items, ...boot.catalog.items]) assert.notEqual(item.stock_status, 'out_of_stock', `${item.name} is listed but labelled Out`)
    })
  }
  await check('hide out of stock OFF lists every active product, whatever the levels', async () => {
    setHide(G('5', '3'), 'true')
    const every = hideFixture.map(([, name]) => name).sort()
    assert.deepEqual(names((await get('/catalog/products/search?q=&page=1&pageSize=100')).items), every)
    assert.deepEqual(names((await get('/bootstrap')).catalog.items), every)
  })
  await check('the hide clause is byte-identical to the product-threshold SQL in product mode and with an empty website out level', () => {
    const visible = portalRoute.portalVisibleProductFilter
    const was = 'p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)'
    assert.equal(visible(false, resolvePortalStockRule(webFor('product', '5', '3'))), was)
    assert.equal(visible(false, resolvePortalStockRule(G('5', ''))), was)
    assert.equal(visible(false, resolvePortalStockRule({})), was)
    assert.equal(visible(false), was, 'no rule given: the default rule')
    assert.equal(visible(false, resolvePortalStockRule(G('5', '3'))), 'p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > 3')
    assert.equal(visible(true, resolvePortalStockRule(G('5', '3'))), 'p.is_active = 1', 'hide off: nothing about stock')
    const productMode = portalRoute.buildPortalProductFilters({}, true, false, resolvePortalStockRule(webFor('product', '5', '3')))
    assert.ok(productMode.where.includes('COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)'), 'the search default clause is unchanged in product mode')
    const website = portalRoute.buildPortalProductFilters({}, true, false, resolvePortalStockRule(G('5', '3')))
    assert.ok(website.where.includes('COALESCE(p.stock_quantity, 0) > 3'), 'the search default clause uses the website out level')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
  console.log('All storefront low-stock parity checks passed')
}
