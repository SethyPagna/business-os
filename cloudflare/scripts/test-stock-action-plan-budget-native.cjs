const fs = require('fs')
const path = require('path')
const assert = require('assert')
// Reuse the existing native fixture and its real action-kernel loader.
const fixturePath = path.join(__dirname, 'test-stock-action-apply-pure.cjs')
const fixture = fs.readFileSync(fixturePath, 'utf8').split('let failures = 0')[0].replace('const engineAbs =', `REAL.add('importMaintenanceFence'); REAL.add('permissions'); REAL.add('acquisitionCostAccess'); REAL.add('cache'); REAL.add('quotaGuard'); REAL.add('analytics');
STUBS['./db'].getImportFencedDb = env => loadReal('importMaintenanceFence').getImportFencedDb(env);
STUBS['./db'].isImportMaintenanceFenceError = e => loadReal('importMaintenanceFence').isImportMaintenanceFenceError(e);
const engineAbs =`)
const native = new Function('require', '__dirname', fixture + `
  REAL.add('importMaintenanceFence');
  return { makeDb, seedProduct, seedJob, applyStockActionsJob, runImportApply, loadReal, sw, APPLY_ACTOR, seedBatch, engine:engineMod.exports, transpile, makeRequire };
`)(require, __dirname)
const fence = native.loadReal('importMaintenanceFence')
const queuePath = path.join(__dirname,'..','src','queue.ts')
const queueModule = {exports:{}}
new Function('exports','require','module',native.transpile(queuePath))(queueModule.exports,request =>
  request === './lib/importEngine' ? native.engine : request === './lib/importMaintenanceFence' ? fence : native.makeRequire(path.dirname(queuePath))(request),queueModule)

