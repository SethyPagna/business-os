const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const {state:baseState}=require('./test-counted-add-budget-native.cjs')
const state=f=>({...baseState(f),returns:f.sql.prepare('SELECT * FROM returns ORDER BY id').all(),return_items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),sale_record_events:f.sql.prepare('SELECT * FROM sale_record_events ORDER BY id').all(),conditions:f.sql.prepare('SELECT * FROM counted_sale_item_conditions ORDER BY sale_item_id').all(),fees:f.sql.prepare('SELECT * FROM fees ORDER BY id').all()})
async function scenario(makeWorker,tier,receipt=true,partial=true){
 const f=await h.world(makeWorker,tier,'zero',sql=>{h.seed(1,receipt)(sql);sql.exec('UPDATE products SET selling_price_usd=2,selling_price_khr=8000 WHERE id=1')})
 const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
 assert.equal((await h.tag(f,0.6,receipt,'status-seed-tag')).status,200)
 const quote=q=>({gross_usd:2*q,product_discount_usd:0,manual_discount_usd:0,total_usd:2*q,total_khr:8000*q})
 const items=[{product_id:1,branch_id:1,quantity:0.3,client_line_key:'status-ordinary',pricing_source:'selling',pricing_quote:quote(0.3),...(receipt?{batch_id:1}:{unlotted_stock:true})},{product_id:1,branch_id:1,quantity:0.3,client_line_key:'status-tagged',pricing_source:'selling',pricing_quote:quote(0.3),damaged_lot_id:1}]
 const created=await f.call('/sales',{offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items,exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:1.2,client_request_id:'status-created'})
 assert.equal(created.status,200,JSON.stringify(created.json));const saleId=created.json.id
 if(partial){
  const lines=f.sql.prepare('SELECT id,damaged_lot_id FROM sale_items WHERE sale_id=? ORDER BY id').all(saleId)
  await stock.executeStockTransaction(db,[{sql:"INSERT INTO returns(id,sale_id,return_number,status,return_scope,return_type)VALUES(1,@sale,'STATUS-PARTIAL','completed','customer','refund')",params:{sale:saleId}},...lines.map(line=>({sql:"INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,quantity,branch_id,return_to_stock,stock_condition)VALUES(1,@item,1,'Serum',0.1,1,0,@condition)",params:{item:line.id,condition:line.damaged_lot_id?'damaged':null}}))],'once')
 }
 const body=(status,key,extra={})=>({sale_status:status,client_request_id:key,...(status==='cancelled'?{cancel_reason:'mistake'}:{}),...extra})
 const call=(status,key,extra)=>f.call('/sales/'+saleId+'/status',body(status,key,extra),'PATCH')
 return {f,saleId,stock,db,call,body}
}
async function positive(makeWorker){
 for(const tier of ['free','paid'])for(const receipt of [true,false])for(const partial of [true,false]){
  const {f,call,body,saleId}=await scenario(makeWorker,tier,receipt,partial)
  try{
   const initial=state(f),expected=partial?0.8:1,tagExpected=partial?0.5:0.6
   const cancelled=await call('cancelled','status-cancel',{cancel_fee_usd:0.1,cancel_fee_khr:400})
   assert.equal(cancelled.status,200,JSON.stringify(cancelled.json));console.log('STATUS_RESULT '+JSON.stringify({tier,receipt,partial,physical:f.state().physical,cache:f.state().cache,tags:f.state().tags}))
   assert.equal(f.state().physical,expected,'single cancellation exact mixed physical');assert.equal(f.state().cache,expected);assert.equal(f.state().tags[0].quantity_remaining,tagExpected)
   if(receipt)assert.equal(f.state().lots[0].quantity,expected)
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM fees WHERE sale_id=?').get(saleId).n,1)
   const saved=state(f);assert.equal((await call('cancelled','status-cancel',{cancel_fee_usd:0.1,cancel_fee_khr:400})).status,200);assert.deepEqual(state(f),saved,'original receipt replay is state-identical')
   const restored=await call('completed','status-reactivate');assert.equal(restored.status,200,JSON.stringify(restored.json));assert.equal(f.state().physical,0.4);assert.equal(f.state().cache,0.4);assert.equal(f.state().tags[0].quantity_remaining,0.3)
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM fees WHERE sale_id=?').get(saleId).n,0)
   assert.deepEqual(state(f).conditions,initial.conditions,'immutable original source meaning retained')
   const live=state(f);assert.equal((await call('completed','status-reactivate')).status,200);assert.deepEqual(state(f),live)
   console.log('PASS actual mixed single status exact cancel/reactivate/partial return/fees/replay '+JSON.stringify({tier,receipt,partial}))
  }finally{f.sql.close()}
 }
}
async function races(makeWorker){
 for(const tier of ['free','paid'])for(const receipt of [true,false])for(const direction of ['cancel','reactivate']){
  const w=await scenario(makeWorker,tier,receipt,true),{f,call,stock,db,saleId}=w
  try{
   if(direction==='reactivate')assert.equal((await call('cancelled','race-setup')).status,200)
   const target=direction==='cancel'?'cancelled':'completed'
   for(const fault of ['cache','membership','condition','other_branch','sale_status','return','allocation',...(receipt?['receipt_owner']:[])]){
    const original=state(f);let rival
    const sql={cache:'UPDATE products SET stock_quantity=0.5 WHERE id=1',membership:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,"+(receipt?'1':'NULL')+",0.1,0,'opened','remove')",condition:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1",other_branch:"INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1)",sale_status:"UPDATE sales SET sale_status='awaiting_delivery' WHERE id="+saleId,return:'UPDATE return_items SET quantity=0.2 WHERE id=1',allocation:receipt?'UPDATE sale_item_batch_allocations SET quantity=0.2 WHERE sale_item_id=1':"INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(1,1,1,0,0)",receipt_owner:'UPDATE product_batches SET variant_product_id=2 WHERE id=1'}[fault]
    if(fault==='other_branch')await stock.executeStockTransaction(db,[{sql:"INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1)"}],'once')
    if(fault==='receipt_owner')await stock.executeStockTransaction(db,[{sql:"INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Other product',0,1)"}],'once')
    const before=state(f)
    f.beforeCommit(async()=>{await stock.executeStockTransaction(db,[{sql:fault==='other_branch'?'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0)':sql}],'once');rival=state(f)})
    const result=await call(target,'status-'+direction+'-'+fault)
    assert.equal(result.status,409,JSON.stringify(result.json));assert.equal(result.json.code,'write_conflict');assert.deepEqual(state(f),rival,'exact rival survives and no own business/receipt/history effects')
    const reverse={cache:'UPDATE products SET stock_quantity='+before.products.find(row=>row.id===1).stock_quantity+' WHERE id=1',membership:'DELETE FROM damaged_stock_lots WHERE id=90',condition:"UPDATE damaged_stock_lots SET condition_tag='damaged' WHERE id=1",other_branch:'DELETE FROM branch_stock WHERE product_id=1 AND branch_id=2',sale_status:"UPDATE sales SET sale_status='"+(direction==='cancel'?'completed':'cancelled')+"' WHERE id="+saleId,return:'UPDATE return_items SET quantity=0.1 WHERE id=1',allocation:receipt?'UPDATE sale_item_batch_allocations SET quantity=0.3 WHERE sale_item_id=1':'DELETE FROM sale_item_batch_allocations WHERE sale_item_id=1',receipt_owner:'UPDATE product_batches SET variant_product_id=1 WHERE id=1'}[fault]
    await stock.executeStockTransaction(db,[{sql:reverse}],'once')
    console.log('PASS actual status race '+JSON.stringify({tier,receipt,direction,fault}))
   }
   const before=state(f)
   f.sql.exec("CREATE TEMP TRIGGER status_unrelated_failure BEFORE INSERT ON sale_record_events WHEN NEW.source_kind='sale_status' BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: unrelated_status_event');END")
   assert.equal((await call(target,'status-late-failure')).status,500);assert.deepEqual(state(f),before)
   f.sql.exec('DROP TRIGGER status_unrelated_failure')
   f.loseNextCommitAcknowledgement();assert.equal((await call(target,'status-late-failure')).status,200)
   const committed=state(f);assert.equal((await call(target,'status-late-failure')).status,200);assert.deepEqual(state(f),committed)
   console.log('PASS late unrelated CHECK500 rollback, same-key retry, committedACK exact receipt '+JSON.stringify({tier,receipt,direction}))
  }finally{f.sql.close()}
 }
}

