// Owner, 19 Oct 2026: employees edit every product detail EXCEPT prices and the supplier; products:price is a
// narrowing switch (absent = no opinion, only an explicit false refuses). A product IMPORT writes selling and
// wholesale prices (KHR too) and the discount block on a matched product through every update mode, so it is the
// same price change PUT /api/products/:id refuses. The REAL importEngine over the migrated schema decides:
//
//   a matched row whose selling/wholesale price or discount differs from the stored one -> a change (refused whole)
//   the same price (numeric equality at 4 decimals)                                     -> NOT a change, written back as stored
//   a new product with a discount                                                      -> a change (POST /products refuses it too)
//   a new product with a price, no discount                                            -> not (the add action governs it)
//   merge_stock rows and a column-level replace that skips the price columns            -> the price is not written
//   cost: every products import already needs cost-entry (isAcquisitionCostImport), so no field gate is added
//
// Run (from cloudflare/scripts): node test-import-price-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const srcRoot = path.join(__dirname, '..', 'src')
function loadTs(relativePath, stubs = {}, unrelatedDependency) {
  const filePath = path.join(srcRoot, relativePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (unrelatedDependency && (request.startsWith('./') || request.startsWith('../durable-objects/'))) return unrelatedDependency
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const code = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filePath }).outputText
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', code)(loaded.exports, require, loaded, filePath, path.dirname(filePath))
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}
const permissions = loadTs('lib/permissions.ts')
const acquisitionAccess = loadTs('lib/acquisitionCostAccess.ts', { './permissions': permissions })
// The REAL engine; every dependency it is not asked about is unrelated and must not be reached.
const engine = loadTs('lib/importEngine.ts', {
  './permissions': permissions,
  './acquisitionCostAccess': acquisitionAccess,
  './productSupplierGate': loadTs('lib/productSupplierGate.ts'),
  './productDiscountGate': loadTs('lib/productDiscountGate.ts'),
  './moneyPrecision': loadTs('lib/moneyPrecision.ts'),
  './queueDispatch': loadTs('lib/queueDispatch.ts'),
}, new Proxy({}, { get(_target, property) { return () => { throw new Error('Unexpected import dependency: ' + String(property)) } } }))
const { productImportResultsChangePrice, lockProductImportPrice } = engine
const { getActionTier } = permissions

const native = openDb(loadAll())
seedStockFixture(native.db, () => native.db.exec(`
  INSERT INTO products(id,name,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,discount_enabled,discount_type,discount_percent)
    VALUES (1,'Rice',2.5,10000,2,8000,0,'percent',0),(2,'Oil',3.1235,12500,0,0,1,'percent',10);`))
const db = {
  prepare(sql) {
    const st = native.prepare(sql)
    return { get: (p) => st.get(p == null ? {} : p), all: (p) => st.all(p == null ? {} : p), run: (p) => st.run(p == null ? {} : p) }
  },
}
const base = { selling_price_usd: 2.5, selling_price_khr: 10000, wholesale_price_usd: 2, wholesale_price_khr: 8000,
  discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_amount_usd: 0, discount_amount_khr: 0, discount_starts_at: null, discount_ends_at: null }
const row = (existingId, data, extra = {}) => ({ rowNumber: existingId, action: 'update', existingId, data: { name: 'x', ...base, ...data }, changes: {}, ...extra })
const create = (data) => ({ rowNumber: 9, action: 'create', existingId: null, data: { name: 'New', ...base, ...data }, changes: {} })
const policy = (extra = {}) => JSON.stringify({ import_mode: 'merge', ...extra })
const changes = (results, policyJson = policy()) => productImportResultsChangePrice(db, results, policyJson)
const oilSame = { selling_price_usd: 3.1235, selling_price_khr: 12500, wholesale_price_usd: 0, wholesale_price_khr: 0, discount_enabled: 1, discount_percent: 10 }

