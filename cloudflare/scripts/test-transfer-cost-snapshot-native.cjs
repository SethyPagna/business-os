// Actual Hono transfer/history handlers, real cost resolver, production migrations,
// and transactional SQLite. No mocked costs or movement SQL.
const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
h.apps.history = h.load('routes/actionHistory.ts').default
h.apps.history.onError((error, c) => c.json({ error: error.message }, 500))
const db = () => h.getDb()
const costs = () => db().prepare('SELECT movement_type,batch_id,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr FROM inventory_movements ORDER BY id').all()
const reverse = (id, direction, generation) => h.request('history', `/${id}/${direction}`, { require_applied: true, expected_generation: generation })
const fields = row => [row.unit_cost_usd,row.unit_cost_khr,row.total_cost_usd,row.total_cost_khr]
let checks = 0
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); db().close() }
function seed(from, { untracked = false, unknown = false } = {}) {
  h.fresh(2, from)
  db().exec(`UPDATE products SET cost_price_usd=${unknown ? 'NULL' : '12.5'},cost_price_khr=${unknown ? 'NULL' : '51000'} WHERE id=1;
    UPDATE products SET cost_price_usd=999,cost_price_khr=999999 WHERE id=2;
    UPDATE product_batches SET unit_cost_usd=${unknown ? 'NULL' : '0'} WHERE id=1;`)
  if (untracked) db().exec('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1')
}
async function main() {
  for (const app of ['branches','inventory']) for (const from of [1,2]) for (const untracked of [false,true]) {
    await check(`${app} ${from} direction, tracked/untracked=${untracked}: original source costs survive catalog edits/retry/undo/redo`, async () => {
      seed(from, { untracked })
      const body = { ...h.intent(from,1,'cost_snapshot_transfer',false), ...(!untracked ? { batchId:1 } : {}) }
      const result = await h.request(app,'/transfer',body)
      assert.equal(result.status,200,JSON.stringify(result))
      const first = costs()
      assert.equal(first.length,untracked ? 4 : 2)
      for (const row of first) assert.deepEqual(fields(row),row.batch_id === null ? [12.5,51000,18.75,76500] : [0,51000,0,(untracked?1:2.5)*51000])
      const member = db().prepare('SELECT * FROM transfer_operation_members').get()
      assert.equal(JSON.parse(member.allocations_json)[0].cost_snapshot.unitCostUsd,0)
      if (untracked) assert.equal(JSON.parse(member.source_snapshot).untracked_cost_snapshot.unitCostUsd,12.5)
      db().exec('UPDATE products SET cost_price_usd=888,cost_price_khr=777; UPDATE product_batches SET unit_cost_usd=666')
      assert.equal((await h.request(app,'/transfer',body)).status,200)
      assert.deepEqual(costs(),first,'exact retry does not duplicate or reprice movements')
      for (const [direction,generation] of [['undo',0],['redo',1]]) {
        const replay = await reverse(result.body.action_history_id,direction,generation)
        assert.equal(replay.status,200,JSON.stringify(replay))
        assert.deepEqual(costs().slice(-(first.length)).map(fields),first.map(fields))
      }
      assert.equal(db().prepare('SELECT allocations_json FROM transfer_operation_members').get().allocations_json,member.allocations_json)
    })
  }
  for (const existing of [false,true]) await check(`merge destination lot existing=${existing}: clone cost or preserve existing; movement always values source`, async () => {
    seed(1)
    h.setMerge({id:2,name:'Product 2'})
    // Lots have no KHR column; use captured source product, not target.
    if (existing) db().exec("UPDATE product_batches SET batch_key='lot-1',lot_code='lot-1',unit_cost_usd=99 WHERE id=2")
    const result = await h.request('branches','/transfer',{...h.intent(1,1,'merge_cost_snapshot',false),batchId:1})
    assert.equal(result.status,200,JSON.stringify(result))
    const allocation = JSON.parse(db().prepare('SELECT allocations_json FROM transfer_operation_members').get().allocations_json)[0]
    const lot = db().prepare('SELECT unit_cost_usd FROM product_batches WHERE id=?').get(allocation.destination_batch_id)
    assert.deepEqual(lot,existing ? {unit_cost_usd:99} : {unit_cost_usd:0})
    for (const row of costs()) assert.deepEqual(fields(row),[0,51000,0,127500])
    db().exec('UPDATE products SET cost_price_usd=4,cost_price_khr=5; UPDATE product_batches SET unit_cost_usd=6')
    for (const [direction,generation] of [['undo',0],['redo',1]]) {
      assert.equal((await reverse(result.body.action_history_id,direction,generation)).status,200)
      for (const row of costs()) assert.deepEqual(fields(row),[0,51000,0,127500])
    }
  })
  await check('unknown costs and legacy provenance stay unknown through replay', async () => {
    seed(1,{untracked:true,unknown:true})
    const result = await h.request('branches','/transfer',h.intent(1,1,'unknown_cost_snapshot',false))
    assert.equal(result.status,200,JSON.stringify(result))
    for (const row of costs()) assert.deepEqual(fields(row),[null,null,null,null])
    // Seed historical pre-cost provenance, then restore the exact production
    // trigger BEFORE testing replay. Normal writes cannot edit these snapshots.
    const seal = db().prepare("SELECT sql FROM sqlite_master WHERE name='transfer_members_immutable_update'").get().sql
    db().exec('DROP TRIGGER transfer_members_immutable_update')
    db().exec(`UPDATE transfer_operation_members SET source_snapshot=json_remove(source_snapshot,'$.untracked_cost_snapshot'),
      allocations_json=(SELECT json_group_array(json_remove(value,'$.cost_snapshot')) FROM json_each(allocations_json));
      UPDATE products SET cost_price_usd=888,cost_price_khr=777; UPDATE product_batches SET unit_cost_usd=666;`)
    db().exec(seal)
    assert.throws(()=>db().exec("UPDATE transfer_operation_members SET source_snapshot='{}'"),/immutable/)
    for (const [direction,generation] of [['undo',0],['redo',1]]) assert.equal((await reverse(result.body.action_history_id,direction,generation)).status,200)
    for (const row of costs()) assert.deepEqual(fields(row),[null,null,null,null])
  })
  await check('multiple FIFO lots retain separate nonzero costs and missing lot USD uses source product fallback',async()=>{
    seed(1)
    db().exec(`UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1;
      UPDATE product_batches SET unit_cost_usd=4 WHERE id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at) VALUES(3,1,'second','second','2026-09-02');
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(3,1,9);`)
    const result=await h.request('branches','/transfer',h.intent(1,1,'multiple_cost_snapshot',false))
    assert.equal(result.status,200,JSON.stringify(result))
    assert.deepEqual(costs().map(fields),[[4,51000,4,51000],[12.5,51000,18.75,76500],[4,51000,4,51000],[12.5,51000,18.75,76500]])
    db().exec('UPDATE products SET cost_price_usd=99; UPDATE product_batches SET unit_cost_usd=88')
    assert.equal((await reverse(result.body.action_history_id,'undo',0)).status,200)
    assert.deepEqual(costs().slice(-4).map(fields),costs().slice(0,4).map(fields))
  })
  for (const mutation of ['UPDATE products SET cost_price_usd=13 WHERE id=1','UPDATE product_batches SET unit_cost_usd=1 WHERE id=1']) {
    await check('cost changes between planning and commit reject atomically',async()=>{
      seed(1); h.beforeBatch(()=>db().exec(mutation))
      const result=await h.request('branches','/transfer',h.intent(1,1,'raced_cost_snapshot',false))
      assert.equal(result.status,500,JSON.stringify(result))
      assert.equal(costs().length,0)
      assert.equal(db().prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n,0)
      assert.equal(db().prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,10)
    })
  }
  await check('movement write failure rolls back cloned costs, quantities, receipt, and history',async()=>{
    seed(1); h.setMerge({id:2,name:'Product 2'}); h.failAt('INSERT INTO inventory_movements')
    const result=await h.request('branches','/transfer',h.intent(1,1,'failed_cost_snapshot',false))
    assert.equal(result.status,500,JSON.stringify(result))
    for(const table of ['inventory_movements','transfer_operation_receipts','transfer_operation_members','action_history','stock_transfers']) assert.equal(db().prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0)
    assert.equal(db().prepare('SELECT COUNT(*) n FROM product_batches').get().n,2)
    assert.equal(db().prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,10)
  })
  console.log(`${checks} native transfer cost scenarios passed`)
}
main().catch(error=>{console.error(error);process.exitCode=1})
