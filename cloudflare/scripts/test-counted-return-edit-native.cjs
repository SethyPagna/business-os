const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function edit(makeWorker, tier, kind = 'ordinary', scenario = 'normal') {
  const batch = kind !== 'NULL' && kind !== 'dated'
  const f = await h.world(makeWorker, tier, 'zero', sql => {
    h.seed(.3, batch)(sql)
    sql.exec(`INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)
      VALUES(50,'RETURN-EDIT-EXACT',1,'partial_return',4000,3,3);
      ${kind==='NULL'?"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,1,NULL,0.3,0,'opened','remove');":''}
      INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,batch_id,damaged_lot_id,quantity,applied_price_usd,total_usd,cost_price_usd)
      VALUES(50,50,1,'Serum',1,${batch?1:'NULL'},${kind==='NULL'?1:'NULL'},0.3,10,3,2);
      INSERT INTO returns(id,return_number,sale_id,return_scope,branch_id,status,reason,return_type,total_refund_usd,created_at,updated_at)
      VALUES(55,'RETURN-EDIT-55',50,'customer',1,'completed','Original return','Refund',2,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z');
      INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,total_usd,cost_price_usd,return_to_stock,stock_action,branch_id,batch_id)
      VALUES(55,55,50,1,'Serum',0.2,10,2,2,${kind==='opened'?0:1},'${kind==='opened'?'damaged':'restock'}',1,${batch?1:'NULL'});
      ${batch?"INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(50,1,1,0.3,0); INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)VALUES(55,50,1,1,0.2);":''}
      ${kind==='opened'?"INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,return_id,unit_cost_usd)VALUES(1,1,'Serum',1,1,0.2,0.2,'opened','return',55,2);":''}`)
  })
  try {
    if(process.env.COUNTED_EDIT_DEBUG) {
      const prepare=f.sql.prepare.bind(f.sql)
      f.sql.prepare=sql=>new Proxy(prepare(sql),{get(target,key){const member=target[key];if(typeof member!=='function')return member;return (...args)=>{try{return member.apply(target,args)}catch(e){console.error('SQL failure',sql,args,e.message);throw e}}}})
    }
    if(kind==='opened') await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[
      {sql:'UPDATE damaged_stock_lots SET return_item_id=55 WHERE id=1'},
      {sql:'UPDATE branch_stock SET quantity=0.3 WHERE product_id=1 AND branch_id=1'},
      {sql:'UPDATE branch_batch_stock SET quantity=0.3 WHERE batch_id=1 AND branch_id=1'},
      {sql:'UPDATE products SET stock_quantity=0.3 WHERE id=1'},
    ],'once')
    const purchase = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
    const body = {client_request_id:'edit-exact-'+kind+'-'+scenario,expected_updated_at:'2026-09-01T00:00:00.000Z',items:[{
      sale_item_id:50,product_id:1,branch_id:1,quantity:.1,stock_condition:kind==='opened'?'opened':'ordinary',applied_price_usd:10,applied_price_khr:40000}]}
    const before = f.state()
    const originalItems=f.sql.prepare('SELECT * FROM return_items WHERE return_id=55 ORDER BY id').all()
    const rivals={
      condition:"UPDATE damaged_stock_lots SET condition_tag='damaged' WHERE id=1",
      allocation:'UPDATE return_item_batch_allocations SET quantity=0.1 WHERE return_item_id=55',
      source:'UPDATE sale_items SET batch_id=NULL WHERE id=50',
      price:'UPDATE sale_items SET applied_price_usd=11 WHERE id=50',
      cost:'UPDATE sale_items SET cost_price_usd=3 WHERE id=50',
      actor:'UPDATE users SET is_active=0 WHERE id=7',
      role:"UPDATE roles SET permissions='{}' WHERE code='admin'",
      saleAllocation:'UPDATE sale_item_batch_allocations SET released_quantity=0.1 WHERE sale_item_id=50',
      returnPrice:'UPDATE return_items SET applied_price_usd=11 WHERE return_id=55',
      returnHeader:"UPDATE returns SET reason='Rival reason' WHERE id=55",
      receipt:'UPDATE product_batches SET unit_cost_usd=3 WHERE id=1',
      active:'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1',
      member:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(99,1,'new-zero-member',1)",
      tagOwner:'UPDATE damaged_stock_lots SET return_item_id=NULL WHERE id=1',
    }
    if(rivals[scenario]) {
      const statements=[{sql:rivals[scenario]}]
      if(scenario==='member')statements.push({sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(99,1,0)'})
      if(scenario==='active')statements.push({sql:'UPDATE product_batches SET is_active=0 WHERE id=1'})
      f.competeBeforeCommit(statements)
    }
    if(scenario==='late')f.failWhenSqlMatches(/INSERT INTO return_mutation_receipts/)
    if(scenario==='lookalike')f.sql.exec('CREATE TEMP TABLE unrelated(guard_value_unrelated INTEGER CHECK(guard_value_unrelated=1));CREATE TEMP TRIGGER unrelated_late BEFORE INSERT ON return_mutation_receipts BEGIN INSERT INTO unrelated VALUES(0);END')
    if(scenario==='ack')f.loseNextCommitAcknowledgement()
    if(scenario==='none')body.items[0].stock_action='none'
    if(['near','over'].includes(scenario)) {
      body.branch_id=1;body.items=[{...body.items[0]},{...body.items[0]}]
      if(scenario==='over')body.items.push({...body.items[0],quantity:.05})
    }
    const result = await f.call('/returns/55',body,'PATCH')
    if(scenario==='over'){assert.equal(result.status,400,JSON.stringify(result));assert.equal(result.json.code,'return_edit_over_plan_budget');assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM return_mutation_receipts').get().n,0);console.log('PASS Free third stock item refuses before dispatch');return}
    if (result.status===400 && tier==='free') {
      if(scenario==='over'){assert.equal(result.json.code,'return_edit_over_plan_budget');assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM return_mutation_receipts').get().n,0);console.log('PASS Free +1 planned item refuses before dispatch');return}
      assert.fail('Common single-return edit must fit Free: '+JSON.stringify(result.json))
    }
    if(rivals[scenario]) {
      assert.equal(result.status,409,JSON.stringify(result.json));assert.equal(result.json.code,'write_conflict')
      assert.equal(f.state().physical,.3);assert.deepEqual(f.state().movements,before.movements)
      if(scenario!=='returnPrice')assert.deepEqual(f.sql.prepare('SELECT * FROM return_items WHERE return_id=55 ORDER BY id').all(),originalItems)
      else assert.equal(f.sql.prepare('SELECT applied_price_usd FROM return_items WHERE return_id=55').get().applied_price_usd,11)
      assert.equal(f.sql.prepare('SELECT count(*) n FROM return_mutation_receipts').get().n,0)
      console.log('PASS exact legacy PATCH rival '+scenario);return
    }
    if(['late','lookalike'].includes(scenario)) {
      assert.equal(result.status,503);assert.equal(result.json.code,'unknown_outcome');assert.deepEqual(f.state(),before)
      assert.deepEqual(f.sql.prepare('SELECT * FROM return_items WHERE return_id=55 ORDER BY id').all(),originalItems)
      if(scenario==='lookalike')f.sql.exec('DROP TRIGGER unrelated_late')
      assert.equal((await f.call('/returns/55',body,'PATCH')).status,200)
    } else assert.equal(result.status,200,JSON.stringify(result.json))
    assert.equal(f.state().physical,scenario==='none'?.1:['near','over'].includes(scenario)?.3:.2,'exact reversal and receive')
    assert.equal(f.state().cache,f.state().physical)
    if(batch)assert.equal(f.state().lots[0].quantity,f.state().physical)
    if(kind==='NULL')assert.equal(f.sql.prepare('SELECT batch_id FROM return_items WHERE return_id=55').get().batch_id,null)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get(),purchase)
    const saved=f.state();assert.equal((await f.call('/returns/55',body,'PATCH')).status,200);assert.deepEqual(f.state(),saved)
    if(kind==='dated') {
      const dated=f.sql.prepare("SELECT * FROM product_batches WHERE batch_key LIKE ' event:return-edit:%'").get()
      assert.ok(dated);assert.equal(dated.received_quantity,.1)
      const next={...body,client_request_id:'edit-dated-second',expected_updated_at:f.sql.prepare('SELECT updated_at FROM returns WHERE id=55').get().updated_at,
        items:[{...body.items[0],quantity:.2}]}
      assert.equal((await f.call('/returns/55',next,'PATCH')).status,200)
      assert.equal(f.state().physical,.3);assert.equal(f.state().cache,.3)
      assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(dated.id),dated,'repeat edit preserves existing dated receipt attribution')
    }
    console.log('PASS exact legacy PATCH '+tier+' '+kind)
  } finally { f.sql.close() }
}
async function main(){const makeWorker=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid'])for(const kind of ['ordinary','opened','NULL','dated'])await edit(makeWorker,tier,kind);for(const tier of ['free','paid'])for(const scenario of ['condition','allocation','source','price','cost','actor','role','saleAllocation','returnPrice','returnHeader','receipt','active','member','tagOwner','late','lookalike','ack','none'])await edit(makeWorker,tier,['condition','tagOwner'].includes(scenario)?'opened':'ordinary',scenario);for(const scenario of ['near','over'])await edit(makeWorker,'free','ordinary',scenario)}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={edit}
