// Security audit P2-c. A products import adds or changes stock (a new product's starting quantity, an additive
// receipt on a matched product, an absolute branch snapshot) but only asked for products:import. Stock is an
// inventory:adjust write everywhere else (a fold's starting quantity, a stock session, POST /api/batches), so a
// file that would add or change stock is refused whole without it, exactly like the price gate
// (test-import-price-gate-pure.cjs). The REAL importEngine over the migrated schema decides:
//
//   a new product with a starting quantity                       -> a change
//   merge_stock / override_add with a positive quantity          -> a change (an additive receipt)
//   a snapshot (no planned mode) that differs from branch_stock  -> a change; an equal one is not
//   override_replace, fill_blank, a column replace, a zero-quantity create, a row naming no branch, a skip -> not
//
// Run (from cloudflare/scripts): node test-import-stock-gate-pure.cjs
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
const engine = loadTs('lib/importEngine.ts', {
  './permissions': permissions,
  './acquisitionCostAccess': acquisitionAccess,
  './productSupplierGate': loadTs('lib/productSupplierGate.ts'),
  './productDiscountGate': loadTs('lib/productDiscountGate.ts'),
  './moneyPrecision': loadTs('lib/moneyPrecision.ts'),
  './queueDispatch': loadTs('lib/queueDispatch.ts'),
}, new Proxy({}, { get(_target, property) { return () => { throw new Error('Unexpected import dependency: ' + String(property)) } } }))
const { productImportResultsChangeStock, PRODUCT_IMPORT_STOCK_REFUSAL } = engine
const { getActionTier } = permissions

const native = openDb(loadAll())
seedStockFixture(native.db, () => native.db.exec(`
  INSERT OR IGNORE INTO branches(id,name,is_active,is_default) VALUES (1,'Shop',1,1),(2,'Warehouse',1,0);
  INSERT INTO products(id,name,selling_price_usd) VALUES (1,'Rice',2.5),(2,'Oil',3);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES (1,1,10),(1,2,4);`))
const db = {
  prepare(sql) {
    const st = native.prepare(sql)
    return { get: (p) => st.get(p == null ? {} : p), all: (p) => st.all(p == null ? {} : p), run: (p) => st.run(p == null ? {} : p) }
  },
}
const row = (existingId, data, extra = {}) => ({ rowNumber: existingId, action: 'update', existingId, data: { name: 'x', branch_id: 1, branch_id_explicit: 1, stock_quantity: 10, ...data }, changes: {}, ...extra })
const create = (data) => ({ rowNumber: 9, action: 'create', existingId: null, data: { name: 'New', branch_id: 1, branch_id_explicit: 0, stock_quantity: 0, ...data }, changes: {} })
const policy = (extra = {}) => JSON.stringify({ import_mode: 'merge', ...extra })
const changes = (results, policyJson = policy()) => productImportResultsChangeStock(db, results, policyJson)

;(async () => {
  assert.equal(await changes([create({ stock_quantity: 5 })]), true, 'a new product with a starting quantity is a stock write')
  assert.equal(await changes([create({ stock_quantity: 0 })]), false, 'a new product without stock writes none')
  assert.equal(await changes([row(1, { stock_quantity: 3 }, { plannedMode: 'merge_stock' })]), true, 'an additive receipt is a stock write')
  assert.equal(await changes([row(1, { stock_quantity: 3 }, { plannedMode: 'override_add' })]), true, 'override_add is an additive receipt')
  assert.equal(await changes([row(1, { stock_quantity: 0 }, { plannedMode: 'merge_stock' })]), false, 'a zero receipt is a no-op')
  assert.equal(await changes([row(1, { stock_quantity: 3 }, { plannedMode: 'override_replace' })]), false, 'override_replace never writes stock')
  assert.equal(await changes([row(1, { stock_quantity: 3 })]), true, 'a snapshot that lowers the stored quantity is a stock write')
  assert.equal(await changes([row(1, { stock_quantity: 99 })]), true, 'a snapshot that raises the stored quantity is a stock write')
  assert.equal(await changes([row(1, { stock_quantity: 10 })]), false, 'a snapshot equal to the stored quantity changes nothing')
  assert.equal(await changes([row(1, { stock_quantity: 4, branch_id: 2 })]), false, 'the stored quantity is read per branch')
  assert.equal(await changes([row(2, { stock_quantity: 1 })]), true, 'a snapshot onto a branch with no stock row is a change')
  assert.equal(await changes([row(1, { stock_quantity: 3, branch_id_explicit: 0 })]), false, 'a row naming no branch writes no stock')
  assert.equal(await changes([row(1, { stock_quantity: 3 })], policy({ import_mode: 'fill_blank' })), false, 'fill_blank never writes stock')
  assert.equal(await changes([row(1, { stock_quantity: 3 })], policy({ import_mode: 'replace_columns', replace_columns: ['category'] })), false, 'a column replace never writes stock')
  assert.equal(await changes([row(1, { stock_quantity: 3 }, { action: 'skip' })]), false, 'a skipped row writes nothing')
  assert.equal(await changes([row(1, { stock_quantity: 10 }), create({ stock_quantity: 2 })]), true, 'one stock-writing row among others is enough')
  console.log('PASS the import stock change test')

  const role = (own) => ({ id: 1, username: 'r', name: 'r', role_code: 'custom', permissions: JSON.stringify(own) })
  assert.notEqual(getActionTier(role({ products: true, 'products:import': true }), 'inventory', 'adjust'), 'full', 'products import alone does not hold inventory:adjust')
  assert.equal(getActionTier(role({ products: true, 'products:import': true, inventory: true }), 'inventory', 'adjust'), 'full')
  assert.equal(PRODUCT_IMPORT_STOCK_REFUSAL.code, 'product_import_stock_adjust_required')

  const src = fs.readFileSync(path.join(srcRoot, 'lib/importEngine.ts'), 'utf8')
  const apply = src.indexOf("job.type === 'products' && !authority.allowProductStockWrites")
  assert.ok(apply > 0 && apply < src.indexOf("sw.lap('classifyChunkMs')", apply), 'the apply refuses a stock-writing chunk before any write of that chunk')
  assert.match(src, /allowProductStockWrites = job\.type !== 'products' \|\| getActionTier\(actor, 'inventory', 'adjust'\) === 'full'/)
  assert.match(src, /ImportApplyAuthorizationError\('inventory:adjust'/)
  const routes = fs.readFileSync(path.join(srcRoot, 'routes/importJobs.ts'), 'utf8')
  assert.equal((routes.match(/requireChangedProductImportStockAction\(c as any, job\)/g) || []).length, 2, 'both the approve and the re-apply route refuse before queueing')
  assert.match(routes, /\.\.\.PRODUCT_IMPORT_STOCK_REFUSAL/)
  console.log('PASS the apply and the approve / re-apply routes both carry the stock gate')
})().catch((error) => { console.error(error); process.exitCode = 1 })