;(async () => {
  assert.equal(await changes([row(1, { selling_price_usd: 2.75 })]), true, 'a different selling price is a change')
  assert.equal(await changes([row(1, { selling_price_khr: 11000 })]), true, 'a different KHR selling price is a change')
  assert.equal(await changes([row(1, { wholesale_price_usd: 1.5 })]), true, 'a different wholesale price is a change')
  assert.equal(await changes([row(1, { wholesale_price_khr: 0 })]), true, 'clearing a wholesale price is a change')
  assert.equal(await changes([row(1, { discount_enabled: 1, discount_percent: 5 })]), true, 'switching a discount on is a change')
  assert.equal(await changes([row(2, { ...oilSame, discount_enabled: 0 })]), true, 'switching a discount off is a change')
  assert.equal(await changes([row(1, {})]), false, 'an identical row is no change')
  assert.equal(await changes([row(1, { selling_price_usd: 2.50004 })]), false, 'the same price at the stored 4-decimal precision is no change')
  assert.equal(await changes([row(2, oilSame)]), false, 'an unchanged discount is no change')
  assert.equal(await changes([create({ selling_price_usd: 9, wholesale_price_usd: 7 })]), false, 'a new product with prices follows the add action')
  assert.equal(await changes([create({ discount_enabled: 1, discount_percent: 5 })]), true, 'a new product with a discount is refused like POST /products')
  assert.equal(await changes([row(1, { selling_price_usd: 9 }, { plannedMode: 'merge_stock' })]), false, 'a restock-only row never writes the price')
  assert.equal(await changes([row(1, { selling_price_usd: 9 })], policy({ import_mode: 'replace_columns', replace_columns: ['name', 'category'] })), false, 'a column replace without a price column leaves it')
  assert.equal(await changes([row(1, { selling_price_usd: 9 })], policy({ import_mode: 'replace_columns', replace_columns: ['selling_price_usd'] })), true, 'picking a price column writes it')
  assert.equal(await changes([row(1, { wholesale_price_usd: 99 })], policy({ import_mode: 'replace_columns', replace_columns: ['selling_price_usd'] })), false, 'only the picked price column is compared')
  assert.equal(await changes([row(1, { selling_price_usd: 9 }, { action: 'skip' })]), false, 'a skipped row writes nothing')
  assert.equal(await changes([row(1, {}), row(2, { selling_price_khr: 1 })]), true, 'one changing row among others is enough')
  console.log('PASS the import price change test: price, wholesale, KHR and discount differences are changes; equal, create-without-discount, restock-only, other-column replace and skip are not')

  const locked = [row(1, { selling_price_usd: 2.50004 })]
  await lockProductImportPrice(db, locked, policy())
  assert.equal(locked[0].data.selling_price_usd, 2.5, 'an unchanged price is written back as stored')
  const lockedReplace = [row(1, { selling_price_usd: 2.50004, wholesale_price_usd: 2.00003 })]
  await lockProductImportPrice(db, lockedReplace, policy({ import_mode: 'replace_columns', replace_columns: ['selling_price_usd'] }))
  assert.deepEqual([lockedReplace[0].data.selling_price_usd, lockedReplace[0].data.wholesale_price_usd], [2.5, 2.00003], 'a column replace only locks the picked price columns')
  console.log('PASS an unchanged price keeps its stored value under the lock')

  // The role semantics every gate shares: explicit false refuses, absent has no opinion.
  const role = (own) => ({ id: 1, username: 'r', name: 'r', role_code: 'custom', permissions: JSON.stringify(own) })
  assert.equal(getActionTier(role({ products: true, 'products:import': true, 'products:price': false }), 'products', 'price'), 'none', 'a custom role with import on and price off is refused')
  assert.notEqual(getActionTier(role({ products: true, 'products:import': true, 'products:price': true }), 'products', 'price'), 'none', 'with the price grant the import may change prices')
  assert.notEqual(getActionTier(role({ products: true, 'products:import': true }), 'products', 'price'), 'none', 'an absent price flag has no opinion')
  assert.equal(acquisitionAccess.isAcquisitionCostImport('products'), true, 'every products import already requires cost-entry, which covers the cost columns')

  const src = fs.readFileSync(path.join(__dirname, '../src/lib/importEngine.ts'), 'utf8')
  const apply = src.indexOf("job.type === 'products' && !authority.allowProductPriceWrites")
  assert.ok(apply > 0 && apply < src.indexOf("sw.lap('classifyChunkMs')", apply), 'the apply refuses a changing chunk before any write of that chunk')
  assert.match(src, /allowProductPriceWrites = job\.type !== 'products' \|\| getActionTier\(actor, 'products', 'price'\) !== 'none'/)
  assert.match(src, /ImportApplyAuthorizationError\('products:price'/)
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/importJobs.ts'), 'utf8')
  assert.equal((routes.match(/requireChangedProductImportPriceAction\(c as any, job\)/g) || []).length, 2, 'both the approve and the re-apply route refuse before queueing')
  assert.match(routes, /\.\.\.PRODUCT_DISCOUNT_PRICE_REFUSAL/, 'the refusal carries the PUT route stable product_price_edit_required code')
  console.log('PASS the apply and the approve / re-apply routes both carry the price gate')
})().catch((error) => { console.error(error); process.exitCode = 1 })
