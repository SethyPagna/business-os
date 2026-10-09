const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
async function fixture(make,tier,receipt,redirect=1){
 const worker=()=>{const w=make(),fetch=w.default.fetch;w.default.fetch=(request,...args)=>{if(redirect!==null)request.headers.set('x-branch-redirect',String(redirect));return fetch(request,...args)};return w}
 const f=await h.world(worker,tier,'zero',sql=>{h.seed(0,receipt)(sql);sql.exec(`
  INSERT INTO branches(id,name,is_active,successor_branch_id)VALUES(2,'Old Shop',0,1);
  INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0);
  INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,branch_name,updated_at)VALUES(10,'RET-MOVED','customer','completed','refund',2,'Shop','original');
  INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,branch_id,batch_id)VALUES(10,10,1,'Widget',.1,2,'damaged',2,${receipt?1:'NULL'});
  INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,'Widget',1,${receipt?1:'NULL'},10,.1,.1,'damaged','return',2);
 `)})
 await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[
  {sql:"UPDATE return_items SET stock_condition='damaged' WHERE id=10"},
  {sql:'UPDATE damaged_stock_lots SET return_item_id=10 WHERE id=1'},
  {sql:'UPDATE branch_stock SET quantity=.3 WHERE product_id=1 AND branch_id=1'},
  {sql:'UPDATE products SET stock_quantity=.3 WHERE id=1'},
  {sql:'UPDATE branch_batch_stock SET quantity=@quantity WHERE batch_id=1 AND branch_id=1',params:{quantity:receipt?.3:0}}
 ],'once')
 return f
}
function request(f,key,source='completed',target='cancelled'){
 return {client_request_id:key,field:'status',source,target,items:f.sql.prepare('SELECT id,status expected_status,return_type expected_method,updated_at expected_updated_at FROM returns WHERE id=10').all()}
}
function state(f){return {...f.state(),returns:f.sql.prepare('SELECT * FROM returns ORDER BY id').all(),items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),tags:f.sql.prepare('SELECT * FROM damaged_stock_lots ORDER BY id').all(),operations:f.sql.prepare('SELECT * FROM return_bulk_operations ORDER BY id').all(),members:f.sql.prepare('SELECT * FROM return_bulk_members ORDER BY return_id').all(),snapshots:f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all(),audit:f.sql.prepare('SELECT * FROM audit_logs ORDER BY id').all()}}
async function rivals(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const phase of ['apply','undo','redo'])for(const kind of ['original-active','effect-successor','condition','item-member','item-branch','item-cost','lot-owner']){
  const f=await fixture(make,tier,receipt)
  try{
   let history
   if(phase!=='apply'){const r=await f.call('/returns/bulk',request(f,'rival-setup'));assert.equal(r.status,200);history=r.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const before=state(f)
   const sql={
    'original-active':'UPDATE branches SET is_active=1,successor_branch_id=NULL WHERE id=2',
    'effect-successor':'UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1',
    condition:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1",
    'item-member':'DELETE FROM return_items WHERE id=10',
    'item-branch':'UPDATE return_items SET branch_id=1 WHERE id=10',
    'item-cost':'UPDATE return_items SET cost_price_usd=99 WHERE id=10',
    'lot-owner':'UPDATE damaged_stock_lots SET return_item_id=NULL WHERE id=1'
   }[kind]
   f.competeBeforeCommit([{sql}])
   const r=phase==='apply'?await f.call('/returns/bulk',request(f,'rival-action')):await f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   assert.equal(r.status,409,JSON.stringify({phase,kind,r}))
   const after=state(f)
   assert.equal(after.physical,before.physical);assert.equal(after.cache,before.cache)
   assert.deepEqual(after.movements,before.movements);assert.deepEqual(after.history,before.history);assert.deepEqual(after.operations,before.operations);assert.deepEqual(after.snapshots,before.snapshots);assert.deepEqual(after.audit,before.audit)
   assert.equal(after.tags[0].quantity_remaining,before.tags[0].quantity_remaining)
   if(kind==='item-member')assert.equal(after.items.length,0)
   if(kind==='item-cost')assert.equal(after.items[0].cost_price_usd,99)
  }finally{f.sql.close()}
 }
}
async function failures(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const phase of ['apply','undo','redo'])for(const mode of ['late','ack']){
  const f=await fixture(make,tier,receipt)
  try{
   let history
   if(phase!=='apply'){const r=await f.call('/returns/bulk',request(f,'fault-setup'));assert.equal(r.status,200);history=r.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const before=state(f),body=request(f,'fault-action')
   const invoke=()=>phase==='apply'?f.call('/returns/bulk',body):f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   if(mode==='late')f.failWhenSqlMatches(/INSERT INTO audit_logs/)
   else f.loseNextCommitAcknowledgement()
   const result=await invoke()
   if(mode==='late'){assert.equal(result.status,503,JSON.stringify({phase,mode,result}));assert.deepEqual(state(f),before);assert.equal((await invoke()).status,200)}
   else{assert.equal(result.status,200,JSON.stringify({phase,mode,result}));const committed=state(f);assert.equal((await invoke()).status,200);assert.deepEqual(state(f),committed)}
  }finally{f.sql.close()}
 }
}
async function authority(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true]){
  for(const target of [null,999]){
   const f=await fixture(make,tier,receipt,target)
   try{const before=state(f),r=await f.call('/returns/bulk',request(f,'bad-target'));assert.equal(r.status,409);assert.equal(r.json.code,target===null?'branch_redirect_required':'branch_redirect_target_invalid');assert.deepEqual(state(f),before)}finally{f.sql.close()}
  }
  for(const change of ['members','stock','cost','sign','branch','changed']){
   const f=await fixture(make,tier,receipt)
   try{
    const r=await f.call('/returns/bulk',request(f,'archive-setup'));assert.equal(r.status,200)
    const saved=f.sql.prepare('SELECT snapshot_id FROM return_bulk_operations WHERE id=?').get(r.json.operationId).snapshot_id
    const original=f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(saved).payload_json,value=JSON.parse(original)
    if(change==='members')value.members=[]
    if(change==='stock')value.members[0].stock=[]
    if(change==='cost')value.members[0].stock[0].costUsd=99
    if(change==='sign')value.members[0].stock[0].quantity=.1
    if(change==='branch')value.members[0].stock[0].branchId=2
    if(change==='changed')value.members[0].changed=false
    f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(value),saved)
    const before=state(f)
    assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})).status,409)
    assert.deepEqual(state(f),before,'archive refusal never rewrites historical source')
    f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(original,saved)
    assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   }finally{f.sql.close()}
  }
  for(const change of ['delete','zero','condition']){
   const f=await fixture(make,tier,receipt)
   try{
    await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:change==='delete'?'DELETE FROM return_items WHERE id=10':change==='zero'?'UPDATE return_items SET quantity=0 WHERE id=10':"UPDATE return_items SET stock_condition='opened' WHERE id=10"}],'once')
    const before=state(f),r=await f.call('/returns/bulk',request(f,'prechanged-source'));assert.equal(r.status,409);assert.deepEqual(state(f),before)
   }finally{f.sql.close()}
  }
 }
}
async function vectors(make,{tiers=['free','paid'],receipts=[false,true],shapes=['tagged','ordinary','mixed','two-receipts'],phases=['undo','redo'],changes=['unchanged','append','offsets','remove','replace','cost','swap','old-direction','old-fingerprint','source-race']}={}){
 for(const tier of tiers)for(const receipt of receipts)for(const shape of shapes){
  if(shape==='two-receipts' && !receipt)continue
  for(const phase of phases)for(const change of changes){
   const f=await fixture(make,tier,receipt)
   try{
    const setup=[]
    if(shape==='ordinary' || shape==='two-receipts')setup.push({sql:'DELETE FROM damaged_stock_lots WHERE id=1'}, {sql:"UPDATE return_items SET stock_action='restock',return_to_stock=1,stock_condition='ordinary' WHERE id=10"})
    if(shape==='mixed' || shape==='two-receipts'){
     if(shape==='two-receipts')setup.push({sql:"INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(2,1,'vector-second','2026-09-02',3,1)"}, {sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,1,.2)'},{sql:'UPDATE branch_batch_stock SET quantity=.1 WHERE batch_id=1 AND branch_id=1'})
     setup.push({sql:`INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,return_to_stock,branch_id,batch_id,stock_condition)VALUES(11,10,1,'Widget',.1,3,'restock',1,2,${shape==='two-receipts'?2:receipt?1:'NULL'},'ordinary')`})
    }
    if(setup.length)await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),setup,'once')
    const initial=state(f),apply=await f.call('/returns/bulk',request(f,'vector-'+shape));assert.equal(apply.status,200,JSON.stringify(apply))
    const op=f.sql.prepare('SELECT * FROM return_bulk_operations WHERE id=?').get(apply.json.operationId),saved=f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(op.snapshot_id).payload_json,oldFingerprint=f.sql.prepare('SELECT stock_fingerprint FROM return_bulk_members WHERE operation_id=?').get(op.id).stock_fingerprint
    if(phase==='redo')assert.equal((await f.call('/action-history/'+apply.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
    const value=JSON.parse(saved),stock=value.members[0].stock
    if(change==='append')stock.push({...stock[0],damagedLotId:null})
    if(change==='offsets')stock.push({...stock[0],damagedLotId:null},{...stock[0],damagedLotId:null,quantity:-stock[0].quantity})
    if(change==='remove')stock.pop()
    if(change==='replace')stock[0]={...stock[0],damagedLotId:stock[0].damagedLotId===null?1:null,quantity:stock[0].quantity*2}
    if(change==='cost')stock[0].costUsd=99
    if(change==='swap'){if(stock.length>1)[stock[0],stock[1]]=[stock[1],stock[0]];else stock[0].batchId=receipt?2:1}
    if(change==='old-direction')for(const delta of stock)delta.quantity=-delta.quantity
    if(!['unchanged','source-race','old-fingerprint'].includes(change))f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(value),op.snapshot_id)
    if(change==='old-fingerprint' && phase==='redo')f.sql.prepare('UPDATE return_bulk_members SET stock_fingerprint=? WHERE operation_id=?').run(oldFingerprint,op.id)
    if(change==='source-race')f.competeBeforeCommit([{sql:'UPDATE return_items SET cost_price_usd=99 WHERE id=10'}])
    const before=state(f),r=await f.call('/action-history/'+apply.json.actionHistoryId+'/'+phase,{expected_generation:phase==='undo'?0:1})
    if(change==='unchanged' || change==='old-fingerprint' && phase==='undo'){
     assert.equal(r.status,200,JSON.stringify({shape,change,phase,r}))
     assert.equal(f.state().physical,phase==='undo'?initial.physical:shape==='mixed'||shape==='two-receipts'?.1:.2)
     if(phase==='undo')assert.deepEqual(state(f).items,initial.items)
    }else{
     assert.equal(r.status,409,JSON.stringify({shape,change,phase,r}))
     if(change!=='source-race')assert.deepEqual(state(f),before)
     else{const after=state(f);assert.equal(after.physical,before.physical);assert.deepEqual(after.movements,before.movements);assert.deepEqual(after.history,before.history);assert.deepEqual(after.operations,before.operations);assert.equal(after.items[0].cost_price_usd,99)}
    }
   }finally{f.sql.close()}
  }
 }
}
async function precision(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const change of ['unchanged','archive-rounded-cost','late-cost','late-quantity']){
  const f=await fixture(make,tier,receipt)
  try{
   await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:'UPDATE return_items SET cost_price_usd=1.0000000000000002 WHERE id=10'}],'once')
   const apply=await f.call('/returns/bulk',request(f,'precision-'+change));assert.equal(apply.status,200)
   const op=f.sql.prepare('SELECT * FROM return_bulk_operations WHERE id=?').get(apply.json.operationId),saved=f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(op.snapshot_id).payload_json
   if(change==='archive-rounded-cost'){const value=JSON.parse(saved);assert.equal(value.members[0].stock[0].costUsd,1.0000000000000002);value.members[0].stock[0].costUsd=1;f.sql.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(JSON.stringify(value),op.snapshot_id)}
   if(change==='late-cost')f.competeBeforeCommit([{sql:'UPDATE inventory_movements SET unit_cost_usd=1.0000000000000004 WHERE movement_type=\'damage_reversal\''}])
   if(change==='late-quantity')f.competeBeforeCommit([{sql:'UPDATE inventory_movements SET quantity=-.10000000000000002 WHERE movement_type=\'damage_reversal\''}])
   const before=state(f),r=await f.call('/action-history/'+apply.json.actionHistoryId+'/undo',{expected_generation:0})
   assert.equal(r.status,change==='unchanged'?200:409,JSON.stringify({change,r}))
   if(change==='unchanged')assert.equal(f.state().physical,.3)
   else{const after=state(f);assert.equal(after.physical,before.physical);assert.deepEqual(after.history,before.history);assert.deepEqual(after.operations,before.operations);assert.deepEqual(after.snapshots,before.snapshots);assert.deepEqual(after.audit,before.audit)}
   if(change==='late-cost')assert.equal(f.sql.prepare("SELECT json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,quantity)) fp FROM (SELECT * FROM inventory_movements WHERE reference_id=10 AND movement_type IN ('return','return_reversal','damage_in','damage_reversal','supplier_return','supplier_return_reversal') ORDER BY id)").get().fp,f.sql.prepare('SELECT stock_fingerprint FROM return_bulk_members WHERE operation_id=?').get(op.id).stock_fingerprint,'legacy fingerprint omits costs: raw movement binding alone detects the adjacent REAL cost rival')
  }finally{f.sql.close()}
 }
}
function databaseState(f){return f.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name,sql})=>({name,schema:sql,rows:f.sql.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort().map(row=>JSON.parse(row))}))}
async function operationAuthority(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const shape of ['ordinary','tagged'])for(const mutation of ['none','request','receipt']){
  const f=await fixture(make,tier,receipt)
  try{
   const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
   if(shape==='ordinary')await stock.executeStockTransaction(db,[{sql:'DELETE FROM damaged_stock_lots WHERE id=1'},{sql:"UPDATE return_items SET stock_action='restock',return_to_stock=1,stock_condition='ordinary' WHERE id=10"}],'once')
   const apply=await f.call('/returns/bulk',request(f,'authority-'+shape+'-'+mutation));assert.equal(apply.status,200)
   const original=f.sql.prepare('SELECT * FROM return_bulk_operations WHERE id=?').get(apply.json.operationId)
   let rivalState
   if(mutation!=='none')f.beforeCommit(async()=>{
    await stock.executeStockTransaction(db,[{sql:mutation==='request'?"UPDATE return_bulk_operations SET request_json=json_set(request_json,'$.target','completed') WHERE id=@id":"UPDATE return_bulk_operations SET receipt_json=json_set(receipt_json,'$.changedIds',json('[]')) WHERE id=@id",params:{id:apply.json.operationId}}],'once')
    rivalState=databaseState(f)
   })
   const result=await f.call('/action-history/'+apply.json.actionHistoryId+'/undo',{expected_generation:0})
   if(mutation==='none'){assert.equal(result.status,200);assert.equal(f.state().physical,.3)}
   else{
    assert.ok(rivalState,'the authority rival really committed before the guarded batch');assert.equal(result.status,409,JSON.stringify({tier,receipt,shape,mutation,result}))
    assert.deepEqual(databaseState(f),rivalState,'every database table and history row preserves the intended rival only')
    await stock.executeStockTransaction(db,[{sql:'UPDATE return_bulk_operations SET request_json=@request,receipt_json=@receipt WHERE id=@id',params:{request:original.request_json,receipt:original.receipt_json,id:original.id}}],'once')
    assert.equal((await f.call('/action-history/'+apply.json.actionHistoryId+'/undo',{expected_generation:0})).status,200,'the unchanged original identity and generation remain retryable')
    assert.equal(f.state().physical,.3)
   }
  }finally{f.sql.close()}
 }
}
async function main(){
 const make=await h.bundle.exports.bundleWorker()
 for(const tier of ['free','paid'])for(const receipt of [false,true]){
  const f=await fixture(make,tier,receipt)
  try{
   const original=state(f),body=request(f,'redirect-tag-cancel')
   const result=await f.call('/returns/bulk',body)
   assert.equal(result.status,200,JSON.stringify(result))
   assert.equal(f.state().physical,.2);assert.equal(f.state().cache,.2);assert.equal(f.state().tags[0].quantity_remaining,0)
   assert.deepEqual(state(f).items,original.items,'immutable original source branch and condition')
   const history=result.json.actionHistoryId
   assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.state().physical,.3);assert.equal(f.state().tags[0].quantity_remaining,.1)
   assert.equal((await f.call('/action-history/'+history+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.state().physical,.2);assert.equal(f.state().tags[0].quantity_remaining,0)
   assert.equal((await f.call('/returns/bulk',request(f,'redirect-tag-restore','cancelled','completed'))).status,200)
   assert.equal(f.state().physical,.3);assert.equal(f.state().tags[0].quantity_remaining,.1)
   assert.deepEqual(state(f).items,original.items)
  }finally{f.sql.close()}
 }
 await rivals(make)
 await failures(make)
 await authority(make)
 await vectors(make)
 await precision(make)
 await operationAuthority(make)
}
module.exports={fixture,request,state,vectors,precision,operationAuthority}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
