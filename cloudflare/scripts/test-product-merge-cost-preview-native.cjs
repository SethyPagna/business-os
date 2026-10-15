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
  const pair=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:{version:1,reviewed_digest:seen.body.reviewedDigest}})
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
  const first=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',resolve});assert.equal(first.status,200,JSON.stringify(first.body))
  const retry=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',resolve});assert.equal(retry.status,200);assert.equal(retry.body.replayed,true)
  if(target!==null)state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,42,'manual',0)").run(target)
  const before=rows('SELECT * FROM products ORDER BY id'),events=rows('SELECT * FROM audit_logs ORDER BY id')
  const second=await merge({keepId:20,mergeId:22,keep:true,stock:'merge',resolve})
  assert.equal(second.status,target===null?200:409,JSON.stringify(second.body))
  if(target!==null){assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)}
 })
 await check('cost-blind merge actor gets no authority but has opaque PCE stale protection',async()=>{
  state.user={id:2,username:'mgr',name:'Manager',role:'staff',permissions:JSON.stringify({products:true,inventory:true})}
  const seen=await preview(20,21,'&groupIds=20,21')
  assert.equal(seen.status,200);assert.equal(Object.hasOwn(seen.body,'costAuthority'),false)
  const denied=await request('POST','/api/products/resolve/cost-preview',{keepId:20,reviewedDigest:seen.body.reviewedDigest,steps:[{mergeId:21,stock:'merge'}]})
  assert.equal(denied.status,403);assert.equal(Object.hasOwn(denied.body,'costAuthority'),false)
  state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(20,42,'manual',0)")
  const stale=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:{version:1,reviewed_digest:seen.body.reviewedDigest}})
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
   const done=await merge({keepId:20,mergeId:21,keep:true,stock:'merge',cost_review:{version:1,reviewed_digest:seen.body.reviewedDigest}})
   assert.equal(done.status,phase==='none'?200:409,JSON.stringify(done.body));if(phase!=='none'){assert.deepEqual(rows('SELECT * FROM products ORDER BY id'),before);assert.deepEqual(rows('SELECT * FROM audit_logs ORDER BY id'),events)}
  }finally{adapter.batch=batch}
 })
 console.log('Merge cost preview '+count+' groups passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
