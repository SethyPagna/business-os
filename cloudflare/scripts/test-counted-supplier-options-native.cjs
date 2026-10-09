const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const url=ids=>'/returns/supplier-options?branch_id=1&product_ids='+ids.join(',')
const write=(f,rows)=>h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),rows,'once')
const business=f=>Object.fromEntries(['products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','inventory_movements','returns','return_items','audit_logs','action_history','return_create_receipts'].map(table=>[table,f.sql.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]))
async function main(){
 const make=await h.bundle.exports.bundleWorker()
 for(const tier of ['free','paid']){
  const f=await h.world(make,tier,'zero',sql=>{for(let id=2;id<=26;id++){sql.prepare('INSERT INTO products(id,name,stock_quantity,is_active)VALUES(?,?,0,1)').run(id,'Source'+id);sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(?,1,0)').run(id)}})
  try{
   const ids=Array.from({length:25},(_,index)=>index+1),before=business(f),accepted=await f.call(url(ids),undefined,'GET')
   assert.equal(accepted.status,200);assert.equal(accepted.json.items.length,25);assert.deepEqual(business(f),before)
   assert.equal((await f.call(url([...ids,26]),undefined,'GET')).status,400);assert.deepEqual(business(f),before)
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const receipt of [false,true]){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,receipt)(sql);sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,${receipt?1:'NULL'},.25,.25,'damaged','remove',3);
   UPDATE product_batches SET batch_number=7 WHERE id=1;INSERT INTO products(id,name,cost_price_usd,cost_price_khr,stock_quantity,is_active)VALUES(2,'Other',4,0,.2,1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,.2);`)});
  try{
   const before=f.state(),source=await f.call(url([1,2]),undefined,'GET')
   assert.equal(source.status,200,JSON.stringify(source));assert.deepEqual(f.state(),before)
   assert.equal(source.json.supplier_condition_version,1);assert.equal(source.json.financial_visibility,true);assert.equal(source.json.financial_editable,true)
   const item=source.json.items.find(item=>item.product_id===1);assert.equal(item.ordinary_available,.5);assert.equal(item.ordinary_unlotted,receipt?0:.5)
   assert.equal(item.return_cost_usd,2,'catalog valuation remains distinct from original tagged cost')
   assert.deepEqual(item.tagged_sources[0],{damaged_lot_id:1,stock_condition:'damaged',batch_id:receipt?1:null,available:.25,received_at:receipt?'2026-09-01':null,lot_code:null,batch_number:receipt?7:null,source_cost_usd:3,source:'remove'})
   if(receipt){assert.equal(item.ordinary_receipts[0].received_at,'2026-09-01');assert.equal(item.ordinary_receipts[0].available,.5);assert.equal(item.ordinary_receipts[0].source_cost_usd,2)}
   assert.equal((await f.call(url([1,1]),undefined,'GET')).status,400);assert.equal((await f.call(url([1,999]),undefined,'GET')).status,409)
   await write(f,[{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1"}])
   const stale=f.state(),rejected=await f.call('/returns/supplier',{branch_id:1,reason:'Stale source',settlement:'refund',client_request_id:'stale-options',items:[{product_id:1,quantity:.125,stock_condition:'damaged',damaged_lot_id:1,cost_price_usd:2}]})
   assert.equal(rejected.status,409);assert.deepEqual(f.state(),stale)
   const fresh=await f.call(url([1]),undefined,'GET');assert.equal(fresh.status,200);assert.equal(fresh.json.items[0].tagged_sources[0].stock_condition,'opened')
   const damaged=await f.call('/returns/damaged-lots?product_id=1&branch_id=1',undefined,'GET');assert.equal(damaged.status,200);assert.equal(damaged.json[0].condition_tag,'opened')
   const created=await f.call('/returns/supplier',{branch_id:1,reason:'Reviewed source',settlement:'refund',client_request_id:'reviewed-options',items:[{product_id:1,quantity:.125,stock_condition:'opened',damaged_lot_id:1,cost_price_usd:item.return_cost_usd,cost_price_khr:item.return_cost_khr}]})
   assert.equal(created.status,200);assert.equal(f.state().physical,.625);assert.equal(f.state().tags[0].quantity_remaining,.125)
   const detail=await f.call('/returns/'+created.json.id,undefined,'GET');assert.equal(detail.status,200);assert.equal(detail.json.items[0].stock_condition,'opened');assert.equal(detail.json.items[0].cost_price_usd,2)
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const mode of ['zero','absent','inactive-product','inactive-branch','owner','float-stock','float-cost','float-receipt-cost','oversize','no-cost-view','no-view','no-returns']){
  const f=await h.world(make,tier,'zero',h.seed(['zero','absent','inactive-product'].includes(mode)?0:.3,true))
  try{
   assert.equal((await f.call('/returns/capabilities',undefined,'GET')).status,200)
   if(mode==='absent')await write(f,[{sql:'DELETE FROM branch_batch_stock WHERE branch_id=1'},{sql:'DELETE FROM branch_stock WHERE product_id=1'}])
   if(mode==='inactive-product')await write(f,[{sql:'UPDATE products SET is_active=0 WHERE id=1'}])
   if(mode==='inactive-branch')f.sql.exec('UPDATE branches SET is_active=0 WHERE id=1')
   if(mode==='owner')await write(f,[{sql:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.1,.1,'damaged','remove',2)"},{sql:'UPDATE product_batches SET variant_product_id=999 WHERE id=1'}])
   if(mode==='float-stock')await write(f,[{sql:'UPDATE products SET stock_quantity=.30000000000000004 WHERE id=1'},{sql:'UPDATE branch_stock SET quantity=.30000000000000004 WHERE product_id=1'},{sql:'UPDATE branch_batch_stock SET quantity=.30000000000000004 WHERE batch_id=1'}])
   if(mode==='float-cost')await write(f,[{sql:'UPDATE products SET cost_price_usd=1.0000000000000002 WHERE id=1'}])
   if(mode==='float-receipt-cost')await write(f,[{sql:'UPDATE product_batches SET unit_cost_usd=1.0000000000000002 WHERE id=1'}])
   if(mode==='oversize')f.sql.prepare('UPDATE products SET name=? WHERE id=1').run('ក'.repeat(180000))
   if(mode.startsWith('no-')){
    const permissions=mode==='no-returns'?{}:{returns:true,...(mode==='no-view'?{'returns:view':false}:{})}
    f.sql.exec("INSERT INTO roles(id,name,code,permissions)VALUES(99,'Fixture role','fixture','{}')")
    f.sql.prepare('UPDATE users SET role_id=99,permissions=? WHERE id=7').run(JSON.stringify(permissions))
   }
   const before=business(f),result=await f.call(url([1]),undefined,'GET')
   console.log(JSON.stringify({optionsTier:tier,mode,status:result.status}))
   if(mode.startsWith('float-') && result.status===200){
    const item=result.json.items[0]
    assert.equal(mode==='float-stock'?item.ordinary_available:mode==='float-cost'?item.return_cost_usd:item.ordinary_receipts[0].source_cost_usd,mode==='float-stock'?.30000000000000004:1.0000000000000002,'accepted source preserves exact stored REAL; rounded successful output is forbidden')
   }else assert.equal(result.status,mode==='no-view'||mode==='no-returns'?403:['zero','absent','no-cost-view'].includes(mode)?200:409,JSON.stringify(result))
   if(['zero','absent'].includes(mode)){assert.equal(result.json.items[0].ordinary_available,0);assert.deepEqual(result.json.items[0].tagged_sources,[])}
   if(mode==='no-cost-view'){assert.equal(result.json.financial_visibility,false);assert.equal(result.json.financial_editable,false);assert.ok(!Object.hasOwn(result.json.items[0],'return_cost_usd'));assert.ok(!Object.hasOwn(result.json.items[0].ordinary_receipts[0],'source_cost_usd'))}
   assert.deepEqual(business(f),before,'source reads never mutate stock, products, receipts, returns or audit')
  }finally{f.sql.close()}
 }
 console.log('supplier source batch/read permission/exact metadata/unavailable/stale-choice native: PASS')
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={main}
