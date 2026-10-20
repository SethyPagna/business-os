// Owner, 19-20 Oct 2026: the supplier of an existing product is changed only with products:supplier. A product import
// UPDATEs a matched product with `supplier=@supplier` (the exhaustive merge / override paths, fill-blank and the
// column-level replace when the supplier column is picked). The REAL importEngine
// over the migrated schema decides what counts as a change:
//
//   a matched row whose supplier differs from the stored one          -> a change (refused whole, loud)
//   the same supplier in another case / spacing                       -> NOT a change, the stored spelling is kept
//   a new product (create)                                            -> never a change (the add action governs it)
//   merge_stock rows (restock only) and replace_columns without the supplier column -> the supplier is not written
//
// Run (from cloudflare/scripts): node test-supplier-writers-import-pure.cjs
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
// The REAL engine; every dependency it is not asked about is unrelated and must not be reached.
const engine = loadTs('lib/importEngine.ts', {
  './permissions': loadTs('lib/permissions.ts'),
  './productSupplierGate': loadTs('lib/productSupplierGate.ts'),
  './queueDispatch': loadTs('lib/queueDispatch.ts'),
}, new Proxy({}, { get(_target, property) { return () => { throw new Error('Unexpected import dependency: ' + String(property)) } } }))
const { productImportResultsChangeSupplier, lockProductImportSupplier } = engine

const native = openDb(loadAll())
seedStockFixture(native.db, () => native.db.exec(`
  INSERT INTO products(id,name,supplier) VALUES (1,'Rice','Acme Trading'),(2,'Oil',NULL),(3,'Salt','Other Co');`))
const db = {
  prepare(sql) {
    const st = native.prepare(sql)
    return { get: (p) => st.get(p == null ? {} : p), all: (p) => st.all(p == null ? {} : p), run: (p) => st.run(p == null ? {} : p) }
  },
}
const row = (existingId, supplier, extra = {}) => ({ rowNumber: existingId, action: 'update', existingId, data: { name: 'x', supplier }, changes: {}, ...extra })
const policy = (extra = {}) => JSON.stringify({ import_mode: 'merge', ...extra })
const changes = (results, policyJson = policy()) => productImportResultsChangeSupplier(db, results, policyJson)

;(async () => {
  assert.equal(await changes([row(1, 'Other Co')]), true, 'a different supplier is a change')
  assert.equal(await changes([row(1, null)]), true, 'clearing the supplier is a change')
  assert.equal(await changes([row(2, 'Acme Trading')]), true, 'filling a blank supplier is a change')
  assert.equal(await changes([row(1, 'acme trading '), row(3, 'OTHER CO')]), false, 'case and spacing are not a different supplier')
  assert.equal(await changes([row(2, null)]), false, 'blank over blank is no change')
  assert.equal(await changes([{ ...row(0, 'Brand New Supplier'), action: 'create', existingId: null }]), false, 'a new product is governed by the add action')
  assert.equal(await changes([row(1, 'Other Co', { plannedMode: 'merge_stock' })]), false, 'a restock-only row never writes the supplier')
  assert.equal(await changes([row(1, 'Other Co')], policy({ import_mode: 'replace_columns', replace_columns: ['name', 'category'] })), false, 'a column-level replace without the supplier column leaves it')
  assert.equal(await changes([row(1, 'Other Co')], policy({ import_mode: 'replace_columns', replace_columns: ['supplier'] })), true, 'picking the supplier column writes it')
  assert.equal(await changes([row(1, 'Other Co'), { ...row(3, 'Other Co'), action: 'skip' }]), true, 'one changing row among others is enough')
  assert.equal(await changes([{ ...row(1, 'Other Co'), action: 'skip' }]), false, 'a skipped row writes nothing')
  console.log('PASS the import supplier change test: differs / clears / fills are changes; case, create, restock-only, other-column replace and skip are not')

  const locked = [row(1, ' ACME trading'), row(3, 'OTHER CO')]
  await lockProductImportSupplier(db, locked, policy())
  assert.deepEqual(locked.map((r) => r.data.supplier), ['Acme Trading', 'Other Co'], 'an unchanged supplier is written back as stored, so the spelling never moves')
  console.log('PASS an unchanged supplier keeps its stored spelling under the lock')

  const engine = fs.readFileSync(path.join(__dirname, '../src/lib/importEngine.ts'), 'utf8')
  const apply = engine.indexOf("job.type === 'products' && !authority.allowProductSupplierWrites")
  assert.ok(apply > 0 && apply < engine.indexOf("sw.lap('classifyChunkMs')", apply), 'the apply refuses a changing chunk before any write of that chunk')
  assert.match(engine, /allowProductSupplierWrites = job\.type !== 'products' \|\| getActionTier\(actor, 'products', 'supplier'\) !== 'none'/)
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/importJobs.ts'), 'utf8')
  assert.equal((routes.match(/requireChangedProductImportSupplierAction\(c as any, job\)/g) || []).length, 2, 'both the approve and the re-apply route refuse before queueing')
  console.log('PASS the apply and the approve / re-apply routes both carry the gate')
})().catch((error) => { console.error(error); process.exitCode = 1 })
