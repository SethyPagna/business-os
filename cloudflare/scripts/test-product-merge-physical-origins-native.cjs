const assert = require('node:assert/strict')
const { ready, identity, state } = require('./test-product-merge-forward-stock-native.cjs')
const { adapter, capture, load } = require('./test-product-merge-origin-plan-native.cjs')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { planProductMergePhysicalOrigins, ProductMergePhysicalOriginError } = load('lib/productMergePhysicalOrigins.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { CountedStockPlan, countedStockFactsSql } = load('lib/countedDamagedStock.ts')
const source = (batchId = 10, damagedLotId = null, conditionTag = 'ordinary', memberKey = 'member') =>
  ({ memberKey, productId: 2, branchId: 1, batchId, damagedLotId, conditionTag })
const resolution = (d1, sources = [source()]) => {
  const plan = planProductMergePhysicalOrigins(sources)
  return plan.decode(d1.prepare(plan.read.sql).all(plan.read.params))
}
async function merged(before) {
  const d1 = await ready()
  if (before) await before(d1)
  const original = state(d1)
  await executeStockTransaction(adapter(d1), planProductMergeForwardStock(await capture(d1), identity).statements, 'once')
  return { d1, original }
}
async function run() {
  let cases = 0
  {
    const { d1, original } = await merged()
    try {
      const before = state(d1)
      const originals = [source(), source(11, null, 'ordinary', 'exhausted'), source(13, null, 'ordinary', 'absent'),
        source(10, 20, 'damaged', 'tag'), source(10, 21, 'expired', 'exhausted-tag'),
        source(null, 22, 'damaged', 'null-tag'), source(null, null, 'ordinary', 'null')]
      const result = resolution(d1, originals)
      assert.deepEqual(result.sources.map(value => [value.effect.productId, value.effect.batchId, value.effect.damagedLotId]),
        [[1, 100, null], [1, 101, null], [1, 103, null], [1, 100, 200], [1, 100, 201], [1, null, 202], [1, null, null]])
      assert.deepEqual(result.sources.map(value => value.original), originals)
      assert.equal(result.sources.every(value => value.path[0].generation === 0 && value.path[0].sealId === 1001), true)
      await executeStockTransaction(adapter(d1), [result.guard], 'once')
      assert.deepEqual(state(d1), before, 'resolution and guard change no financial/history/stock rows')
      for (const table of ['product_cost_entries', 'sale_item_batch_allocations', 'return_item_batch_allocations',
        'transfer_operation_receipts', 'transfer_operation_members']) assert.deepEqual(before[table], original[table], table)
      assert.deepEqual(before.product_batches.filter(row => row.id < 100), original.product_batches)
      const facts = () => d1.db.prepare('SELECT ' + countedStockFactsSql('1', '1', "'[103]'") + ' facts').get().facts
      assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM branch_batch_stock WHERE batch_id=103').get().n, 0)
      assert.throws(() => new CountedStockPlan(facts(), 1).changeOrdinary(103, .1, 'consume'))
      const exact = new CountedStockPlan(facts(), 1)
      await executeStockTransaction(adapter(d1), [result.guard, ...exact.changeOrdinary(103, .1, 'receive')], 'once')
      assert.equal(d1.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=103').get().quantity, .1)
      assert.equal(d1.db.prepare('SELECT received_quantity FROM product_batches WHERE id=13').get().received_quantity, 0)
      cases += originals.length + 2
      console.log('PASS exact ordinary/tag/NULL/exhausted origins; absent-ledger receive accepted, consume still refused')
    } finally { d1.db.close() }
  }
  {
    const { d1 } = await merged(async d1 => {
      await executeStockTransaction(adapter(d1), [{ sql: "UPDATE product_batches SET received_at='2026-09-01' WHERE id=11" }], 'once')
    })
    try {
      const result = resolution(d1, [source(), source(11, null, 'ordinary', 'second')])
      assert.deepEqual(result.sources.map(value => value.effect.batchId), [100, 101])
      cases++
      console.log('PASS same-date receipts retain distinct original identities')
    } finally { d1.db.close() }
  }
  {
    const { d1, original } = await merged(async d1 => {
      await executeStockTransaction(adapter(d1), [
        { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=2' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN(10,11,12,13)' },
        { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2' },
        { sql: 'UPDATE products SET stock_quantity=0 WHERE id=2' },
      ], 'once')
    })
    try {
      const result = resolution(d1, [source(10, 20, 'damaged')])
      assert.equal(result.sources[0].effect.damagedLotId, 200)
      const facts = d1.db.prepare('SELECT ' + countedStockFactsSql('1', '1', "'[100]'") + ' facts').get().facts
      const exact = new CountedStockPlan(facts, 1)
      await executeStockTransaction(adapter(d1), [result.guard, ...exact.change({ productId: 1, branchId: 1, batchId: 100, lotId: 200 }, 1, 'restore')], 'once')
      assert.equal(d1.db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=200').get().quantity_remaining, 1)
      assert.deepEqual(state(d1).product_batches.filter(row => row.id < 100), original.product_batches)
      assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=1000').get().n, 0)
      cases++
      console.log('PASS zero moved quantity is not an entitlement ceiling: proven exhausted tagged origin restores1')
    } finally { d1.db.close() }
  }
  for (const change of [
    { ...source(), productId: 3 }, { ...source(), batchId: 1 }, { ...source(), conditionTag: 'expired' },
    source(10, 20, 'expired'), source(null, 20, 'damaged'), { ...source(10, 20, 'damaged'), branchId: 2 },
  ]) {
    const { d1 } = await merged()
    try { assert.throws(() => resolution(d1, [change]), ProductMergePhysicalOriginError); cases++ }
    finally { d1.db.close() }
  }
  for (const rival of [
    "UPDATE product_batches SET supplier_name='Rival' WHERE id=100",
    "UPDATE damaged_stock_lots SET condition_tag='expired' WHERE id=200",
    "UPDATE branches SET is_active=0 WHERE id=1",
    "UPDATE branches SET role='warehouse' WHERE id=1",
    "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(999,1,'new-member',1)",
  ]) {
    const { d1 } = await merged()
    try {
      const result = resolution(d1, [source(10, 20, 'damaged')])
      await executeStockTransaction(adapter(d1), [{ sql: rival }], 'once')
      const before = state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), [result.guard,
        { sql: "INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity) VALUES(1,1,'adjustment',0)" }], 'once'), /merge_physical_origin_conflict/)
      assert.deepEqual(state(d1), before, 'rival preserved and attempted history rolled back')
      cases++
    } finally { d1.db.close() }
  }
  {
    const { d1 } = await merged()
    try {
      const stale = resolution(d1, [source(10, 20, 'damaged')])
      await executeStockTransaction(adapter(d1), [
        { sql: "INSERT INTO products(id,name,is_active,stock_quantity) VALUES(3,'Third keeper',1,0)" },
        { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,0)' },
      ], 'once')
      const nextCapture = await load('lib/productMergeSnapshot.ts').readProductMergeCaseSnapshot(adapter(d1), 3, 1, [])
      const next = { ...identity, planId: 2000, historyId: 2000, transitionId: 2001, requestId: 'second-merge',
        origins: { operationId: 'second-merge',
          receiptIds: nextCapture.duplicateBatchRows.map((row, index) => ({ sourceReceiptId: row.id, targetReceiptId: 300 + index })),
          tagIds: nextCapture.damagedStockRows.filter(row => row.product_id === 1)
            .map((row, index) => ({ sourceTagId: row.id, targetTagId: 400 + index })),
        } }
      await executeStockTransaction(adapter(d1), planProductMergeForwardStock(nextCapture, next).statements, 'once')
      const before = state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), [stale.guard], 'once'), /merge_physical_origin_conflict/)
      assert.deepEqual(state(d1), before)
      const current = resolution(d1, [source(10, 20, 'damaged'), source(null, null, 'ordinary', 'null')])
      assert.deepEqual(current.sources[0].path.map(step => step.planId), [1000, 2000])
      assert.deepEqual([current.sources[0].effect.productId, current.sources[0].effect.batchId, current.sources[0].effect.damagedLotId], [3, 301, 400])
      assert.equal(current.sources[1].effect.batchId, null)
      await executeStockTransaction(adapter(d1), [current.guard], 'once')
      assert.deepEqual(state(d1), before)
      cases += 3
      console.log('PASS actual sealed two-merge chain; older captured head refuses atomically')
    } finally { d1.db.close() }
  }
  for (const fault of ['row-bound', 'byte-bound', 'partial', 'missing-manifest']) {
    const { d1 } = await merged()
    try {
      const plan = planProductMergePhysicalOrigins([source()])
      const rows = d1.prepare(plan.read.sql).all(plan.read.params), data = JSON.parse(rows[0].data)
      if (fault === 'row-bound') data.nodes = Array(65).fill(data.nodes[0])
      if (fault === 'byte-bound') data.padding = 'x'.repeat(8 * 1024 * 1024)
      if (fault === 'partial') data.nodes[0].oversized = 1
      if (fault === 'missing-manifest') data.plans = []
      assert.throws(() => plan.decode([{ data: JSON.stringify(data), oversized: 0 }]), ProductMergePhysicalOriginError)
      cases++
    } finally { d1.db.close() }
  }
  for (const rival of ["UPDATE product_batches SET batch_key='wrong-derivative' WHERE id=100",
    'UPDATE damaged_stock_lots SET quantity=4 WHERE id=200']) {
    const { d1 } = await merged()
    try {
      await executeStockTransaction(adapter(d1), [{ sql: rival }], 'once')
      const before = state(d1)
      assert.throws(() => resolution(d1, [source(10, 20, 'damaged')]), ProductMergePhysicalOriginError)
      assert.deepEqual(state(d1), before)
      cases++
    } finally { d1.db.close() }
  }
  for (const field of ['seal', 'head', 'origin', 'cycle', 'ambiguous']) {
    const { d1 } = await merged()
    try {
      const plan = planProductMergePhysicalOrigins([source()])
      const rows = d1.prepare(plan.read.sql).all(plan.read.params)
      const data = JSON.parse(rows[0].data), row = data.plans[0]
      if (field === 'seal') row.seal.status = 'sealing'
      if (field === 'head') { const pointer = JSON.parse(row.history.undo); pointer.generation = 2; row.history.undo = row.history.redo = JSON.stringify(pointer) }
      if (field === 'origin') { const payload = JSON.parse(row.payload); payload.origins.receiptOrigins[0].targetReceiptId = 1; row.payload = JSON.stringify(payload) }
      if (field === 'cycle') { const payload = JSON.parse(row.payload); payload.keeper_id = 2; row.payload = JSON.stringify(payload) }
      if (field === 'ambiguous') data.plans.push(row)
      assert.throws(() => plan.decode([{ data: JSON.stringify(data), oversized: 0 }]), ProductMergePhysicalOriginError)
      cases++
    } finally { d1.db.close() }
  }
  {
    const { d1 } = await merged()
    try {
      const result = resolution(d1), before = state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1), [result.guard,
        { sql: "INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity) VALUES(1,1,'adjustment',0)" },
        { sql: "SELECT json_extract('[1]','$[late_fault]')" }], 'once'), /late_fault/)
      assert.deepEqual(state(d1), before)
      const direct = resolution(d1, [{ ...source(1), productId: 1 }])
      assert.deepEqual(direct.sources[0].path, [])
      assert.equal(direct.sources[0].effect.batchId, 1)
      cases += 2
    } finally { d1.db.close() }
  }
  console.log(`PASS ${cases} physical-origin controls; one coherent read + one reusable atomic guard; native compiler/full migrated fixture only, no route/Free-Paid certification`)
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { resolution, merged, source, run }
