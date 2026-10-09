const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const input=(key,quantity=.1,condition='damaged',lot=1)=>({branch_id:1,reason:'Explicit supplier source',settlement:'refund',supplier_name:'Fixture supplier',exchange_rate:4000,client_request_id:key,items:[{product_id:1,branch_id:1,quantity,cost_price_usd:2,stock_condition:condition,...(lot?{damaged_lot_id:lot}:{})}]})
const state=f=>({...f.state(),returns:f.sql.prepare('SELECT * FROM returns ORDER BY id').all(),items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),receipts:f.sql.prepare('SELECT * FROM return_create_receipts ORDER BY id').all(),audit:f.sql.prepare('SELECT * FROM audit_logs ORDER BY id').all()})
const status=(f,id,source,target,key)=>{const r=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(id);return f.call('/returns/bulk',{client_request_id:key,field:'status',source,target,items:[{id,expected_status:r.status,expected_method:r.supplier_settlement,expected_updated_at:r.updated_at}]})}
async function main(){
 const make=await h.bundle.exports.bundleWorker()
 for(const tier of ['free','paid'])for(const receipt of [false,true]){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.3,receipt)(sql);sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,${receipt?1:'NULL'},.2,.2,'damaged','remove',2)`)});
  try{
   const source=f.sql.prepare('SELECT * FROM damaged_stock_lots WHERE id=1').get()
   const body=input('supplier-explicit-'+receipt),created=await f.call('/returns/supplier',body)
   assert.equal(created.status,200,'explicit selected tag must be supported without ordinary substitution')
   assert.equal(f.state().physical,.4);assert.equal(f.state().cache,.4);assert.equal(f.state().tags[0].quantity_remaining,.1)
   const record=f.sql.prepare('SELECT * FROM return_create_receipts WHERE return_id=?').get(created.json.id),manifest=JSON.parse(record.request_json)
   assert.equal(manifest.scope,'supplier');assert.equal(manifest.sources[0].lotId,1);assert.equal(manifest.sources[0].condition,'damaged');assert.equal(manifest.sources[0].batchId,receipt?1:null)
   assert.equal(f.sql.prepare('SELECT stock_condition FROM return_items WHERE return_id=?').get(created.json.id).stock_condition,'damaged')
   const committed=state(f)
   assert.equal((await f.call('/returns/supplier',body)).status,200);assert.deepEqual(state(f),committed)
   const cancelled=await status(f,created.json.id,'completed','cancelled','supplier-cancel-'+receipt)
   assert.equal(cancelled.status,200);assert.equal(f.state().physical,.5);assert.equal(f.state().tags[0].quantity_remaining,.2)
   assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.state().physical,.4);assert.equal(f.state().tags[0].quantity_remaining,.1)
   assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.state().physical,.5);assert.equal(f.state().tags[0].quantity_remaining,.2)
   assert.equal((await status(f,created.json.id,'cancelled','completed','supplier-restore-'+receipt)).status,200)
   assert.equal(f.state().physical,.4);assert.equal(f.state().tags[0].quantity_remaining,.1)
   assert.equal(f.sql.prepare('SELECT request_json FROM return_create_receipts WHERE return_id=?').get(created.json.id).request_json,record.request_json)
   const after=f.sql.prepare('SELECT * FROM damaged_stock_lots WHERE id=1').get()
   for(const key of ['quantity','source','return_id','return_item_id','unit_cost_usd','created_at'])assert.equal(after[key],source[key],key+' original lineage is immutable')
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const phase of ['apply','cancel','undo','redo'])for(const mode of ['condition','owner','actor','ack','late']){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.3,true)(sql);sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.2,.2,'damaged','remove',2)")})
  try{
   let id=0,history=0
   if(phase!=='apply'){id=(await f.call('/returns/supplier',input('setup-'+phase))).json.id}
   if(['undo','redo'].includes(phase)){const applied=await status(f,id,'completed','cancelled','setup-cancel');assert.equal(applied.status,200);history=applied.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const expected=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(id)
   const cancelInput={client_request_id:'rival-cancel',field:'status',source:'completed',target:'cancelled',items:[{id,expected_status:expected?.status,expected_method:expected?.supplier_settlement,expected_updated_at:expected?.updated_at}]}
   const call=()=>phase==='apply'?f.call('/returns/supplier',input('rival-source')):phase==='cancel'?f.call('/returns/bulk',cancelInput):f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   const before=state(f)
   if(mode==='condition')f.competeBeforeCommit([{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1",params:{}}])
   if(mode==='owner')f.competeBeforeCommit([{sql:'UPDATE product_batches SET variant_product_id=999 WHERE id=1',params:{}}])
   if(mode==='actor')f.beforeCommit(sql=>sql.prepare('UPDATE users SET is_active=0 WHERE id=7').run())
   if(mode==='ack')f.loseNextCommitAcknowledgement()
   if(mode==='late')f.sql.exec("CREATE TRIGGER supplier_condition_late BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: counted_quantity_conflict_external=1'); END")
   const result=await call()
   console.log(JSON.stringify({tier,phase,mode,status:result.status,code:result.json.code}))
   if(['condition','owner','actor'].includes(mode)){
    assert.equal(result.status,409);assert.equal(f.state().physical,before.physical)
    assert.deepEqual(state(f).returns,before.returns);assert.deepEqual(state(f).items,before.items);assert.deepEqual(state(f).receipts,before.receipts)
    assert.deepEqual(state(f).movements,before.movements);assert.deepEqual(state(f).audit,before.audit)
   }else if(mode==='late'){
    assert.equal(result.status,503,'unrelated dispatched failure stays unknown')
    assert.deepEqual(state(f),before)
    f.sql.exec('DROP TRIGGER supplier_condition_late')
    assert.equal((await call()).status,200)
   }else{
    assert.equal(result.status,phase==='apply'?503:200)
    const committed=state(f)
    assert.equal((await call()).status,200,'explicit same-input ACK retry confirms original commit')
    assert.deepEqual(state(f),committed)
   }
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const extraReads of [0,...(tier==='free'?[8,9]:[])]){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.3,true)(sql);sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.2,.2,'damaged','remove',2)")})
  try{
   const id=(await f.call('/returns/supplier',input('tail-source'))).json.id
   const cancelled=await status(f,id,'completed','cancelled','tail-cancel');assert.equal(cancelled.status,200)
   f.sql.exec('DELETE FROM cache_versions')
   f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('KV unavailable')},delete:async()=>{}}
   const raw=f.env.DB,injected=new Set();let consumed=false
   const group=target=>{
    const text=target.text||'',params=target.params||[]
    if(text.includes('cache_versions'))return(text.includes('INSERT')?'cache-write:':'cache-read:')+(JSON.stringify(params).includes('stock')?'stock':'returns')
    if(text.includes('INSERT INTO quota_usage'))return 'quota:'+params[2]
    if(text.includes('SELECT return_id FROM return_bulk_members'))return 'notification-members'
    if(text.includes('r.return_number, r.status'))return 'notification-status'
    if(text.includes('SELECT key, value FROM settings WHERE key IN'))return 'notification-config'
    if(text.includes('SELECT * FROM action_history WHERE id'))return 'history-response'
    return null
   }
   const wrap=statement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return(...args)=>wrap(target.bind(...args))
    if(['first','all','run'].includes(key))return async(...args)=>{
     if(!consumed&&(target.text||'').includes('SELECT o.*,s.payload_json')){consumed=true;for(let n=0;n<extraReads;n++){globalThis[Symbol.for('business-os.request-metrics.v1')].d1Start(1);await raw.prepare('SELECT 1 AS consumed_request_read').first()}}
     const result=await target[key](...args),kind=group(target)
     if(kind&&!injected.has(kind)&&f.sql.prepare('SELECT generation FROM return_bulk_operations WHERE id=?').get(cancelled.json.operationId).generation>0){injected.add(kind);throw new Error('D1_ERROR: simulated replay tail acknowledgement loss')}
     return result
    }
    return target[key]
   }})
   f.env.DB=new Proxy(raw,{get(target,key){
    if(key==='prepare')return text=>wrap(target.prepare(text))
    if(key==='batch')return async statements=>{
     const result=await target.batch(statements)
     for(const statement of statements){const kind=group(statement);if(kind?.startsWith('cache-write:')&&!injected.has(kind)){injected.add(kind);throw new Error('D1_ERROR: simulated replay version acknowledgement loss')}}
     return result
    }
    return target[key]
   }})
   const before=state(f)
   if(extraReads===0)f.loseNextCommitAcknowledgement()
   const result=await f.call('/action-history/'+cancelled.json.actionHistoryId+'/undo',{expected_generation:0})
   console.log(JSON.stringify({replayTailTier:tier,extraReads,status:result.status,tailClasses:[...injected]}))
   if(result.status===400){assert.equal(result.json.code,'supplier_return_replay_over_plan_budget');assert.deepEqual(state(f),before);assert.equal(injected.size,0)}
   else {assert.equal(result.status,200);assert.equal(f.state().physical,.4);assert.equal(f.state().tags[0].quantity_remaining,.1);assert.ok(injected.size>= (tier==='free'?10:8),'all independent cache/notification/history retry classes are counted')}
   if(extraReads===0)assert.equal(result.status,200,'common supplier replay and committed ACK remains usable within the plan')
  }finally{f.sql.close()}
 }
 console.log('supplier explicit immutable source apply/cancel/restore/Undo/Redo: PASS')
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
