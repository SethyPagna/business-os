// Real Hono transfer + action-history routes and applier, production migrations.
const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
h.apps.history = h.load('routes/actionHistory.ts').default
h.apps.history.onError((error, c) => c.json({ error: error.message }, 500))
const user = { id: 7, name: 'Operator', permissions: JSON.stringify({ branches: true, inventory: true }) }
let checks = 0
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`) }
const sql = () => h.getDb()
const qty = (lot, branch) => sql().prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?').get(lot, branch)?.quantity || 0
const history = id => sql().prepare('SELECT * FROM action_history WHERE id=?').get(id)
const reverse = (id, direction, generation) => h.request('history', `/${id}/${direction}`, { require_applied: true, expected_generation: generation })
function snapshot() {
  return Object.fromEntries(['products','product_batches','branch_stock','branch_batch_stock','transfer_operation_receipts','transfer_operation_members','stock_transfers','inventory_movements','action_history','audit_logs'].map(table => [table, sql().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
async function forward({ merge = false, explicit = false, untracked = false } = {}) {
  h.fresh(2)
  // Destination already has unrelated older stock; a reverse FIFO would take it.
  sql().exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES(99,1,'older','older','2020-01-01',1); INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(99,2,8); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,8); UPDATE products SET stock_quantity=18 WHERE id=1")
  if (untracked) sql().exec('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1')
  if (merge) h.setMerge({ id: 2, name: 'Product 2' })
  const result = await h.request('branches', '/transfer', { ...h.intent(1, 1, 'provenance_forward_001', false), ...(explicit ? { batchId: 1 } : {}) })
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.equal(result.body.provenance_version, 1)
  return result.body
}
async function main() {
  for (const merge of [false,true]) for (const explicit of [false,true]) await check(`older unrelated lot is untouched through forward/undo/redo merge=${merge}, explicit=${explicit}`, async () => {
    const result = await forward({ merge, explicit })
    const member = sql().prepare('SELECT * FROM transfer_operation_members').get()
    const allocation = JSON.parse(member.allocations_json)[0]
    assert.equal(qty(1,1),7.5); assert.equal(qty(99,2),8)
    if (merge) { assert.notEqual(allocation.destination_batch_id,1); assert.equal(allocation.destination_snapshot.received_at,'2026-09-01') }
    if (explicit) assert.equal(result.destBatchId, allocation.destination_batch_id)
    const originalMapping = member.allocations_json
    let response = await reverse(result.action_history_id,'undo',0)
    assert.equal(response.status,200,JSON.stringify(response)); assert.equal(response.body.applied,true)
    assert.equal(response.body.item.server_replayable,true)
    assert.equal(response.body.item.undo_payload.generation,1)
    assert.equal(qty(1,1),10); assert.equal(qty(99,2),8); assert.equal(qty(allocation.destination_batch_id,2),0)
    const after = snapshot()
    response = await reverse(result.action_history_id,'undo',0)
    assert.equal(response.status,200,JSON.stringify(response)); assert.deepEqual(snapshot(),after)
    response = await reverse(result.action_history_id,'redo',1)
    assert.equal(response.status,200,JSON.stringify(response)); assert.equal(qty(1,1),7.5); assert.equal(qty(99,2),8)
    assert.equal(sql().prepare('SELECT allocations_json FROM transfer_operation_members').get().allocations_json,originalMapping)
    assert.equal((await reverse(result.action_history_id,'undo',0)).status,409)
    assert.equal(sql().prepare('SELECT COUNT(*) n FROM stock_transfers').get().n,3)
    assert.equal(sql().prepare('SELECT COUNT(*) n FROM audit_logs').get().n,3)
  })
  await check('untracked remainder is immutable and cannot consume tracked destination stock', async () => {
    const result = await forward({ untracked:true })
    assert.equal(sql().prepare('SELECT untracked_quantity FROM transfer_operation_members').get().untracked_quantity,1.5)
    assert.equal((await reverse(result.action_history_id,'undo',0)).status,200)
    assert.equal(qty(1,1),1); assert.equal(qty(99,2),8)
    assert.equal((await reverse(result.action_history_id,'redo',1)).status,200)
    sql().exec('UPDATE branch_stock SET quantity=quantity-1.5 WHERE product_id=1 AND branch_id=2')
    const before=snapshot()
    assert.equal((await reverse(result.action_history_id,'undo',2)).status,409)
    assert.deepEqual(snapshot(),before)
  })
  await check('same request ID belongs independently to two authorized actors', async () => {
    h.fresh(1)
    const body=h.intent(1,1,'same_key_two_actors',false)
    assert.equal((await h.request('branches','/transfer',body)).status,200)
    h.setUser({...user,id:8})
    assert.equal((await h.request('branches','/transfer',body)).status,200)
    assert.equal(sql().prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n,2)
    assert.equal(qty(1,1),5)
  })
  for (const stage of ['INSERT INTO product_batches','INSERT INTO transfer_operation_members','INSERT INTO action_history','UPDATE branch_batch_stock','INSERT INTO stock_transfers','INSERT INTO inventory_movements',"SET status='committed'"]) await check(`failure at ${stage} rolls back every table including cloned lot`, async () => {
    h.fresh(2); h.setMerge({id:2,name:'Product 2'}); const before=snapshot(); h.failAt(stage)
    const result=await h.request('branches','/transfer',h.intent(1,1,'failure_after_planning',false))
    assert.equal(result.status,500,JSON.stringify(result)); assert.deepEqual(snapshot(),before)
  })
  await check('consumed required destination lot conflicts without substituting older lot', async () => {
    const result=await forward()
    sql().exec('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=2')
    const before=snapshot()
    assert.equal((await reverse(result.action_history_id,'undo',0)).status,409)
    assert.deepEqual(snapshot(),before); assert.equal(qty(99,2),8)
  })
  await check('permission downgrade blocks replay and hidden history never authorizes forged payloads', async () => {
    const result=await forward()
    h.setUser({...user,permissions:JSON.stringify({branches:true,'branches:transfer':false})})
    const before=snapshot()
    assert.equal((await reverse(result.action_history_id,'undo',0)).status,403)
    assert.deepEqual(snapshot(),before)
    h.setUser({...user,role:'admin'})
    const payload=JSON.parse(history(result.action_history_id).undo_payload)
    const forged=await h.request('history','/',{scope:'branches',entity:'stock_transfer',label:'Forged',undo_payload:payload,redo_payload:payload,reversible:true})
    assert.equal(forged.status,403,JSON.stringify(forged)); assert.deepEqual(snapshot(),before)
  })
  await check('inventory-only action permission replays the server inventory history',async()=>{
    h.fresh(1); h.setUser({...user,permissions:JSON.stringify({inventory:true,branches:false})})
    const result=await h.request('inventory','/transfer',h.intent(1,1,'inventory_history_only',false))
    assert.equal(result.status,200)
    assert.equal((await reverse(result.body.action_history_id,'undo',0)).status,200)
    assert.equal((await reverse(result.body.action_history_id,'redo',1)).status,200)
  })
  await check('product/lot delete, deactivate, reparent and member rewrites fail closed',async()=>{
    await forward()
    const before=snapshot()
    const mutations = [
      ['DELETE FROM products WHERE id=1', /provenance|immutable/],
      ['UPDATE products SET is_active=0 WHERE id=1', /provenance|immutable/],
      // 0155's stocked-parent invariant runs before the older 0151
      // provenance guard. Either invariant is an intentional fail-closed
      // denial; neither may change the replay snapshot.
      ['DELETE FROM product_batches WHERE id=1', /provenance|immutable|Cannot delete a received lot with positive branch stock/],
      ['UPDATE product_batches SET variant_product_id=2 WHERE id=1', /provenance|immutable/],
      ['UPDATE transfer_operation_members SET quantity=20', /provenance|immutable/],
      ['DELETE FROM transfer_operation_members', /provenance|immutable/],
    ]
    for(const [mutation, expectedError] of mutations) {
      assert.throws(()=>sql().exec(mutation),expectedError)
      assert.deepEqual(snapshot(),before,`${mutation} must leave every replay table unchanged`)
    }
  })
  await check('reload exposes server history and simultaneous lost-ack undo applies one generation',async()=>{
    const result=await forward()
    const loaded=await h.request('history','/?scope=branches',undefined,'GET')
    assert.equal(loaded.status,200,JSON.stringify(loaded))
    assert.equal(loaded.body.items[0].id,result.action_history_id)
    assert.equal(loaded.body.items[0].server_replayable,true)
    const responses=await Promise.all([reverse(result.action_history_id,'undo',0),reverse(result.action_history_id,'undo',0)])
    assert.deepEqual(responses.map(response=>response.status),[200,200])
    assert.equal(qty(1,1),10)
    assert.equal(sql().prepare('SELECT generation FROM transfer_operation_receipts').get().generation,1)
    assert.equal(sql().prepare('SELECT COUNT(*) n FROM stock_transfers').get().n,2)
  })
  await check('failed replay audit rolls back every stock, history and generation effect',async()=>{
    const result=await forward()
    const before=snapshot(); h.failAt('INSERT INTO audit_logs')
    assert.equal((await reverse(result.action_history_id,'undo',0)).status,409)
    assert.deepEqual(snapshot(),before)
  })
  await check('200-member transfer reverses atomically after history reload',async()=>{
    h.fresh(200)
    const response=await h.request('branches','/transfer-bulk',h.intent(1,200,'bulk-provenance-replay'))
    assert.equal(response.status,200,JSON.stringify(response))
    assert.equal((await reverse(response.body.action_history_id,'undo',0)).status,200)
    assert.equal(sql().prepare('SELECT SUM(quantity) n FROM branch_stock WHERE branch_id=1').get().n,2000)
    assert.equal((await reverse(response.body.action_history_id,'redo',1)).status,200)
    assert.equal(sql().prepare('SELECT SUM(quantity) n FROM branch_stock WHERE branch_id=1').get().n,1500)
  })
  console.log(`${checks} production-schema transfer provenance/replay scenarios passed`)
}
main().catch(error=>{console.error(error);process.exitCode=1})
