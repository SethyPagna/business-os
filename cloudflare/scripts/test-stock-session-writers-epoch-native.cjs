const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = path.join(__dirname, 'test-stock-session-atomic.cjs')
let source = fs.readFileSync(original, 'utf8')
source = source.replace("if (name.endsWith('/productStockGuard')) return productStockGuard", '')
source = source.replace("name.endsWith('.sql')).sort()", "name.endsWith('.sql') && Number(name.slice(0,4)) < 243).sort()")
source = source.replace('  let failAfterMetadata = false', `  sql.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1); INSERT INTO products(id,name,stock_quantity,is_active) VALUES(2,'Missing coverage',7,1)")
  sql.exec(fs.readFileSync(path.join(root,'migrations','0243_stock_schema_epoch.sql'),'utf8'))
  let failAfterMetadata = false`)
source = source.replace('mutate(sql)\n      }\n      const result = runBatch', 'await mutate(sql)\n      }\n      const result = runBatch')
const harness = new Module(original, module)
harness.filename = original
harness.paths = module.paths
harness._compile(source, original)
const {fixture,loadStockSession,user,receiveRequest} = harness.exports
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
 console.log(JSON.stringify({sessionLostAckAttempts:created.attempted,undoLostAckAttempts:undone.attempted,redoAttempts:redone.attempted,overheadPerCommit:2}))
 console.log('stock session writers full-0243 native: PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
