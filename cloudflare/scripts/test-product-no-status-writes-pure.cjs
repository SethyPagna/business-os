const assert=require('node:assert/strict')
const {seed,request,post,get,graph,rawDb,db,fakeEnv,loadReal}=require('./test-product-active-stock-products-route.cjs')
let checks=0
async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
async function main(){
 for(const value of [0,false,'0','false','inactive','',2]) await check('stale status '+JSON.stringify(value)+' refuses PUT and create before effects',async()=>{
  seed('zero');const before=graph()
  for(const res of [await request('PUT',{is_active:value,description:'forbidden'}),await post('/',{name:'New forbidden',is_active:value}),await post('/variant',{name:'Variant forbidden',parent_id:1,is_active:value})]){assert.equal(res.status,409,JSON.stringify(res));assert.equal(res.json.code,'product_status_unsupported')}
  assert.equal(graph(),before)
 })
 for(const value of [undefined,null,1,true,'1']) await check('compatible status '+String(value)+' preserves catalog membership',async()=>{
  seed('zero');const body={description:'permitted'};if(value!==undefined)body.is_active=value
  const result=await request('PUT',body);assert.equal(result.status,200,JSON.stringify(result));assert.deepEqual({...rawDb.prepare('SELECT is_active,description FROM products WHERE id=1').get()},{is_active:1,description:'permitted'})
  const created=await post('/',{name:'New present '+String(value),is_active:value});assert.equal(created.status,200,JSON.stringify(created));assert.equal(rawDb.prepare('SELECT is_active FROM products WHERE name=?').get(['New present '+String(value)]).is_active,1)
 })
 await check('status-only compatible request has no data effects',async()=>{seed('zero');const before=graph();assert.equal((await request('PUT',{is_active:1})).status,200);assert.equal(graph(),before)})
 await check('stale one cannot revive a removed product',async()=>{seed('zero');rawDb.prepare('UPDATE products SET is_active=0 WHERE id=1').run();const before=graph();const result=await request('PUT',{is_active:1,description:'revive'});assert.equal(result.status,409);assert.equal(graph(),before)})
 const review=loadReal('lib/reviewApply.ts',{'./db':{getDb:()=>db},'./audit':{audit:async()=>{}},'./cache':{bumpVersion:async()=>{}},'../durable-objects/broadcastHub':{broadcast:async()=>{}}})
 for(const action of ['create','update']) await check('review '+action+' rejects disabling with no effects',async()=>{seed('zero');const before=graph();await assert.rejects(()=>review.applyApprovedPendingAction(fakeEnv,{section:'products',action_type:action,entity_type:'product',entity_id:1,payload_json:JSON.stringify({name:'No disable',is_active:0})},{id:1,name:'Reviewer'}),error=>error.code==='product_status_unsupported');assert.equal(graph(),before)})
 await check('review cannot revive removed product',async()=>{seed('zero');rawDb.prepare('UPDATE products SET is_active=0 WHERE id=1').run();const before=graph();await assert.rejects(()=>review.applyApprovedPendingAction(fakeEnv,{section:'products',action_type:'update',entity_type:'product',entity_id:1,payload_json:JSON.stringify({is_active:1,description:'No revive'})},{id:1,name:'Reviewer'}),error=>error.code==='product_has_stock');assert.equal(graph(),before)})
 await check('zero ordinary product visible while removed product excluded from catalog and ranked IDs',async()=>{seed('zero');rawDb.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(2,'Removed',0,0)").run();for(const url of ['/?ids=1,2','/search?rankIds=1,2']){const result=await get(url);assert.equal(result.status,200,JSON.stringify(result));const items=Array.isArray(result.json)?result.json:result.json.items;assert.ok(items.some(item=>item.id===1));assert.ok(!items.some(item=>item.id===2))}})
 await check('inactive branch still refuses receiving stock',async()=>{seed('zero');rawDb.prepare("INSERT INTO branches(id,name,is_active) VALUES(2,'Inactive branch',0)").run();const before=graph();const result=await post('/',{name:'Branch control',stock_quantity:2,branch_id:2});assert.equal(result.status,409,JSON.stringify(result));assert.equal(graph(),before);assert.equal(rawDb.prepare('SELECT is_active FROM branches WHERE id=2').get().is_active,0)})
 await check('zero removal audit and membership commit atomically',async()=>{seed('zero');rawDb.exec("CREATE TRIGGER test_fail_zero_audit BEFORE INSERT ON audit_logs WHEN NEW.action='zero_quantity_delete' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");const before=graph();const result=await post('/zero-quantity-delete',{ids:[1]});assert.equal(result.status,500);assert.equal(graph(),before);rawDb.exec('DROP TRIGGER test_fail_zero_audit');const successful=await post('/zero-quantity-delete',{ids:[1]});assert.equal(successful.status,200,JSON.stringify(successful));assert.equal(successful.json.deletedCount,1);assert.equal(rawDb.prepare('SELECT is_active FROM products WHERE id=1').get().is_active,0);assert.equal(rawDb.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='zero_quantity_delete' AND CAST(entity_id AS INTEGER)=1").get().n,1)})
 console.log(checks+' no-status checks passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})


