const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
if (process.argv.includes('--base')) {
  const read = fs.readFileSync.bind(fs)
  fs.readFileSync = (file, ...args) => {
    const relative = path.relative(path.join(__dirname, '..', '..'), String(file)).replaceAll('\\', '/')
    if (['cloudflare/src/lib/importEngine.ts', 'cloudflare/src/routes/importJobs.ts'].includes(relative)) {
      return require('node:child_process').execFileSync('git', ['show', 'd0f0fde1bc71871197ec0ec2d69abfcfb62b92bc:' + relative], {cwd:path.join(__dirname,'..','..'),encoding:'utf8'})
    }
    return read(file, ...args)
  }
}
const fixturePath = path.join(__dirname, 'test-stock-action-apply-pure.cjs')
const fixture = fs.readFileSync(fixturePath, 'utf8').split('let failures = 0')[0].replace('const engineAbs =', `
  for (const name of ['importMaintenanceFence','permissions','acquisitionCostAccess','importLifecycleGate','importIncomingFiles']) REAL.add(name);
  STUBS['./db'].getImportFencedDb = env => loadReal('importMaintenanceFence').getImportFencedDb(env);
  STUBS['./db'].isImportMaintenanceFenceError = e => loadReal('importMaintenanceFence').isImportMaintenanceFenceError(e);
  const engineAbs =`)
const native = new Function('require', '__dirname', fixture + `
  return {makeDb,seedProduct,seedJob,runImportApply,loadReal,transpile,makeRequire,engine:engineMod.exports};
`)(require, __dirname)
async function main() {
  const { sqlite, db } = native.makeDb()
  try {
    sqlite.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,name TEXT,permissions TEXT);
      CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,organization_id INTEGER,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT);
      INSERT INTO roles VALUES(1,'admin','Admin','{}'); INSERT INTO users VALUES(61,'admin','Admin',1,1,'{}',1,NULL);
      ALTER TABLE import_jobs ADD COLUMN last_error TEXT;
      CREATE TABLE product_damaged_stock(product_id INTEGER,batch_id INTEGER,branch_id INTEGER,remaining_quantity REAL);
      CREATE TABLE import_job_files(job_id TEXT,kind TEXT,status TEXT);
      CREATE TABLE import_job_row_signatures(job_id TEXT);`)
    const prepare = db.prepare.bind(db), batch = db.batch.bind(db)
    db.prepare = sql => { const p = prepare(sql); return {...p,getOnce:p.get,allOnce:p.all} }
    db.batch = async statements => (await batch(statements)).map(result => ({meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}}))
    db.batchOnce = db.batch
    native.seedProduct(sqlite, {id:50,name:'Budget',barcode:'B50',shop:0})
    native.seedJob(sqlite, 'queue', [{_rowNumber:2,name:'Budget',barcode:'B50',shop:'1',date:'2026-01-01',action:'add',cost_price:'4',supplier:'Supplier',batch:'B1'}], {stock_action_mode:'direct',apply_authorized_by_id:61})
    sqlite.exec("UPDATE import_jobs SET status='failed',phase='failed' WHERE id='queue'")
    const routes = {exports:{}}
    const realRequire = native.makeRequire(path.join(__dirname,'..','src','routes'))
    const fence = native.loadReal('importMaintenanceFence')
    new Function('exports','require','module',native.transpile(path.join(__dirname,'..','src','routes','importJobs.ts')))(routes.exports, request => {
      if (request === '../lib/auth') return {requireAuth:async(c,next)=>{c.set('user',{id:61,username:'admin',role_code:'admin',permissions:{}});return next()}}
      if (request === '../lib/db') return {getDb:env=>env.DB}
      if (request === '../lib/importMaintenanceFence') return fence
      if (request === '../lib/importEngine') return native.engine
      if (request === '../lib/audit') return {audit:async()=>{}}
      return realRequire(request)
    }, routes)
    native.loadReal('queueDispatch').registerInlineImportRunner(async(env,message)=>native.runImportApply(env,message.jobId))
    const snapshot = () => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','product_damaged_stock','inventory_movements','sales','sale_items','import_stock_action_commits'].map(table=>sqlite.prepare('SELECT * FROM '+table).all()))
    const before = snapshot()
    const env = {DB:db,PLAN_TIER:'free'}
    const response = await routes.exports.default.request('http://local.test/queue/retry',{method:'POST'},env)
    assert.equal(response.status,503,await response.clone().text())
    const body = await response.json()
    assert.equal(body.code,'import_queue_required')
    assert.equal(body.success,false)
    assert.equal(snapshot(),before,'actual route, dispatcher, engine admission leave every business row unchanged')
    const job = sqlite.prepare("SELECT status,last_error,chunk_cursor FROM import_jobs WHERE id='queue'").get()
    assert.equal(job.status,'failed','durable failure remains visible and retryable')
    assert.match(job.last_error,/^import_queue_required: /)
    assert.equal(job.chunk_cursor,0)
    let delivered = 0
    const ready = await routes.exports.default.request('http://local.test/queue/retry',{method:'POST'}, {...env,IMPORT_QUEUE:{send:async()=>{delivered++}}})
    assert.equal(ready.status,200,await ready.clone().text())
    assert.equal(delivered,1,'restored queue receives exactly one retry')
    assert.equal(snapshot(),before,'queue handoff does not execute stock in request')
    native.seedJob(sqlite, 'unknown', [], {stock_action_mode:'direct',apply_authorized_by_id:61})
    const prepared = db.prepare.bind(db)
    db.prepare = sql => {
      const statement = prepared(sql)
      if (/FROM users\b/.test(sql)) {
        const fail = async()=>{throw Object.assign(new Error('Original vendor failure'),{code:'vendor_unknown'})}
        return {...statement,get:fail,getOnce:fail}
      }
      return statement
    }
    await assert.rejects(()=>native.runImportApply({...env,IMPORT_QUEUE:{send:async()=>{}}},'unknown'), error=>error.code==='vendor_unknown')
    assert.equal(sqlite.prepare("SELECT last_error FROM import_jobs WHERE id='unknown'").get().last_error,'Original vendor failure','arbitrary exception code is not persisted as a translated refusal')
    console.log('PASS actual Hono/dispatcher/import engine native queue refusal: 503, stable persisted code, no stock/history effects')
  } finally { sqlite.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
