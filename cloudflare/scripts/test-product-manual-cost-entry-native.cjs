// P10-10 (owner ruling, 2026-09-17, verbatim): "the cost price should also
// add the changed if i manually change the cost price, the cost price
// should be updated in record." Real Hono routes/products.ts PUT /:id, real
// lib/catalogCostRecompute.ts (recordManualCostEntry + recomputeCatalogCost),
// real lib/productDetailRule.ts, on the actual migrated SQLite schema
// (migration 0177 included). Only auth/permissions/audit/cache/broadcast/
// image services are fixture-only.
//
// Run (from cloudflare/): node scripts/test-product-manual-cost-entry-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.resolve(__dirname, '../src')
const database = openDb(loadAll(path.resolve(__dirname, '../migrations')))
const raw = database.db

const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { return raw.prepare(sql).get(...values) ?? null },
      async run() {
        const result = raw.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    raw.exec('BEGIN IMMEDIATE')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  },
}
const env = { DB }

const real = new Set([
  'acquisitionCostAccess',
  'productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db',
  'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate',
  'reviewApply', 'conflictControl', 'renameCascade', 'schemaProbe', 'catalogCostRecompute',
])
const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
class ProductImageAssetError extends Error {}
const services = {
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  permissions: {
    getPermissionTier: (u) => u.tier || 'full', getActionTier: (u) => u.tier || 'full',
    hasPermission: (u) => u.tier !== 'none', isActionBlocked: () => false, isAdminControlUser: () => true,
  },
  audit: { audit: async () => {} },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
  broadcastHub: { broadcast: async () => {} },
  media: { sanitizeMediaList: () => [] },
  importImageMatch: { MAX_IMAGES_PER_PRODUCT: 3 },
  productImagePermission: { ProductImageAssetError, productImageFieldsChanged: () => false, productImageFieldsChangedResolved: async () => false, resolveProductImageFields: async () => {}, omitUnchangedProductImageFields: () => {} },
}
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = path.join(src, relative)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: filename }).outputText
  const localRequire = request => {
    if (request === 'hono') return { Hono }
    const name = request.split('/').pop()
    if (relative === 'lib/acquisitionCostAccess.ts' && name === 'permissions') return load('lib/permissions.ts')
    if (services[name]) return services[name]
    if (real.has(name)) return load(`lib/${name}.ts`)
    if (request.startsWith('.')) return noop
    return require(request)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  cache.set(relative, mod.exports); return mod.exports
}

const products = load('routes/products.ts').default
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
const admin = { id: 9, username: 'sethy', name: 'Sethy Owner', tier: 'full', permissions: JSON.stringify({ product_cost_view: true, product_cost_edit: true }) }

async function request(method, url, body) {
  const response = await products.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ...env, TEST_USER: admin }, context)
  return { status: response.status, body: await response.json() }
}
const row = (id) => raw.prepare('SELECT * FROM products WHERE id=?').get(id)
const costEntries = (id) => raw.prepare('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id').all(id)

function seedProduct(name) {
  return Number(raw.prepare(`INSERT INTO products(name, cost_price_usd, cost_price_khr, is_active, updated_at) VALUES (?, 7, 0, 1, NULL)`).run(name).lastInsertRowid)
}
function seedLot(productId, unitCostUsd) {
  return Number(raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (?, ?, 1, ?)`)
    .run(productId, `k${Math.random()}`, unitCostUsd).lastInsertRowid)
}
// A D1Compat-shaped wrapper (get/all/run, named @params) for lib functions
// called directly (recomputeCatalogCost, catalogCostRecomputeStatement,
// getCatalogCostBreakdown) rather than through the Hono route.
function makeDb() {
  return {
    prepare(sql) {
      return {
        async get(params) { const { translated, values } = bindNamed(sql, params); return raw.prepare(translated).get(...values) },
        async all(params) { const { translated, values } = bindNamed(sql, params); return raw.prepare(translated).all(...values) },
        async run(params) {
          const { translated, values } = bindNamed(sql, params)
          const result = raw.prepare(translated).run(...values)
          return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
        },
      }
    },
  }
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name} - ${e.stack}`); process.exitCode = 1 }
}

