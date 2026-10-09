const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const coreFile=path.join(__dirname,'test-counted-damaged-core-native.cjs'),core=new Module(coreFile,module);core.filename=coreFile;core.paths=module.paths
core._compile(fs.readFileSync(coreFile,'utf8').split('async function main() {')[0]+'\nmodule.exports={world,exclusive,convert,stock,db,load}',coreFile)
const {world,exclusive,convert,stock,db,load}=core.exports
const bundleFile=path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs'),bundle=new Module(bundleFile,module);bundle.filename=bundleFile;bundle.paths=module.paths
bundle._compile(fs.readFileSync(bundleFile,'utf8').split('async function main(){')[0]+'\nmodule.exports={bundleWorker}',bundleFile)
async function run(tier,batch=true){
 const worker=(await bundle.exports.bundleWorker())(),f=world(batch)
 exclusive(f);convert(f);f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
 try{
 f.env.PLAN_TIER=tier;f.env.BUSINESS_OS_ADMIN_PASSWORD='synthetic-admin-password';f.env.PASSWORD_PEPPER='synthetic-native-pepper-at-least-32-characters'
 f.env.CACHE={get:async()=>null,put:async()=>{},delete:async()=>{}};f.env.BROADCAST_HUB={idFromName:x=>x,get:()=>({fetch:async()=>new Response('{}')})}
 await worker.ensureCoreDataInvariants(f.env)
 f.sql.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active)SELECT 7,'admin','Admin','synthetic',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1")
 const token='condition-history-native',now=Date.now();f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at)VALUES(7,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),new Date(now-3600000).toISOString(),new Date(now+86400000).toISOString(),new Date(now).toISOString())
 let count=0,fail=false,lose=false;const raw=f.env.DB
 const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...a)=>wrap(t.bind(...a));if(['first','all','run'].includes(k))return(...a)=>{count++;return t[k](...a)};return t[k]}})
 f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return s=>wrap(t.prepare(s));if(k==='batch')return ss=>{count+=ss.length;if(fail&&ss.some(s=>s.text.includes('UPDATE action_history SET status='))){fail=false;ss=[...ss.slice(0,-1),raw.prepare("SELECT json_extract('[1]','$[condition_final_failure]')")]}if(lose&&ss.some(s=>s.text.includes('UPDATE action_history SET status='))){lose=false;return Promise.resolve(t.batch(ss)).then(()=>{throw new Error('native committed unknown outcome')})}return t.batch(ss)};return t[k]}})
 async function call(url,body){count=0;const tasks=[],r=await worker.default.fetch(new Request('https://admin.business.test/api'+url,{method:'POST',headers:{cookie:'bos_session='+token,'content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)}),f.env,{waitUntil:p=>tasks.push(Promise.resolve(p)),passThroughOnException(){}});while(tasks.length)await Promise.all(tasks.splice(0));const json=await r.json();console.log(JSON.stringify({tier,url,status:r.status,count,code:json.code,error:json.error}));assert.ok(count<=(tier==='free'?50:1000));return{status:r.status,json}}
 const lossWhere=load('lib/removalLosses.ts').removalLossMovementWhere('m');const loss=()=>f.sql.prepare('SELECT COALESCE(SUM(quantity),0)n FROM inventory_movements m WHERE '+lossWhere).get().n
 const T=()=>f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,D=()=>f.sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0)n FROM damaged_stock_lots').get().n
 const command={productId:1,branchId:1,batchId:batch?1:null,type:'remove',quantity:2,conditionTag:'damaged',reason:'tag native',client_request_id:'condition-tag-one'}
 assert.equal((await call('/inventory/adjust',command)).status,200);assert.equal(T(),10);assert.equal(D(),5)
 assert.equal((await call('/inventory/adjust',command)).status,200);assert.equal(D(),5)
 const history=()=>f.sql.prepare("SELECT * FROM action_history WHERE entity='stock_condition' ORDER BY id DESC LIMIT 1").get()
 let h=history();assert.ok(h);let pointer=JSON.parse(h.undo_payload)
 fail=true;const before=JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all());assert.notEqual((await call('/action-history/'+h.id+'/undo',{expected_generation:0})).status,200);assert.equal(D(),5);assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all()),before)
 lose=true;assert.equal((await call('/action-history/'+h.id+'/undo',{expected_generation:0})).status,200);assert.equal(T(),10);assert.equal(D(),3)
 assert.equal((await call('/action-history/'+h.id+'/undo',{expected_generation:0})).status,200);assert.equal(D(),3)
 assert.equal((await call('/action-history/'+h.id+'/redo',{expected_generation:1})).status,200);assert.equal(D(),5)
 const clear={productId:1,branchId:1,quantity:4,conditionTag:'damaged',reason:'clear unequal',client_request_id:'condition-clear-one'}
 assert.equal((await call('/inventory/tagged-lots/restore',clear)).status,200);assert.equal(T(),10);assert.equal(D(),1)
 h=history();pointer=JSON.parse(h.undo_payload);const saved=JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(pointer.snapshot_id).payload_json)
 assert.deepEqual(saved.takes.map(t=>t.quantity),[3,1]);assert.equal((await call('/action-history/'+h.id+'/undo',{expected_generation:0})).status,200);assert.equal(D(),5);assert.equal(T(),10)
 const multi={...clear,client_request_id:'condition-multi-dispose'};assert.equal((await call('/inventory/tagged-lots/dispose',multi)).status,200);assert.equal(T(),6);assert.equal(D(),1);assert.equal(loss(),4)
 const mh=history(),ms=JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(JSON.parse(mh.undo_payload).snapshot_id).payload_json);assert.deepEqual(ms.takes.map(t=>t.quantity),[3,1])
 const multiBefore=JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all());fail=true;assert.notEqual((await call('/action-history/'+mh.id+'/undo',{expected_generation:0})).status,200);assert.equal(T(),6);assert.equal(D(),1);assert.equal(loss(),4);assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements').all()),multiBefore)
 assert.equal((await call('/action-history/'+mh.id+'/undo',{expected_generation:0})).status,200);assert.equal(T(),10);assert.equal(D(),5);assert.equal(loss(),0)
 assert.equal((await call('/action-history/'+mh.id+'/redo',{expected_generation:1})).status,200);assert.equal(T(),6);assert.equal(D(),1);assert.equal(loss(),4)
 assert.equal(f.sql.prepare('SELECT SUM(total_cost_usd)n FROM inventory_movements m WHERE '+lossWhere).get().n,8)
 assert.equal((await call('/action-history/'+mh.id+'/undo',{expected_generation:2})).status,200);assert.equal(T(),10);assert.equal(D(),5);assert.equal(loss(),0)
 assert.equal((await call('/action-history/'+h.id+'/redo',{expected_generation:1})).status,200);assert.equal(D(),1)
 const dispose={...clear,quantity:1,reason:'remove tagged',client_request_id:'condition-dispose-one'}
 assert.equal((await call('/inventory/tagged-lots/dispose',dispose)).status,200);assert.equal(T(),9);assert.equal(D(),0);assert.equal(loss(),1)
 h=history();assert.equal((await call('/action-history/'+h.id+'/undo',{expected_generation:0})).status,200);assert.equal(T(),10);assert.equal(D(),1);assert.equal(loss(),0)
 assert.equal((await call('/action-history/'+h.id+'/redo',{expected_generation:1})).status,200);assert.equal(T(),9);assert.equal(D(),0);assert.equal(loss(),1)
 assert.equal((await call('/action-history/'+h.id+'/undo',{expected_generation:2})).status,200);assert.equal(loss(),0)
 const compensation=f.sql.prepare("SELECT id FROM inventory_movements WHERE reference_id LIKE 'revert:condition_history:%' ORDER BY id DESC LIMIT 1").get();assert.equal((await call('/inventory/movements/'+compensation.id+'/revert',{})).json.code,'revert_use_history')
 assert.equal((await call('/action-history/'+h.id+'/redo',{expected_generation:3})).status,200);assert.equal(loss(),1)
 const legacy={scope:'inventory',entity:'stock',entity_id:1,label:'Legacy condition history',reversible:false}
 const oldHistory=await call('/action-history',legacy);assert.equal(oldHistory.status,200)
 const oldRows=JSON.stringify(f.sql.prepare("SELECT * FROM action_history WHERE label='Legacy condition history'").all())
 const secondTag={...command,quantity:2,client_request_id:'condition-consumed-tag'};assert.equal((await call('/inventory/adjust',secondTag)).status,200)
 const consumedHistory=history();const consumedTake=JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(JSON.parse(consumedHistory.undo_payload).snapshot_id).payload_json).takes[0]
  await stock.executeStockTransaction(db(f),[{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=@id",params:{id:consumedTake.lotId}}],'once')
 assert.equal((await call('/action-history/'+consumedHistory.id+'/undo',{expected_generation:0})).status,409);assert.equal(T(),9);assert.equal(D(),2)
 await stock.executeStockTransaction(db(f),[{sql:"UPDATE damaged_stock_lots SET condition_tag='damaged' WHERE id=@id",params:{id:consumedTake.lotId}}],'once')
 await stock.executeStockTransaction(db(f),load('lib/countedDamagedStock.ts').planCountedTaggedChange({lotId:consumedTake.lotId,productId:1,branchId:1,batchId:consumedTake.batchId},1,'consume'),'once')
 const stockBefore=[T(),D()];assert.equal((await call('/action-history/'+consumedHistory.id+'/undo',{expected_generation:0})).status,409);assert.deepEqual([T(),D()],stockBefore)
 assert.equal(JSON.stringify(f.sql.prepare("SELECT * FROM action_history WHERE label='Legacy condition history'").all()),oldRows)
 const forged=await call('/action-history',{...legacy,reversible:true,undo_payload:{applier:'inventory.counted_condition',snapshot_id:1,generation:0},redo_payload:{applier:'inventory.counted_condition',snapshot_id:1,generation:0}});assert.notEqual(forged.status,200)
 await stock.executeStockTransaction(db(f),load('lib/countedDamagedStock.ts').planCountedTaggedChange({lotId:consumedTake.lotId,productId:1,branchId:1,batchId:consumedTake.batchId},1,'consume'),'once')
 const remaining=T();await stock.executeStockTransaction(db(f),load('lib/productBatches.ts').planRemoveStockAcrossBatches({productId:1,branchId:1,quantity:remaining,allocations:batch?[{batchId:1,quantity:remaining}]:[]}).statements,'once')
 assert.equal(T(),0);assert.equal(D(),0);const noStock=await call('/inventory/adjust',{...command,quantity:1,client_request_id:'condition-zero-stock'});assert.notEqual(noStock.status,200);assert.equal(T(),0);assert.equal(D(),0)
 console.log('PASS actual tag/unequal clear/remove authoritative undo redo exact shares, repeated request/generation, final rollback and unknown recovery')
 }finally{f.sql.close()}
}
(async()=>{for(const tier of ['free','paid'])for(const batch of [true,false])await run(tier,batch)})().catch(e=>{console.error(e);process.exitCode=1})
