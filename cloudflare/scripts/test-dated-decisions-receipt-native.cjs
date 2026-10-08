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
  const empty=await apply('dated_empty_001',[]);assert.equal(empty.complete,true)
  f.sql.exec("UPDATE dated_count_decision_receipts SET invalidated_at=CURRENT_TIMESTAMP WHERE request_id='dated_lost_ack_001'")
  await assert.rejects(apply('dated_lost_ack_001',[row('Current lost acknowledgement')]),e=>e.code==='dated_decision_reset_conflict')
  assert.equal(f.permits(),0)
  console.log('PASS current once receipt lostACK/replay/concurrency/rollback/invalid-ID/changed-intent/reset controls')
}
oldLostAcknowledgementControl().then(currentControls).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => f.sql.close())
