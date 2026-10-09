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
  const finished=state(f);for(const expected_generation of [0,99]){assert.equal((await f.call('/action-history/'+id+'/undo',{expected_generation})).status,409);assert.deepEqual(state(f),finished)}assert.equal(f.sql.prepare('SELECT generation FROM stock_lot_adjustment_operations').get().generation,4);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id LIKE 'stock-in-edit:500:%'").get().n,5);console.log('PASS counted stock-in edit/compensation '+JSON.stringify({tier,shape}));
 }finally{f.sql.close()}
}

async function controls(make){
 for(const tier of ['free','paid']){
  for(const direction of ['apply','undo','redo'])for(const fault of ['root','fold','receipt','receipt_set','tag_set','actor','actor_role','actor_permissions','actor_password','generation','operation']){
   if(direction==='apply'&&['generation','operation'].includes(fault))continue;
   const {f,call}=await scenario(make,tier);try{
    let saved;if(direction!=='apply'){saved=await call();assert.equal(saved.status,200);if(direction==='redo')assert.equal((await f.call('/action-history/'+saved.json.action_history_id+'/undo',{expected_generation:0})).status,200)}
    const sql={root:"UPDATE inventory_movements SET reason='Rival history' WHERE id=500",fold:"INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,reason,reference_id)VALUES(1,1,1,'adjustment',0,'Rival fold','stock-in-edit:500:rival:0')",receipt:"UPDATE product_batches SET supplier_name='Rival' WHERE id=1",receipt_set:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(90,1,'rival-empty',1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(90,1,0)",tag_set:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,NULL,0,0,'damaged','remove')",actor:'UPDATE users SET is_active=0 WHERE id=7',actor_role:"UPDATE roles SET permissions='{}' WHERE id=(SELECT role_id FROM users WHERE id=7)",actor_permissions:"UPDATE users SET permissions='{}' WHERE id=7",actor_password:'UPDATE users SET must_change_password=1 WHERE id=7',generation:'UPDATE stock_lot_adjustment_operations SET generation=generation+10',operation:"UPDATE stock_lot_adjustment_operations SET before_json=json_set(before_json,'$.branchQty',999)"}[fault];
    let rival;f.beforeCommit(async()=>{await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),sql.split(';').map(sql=>({sql})), 'once');rival=state(f)});
    const result=direction==='apply'?await call():await f.call('/action-history/'+saved.json.action_history_id+'/'+direction,{expected_generation:direction==='undo'?0:1});assert.equal(result.status,409,JSON.stringify({tier,direction,fault,result}));assert.deepEqual(state(f),rival);console.log('PASS line edit captured source race '+JSON.stringify({tier,direction,fault}));
   }finally{f.sql.close()}
  }
  for(const direction of ['apply','undo','redo']){
   const {f,call}=await scenario(make,tier);try{
    let saved;if(direction!=='apply'){saved=await call();if(direction==='redo')await f.call('/action-history/'+saved.json.action_history_id+'/undo',{expected_generation:0})}
    const before=state(f);f.sql.exec("CREATE TRIGGER line_edit_unrelated BEFORE INSERT ON inventory_movements WHEN NEW.reference_id LIKE 'stock-in-edit:500:%' BEGIN SELECT RAISE(ABORT,'synthetic_unrelated_line_error'); END");
    const invoke=()=>direction==='apply'?call():f.call('/action-history/'+saved.json.action_history_id+'/'+direction,{expected_generation:direction==='undo'?0:1});const failed=await invoke();assert.equal(failed.status,direction==='apply'?500:409,JSON.stringify(failed));assert.deepEqual(state(f),before);f.sql.exec('DROP TRIGGER line_edit_unrelated');
    f.loseNextCommitAcknowledgement();const result=await invoke();assert.equal(result.status,200,JSON.stringify(result));const committed=state(f);const retry=await invoke();assert.equal(retry.status,200,JSON.stringify(retry));assert.deepEqual(state(f),committed);console.log('PASS line edit rollback/committed lost ACK/canonical recovery '+JSON.stringify({tier,direction}));
   }finally{f.sql.close()}
  }
 }
}
async function tails(make){
 for(const tier of ['free','paid'])for(const direction of ['apply','undo','redo']){
  const {f,call}=await scenario(make,tier);let saved;if(direction!=='apply'){saved=await call();if(direction==='redo')await f.call('/action-history/'+saved.json.action_history_id+'/undo',{expected_generation:0})}
  let attempts=0,body=0,committed=false;const failed=new Map(),families=new Set(),raw=f.env.DB;
  try{
   f.env.CACHE={get:async()=>null,put:async()=>{throw Error('Synthetic KV failure')},delete:async()=>{}};f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'");
   const fault=(sql,params)=>{if(!committed)return false;const family=/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null;if(!family)return false;families.add(family);const key=family+JSON.stringify(params);const count=failed.get(key)||0;failed.set(key,count+1);return count<2};
   const wrap=(stmt,sql)=>new Proxy(stmt,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),sql);if(['all','first','run'].includes(key))return(...args)=>{attempts++;return fault(sql,target.params)?Promise.reject(Error('D1_ERROR: network reset before line tail')):target[key](...args)};return target[key]}});
   f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);if(key==='batch')return async statements=>{attempts+=statements.length;const mutation=statements.some(row=>/INSERT INTO inventory_movements/.test(row.text));if(mutation)body=statements.length;if(statements.some(row=>fault(row.text,row.params)))throw Error('D1_ERROR: network reset before line tail');try{return await target.batch(statements)}finally{if(mutation)committed=true}};return target[key]}});
   f.loseNextCommitAcknowledgement();const result=direction==='apply'?await call():await f.call('/action-history/'+saved.json.action_history_id+'/'+direction,{expected_generation:direction==='undo'?0:1});assert.equal(result.status,200,JSON.stringify(result));assert.ok(attempts<=(tier==='free'?50:1000));assert.deepEqual([...families].sort(),tier==='free'?['handoff','quota','versions']:['handoff','versions']);console.log('LINE_EDIT_FULL_TAIL '+JSON.stringify({tier,direction,attempts,body}));
  }finally{f.sql.close()}
 }
}
async function budget(make){
 for(const tier of ['free','paid']){
  const {f,call,body}=await scenario(make,tier,'integer');try{
   const snapshot=state(f);body.quantity=0;assert.equal((await call()).status,200);assert.equal(f.state().physical,0);assert.equal(f.state().lots[0].quantity,0);console.log('PASS line edit zero correction '+tier);
  }finally{f.sql.close()}
  const c=await scenario(make,tier,'integer');try{
   await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(c.f.env),[{sql:"INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,reference_id)VALUES(900,1,1,1,'add',1,'other-receipt')"},{sql:'UPDATE product_batches SET received_quantity=2,received_cost_usd=4 WHERE id=1'}],'once');c.body.received_date='2026-09-05';c.body.expected_batch_revision=c.f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='1'").get().revision;
   const before=state(c.f),result=await c.call();assert.equal(result.status,tier==='free'?409:200,JSON.stringify(result));if(tier==='free'){assert.equal(result.json.code,'stock_in_edit_over_plan_budget');assert.deepEqual(state(c.f),before)}else{assert.equal(c.f.state().physical,2);const undo=await c.f.call('/action-history/'+result.json.action_history_id+'/undo',{expected_generation:0});assert.equal(undo.status,200,JSON.stringify(undo));assert.equal(c.f.state().physical,1);assert.equal(c.f.sql.prepare('SELECT is_active FROM product_batches ORDER BY id DESC LIMIT 1').get().is_active,0,'undo deactivates emptied created receipt after physical write');const redo=await c.f.call('/action-history/'+result.json.action_history_id+'/redo',{expected_generation:1});assert.equal(redo.status,200,JSON.stringify(redo));assert.equal(c.f.state().physical,2)}console.log('PASS whole-batch plan admission/moved receipt '+JSON.stringify({tier,status:result.status}));
  }finally{c.f.sql.close()}
 }
 const {f,body}=await scenario(make,'free');try{const mod=h.loadStockSession('lib/stockInLineEdit.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env),user=f.sql.prepare('SELECT u.*,r.code role_code,r.permissions role_permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=7').get(),before=state(f);const missing=await mod.applyStockInLineEdit(db,user,500,body);assert.equal(missing.status,503);assert.deepEqual(state(f),before);const blocked=await mod.applyStockInLineEdit(db,user,500,body,null,undefined,{limit:1,used:()=>0});assert.equal(blocked.status,409,JSON.stringify(blocked));assert.deepEqual(state(f),before);const valid=await mod.applyStockInLineEdit(db,user,500,body,null,undefined,{limit:50,used:()=>0});assert.equal(valid.status,200,JSON.stringify(valid));assert.equal(f.state().physical,.3);console.log('PASS explicit isolated helper budget/missing budget refusal');}finally{f.sql.close()}
}

async function main(){const make=await h.bundle.exports.bundleWorker();if(process.argv.includes('--controls-only')){await controls(make);return}if(process.argv.includes('--tails-only')){await tails(make);return}if(process.argv.includes('--budget-only')){await budget(make);return}for(const tier of ['free','paid']){await roundtrip(make,tier,'integer');for(const shape of ['fraction','batch-tag','null-tag','legacy'])await roundtrip(make,tier,shape)}await controls(make);await tails(make);await budget(make)}
module.exports={scenario,roundtrip,controls,tails,budget,state}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
