const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = path.join(__dirname, 'test-stock-session-atomic.cjs')
let source = fs.readFileSync(original, 'utf8').replaceAll('\r\n','\n')
source = source.replace("if (name.endsWith('/productStockGuard')) return productStockGuard", '')
source = source.replace("['routes/inventory.ts', 'routes/actionHistory.ts', 'routes/batches.ts']", "['routes/inventory.ts', 'routes/actionHistory.ts', 'routes/batches.ts', 'routes/branches.ts']")
source = source.replace("if (name === './cache' || name === '../lib/cache')", "if ((name === './cache' || name === '../lib/cache') && normalized !== 'routes/branches.ts')")
source = source.replace('    let result\n    try { result = sqliteD1Call', `    if (sql.prepare(statement.text).reader) return {results:sqliteD1Call(sql.prepare(statement.text),'all',statement.params),meta:{changes:0}}\n    let result\n    try { result = sqliteD1Call`)
const harness = new Module(original, module)
harness.filename = original
harness.paths = module.paths
harness._compile(source, original)
const {fixture: baseFixture,loadStockSession,user,receiveRequest} = harness.exports
const fixture = () => baseFixture(sql => sql.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1); INSERT INTO products(id,name,stock_quantity,is_active) VALUES(2,'Missing coverage',7,1)"))
let attempted=0
const hook={d1Start(n){attempted+=n},d1Call(){}}
globalThis[Symbol.for('business-os.request-metrics.v1')]=hook
const count=async(fn)=>{attempted=0;const result=await fn();return {result,attempted}}
const epoch=(f,value)=>f.sql.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(value)
const zero=f=>assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
async function main(){
 const f=fixture(),k=loadStockSession()
 const before=f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n
 assert.throws(()=>f.sql.exec('UPDATE products SET stock_quantity=1 WHERE id=1'),/stock_transaction_required/)
 epoch(f,'old-writer')
 await assert.rejects(()=>k.commitStockSession(f.env,user,receiveRequest('wrong-epoch-session')),e=>e.code==='stock_schema_unavailable')
 assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,before);zero(f)
 epoch(f,'legacy-separate-pool-v1')
 f.failReceiptAfterMetadata()
 await assert.rejects(()=>k.commitStockSession(f.env,user,receiveRequest('rollback-session')),/injected failure/)
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM product_batches').get().n,0);zero(f)
 f.loseNextCommitAcknowledgement()
 const created=await count(()=>k.commitStockSession(f.env,user,receiveRequest('lost-session-ack')))
 assert.equal(created.result.replayed,true);assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5);zero(f)
 const receipt=created.result,history=f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(receipt.actionHistoryId)
 epoch(f,'old-writer')
 await assert.rejects(()=>k.replayStockSession(f.env,user,'undo',receipt.actionHistoryId,0,JSON.parse(history.undo_payload)),e=>e.code==='stock_schema_unavailable');zero(f)
 epoch(f,'legacy-separate-pool-v1');f.loseNextCommitAcknowledgement()
 const undone=await count(()=>k.replayStockSession(f.env,user,'undo',receipt.actionHistoryId,0,JSON.parse(history.undo_payload)))
 assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,0);zero(f)
 const state=f.sql.prepare('SELECT generation n FROM stock_session_operations WHERE id=?').get(receipt.operationId).n
 assert.equal(state,1)
 const redo=JSON.parse(history.redo_payload)
 const redone=await count(()=>k.replayStockSession(f.env,user,'redo',receipt.actionHistoryId,1,redo))
 assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5);zero(f)
 const race=fixture(),rk=loadStockSession();race.beforeCommit(()=>loadStockSession('lib/maintenance.ts').beginMaintenance(race.env,{backupKey:'backups/cloudflare/race.json',startedBy:'admin'}))
 await assert.rejects(()=>rk.commitStockSession(race.env,user,receiveRequest('maintenance-race')),e=>e.code==='stock_schema_unavailable')
 assert.equal(race.sql.prepare('SELECT COUNT(*) n FROM product_batches').get().n,0);zero(race)
 const bounds=fixture();bounds.env.PLAN_TIER='free'
 await assert.rejects(()=>loadStockSession().commitStockSession(bounds.env,user,receiveRequest('overhead-admission'),null,{statementsUsed:()=>30,reserveStatements:0}),e=>e.code==='stock_session_query_budget_exceeded')
 assert.equal(bounds.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,0);zero(bounds)
 const startup=fixture(),core=loadStockSession('lib/coreDataInvariants.ts')
 startup.env.BUSINESS_OS_ADMIN_PASSWORD='synthetic-native-password'
 const held=await loadStockSession('lib/maintenance.ts').beginMaintenance(startup.env,{backupKey:'backups/cloudflare/core.json',startedBy:'admin'})
 await core.ensureCoreDataInvariants(startup.env)
 assert.equal(startup.sql.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=2').get().n,0);zero(startup)
 await loadStockSession('lib/maintenance.ts').endMaintenance(startup.env,held.token)
 epoch(startup,'old-writer');await core.ensureCoreDataInvariants(startup.env)
 assert.equal(startup.sql.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=2').get().n,0)
 epoch(startup,'legacy-separate-pool-v1')
 const seeded=await count(()=>core.ensureCoreDataInvariants(startup.env));assert.equal(startup.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=2').get().n,7);zero(startup)
 const rev=fixture(),revKernel=loadStockSession('lib/stockRevert.ts'),{D1Compat}=loadStockSession('lib/db.ts')
 rev.sql.exec("INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason)VALUES(1,'Serum',1,'Shop','remove',2,'native standalone')")
 const movement=rev.sql.prepare('SELECT * FROM inventory_movements').get()
 epoch(rev,'old-writer')
 await assert.rejects(()=>revKernel.applyMovementRevert(new D1Compat(rev.env.DB),movement,{userId:7,userName:'Stock User'}),e=>e.code==='stock_schema_unavailable');zero(rev)
 epoch(rev,'legacy-separate-pool-v1');rev.loseNextCommitAcknowledgement()
 const reverted=await count(()=>revKernel.applyMovementRevert(new D1Compat(rev.env.DB),movement,{userId:7,userName:'Stock User'}))
 assert.equal(rev.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,2);zero(rev)
 const bf=fixture(),admin={...user,permissions:JSON.stringify({all:true,branches:true})}
 await loadStockSession().commitStockSession(bf.env,user,receiveRequest('branch-fixture-stock'))
 bf.env.CACHE={get:async()=>null,put:async()=>{},delete:async()=>{}}
 const branches=loadStockSession('routes/branches.ts',admin).default
 globalThis[Symbol.for('business-os.request-metrics.v1')]=hook
 const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
 branches.onError((e,c)=>c.json({code:e.code,error:e.message},409))
 const transfer=async id=>{const response=await branches.request('/transfer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:1,fromBranchId:1,toBranchId:2,quantity:2,reason:'native transfer',client_request_id:id,transfer_provenance_version:1})},bf.env,ctx);await Promise.all(tasks.splice(0));return {status:response.status,body:await response.json()}}
 epoch(bf,'old-writer');assert.equal((await transfer('old-branch-transfer')).body.code,'stock_schema_unavailable');zero(bf)
 epoch(bf,'legacy-separate-pool-v1')
 const forwarded=await count(()=>transfer('current-branch-transfer'));assert.equal(forwarded.result.status,200,JSON.stringify(forwarded.result));assert.equal(bf.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=1 AND branch_id=2').get().n,2);zero(bf)
 bf.loseNextCommitAcknowledgement()
 const branchLost=await count(()=>transfer('lost-branch-transfer'))
 assert.equal(branchLost.result.status,200,JSON.stringify(branchLost.result));assert.equal(branchLost.result.body.replayed,true)
 assert.equal(bf.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=1 AND branch_id=2').get().n,4);zero(bf)
 const bulk=async id=>{const response=await branches.request('/transfer-bulk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fromBranchId:1,toBranchId:2,items:[{productId:1,quantity:1}],reason:'native bulk transfer',client_request_id:id,transfer_provenance_version:1})},bf.env,ctx);await Promise.all(tasks.splice(0));return {status:response.status,body:await response.json()}}
 bf.failWhenSqlMatches(/INSERT INTO branch_stock/)
 assert.equal((await bulk('rollback-bulk-transfer')).status,409)
 assert.equal(bf.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=1 AND branch_id=2').get().n,4);zero(bf)
 epoch(bf,'old-writer');assert.equal((await bulk('old-bulk-transfer')).body.code,'stock_schema_unavailable')
 epoch(bf,'legacy-separate-pool-v1')
 const bulked=await count(()=>bulk('current-bulk-transfer'));assert.equal(bulked.result.status,200,JSON.stringify(bulked.result))
 assert.equal(bf.sql.prepare('SELECT quantity n FROM branch_stock WHERE product_id=1 AND branch_id=2').get().n,5);zero(bf)
 epoch(bf,'old-writer');bf.sql.prepare('UPDATE products SET name=? WHERE id=1').run('Metadata remains available')
 assert.equal(bf.sql.prepare('SELECT name FROM products WHERE id=1').get().name,'Metadata remains available');zero(bf)
 const unknown=fixture(),unknownDb=unknown.env.DB
 unknown.env.DB={prepare:sql=>unknownDb.prepare(sql),batch:async()=>[]}
 await assert.rejects(()=>loadStockSession().commitStockSession(unknown.env,user,receiveRequest('unconfirmed-empty-result')),e=>e.code==='stock_transaction_outcome_unknown');zero(unknown)
 console.log(JSON.stringify({branchLostAckAttempts:branchLost.attempted,branchBulkAttempts:bulked.attempted}))
 console.log(JSON.stringify({startupAttempts:seeded.attempted,revertLostAckAttempts:reverted.attempted,branchForwardAttempts:forwarded.attempted}))
 console.log(JSON.stringify({sessionLostAckAttempts:created.attempted,undoLostAckAttempts:undone.attempted,redoAttempts:redone.attempted,overheadPerCommit:2}))
 console.log('stock session writers full-0243 native: PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
