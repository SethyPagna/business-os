const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const {load}=require('./test-product-merge-origin-plan-native.cjs')
const {executeStockTransaction}=load('lib/stockTransaction.ts'),{getDb}=load('lib/db.ts')
const {productMergeProtocolSchemaSql}=load('lib/productMergeProtocol.ts')
const {returnMergePhysicalProofSchemaSql}=load('lib/returnBulkAction.ts')
const {readProductMergeCaseSnapshot}=load('lib/productMergeSnapshot.ts')
const {planProductMergeForwardStock}=load('lib/productMergeForwardStock.ts')
const {sqliteD1Call}=require('./harness/sqlite_d1_bindings.cjs')
async function concurrentStock(f,statements){
 const db={batchOnce:async rows=>f.sql.transaction(()=>rows.map(row=>{
  const prepared=f.sql.prepare(row.sql)
  let result
  try{result=sqliteD1Call(prepared,prepared.reader?'all':'run',row.params??[])}catch(error){console.error('Concurrent stock failure:',String(error));throw error}
  return prepared.reader?{results:result,meta:{changes:0}}:{meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}}
 }))()}
 await executeStockTransaction(db,statements,'once')
}
async function merge(f,target,source,number){
 const db=getDb(f.env),snapshot=await readProductMergeCaseSnapshot(db,target,source,[])
 await executeStockTransaction(db,planProductMergeForwardStock(snapshot,{planId:number,transitionId:number+1,historyId:number,
  actorId:7,actorName:'Operator',requestId:'customer-merge-'+number,requestDigest:'customer-merge-'+number,
  origins:{operationId:'customer-merge-'+number,receiptIds:snapshot.duplicateBatchRows.map((row,index)=>({sourceReceiptId:row.id,targetReceiptId:number+100+index})),
   tagIds:snapshot.damagedStockRows.filter(row=>row.product_id===source).map((row,index)=>({sourceTagId:row.id,targetTagId:number+200+index}))}}).statements,'once')
}
async function fixture(make,tier,receipt,tagged,multiple=false){
 const f=await h.world(make,tier,'zero',sql=>{h.seed(tagged?.2:.3,receipt)(sql);sql.exec(`
  INSERT INTO products(id,name,is_active,stock_quantity)VALUES(2,'Keeper',1,0);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0);
  INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,updated_at)VALUES(10,'CUSTOMER-MERGED','customer','completed','refund',1,'original');
  INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,return_to_stock,branch_id,batch_id)
   VALUES(10,10,1,'Widget',.1,2,'${tagged?'damaged':'restock'}',1,1,${receipt?1:'NULL'});
  INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reference_id,user_id,batch_id)
   VALUES(1,'Widget',1,'${tagged?'damage_in':'return'}',.1,2,10,7,${receipt?1:'NULL'});
  ${tagged?`INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,'Widget',1,${receipt?1:'NULL'},10,.1,.1,'damaged','return',2);`:''}
 `);if(multiple)sql.exec(`UPDATE return_items SET quantity=.05 WHERE id=10;UPDATE inventory_movements SET quantity=.05 WHERE reference_id=10;
  INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,return_to_stock,branch_id,batch_id)
   SELECT 11,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,return_to_stock,branch_id,batch_id FROM return_items WHERE id=10;
  INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reference_id,user_id,batch_id)
   SELECT product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reference_id,user_id,batch_id FROM inventory_movements WHERE reference_id=10;
  ${tagged?`UPDATE damaged_stock_lots SET quantity=.05,quantity_remaining=.05 WHERE id=1;
   INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
    SELECT 2,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd FROM damaged_stock_lots WHERE id=1;`:''}`)})
 await executeStockTransaction(getDb(f.env),[{sql:'UPDATE return_items SET stock_condition=@condition WHERE return_id=10',params:{condition:tagged?'damaged':'ordinary'}}],'once')
 if(tagged)await executeStockTransaction(getDb(f.env),[{sql:'UPDATE damaged_stock_lots SET return_item_id=10 WHERE id=1'},{sql:'UPDATE products SET stock_quantity=.3 WHERE id=1'},{sql:'UPDATE branch_stock SET quantity=.3 WHERE product_id=1 AND branch_id=1'},{sql:'UPDATE branch_batch_stock SET quantity=@quantity WHERE batch_id=1 AND branch_id=1',params:{quantity:receipt?.3:0}}],'once')
 if(tagged && multiple)await executeStockTransaction(getDb(f.env),[{sql:'UPDATE damaged_stock_lots SET return_item_id=11 WHERE id=2'}],'once')
 f.sql.exec(productMergeProtocolSchemaSql());f.sql.exec(returnMergePhysicalProofSchemaSql());await merge(f,2,1,1000)
 return f
}
const body=(f,key,source='completed',target='cancelled')=>({client_request_id:key,field:'status',source,target,
 items:f.sql.prepare('SELECT id,status expected_status,return_type expected_method,updated_at expected_updated_at FROM returns WHERE id=10').all()})
