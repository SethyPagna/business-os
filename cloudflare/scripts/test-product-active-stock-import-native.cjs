const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name).exports
  const filename = path.join(__dirname, '../src/lib', `${name}.ts`)
  const mod = { exports: {} }; cache.set(name, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const shim = id => {
    if (id === './db') return { getDb: env => env.DB, getImportFencedDb: async env => env.DB, isImportMaintenanceFenceError: () => false }
    if (id === './importMaintenanceFence') return { getImportFencedDb: async env => env.DB, isImportMaintenanceFenceError: () => false }
    if (id === './cache') return { bumpVersion: async () => {} }
    if (id === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
    if (id.startsWith('./') && fs.existsSync(path.join(__dirname, '../src/lib', `${id.slice(2)}.ts`))) return load(id.slice(2))
    return require(id)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, shim, mod, filename, path.dirname(filename))
  return mod.exports
}
const engine = load('importEngine')
const bulk = load('bulkDeleteEngine')
const commits = load('stockActionCommit')
function fixture() {
  const raw = openDb(loadAll())
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql)
      return { get: p => st.get(p), all: p => st.all(p), run: async p => {
        const r = st.run(p); return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) }
      } }
    },
    batch: items => raw.batch(items), staging: null,
  }
  db.staging = db
  raw.prepare("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(991,'Probe','shop','shop',1,1)").run()
  return { raw, db }
}
function product(raw, id, quantity = 0) {
  raw.prepare('INSERT INTO products(id,name,is_active,stock_quantity,updated_at) VALUES(@id,@name,1,@qty,@stamp)')
    .run({ id, name: `Probe ${id}`, qty: quantity, stamp: '2026-01-01' })
}
function materializedJob(raw, id, row, policy = {}) {
  raw.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(91,'operator','Operator','hash','{\"all\":true}',1)").run()
  raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
    VALUES(@id,'products','applying','applying',@policy,1,0,'{}','2026-10-08')`)
    .run({ id, policy: JSON.stringify({ apply_authorized_by_id: 91, ...policy }) })
  raw.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(@id,0,2,@row)')
    .run({ id, row: JSON.stringify({ _rowNumber: 2, ...row }) })
}
async function main() {
  for (const mode of ['merge','replace_all','replace_columns','fill_blank']) {
    const {raw,db}=fixture(); product(raw,81)
    raw.prepare('UPDATE products SET is_active=0 WHERE id=81').run()
    materializedJob(raw,`removed-${mode}`,{name:'Probe 81',is_active:'1',description:'must not write',_action:'override_replace'},
      {import_mode:mode,replace_columns:['description','is_active']})
    const run=()=>engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},`removed-${mode}`)
    if(mode==='replace_all') await assert.rejects(run,e=>e.code==='product_replacement_incomplete')
    else await run()
    const result=JSON.parse(raw.prepare("SELECT result_json FROM import_job_rows WHERE phase='apply'").get().result_json)
    assert.equal(result.action,'error',mode)
    assert.equal(result.code,'product_has_stock',mode)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=81').get().is_active,0)
    assert.equal(raw.prepare('SELECT description FROM products WHERE id=81').get().description,null)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries').get().n,0)
  }
  console.log('PASS every ordinary import mode refuses removed identity without revival or metadata edits')
  for (const status of [0,false,'false']) {
    const {raw,db}=fixture()
    materializedJob(raw,`unsupported-${String(status)}`,{name:'New product',is_active:status})
    await engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},`unsupported-${String(status)}`)
    const result=JSON.parse(raw.prepare("SELECT result_json FROM import_job_rows WHERE phase='apply'").get().result_json)
    assert.equal(result.code,'product_status_unsupported')
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM products').get().n,0)
  }
  for (const status of [undefined,null,1,'1']) {
    const {raw,db}=fixture()
    materializedJob(raw,`present-${String(status)}`,{name:'New product',is_active:status})
    await engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},`present-${String(status)}`)
    assert.equal(raw.prepare('SELECT is_active FROM products').get().is_active,1)
  }
  assert.deepEqual(engine.getProductImportReplaceColumns(JSON.stringify({replace_columns:['is_active','description']})),['description'])
  console.log('PASS raw false/zero status refused; omitted/null/one creates present')
  {
    const {raw,db}=fixture(); product(raw,90)
    raw.exec("CREATE TRIGGER fail_removal_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='product' BEGIN SELECT RAISE(ABORT,'audit_fault'); END")
    await assert.rejects(()=>engine.finalizeProductReplacement(db,'2026-10-08',{jobId:'audit-fault',actor:{id:91,name:'Operator'}}),/audit_fault/)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=90').get().is_active,1)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
    raw.exec('DROP TRIGGER fail_removal_audit')
    assert.equal(await engine.finalizeProductReplacement(db,'2026-10-08',{jobId:'audit-fault',actor:{id:91,name:'Operator'}}),1)
    const audit=raw.prepare('SELECT * FROM audit_logs').get()
    assert.equal(audit.user_id,91)
    assert.equal(audit.user_name,'Operator')
    assert.equal(JSON.parse(audit.details).importJobId,'audit-fault')
    assert.equal(JSON.parse(audit.details).membership,'removed')
    assert.equal(await engine.finalizeProductReplacement(db,'2026-10-08',{jobId:'audit-fault',actor:{id:91,name:'Operator'}}),0)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,1)
  }
  console.log('PASS replace-all removal and actor/job provenance atomic; audit fault retry has one event')
  {
    const {raw,db}=fixture(); product(raw,91)
    raw.prepare("INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('audit-fault','products','pending','test','[91]',1)").run()
    raw.exec("CREATE TRIGGER fail_bulk_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='product' BEGIN SELECT RAISE(ABORT,'audit_fault'); END")
    await bulk.runBulkDeleteJob({DB:db},'audit-fault')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=91').get().is_active,1)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
    assert.equal(raw.prepare("SELECT failed_count FROM bulk_delete_jobs WHERE id='audit-fault'").get().failed_count,1)
  }
  console.log('PASS bulk audit fault refuses product removal atomically with truthful failed count')
  for (const invalid of [{name:'Probe 95',is_active:'0'}, {description:'missing required name'}]) {
    const {raw,db}=fixture(); product(raw,95); product(raw,96)
    materializedJob(raw,'incomplete',{...invalid},{import_mode:'replace_all'})
    await assert.rejects(()=>engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},'incomplete'),e=>e.code==='product_replacement_incomplete')
    assert.deepEqual(raw.prepare('SELECT is_active FROM products ORDER BY id').all().map(p=>p.is_active),[1,1])
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
    const job=raw.prepare("SELECT phase,chunk_cursor,summary_json FROM import_jobs WHERE id='incomplete'").get()
    assert.equal(job.phase,'replace_all_refused')
    assert.equal(job.chunk_cursor,1)
    assert.equal(JSON.parse(job.summary_json).replacement_refused.code,'product_replacement_incomplete')
    await assert.rejects(()=>engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},'incomplete'),e=>e.code==='product_replacement_incomplete')
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM import_job_rows WHERE phase='apply'").get().n,1)
  }
  console.log('PASS invalid status and unrelated parse refusal both block omission removal without replay')
  {
    const {raw,db}=fixture(); product(raw,97)
    materializedJob(raw,'empty-update-race',{name:'Probe 97',description:'must not write',_action:'override_replace'})
    const batch=db.batch; let injected=false
    db.batch=items=>{
      if(!injected && items.some(x=>x.sql.includes('product_has_stock'))) {
        injected=true; raw.prepare('UPDATE products SET is_active=0 WHERE id=97').run()
      }
      return batch(items)
    }
    await assert.rejects(()=>engine.runImportApply({DB:db,ASSETS:{list:async()=>({objects:[]})}},'empty-update-race'),e=>e.code==='product_has_stock')
    assert.ok(injected)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=97').get().is_active,0)
    assert.equal(raw.prepare('SELECT description FROM products WHERE id=97').get().description,null)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM product_cost_entries').get().n,0)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0)
  }
  console.log('PASS product removal race refuses zero-inbound metadata import before journal or catalog effects')
  for (const ledger of ['rollup', 'branch', 'lot', 'damaged']) {
    const { raw, db } = fixture(); product(raw, 61)
    if (ledger === 'rollup') raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=61').run()
    if (ledger === 'branch') raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(61,991,1)').run()
    if (ledger === 'lot') {
      raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at) VALUES(61,61,'probe',1,'2026-10-01')").run()
      raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(61,991,1)').run()
    }
    if (ledger === 'damaged') raw.prepare('INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(61,991,1)').run()
    materializedJob(raw, `row-${ledger}`, { name: 'Probe 61', is_active: '0', stock_quantity: '0', _action: 'override_replace' })
    await engine.runImportApply({ DB: db, ASSETS: { list: async () => ({ objects: [] }) } }, `row-${ledger}`)
    const row = raw.prepare("SELECT action,result_json FROM import_job_rows WHERE phase='apply'").get()
    assert.equal(row.action, 'error', `${ledger} must be a row refusal`)
    assert.equal(JSON.parse(row.result_json).code, 'product_status_unsupported')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=61').get().is_active, 1)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM product_cost_entries').get().n, 0)
    product(raw,62)
    await assert.rejects(()=>engine.finalizeProductReplacement(db,'2026-10-08'),e=>e.code==='product_has_stock')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=62').get().is_active,1)
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0)
    console.log(`PASS status refusal and entire replacement guard preserve ${ledger}-alone holdings and empty sibling`)
  }
  {
    const { raw, db } = fixture(); product(raw, 61)
    materializedJob(raw, 'empty-row', { name: 'Probe 61', is_active: '0', stock_quantity: '0', _action: 'override_replace' })
    await engine.runImportApply({ DB: db, ASSETS: { list: async () => ({ objects: [] }) } }, 'empty-row')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=61').get().is_active, 1)
    assert.equal(raw.prepare("SELECT action FROM import_job_rows WHERE phase='apply'").get().action, 'error')
    console.log('PASS explicit disabling is refused even for empty product')
  }
  for (const existing of [false, true]) {
    const { raw, db } = fixture()
    if (existing) { product(raw, 61); raw.prepare('UPDATE products SET is_active=0 WHERE id=61').run() }
    materializedJob(raw, 'incoming', { name: 'Probe 61', is_active: existing ? '1' : '0',
      stock_quantity: '2', branch: 'shop', supplier: 'Supplier', cost_price_usd: '2', _action: 'override_add' })
    await engine.runImportApply({ DB: db, ASSETS: { list: async () => ({ objects: [] }) } }, 'incoming')
    const row = JSON.parse(raw.prepare("SELECT result_json FROM import_job_rows WHERE phase='apply'").get().result_json)
    assert.equal(row.action, 'error'); assert.equal(row.code, existing ? 'product_has_stock' : 'product_status_unsupported')
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM product_batches').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM products').get().n, existing ? 1 : 0)
    console.log(`PASS real ${existing ? 'existing inactive target' : 'new inactive row'} refuses incoming stock before effects`)
  }
  {
    const { raw, db } = fixture(); product(raw, 71); product(raw, 72)
    raw.prepare(`INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count)
      VALUES('race','products','pending','test','[71,72]',2)`).run()
    const batch = db.batch; let raced = false
    db.batch = items => {
      if (!raced && items.some(item => item.sql.includes('product_has_stock'))) {
        raced = true; raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=72').run()
      }
      return batch(items)
    }
    await bulk.runBulkDeleteJob({ DB: db }, 'race')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=72').get().is_active, 1)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=71').get().is_active, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE CAST(entity_id AS INTEGER)=72').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE CAST(entity_id AS INTEGER)=71').get().n, 1)
    console.log('PASS bulk race rolls back then repartitions with one safe audit')
  }
  {
    const { raw, db } = fixture(); product(raw, 11, 1); product(raw, 12)
    raw.prepare(`INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count)
      VALUES('mixed','products','pending','test','[11,12]',2)`).run()
    await bulk.runBulkDeleteJob({ DB: db, PLAN: 'paid' }, 'mixed')
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=11').get().is_active, 1)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=12').get().is_active, 0, 'safe empty item must proceed despite stocked sibling')
    const job = raw.prepare("SELECT * FROM bulk_delete_jobs WHERE id='mixed'").get()
    assert.deepEqual(JSON.parse(job.failed_ids_json), [11]); assert.equal(job.failed_count, 1)
    assert.match(job.last_error, /product_has_stock/)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE CAST(entity_id AS INTEGER)=11').get().n, 0)
    await bulk.runBulkDeleteJob({ DB: db, PLAN: 'paid' }, 'mixed')
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE CAST(entity_id AS INTEGER)=12').get().n, 1)
    console.log('PASS mixed bulk preserves blocked ID and deletes empty sibling without write-offs/replay')
  }
  {
    const { raw, db } = fixture(); product(raw, 21, 1); product(raw, 22)
    await assert.rejects(() => engine.finalizeProductReplacement(db, '2026-10-08'), error => error.code === 'product_has_stock' && error.status === 409)
    assert.deepEqual(raw.prepare('SELECT is_active FROM products ORDER BY id').all().map(p => p.is_active), [1, 1])
    raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=21').run()
    assert.equal(await engine.finalizeProductReplacement(db, '2026-10-08'), 2)
    assert.equal(await engine.finalizeProductReplacement(db, '2026-10-08'), 0)
    console.log('PASS replacement refuses entire phase and retries cleanly')
  }
  {
    const { raw, db } = fixture(); product(raw, 31); product(raw, 32)
    const batch = db.batch; let injected = false
    db.batch = items => {
      if (!injected) { injected = true; raw.prepare('UPDATE products SET stock_quantity=1 WHERE id=32').run() }
      return batch(items)
    }
    await assert.rejects(() => engine.finalizeProductReplacement(db, '2026-10-08'), error => error.code === 'product_has_stock' && error.status === 409)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=31').get().is_active, 1)
    console.log('PASS finalizer race aborts empty sibling deactivation')
  }
  {
    const { raw, db } = fixture(); product(raw, 41)
    raw.prepare('UPDATE products SET is_active=0 WHERE id=41').run()
    await assert.rejects(() => commits.applyUnifiedStockAdd(db, {
      jobId: 'inactive', rowNumber: 1, productId: 41, productName: 'Probe 41', branchId: 991,
      branchName: 'Probe', quantity: 1, date: '2026-10-01', supplierName: 'Supplier', costPriceUsd: 2,
    }), error => error.code === 'product_has_stock' && error.status === 409)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM import_stock_action_commits').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    console.log('PASS inactive stock-action inbound leaves no commit or movement')
  }
  {
    const { raw, db } = fixture(); product(raw, 42)
    const batch = db.batch
    db.batch = items => { raw.prepare('UPDATE products SET is_active=0 WHERE id=42').run(); return batch(items) }
    await assert.rejects(() => commits.applyUnifiedStockAdd(db, {
      jobId: 'raced-inactive', rowNumber: 1, productId: 42, productName: 'Probe 42', branchId: 991,
      branchName: 'Probe', quantity: 1, date: '2026-10-01', supplierName: 'Supplier', costPriceUsd: 2,
    }), error => error.code === 'product_has_stock')
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM import_stock_action_commits').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM product_batches').get().n, 0)
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    console.log('PASS inbound product-deactivation race rolls back every receipt effect')
  }
  {
    const { raw, db } = fixture(); product(raw, 51, 1); product(raw, 52); product(raw, 53, 3)
    raw.prepare("UPDATE products SET updated_at='2026-10-09' WHERE id=53").run()
    raw.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(91,'operator','Operator','hash','{\"all\":true}',1)").run()
    raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
      VALUES('replacement','products','failed','applying',@policy,1,1,'{}','2026-10-08')`)
      .run({ policy: JSON.stringify({ apply_authorized_by_id: 91, import_mode: 'replace_all' }) })
    raw.prepare(`INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)
      VALUES('replacement',0,2,'{"_rowNumber":2,"name":"Probe 53","stock_quantity":"3"}')`).run()
    raw.prepare(`INSERT INTO import_job_rows(job_id,phase,row_number,action,result_json)
      VALUES('replacement','apply',2,'update','{"rowNumber":2,"action":"update","data":{}}')`).run()
    await assert.rejects(() => engine.runImportApply({ DB: db }, 'replacement'), error => error.code === 'product_has_stock')
    const job = raw.prepare("SELECT * FROM import_jobs WHERE id='replacement'").get()
    assert.equal(job.status, 'failed'); assert.equal(job.phase, 'replace_all_refused'); assert.equal(job.processed_rows, 1)
    assert.equal(job.chunk_cursor, 1); assert.equal(JSON.parse(job.summary_json).replacement_refused.committedRows, 1)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=52').get().is_active, 1)
    assert.equal(raw.prepare('SELECT stock_quantity FROM products WHERE id=53').get().stock_quantity, 3)
    raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=51').run()
    await engine.runImportApply({ DB: db, ASSETS: { list: async () => ({ objects: [] }) } }, 'replacement')
    assert.equal(raw.prepare('SELECT stock_quantity FROM products WHERE id=53').get().stock_quantity, 3)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id='replacement' AND phase='apply'").get().n, 1)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=52').get().is_active, 0)
    assert.equal(JSON.parse(raw.prepare("SELECT summary_json FROM import_jobs WHERE id='replacement'").get().summary_json).replacement_refused, undefined)
    console.log('PASS real apply refuses finalizer with truthful committed count and retries only saved phase')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
