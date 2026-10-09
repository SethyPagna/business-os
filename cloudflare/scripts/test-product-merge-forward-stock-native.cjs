const assert = require('node:assert/strict')
const { world, adapter, reserve, capture, load } = require('./test-product-merge-origin-plan-native.cjs')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { sumCountedQuantities } = load('lib/countedDamagedStock.ts')
const identity = { planId: 1000, transitionId: 1001, historyId: 1000, actorId: 7, actorName: 'Operator',
  requestId: 'forward-stock-request', requestDigest: 'original-request-digest', origins: reserve }
const state = d1 => Object.fromEntries(d1.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, d1.db.prepare(`SELECT * FROM "${name}"`).all().map(row => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
async function ready() {
  const d1 = world()
  d1.db.exec(productMergeProtocolSchemaSql())
  await executeStockTransaction(adapter(d1), [
    { sql: "INSERT INTO inventory_movements(id,product_id,product_name,branch_id,batch_id,movement_type,quantity,reason) VALUES(1,2,'Original history name',1,10,'add',3,'Original receipt')" },
    { sql: "INSERT INTO action_history(id,label,undo_payload,redo_payload) VALUES(1,'Unrelated original history','{}','{}')" },
    { sql: "INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,status,response_json,operation_id,provenance_version,replay_state) VALUES(1,7,'original-transfer','original-digest','{}','pending','{}','original-transfer',1,'applied')" },
    { sql: "INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json) VALUES(1,0,2,1,1,1,1,0,'{}','{}','[{\"source_batch_id\":10,\"quantity\":1}]')" },
    { sql: "UPDATE transfer_operation_receipts SET status='committed' WHERE id=1" },
  ], 'once')
  return d1
}
async function positive(lostAck = false, compile = planProductMergeForwardStock) {
  const d1 = await ready()
  try {
    const before = state(d1), compiled = compile(await capture(d1), identity)
    let dispatches = 0
    const db = adapter(d1)
    const once = { ...db, batchOnce: async rows => {
      dispatches++
      const result = await db.batchOnce(rows)
      if (lostAck) throw new Error('simulated lost acknowledgement')
      return result
    } }
    if (lostAck) await assert.rejects(executeStockTransaction(once, compiled.statements, 'once'), /simulated lost acknowledgement/)
    else await executeStockTransaction(once, compiled.statements, 'once')
    assert.equal(dispatches, 1)
    const after = state(d1)
    for (const table of ['transfer_operation_receipts', 'transfer_operation_members', 'product_cost_entries', 'sale_item_batch_allocations', 'return_item_batch_allocations']) assert.deepEqual(after[table], before[table], table)
    assert.deepEqual(after.inventory_movements.filter(row => row.id === 1), before.inventory_movements)
    assert.deepEqual(after.action_history.filter(row => row.id === 1), before.action_history)
    assert.deepEqual(after.product_batches.filter(row => row.id < 100), before.product_batches)
    assert.deepEqual(after.damaged_stock_lots.filter(row => row.id < 200), before.damaged_stock_lots.map(row => ({ ...row, quantity_remaining: 0 })))
    assert.equal(after.products.find(row => row.id === 1).stock_quantity, 3)
    assert.equal(after.products.find(row => row.id === 1).cost_price_usd, 5)
    assert.equal(after.products.find(row => row.id === 1).cost_price_khr, 12000)
    assert.equal(after.products.find(row => row.id === 2).stock_quantity, 0)
    assert.equal(after.products.find(row => row.id === 2).is_active, 0)
    assert.deepEqual(after.branch_stock.map(row => [row.product_id, row.branch_id, row.quantity]), [[1, 1, 3], [2, 1, 0]])
    assert.equal(after.branch_batch_stock.filter(row => [10, 11, 12, 13].includes(row.batch_id)).every(row => row.quantity === 0), true)
    assert.equal(after.branch_batch_stock.find(row => row.batch_id === 100).quantity, 1)
    assert.equal(after.damaged_stock_lots.find(row => row.id === 200).quantity, 3)
    assert.equal(after.damaged_stock_lots.find(row => row.id === 201).quantity, 2)
    assert.equal(sumCountedQuantities(after.damaged_stock_lots.map(row => row.quantity_remaining)), .6)
    assert.equal(after.damaged_stock_lots.find(row => row.id === 202).batch_id, null)
    assert.equal(after.damaged_stock_lots.find(row => row.id === 202).unit_cost_usd, 1.0000000000000002)
    assert.equal(after.product_batches.filter(row => row.id >= 100).every(row => row.received_quantity === 0 && row.received_cost_usd === 0), true)
    assert.equal(after.undo_snapshots.find(row => row.id === 1001).status, 'sealed')
    assert.deepEqual(JSON.parse(after.action_history.find(row => row.id === 1000).undo_payload), compiled.pointer)
    assert.equal(after.system_flags.some(row => row.key === 'stock_transaction_permit'), false)
    const moves = after.inventory_movements.filter(row => row.id !== 1)
    assert.equal(moves.length, 8, 'ordinary receipt, ordinary NULL, receipt tag and NULL tag each have two compensating edges')
    assert.equal(moves.filter(row => JSON.parse(row.reason).condition_tag === 'damaged').length, 4)
    for (let ordinal = 0; ordinal < 7; ordinal++) {
      const pair = moves.filter(row => JSON.parse(row.reason).ordinal === ordinal)
      if (pair.length) assert.equal(pair[0].quantity, -pair[1].quantity)
    }
    await assert.rejects(executeStockTransaction(db, compiled.statements, 'once'))
    assert.deepEqual(state(d1), after, 're-dispatch cannot create a second physical relocation')
    console.log(`PASS forward stock ${lostAck ? 'lost ACK' : 'normal'}: ${compiled.statements.length + 2} actual dispatched statements, ${compiled.planBytes} plan bytes; original history preserved`)
  } finally { d1.db.close() }
}
async function main() {
  await positive()
  await positive(true)
  for (const wrong of ['copied-purchase', 'remaining-only-cap']) {
    await assert.rejects(positive(false, (snapshot, identity) => {
      const compiled = planProductMergeForwardStock(snapshot, identity)
      const row = compiled.statements.find(row => row.sql.startsWith('INSERT INTO ' + (wrong === 'copied-purchase' ? 'product_batches(' : 'damaged_stock_lots(')))
      const clones = JSON.parse(row.params.rows)
      if (wrong === 'copied-purchase') clones[0].received_quantity = snapshot.duplicateBatchRows[0].received_quantity
      else clones[0].quantity = clones[0].quantity_remaining
      row.params.rows = JSON.stringify(clones)
      return compiled
    }), error => error.code === 'ERR_ASSERTION', wrong + ' must fail a business invariant after executing the actual wrong writes')
    console.log('PASS discriminating wrong compiler: ' + wrong)
  }
  {
    const d1 = await ready()
    try {
      await executeStockTransaction(adapter(d1), [
        { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=2' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN(10,11,12,13)' },
        { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2' },
        { sql: 'UPDATE products SET stock_quantity=0 WHERE id=2' },
      ], 'once')
      const compiled = planProductMergeForwardStock(await capture(d1), identity)
      await executeStockTransaction(adapter(d1), compiled.statements, 'once')
      assert.equal(d1.db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 1)
      assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 1)
      assert.equal(d1.db.prepare("SELECT status FROM undo_snapshots WHERE id=1001").get().status, 'sealed')
      assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_batches WHERE id>=100').get().n, 4)
      console.log('PASS zero-stock loser preserves exhausted origin mappings without manufacturing movements')
    } finally { d1.db.close() }
  }
  for (const fault of ['source-rival', 'inactive-branch', 'occupied-id', 'late-failure', 'missing-head']) {
    const d1 = await ready()
    try {
      const compiled = planProductMergeForwardStock(await capture(d1), identity)
      if (fault === 'source-rival') await executeStockTransaction(adapter(d1), [{ sql: "UPDATE product_batches SET supplier_name='Rival value' WHERE id=10" }], 'once')
      if (fault === 'inactive-branch') d1.db.exec('UPDATE branches SET is_active=0 WHERE id=1')
      if (fault === 'occupied-id') await executeStockTransaction(adapter(d1), [
        { sql: "INSERT INTO products(id,name,is_active,stock_quantity) VALUES(3,'Unrelated',1,0)" },
        { sql: "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(100,3,'occupied',1)" },
      ], 'once')
      if (fault === 'late-failure') compiled.statements.push({ sql: "SELECT json_extract('[1]','$[late_failure]')" })
      if (fault === 'missing-head') compiled.statements = compiled.statements.filter(row => !row.sql.startsWith('UPDATE action_history'))
      const before = state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), compiled.statements, 'once'))
      assert.deepEqual(state(d1), before, fault + ' preserves complete database and prior rival')
      console.log('PASS complete rollback: ' + fault)
    } finally { d1.db.close() }
  }
  console.log('LOCAL FORWARD STOCK COMPILER ONLY: no HTTP authorization, full catalog choice, historical entitlement routing, replay or Free/Paid envelope certificate')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { ready, identity, state, main, positive }
