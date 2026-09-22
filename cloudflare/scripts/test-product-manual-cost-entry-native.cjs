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
let failSql = null
let beforeBatch = null

const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { return raw.prepare(sql).get(...values) ?? null },
      async run() {
        if (failSql?.test(sql)) throw new Error('injected cost transaction failure')
        const result = raw.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback() }
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
  audit: { audit: async () => {}, changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, },
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
  const text = await response.text()
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text }
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

  await check('override product, entry, audit and recompute roll back together at each failure point', async () => {
    const id = seedProduct('AtomicOverride')
    seedLot(id, 3)
    const saleId = Number(raw.prepare('INSERT INTO sales DEFAULT VALUES').run().lastInsertRowid)
    raw.prepare('INSERT INTO sale_items(sale_id,product_id,quantity,cost_price_usd,cost_price_khr) VALUES(?,?,1,3,0)').run(saleId,id)
    const historical = () => JSON.stringify({
      lots:raw.prepare('SELECT * FROM product_batches WHERE variant_product_id=?').all(id),
      sales:raw.prepare('SELECT * FROM sale_items WHERE product_id=?').all(id),
    })
    const historicalBefore = historical()
    const state = () => JSON.stringify({product:row(id),entries:costEntries(id),
      lots:raw.prepare('SELECT * FROM product_batches WHERE variant_product_id=?').all(id),
      audit:raw.prepare("SELECT * FROM audit_logs WHERE entity='product' AND entity_id=?").all(String(id))})
    const before = state()
    for (const pattern of [/INSERT INTO product_cost_entries/, /INSERT INTO audit_logs/, /UPDATE products SET/]) {
      failSql = pattern
      const response = await request('PUT',`/${id}`,{cost_price_usd:10})
      failSql = null
      assert.equal(response.status,500)
      assert.equal(state(),before,'no product, lot, entry or audit mutation survives a failed atomic override')
    }
    const result = await request('PUT',`/${id}`,{cost_price_usd:10})
    assert.equal(result.status,200)
    assert.equal(historical(),historicalBefore,'successful override preserves original lot and sold-cost snapshots')
    const audit = raw.prepare("SELECT * FROM audit_logs WHERE entity_id=? AND action='cost_override'").get(String(id))
    assert.deepEqual(JSON.parse(audit.old_value),{cost_price_usd:7,cost_price_khr:0})
    assert.deepEqual(JSON.parse(audit.new_value),{cost_price_usd:10,cost_price_khr:0})
    assert.equal(audit.user_id,9)
    assert.equal(audit.user_name,'sethy')
    assert.ok(audit.created_at)
    assert.equal(JSON.parse(audit.details).baseline_batch_id,costEntries(id)[0].baseline_batch_id)
    assert.equal(costEntries(id)[0].previous_cost_usd,7)
    const breakdown = await load('lib/catalogCostRecompute.ts').getCatalogCostBreakdown(makeDb(),id)
    assert.equal(breakdown.inputs.find(input=>input.source==='manual').previous_cost_usd,7)
    const access = load('lib/acquisitionCostAccess.ts')
    const employee = {id:10,role_name:'employee',permissions:JSON.stringify({product_cost_edit:true,product_cost_view:false})}
    assert.equal(access.isAcquisitionCostKey('previous_cost_usd'),true)
    assert.equal(access.isAcquisitionCostKey('previousCostUsd'),true)
    assert.equal(JSON.stringify(access.projectAcquisitionCosts(breakdown,employee)).includes('previous_cost_usd'),false)
    assert.equal(access.projectAcquisitionCosts(breakdown,admin).inputs.find(input=>input.source==='manual').previous_cost_usd,7)
    const costRoute = load('routes/productCost.ts').default
    const denied = await costRoute.request(`/${id}/cost-breakdown`,{}, {...env,TEST_USER:employee},context)
    assert.equal(denied.status,403,'edit-only user cannot read previous or current costs')
    const viewer = {...employee,permissions:JSON.stringify({product_cost_view:true,product_cost_edit:false})}
    const allowed = await costRoute.request(`/${id}/cost-breakdown`,{}, {...env,TEST_USER:viewer},context)
    assert.equal(allowed.status,200)
    assert.equal((await allowed.json()).inputs.find(input=>input.source==='manual').previous_cost_usd,7)
  })
  await check('receipt committed before override is captured by SQL baseline; later receipt joins override', async () => {
    const id = seedProduct('OrderedOverride')
    seedLot(id,7)
    let concurrentId
    // Same-price receipt does not alter guarded money; it still must be in
    // the baseline even though it arrived after the route prepared its plan.
    beforeBatch = () => { concurrentId = seedLot(id,7) }
    assert.equal((await request('PUT',`/${id}`,{cost_price_usd:10})).status,200)
    assert.equal(costEntries(id)[0].baseline_batch_id,concurrentId)
    assert.equal(row(id).cost_price_usd,10)
    seedLot(id,12)
    await load('lib/catalogCostRecompute.ts').recomputeCatalogCost(makeDb(),id)
    assert.equal(row(id).cost_price_usd,11)
    const entriesBefore = costEntries(id)
    beforeBatch = () => { seedLot(id,20); raw.prepare('UPDATE products SET cost_price_usd=14 WHERE id=?').run(id) }
    assert.equal((await request('PUT',`/${id}`,{cost_price_usd:6})).status,409,'changed money rejects stale override entirely')
    assert.deepEqual(costEntries(id),entriesBefore)
    assert.equal(row(id).cost_price_usd,14)
  })
  await check('previous cost preserves unknown NULL and exact historical precision, without inferred backfill', async () => {
    for (const previous of [null,3.123456]) {
      const id = seedProduct(`Previous-${previous}`)
      raw.prepare('UPDATE products SET cost_price_usd=? WHERE id=?').run(previous,id)
      assert.equal((await request('PUT',`/${id}`,{cost_price_usd:8})).status,200)
      assert.equal(costEntries(id)[0].previous_cost_usd,previous)
    }
  })
  await check('actual NULL-to-zero and legacy precision changes record override; exact resaves do not', async () => {
    for (const [previous,next] of [[null,0],[3.123456,3.1235]]) {
      const id = seedProduct(`ExactTransition-${previous}`)
      raw.prepare('UPDATE products SET cost_price_usd=? WHERE id=?').run(previous,id)
      const baseline = seedLot(id,7)
      assert.equal((await request('PUT',`/${id}`,{cost_price_usd:next})).status,200)
      assert.equal(row(id).cost_price_usd,next)
      assert.equal(costEntries(id).length,1)
      assert.equal(costEntries(id)[0].previous_cost_usd,previous)
      assert.equal(costEntries(id)[0].cost_usd,next)
      assert.equal(costEntries(id)[0].baseline_batch_id,baseline)
      const audit = raw.prepare("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id=?").all(String(id))
      assert.equal(audit.length,1)
      assert.equal(JSON.parse(audit[0].old_value).cost_price_usd,previous)
      assert.equal(JSON.parse(audit[0].new_value).cost_price_usd,next)
      assert.equal((await request('PUT',`/${id}`,{cost_price_usd:next})).status,200)
      assert.equal(costEntries(id).length,1)
    }
    for (const same of [null,0,3.123456]) {
      const id = seedProduct(`ExactNoOp-${same}`)
      raw.prepare('UPDATE products SET cost_price_usd=? WHERE id=?').run(same,id)
      assert.equal((await request('PUT',`/${id}`,{cost_price_usd:same})).status,200)
      assert.equal(row(id).cost_price_usd,same)
      assert.equal(costEntries(id).length,0)
      assert.equal(raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='cost_override' AND entity_id=?").get(String(id)).n,0)
    }
  })
  console.log(`\n${checks} checks passed`)
}

function bindNamed(sql, params) {
  const values = []
  const translated = sql.replace(/@(\w+)/g, (_m, name) => { values.push((params || {})[name] ?? null); return '?' })
  return { values, translated }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
