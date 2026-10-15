const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const file=path.join(__dirname,'test-product-resolve-keep-merge-native.cjs'),source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),boundary=source.indexOf('\nasync function main() {')
const runner=new Module(file,module);runner.filename=file;runner.paths=module.paths
runner._compile(source.slice(0,boundary)+'\nmodule.exports={fresh,one,rows,state,request,merge,preview,adapter,catalogCost}',file)
const {fresh,one,rows,state,request,merge,preview,adapter,catalogCost}=runner.exports

let count=0
async function check(name,fn){fresh();try{await fn();count++;console.log('PASS '+name)}finally{state.native.db.close()}}
async function quote(steps=[{mergeId:21,stock:'merge'}]){
 const group=[20,...steps.map(step=>step.mergeId)].join(',')
 const seen=await preview(20,21,'&groupIds='+group)
 assert.equal(seen.status,200,JSON.stringify(seen.body))
 const result=await request('POST','/api/products/resolve/cost-preview',{keepId:20,reviewedDigest:seen.body.reviewedDigest,steps})
 assert.equal(result.status,200,JSON.stringify(result.body))
 return {seen,result}
}
function lots(sameKey=false,manual){
 state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(900,20,'keeper',1,4,'2026-09-01')")
 state.native.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_at) VALUES(902,21,?,1,8,'2026-09-02')").run(sameKey?'keeper':'loser')
 state.native.db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3),(902,1,1);INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(20,1,3),(21,1,1);UPDATE products SET stock_quantity=3 WHERE id=20;UPDATE products SET stock_quantity=1 WHERE id=21')
 if(manual!==undefined)state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(21,?,'manual',901)").run(manual)
}
async function main(){
 for(const usd of [null,0,5.123456789012345])for(const khr of [null,0,20500.12345678901])await check('canonical nullable/raw precision '+usd+'/'+khr,async()=>{
  state.native.db.prepare('UPDATE products SET cost_price_usd=?,purchase_price_usd=99,cost_price_khr=? WHERE id=20').run(usd,khr)
  const {result}=await quote(),authority=result.body.costAuthority
  assert.deepEqual(authority,{version:1,keeperId:20,cost_price_usd:usd,cost_price_khr:khr,needsReview:true,source:'keeper_fallback'})
  const done=await merge({keepId:20,mergeId:21,keep:true,stock:'merge'})
  assert.equal(done.status,200,JSON.stringify(done.body))
  assert.deepEqual(one('SELECT cost_price_usd,cost_price_khr FROM products WHERE id=20'),{cost_price_usd:usd,cost_price_khr:khr})
 })
 for(const manual of [7,0,7.123456789012345])await check('latest manual raw '+manual,async()=>{
  state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,?,'manual',0)").run(manual)
  const {result}=await quote()
  assert.equal(result.body.costAuthority.cost_price_usd,manual);assert.equal(result.body.costAuthority.source,'manual');assert.equal(result.body.costAuthority.needsReview,true)
  const done=await merge({keepId:20,mergeId:21,keep:true,stock:'merge'});assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=20').value,manual)
 })
 for(const [sameKey,manual,stock,expected,source,review]of [[false,undefined,'merge',5,'received_lot',false],[true,undefined,'merge',4,'received_lot',false],[true,7,'merge',7,'manual',true],[false,7,'write_off',7,'manual',true]])await check('actual graph collision/manual/writeoff '+JSON.stringify([sameKey,manual,stock]),async()=>{
  lots(sameKey,manual)
  const before=rows('SELECT * FROM products ORDER BY id'),{result}=await quote([{mergeId:21,stock}])
  assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before)
  assert.equal(result.body.costAuthority.cost_price_usd,expected);assert.equal(result.body.costAuthority.source,source);assert.equal(result.body.costAuthority.needsReview,review)
  const done=await merge({keepId:20,mergeId:21,keep:true,stock});assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=20').value,expected)
 })
 await check('new manual dependency invalidates preview and versioned pair admission without product revision',async()=>{
  const {seen}=await quote()
  const before=one('SELECT updated_at,cost_price_usd FROM products WHERE id=20')
  state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,42,'manual',0)")
  assert.deepEqual(one('SELECT updated_at,cost_price_usd FROM products WHERE id=20'),before)
  const snapshot=rows('SELECT * FROM products ORDER BY id')
  const stale=await request('POST','/api/products/resolve/cost-preview',{keepId:20,reviewedDigest:seen.body.reviewedDigest,steps:[{mergeId:21,stock:'merge'}]})
  assert.equal(stale.status,409)
  const pair=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:seen.body.costReview})
  assert.equal(pair.status,409);assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),snapshot)
 })
 await check('modern envelope malformed refuses; whole absence preserves automatic current-cost contract',async()=>{
  for(const cost_review of [null,{}, {version:1}, {version:2,reviewed_digest:'a'.repeat(64)}]){
   const result=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review});assert.equal(result.status,400,JSON.stringify(result.body))
  }
  assert.equal((await merge({keepId:20,mergeId:21,keep:true,stock:'merge'})).status,200)
 })

 for(const target of [null,20,22])await check('three-product continuation current PCE '+target,async()=>{
  state.native.db.exec("UPDATE products SET cost_price_usd=5 WHERE id=20;INSERT INTO products(id,name,barcode,cost_price_usd,is_active) SELECT 22,name,'fixture-third',9,1 FROM products WHERE id=20")
  const steps=[{mergeId:21,stock:'merge'},{mergeId:22,stock:'merge'}],{seen,result}=await quote(steps)
  assert.equal(result.body.costAuthority.cost_price_usd,5)
  const resolve={requestId:'preview-pce-'+String(target),reviewedDigest:seen.body.reviewedDigest,steps}
  const first=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',resolve,cost_review:result.body.costReview});assert.equal(first.status,200,JSON.stringify(first.body))
  const retry=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',resolve,cost_review:result.body.costReview});assert.equal(retry.status,200);assert.equal(retry.body.replayed,true)
  if(target!==null)state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,42,'manual',0)").run(target)
  const before=rows('SELECT * FROM products ORDER BY id'),events=rows('SELECT * FROM audit_logs ORDER BY id')
  const second=await merge({keepId:20,mergeId:22,keep:true,stock:'merge',resolve,cost_review:result.body.costReview})
  assert.equal(second.status,target===null?200:409,JSON.stringify(second.body))
  if(target!==null){assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)}
 })
 await check('cost-blind merge actor gets no authority but has opaque PCE stale protection',async()=>{
  const approved=await quote()
  state.user={id:2,username:'mgr',name:'Manager',role:'staff',permissions:JSON.stringify({products:true,inventory:true})}
  const seen=await preview(20,21,'&groupIds=20,21')
  assert.equal(seen.status,200);assert.equal(Object.hasOwn(seen.body,'costAuthority'),false)
  const denied=await request('POST','/api/products/resolve/cost-preview',{keepId:20,reviewedDigest:seen.body.reviewedDigest,steps:[{mergeId:21,stock:'merge'}]})
  assert.equal(denied.status,403);assert.equal(Object.hasOwn(denied.body,'costAuthority'),false)
  state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,42,'manual',0)")
  const stale=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:approved.result.body.costReview})
  assert.equal(stale.status,409)
  assert.equal((await merge({keepId:20,mergeId:21,keep:true,stock:'merge'})).status,200)
 })
 for(const phase of ['none','between_reads','before_fold'])await check('modern pair atomic PCE race '+phase,async()=>{
  const {seen}=await quote(),before=rows('SELECT * FROM products ORDER BY id'),events=rows('SELECT * FROM audit_logs ORDER BY id')
  const insert=()=>state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,42,'manual',0)")
  const batch=adapter.batch
  if(phase==='before_fold')state.beforeFold=insert
  else if(phase==='between_reads')adapter.batch=statements=>{const result=batch(statements);if(statements.some(s=>s.sql.includes('FROM product_cost_entries WHERE product_id IN'))){adapter.batch=batch;insert()}return result}
  try{
   const done=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:seen.body.costReview})
   assert.equal(done.status,phase==='none'?200:409,JSON.stringify(done.body));if(phase!=='none'){assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)}
  }finally{adapter.batch=batch}
 })
 await check('server quote binds keeper and exact stock plan; old graph token refuses',async()=>{
  lots(false)
  const {seen,result}=await quote(),before=rows('SELECT * FROM products ORDER BY id')
  assert.equal(result.body.costReview.version,1);assert.match(result.body.costReview.reviewed_digest,/^[a-f0-9]{64}$/)
  for(const body of [
   {keepId:20,mergeId:21,stock:'write_off',cost_review:result.body.costReview},
   {keepId:21,mergeId:20,stock:'merge',cost_review:result.body.costReview},
   {keepId:20,mergeId:21,stock:'merge',cost_review:{version:1,reviewed_digest:seen.body.reviewedDigest}},
  ]){const refused=await merge({...body,keep:true});assert.equal(refused.status,409,JSON.stringify(refused.body));assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before)}
  assert.equal((await merge({keepId:20,mergeId:21,stock:'merge',keep:true,cost_review:result.body.costReview})).status,200)
 })
 await check('server group quote binds ordered steps',async()=>{
  state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) SELECT 22,name,'third',9,1 FROM products WHERE id=20")
  const steps=[{mergeId:21,stock:'merge'},{mergeId:22,stock:'merge'}],{seen,result}=await quote(steps),before=rows('SELECT * FROM products ORDER BY id')
  const refused=await merge({keepId:20,mergeId:21,stock:'merge',keep:true,cost_review:result.body.costReview,
   resolve:{requestId:'wrong-order',reviewedDigest:seen.body.reviewedDigest,steps:[...steps].reverse()}})
  assert.equal(refused.status,409);assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before)
 })
 for(const value of [null,0,7.123456789012345])await check('bulk authoritative nullable parity '+value,async()=>{
  state.native.db.prepare('UPDATE products SET cost_price_usd=? WHERE id=20').run(value)
  const seen=await request('GET','/api/products/merge-duplicates/preview')
  assert.equal(seen.status,200,JSON.stringify(seen.body));assert.equal(seen.body.groups[0].costAuthority.cost_price_usd,value);assert.ok(seen.body.costReview)
  const done=await request('POST','/api/products/merge-duplicates',{cost_review:seen.body.costReview})
  assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.mergedProducts,1);assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=20').value,value)
  console.log('QUERY bulk preview='+seen.queries+' apply='+done.queries)
 })
 for(const phase of ['before_request','before_fold'])await check('bulk frozen PCE dependency '+phase,async()=>{
  const seen=await request('GET','/api/products/merge-duplicates/preview'),before=rows('SELECT * FROM products ORDER BY id'),events=rows('SELECT * FROM audit_logs ORDER BY id')
  const insert=()=>state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,42,'manual',0)")
  if(phase==='before_request')insert();else state.beforeFold=insert
  const done=await request('POST','/api/products/merge-duplicates',{cost_review:seen.body.costReview})
  assert.equal(done.status,409,JSON.stringify(done.body));assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)
 })
 for(const partial of [false,true])await check('bulk preserved progress and frozen approvals partial='+partial,async()=>{
  state.native.db.exec(partial?"INSERT INTO products(id,name,barcode,cost_price_usd,is_active) SELECT 22,name,'00601',13,1 FROM products WHERE id=20":"INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(60,'Second group','0700',3,1),(61,'Second group','700',4,1)")
  const seen=await request('GET','/api/products/merge-duplicates/preview');assert.ok(seen.body.costReview,JSON.stringify(seen.body))
  const batch=adapter.batch;let folds=0
  adapter.batch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO undo_snapshots'))&&++folds===2)throw Error('D1 DB is overloaded fixture');return batch(statements)}
  let first;try{first=await request('POST','/api/products/merge-duplicates',{client_request_id:'frozen-progress',cost_review:seen.body.costReview})}finally{adapter.batch=batch}
  assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.mergedProducts,1);assert.equal(first.body.madeProgress,true);assert.equal(first.body.interrupted,true)
  const committed=rows('SELECT * FROM products ORDER BY id')
  state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(70,'Unapproved','0800',3,1),(71,'Unapproved','800',4,1)")
  const second=await request('POST','/api/products/merge-duplicates',{client_request_id:'frozen-progress',cost_review:seen.body.costReview})
  assert.equal(second.status,partial?409:200,JSON.stringify(second.body))
  if(partial)assert.deepEqual(rows('SELECT * FROM products WHERE id<70 ORDER BY id'),committed)
  else{assert.equal(second.body.mergedProducts,1);assert.equal(second.body.complete,true)}
  assert.equal(one('SELECT is_active FROM products WHERE id=71').is_active,1)
 })
 await check('bulk three-product uninterrupted original fallback and committed retry',async()=>{
  state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) SELECT 22,name,'00601',13,1 FROM products WHERE id=20")
  const seen=await request('GET','/api/products/merge-duplicates/preview'),quote=seen.body.costReview
  const done=await request('POST','/api/products/merge-duplicates',{cost_review:quote})
  assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.mergedProducts,2);assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=20').value,9)
  const events=rows('SELECT * FROM audit_logs ORDER BY id'),retry=await request('POST','/api/products/merge-duplicates',{cost_review:quote})
  assert.equal(retry.status,200);assert.equal(retry.body.mergedProducts,0);assert.equal(retry.body.complete,true);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)
 })
 await check('bulk malformed maps and changed pending identity refuse before writes',async()=>{
  const seen=await request('GET','/api/products/merge-duplicates/preview'),before=rows('SELECT * FROM products ORDER BY id')
  for(const value of [null,{}, {...seen.body.costReview,version:2}, {...seen.body.costReview,reviewed_digest:'a'.repeat(64)}, {...seen.body.costReview,groups:[{...seen.body.costReview.groups[0],member_ids:[21,20]}]}]){
   const refused=await request('POST','/api/products/merge-duplicates',{cost_review:value});assert.equal(refused.status,400,JSON.stringify(refused.body));assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before)
  }
  state.native.db.exec("UPDATE products SET name='Changed identity' WHERE id=21")
  const changed=rows('SELECT * FROM products ORDER BY id'),refused=await request('POST','/api/products/merge-duplicates',{cost_review:seen.body.costReview})
  assert.equal(refused.status,409);assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),changed)
 })
 await check('bulk coherent review reads stay constant across two groups',async()=>{
  const first=await request('GET','/api/products/merge-duplicates/preview')
  state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(60,'Second group','0700',3,1),(61,'Second group','700',4,1)")
  const second=await request('GET','/api/products/merge-duplicates/preview')
  assert.equal(second.body.costReview.groups.length,2);assert.equal(second.queries,first.queries);console.log('QUERY one/two group previews='+first.queries+'/'+second.queries)
 })
 await check('Free budget unavailable/refusal and hidden cost omission',async()=>{
  const paid=await request('GET','/api/products/merge-duplicates/preview'),pair=await quote(),before=rows('SELECT * FROM products ORDER BY id')
  state.tier='free'
  const free=await request('GET','/api/products/merge-duplicates/preview')
  assert.equal(free.status,200);assert.equal(Object.hasOwn(free.body,'costReview'),false);assert.equal(Object.hasOwn(free.body.groups[0],'costAuthority'),false);assert.equal(free.body.costAuthorityUnavailable.code,'resolve_plan_budget')
  const refused=await request('POST','/api/products/merge-duplicates',{cost_review:paid.body.costReview});assert.equal(refused.status,409);assert.equal(refused.body.code,'resolve_plan_budget');assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before)
  const pairRefused=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:pair.result.body.costReview});assert.equal(pairRefused.status,409);assert.equal(pairRefused.body.code,'resolve_plan_budget')
  const pairPreview=await request('GET','/api/products/possible-duplicates/merge-preview?keepId=20&mergeId=21');assert.equal(pairPreview.status,200);assert.equal(Object.hasOwn(pairPreview.body,'costAuthority'),false);assert.equal(Object.hasOwn(pairPreview.body,'costReview'),false)
  state.tier='paid';state.user={id:2,username:'mgr',role:'staff',permissions:JSON.stringify({products:true,inventory:true})}
  const hidden=await request('GET','/api/products/merge-duplicates/preview');assert.equal(hidden.status,200);assert.equal(Object.hasOwn(hidden.body,'costReview'),false);assert.equal(Object.hasOwn(hidden.body,'costAuthorityUnavailable'),false);assert.equal(Object.hasOwn(hidden.body.groups[0],'costAuthority'),false)
  console.log('QUERY Free preview='+free.queries+' refusal='+refused.queries)
 })
 await check('bulk finalizer failure preserves committed progress and refuses partial retry',async()=>{
  state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) SELECT 22,name,'00601',13,1 FROM products WHERE id=20")
  const seen=await request('GET','/api/products/merge-duplicates/preview'),batch=adapter.batch
  adapter.batch=statements=>{if(statements.some(s=>s.sql.includes('AS merge_cost_initial_fingerprint_guard')))throw Error('D1 DB is overloaded finalizer fixture');return batch(statements)}
  let done;try{done=await request('POST','/api/products/merge-duplicates',{cost_review:seen.body.costReview})}finally{adapter.batch=batch}
  assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.mergedProducts,1);assert.equal(done.body.madeProgress,true);assert.equal(done.body.undoPendingCount,1);assert.equal(done.body.interrupted,true)
  const committed=rows('SELECT * FROM products ORDER BY id'),retry=await request('POST','/api/products/merge-duplicates',{cost_review:seen.body.costReview})
  assert.equal(retry.status,409);assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),committed)
 })
 console.log('Merge cost preview '+count+' groups passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
