const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const f = require('./test-stock-bridge-core-native.cjs')
const oldSource = execFileSync('git', ['show', 'df1f7a3090c432a8bb9145161dcdf448526fa57b:cloudflare/src/lib/datedStockCountDecisions.ts'], { encoding: 'utf8' })
async function oldLostAcknowledgementControl() {
  const old = f.load('lib/datedStockCountDecisions.ts', oldSource)
  const name = 'Frozen dated lost acknowledgement'
  const rows = [{ rowNumber: 1, branchId: 1, reason: 'product_not_found', suggestedActions: ['create_new'], raw: { rowNumber: 1, date: '2026-10-09', branchName: 'Shop', productName: name, count: 1 } }]
  f.loseNextAcknowledgement()
  await old.applyDatedStockCountDecisions(f.db, [], rows, [{ rowNumber: 1, action: 'create_new' }])
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM products WHERE name=?').get(name).n, 2)
  assert.equal(f.permits(), 0)
  console.log('PASS frozen df1f lost acknowledgement creates two products under actual0243')
}
async function currentControls() {
  f.sql.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'../migrations/0244_dated_count_decision_receipts.sql'),'utf8'))
  const current=f.load('lib/datedStockCountDecisions.ts')
  const row=(name,number=1)=>({rowNumber:number,branchId:1,reason:'product_not_found',suggestedActions:['create_new'],raw:{rowNumber:number,date:'2026-10-09',branchName:'Shop',productName:name,count:1}})
  const apply=(id,rows,decisions=rows.map(r=>({rowNumber:r.rowNumber,action:'create_new'})),resolved=[])=>{
    let used=0
    return current.applyDatedStockCountDecisions(f.db,resolved,rows,decisions,{actorId:7,actorName:'admin',requestId:id,owner:{version:1,actor_id:7,organization_id:null,authority:'http://localhost',runtime:'cloudflare-workers'},budget:{limit:50,used:()=>used,charge:n=>{used+=n}}})
  }
  for(const id of [undefined,'x',123456789]) await assert.rejects(apply(id,[row('Invalid')]),e=>e.code==='invalid_client_request_id')
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE name='Invalid'").get().n,0)
  f.loseNextAcknowledgement()
  const saved=await apply('dated_lost_ack_001',[row('Current lost acknowledgement')])
  assert.equal(saved.complete,true);assert.equal(saved.productsCreated.length,1);assert.ok(saved.productsCreated[0].productId>0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE name='Current lost acknowledgement'").get().n,1)
  const productId=saved.productsCreated[0].productId
  f.sql.prepare('UPDATE products SET selling_price_usd=77 WHERE id=?').run(productId)
  const replay=await apply('dated_lost_ack_001',[row('Current lost acknowledgement')])
  assert.equal(replay.replayed,true);assert.deepEqual(replay.productsCreated,saved.productsCreated);assert.equal(f.sql.prepare('SELECT selling_price_usd p FROM products WHERE id=?').get(productId).p,77)
  await assert.rejects(apply('dated_lost_ack_001',[row('Changed payload')]),e=>e.code==='dated_decision_request_conflict')
  const rows=[row('Concurrent',2)]
  const concurrent=await Promise.all([apply('dated_concurrent_001',rows),apply('dated_concurrent_001',rows)])
  assert.equal(concurrent[0].productsCreated[0].productId,concurrent[1].productsCreated[0].productId)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE name='Concurrent'").get().n,1)
  f.failSql(/INSERT INTO audit_logs/)
  await assert.rejects(apply('dated_rollback_001',[row('Rollback')]),/fixture transaction failure/)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE name='Rollback'").get().n,0)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dated_count_decision_receipts WHERE request_id='dated_rollback_001'").get().n,0)

  const selected=[{rowNumber:9,date:'2026-10-09',productId:1001,branchId:1,count:1,priceConflict:{currentUsd:0,currentKhr:0,importedUsd:12,importedKhr:48000,suggestedResolution:'apply_new'}}]
  await apply('dated_price_001',[],[{rowNumber:9,action:'skip',priceResolution:'apply_new'}],selected)
  assert.equal(f.sql.prepare('SELECT selling_price_usd p FROM products WHERE id=1001').get().p,12)
  f.sql.exec('UPDATE products SET selling_price_usd=35 WHERE id=1001')
  await apply('dated_price_001',[],[{rowNumber:9,action:'skip',priceResolution:'apply_new'}],selected)
  assert.equal(f.sql.prepare('SELECT selling_price_usd p FROM products WHERE id=1001').get().p,35)
  for(const mode of ['future','missing','maintenance']) {
    if(mode==='future') f.sql.exec("UPDATE system_flags SET value='future' WHERE key='stock_schema_epoch'")
    if(mode==='missing') f.sql.exec("DELETE FROM system_flags WHERE key='stock_schema_epoch'")
    if(mode==='maintenance') await f.load('lib/stockTransaction.ts').executeStockTransaction(f.db,[{sql:"INSERT INTO system_flags(key,value) VALUES('maintenance','{}')"}],'once')
    await assert.rejects(apply('dated_refused_'+mode,[row('Refused '+mode)]),e=>e.code==='stock_schema_unavailable')
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM products WHERE name=?').get('Refused '+mode).n,0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dated_count_decision_receipts WHERE request_id=?').get('dated_refused_'+mode).n,0)
    await apply('dated_metadata_'+mode,[],[{rowNumber:9,action:'skip',priceResolution:'apply_new'}],selected)
    f.sql.exec("DELETE FROM system_flags WHERE key IN('stock_schema_epoch','maintenance')")
    f.sql.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").run(f.load('lib/stockTransaction.ts').STOCK_SCHEMA_EPOCH)
  }
  f.sql.exec("CREATE TRIGGER fail_second_dated_identity BEFORE INSERT ON products WHEN NEW.name='Second failure' BEGIN SELECT RAISE(ABORT,'forced second identity'); END")
  const partialRows=[row('First committed',20),row('Second failure',21)]
  await assert.rejects(apply('dated_partial_001',partialRows),/forced second identity/)
  const partial=f.sql.prepare("SELECT next_index,result_json FROM dated_count_decision_receipts WHERE request_id='dated_partial_001'").get()
  assert.equal(partial.next_index,1);const firstId=JSON.parse(partial.result_json).productsCreated[0].productId;assert.ok(firstId>0)
  f.sql.exec('DROP TRIGGER fail_second_dated_identity')
  const resumed=await apply('dated_partial_001',partialRows);assert.equal(resumed.complete,true);assert.equal(resumed.productsCreated[0].productId,firstId);assert.equal(resumed.productsCreated.length,2)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE name='First committed'").get().n,1)
  const audit=f.sql.prepare("SELECT details FROM audit_logs WHERE action='dated_stock_count_decisions_applied' AND json_extract(details,'$.requestId')='dated_lost_ack_001'").get()
  assert.equal(JSON.parse(audit.details).rows.productsCreated[0].productId,productId)
  const empty=await apply('dated_empty_001',[]);assert.equal(empty.complete,true)
  f.sql.exec("UPDATE dated_count_decision_receipts SET invalidated_at=CURRENT_TIMESTAMP WHERE request_id='dated_lost_ack_001'")
  await assert.rejects(apply('dated_lost_ack_001',[row('Current lost acknowledgement')]),e=>e.code==='dated_decision_reset_conflict')
  assert.equal(f.permits(),0)
  console.log('PASS current once receipt lostACK/replay/concurrency/rollback/invalid-ID/changed-intent/reset controls')
}

