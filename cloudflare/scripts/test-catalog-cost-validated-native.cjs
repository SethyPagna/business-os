const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const fixture = path.join(__dirname, 'test-product-resolve-keep-merge-native.cjs')
const source = fs.readFileSync(fixture, 'utf8').replaceAll('\r\n', '\n')
const boundary = source.indexOf('\nasync function main() {')
assert.ok(boundary > 0)
const runner = new Module(fixture, module)
runner.filename = fixture
runner.paths = module.paths
runner._compile(source.slice(0, boundary) + '\nmodule.exports={fresh,one,rows,state,merge,adapter,catalogCost}', fixture)
const { fresh, one, rows, state, merge, adapter, catalogCost } = runner.exports
const cache = new Map()
function real(name) {
  if (cache.has(name)) return cache.get(name).exports
  const filename = path.join(__dirname, '../src/lib', name + '.ts')
  const mod = { exports: {} }
  cache.set(name, mod)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', 'module', code)(mod.exports, id => id.startsWith('./') ? real(id.slice(2)) : require(id), mod)
  return mod.exports
}
let count = 0
function pass(message) { count += 1; console.log('PASS ' + message) }
function cost() { return one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=20') }
function seed(manual, invalidLot, withValidLot = true) {
  seedFixture(state.native.db, () => state.native.db.exec('UPDATE products SET cost_price_usd=5,purchase_price_usd=5 WHERE id=20'))
  seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(900,20,'baseline',1,?)").run(invalidLot))
  seedFixture(state.native.db, () => state.native.db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3)'))
  if (manual !== undefined) {
    seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,9,'manual',900)"))
    seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,?,'manual',900)").run(manual))
  }
  if (withValidLot) seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(901,20,'valid',1,8);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(901,1,1)"))
  seedFixture(state.native.db, () => state.native.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(20,1,?)').run(withValidLot ? 4 : 3))
  seedFixture(state.native.db, () => state.native.db.prepare('UPDATE products SET stock_quantity=? WHERE id=20').run(withValidLot ? 4 : 3))
}
function migrationContract() {
  const migration = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8')
  const old = migration('0255_product_cost_review.sql')
  const review = real('productCostReview')
  assert.ok(old.includes(review.productCostReviewGuardSql({ inputPolicy: 'legacy' })))
  assert.ok(old.endsWith(catalogCost.catalogCostReviewTriggersSql({ inputPolicy: 'legacy', primaryKeyPlan: false })))
  const names = ['catalog_cost_on_hand_stock_insert_0195', 'catalog_cost_on_hand_stock_update_0195', 'catalog_cost_on_hand_stock_delete_0195', 'catalog_cost_on_hand_lot_insert_0195', 'catalog_cost_on_hand_lot_delete_0195', 'catalog_cost_review_lot_update_0255', 'product_cost_review_update_guard_0255']
  const expected = names.map(name => 'DROP TRIGGER ' + name + ';\n').join('') + review.productCostReviewUpdateGuardSql() + catalogCost.catalogCostReviewTriggersSql({ primaryKeyPlan: false })
  const actual = migration('0256_validated_catalog_cost.sql')
  assert.equal(actual, expected)
  assert.ok(!actual.includes('\r'))
  assert.equal((actual.match(/CREATE TRIGGER /g) || []).length, 7)
  assert.ok(!/^(UPDATE|INSERT|DELETE) /m.test(actual), 'no one-time monetary or historical data repair')
  pass('0255 exact legacy SQL and0256 seven validated trigger bodies, LF-only and no repair scan')
  const { openDb } = require('./harness/d1compat.cjs')
  const { loadAll } = require('./harness/load_migrations.cjs')
  const beforeMigration = openDb(loadAll({ through: 255 }))
  try {
    const db = beforeMigration.db
    seedFixture(db, () => db.exec("INSERT INTO products(id,name,cost_price_usd,purchase_price_usd,is_active) VALUES(62000,'Migration control',5,5,1);INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(72000,62000,'old-baseline',1,NULL);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(72000,1,3);INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(62000,'malformed','manual',72000);INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(72001,62000,'new-valid',1,8);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(72001,1,1)"))
    const snapshot = () => ['products', 'product_batches', 'branch_batch_stock', 'product_cost_entries', 'audit_logs', 'action_history'].map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())
    const original = snapshot()
    assert.equal(db.prepare('SELECT cost_price_usd value FROM products WHERE id=62000').get().value, 2)
    db.exec(actual)
    assert.deepEqual(snapshot(), original, 'migration installs guards without rewriting existing money or history')
    const plan = catalogCost.catalogCostRecomputeIfChangedStatement(62000)
    beforeMigration.prepare(plan.sql).run(plan.params)
    assert.equal(db.prepare('SELECT cost_price_usd value FROM products WHERE id=62000').get().value, 8)
    pass('0256 installation preserves six existing tables exactly; subsequent authorized recompute uses validated inputs')
  } finally { beforeMigration.db.close() }

}
async function parityCase(manual, invalidLot, label) {
  fresh()
  try {
    seed(manual, invalidLot)
    const history = rows('SELECT * FROM product_cost_entries ORDER BY id')
    const expected = typeof manual === 'number' && Number.isFinite(manual) && manual > 0 ? Math.round((manual * 3 + 8) / 4 * 10000) / 10000 : 8
    assert.equal(cost().cost_price_usd, expected, 'trigger before merge')
    const done = await merge({ keepId: 20, mergeId: 21, keep: true, stock: 'merge' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(done.body.undoReady, invalidLot !== Infinity, 'nonfinite lot history retains existing non-reversible outcome')
    assert.equal(cost().cost_price_usd, expected)
    assert.equal(cost().cost_review_key, null)
    const audit = JSON.parse(one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='20' ORDER BY id DESC LIMIT 1").details).cost_review
    assert.equal(audit.after_usd, expected)
    assert.equal(audit.recorded_lot, 1)
    assert.equal((await catalogCost.getCatalogCostBreakdown(adapter, 20)).result_usd, expected)
    seedFixture(state.native.db, () => state.native.db.exec('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=900'))
    const next = typeof manual === 'number' && Number.isFinite(manual) && manual > 0 ? Math.round((manual * 2 + 8) / 3 * 10000) / 10000 : 8
    assert.equal(cost().cost_price_usd, next, 'next stock trigger')
    await catalogCost.recomputeCatalogCost(adapter, 20)
    assert.equal(cost().cost_price_usd, next, 'explicit guarded recompute')
    await real('stockTransaction').executeStockTransaction(adapter, [catalogCost.catalogCostRecomputeStatement(20)], 'retry')
    assert.equal(cost().cost_price_usd, next, 'atomic writer recompute')
    assert.equal((await catalogCost.getCatalogCostBreakdown(adapter, 20)).result_usd, next)
    assert.deepEqual(rows('SELECT * FROM product_cost_entries ORDER BY id'), history)
    assert.equal(cost().cost_price_khr, 0)
    pass(label + ': merge, next stock mutation, both recompute forms and breakdown agree without rewriting manual history')
  } finally { state.native.db.close() }
}
async function evidenceCase(value, label) {
  fresh()
  try {
    seed(undefined, value, false)
    const review = real('productCostReview')
    const outcome = review.mergeCostOutcome(20, { usd: 5, khr: null })
    await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(outcome, { id: 1, name: 'Fixture' }), 'retry')
    assert.equal(cost().cost_price_usd, 5)
    assert.equal(cost().cost_review_key, outcome.reviewKey)
    assert.throws(() => state.native.db.exec('UPDATE products SET cost_review_key=NULL WHERE id=20'), /product_cost_review_write_refused/)
    seedFixture(state.native.db, () => state.native.db.exec('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=900'))
    assert.equal(cost().cost_price_usd, 5)
    assert.equal(cost().cost_review_key, outcome.reviewKey)
    seedFixture(state.native.db, () => state.native.db.exec('UPDATE product_batches SET unit_cost_usd=8 WHERE id=900'))
    assert.equal(cost().cost_price_usd, 8)
    assert.equal(cost().cost_review_key, null)
    pass(label + ': unsupported lot cannot certify review; actual valid lot update clears it')
  } finally { state.native.db.close() }
}
async function seedWorker(h, statements) {
  await h.db.batch([
    h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
    ...statements,
    h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
  ])
  assert.equal((await h.one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n, 0)
  await assert.rejects(h.db.prepare("INSERT INTO products(name) VALUES('unadmitted native probe')").run(), /stock_transaction_required/)
}
async function wholeWorker() {
  const { startWorker, budgetLine } = require('./harness/al_money_native.cjs')
  const h = await startWorker()
  try {
    for (const [index, kind] of ['manual', 'lot'].entries()) {
      const keeper = 60000 + index * 10, duplicate = keeper + 1, baseline = 70000 + index * 10, eligible = baseline + 1
      await seedWorker(h, [h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,5,20500,1),(?,?,?,7,28700,1)").bind(keeper, 'Validated ' + kind, String(keeper), duplicate, 'Validated ' + kind, String(duplicate))])
      await seedWorker(h, [h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(?,?,?,1,?)").bind(baseline, keeper, kind + '-baseline', kind === 'lot' ? 'malformed' : null)])
      await seedWorker(h, [h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,3)').bind(baseline)])
      if (kind === 'manual') await seedWorker(h, [h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,'malformed','manual',?)").bind(keeper, baseline)])
      await seedWorker(h, [h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd) VALUES(?,?,?,1,8)").bind(eligible, keeper, kind + '-eligible')])
      await seedWorker(h, [h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)').bind(eligible)])
      await seedWorker(h, [h.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,4)').bind(keeper)])
      await seedWorker(h, [h.db.prepare('UPDATE products SET stock_quantity=4 WHERE id=?').bind(keeper)])
      const read = () => h.one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=?', keeper)
      const originalEntries = await h.all('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id', keeper)
      assert.equal((await read()).cost_price_usd, 8)
      const body = { productId: keeper, branchId: 1, quantity: 1, unitCostUsd: 8, receivedDate: '03/09/2026', supplierName: 'Fixture supplier' }
      const beforePreview = await h.all('SELECT * FROM products ORDER BY id')
      const preview = await h.call('POST', '/api/products/receiving-cost-preview', { lines: [{ key: kind, wire: 'receive', body }] }, kind + ' advisory')
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      assert.equal(preview.body.results[0].status, 'ready')
      assert.equal(preview.body.results[0].afterUsd, 8)
      assert.deepEqual(await h.all('SELECT * FROM products ORDER BY id'), beforePreview)
      const received = await h.call('POST', '/api/batches', { client_request_id: 'validated-receipt-' + kind + '-abcdefgh', product_id: keeper, branch_id: 1, quantity: 1, unit_cost_usd: 8, received_date: body.receivedDate, supplier_name: body.supplierName }, kind + ' actual receipt')
      assert.equal(received.status, 200, JSON.stringify(received.body))
      assert.equal((await read()).cost_price_usd, preview.body.results[0].afterUsd)
      const breakdown = await h.call('GET', '/api/products/' + keeper + '/cost-breakdown', undefined, kind + ' breakdown')
      assert.equal(breakdown.status, 200, JSON.stringify(breakdown.body))
      assert.equal(breakdown.body.result_usd, 8)
      const merged = await h.call('POST', '/api/products/possible-duplicates/merge', { keepId: keeper, mergeId: duplicate, keep: true, stock: 'merge' }, kind + ' merge')
      assert.equal(merged.status, 200, JSON.stringify(merged.body))
      assert.equal(merged.body.undoReady, true)
      const history = await h.one("SELECT * FROM action_history WHERE entity='product' AND entity_id=? ORDER BY id DESC LIMIT 1", String(duplicate))
      const undo = await h.call('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true, expected_generation: 0 }, kind + ' undo')
      assert.equal(undo.status, 200, JSON.stringify(undo.body))
      assert.equal((await read()).cost_price_usd, 8)
      const redo = await h.call('POST', '/api/action-history/' + history.id + '/redo', { require_applied: true, expected_generation: 1 }, kind + ' redo')
      assert.equal(redo.status, 200, JSON.stringify(redo.body))
      assert.deepEqual(await read(), { cost_price_usd: 8, cost_price_khr: 20500, cost_review_key: null })
      assert.deepEqual(await h.all('SELECT * FROM product_cost_entries WHERE product_id=? ORDER BY id', keeper), originalEntries)
      await seedWorker(h, [h.db.prepare('UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=?').bind(baseline)])
      assert.equal((await read()).cost_price_usd, 8)
      const events = await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
      const stale = await h.call('POST', '/api/action-history/' + history.id + '/undo', { require_applied: true, expected_generation: 2 }, kind + ' refuse changed stock')
      assert.equal(stale.status, 409, JSON.stringify(stale.body))
      assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"), events)
      pass('authenticated ' + kind + ': advisory/real receipt/breakdown/merge/Undo/Redo8, later changed stock refuses replay with history intact')
    }
    assert.ok(h.metrics.every(row => row.statements <= 1000))
  } finally { budgetLine(h.metrics); await h.mf.dispose() }
}
async function main() {
  if (process.argv.includes('--http')) return wholeWorker()
  assert.equal(catalogCost.catalogCostFormulaSql(), catalogCost.catalogCostFormulaSql())
  assert.ok(Object.isFrozen(catalogCost.catalogCostFormulaSql()))
  migrationContract()
  for (const value of ['malformed', -1, 0, Infinity]) await parityCase(value, null, 'latest manual ' + String(value))
  await parityCase(7, null, 'valid7 baseline plus8 preserves weighted7.25 then7.3333')
  for (const value of ['malformed', -1, 0, Infinity]) {
    await parityCase(undefined, value, 'lot ' + String(value) + ' alongside valid8')
    await evidenceCase(value, 'lot ' + String(value) + ' alone')
  }
  fresh()
  try {
    seed(Buffer.from('8'), null)
    assert.equal(cost().cost_price_usd, 8)
    const before = rows('SELECT * FROM products ORDER BY id')
    const done = await merge({ keepId: 20, mergeId: 21, keep: true, stock: 'merge' })
    assert.equal(done.status, 409, 'existing graph JSON cannot snapshot BLOB history')
    assert.deepEqual(rows('SELECT * FROM products ORDER BY id'), before)
    pass('BLOB manual excluded from derivation; existing merge snapshot refuses unsupported BLOB history without writes')
  } finally { state.native.db.close() }
  await evidenceCase(Buffer.from('8'), 'BLOB lot alone')
  for (const value of ['8', 'malformed', Infinity, 0]) {
    const breakdown = catalogCost.buildCatalogCostBreakdown(1, { cost_price_usd: 5, cost_price_khr: null }, [{ id: 1, batch_number: null, lot_code: null, received_at: null, branch_name: null, unit_cost_usd: value, is_active: 1, remaining_quantity: 3 }])
    assert.equal(breakdown.result_usd, 5)
    assert.deepEqual(breakdown.weighted_terms, [])
  }
  pass('pure breakdown refuses unsupported primitive strings/nonfinite input and does not weight real0')
  console.log('Validated catalog cost: ' + count + ' groups passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
