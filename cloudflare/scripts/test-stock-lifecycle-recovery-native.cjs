const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const cache = new Map()
const overrides = {
  '../lib/auth': { requireAuth: async (c,next) => { c.set('user',{ id:71,permissions:'{"all":true}' }); return next() } },
  '../durable-objects/broadcastHub': { broadcast:async()=>{} },
  '../lib/telegram': { sendTelegramEvent:async()=>{},telegramMoney:()=>'',formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[] },
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const file = path.join(__dirname, '../src', rel)
  const source = process.env.STOCK_RECOVERY_BASELINE && rel==='lib/backup.ts' ? execFileSync('git',['show','341b85850e85b8f4478a3677fb3461fee0449cf9:cloudflare/src/lib/backup.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}) : fs.readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }; cache.set(rel, mod)
  const local = name => Object.hasOwn(overrides,name) ? overrides[name] : name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)).replace(/(?:\.ts)?$/, '.ts')) : require(name)
  new Function('require', 'module', 'exports', output)(local, mod, mod.exports)
  return mod.exports
}
function fixture() {
  const migration213 = path.join(__dirname, '../migrations/0213_stock_valuation_segments.sql')
  const external213 = process.env.STOCK_RECOVERY_0213_PATH
  const scripts = fs.existsSync(migration213) ? loadAll() : external213 ? [...loadAll({ through: 212 }), fs.readFileSync(external213, 'utf8'), fs.readFileSync(path.join(__dirname, '../migrations/0214_stock_lifecycle_recovery.sql'), 'utf8')] : loadAll()
  const db = openDb(scripts).db
  db.limits.variableNumber = 100
  const calls = [], hooks = {}
  function prepare(sql, values = []) {
    const execute = () => {
      calls.push(sql); hooks.before?.(sql, db)
      const stmt = db.prepare(sql)
      if (stmt.columns().length) return { success: true, results: sqliteD1Call(stmt, 'all', values), meta: { changes: 0 } }
      const result = sqliteD1Call(stmt, 'run', values)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { sql, execute, bind: (...params) => prepare(sql, params), all: async () => execute(), run: async () => execute(), first: async key => { const row = execute().results[0]; return key ? row?.[key] ?? null : row ?? null } }
  }
  const d1 = { prepare, batch: async items => { hooks.beforeBatch?.(items, db); db.exec('BEGIN IMMEDIATE'); try { const result = items.map((item, index) => { if (hooks.failAt === index) throw new Error('injected batch failure'); return item.execute() }); db.exec('COMMIT'); hooks.afterBatch?.(items, db); return result } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e } } }
  const objects = new Map(); let version = 0
  const put = async (key, value, options = {}) => { objects.set(key, { bytes: typeof value === 'string' ? Buffer.from(value) : Buffer.from(value), version: String(++version), options }); return {} }
  const assets = {
    put, delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key) },
    list: async ({ prefix = '' } = {}) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, uploaded: new Date(), customMetadata: o.options.customMetadata })), truncated: false }),
    get: async (key, options) => { const o = objects.get(key); if (!o) return null; const identity = { key, version: o.version, etag: o.version, size: o.bytes.length, customMetadata: o.options.customMetadata }; if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== o.version) return identity; return { ...identity, body: new Blob([o.bytes]).stream(), text: async () => o.bytes.toString(), json: async () => JSON.parse(o.bytes.toString()) } },
    createMultipartUpload: async (key, options) => { const parts = []; return { uploadPart: async (n, bytes) => { parts[n - 1] = Buffer.from(bytes); return { partNumber: n, etag: String(n) } }, complete: async () => put(key, Buffer.concat(parts), options), abort: async () => {} } },
  }
  const kv = new Map()
  return { db, calls, hooks, objects, env: { DB: d1, ASSETS: assets, CACHE: { get: async key => kv.get(key) ?? null, put: async (key, value) => kv.set(key, value), delete: async key => kv.delete(key) }, PLAN_TIER: 'paid' } }
}
const durable = ['stock_disposition_sources','stock_disposition_allocations','stock_disposition_events','stock_disposition_fees','stock_disposition_receipts','stock_funding_invoice_openings','stock_funding_sources','stock_funding_claims','stock_funding_events','stock_funding_receipts']
const actor = { id: 71 }
function seed(f) {
  f.db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(71,'recovery_writer','Recovery Writer','fixture','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true,"backup":true,"backup_restore":true}',1);
    INSERT INTO suppliers(id,name) VALUES(77,'Recovery supplier');`)
  for (const [id, batch, movement] of [[10,500,900],[11,501,901]]) f.db.exec(`
    INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(${id},'Recovery${id}','REC${id}',4,1);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
    VALUES(${batch},${id},'recovery${batch}','REC${batch}','2026-10-01',1,1,77,'credit',4,100,1,25);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${batch},1,4);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(${id},1,4);
    INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(${movement},${id},1,${batch},'add',4,1,100,'receipt${movement}',71);`)
  f.db.exec("INSERT INTO stock_disposition_sources VALUES('source-900',900,500,10,1,77,'4','1',1000000,0,1000000,'reconciled_unpaid'); PRAGMA foreign_keys=ON")
}
const hold = { kind:'hold',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:2,coverage_usd:30,coverage_state:'accepted_credit',condition_tag:'broken',reason:'Broken recovery fixture',extra_fee_usd:1.7,expected_generation:0,client_request_id:'recovery-hold-0001' }
const fund = { kind:'admit',source_id:'fund-901',movement_id:901,batch_id:501,product_id:11,branch_id:1,supplier_id:77,quantity:4,free_quantity:1,gross_usd:100,opening_paid_usd:80,opening_debt_usd:20,reconciliation_proof:'Reconciled recovery fixture',invoice_id:null,expected_generation:0,client_request_id:'recovery-admit-0001' }
const command = (kind, generation, more = {}) => ({ kind,source_id:'fund-901',expected_generation:generation,proof:'Recovery fixture evidence',client_request_id:`recovery-${kind}-${generation}-0001`,...more })
const snapshot = f => JSON.stringify(load('lib/backup.ts').BACKUP_TABLES.filter(t => f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)).map(t => [t,f.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]))
async function main() {
  const backup = load('lib/backup.ts')
  const f = fixture()
  const result = await backup.createCloudflareBackup(f.env)
  const document = await (await f.env.ASSETS.get(result.key)).json()
  const missing = durable.filter(table => !Object.hasOwn(document.tables, table))
  assert.deepEqual(missing, [], 'actual createCloudflareBackup manifest must retain all ten durable stock finance tables')
  assert(!Object.hasOwn(document.tables, 'stock_disposition_guards'))
  assert(!Object.hasOwn(document.tables, 'stock_funding_guards'))
  f.db.close()
  console.log('PASS actual native SQLite/in-memory R2 backup includes ten durable ledgers and excludes transient guards')
  const source = fixture(); seed(source)
  const disposition = load('lib/stockDisposition.ts'), funding = load('lib/stockFunding.ts')
  const held = await disposition.commitStockDisposition(source.env, actor, hold)
  await disposition.commitStockDisposition(source.env, actor, { kind:'dispose',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,allocation_id:held.allocation_id,quantity:1,reason:'Dispose recovery fixture',expense_category:'broken',expected_generation:1,client_request_id:'recovery-dispose-0001' })
  await funding.commitStockFunding(source.env, actor, fund)
  await funding.commitStockFunding(source.env, actor, command('pending',0,{ amount_usd:30,claim_id:'recovery-claim' }))
  await funding.commitStockFunding(source.env, actor, command('accept',1,{ claim_id:'recovery-claim' }))
  await funding.commitStockFunding(source.env, actor, command('refund',2,{ amount_usd:10,cash_method:'cash',cash_reference:'REC-CASH',cash_recorded_at:'2026-10-01T11:00:00.000Z' }))
  const saved = await backup.createCloudflareBackup(source.env)
  const bytes = source.objects.get(saved.key).bytes
  const target = fixture(); await target.env.ASSETS.put(saved.key, bytes)
  await backup.restoreCloudflareBackup(target.env, saved.key)
  assert.equal(snapshot(target), snapshot(source), 'full graph exact rows and FK parents retained')
  assert.deepEqual(target.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(target.db.prepare('SELECT COUNT(*) n FROM stock_lifecycle_recovery_context').get().n, 0)
  assert.equal(target.db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key IN ('maintenance','stock_lifecycle_recovery_admission')").get().n, 0)
  assert.equal((await disposition.commitStockDisposition(target.env, actor, hold)).replayed, true)
  assert.equal((await funding.commitStockFunding(target.env, actor, fund)).replayed, true)
  const before = snapshot(source)
  await assert.rejects(() => backup.restoreCloudflareBackup(source.env, saved.key), /linked supplier claim|stock_lifecycle/i)
  assert.equal(snapshot(source), before, 'existing admitted history preserved on refusal')
  const incomplete = JSON.parse(bytes); delete incomplete.tables.stock_funding_receipts
  const empty = fixture(); empty.db.exec("INSERT INTO settings(key,value) VALUES('proof','LIVE')"); await empty.env.ASSETS.put(saved.key, JSON.stringify(incomplete))
  const original = snapshot(empty)
  await assert.rejects(() => backup.restoreCloudflareBackup(empty.env, saved.key), /Incomplete stock recovery graph/)
  assert.equal(snapshot(empty), original)
  const recovery = load('lib/stockLifecycleRecovery.ts'), maintenance = load('lib/maintenance.ts')
  const authenticated = fixture(); seed(authenticated); await authenticated.env.ASSETS.put(saved.key, bytes)
  const authLease = await maintenance.beginMaintenance(authenticated.env,{backupKey:saved.key,startedBy:'fixture'})
  const authSnapshot = snapshot(authenticated)
  await assert.rejects(() => backup.restoreCloudflareBackup(authenticated.env,saved.key,undefined,{token:authLease.token,actorId:71,requiredPermission:'backup_restore'}), /cannot replace its own authorization/)
  assert.equal(snapshot(authenticated),authSnapshot)
  await maintenance.endMaintenance(authenticated.env,authLease.token)
  const revoke = fixture(); seed(revoke)
  await assert.rejects(() => recovery.withStockRecoveryFence(revoke.env,'revoke-fixture',async guarded => {
    revoke.db.exec("UPDATE users SET permissions='{}' WHERE id=71")
    await guarded.DB.prepare("DELETE FROM products WHERE id=11").run()
  },{actorId:71,requiredPermission:'backup_restore'}),/JSON path|owner_changed/)
  assert.equal(revoke.db.prepare('SELECT COUNT(*) n FROM products').get().n,2)
  const reset = load('routes/system.ts').default
  const resetBefore = snapshot(source)
  const refused = await reset.request('/reset-data',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"products"}'},source.env,{waitUntil(){},passThroughOnException(){}})
  assert.equal(refused.status,409); assert.equal((await refused.json()).code,'stock_lifecycle_dependency'); assert.equal(snapshot(source),resetBefore)
  const exportRevoked=fixture(); seed(exportRevoked)
  exportRevoked.hooks.beforeBatch=items=> {
    if(items.some(i=>/SELECT rowid AS.*FROM "users"/.test(i.sql))) {
      delete exportRevoked.hooks.beforeBatch
      exportRevoked.db.exec("UPDATE users SET permissions='{}' WHERE id=71")
    }
  }
  await assert.rejects(()=>backup.createCloudflareBackup(exportRevoked.env,'manual',{actorId:71,requiredPermission:'backup',requireCostView:true}),/JSON path|owner_changed/)
  assert.equal(exportRevoked.objects.size,0,'revoked actor receives no finalized manifest or sidecar')
  exportRevoked.db.close()
  const failures = [
    ['context insert',"CREATE TRIGGER recovery_ignore BEFORE INSERT ON stock_lifecycle_recovery_context BEGIN SELECT RAISE(IGNORE); END"],
    ['admission marker insert',"CREATE TRIGGER recovery_ignore BEFORE INSERT ON system_flags WHEN NEW.key='stock_lifecycle_recovery_admission' BEGIN SELECT RAISE(IGNORE); END"],
    ['owner delete',"CREATE TRIGGER recovery_ignore BEFORE DELETE ON system_flags WHEN OLD.key='maintenance' BEGIN SELECT RAISE(IGNORE); END"],
    ['source insert',"CREATE TRIGGER recovery_ignore BEFORE INSERT ON stock_disposition_sources BEGIN SELECT RAISE(IGNORE); END"],
    ['owner reinsertion',"CREATE TRIGGER recovery_ignore BEFORE INSERT ON system_flags WHEN NEW.key='maintenance' AND EXISTS(SELECT 1 FROM stock_lifecycle_recovery_context) BEGIN SELECT RAISE(IGNORE); END"],
    ['context cleanup',"CREATE TRIGGER recovery_ignore BEFORE DELETE ON stock_lifecycle_recovery_context BEGIN SELECT RAISE(IGNORE); END"],
    ['admission marker cleanup',"CREATE TRIGGER recovery_ignore BEFORE DELETE ON system_flags WHEN OLD.key='stock_lifecycle_recovery_admission' BEGIN SELECT RAISE(IGNORE); END"],
  ]
  for (const [label,sql] of failures) {
    const broken=fixture(); await broken.env.ASSETS.put(saved.key,bytes); broken.db.exec(sql)
    await assert.rejects(() => backup.restoreCloudflareBackup(broken.env,saved.key),/JSON path|stock_recovery/,label)
    assert.equal(broken.db.prepare('SELECT COUNT(*) n FROM stock_disposition_sources').get().n,0,label)
    assert.equal(broken.db.prepare('SELECT COUNT(*) n FROM stock_lifecycle_recovery_context').get().n,0,label)
    assert.equal(broken.db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='maintenance'").get().n,1,label)
    broken.db.close()
  }
  let protocolLength=0
  const measure=fixture(); await measure.env.ASSETS.put(saved.key,bytes)
  measure.hooks.beforeBatch=items=> { if (items.some(i=>i.sql.includes('INSERT INTO stock_lifecycle_recovery_context'))) protocolLength=Math.max(protocolLength,items.length) }
  await backup.restoreCloudflareBackup(measure.env,saved.key); measure.db.close()
  assert(protocolLength>8)
  for(let index=0;index<protocolLength;index++) {
    const broken=fixture(); await broken.env.ASSETS.put(saved.key,bytes)
    broken.hooks.beforeBatch=items=> { if (items.some(i=>i.sql.includes('INSERT INTO stock_lifecycle_recovery_context'))) broken.hooks.failAt=index }
    await assert.rejects(()=>backup.restoreCloudflareBackup(broken.env,saved.key),/injected batch failure/)
    assert.equal(broken.db.prepare('SELECT COUNT(*) n FROM stock_disposition_sources').get().n,0,`source boundary ${index}`)
    assert.equal(broken.db.prepare('SELECT COUNT(*) n FROM stock_lifecycle_recovery_context').get().n,0,`context boundary ${index}`)
    assert.equal(broken.db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='maintenance'").get().n,1)
    broken.db.close()
  }
  const concurrent=fixture(); seed(concurrent)
  await recovery.withStockRecoveryFence(concurrent.env,'concurrent-fixture',async()=> {
    await assert.rejects(()=>funding.commitStockFunding(concurrent.env,actor,fund),/funding|maintenance|lifecycle/i)
    assert.equal(concurrent.db.prepare('SELECT COUNT(*) n FROM stock_funding_sources').get().n,0)
  })
  await funding.commitStockFunding(concurrent.env,actor,fund)
  assert.equal(concurrent.db.prepare('SELECT COUNT(*) n FROM stock_funding_sources').get().n,1)
  concurrent.db.close()
  const stale=fixture(); await stale.env.ASSETS.put(saved.key,bytes)
  stale.hooks.beforeBatch=items=> {
    if(items.some(i=>i.sql.includes('INSERT INTO stock_lifecycle_recovery_context'))) {
      delete stale.hooks.beforeBatch
      stale.db.exec("UPDATE system_flags SET value=json_set(value,'$.token','other-owner') WHERE key='maintenance'")
    }
  }
  await assert.rejects(()=>backup.restoreCloudflareBackup(stale.env,saved.key),/stock_recovery_owner_changed/)
  assert.equal(stale.db.prepare('SELECT COUNT(*) n FROM stock_disposition_sources').get().n,0)
  assert.equal(JSON.parse(stale.db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value).token,'other-owner')
  stale.db.close()
  const lost=fixture(); await lost.env.ASSETS.put(saved.key,bytes)
  lost.hooks.afterBatch=(items,db)=> {
    if(items.some(i=>i.sql.includes('INSERT INTO stock_lifecycle_recovery_context'))) { delete lost.hooks.afterBatch; throw new Error('committed response lost') }
  }
  await assert.rejects(()=>backup.restoreCloudflareBackup(lost.env,saved.key),/committed response lost/)
  assert.equal(lost.db.prepare('SELECT COUNT(*) n FROM stock_disposition_sources').get().n,1)
  assert.equal(lost.db.prepare('SELECT COUNT(*) n FROM stock_lifecycle_recovery_context').get().n,0)
  assert.equal(lost.db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='maintenance'").get().n,1)
  await assert.rejects(()=>backup.restoreCloudflareBackup(lost.env,saved.key),/already in progress/)
  lost.db.close()
  for (const f of [source,target,empty,authenticated,revoke]) f.db.close()
  console.log('PASS actual populated graph fresh restore, immutable target refusal, incomplete graph before mutation, exact FK graph and replay')
  console.log('PASS actual reset lifecycle refusal; current permission revoke; authenticated own-authority restore refusal; seven ignored protocol writes roll back sources/context with maintenance retained')
  console.log(`PASS all ${protocolLength} source-protocol statement failures; actual funding admission before/after fence; stolen owner; committed-lost-response preserved and retry refused`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
