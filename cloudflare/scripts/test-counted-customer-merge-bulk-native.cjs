const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const {load}=require('./test-product-merge-origin-plan-native.cjs')
const {executeStockTransaction}=load('lib/stockTransaction.ts'),{getDb}=load('lib/db.ts')
const {productMergeProtocolSchemaSql}=load('lib/productMergeProtocol.ts')
const {returnMergePhysicalProofSchemaSql}=load('lib/returnBulkAction.ts')
const {readProductMergeCaseSnapshot}=load('lib/productMergeSnapshot.ts')
const {planProductMergeForwardStock}=load('lib/productMergeForwardStock.ts')
async function merge(f,target,source,number){
 const db=getDb(f.env),snapshot=await readProductMergeCaseSnapshot(db,target,source,[])
 await executeStockTransaction(db,planProductMergeForwardStock(snapshot,{planId:number,transitionId:number+1,historyId:number,
  actorId:7,actorName:'Operator',requestId:'customer-merge-'+number,requestDigest:'customer-merge-'+number,
  origins:{operationId:'customer-merge-'+number,receiptIds:snapshot.duplicateBatchRows.map((row,index)=>({sourceReceiptId:row.id,targetReceiptId:number+100+index})),
   tagIds:snapshot.damagedStockRows.filter(row=>row.product_id===source).map((row,index)=>({sourceTagId:row.id,targetTagId:number+200+index}))}}).statements,'once')
}
async function fixture(make,tier,receipt,tagged){
 const f=await h.world(make,tier,'zero',sql=>{h.seed(tagged?.2:.3,receipt)(sql);sql.exec(`
  INSERT INTO products(id,name,is_active,stock_quantity)VALUES(2,'Keeper',1,0);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0);
  INSERT INTO returns(id,return_number,return_scope,status,return_type,branch_id,updated_at)VALUES(10,'CUSTOMER-MERGED','customer','completed','refund',1,'original');
  INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,stock_action,return_to_stock,branch_id,batch_id)
   VALUES(10,10,1,'Widget',.1,2,'${tagged?'damaged':'restock'}',1,1,${receipt?1:'NULL'});
  INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reference_id,user_id,batch_id)
   VALUES(1,'Widget',1,'${tagged?'damage_in':'return'}',.1,2,10,7,${receipt?1:'NULL'});
  ${tagged?`INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,'Widget',1,${receipt?1:'NULL'},10,.1,.1,'damaged','return',2);`:''}
 `)})
 await executeStockTransaction(getDb(f.env),[{sql:'UPDATE return_items SET stock_condition=@condition WHERE id=10',params:{condition:tagged?'damaged':'ordinary'}}],'once')
 if(tagged)await executeStockTransaction(getDb(f.env),[{sql:'UPDATE damaged_stock_lots SET return_item_id=10 WHERE id=1'},{sql:'UPDATE products SET stock_quantity=.3 WHERE id=1'},{sql:'UPDATE branch_stock SET quantity=.3 WHERE product_id=1 AND branch_id=1'},{sql:'UPDATE branch_batch_stock SET quantity=@quantity WHERE batch_id=1 AND branch_id=1',params:{quantity:receipt?.3:0}}],'once')
 f.sql.exec(productMergeProtocolSchemaSql());f.sql.exec(returnMergePhysicalProofSchemaSql());await merge(f,2,1,1000)
 return f
}
const body=(f,key,source='completed',target='cancelled')=>({client_request_id:key,field:'status',source,target,
 items:f.sql.prepare('SELECT id,status expected_status,return_type expected_method,updated_at expected_updated_at FROM returns WHERE id=10').all()})
const original=f=>['return_items','return_item_batch_allocations'].map(table=>f.sql.prepare('SELECT * FROM '+table+' ORDER BY id').all())
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
  }finally{f.sql.close()}
 }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={fixture,merge,body,original}
