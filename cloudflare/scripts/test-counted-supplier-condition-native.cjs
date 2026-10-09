const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const input=(key,quantity=.1,condition='damaged',lot=1)=>({branch_id:1,reason:'Explicit supplier source',settlement:'refund',supplier_name:'Fixture supplier',exchange_rate:4000,client_request_id:key,items:[{product_id:1,branch_id:1,quantity,cost_price_usd:2,stock_condition:condition,...(lot?{damaged_lot_id:lot}:{})}]})
const state=f=>({...f.state(),returns:f.sql.prepare('SELECT * FROM returns ORDER BY id').all(),items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),receipts:f.sql.prepare('SELECT * FROM return_create_receipts ORDER BY id').all(),audit:f.sql.prepare('SELECT * FROM audit_logs ORDER BY id').all()})
const status=(f,id,source,target,key)=>{const r=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(id);return f.call('/returns/bulk',{client_request_id:key,field:'status',source,target,items:[{id,expected_status:r.status,expected_method:r.supplier_settlement,expected_updated_at:r.updated_at}]})}
async function completeMembership(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const mode of ['missing-all','missing-ordinary','missing-first','reassigned','zero','negative','product','branch','condition','extra','mixed','shared-tag','wire-numbers']){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,receipt)(sql);sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,${receipt?1:'NULL'},.25,.25,'damaged','remove',2)`)});
  try{
   const body=input('member-'+mode,.125)
   body.items.push({...body.items[0],...(mode==='shared-tag'?{}:{stock_condition:'ordinary',damaged_lot_id:undefined})})
   const positive=['mixed','shared-tag','wire-numbers'].includes(mode)
   if(mode==='wire-numbers')body.items=body.items.map(item=>({...item,product_id:String(item.product_id),quantity:String(item.quantity),cost_price_usd:String(item.cost_price_usd),cost_price_khr:'0'}))
   const created=await f.call('/returns/supplier',body);assert.equal(created.status,200,JSON.stringify(created))
   const id=created.json.id,original=state(f),manifest=original.receipts.find(row=>row.return_id===id).request_json
   let otherId
   if(mode==='reassigned'){const other=await f.call('/returns/supplier',input('other-membership-return',.125,'ordinary',null));assert.equal(other.status,200);otherId=other.json.id}
   if(!positive){
    f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','counted-tagged-subset-v1')")
    try{
     const first=f.sql.prepare('SELECT MIN(id) id FROM return_items WHERE return_id=?').get(id).id
     if(mode==='missing-all')f.sql.prepare('DELETE FROM return_items WHERE return_id=?').run(id)
     else if(mode==='missing-ordinary')f.sql.prepare('DELETE FROM return_items WHERE id=(SELECT MAX(id) FROM return_items WHERE return_id=?)').run(id)
     else if(mode==='missing-first')f.sql.prepare('DELETE FROM return_items WHERE id=?').run(first)
     else if(mode==='reassigned')f.sql.prepare('UPDATE return_items SET return_id=? WHERE id=?').run(otherId,first)
     else if(mode==='extra')f.sql.prepare("INSERT INTO return_items(return_id,product_id,branch_id,quantity,cost_price_usd,cost_price_khr,stock_condition,stock_action)VALUES(?,1,1,.125,2,0,'ordinary','none')").run(id)
     else f.sql.prepare(`UPDATE return_items SET ${ {zero:'quantity=0',negative:'quantity=-.125',product:'product_id=2',branch:'branch_id=2',condition:"stock_condition='opened'"}[mode]} WHERE id=?`).run(first)
    }finally{f.sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")}
   }
   const before=state(f),cancelled=await status(f,id,'completed','cancelled','cancel-member-'+mode)
   console.log(JSON.stringify({membershipTier:tier,receipt,mode,status:cancelled.status}))
   if(!positive){assert.equal(cancelled.status,409);assert.deepEqual(state(f),before)}
   else{
    assert.equal(cancelled.status,200);assert.equal(f.state().physical,.75);assert.equal(f.state().cache,.75);assert.equal(f.state().tags[0].quantity_remaining,.25)
    assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
    assert.equal(f.state().physical,original.physical);assert.equal(f.state().tags[0].quantity_remaining,original.tags[0].quantity_remaining)
    assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
    assert.equal(f.state().physical,.75);assert.equal(f.state().tags[0].quantity_remaining,.25)
   }
   assert.equal(f.sql.prepare('SELECT request_json FROM return_create_receipts WHERE return_id=?').get(id).request_json,manifest)
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const phase of ['cancel','undo','redo']){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,true)(sql);sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.25,.25,'damaged','remove',2)")})
  try{
   const body=input('member-race',.125);body.items.push({...body.items[0],stock_condition:'ordinary',damaged_lot_id:undefined})
   const id=(await f.call('/returns/supplier',body)).json.id;let history
   if(phase!=='cancel'){const result=await status(f,id,'completed','cancelled','race-setup');assert.equal(result.status,200);history=result.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const before=state(f)
   f.competeBeforeCommit([{sql:'DELETE FROM return_items WHERE id=(SELECT MAX(id) FROM return_items WHERE return_id=@id)',params:{id}}])
   const result=phase==='cancel'?await status(f,id,'completed','cancelled','member-race-status'):await f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   assert.equal(result.status,409);assert.equal(f.state().physical,before.physical);assert.equal(f.state().tags[0].quantity_remaining,before.tags[0].quantity_remaining)
   assert.deepEqual(state(f).returns,before.returns);assert.deepEqual(state(f).movements,before.movements);assert.deepEqual(state(f).audit,before.audit);assert.deepEqual(state(f).receipts,before.receipts)
   assert.equal(state(f).items.length,before.items.length-1,'intentional rival member deletion persists')
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid']){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,true)(sql);sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.25,.25,'damaged','remove',2)")})
  try{
   const body=input('member-interread',.125);body.items.push({...body.items[0],stock_condition:'ordinary',damaged_lot_id:undefined})
   const id=(await f.call('/returns/supplier',body)).json.id,before=state(f),raw=f.env.DB;let changed=false,restored=false
   const write=quantity=>{f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','counted-tagged-subset-v1')");try{f.sql.prepare('UPDATE return_items SET quantity=? WHERE id=(SELECT MIN(id) FROM return_items WHERE return_id=?)').run(quantity,id)}finally{f.sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")}}
   const wrap=statement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return(...args)=>wrap(target.bind(...args))
    if(key==='all')return async(...args)=>{const result=await target.all(...args),text=target.text||'';
     if(text.includes('cr.request_json AS supplier_manifest')&&!changed){changed=true;write(0)}
     else if(text.includes('FROM selected_items ri JOIN returns')&&changed&&!restored){restored=true;write(.125)}
     return result
    }
    return target[key]
   }})
   f.env.DB=new Proxy(raw,{get(target,key){return key==='prepare'?text=>wrap(target.prepare(text)):target[key]}})
   assert.equal((await status(f,id,'completed','cancelled','member-interread-cancel')).status,409)
   assert.equal(changed,true);assert.equal(restored,true);assert.deepEqual(state(f),before,'changed-then-restored item operands cannot commit an incomplete plan')
  }finally{f.sql.close()}
 }
 console.log('complete immutable supplier item/source coverage and member races: PASS')
}
async function archivedSupplierProjection(make){
 const mutations={
  'empty-stock':member=>{member.stock=[]},'missing-stock':member=>{member.stock.pop()},'duplicate-stock':member=>{member.stock.push({...member.stock[0]})},
  'wrong-usd':member=>{member.stock[0].costUsd=999},'wrong-khr':member=>{member.stock[0].costKhr=999},'wrong-quantity':member=>{member.stock[0].quantity=.25},
  'wrong-branch':member=>{member.stock[0].branchId=2},'wrong-batch':member=>{member.stock[0].batchId=member.stock[0].batchId===null?1:null},
  'wrong-product':member=>{member.stock[0].productId=2},'wrong-lot':member=>{member.stock[0].damagedLotId=2},
  'no-manifest':member=>{delete member.supplierManifest},'unchanged':member=>{member.changed=false},'wrong-scope':member=>{member.scope='customer'},
  'reversed-direction':member=>{[member.before.status,member.after.status]=[member.after.status,member.before.status];member.stock.forEach(delta=>delta.quantity=-delta.quantity)}
 }
 const replayState=f=>({...state(f),operations:f.sql.prepare('SELECT * FROM return_bulk_operations ORDER BY id').all(),
  history:f.sql.prepare('SELECT id,status,undo_payload,redo_payload,label,created_by_id FROM action_history ORDER BY id').all(),snapshots:f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all()})
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const direction of ['undo','redo']){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,receipt)(sql);sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,${receipt?1:'NULL'},.25,.25,'damaged','remove',2)`)});
  try{
   const body=input('archived-projection',.125);body.items.push({...body.items[0],stock_condition:'ordinary',damaged_lot_id:undefined,cost_price_usd:3})
   const id=(await f.call('/returns/supplier',body)).json.id,cancelled=await status(f,id,'completed','cancelled','archive-cancel');assert.equal(cancelled.status,200)
   const history=cancelled.json.actionHistoryId,generation=direction==='undo'?0:1
   if(direction==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const saved=f.sql.prepare('SELECT s.* FROM undo_snapshots s JOIN return_bulk_operations o ON o.snapshot_id=s.id WHERE o.history_id=?').get(history)
   for(const mode of [...Object.keys(mutations),'no-member']){
    const snapshot=JSON.parse(saved.payload_json)
    if(mode==='no-member')snapshot.members=[];else mutations[mode](snapshot.members[0])
    f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(snapshot),saved.id)
    const before=replayState(f),result=await f.call('/action-history/'+history+'/'+direction,{expected_generation:generation})
    console.log(JSON.stringify({archiveTier:tier,receipt,direction,mode,status:result.status}))
    assert.equal(result.status,409,'corrupt archived projection cannot compensate or advance history');assert.deepEqual(replayState(f),before)
   }
   f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(saved.payload_json,saved.id)
   assert.equal((await f.call('/action-history/'+history+'/'+direction,{expected_generation:generation})).status,200)
   assert.equal(f.state().physical,direction==='undo'?.5:.75);assert.equal(f.state().tags[0].quantity_remaining,direction==='undo'?.125:.25)
   assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(saved.id).payload_json,saved.payload_json,'valid compensation does not rewrite original snapshot')
   assert.deepEqual(f.sql.prepare('SELECT unit_cost_usd FROM inventory_movements WHERE reference_id=? ORDER BY id DESC LIMIT 2').all(id).map(row=>row.unit_cost_usd),[3,2])
  }finally{f.sql.close()}
 }
 console.log('archived supplier source projection/coverage/cost UndoRedo integrity: PASS')
}
async function committedSupplierWitness(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true]){
  const f=await h.world(make,tier,'zero',sql=>{h.seed(.5,receipt)(sql);sql.exec("INSERT INTO branches(id,name,is_active)VALUES(2,'Successor',1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0)")})
  try{
   const created=await f.call('/returns/supplier',input('redirect-source',.125,'ordinary',null));assert.equal(created.status,200)
   const id=created.json.id,manifest=f.sql.prepare('SELECT request_json FROM return_create_receipts WHERE return_id=?').get(id).request_json
   const statements=[{sql:'UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=1'},
    {sql:'UPDATE branch_stock SET quantity=.375 WHERE product_id=1 AND branch_id=2'},
    {sql:'UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1'}]
   if(receipt)statements.push({sql:"INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(2,1,'fold-survivor','2026-09-01',2,1)"},
    {sql:'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1'},
    {sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,2,.375)'},
    {sql:"INSERT INTO audit_logs(action,details)VALUES('branch_cutover_lot_fold','{\"branchId\":2,\"survivorBatchId\":2,\"foldedBatchIds\":[1]}')"})
   await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),statements,'once')
   let queries=0;const raw=f.env.DB,wrap=statement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run'].includes(key))return(...args)=>{queries++;return target[key](...args)};return target[key]
   }})
   f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return text=>wrap(target.prepare(text));if(key==='batch')return rows=>{queries+=rows.length;return target.batch(rows)};return target[key]}})
   const header=f.sql.prepare('SELECT * FROM returns WHERE id=?').get(id)
   const redirect=async()=>{
    queries=0;const tasks=[]
    const response=await make().default.fetch(new Request('https://admin.business.test/api/returns/bulk',{method:'POST',headers:{cookie:'bos_session=counted-set-native','content-type':'application/json',origin:'https://admin.business.test','X-Branch-Redirect':'2'},
     body:JSON.stringify({client_request_id:'redirect-cancel',field:'status',source:'completed',target:'cancelled',items:[{id,expected_status:header.status,expected_method:header.supplier_settlement,expected_updated_at:header.updated_at}]})}),f.env,{waitUntil:promise=>tasks.push(Promise.resolve(promise)),passThroughOnException(){}})
    while(tasks.length)await Promise.all(tasks.splice(0))
    const json=await response.json();console.log(JSON.stringify({redirectTier:f.env.PLAN_TIER,receipt,status:response.status,queries}));assert.ok(queries<=(f.env.PLAN_TIER==='free'?50:1000));return {status:response.status,json}
   }
   if(tier==='free'){
    const before=state(f),refused=await redirect();assert.equal(refused.status,400);assert.equal(refused.json.code,'customer_return_over_plan_budget');assert.deepEqual(state(f),before)
    f.env.PLAN_TIER='paid'
   }
   const accepted=await redirect();assert.equal(accepted.status,200,JSON.stringify(accepted));const cancelled=accepted.json
   f.env.PLAN_TIER=tier
   const snapshot=f.sql.prepare('SELECT s.payload_json FROM undo_snapshots s JOIN return_bulk_operations o ON o.snapshot_id=s.id WHERE o.history_id=?').get(cancelled.actionHistoryId).payload_json
   const delta=JSON.parse(snapshot).members[0].stock[0];assert.equal(delta.branchId,2);assert.equal(delta.batchId,receipt?2:null)
   assert.equal((await f.call('/action-history/'+cancelled.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity,.375)
   assert.equal((await f.call('/action-history/'+cancelled.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity,.5)
   assert.equal(f.state().physical,0);assert.equal(f.state().cache,.5)
   assert.equal(f.sql.prepare('SELECT request_json FROM return_create_receipts WHERE return_id=?').get(id).request_json,manifest)
   assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE payload_json=?').get(snapshot).payload_json,snapshot)
  }finally{f.sql.close()}
 }
 for(const tier of ['free','paid'])for(const direction of ['undo','redo']){
  const f=await h.world(make,tier,'zero',h.seed(.5,true))
  try{
   const id=(await f.call('/returns/supplier',input('witness-race',.125,'ordinary',null))).json.id,cancelled=await status(f,id,'completed','cancelled','witness-race-cancel');assert.equal(cancelled.status,200)
   if(direction==='redo')assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   const before=state(f),count=before.movements.length
   f.competeBeforeCommit([{sql:"INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,reference_id)VALUES(1,1,1,'supplier_return',0,@id)",params:{id}},
    {sql:"UPDATE return_bulk_members SET stock_fingerprint=(SELECT json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,quantity)) FROM (SELECT * FROM inventory_movements WHERE reference_id=@id AND movement_type IN('return','return_reversal','damage_in','damage_reversal','supplier_return','supplier_return_reversal') ORDER BY id)) WHERE return_id=@id",params:{id}}])
   const result=await f.call('/action-history/'+cancelled.json.actionHistoryId+'/'+direction,{expected_generation:direction==='undo'?0:1})
   assert.equal(result.status,409);assert.equal(f.state().physical,before.physical);assert.equal(f.state().cache,before.cache);assert.deepEqual(state(f).returns,before.returns);assert.deepEqual(state(f).audit,before.audit)
   assert.equal(f.state().movements.length,count+1,'only intentional rival witness append persists')
  }finally{f.sql.close()}
 }
 console.log('committed ordinary redirect/fold witness and late coherent fingerprint rivals: PASS')
}
async function main(){
 const make=await h.bundle.exports.bundleWorker()
 await committedSupplierWitness(make)
 await archivedSupplierProjection(make)
 await completeMembership(make)
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
module.exports={committedSupplierWitness}
