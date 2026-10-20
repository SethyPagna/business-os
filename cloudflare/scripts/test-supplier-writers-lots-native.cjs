// Owner, 19-20 Oct 2026: the supplier of a product is changed only with products:supplier. The backfill route (lane 868)
// gates attributing a supplier to unattributed lots; the same re-attribution through the lot editor
// (PATCH /api/batches/:id with supplier_name / supplier_id) and through a saved stock-in line edit was ungated.
//
//   PATCH /api/batches/:id        the real batches route over SQLite: a CHANGED supplier is refused without the switch,
//                                 the editor's whole-row post-back (the same supplier) still saves its other fields
//   stock-in line edit            source pins: the forward writer and its Undo/Redo replay both demand the switch
//
// Run (from cloudflare/scripts): node test-supplier-writers-lots-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const SQLite = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const raw = new SQLite(':memory:')
const migrations = path.resolve(__dirname, '../migrations')
for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
seedStockFixture(raw, () => raw.exec(`
  INSERT INTO branches(id,name,is_active) VALUES(1,'Fixture branch',1);
  INSERT INTO suppliers(id,name) VALUES(5,'Acme Trading'),(6,'Other Co');
  INSERT INTO products(id,name,cost_price_usd,purchase_price_usd) VALUES(1,'Fixture product',1.2,1.2);
  INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,updated_at,unit_cost_usd,received_at,supplier_id,supplier_name)
    VALUES(1,1,'fixture-batch',1,NULL,1.2,NULL,5,'Acme Trading');
  INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity) VALUES(1,1,1,3)`))
const db = {
  prepare(sql) {
    const statement = raw.prepare(sql)
    const args = (p) => Array.isArray(p) ? p : p == null ? [] : [p]
    return { get: async (p) => statement.get(...args(p)), all: async (p) => statement.all(...args(p)), run: async (p) => statement.run(...args(p)) }
  },
  async batch(statements) {
    return raw.transaction(() => statements.map(({ sql, params }) => {
      const result = raw.prepare(sql).run(params || {})
      return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    }))()
  },
}
const state = { user: null }
const overrides = {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); await next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productBatches': { receiveBatchStock: async () => { throw new Error('unexpected stock mutation') } },
  '../lib/returnsStock': { listOpenDamagedLots: async () => [] },
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }
  cache.set(file, mod.exports)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const resolve = (request) => Object.hasOwn(overrides, request) ? overrides[request]
    : request.startsWith('.') ? load(path.resolve(path.dirname(file), request + '.ts')) : require(request)
  new Function('require', 'module', 'exports', output)(resolve, mod, mod.exports)
  cache.set(file, mod.exports)
  return mod.exports
}
const app = load(path.resolve(__dirname, '../src/routes/batches.ts')).default
const asUser = (id, own) => ({ id, username: 'u' + id, name: 'u' + id, role_code: 'manager', permissions: JSON.stringify({ inventory: true, products: true, ...own }) })
const NO_SUPPLIER = asUser(51, { 'products:supplier': false })
const WITH_SUPPLIER = asUser(52, {})
const lot = () => ({ ...raw.prepare('SELECT supplier_id, supplier_name, notes FROM product_batches WHERE id = 1').get() })
const patch = async (user, body) => {
  state.user = user
  const res = await app.request('/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {}, { waitUntil: () => {}, passThroughOnException: () => {} })
  return { status: res.status, body: await res.json() }
}

;(async () => {
  const before = lot()
  assert.deepEqual(before, { supplier_id: 5, supplier_name: 'Acme Trading', notes: null })

  for (const change of [{ supplier_name: 'Other Co', supplier_id: 6 }, { supplier_name: 'Other Co' }, { supplier_name: '' }, { supplier_name: 'Acme Trading', supplier_id: 6 }]) {
    const refused = await patch(NO_SUPPLIER, { notes: 'edited', ...change })
    assert.equal(refused.status, 403, JSON.stringify(change) + ' ' + JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'product_supplier_edit_required')
    assert.deepEqual(lot(), before, 'a refused supplier change writes nothing, not even the other fields')
  }
  console.log('PASS a changed lot supplier is refused without products:supplier and writes nothing')

  const same = await patch(NO_SUPPLIER, { notes: 'edited', supplier_name: ' acme trading ', supplier_id: 5 })
  assert.equal(same.status, 200, JSON.stringify(same.body))
  assert.deepEqual(lot(), { supplier_id: 5, supplier_name: 'Acme Trading', notes: 'edited' }, 'the unchanged supplier keeps its stored spelling and the other field saves')
  const nameOnly = await patch(NO_SUPPLIER, { notes: 'again', supplier_name: 'Acme Trading' })
  assert.equal(nameOnly.status, 200, JSON.stringify(nameOnly.body))
  assert.equal(lot().supplier_id, 5, 'an unchanged name posted without the id does not clear the attribution')
  console.log('PASS the editor posting the SAME supplier back still saves the other fields and keeps the attribution')

  const allowed = await patch(WITH_SUPPLIER, { supplier_name: 'Other Co', supplier_id: 6 })
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
  assert.deepEqual(lot(), { supplier_id: 6, supplier_name: 'Other Co', notes: 'again' })
  console.log('PASS with products:supplier the lot is re-attributed')

  const edit = fs.readFileSync(path.join(__dirname, '../src/lib/stockInLineEdit.ts'), 'utf8')
  const forward = edit.indexOf("getActionTier(user, 'products', 'supplier') === 'none') refuse(403")
  assert.ok(forward > edit.indexOf('const supplierChanged =') && forward < edit.indexOf('const costChanged ='), 'the forward writer refuses a CHANGED supplier right after computing it, before any write')
  assert.match(edit, /requires_supplier_edit: supplierChanged \? 1 : 0/, 'the saved payload records that the edit changed a supplier')
  assert.match(edit, /Number\(payload\.requires_supplier_edit\) === 1 && getActionTier\(user, 'products', 'supplier'\) === 'none'\) throw new StockInLineEditReplayError/, 'Undo/Redo of such an edit demands the switch too')
  assert.ok(edit.indexOf('requires_supplier_edit) === 1') < edit.indexOf("FROM stock_lot_adjustment_operations WHERE id=@operation"), 'the replay refuses before it reads or writes the operation')
  console.log('PASS the stock-in line edit and its replay carry the supplier gate')
})().catch((error) => { console.error(error); process.exitCode = 1 })