async function main() {
  await check('a manual cost edit records a baseline (MAX lot id at edit time) and OVERRIDES -- result is the entry cost, not the mean with the existing lots', async () => {
    const id = seedProduct('Serum')
    seedLot(id, 3)
    const lot2 = seedLot(id, 5)
    const result = await request('PUT', `/${id}`, { cost_price_usd: 10 })
    assert.equal(result.status, 200, JSON.stringify(result))
    const entries = costEntries(id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].source, 'manual')
    assert.equal(entries[0].cost_usd, 10)
    assert.equal(entries[0].user_name, 'sethy')
    assert.equal(entries[0].user_id, 9)
    assert.equal(entries[0].baseline_batch_id, lot2, 'baseline is the highest lot id that already existed for this product')
    // Owner correction (2026-09-17): "before might be (n+n1+n2)/3, after
    // override just becomes n" -- NOT mean(3, 5, 10).
    assert.equal(row(id).cost_price_usd, 10)
  })

  await check("owner's override sequence, driven end to end through the real route: 3,5 -> override 10 -> add lot 12 -> override 4 -> add lot 6", async () => {
    const id = seedProduct('OverrideSequence')
    seedLot(id, 3)
    seedLot(id, 5)
    const firstOverride = await request('PUT', `/${id}`, { cost_price_usd: 10 })
    assert.equal(firstOverride.status, 200, JSON.stringify(firstOverride))
    assert.equal(row(id).cost_price_usd, 10, 'override replaces the mean, not one more input to it')

    // Add-stock lot AFTER the override baseline: writers call recomputeCatalogCost
    // themselves (routes/inventory.ts etc), simulated here the same way.
    const db = makeDb()
    seedLot(id, 12)
    const { recomputeCatalogCost } = load('lib/catalogCostRecompute.ts')
    await recomputeCatalogCost(db, id)
    assert.equal(row(id).cost_price_usd, 11, '(10+12)/2 = 11')

    const secondOverride = await request('PUT', `/${id}`, { cost_price_usd: 4 })
    assert.equal(secondOverride.status, 200, JSON.stringify(secondOverride))
    assert.equal(row(id).cost_price_usd, 4, 'the second override again replaces the mean, not (10+12+4)/3')
    assert.equal(costEntries(id).length, 2, 'both overrides are kept for the record')

    seedLot(id, 6)
    await recomputeCatalogCost(db, id)
    assert.equal(row(id).cost_price_usd, 5, '(4+6)/2 = 5 -- only the lot received after the SECOND override counts')
  })

  await check('resaving the SAME cost writes no second entry', async () => {
    const id = seedProduct('Repeat')
    seedLot(id, 3)
    const first = await request('PUT', `/${id}`, { cost_price_usd: 9 })
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.equal(costEntries(id).length, 1)
    const second = await request('PUT', `/${id}`, { cost_price_usd: 9 })
    assert.equal(second.status, 200, JSON.stringify(second))
    assert.equal(costEntries(id).length, 1, 'no-op resave does not create a fresh history row')
  })

  await check('an edit that never touches cost_price_usd/khr records nothing', async () => {
    const id = seedProduct('NameOnly')
    const result = await request('PUT', `/${id}`, { name: 'NameOnly Renamed' })
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(costEntries(id).length, 0)
  })

  await check('the breakdown lists lots before an override as excluded: overridden, and the override row as included', async () => {
    const id = seedProduct('Breakdown')
    raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, lot_code, received_at) VALUES (?, 'lotA', 1, 3, 'LOTA', '2026-01-01')`).run(id)
    raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, lot_code, received_at) VALUES (?, 'lotB', 1, 5, 'LOTB', '2026-01-02')`).run(id)
    const edit = await request('PUT', `/${id}`, { cost_price_usd: 10 })
    assert.equal(edit.status, 200, JSON.stringify(edit))
    const { getCatalogCostBreakdown } = load('lib/catalogCostRecompute.ts')
    const breakdown = await getCatalogCostBreakdown(makeDb(), id)
    const lotRows = breakdown.inputs.filter((row) => row.source === 'lot')
    const manualRows = breakdown.inputs.filter((row) => row.source === 'manual')
    assert.equal(lotRows.length, 2)
    assert.ok(lotRows.every((row) => row.lot_code))
    assert.ok(lotRows.every((row) => row.excluded === 'overridden'), 'both lots existed before the override baseline')
    assert.equal(manualRows.length, 1)
    assert.equal(manualRows[0].user_name, 'sethy')
    assert.equal(manualRows[0].excluded, null, 'the (only, latest) override itself counts')
    assert.equal(breakdown.result_usd, 10)
  })

  await check("the SQL twin (catalogCostRecomputeStatement, used by stockSession.ts) agrees with the JS/route path on the FULL override sequence", async () => {
    const id = seedProduct('SqlTwin')
    const db = makeDb()
    const { catalogCostRecomputeStatement } = load('lib/catalogCostRecompute.ts')
    const applyTwin = async () => {
      const { sql, params } = catalogCostRecomputeStatement(id)
      const { translated, values } = bindNamed(sql, params)
      raw.prepare(translated).run(...values)
    }

    seedLot(id, 3)
    const lot2 = seedLot(id, 5)
    // Override to 10 (recordManualCostEntry, via the real route -- the SQL
    // twin never writes product_cost_entries itself, only recomputes from it).
    const first = await request('PUT', `/${id}`, { cost_price_usd: 10 })
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.equal(costEntries(id)[0].baseline_batch_id, lot2)
    await applyTwin()
    assert.equal(row(id).cost_price_usd, 10, 'the SQL twin also overrides, not mean(3,5,10)')

    const lot3 = seedLot(id, 12)
    await applyTwin()
    assert.equal(row(id).cost_price_usd, 11, '(10+12)/2 = 11, lot3 is after the baseline')

    const second = await request('PUT', `/${id}`, { cost_price_usd: 4 })
    assert.equal(second.status, 200, JSON.stringify(second))
    assert.equal(costEntries(id)[1].baseline_batch_id, lot3)
    await applyTwin()
    assert.equal(row(id).cost_price_usd, 4, 'the SQL twin also re-overrides on the second entry')

    seedLot(id, 6)
    await applyTwin()
    assert.equal(row(id).cost_price_usd, 5, '(4+6)/2 = 5')
  })

  console.log(`\n${checks} checks passed`)
}

function bindNamed(sql, params) {
  const values = []
  const translated = sql.replace(/@(\w+)/g, (_m, name) => { values.push((params || {})[name] ?? null); return '?' })
  return { values, translated }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
