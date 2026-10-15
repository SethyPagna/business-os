const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const file=path.join(__dirname,'test-product-resolve-keep-merge-native.cjs'),source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),boundary=source.indexOf('\nasync function main() {')
assert.ok(boundary>0)
const runner=new Module(file,module);runner.filename=file;runner.paths=module.paths
runner._compile(source.slice(0,boundary)+'\nmodule.exports={fresh,one,rows,state,merge,preview,adapter,load,ADMIN,catalogCost,undoAppliers}',file)
const {fresh,one,rows,state,merge,preview,adapter,load,ADMIN,catalogCost,undoAppliers}=runner.exports
const ts=require('typescript'),cache=new Map()
function real(name){
 if(name==='db')return {getDb:()=>adapter}
 if(cache.has(name))return cache.get(name).exports
 const filename=path.join(__dirname,'../src/lib',name+'.ts'),mod={exports:{}};cache.set(name,mod)
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require','module',code)(mod.exports,id=>id.startsWith('./')?real(id.slice(2)):require(id),mod)
 return mod.exports
}
function binding(){return {prepare(sql){let values=[];const statement=state.native.db.prepare(sql),api={bind(...params){values=params;return api},async first(){return statement.get(...values)||null},async all(){return {results:statement.all(...values)}},async run(){const result=statement.run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}}};return api},async batch(items){state.native.db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());state.native.db.exec('COMMIT');return results}catch(error){state.native.db.exec('ROLLBACK');throw error}}}}
async function storageCases(){
 fresh()
 try{
  if(!rows('PRAGMA table_info(products)').some(row=>row.name==='cost_review_key'))state.native.db.exec('ALTER TABLE products ADD COLUMN cost_review_key TEXT')
  const oldWriter=real('productWrites');oldWriter.PRODUCT_SKIP_KEYS.delete('cost_review_key')
  const env={DB:binding()}
  await assert.rejects(()=>oldWriter.updateRow(env,'products',10,{cost_review_key:'a'.repeat(32)}),/product_cost_review_write_refused/)
  console.log('PASS actual dynamic generic writer with old skip list cannot install protected review identity')
  const review=real('productCostReview'),outcome=review.mergeCostOutcome(10,{usd:5.1234,khr:20500})
  await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(outcome,{id:1,name:'Fixture'}), 'retry')
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,outcome.reviewKey)
  await assert.rejects(()=>oldWriter.updateRow(env,'products',10,{cost_review_key:null}),/product_cost_review_write_refused/)
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,outcome.reviewKey)
  console.log('PASS atomic admitted outcome installs marker and old generic writer cannot clear it')
  const before=JSON.stringify(rows('SELECT * FROM products ORDER BY id'))
  await assert.rejects(()=>adapter.batch([{sql:'UPDATE products SET name=\'changed\' WHERE id=10'},{sql:'UPDATE products SET cost_review_key=NULL WHERE id=10'}]),/product_cost_review_write_refused/)
  assert.equal(JSON.stringify(rows('SELECT * FROM products ORDER BY id')),before)
  console.log('PASS protected marker refusal rolls back preceding writes in the same native batch')
  const entries=one('SELECT COUNT(*) n FROM product_cost_entries').n
  seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(900,10,'known',1,5.1234,1)"))
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,null)
  assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=10').value,5.1234)
  assert.equal(one('SELECT COUNT(*) n FROM product_cost_entries').n,entries)
  console.log('PASS valid same-cost recorded lot clears only marker without inserting manual baseline or changing money')
  seedFixture(state.native.db, () => state.native.db.exec('DELETE FROM product_batches WHERE id=900'))
  const next=review.mergeCostOutcome(10,{usd:5.1234,khr:20500})
  await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(next,{id:1,name:'Fixture'}), 'retry')
  await assert.rejects(()=>oldWriter.updateRow(env,'products',10,{cost_review_key:outcome.reviewKey}),/product_cost_review_write_refused/)
  seedFixture(state.native.db, () => state.native.db.exec('DELETE FROM branch_stock WHERE product_id=10;UPDATE products SET stock_quantity=0 WHERE id=10;DELETE FROM products WHERE id=10;INSERT INTO products(id,name,cost_price_usd) VALUES(10,\'Fresh same number\',5.1234)'))
  await assert.rejects(()=>oldWriter.updateRow(env,'products',10,{cost_review_key:next.reviewKey}),/product_cost_review_write_refused/)
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,null)
  console.log('PASS old receipt cannot install stale marker or inherit authority after delete/reinsert same numeric ID')
  oldWriter.PRODUCT_SKIP_KEYS.add('cost_review_key')
  await oldWriter.updateRow(env,'products',10,{name:'Allowed name',cost_review_key:next.reviewKey})
  assert.equal(one('SELECT name FROM products WHERE id=10').name,'Allowed name')
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,null)
  console.log('PASS current generic writer ignores internal marker echo while preserving unrelated edits')
 }finally{state.native.db.close()}
 fresh()
 try{
  const review=real('productCostReview')
  seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(900,10,'unknown',1,NULL,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3);INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(10,5,'manual',900)"))
  const outcome=review.mergeCostOutcome(10,{usd:5,khr:20500})
  await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(outcome,{id:1,name:'Fixture'}), 'retry')
  assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=10').value,5)
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,outcome.reviewKey)
  await adapter.batch([catalogCost.catalogCostRecomputeIfChangedStatement(10)])
  seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(901,10,'free',1,0,1)"))
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,outcome.reviewKey)
  console.log('PASS positive manual-only derivation over unknown lot and free-only receipt do not certify recorded lot evidence or clear review')
  seedFixture(state.native.db, () => state.native.db.exec('UPDATE product_batches SET unit_cost_usd=5 WHERE id=901'))
  assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,null)
  console.log('PASS real lot cost becoming known clears review at unchanged derived value')
 }finally{state.native.db.close()}
 for(const recursive of [0,1]){
  fresh()
  try{
   state.native.db.exec('PRAGMA recursive_triggers='+recursive)
   const review=real('productCostReview'),outcome=review.mergeCostOutcome(10,{usd:5.1234,khr:null})
   await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(outcome,{id:1,name:'Fixture'}), 'retry')
   assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,outcome.reviewKey)
   assert.throws(()=>state.native.db.exec('UPDATE products SET cost_review_key=NULL WHERE id=10'),/product_cost_review_write_refused/)
   seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(900,10,'recursion',1,5.1234,1)"))
   assert.equal(one('SELECT cost_review_key value FROM products WHERE id=10').value,null)
   assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=10').value,5.1234)
   console.log('PASS review admission/refusal and same-value valid-lot clearing with recursive_triggers='+recursive)
  }finally{state.native.db.close()}
 }
}
async function mergeCases(){
 fresh()
 try{
  seedFixture(state.native.db, () => state.native.db.exec('UPDATE products SET cost_price_usd=5.1234 WHERE id=10;UPDATE products SET cost_price_usd=9 WHERE id=11'))
  const done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
  assert.equal(done.status,200,JSON.stringify(done.body))
  const actual=one('SELECT cost_price_usd,cost_price_khr FROM products WHERE id=10')
  console.log('MERGE_OUTCOME '+JSON.stringify(actual))
  assert.equal(actual.cost_price_usd,5.1234)
  assert.equal(actual.cost_price_khr,20500)
  assert.match(one('SELECT cost_review_key value FROM products WHERE id=10').value,/^[a-f0-9]{32}$/)
  console.log('PASS actual no-lot merge retains original keeper canonical currencies and assigns review identity')
 }finally{state.native.db.close()}
 for(const usd of [null,0,5.123456]){
  fresh()
  try{
   seedFixture(state.native.db, () => state.native.db.prepare('UPDATE products SET cost_price_usd=?,purchase_price_usd=99,cost_price_khr=NULL,purchase_price_khr=999 WHERE id=10').run(usd))
   seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(12,'Rose Toner 100ml','8803333333333',19,1)"))
   const seen=await preview(10,11,'&groupIds=10,11,12')
   assert.equal(seen.status,200,JSON.stringify(seen.body))
   const resolve={requestId:'authority-'+String(usd).replace('.','_'),reviewedDigest:seen.body.reviewedDigest,steps:[{mergeId:11,stock:'merge'},{mergeId:12}]}
   for(const mergeId of [11,12]){
    const body={keepId:10,mergeId,keep:true,...(mergeId===11?{stock:'merge'}:{}),resolve}
    const done=await merge(body)
    assert.equal(done.status,200,JSON.stringify(done.body))
    assert.deepEqual(one('SELECT cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr FROM products WHERE id=10'),{cost_price_usd:usd,cost_price_khr:null,purchase_price_usd:usd,purchase_price_khr:null})
    const audit=JSON.parse(one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='10' ORDER BY id DESC LIMIT 1").details).cost_review
    assert.equal(audit.after_usd,usd);assert.equal(audit.after_khr,null);assert.equal(audit.fallback_usd,usd)
    const before=JSON.stringify(rows('SELECT * FROM audit_logs ORDER BY id'))
    const retry=await merge(body)
    assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.replayed,true)
    assert.equal(JSON.stringify(rows('SELECT * FROM audit_logs ORDER BY id')),before)
   }
   console.log('PASS actual three-product continuation and receipted retry retain original canonical '+String(usd)+' over stale purchase mirrors and preserve exact audit values')
  }finally{state.native.db.close()}
 }
 fresh()
 try{
  seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(900,10,'keeper-known',1,5.1234,3),(901,11,'discarded-known',1,9.1234,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,3),(901,1,1)"))
  const entries=one('SELECT COUNT(*) n FROM product_cost_entries').n
  const done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
  assert.equal(done.status,200,JSON.stringify(done.body))
  assert.deepEqual(one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=10'),{cost_price_usd:6.1234,cost_price_khr:20500,cost_review_key:null})
  const audit=JSON.parse(one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='10' ORDER BY id DESC LIMIT 1").details).cost_review
  assert.equal(audit.after_usd,6.1234);assert.equal(audit.after_khr,20500);assert.equal(audit.after_key,null);assert.equal(audit.recorded_lot,1)
  assert.equal(one('SELECT COUNT(*) n FROM product_cost_entries').n,entries)
  const snapshot=JSON.parse(one('SELECT payload_json FROM undo_snapshots ORDER BY id DESC LIMIT 1').payload_json)
  const fingerprint=JSON.parse(snapshot.mergedStateFingerprint).products.find(row=>row.id===10)
  assert.equal(snapshot.fingerprintPending,false)
  assert.equal(fingerprint.cost_price_usd,6.1234);assert.equal(fingerprint.cost_price_khr,20500);assert.equal(fingerprint.cost_review_key,null)
  console.log('PASS actual positive-lot merge uses authoritative weighted value with matching final audit and no artificial manual cost entry')
 }finally{state.native.db.close()}
 for(const quantity of [null,0,3]){
  for(const manual of [7,0,7.123456789012345,-1,'malformed']){
   for(const fallback of [5,null]){
    fresh()
    try{
     seedFixture(state.native.db, () => state.native.db.prepare('UPDATE products SET cost_price_usd=?,purchase_price_usd=99 WHERE id=10').run(fallback))
     seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity) VALUES(900,10,'unknown-manual',1,NULL,3)"))
     seedFixture(state.native.db, () => state.native.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,?)').run(quantity??0))
     seedFixture(state.native.db, () => state.native.db.exec("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(10,9,'manual',900)"))
     seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(10,?,'manual',900)").run(manual))
     if(quantity===null)seedFixture(state.native.db, () => state.native.db.exec('DELETE FROM branch_batch_stock WHERE batch_id=900;DELETE FROM product_batches WHERE id=900'))
     const before=rows('SELECT * FROM product_cost_entries ORDER BY id'),done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
     assert.equal(done.status,200,JSON.stringify(done.body))
     const expected=typeof manual==='number'&&manual>=0?manual:fallback
     const stored=one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=10')
     assert.equal(stored.cost_price_usd,expected);assert.equal(stored.cost_price_khr,20500);assert.match(stored.cost_review_key,/^[a-f0-9]{32}$/)
     assert.deepEqual(rows('SELECT * FROM product_cost_entries ORDER BY id'),before)
     const event=JSON.parse(one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='10' ORDER BY id DESC LIMIT 1").details).cost_review
     assert.equal(event.fallback_usd,fallback);assert.equal(event.after_usd,expected);assert.equal(event.recorded_lot,0);assert.equal(event.after_key,stored.cost_review_key)
     console.log('PASS no-eligible-lot latest manual '+JSON.stringify(manual)+' with fallback '+JSON.stringify(fallback)+' and '+(quantity===null?'no lots':quantity===0?'soldout baseline':'onhand unknown baseline')+' preserves raw cost, review and original history')
    }finally{state.native.db.close()}
   }
  }
 }
 for(const manual of [0,-1,'malformed']){
  fresh()
  try{
   seedFixture(state.native.db, () => state.native.db.exec("UPDATE products SET cost_price_usd=5 WHERE id=10;INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(10,9,'manual',0)"))
   seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(10,?,'manual',0)").run(manual))
   const before=rows('SELECT * FROM product_cost_entries ORDER BY id'),done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
   assert.equal(done.status,200,JSON.stringify(done.body))
   const stored=one('SELECT cost_price_usd,cost_review_key FROM products WHERE id=10')
   assert.equal(stored.cost_price_usd,manual===0?0:5);assert.match(stored.cost_review_key,/^[a-f0-9]{32}$/)
   assert.deepEqual(rows('SELECT * FROM product_cost_entries ORDER BY id'),before)
   const event=JSON.parse(one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='10' ORDER BY id DESC LIMIT 1").details).cost_review
   assert.equal(event.after_usd,stored.cost_price_usd)
   console.log('PASS latest saved manual '+JSON.stringify(manual)+' is validated without selecting an older entry or rewriting history')
  }finally{state.native.db.close()}
 }
 fresh()
 try{
  state.tier='free'
  const snapshot=()=>JSON.stringify(['products','audit_logs','action_history','product_cost_entries'].map(table=>rows('SELECT * FROM '+table+' ORDER BY rowid')))
  const before=snapshot(),done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
  assert.equal(done.status,409,JSON.stringify(done.body));assert.equal(done.body.code,'resolve_plan_budget');assert.equal(snapshot(),before)
  assert.ok(done.queries+20<=50)
  console.log('PASS actual Free merge refuses before business writes; measured route statements='+done.queries+' plus reserved20 auth overhead')
 }finally{state.native.db.close()}
}
async function forwardRetryCases(){
 for(const race of [false,true]){
  fresh()
  const originalBatch=adapter.batch
  let changed=false
  try{
   adapter.batch=async statements=>{
    const result=await originalBatch(statements)
    if(race&&!changed&&statements.some(statement=>statement.sql.includes('INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)'))){
     changed=true
     seedFixture(state.native.db, () => state.native.db.exec('UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=10'))
    }
    return result
   }
   const done=await merge({keepId:10,mergeId:11,keep:true,stock:'merge'})
   assert.equal(done.status,200,JSON.stringify(done.body))
   const saved=one("SELECT * FROM undo_snapshots WHERE kind='product.merge' ORDER BY id DESC LIMIT 1"),reversal=JSON.parse(saved.payload_json)
   assert.equal(reversal.costReviewState.generation,0);assert.equal(reversal.costReviewState.direction,'apply')
   const stock=rows('SELECT * FROM branch_stock ORDER BY id'),events=rows("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
   const retried=await undoAppliers.finalizeAtomicMergeHistory({DB:{}},reversal.operationId,reversal,adapter)
   assert.equal(retried.fingerprintReady,!race)
   assert.equal(one('SELECT payload_json FROM undo_snapshots WHERE id=?',saved.id).payload_json,saved.payload_json)
   assert.deepEqual(rows('SELECT * FROM branch_stock ORDER BY id'),stock);assert.deepEqual(rows("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),events)
   assert.equal(one("SELECT status FROM action_history WHERE entity_id='11' ORDER BY id DESC LIMIT 1").status,race?'recorded':'undoable')
   if(!race){
    for(const invalid of ['missing','version']){
     const altered=JSON.parse(saved.payload_json)
     if(invalid==='missing')delete altered.costReviewState
     else altered.costReviewState.graph_version=1
     const invalidJson=JSON.stringify(altered)
     state.native.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(invalidJson,saved.id)
     const refused=await undoAppliers.finalizeAtomicMergeHistory({DB:{}},reversal.operationId,altered,adapter)
     assert.equal(refused.fingerprintReady,false);assert.equal(one('SELECT payload_json FROM undo_snapshots WHERE id=?',saved.id).payload_json,invalidJson)
     assert.deepEqual(rows("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),events)
    }
    state.native.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').run(saved.payload_json,saved.id)
   }
   console.log('PASS actual shared initial finalizer retry '+(race?'preserves original receipt and concurrent stock edit':'recognizes intact committed ready receipt')+' without a replacement baseline')
  }finally{adapter.batch=originalBatch;state.native.db.close()}
 }
}
async function backupCases(){
 fresh()
 try{
  state.native.db.exec('DELETE FROM fees')
  const review=real('productCostReview'),backup=real('backup')
  await real('stockTransaction').executeStockTransaction(adapter, review.mergeCostReviewStatements(review.mergeCostOutcome(10,{usd:5,khr:20500}),{id:1,name:'Fixture'}), 'retry')
  const tables=backup.BACKUP_TABLES.filter(table=>one("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table))
  const doc={format:'business-os-cloudflare-backup',formatVersion:1,tables:Object.fromEntries(tables.map(table=>[table,{columns:rows('PRAGMA table_info("'+table+'")').map(row=>row.name),rows:rows('SELECT * FROM "'+table+'"')}]))}
  const before=JSON.stringify(tables.map(table=>[table,rows('SELECT * FROM "'+table+'" ORDER BY rowid')]))
  let text=JSON.stringify(doc)
  const env={DB:binding(),ASSETS:{async get(key){return {key,etag:'fixed-source',version:'fixture',size:Buffer.byteLength(text),body:new Blob([text]).stream()}}}}
  seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({mode:'restore',token:'review-fixture',backupKey:'fixture.json',startedAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',startedBy:'fixture',phase:'deleting'})))
  let error
  try{await backup.restoreCloudflareBackup(env,'fixture.json',undefined,'review-fixture')}catch(failure){error=failure}
  console.log('BACKUP_PROBE '+JSON.stringify({error:error?.message??null,businessChanged:JSON.stringify(tables.map(table=>[table,rows('SELECT * FROM "'+table+'" ORDER BY rowid')]))!==before}))
  assert.match(error?.message??'',/merge cost review.*validated restore/i)
  assert.equal(JSON.stringify(tables.map(table=>[table,rows('SELECT * FROM "'+table+'" ORDER BY rowid')])),before)
  console.log('PASS protected review snapshot refuses before DELETE and preserves complete synthetic business snapshot')
  doc.tables.products.rows.forEach(row=>{row.cost_review_key=null})
  doc.tables.audit_logs.rows=doc.tables.audit_logs.rows.filter(row=>!JSON.parse(row.details||'{}').cost_review)
  text=JSON.stringify(doc)
  await assert.rejects(()=>backup.restoreCloudflareBackup(env,'fixture.json',undefined,'review-fixture'),/merge cost review.*validated restore/i)
  assert.equal(JSON.stringify(tables.map(table=>[table,rows('SELECT * FROM "'+table+'" ORDER BY rowid')])),before)
  console.log('PASS unflagged older snapshot cannot erase live review marker or its admitted history before DELETE')
 }finally{state.native.db.close()}
 fresh();state.native.db.close()
 state.native=require('./harness/d1compat.cjs').openDb(require('./harness/load_migrations.cjs').loadAll({through:254}))
 try{
  seedFixture(state.native.db, () => state.native.db.exec("DELETE FROM fees;INSERT INTO products(id,name,cost_price_usd) VALUES(10,'Legacy fixture',5.1234)"))
  assert.equal(rows('PRAGMA table_info(products)').some(row=>row.name==='cost_review_key'),false)
  const backup=real('backup'),tables=backup.BACKUP_TABLES.filter(table=>one("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table))
  const doc={format:'business-os-cloudflare-backup',formatVersion:1,tables:Object.fromEntries(tables.map(table=>[table,{columns:rows('PRAGMA table_info("'+table+'")').map(row=>row.name),rows:rows('SELECT * FROM "'+table+'"')}]))}
  const text=JSON.stringify(doc),env={DB:binding(),ASSETS:{async get(key){return key===backup.CLOUDFLARE_BACKUP_PREFIX+'legacy.json'?{key,etag:'legacy-source',version:'fixture',size:Buffer.byteLength(text),body:new Blob([text]).stream()}:null}}}
  seedFixture(state.native.db, () => state.native.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({mode:'restore',token:'review-fixture',backupKey:'legacy.json',startedAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',startedBy:'fixture',phase:'deleting'})))
  await backup.restoreCloudflareBackup(env,'legacy.json',undefined,'review-fixture')
  assert.equal(one('SELECT cost_price_usd value FROM products WHERE id=10').value,5.1234)
  console.log('PASS actual full small unflagged restore on pre0255 live schema does not reference the absent review column')
 }finally{state.native.db.close()}
}
async function main(){if(process.argv.includes('--forward-retry'))await forwardRetryCases();else if(process.argv.includes('--storage'))await storageCases();else if(process.argv.includes('--backup'))await backupCases();else {await storageCases();await mergeCases();await forwardRetryCases();await backupCases()}}
main().catch(error=>{console.error(error);process.exitCode=1})