const original=f=>['return_items','return_item_batch_allocations'].map(table=>f.sql.prepare('SELECT * FROM '+table+' ORDER BY id').all())
const state=f=>Object.fromEntries(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
 .map(({name})=>[name,f.sql.prepare('SELECT * FROM "'+name+'"').all()]))
async function changedTarget(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const tagged of [false,true]){
  const f=await fixture(make,tier,receipt,tagged)
  try{
   const archive=original(f),r=await f.call('/returns/bulk',body(f,'customer-first-cancel'));assert.equal(r.status,200)
   await executeStockTransaction(getDb(f.env),[{sql:"INSERT INTO products(id,name,is_active,stock_quantity)VALUES(3,'Later keeper',1,0)"},
    {sql:'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(3,1,0)'}],'once')
   await merge(f,3,2,2000)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=3').get().stock_quantity,.3)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=3').get().stock_quantity,.2)
   const proofs=f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' ORDER BY id").all().map(row=>JSON.parse(row.payload_json))
   assert.deepEqual(proofs.map(proof=>[proof.generation,proof.sources[0].effect.productId]),[[0,2],[1,3],[2,3]])
   assert.deepEqual(original(f),archive)
  }finally{f.sql.close()}
 }
}
async function sameTarget(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const tagged of [false,true]){
  const f=await fixture(make,tier,receipt,tagged,true)
  try{
   const archive=original(f),r=await f.call('/returns/bulk',body(f,'customer-same-target'));assert.equal(r.status,200,JSON.stringify(r))
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.2)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.3)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.2)
   assert.deepEqual(original(f),archive)
  }finally{f.sql.close()}
 }
}
async function faults(make){
 for(const [tier,receipt,tagged]of [['free',true,false],['paid',false,true]])for(const phase of ['apply','undo','redo'])for(const fault of ['ack','late','source','target','actor','head','generation']){
  if(phase==='apply' && fault==='generation')continue
  const f=await fixture(make,tier,receipt,tagged)
  try{
   let history
   if(phase==='apply'){
    const warm=await f.call('/returns/bulk',body(f,'customer-fault-warm'));assert.equal(warm.status,200)
    assert.equal((await f.call('/action-history/'+warm.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   }
   if(phase!=='apply'){const r=await f.call('/returns/bulk',body(f,'customer-fault-setup'));assert.equal(r.status,200);history=r.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const command=body(f,'customer-fault-action'),invoke=()=>phase==='apply'?f.call('/returns/bulk',command):f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   const before=state(f);let rival
   if(fault==='ack')f.loseNextCommitAcknowledgement()
   else if(fault==='late')f.failWhenSqlMatches(/INSERT INTO audit_logs/)
   else{
    let statements
    if(fault==='head'){
     await executeStockTransaction(getDb(f.env),[{sql:"INSERT INTO products(id,name,is_active,stock_quantity)VALUES(3,'Rival keeper',1,0)"},
      {sql:'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(3,1,0)'}],'once')
     const snapshot=await readProductMergeCaseSnapshot(getDb(f.env),3,2,[])
     statements=planProductMergeForwardStock(snapshot,{planId:2000,transitionId:2001,historyId:2000,actorId:7,actorName:'Operator',requestId:'rival-customer-merge',requestDigest:'rival-customer-merge',
      origins:{operationId:'rival-customer-merge',receiptIds:snapshot.duplicateBatchRows.map((row,index)=>({sourceReceiptId:row.id,targetReceiptId:2100+index})),
       tagIds:snapshot.damagedStockRows.filter(row=>row.product_id===2).map((row,index)=>({sourceTagId:row.id,targetTagId:2200+index}))}}).statements
    }else statements=[{sql:{source:'UPDATE return_items SET cost_price_usd=9 WHERE id=10',
    target:"UPDATE products SET name='Changed physical target' WHERE id=2",actor:'UPDATE users SET is_active=0 WHERE id=7',
    generation:'UPDATE return_bulk_operations SET generation=99 WHERE history_id='+history}[fault]}]
    f.beforeCommit(async()=>{await concurrentStock(f,statements);rival=state(f)})
   }
   const r=await invoke()
   if(fault==='ack'){
    assert.equal(r.status,200,JSON.stringify({tier,phase,fault,r}));const committed=state(f);assert.equal((await invoke()).status,200)
    for(const table of ['inventory_movements','returns','return_items','return_bulk_operations','undo_snapshots','action_history','audit_logs'])assert.deepEqual(state(f)[table],committed[table],table)
   }else if(fault==='late'){
    assert.equal(r.status,503,JSON.stringify({tier,phase,fault,r}));assert.deepEqual(state(f),before);assert.equal((await invoke()).status,200)
   }else{assert.equal(r.status,409,JSON.stringify({tier,phase,fault,r}));assert.deepEqual(state(f),rival)}
  }finally{f.sql.close()}
 }
}
async function refusals(make){
 for(const [tier,receipt,tagged]of [['free',true,false],['paid',false,true]])for(const fault of ['schema','archive','condition']){
  const f=await fixture(make,tier,receipt,tagged)
  try{
   let invoke
   if(fault==='schema'){
    f.sql.exec('DROP TRIGGER return_merge_physical_insert');invoke=()=>f.call('/returns/bulk',body(f,'customer-missing-schema'))
   }else{
    const r=await f.call('/returns/bulk',body(f,'customer-corruption-setup'));assert.equal(r.status,200)
    if(fault==='archive')await executeStockTransaction(getDb(f.env),[{sql:"UPDATE undo_snapshots SET payload_json=json_set(payload_json,'$.members[0].stock[0].costUsd',9) WHERE id=(SELECT snapshot_id FROM return_bulk_operations WHERE history_id=@history)",params:{history:r.json.actionHistoryId}}],'once')
    else await executeStockTransaction(getDb(f.env),[{sql:"UPDATE return_items SET stock_condition='expired' WHERE id=10"}],'once')
    invoke=()=>f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})
   }
   const before=state(f),r=await invoke();assert.equal(r.status,409,JSON.stringify({tier,fault,r}));assert.deepEqual(state(f),before)
   if(fault==='schema')assert.equal(r.json.code,'return_merge_proof_schema_required')
  }finally{f.sql.close()}
 }
}
async function main(){
 const make=await h.bundle.exports.bundleWorker()
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const tagged of [false,true]){
  const f=await fixture(make,tier,receipt,tagged)
  try{
   const archive=original(f),r=await f.call('/returns/bulk',body(f,'customer-merge-cancel'))
   assert.equal(r.status,200,JSON.stringify({tier,receipt,tagged,r}))
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.2)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/undo',{expected_generation:0})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.3)
   assert.equal((await f.call('/action-history/'+r.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal((await f.call('/returns/bulk',body(f,'customer-merge-restore','cancelled','completed'))).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=2').get().stock_quantity,.3)
   assert.deepEqual(original(f),archive)
   const proof=f.sql.prepare("SELECT id FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' LIMIT 1").get()
   const before=state(f)
   await assert.rejects(executeStockTransaction(getDb(f.env),[{sql:"UPDATE undo_snapshots SET payload_json='{}' WHERE id=@id",params:{id:proof.id}}],'once'),/return_merge_physical_proof_/)
   assert.deepEqual(state(f),before)
  }finally{f.sql.close()}
 }
 await sameTarget(make);await changedTarget(make);await faults(make);await refusals(make)
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={fixture,merge,body,original}
