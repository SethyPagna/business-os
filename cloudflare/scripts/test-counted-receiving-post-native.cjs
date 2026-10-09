const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const {state}=require('./test-counted-add-budget-native.cjs')
async function scenario(makeWorker,tier,initial=0.1,shape='explicit'){
 const f=await h.world(makeWorker,tier,'zero',sql=>{h.seed(initial,shape!=='null')(sql);sql.prepare('UPDATE product_batches SET received_quantity=?,received_cost_usd=?,supplier_name=?,payment_status=? WHERE id=1').run(initial,initial*2,'Original supplier','credit')})
 const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
 const body={product_id:1,branch_id:1,...(['explicit','null'].includes(shape)?{batch_id:1}:{}),quantity:0.2,unit_cost_usd:2,supplier_name:'New supplier',payment_status:'paid',received_date:shape==='auto'?'2026-09-01':'2026-09-05',reason:'Synthetic exact receiving',client_request_id:'receiving-exact-post'}
 return {f,stock,db,body,call:()=>f.call('/batches',body)}
}
async function positive(makeWorker){
 for(const tier of ['free','paid'])for(const initial of [0,0.1])for(const shape of ['explicit','auto','new','null']){
  const {f,call,body}=await scenario(makeWorker,tier,initial,shape)
  try{
   const before=state(f),result=await call();assert.equal(result.status,200,JSON.stringify(result.json));const expected=initial===0?0.2:0.3
   assert.equal(f.state().physical,expected);assert.equal(f.state().cache,expected)
   const batch=f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(result.json.batchId)
   if(shape==='new'){assert.notEqual(batch.id,1);assert.equal(batch.received_quantity,0.2);assert.equal(batch.received_at,'2026-09-05');assert.deepEqual(state(f).product_batches.filter(r=>r.id===1),before.product_batches)}
   else{assert.equal(batch.id,1);assert.equal(batch.received_quantity,expected);assert.equal(batch.received_at,'2026-09-01');assert.equal(batch.supplier_name,'Original supplier');assert.equal(batch.payment_status,'credit')}
   assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(batch.id).quantity,shape==='new'||shape==='null'?0.2:expected)
   const saved=state(f);assert.equal((await call()).status,200);assert.deepEqual(state(f),saved);assert.equal((await f.call('/batches',{...body,quantity:0.3})).status,409);assert.deepEqual(state(f),saved)
   console.log('PASS exact authenticated receiving '+JSON.stringify({tier,initial,shape,batchId:batch.id}))
  }finally{f.sql.close()}
 }
}
async function main(){const makeWorker=await h.bundle.exports.bundleWorker();await positive(makeWorker)}
module.exports={scenario,positive,state}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
