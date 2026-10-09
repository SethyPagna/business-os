const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')
const {state}=require('./test-counted-add-budget-native.cjs')
async function scenario(make,tier,shape='fraction'){
 const normal=shape==='integer',legacy=shape==='legacy',nullTag=shape==='null-tag',batchTag=shape==='batch-tag';
 const physical=normal?1:.1,extra=nullTag?.05:0,rootQty=normal?1:.2;
 const f=await h.world(make,tier,'zero',sql=>sql.exec(`
  UPDATE products SET stock_quantity=${normal?1:nullTag?.35:.3} WHERE id=1;
  UPDATE branch_stock SET quantity=${normal?1:nullTag?.15:.1} WHERE product_id=1 AND branch_id=1;
  UPDATE branch_batch_stock SET quantity=${physical} WHERE batch_id=1 AND branch_id=1;
  INSERT INTO branches(id,name,is_active)VALUES(2,'Other branch',1);
  INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,${normal?0:.2});
  UPDATE product_batches SET received_quantity=${legacy?'NULL':rootQty},received_cost_usd=${legacy?'NULL':normal?2:.4},unit_cost_usd=${legacy?'NULL':2},supplier_name='Original supplier',payment_status='credit' WHERE id=1;
  INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,user_id,user_name,created_at)
   VALUES(500,1,'Serum',1,'Shop',1,'add',${rootQty},${legacy?'NULL':2},${legacy?'NULL':normal?2:.4},'Original intake','synthetic-line-root',7,'Admin','2026-09-01 10:00:00');
  ${normal?'':"INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id)VALUES(501,1,'Serum',1,'Shop',1,'sale',-.1,2,-.2,'Prior actual consumption','sale:old');"}
 `));
 if(nullTag||batchTag) await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,"+(nullTag?'NULL':'1')+",.05,.05,'damaged','remove',2)"}], 'once');
 const body={quantity:normal?2:.4,expected_quantity:rootQty,expected_batch_id:1,expected_batch_revision:f.sql.prepare("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='1'),0) r").get().r,client_request_id:'stock-line-exact-'+shape,reason:'Exact intake correction'};
 return {f,body,rootQty,physical,extra,normal,legacy,call:()=>f.call('/inventory/stock-in-lines/500/edit',body)}
}
async function roundtrip(make,tier,shape){
 const {f,body,call,normal,legacy,extra}=await scenario(make,tier,shape);
 try{
  const root=f.sql.prepare('SELECT * FROM inventory_movements WHERE id=500').get(),initial=state(f),batch=f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get();
  const exact=(added)=>{assert.equal(f.state().physical,normal?(added?2:1):extra?(added?.35:.15):(added?.3:.1));assert.equal(f.state().cache,normal?(added?2:1):extra?(added?.55:.35):(added?.5:.3));assert.equal(f.state().lots[0].quantity,normal?(added?2:1):(added?.3:.1));assert.deepEqual(f.state().tags,initial.damaged_stock_lots.map(r=>({id:r.id,batch_id:r.batch_id,quantity_remaining:r.quantity_remaining})));const current=f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get();assert.equal(current.received_quantity,legacy?null:normal?(added?2:1):(added?.4:.2));assert.equal(current.supplier_name,batch.supplier_name);assert.equal(current.received_at,batch.received_at);assert.equal(current.unit_cost_usd,batch.unit_cost_usd);assert.equal(current.payment_status,batch.payment_status);assert.deepEqual(f.sql.prepare('SELECT * FROM inventory_movements WHERE id=500').get(),root)};
  const saved=await call();assert.equal(saved.status,200,JSON.stringify(saved));exact(true);const applied=state(f);assert.equal((await call()).status,200);assert.deepEqual(state(f),applied);
  const id=saved.json.action_history_id;assert.ok(id);
  for(const [direction,generation,added] of [['undo',0,false],['redo',1,true],['undo',2,false],['redo',3,true]]){const replay=await f.call('/action-history/'+id+'/'+direction,{expected_generation:generation});assert.equal(replay.status,200,JSON.stringify(replay));exact(added)}
  assert.equal(f.sql.prepare('SELECT generation FROM stock_lot_adjustment_operations').get().generation,4);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id LIKE 'stock-in-edit:500:%'").get().n,5);console.log('PASS counted stock-in edit/compensation '+JSON.stringify({tier,shape}));
 }finally{f.sql.close()}
}
async function main(){const make=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid']){await roundtrip(make,tier,'integer');for(const shape of ['fraction','batch-tag','null-tag','legacy'])await roundtrip(make,tier,shape)}}
module.exports={scenario,roundtrip,state}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
