const assert = require('node:assert/strict')
const { world, bundleWorker } = require('./test-counted-set-native.cjs')

function seedHistory(f, reversed) {
  const before = { productId: 1, branchId: 1, batchId: 1, lotQuantity: 10, branchQuantity: 10, lotExists: 1, branchExists: 1 }
  const after = { ...before, lotQuantity: 7, branchQuantity: 7 }
  const request = { productId: 1, branchId: 1, batchId: 1, quantity: 7, setScope: 'lot', reason: 'Legacy tagged count', conditionTag: 'damaged' }
  const pointer = { applier: 'stock.quantity_set', operation_id: 'legacy-counted-set', generation: reversed ? 1 : 0 }
  f.sql.prepare(`INSERT INTO action_history(id,scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    VALUES(1,'inventory','stock_quantity_set','1','Legacy tagged count',1,?,?,?,7,'Admin')`)
    .run(reversed ? 'redoable' : 'undoable', JSON.stringify(pointer), JSON.stringify(pointer))
  f.sql.prepare(`INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json,history_id,generation,state)
    VALUES('legacy-counted-set',7,'legacy-set-proof',?,'synthetic','{}',?,?,?,1,?,?)`)
    .run(JSON.stringify(request), JSON.stringify(before), JSON.stringify(after), JSON.stringify({ generation: pointer.generation, unitCostUsd: 2, heldLotId: 1 }), pointer.generation, reversed ? 'reversed' : 'applied')
  f.sql.exec(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id)
    VALUES(1,1,'Serum',1,'Shop',1,'add',10,2,20,'legacy-receipt'),
    (2,1,'Serum',1,'Shop',1,'damage_out',3,2,6,'stock-set:legacy-counted-set:0');`)
  if (reversed) f.sql.exec(`INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id)
    VALUES(3,1,'Serum',1,'Shop',1,'adjustment',3,2,6,'revert:2')`)
}

async function main() {
  const makeWorker = await bundleWorker()
  for (const tier of ['free', 'paid']) for (const reversed of [false, true]) {
    const f = await world(makeWorker, tier, reversed ? 'reversed' : 'receipt')
    try {
      seedHistory(f, reversed)
      const original = f.state()
      const journal = f.sql.prepare('SELECT * FROM counted_stock_conversion_lots').all()
      assert.equal(journal[0].credited_quantity, reversed ? 0 : 3)
      assert.equal(original.physical, 10)
      const readPreview = () => f.call(`/action-history/movements/${reversed ? 3 : 2}/revert-preview`, undefined, 'GET')
      const preview = await readPreview()
      assert.equal(preview.status, 200)
      assert.equal(preview.json.effect.quantity, 0)
      assert.equal(preview.json.effect.branchBefore, 10)
      assert.equal(preview.json.effect.branchAfter, 10)
      const receiptPreview = await f.call('/action-history/movements/1/revert-preview', undefined, 'GET')
      assert.equal(receiptPreview.status, 200)
      assert.deepEqual(receiptPreview.json.laterSets, [], 'converted tag Set is no longer a later physical count change')
      const first = reversed ? 'redo' : 'undo'
      const generation = reversed ? 1 : 0
      for (const invalid of [undefined, null, String(generation), false, -1, 0.5]) {
        assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: invalid })).status, 409)
        assert.equal(f.state().physical, 10)
        assert.deepEqual(f.state().tags, original.tags)
        assert.deepEqual(f.state().movements, original.movements)
      }
      f.failWhenSqlMatches(/UPDATE action_history SET status=/)
      assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: generation })).status, 409)
      assert.equal(f.state().physical, 10)
      assert.deepEqual(f.state().tags, original.tags)
      assert.deepEqual(f.state().movements, original.movements)
      f.loseNextCommitAcknowledgement()
      assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: generation })).status, 200)
      assert.equal(f.state().physical, 10, 'historical tag replay must never credit or remove physical units')
      assert.equal(f.state().cache, 10)
      assert.equal(f.state().tags[0].quantity_remaining, reversed ? 3 : 0)
      const applied = f.state()
      assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: String(generation) })).status, 409)
      assert.deepEqual(f.state().tags, applied.tags)
      assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: generation })).status, 200)
      assert.deepEqual(f.state().tags, applied.tags, 'same generation replay must remain idempotent')
      assert.deepEqual(f.state().movements, applied.movements)
      assert.deepEqual(f.state().operations, applied.operations)
      assert.equal(f.state().physical, applied.physical)
      const second = reversed ? 'undo' : 'redo'
      assert.equal((await f.call(`/action-history/1/${second}`, { expected_generation: generation + 1 })).status, 200)
      assert.equal(f.state().physical, 10)
      assert.equal(f.state().tags[0].quantity_remaining, reversed ? 0 : 3)
      const current = f.state()
      assert.equal((await f.call(`/action-history/1/${first}`, { expected_generation: generation })).status, 409)
      assert.equal(f.state().physical, 10)
      assert.deepEqual(f.state().tags, current.tags)
      assert.deepEqual(f.state().movements.slice(0, original.movements.length), original.movements, 'original history is immutable')
      assert.ok(f.state().movements.slice(original.movements.length).every(movement => movement.quantity === 0 && ['condition_tag', 'condition_clear'].includes(movement.movement_type)))
      assert.deepEqual(f.sql.prepare('SELECT * FROM counted_stock_conversion_lots').all(), journal, 'conversion evidence remains immutable')
      if (!reversed) {
        assert.equal((await f.call('/inventory/tagged-lots/dispose', { productId: 1, branchId: 1, quantity: 1, conditionTag: 'damaged', reason: 'Consumed exact legacy tag', client_request_id: 'legacy-set-consumed' })).status, 200)
        const consumed = f.state()
        assert.equal((await f.call('/action-history/1/undo', { expected_generation: 2 })).status, 409)
        assert.equal(f.state().physical, consumed.physical)
        assert.deepEqual(f.state().tags, consumed.tags)
        assert.deepEqual(f.state().movements, consumed.movements)
      } else {
        assert.equal((await f.call('/inventory/adjust', { productId: 1, branchId: 1, batchId: 1, type: 'remove', quantity: 8, reason: 'Ordinary stock consumed', client_request_id: 'legacy-set-ordinary-consumed' })).status, 200)
        const consumed = f.state()
        assert.equal(consumed.physical, 2)
        assert.equal((await f.call('/action-history/1/redo', { expected_generation: 3 })).status, 409)
        assert.equal(f.state().physical, 2, 'redo cannot retag more units than remain physically available')
        assert.deepEqual(f.state().tags, consumed.tags)
        assert.deepEqual(f.state().movements, consumed.movements)
      }
      console.log(`PASS ${tier} legacy ${reversed ? 'already reversed' : 'applied'} Set exact neutral replay/preview, rollback, ACK loss and immutable history`)
    } finally { f.sql.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
