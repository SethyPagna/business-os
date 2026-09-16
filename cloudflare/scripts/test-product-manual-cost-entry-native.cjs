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
const admin = { id: 9, username: 'sethy', name: 'Sethy Owner', tier: 'full' }

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
  raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (?, ?, 1, ?)`)
    .run(productId, `k${Math.random()}`, unitCostUsd)
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name} - ${e.stack}`); process.exitCode = 1 }
}

async function main() {
  await check('a manual cost edit records one entry (source manual, user name) and folds into the mean with the lots', async () => {
    const id = seedProduct('Serum')
    seedLot(id, 3)
    seedLot(id, 5)
    const result = await request('PUT', `/${id}`, { cost_price_usd: 4 })
    assert.equal(result.status, 200, JSON.stringify(result))
    const entries = costEntries(id)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].source, 'manual')
    assert.equal(entries[0].cost_usd, 4)
    assert.equal(entries[0].user_name, 'sethy')
    assert.equal(entries[0].user_id, 9)
    // mean(3, 4, 5) = 4
    assert.equal(row(id).cost_price_usd, 4)
  })

  await check('a manual entry more than 2x the cheapest lot is an outlier -- the writer stores the HIGHEST, same guard as a lot receipt', async () => {
    const id = seedProduct('OutlierManual')
    seedLot(id, 3)
    const result = await request('PUT', `/${id}`, { cost_price_usd: 9 })
    assert.equal(result.status, 200, JSON.stringify(result))
    // 9 > 3 * COST_OUTLIER_RATIO(2) -- refused as a mean; highest kept instead.
    assert.equal(row(id).cost_price_usd, 9)
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

  await check('the breakdown lists the lot rows with lot_code and the manual row', async () => {
    const id = seedProduct('Breakdown')
    raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, lot_code, received_at) VALUES (?, 'lotA', 1, 3, 'LOTA', '2026-01-01')`).run(id)
    raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, lot_code, received_at) VALUES (?, 'lotB', 1, 5, 'LOTB', '2026-01-02')`).run(id)
    const edit = await request('PUT', `/${id}`, { cost_price_usd: 10 })
    assert.equal(edit.status, 200, JSON.stringify(edit))
    const { getCatalogCostBreakdown } = load('lib/catalogCostRecompute.ts')
    const breakdown = await getCatalogCostBreakdown({
      prepare(sql) {
        return {
          async get(params) { const { values, translated } = bindNamed(sql, params); return raw.prepare(translated).get(...values) },
          async all(params) { const { values, translated } = bindNamed(sql, params); return raw.prepare(translated).all(...values) },
        }
      },
    }, id)
    const lotRows = breakdown.inputs.filter((row) => row.source === 'lot')
    const manualRows = breakdown.inputs.filter((row) => row.source === 'manual')
    assert.equal(lotRows.length, 2)
    assert.ok(lotRows.every((row) => row.lot_code))
    assert.equal(manualRows.length, 1)
    assert.equal(manualRows[0].user_name, 'sethy')
    assert.equal(manualRows[0].excluded, null)
  })

  await check('the SQL twin (catalogCostRecomputeStatement, used by stockSession.ts) agrees with the JS path: latest manual entry only', async () => {
    const id = seedProduct('SqlTwin')
    seedLot(id, 3)
    seedLot(id, 5)
    // Two manual entries -- only the later (id 20) should be selected.
    raw.prepare(`INSERT INTO product_cost_entries(id, product_id, cost_usd, source) VALUES (10, ?, 100, 'manual')`).run(id)
    raw.prepare(`INSERT INTO product_cost_entries(id, product_id, cost_usd, source) VALUES (20, ?, 4, 'manual')`).run(id)
    const { catalogCostRecomputeStatement } = load('lib/catalogCostRecompute.ts')
    const { sql, params } = catalogCostRecomputeStatement(id)
    const { translated, values } = bindNamed(sql, { ...params, productId: id, id })
    raw.prepare(translated).run(...values)
    // mean(3, 4, 5) = 4 -- the superseded manual entry (100, an outlier that
    // would have fired the guard) never enters the SQL twin's derivation,
    // same selection as recomputeCatalogCost (JS) above.
    assert.equal(row(id).cost_price_usd, 4)
  })

  console.log(`\n${checks} checks passed`)
}

function bindNamed(sql, params) {
  const values = []
  const translated = sql.replace(/@(\w+)/g, (_m, name) => { values.push((params || {})[name] ?? null); return '?' })
  return { values, translated }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