async function measure(tier, units, shape = {}) {
  const {sqlite, db} = native.makeDb()
  sqlite.exec(`CREATE TABLE system_flags (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE import_job_row_signatures(job_id TEXT); CREATE TABLE quota_usage(resource TEXT,window_key TEXT,used INTEGER,updated_at TEXT,UNIQUE(resource,window_key)); CREATE TABLE cache_versions(namespace TEXT PRIMARY KEY,version INTEGER,updated_at TEXT); CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,name TEXT,permissions TEXT); CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,organization_id INTEGER,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT); INSERT INTO roles VALUES(1,'admin','Admin','{}'); INSERT INTO users VALUES(61,'admin','Administrator',1,1,'{}',1,NULL); ALTER TABLE import_jobs ADD COLUMN last_error TEXT;`)
  if (!shape.create) native.seedProduct(sqlite,{id:50,name:'Budget',barcode:'B50',shop:shape.sale?units:0})
  if(shape.sale) native.seedBatch(sqlite,{id:1,productId:50,key:'source',lot:'source',received:'2026-01-01',qty:units})
  const rows = Array.from({length:units},(_,i)=>({_rowNumber:i+2,name:'Budget',barcode:'B50',shop:'1',warehouse:shape.twoBranches?'1':'',date:'2026-01-01',action:shape.sale?'sale1':'add',selling_price:shape.sale?'5':'',cost_price:'4',supplier:'Bong Long',batch:shape.sale?'':`B${i}`}))
  if(shape.mixed){rows.forEach(r=>r._rowNumber++);rows.unshift({_rowNumber:2,name:'Budget',barcode:'B50',shop:'1',date:'2026-01-01',action:'add',cost_price:'4',supplier:'Bong Long',batch:'added'})}
  native.seedJob(sqlite,'budget',rows,{stock_action_mode:shape.reconcile?'reconcile':'direct',apply_authorized_by_id:61})
  let statements=0, calls=0, injected=false
  const instrument=adapter=>{
    const prepare=adapter.prepare.bind(adapter),batch=adapter.batch.bind(adapter)
    adapter.prepare=sql=>{const p=prepare(sql);const once=Object.fromEntries(['get','all','run'].map(method=>[method,async params=>{statements++;calls++;if(shape.finalizeFault&&!injected&&method==='run'&&/UPDATE import_jobs SET\s+status = @status, phase = @status/.test(sql)){injected=true;throw new Error('Injected finalizer failure')}return p[method](params)}]));once.getOnce=once.get;once.allOnce=once.all;return once}
    adapter.batch=async ss=>{statements+=ss.length;calls++;if(shape.finalizeFault&&!injected&&ss.some(s=>/UPDATE import_jobs SET\s+status = @status, phase = @status/.test(s.sql))){injected=true;throw new Error('Injected finalizer failure')}return(await batch(ss)).map(r=>({meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}))}
    adapter.batchOnce=adapter.batch
  }
  instrument(db)
  let separate
  if(shape.separate){
    separate=native.makeDb()
    for(const row of sqlite.prepare('SELECT * FROM import_job_source_rows').all()) separate.sqlite.prepare('INSERT INTO import_job_source_rows VALUES(@job_id,@sequence,@row_number,@data_json)').run(row)
    sqlite.exec('DELETE FROM import_job_source_rows')
    instrument(separate.db)
    db.staging=separate.db
  }
  if(shape.noFlag) sqlite.exec('DROP TABLE system_flags')
  let queued=0
  const env={DB:db,PLAN_TIER:tier,CACHE:{get:async()=>null,put:async()=>{},delete:async()=>{}},IMPORT_QUEUE:{send:async()=>{queued++}}}
  const accounting=await fence.getImportFencedDb(env)
  assert.strictEqual(accounting.importWriteFenceStatements,shape.noFlag?0:1,'actual factory records exact fence cost')
  assert.strictEqual(Object.getOwnPropertyDescriptor(accounting,'importWriteFenceStatements').writable,false,'accounting seam is readonly')
  assert.strictEqual(accounting.staging===accounting,!shape.separate,'staging alias is preserved precisely')
  const resultsDb=separate?.sqlite||sqlite
  let firstSnapshot
  const physicalSnapshot=()=>JSON.stringify(['products','product_batches','branch_stock','branch_batch_stock','inventory_movements','sales','sale_items','sale_item_batch_allocations'].map(table=>sqlite.prepare(`SELECT * FROM ${table}`).all()))
  if(shape.missingQueue){
    const checkpoint=sqlite.prepare('SELECT chunk_cursor,chunk_state_json FROM import_jobs').get()
    const before=physicalSnapshot();delete env.IMPORT_QUEUE
    await assert.rejects(()=>native.runImportApply(env,'budget'),e=>e.code==='import_queue_required')
    assert.strictEqual(physicalSnapshot(),before,'missing queue refuses before business effects')
    assert.deepStrictEqual(sqlite.prepare('SELECT chunk_cursor,chunk_state_json FROM import_jobs').get(),checkpoint,'existing checkpoint retained')
    sqlite.close();return []
  }
  const stats=[]
  for(let i=0;i<1000;i++) {
    statements=0;calls=0;queued=0
    native.loadReal('planTier').__resetPlanTierCacheForTests()
    // runImportApply obtains the real maintenance-fenced adapter itself.
    const before=sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n
    let acked=false,retried=false
    await queueModule.exports.handleImportQueue({messages:[{body:{jobId:'budget',kind:'apply'},timestamp:new Date(),attempts:1,ack(){acked=true},retry(){retried=true}}]},env)
    if(retried){assert.ok(shape.finalizeFault&&injected,'only injected finalizerfailure retries');queued++}else assert.ok(acked,'successful or deferred continuation is acknowledged')
    const moved=sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n-before
    stats.push({tier,statements,calls,moved})
    if(!shape.reconcile) assert.ok(statements<=(tier==='free'?50:1000),'whole queue entry statement bound')
    if(!shape.oversized) assert.strictEqual(resultsDb.prepare(`SELECT COUNT(*) n FROM import_job_rows WHERE action='error'`).get().n,0,'budget deferrals never become row failures')
    if(!queued){if(shape.replay&&!firstSnapshot){firstSnapshot=physicalSnapshot();continue}break}
  }
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,shape.mixed?1:shape.oversized?0:units*(shape.twoBranches?2:1))
  if(shape.sale) assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM sales').get().n,shape.oversized?0:1)
  if(shape.oversized) assert.strictEqual(resultsDb.prepare(`SELECT COUNT(*) n FROM import_job_rows WHERE action='error' AND json_extract(result_json,'$.code')='stock_import_unit_over_tier_budget'`).get().n,units,'entire oversize atomicgroup fails before any effects')
  assert.strictEqual(sqlite.prepare('SELECT SUM(quantity) quantity FROM branch_stock').get().quantity,shape.mixed?units+1:shape.sale?(shape.oversized?units:0):units*(shape.twoBranches?2:1))
  console.log(JSON.stringify({tier,units,shape,invocations:stats.length,maxStatements:Math.max(...stats.map(s=>s.statements)),maxCalls:Math.max(...stats.map(s=>s.calls))}))
  if(shape.replay) assert.strictEqual(physicalSnapshot(),firstSnapshot,'full queue replay changes no physical business rows')
  if(shape.finalizeFault) assert.ok(injected,'finalizer fault must actually execute')
  sqlite.close()
  separate?.sqlite.close()
  return stats
}
async function singleAttemptReadOracle() {
  const dbPath=path.join(__dirname,'..','src','lib','db.ts'), mod={exports:{}}
  new Function('exports','require','module',native.transpile(dbPath))(mod.exports,request=>request==='./importMaintenanceFence'?fence:require(request),mod)
  let calls=0
  const raw={prepare(){return{bind(){return{async all(){calls++;if(calls===1)throw new Error('D1_ERROR: internal error');return{results:[{id:1}],meta:{}}}}}}}}
  const db=new mod.exports.D1Compat(raw)
  for(const method of ['getOnce','allOnce']){
    calls=0;await assert.rejects(()=>db.prepare('SELECT 1')[method](),/internal error/);assert.strictEqual(calls,1)
  }
  calls=0;assert.deepStrictEqual(await db.prepare('SELECT 1').get(),{id:1});assert.strictEqual(calls,2,'default read keeps existing retry')
  calls=0;assert.deepStrictEqual(await db.prepare('SELECT 1').all(),[{id:1}]);assert.strictEqual(calls,2)
  console.log('PASS read-once actual D1Compat methods skip implicitretry; defaults preserve retry')
}
async function groupFinalizerOracle() {
  const {sqlite,db}=native.makeDb()
  const rows=[
    [1,'Group A','Y','B','2026-10-08'],[2,'Group A','X','C','2026-01-01'],[3,'Group A','X','','2026-01-01'],
    [4,'Untouched','A','B','2026-01-01'],[5,'Untouched','C','D','2026-01-01'],
    [6,'Empty','',null,'2026-10-08'],[7,'Empty',null,'','2026-01-01'],
    [8,'Noop','X','B','2026-10-08'],[9,'Noop','X','B','2026-01-01'],
  ]
  const insert=sqlite.prepare('INSERT INTO products(id,name,category,brand,updated_at,is_active) VALUES(?,?,?,?,?,1)')
  rows.forEach(row=>insert.run(row))
  const before=sqlite.prepare('SELECT * FROM products ORDER BY id').all()
  let statementCount=0
  const batch=db.batch.bind(db)
  db.batch=async statements=>{statementCount+=statements.length;for(const statement of statements){const plan=sqlite.prepare('EXPLAIN QUERY PLAN '+statement.sql).all(statement.params);assert.ok(plan.some(row=>/SEARCH products USING INTEGER PRIMARY KEY/.test(row.detail)),'finalizer uses product primary-keylookup');assert.ok(!plan.some(row=>/CORRELATED/.test(row.detail)),'no per-product correlated JSONscan')}return batch(statements)}
  assert.strictEqual(await native.engine.unifyTouchedProductGroups(db,'2026-10-01'),1)
  const after=sqlite.prepare('SELECT * FROM products ORDER BY id').all()
  const expected=before.map(row=>row.id<=3?{...row,category:'X',brand:'B',updated_at:after[row.id-1].updated_at}:row)
  assert.deepStrictEqual(after,expected,'set-based finalization preserves exact winner, tie, empty and untouched semantics')
  assert.strictEqual(statementCount,2,'one update perfield, no per-product query growth')
  assert.strictEqual(await native.engine.unifyTouchedProductGroups(db,'2026-10-01'),0,'finalizer replay is no-op')
  sqlite.close()
  console.log('PASS set-based full-row finalizer oracle and replay')
}
;(async()=>{
  await singleAttemptReadOracle()
  await groupFinalizerOracle()
  await measure('free',1)
  await measure('free',1,{create:true})
  await measure('free',1,{twoBranches:true})
  await measure('free',1,{separate:true})
  await measure('free',1,{noFlag:true})
  await measure('free',1,{finalizeFault:true})
  await measure('free',1,{replay:true})
  await measure('free',1,{missingQueue:true})
  await measure('free',8,{sale:true,oversized:true})
  await measure('paid',8,{sale:true,replay:true})
  await measure('free',8,{sale:true,oversized:true,mixed:true})
  const free=await measure('free',60)
  const paid=await measure('paid',480)
  const freeMax=Math.max(...free.map(s=>s.statements)),paidMax=Math.max(...paid.map(s=>s.statements))
  await measure('free',1,{reconcile:true})
  await measure('free',60,{reconcile:true})
  assert.ok(freeMax<=50,`Free whole invocation ${freeMax}>50`)
  assert.ok(paidMax<=1000,`Paid single-delivery budget ${paidMax}>1000`)
})().catch(e=>{console.error(e);process.exitCode=1})