async function ackAndNeutral(makeWorker){
 for(const tier of ['free','paid'])for(const receipt of [true,false]){
  const {f,call,stock,db,saleId,body}=await scenario(makeWorker,tier,receipt,true)
  try{
   const raw=f.env.DB;let denied=0,attempted=0
   const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),sql);if(['all','first','run'].includes(key))return(...args)=>{attempted++;if(/SELECT request_digest,response_json FROM sale_record_events/.test(sql)&&f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_status'").get().n&&denied<2){denied++;return Promise.reject(new Error('D1_ERROR: network reset reading committed status outcome'))}return target[key](...args)};return target[key]}})
   f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);if(key==='batch')return statements=>{attempted+=statements.length;return target.batch(statements)};return target[key]}})
   f.loseNextCommitAcknowledgement();const lost=await call('cancelled','status-unknown-ack')
   assert.equal(lost.status,500,JSON.stringify(lost.json));assert.equal(denied,2);assert.equal(f.state().physical,0.8);assert.ok(attempted<=(tier==='free'?50:1000))
   const committed=state(f);f.env.DB=raw;assert.equal((await call('cancelled','status-unknown-ack')).status,200);assert.deepEqual(state(f),committed)
   assert.equal((await f.call('/sales/'+saleId+'/status-receipt',body('cancelled','status-unknown-ack'))).json.committed,true)
   console.log('PASS committed status ACK loss + both unreadable outcome attempts then exact retry '+JSON.stringify({tier,receipt,attempted}))
  }finally{f.sql.close()}
  for(const skipped of ['sticky','imported','requested']){
   const w=await scenario(makeWorker,tier,receipt,true),g=w.f
   try{
    if(skipped!=='requested')g.sql.exec("UPDATE sales SET stock_skipped=1 WHERE id="+w.saleId)
    if(skipped==='imported')g.sql.exec('UPDATE sale_items SET returned_quantity=0.1 WHERE sale_id='+w.saleId)
    const physical=g.state(),extra=skipped==='requested'?{skip_stock:true}:{}
    assert.equal((await w.call('cancelled','neutral-cancel',extra)).status,200);assert.equal((await w.call('completed','neutral-reactivate')).status,200)
    const after=g.state();for(const field of ['physical','cache','lots','tags','movements'])assert.deepEqual(after[field],physical[field],'stock-skipped/imported ledger-neutral '+field)
    assert.equal(g.sql.prepare('SELECT stock_skipped FROM sales WHERE id=?').get(w.saleId).stock_skipped,1)
    console.log('PASS single status sticky/requested/import physical-neutrality '+JSON.stringify({tier,receipt,skipped}))
   }finally{g.sql.close()}
  }
 }
}
async function tail(makeWorker,fragments=1,probe=false){
 for(const tier of ['free','paid']){
  const {f,call,saleId,stock,db}=await scenario(makeWorker,tier,true,false)
  try{
   const sub=h.loadStockSession('lib/countedDamagedStock.ts').subtractCountedQuantity
   const unit=fragments>30?0.0001:0.01
   const inserts=[{sql:'DELETE FROM sale_item_batch_allocations WHERE sale_item_id=1'},...Array.from({length:fragments},(_,i)=>({sql:'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(1,1,1,@q,0)',params:{q:i===fragments-1?sub(0.3,Array(fragments-1).fill(unit)):unit}}))]
   await stock.executeStockTransaction(db,inserts,'once')
   const before=state(f),raw=f.env.DB,attempts=new Map(),failures=new Set();let attempted=0,committed=false,mutationBatchSize=0
   f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('Injected KV unavailable')},delete:async()=>{}}
   f.sql.exec("DELETE FROM cache_versions WHERE namespace IN('stock','sales')")
   const retry=(sql,params)=>{if(!committed)return false;const kind=/INSERT INTO audit_logs/.test(sql)?'audit':/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':/SELECT id, sale_status, updated_at FROM sales/.test(sql)?'updated':null;if(!kind)return false;const key=kind+':'+JSON.stringify(params);attempts.set(key,(attempts.get(key)||0)+1);if(failures.has(key))return false;failures.add(key);return true}
   const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),sql);if(['all','first','run'].includes(key))return(...args)=>{attempted++;return retry(sql,target.params)?Promise.reject(new Error('D1_ERROR: network reset before tail')):target[key](...args)};return target[key]}})
   f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);if(key==='batch')return async statements=>{attempted+=statements.length;if(statements.some(statement=>/INSERT INTO sale_record_events/.test(statement.text)))mutationBatchSize=statements.length;if(statements.some(statement=>retry(statement.text,statement.params)))throw new Error('D1_ERROR: network reset before tail');try{return await target.batch(statements)}finally{if(statements.some(statement=>/INSERT INTO sale_record_events/.test(statement.text)))committed=f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_status'").get().n>0}};return target[key]}})
   const result=await call('cancelled','status-tail-boundary')
   console.log('STATUS_FULL_TAIL '+JSON.stringify({tier,fragments,status:result.status,code:result.json.code,attempted,mutationBatchSize,attempts:Object.fromEntries(attempts)}))
   assert.ok(attempted<=(tier==='free'?50:1000),'outer attempts include failed calls/authentication/stock bootstrap/allwaitUntil')
   if(result.status===409){assert.equal(result.json.code,'sale_status_over_plan_budget');assert.equal(result.json.outcome,'not_dispatched');assert.deepEqual(state(f),before)}else{assert.equal(result.status,200,JSON.stringify(result.json));if(fragments===487)assert.equal(mutationBatchSize,500,'largest existing atomic statement admission');assert.equal(f.state().physical,1);assert.equal(f.state().tags[0].quantity_remaining,0.6)}
   if(!probe){assert.equal(result.status,fragments>=488||tier==='free'&&fragments>=17?409:200);if(result.status===200)assert.deepEqual([...new Set([...failures].map(key=>key.split(':')[0]))].sort(),tier==='free'?['audit','handoff','quota','versions']:['audit','handoff','versions'],'all actual audit/version/fallback/quota tail families attempted')}
  }finally{f.sql.close()}
 }
}

async function main(){const makeWorker=await h.bundle.exports.bundleWorker();if(process.argv.includes('--tail-only')){await tail(makeWorker,Number(process.env.STATUS_FRAGMENTS||1),true);return}if(process.argv.includes('--ack-only')){await ackAndNeutral(makeWorker);return}if(!process.argv.includes('--races-only'))await positive(makeWorker);await races(makeWorker);await ackAndNeutral(makeWorker);await tail(makeWorker);await tail(makeWorker,16);await tail(makeWorker,17);await tail(makeWorker,20);await tail(makeWorker,487);await tail(makeWorker,488)}
module.exports={scenario,state,positive,races,ackAndNeutral,tail}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
