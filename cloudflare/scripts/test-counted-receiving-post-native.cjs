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
async function faults(makeWorker){
 for(const tier of ['free','paid'])for(const shape of ['explicit','new','null'])for(const fault of ['cache','receipt_quantity','receipt_cost','receipt_metadata','receipt_date','membership','tag_membership','branch']){
  const {f,stock,db,call}=await scenario(makeWorker,tier,0.1,shape)
  try{
   let rival
   const sql={cache:'UPDATE products SET stock_quantity=0.2 WHERE id=1',receipt_quantity:'UPDATE product_batches SET received_quantity=0.2 WHERE id=1',receipt_cost:'UPDATE product_batches SET received_cost_usd=0.4 WHERE id=1',receipt_metadata:"UPDATE product_batches SET supplier_name='Rival supplier' WHERE id=1",receipt_date:"UPDATE product_batches SET received_at='2026-09-05' WHERE id=1",membership:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(90,1,'rival-empty',1)",tag_membership:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,NULL,0,0,'opened','remove')",branch:'UPDATE branches SET is_active=0 WHERE id=1'}[fault]
   f.beforeCommit(async()=>{await stock.executeStockTransaction(db,[{sql}],'once');rival=state(f)})
   const result=await call();assert.equal(result.status,409,JSON.stringify(result.json));assert.ok(['write_conflict','receiving_branch_inactive'].includes(result.json.code));assert.deepEqual(state(f),rival);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n,0)
   console.log('PASS receiving exact precommit source race '+JSON.stringify({tier,shape,fault}))
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const shape of ['explicit','new','null']){
  const {f,call}=await scenario(makeWorker,tier,0.1,shape)
  try{
   const before=state(f);f.sql.exec("CREATE TEMP TRIGGER receiving_unrelated BEFORE INSERT ON inventory_movements WHEN NEW.reason='Synthetic exact receiving' BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: guard_value_unrelated');END")
   assert.equal((await call()).status,400,'existing unrelated inner receiving failure contract');assert.deepEqual(state(f),before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n,0)
   f.sql.exec('DROP TRIGGER receiving_unrelated');f.loseNextCommitAcknowledgement();const lost=await call();assert.equal(lost.status,503,JSON.stringify(lost.json));assert.equal(lost.json.code,'stock_request_outcome_unknown');assert.equal(f.state().physical,0.3)
   const committed=state(f);const again=await call();assert.equal(again.status,409);assert.equal(again.json.code,'stock_request_partially_applied');assert.deepEqual(state(f),committed);assert.equal(f.sql.prepare('SELECT written FROM stock_mutation_receipts').get().written,1)
   console.log('PASS unrelated receiving400 rollback and committedACK503/partial409 never duplicate '+JSON.stringify({tier,shape}))
  }finally{f.sql.close()}
 }
}
async function tails(makeWorker){
 for(const tier of ['free','paid'])for(const shape of ['explicit','new','null','price','free','combined']){
  const {f,call,body:request}=await scenario(makeWorker,tier,0.1,['free','combined'].includes(shape)?'new':shape==='price'?'explicit':shape),raw=f.env.DB;
  if(['free','combined'].includes(shape))request.free_quantity=1
  if(['price','combined'].includes(shape)){request.selling_price_usd=3;request.selling_price_khr=12000}
 let attempted=0,committed=false,body=0;const failed=new Set(),families=new Set()
  try{
   f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('Synthetic KV failure')},delete:async()=>{}};f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
   const retry=(sql,params)=>{if(!committed)return false;const family=/UPDATE stock_mutation_receipts SET response_status/.test(sql)?'completion':/INSERT INTO audit_logs/.test(sql)?'audit':/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null;if(!family)return false;families.add(family);const key=family+JSON.stringify(params);if(failed.has(key))return false;failed.add(key);return true}
   const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),sql);if(['all','first','run'].includes(key))return(...args)=>{attempted++;return retry(sql,target.params)?Promise.reject(new Error('D1_ERROR: network reset before receiving tail')):target[key](...args)};return target[key]}})
   f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);if(key==='batch')return async statements=>{attempted+=statements.length;const mutation=statements.some(row=>/INSERT INTO inventory_movements/.test(row.text));if(mutation)body=statements.length;if(statements.some(row=>retry(row.text,row.params)))throw new Error('D1_ERROR: network reset before receiving tail');try{return await target.batch(statements)}finally{if(mutation)committed=f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n>0}};return target[key]}})
   const result=await call();assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(f.state().physical,['free','combined'].includes(shape)?1.3:0.3);assert.ok(attempted<=(tier==='free'?50:1000));assert.deepEqual([...families].sort(),tier==='free'?['audit','completion','handoff','quota','versions']:['audit','completion','handoff','versions']);console.log('RECEIVING_FULL_TAIL '+JSON.stringify({tier,shape,attempted,body}))
  }finally{f.sql.close()}
 }
}

async function actors(makeWorker){
 for(const tier of ['free','paid'])for(const fault of ['active','username','organization','role','permissions','role_permissions','role_code','must_change']){
  const {f,stock,db,call}=await scenario(makeWorker,tier)
  try{
   let rival
   const sql={active:'UPDATE users SET is_active=0 WHERE id=7',username:"UPDATE users SET username='different' WHERE id=7",organization:'UPDATE users SET organization_id=99 WHERE id=7',role:'UPDATE users SET role_id=NULL WHERE id=7',permissions:"UPDATE users SET permissions='{}' WHERE id=7",role_permissions:"UPDATE roles SET permissions='{}' WHERE id=(SELECT role_id FROM users WHERE id=7)",role_code:"UPDATE roles SET code='different' WHERE id=(SELECT role_id FROM users WHERE id=7)",must_change:'UPDATE users SET must_change_password=1 WHERE id=7'}[fault]
   f.beforeCommit(async()=>{await stock.executeStockTransaction(db,[{sql}],'once');rival=state(f)})
   const result=await call();assert.equal(result.status,409,JSON.stringify(result.json));assert.equal(result.json.code,'write_conflict');assert.deepEqual(state(f),rival);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n,0)
   console.log('PASS receiving captured current actor race '+JSON.stringify({tier,fault}))
  }finally{f.sql.close()}
 }
}

async function main(){const makeWorker=await h.bundle.exports.bundleWorker();if(process.argv.includes('--actor-only')){await actors(makeWorker);return}if(process.argv.includes('--faults-only')){await faults(makeWorker);return}if(process.argv.includes('--tails-only')){await tails(makeWorker);return}await positive(makeWorker);await faults(makeWorker);await tails(makeWorker);await actors(makeWorker)}
module.exports={scenario,positive,faults,tails,actors,state}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
