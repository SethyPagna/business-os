const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

function metadata(f) {
  const { is_active, ...row } = f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get()
  return row
}

async function shared(w, tier, inactive, deferred) {
  const counted=h.loadStockSession('lib/countedDamagedStock.ts'), stock=h.loadStockSession('lib/stockTransaction.ts')
  const f=await h.world(w,tier,'zero',sql=>sql.exec(`UPDATE product_batches SET is_active=${inactive===null?'NULL':inactive} WHERE id=1;
    INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1);
    INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0);
    INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Unrelated',0,1);
    INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(2,2,'unrelated',NULL);`))
  try {
    const db=h.loadStockSession('lib/db.ts').getDb(f.env), original=metadata(f), before=f.state()
    const prepare=async()=>{
      const rows=await db.prepare(`SELECT value AS branchId,${counted.countedStockFactsSql('1','CAST(value AS INTEGER)',"'[1]'")} facts FROM json_each('[1,2]') ORDER BY value`).all()
      const plan=new counted.CountedStockBatchPlan(rows,{deferPhysicalWrites:deferred}), first=plan.get(1,1), second=plan.get(1,2)
      assert.equal(first.requiresReceiptActivation(1),true)
      for(const action of ['consume','receive'])assert.throws(()=>first.changeOrdinary(1,.1,action),e=>counted.isCountedStockConflict(e))
      assert.throws(()=>first.changeOrdinary(2,.1,'activateAndReceive'),e=>counted.isCountedStockConflict(e))
      const statements=[...plan.takePreimageGuards(),...first.changeOrdinary(1,.1,'activateAndReceive')]
      assert.equal(second.requiresReceiptActivation(1),false)
      return [...statements,...second.changeOrdinary(1,.2,'receive'),...plan.takeFinalPhysicalWrites()]
    }
    await assert.rejects(stock.executeStockTransaction(db,[...await prepare(),{sql:'SELECT unknown_late_activation_column',params:{}}],'once'),e=>!counted.isCountedStockConflict(e))
    assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,inactive)
    const rivals={state:`UPDATE product_batches SET is_active=${inactive===null?0:'NULL'} WHERE id=1`,active:'UPDATE product_batches SET is_active=1 WHERE id=1',owner:'UPDATE product_batches SET variant_product_id=2 WHERE id=1',product:'UPDATE products SET is_active=0 WHERE id=1',branch:'UPDATE branches SET is_active=0 WHERE id=1',member:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(99,1,'new-receipt',1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(99,1,0)"}
    for(const [kind,sql] of Object.entries(rivals)){
      const statements=await prepare()
      f.competeBeforeCommit(sql.split(';').map(sql=>({sql})))
      await assert.rejects(stock.executeStockTransaction(db,statements,'once'),e=>counted.isCountedStockConflict(e))
      assert.equal(f.state().cache,0);assert.equal(f.state().physical,0);assert.deepEqual(f.state().movements,before.movements)
      if(kind==='state')assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,inactive===null?0:null)
      await stock.executeStockTransaction(db,[{sql:'DELETE FROM branch_batch_stock WHERE batch_id=99',params:{}},{sql:'DELETE FROM product_batches WHERE id=99',params:{}},{sql:`UPDATE product_batches SET is_active=${inactive===null?'NULL':inactive},variant_product_id=1 WHERE id=1`,params:{}},{sql:'UPDATE products SET is_active=1 WHERE id=1',params:{}},{sql:'UPDATE branches SET is_active=1 WHERE id=1',params:{}}],'once')
    }
    for(const invalid of [-1,2]){
      await stock.executeStockTransaction(db,[{sql:'UPDATE product_batches SET is_active=@invalid WHERE id=1',params:{invalid}}],'once')
      const row=await db.prepare(`SELECT ${counted.countedStockFactsSql('1','1',"'[1]'")} facts`).get(), plan=new counted.CountedStockPlan(row.facts,1)
      assert.throws(()=>plan.changeOrdinary(1,.1,'activateAndReceive'),e=>counted.isCountedStockConflict(e))
      await stock.executeStockTransaction(db,[{sql:'UPDATE product_batches SET is_active=@inactive WHERE id=1',params:{inactive}}],'once')
    }
    await stock.executeStockTransaction(db,await prepare(),'once')
    assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,1)
    assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=2').get().is_active,null)
    assert.equal(f.state().cache,.3);assert.equal(f.state().physical,.1)
    assert.deepEqual(f.sql.prepare('SELECT branch_id,quantity FROM branch_batch_stock WHERE batch_id=1 ORDER BY branch_id').all(),[{branch_id:1,quantity:.1},{branch_id:2,quantity:.2}])
    assert.deepEqual(metadata(f),original)
    console.log('PASS shared receipt '+JSON.stringify({tier,inactive,deferred}))
  } finally {f.sql.close()}
}

async function http(w,tier,inactive,scenario='normal'){
  const f=await h.world(w,tier,'zero',sql=>sql.exec(`UPDATE product_batches SET is_active=${inactive===null?'NULL':inactive} WHERE id=1;
    INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)VALUES(50,'NULL-RECEIPT',1,'completed',4000,2,2);
    INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,batch_id,quantity,applied_price_usd,total_usd,cost_price_usd)VALUES(50,50,1,'Serum',1,1,.2,10,2,2);
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(50,1,1,.2,0);`))
  try{
    const original=metadata(f),before=f.state(),body={sale_id:50,branch_id:1,reason:'Historical receipt return',client_request_id:'nullable-'+scenario,items:[{sale_item_id:50,product_id:1,quantity:.2,stock_condition:'ordinary',applied_price_usd:10}]}
    if(scenario==='state')f.competeBeforeCommit([{sql:`UPDATE product_batches SET is_active=${inactive===null?0:'NULL'} WHERE id=1`}])
    if(scenario==='late')f.failWhenSqlMatches(/INSERT INTO return_create_receipts/)
    if(scenario==='ack')f.loseNextCommitAcknowledgement()
    const result=await f.call('/returns',body)
    if(scenario==='state'){
      assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(f.state(),before)
      assert.equal(f.sql.prepare('SELECT count(*) n FROM return_create_receipts').get().n,0)
      console.log('PASS HTTP inactive identity race '+tier);return
    }
    if(scenario==='late'){
      assert.equal(result.status,503,JSON.stringify(result));assert.equal(result.json.code,'unknown_outcome');assert.deepEqual(f.state(),before)
      assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,inactive)
      assert.equal((await f.call('/returns',body)).status,200)
    }else assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(f.state().physical,.2);assert.equal(f.state().cache,.2);assert.equal(f.state().lots[0].quantity,.2)
    assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,1);assert.deepEqual(metadata(f),original)
    const saved=f.state();assert.equal((await f.call('/returns',body)).status,200);assert.deepEqual(f.state(),saved)
    console.log('PASS HTTP explicit archived receipt '+JSON.stringify({tier,inactive,scenario}))
  }finally{f.sql.close()}
}

async function main(){const w=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid'])for(const inactive of [0,null])for(const scenario of ['normal','state','late','ack'])await http(w,tier,inactive,scenario);for(const tier of ['free','paid'])for(const inactive of [0,null])for(const deferred of [false,true])await shared(w,tier,inactive,deferred)}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={http,shared}