async function actualIndexControls() {
  const fs=require('node:fs'),path=require('node:path')
  let source=fs.readFileSync(path.join(__dirname,'test-branch-transfer-request-budget-epoch-native.cjs'),'utf8').split('async function main(){')[0]
  source=source.replace("sql.exec(fs.readFileSync(path.join(root,'migrations','0243_stock_schema_epoch.sql'),'utf8'))", "sql.exec(fs.readFileSync(path.join(root,'migrations','0244_dated_count_decision_receipts.sql'),'utf8')); sql.exec(fs.readFileSync(path.join(root,'migrations','0243_stock_schema_epoch.sql'),'utf8'))")
  source=source.replace("const input={productId:1,fromBranchId:1,toBranchId:2,quantity:1,reason:'native full request',transfer_provenance_version:1,client_request_id:", "const input={client_request_id:")
  source=source.replace("'https://admin.business.test/api/branches/'+(bulk?'transfer-bulk':'transfer')", "'https://admin.business.test/api/inventory/dated-stock-count/resolve/apply-decisions'")
  const h=new Function('require','__dirname','module',source+'\nreturn {bundleWorker,world}')(require,__dirname,module)
  const makeWorker=await h.bundleWorker()
  const row=(name,index)=>({rowNumber:index,branchId:1,reason:'product_not_found',suggestedActions:['create_new'],raw:{rowNumber:index,date:'2026-10-09',branchName:'Shop',productName:name,count:1}})
  const body=(rows)=>({offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},resolved:[],unresolved:rows,decisions:rows.map(r=>({rowNumber:r.rowNumber,action:'create_new'}))})
  for(const tier of ['free','paid']) for(const options of [{},{staleAuth:true},{cacheFailure:true,tailRetries:true}]) {
    const w=await h.world(makeWorker,tier,options),cap=tier==='free'?50:1000
    const rows=[row('Full request '+tier+JSON.stringify(options),1)],intent=body(rows)
    w.loseNextCommitAcknowledgement()
    let saved=await w.call('dated-'+tier+JSON.stringify(options),intent)
    assert.ok(saved.physical<=cap)
    if(saved.status===503) { assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM dated_count_decision_receipts').get().n,0);saved=await w.call('dated-'+tier+JSON.stringify(options),intent) }
    assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.json.complete,true)
    assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM products WHERE name=?').get(rows[0].raw.productName).n,1)
    const id=saved.json.productsCreated[0].productId;w.sql.prepare('UPDATE products SET selling_price_usd=31 WHERE id=?').run(id)
    const replay=await w.call('dated-'+tier+JSON.stringify(options),intent)
    assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(replay.json.productsCreated[0].productId,id);assert.equal(w.sql.prepare('SELECT selling_price_usd p FROM products WHERE id=?').get(id).p,31);assert.ok(replay.physical<=cap)
    const changed=await w.call('dated-'+tier+JSON.stringify(options),body([row('Changed',1)]));assert.equal(changed.status,409)
    const noId=await w.call('dated-missing', {...intent,client_request_id:null});assert.equal(noId.status,400)
    const wrongOwner=await w.call('dated-owner', {...intent,offline_owner:{...intent.offline_owner,actor_id:8}});assert.equal(wrongOwner.status,409)
    assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
    w.sql.close()
  }
  const w=await h.world(makeWorker,'free'),intent=body(Array.from({length:12},(_,i)=>row('Progress '+i,i+1)))
  let next=0,completed=false,attempt=0
  while(!completed&&attempt++<15) {
    const result=await w.call('dated-large',intent);assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.physical<=50);assert.ok(result.json.next>next);next=result.json.next;completed=result.json.complete
  }
  assert.equal(completed,true);assert.equal(next,12);assert.equal(w.sql.prepare("SELECT COUNT(*) n FROM products WHERE name LIKE 'Progress %'").get().n,12)
  w.sql.close()
  console.log('PASS actual index/auth/core/maintenance full Free/Paid attempts and resumable Free progress')
}
oldLostAcknowledgementControl().then(currentControls).then(actualIndexControls).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => f.sql.close())
