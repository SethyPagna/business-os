const assert = require('node:assert/strict')
const { adapter, capture, load, reserve } = require('./test-product-merge-origin-plan-native.cjs')
const catalogFixture = require('./test-product-merge-forward-catalog-native.cjs')
const stockFixture = require('./test-product-merge-forward-stock-native.cjs')
const { planProductMergeReplay } = load('lib/productMergeReplay.ts')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { sumCountedQuantities } = load('lib/countedDamagedStock.ts')
const rows = (d1, table) => stockFixture.state(d1)[table]
function evidence(d1) {
  const plan = { ...d1.db.prepare('SELECT * FROM undo_snapshots WHERE id=1000').get() }
  const history = { ...d1.db.prepare('SELECT * FROM action_history WHERE id=1000').get() }
  const pointer = JSON.parse(history.undo_payload)
  return { plan, history, seal: { ...d1.db.prepare('SELECT * FROM undo_snapshots WHERE id=?').get(pointer.seal_id) } }
}
async function setup(kind = 'catalog') {
  const d1 = kind === 'catalog' ? await catalogFixture.ready() : await stockFixture.ready()
  if (kind === 'catalog') d1.db.exec(productMergeProtocolSchemaSql())
  if (kind === 'fraction') await executeStockTransaction(adapter(d1), [
    { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN(10,11,12,13)' },
    { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2' },
    { sql: 'UPDATE branch_batch_stock SET quantity=.1 WHERE batch_id=1' },
    { sql: 'UPDATE branch_stock SET quantity=CASE product_id WHEN 1 THEN .1 ELSE .2 END' },
    { sql: 'UPDATE products SET stock_quantity=CASE id WHEN 1 THEN .1 ELSE .2 END WHERE id IN(1,2)' },
  ], 'once')
  if (kind === 'zero') await executeStockTransaction(adapter(d1), [
    { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN(10,11,12,13)' },
    { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2' },
    { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=2' },
    { sql: 'UPDATE products SET stock_quantity=0 WHERE id=2' },
  ], 'once')
  const original = await capture(d1), before = stockFixture.state(d1)
  const options = kind === 'catalog' ? { ...catalogFixture.options, keeperChoice: { fields: { barcode: '123', name: 'Reviewed keeper' } } } : undefined
  const compiled = planProductMergeForwardStock(original, { ...stockFixture.identity, origins: reserve }, options)
  await executeStockTransaction(adapter(d1), compiled.statements, 'once')
  return { d1, original, before, compiled }
}
async function compile(d1, direction, transitionId) {
  const proof = evidence(d1)
  return planProductMergeReplay(await capture(d1), proof, { transitionId, direction, actorId: 7, actorName: 'Operator', pointer: JSON.parse(proof.history.undo_payload) })
}
function immutable(d1, before, original) {
  for (const table of ['inventory_movements', 'product_batches', 'damaged_stock_lots', 'product_cost_entries', 'transfer_operation_members', 'transfer_operation_receipts']) {
    for (const row of before[table]) {
      const actual = rows(d1, table).find(value => value.id === row.id)
      if (table === 'damaged_stock_lots') {
        const { quantity_remaining: _old, ...oldMetadata } = row
        const { quantity_remaining: _new, ...newMetadata } = actual
        assert.deepEqual(newMetadata, oldMetadata, table)
      } else assert.deepEqual(actual, row, table)
    }
  }
  for (const row of original.duplicateBatchRows) assert.equal(d1.db.prepare('SELECT variant_product_id FROM product_batches WHERE id=?').get(row.id).variant_product_id, 2)
}
function physical(d1, original, undo) {
  const keeper = d1.db.prepare('SELECT * FROM products WHERE id=1').get(), loser = d1.db.prepare('SELECT * FROM products WHERE id=2').get()
  const keeperTotal = sumCountedQuantities(original.canonicalStockBefore.map(row => row.quantity))
  const loserTotal = sumCountedQuantities(original.duplicateStockRows.map(row => row.quantity))
  assert.equal(keeper.stock_quantity, undo ? keeperTotal : sumCountedQuantities([keeperTotal, loserTotal]))
  assert.equal(loser.stock_quantity, undo ? loserTotal : 0)
  assert.equal(loser.is_active, undo ? 1 : 0)
  for (const receipt of original.duplicateBatchStockRows) {
    const target = reserve.receiptIds.find(row => row.sourceReceiptId === receipt.batch_id).targetReceiptId
    for (const [id, expected] of [[receipt.batch_id, undo ? receipt.quantity : 0], [target, undo ? 0 : receipt.quantity]]) {
      assert.equal(d1.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?').get(id, receipt.branch_id).quantity, expected)
    }
  }
  for (const tag of original.damagedStockRows.filter(row => row.product_id === 2)) {
    const target = reserve.tagIds.find(row => row.sourceTagId === tag.id).targetTagId
    assert.equal(d1.db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(tag.id).quantity_remaining, undo ? tag.quantity_remaining : 0)
    assert.equal(d1.db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=?').get(target).quantity_remaining, undo ? 0 : tag.quantity_remaining)
  }
}
async function positive(kind) {
  const { d1, original, before } = await setup(kind)
  try {
    const savedPlan = evidence(d1).plan.payload_json
    for (const [direction, id] of [['undo', 1002], ['redo', 1003], ['undo', 1004]]) {
      const compiled = await compile(d1, direction, id)
      await executeStockTransaction(adapter(d1), compiled.statements, 'once')
      physical(d1, original, direction === 'undo'); immutable(d1, before, original)
      assert.equal(evidence(d1).plan.payload_json, savedPlan)
      assert.equal(evidence(d1).seal.status, 'sealed')
      const current = stockFixture.state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), compiled.statements, 'once'))
      assert.deepEqual(stockFixture.state(d1), current, 'same generation retry refuses without another movement')
      if (kind === 'catalog' && direction === 'undo') {
        for (const field of ['name', 'barcode', 'image_path', 'selling_price_usd', 'purchase_price_usd', 'cost_price_usd', 'cost_price_khr', 'parent_id']) assert.equal(d1.db.prepare('SELECT * FROM products WHERE id=1').get()[field], original.canonicalProduct[field], field)
        assert.deepEqual(rows(d1, 'product_images'), before.product_images)
        assert.deepEqual(rows(d1, 'promotion_rules'), before.promotion_rules)
        const child = d1.db.prepare('SELECT parent_id,updated_at FROM products WHERE id=3').get()
        assert.deepEqual({ ...child }, { parent_id: 2, updated_at: original.childProductRows.find(row => row.id === 3).updated_at })
      }
      const movements = rows(d1, 'inventory_movements').filter(row => !before.inventory_movements.some(before => before.id === row.id))
      for (const movement of movements) { const reason = JSON.parse(movement.reason); assert.equal(reason.operation_id, reserve.operationId); assert.ok(Number.isSafeInteger(reason.generation)) }
      console.log(`PASS ${kind} ${direction} generation ${compiled.pointer.generation}: ${compiled.statements.length + 2} dispatched statements`)
    }
    if (kind === 'zero') assert.deepEqual(rows(d1, 'inventory_movements'), before.inventory_movements)
  } finally { d1.db.close() }
}
async function faults() {
  for (const fault of ['source-rival', 'catalog-rival', 'child-rival', 'receipt-rival', 'stale-head', 'late-failure', 'omitted-seal', 'omitted-head', 'omitted-transition', 'occupied-transition']) {
    const { d1 } = await setup('catalog')
    try {
      let compiled = await compile(d1, 'undo', 1002)
      if (fault === 'source-rival') await executeStockTransaction(adapter(d1), [{ sql: 'UPDATE branch_stock SET quantity=2.5 WHERE product_id=1' }, { sql: 'UPDATE products SET stock_quantity=2.5 WHERE id=1' }], 'once')
      if (fault === 'catalog-rival') await executeStockTransaction(adapter(d1), [{ sql: "UPDATE products SET name='Later change' WHERE id=1" }], 'once')
      if (fault === 'child-rival') await executeStockTransaction(adapter(d1), [{ sql: "UPDATE products SET parent_id=4,updated_at='later-child' WHERE id=3" }], 'once')
      if (fault === 'receipt-rival') await executeStockTransaction(adapter(d1), [{ sql: "UPDATE product_batches SET notes='Later receipt' WHERE id=100" }], 'once')
      if (fault === 'stale-head') await executeStockTransaction(adapter(d1), (await compile(d1, 'undo', 1005)).statements, 'once')
      if (fault === 'late-failure') compiled.statements.push({ sql: "SELECT json_extract('[1]','$[late_failure]')" })
      if (fault === 'omitted-seal') compiled.statements = compiled.statements.filter(row => !row.sql.startsWith("UPDATE undo_snapshots SET status='sealing'"))
      if (fault === 'omitted-head') compiled.statements = compiled.statements.filter(row => !row.sql.startsWith('UPDATE action_history'))
      if (fault === 'omitted-transition') compiled.statements = compiled.statements.filter(row => !row.sql.startsWith('INSERT INTO undo_snapshots'))
      if (fault === 'occupied-transition') d1.db.exec("INSERT INTO undo_snapshots(id,kind,status,payload_json)VALUES(1002,'other','recorded','{}')")
      const before = stockFixture.state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), compiled.statements, 'once'), undefined, fault)
      assert.deepEqual(stockFixture.state(d1), before, fault)
      console.log('PASS atomic refusal: ' + fault)
    } finally { d1.db.close() }
  }
  const { d1 } = await setup()
  try {
    const proof = evidence(d1), current = await capture(d1), pointer = JSON.parse(proof.history.undo_payload)
    const identity = { transitionId: 1002, direction: 'undo', actorId: 7, actorName: 'Operator', pointer }
    for (const changed of [{ ...identity, direction: 'redo' }, { ...identity, pointer: { ...pointer, generation: 2 } }, { ...identity, transitionId: 1001 }]) assert.throws(() => planProductMergeReplay(current, proof, changed))
    const plan = JSON.parse(proof.plan.payload_json); plan.origins.physicalEdges[0].quantity += 1
    assert.throws(() => planProductMergeReplay(current, { ...proof, plan: { ...proof.plan, payload_json: JSON.stringify(plan) } }, identity))
    console.log('PASS compiler rejects phase/generation/id/forged origin evidence')
  } finally { d1.db.close() }
}
async function main() {
  for (const kind of ['catalog', 'stock', 'fraction', 'zero']) await positive(kind)
  await faults()
  console.log('LOCAL replay compiler: full-schema SQLite only; HTTP actor authorization, request recovery, Free/Paid quota and route wiring remain parent integration work')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { setup, evidence, compile, main }
