const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const { loadAll } = require('./harness/load_migrations.cjs')
const migration = fs.readFileSync(path.join(__dirname,'../migrations/0243_stock_schema_epoch.sql'),'utf8')
assert.equal(migration.includes('\r'), false, 'trigger migration must be LF only')
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const m={exports:{}}
  new Function('require','module','exports',code)(name => name==='./importMaintenanceFence'?{}:require(name),m,m.exports)
  return m.exports
}
const api=load('stockTransaction.ts'), {D1Compat}=load('db.ts')
const epoch=api.STOCK_SCHEMA_EPOCH
const flag=(key,value)=>({sql:'INSERT INTO system_flags(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)',args:[key,value]})
const fixture=[
  {sql:"INSERT INTO products(id,name,stock_quantity) VALUES(1001,'stock',7),(1002,'empty',0)"},
  {sql:"INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1001,1001,'fixture')"},
  {sql:'INSERT INTO branch_stock(id,product_id,branch_id,quantity) VALUES(1001,1001,1,7)'},
  {sql:'INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity) VALUES(1001,1001,1,7)'},
  {sql:'INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining) VALUES(1001,1001,1,1001,2,2)'},
  {sql:"INSERT INTO stock_mutation_receipts(id,actor_id,request_id,kind,request_json) VALUES(41,1,'before','adjust','[]')"}
]
const oldWrites=[
  "INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1002,1,0)",
  'UPDATE branch_stock SET quantity=8 WHERE id=1001',
  'UPDATE branch_stock SET product_id=1002 WHERE id=1001',
  'UPDATE branch_stock SET branch_id=2 WHERE id=1001',
  'UPDATE branch_stock SET id=1009 WHERE id=1001',
  'DELETE FROM branch_stock WHERE id=1001',
  'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1001,2,0)',
  'UPDATE branch_batch_stock SET quantity=8 WHERE id=1001',
  'UPDATE branch_batch_stock SET batch_id=1009 WHERE id=1001',
  'UPDATE branch_batch_stock SET branch_id=2 WHERE id=1001',
  'UPDATE branch_batch_stock SET id=1009 WHERE id=1001',
  'DELETE FROM branch_batch_stock WHERE id=1001',
  'INSERT INTO damaged_stock_lots(product_id,quantity,quantity_remaining) VALUES(1002,0,0)',
  'UPDATE damaged_stock_lots SET quantity_remaining=1 WHERE id=1001',
  'UPDATE damaged_stock_lots SET product_id=1002 WHERE id=1001',
  'UPDATE damaged_stock_lots SET batch_id=1009 WHERE id=1001',
  'UPDATE damaged_stock_lots SET branch_id=2 WHERE id=1001',
  'UPDATE damaged_stock_lots SET id=1009 WHERE id=1001',
  'DELETE FROM damaged_stock_lots WHERE id=1001',
  "INSERT INTO products(id,name) VALUES(1003,'old')",
  'UPDATE products SET stock_quantity=8 WHERE id=1001',
  'UPDATE products SET id=1009 WHERE id=1002',
  'UPDATE products SET is_active=0 WHERE id=1002',
  'DELETE FROM products WHERE id=1002',
  "INSERT INTO product_batches(variant_product_id,batch_key) VALUES(1002,'old')",
  'UPDATE product_batches SET id=1009 WHERE id=1001',
  'UPDATE product_batches SET variant_product_id=1002 WHERE id=1001',
  'UPDATE product_batches SET is_active=0 WHERE id=1001',
  'DELETE FROM product_batches WHERE id=1001'
]
let controls=0
const check=(actual,expected)=>{assert.equal(actual,expected);controls++}
const baseSql=loadAll({through:242})
function nativeBase(seed=true, filename=':memory:') {
  const db=new DatabaseSync(filename)
  for(const sql of baseSql) db.exec(sql)
  if(seed) for(const stmt of fixture) db.prepare(stmt.sql).run(...(stmt.args||[]))
  return db
}
function install(db) {
  db.exec('BEGIN IMMEDIATE')
  try {db.exec(migration);db.exec('COMMIT')} catch(e){db.exec('ROLLBACK');throw e}
}
function nflag(db,key,value){db.prepare(flag(key,value).sql).run(key,value)}
function nativeControls(){
  const db=nativeBase();const before=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n
  const existingTriggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
  const pre=db.prepare('SELECT quantity FROM branch_stock WHERE id=1001').get().quantity
  db.prepare(oldWrites[1]).run();check(db.prepare('SELECT quantity FROM branch_stock WHERE id=1001').get().quantity,8)
  db.prepare('UPDATE branch_stock SET quantity=? WHERE id=1001').run(pre)
  install(db)
  check(db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").get().value,'41')
  check(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n,before+18)
  for(const trigger of existingTriggers){check(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(trigger.name).sql,trigger.sql)}
  db.exec('BEGIN');nflag(db,'stock_transaction_permit',epoch)
  assert.throws(()=>db.exec('DELETE FROM products WHERE id=1001'),/product_has_stock/);controls++
  db.exec('ROLLBACK')
  for(const sql of oldWrites){assert.throws(()=>db.exec(sql),/stock_transaction_required/);controls++}
  db.exec("UPDATE products SET name='metadata' WHERE id=1001; UPDATE product_batches SET notes='metadata' WHERE id=1001")
  check(db.prepare('SELECT name FROM products WHERE id=1001').get().name,'metadata')
  db.exec('UPDATE branch_stock SET quantity=99 WHERE id=-1');controls++
  for(const val of ['','corrupt','counted-tag-v2']){
    db.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(val)
    nflag(db,'stock_transaction_permit',val)
    assert.throws(()=>db.exec(oldWrites[1]),/stock_transaction_required/);controls++
    db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  }
  db.exec("DELETE FROM system_flags WHERE key='stock_schema_epoch'")
  nflag(db,'stock_transaction_permit',epoch)
  assert.throws(()=>db.exec(oldWrites[1]),/stock_transaction_required/);controls++
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  nflag(db,'stock_schema_epoch',epoch)
  nflag(db,'stock_transaction_permit','wrong')
  assert.throws(()=>db.exec(oldWrites[1]),/stock_transaction_required/);controls++
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  for(const key of ['sale_record_events_reset_guard','sale_incident_recovery_reset_guard','sale_not_paid_stock_recovery_reset_guard','maintenance']){
    assert.throws(()=>nflag(db,key,'{}'),/stock_transaction_required/);controls++
  }
  db.exec('BEGIN');nflag(db,'stock_transaction_permit',epoch);nflag(db,'maintenance','{"mode":"restore","token":"new"}')
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT")
  for(const sql of oldWrites){assert.throws(()=>db.exec(sql),/stock_transaction_required/);controls++}
  assert.throws(()=>db.exec("UPDATE system_flags SET value='{}' WHERE key='maintenance'"),/stock_transaction_required/);controls++
  db.exec("DELETE FROM system_flags WHERE key='maintenance'")
  for(const sql of oldWrites){assert.throws(()=>db.exec(sql),/stock_transaction_required/);controls++}
  db.exec("INSERT INTO stock_mutation_receipts(id,actor_id,request_id,kind,request_json) VALUES(99,1,'after','adjust','[]')")
  check(db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").get().value,'41')
  check(db.prepare('SELECT quantity FROM branch_stock WHERE id=1001').get().quantity,7)
  check(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
  db.close()
  const holds=[flag('maintenance','{}'),flag('stock_transaction_permit',epoch),
    {sql:"INSERT INTO import_jobs(id,type,status) VALUES('hold','products','running')"},
    {sql:"INSERT INTO import_jobs(id,type,status,lease_expires_at) VALUES('hold','products','failed','2999-01-01')"},
    {sql:"INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('hold','products','processing','fixture','[]',0)"}]
  for(const hold of holds){const held=nativeBase();held.prepare(hold.sql).run(...(hold.args||[]));assert.throws(()=>install(held),/stock_schema_installation_conflict/);controls++
    check(held.prepare("SELECT COUNT(*) n FROM system_flags WHERE key IN ('stock_schema_epoch','stock_schema_receipt_boundary')").get().n,0)
    check(held.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'stock_epoch_%_0243'").get().n,0);held.close()}
  const empty=nativeBase(false);install(empty)
  check(empty.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").get().value,'0')
  for(const key of ['sale_record_events_reset_guard','sale_incident_recovery_reset_guard','sale_not_paid_stock_recovery_reset_guard']){assert.throws(()=>nflag(empty,key,'{"mode":"reset","token":"old"}'),/stock_transaction_required/);controls++}
  empty.close()
}
function competingConnections(){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'stock-schema-epoch-'))
  const file=path.join(folder,'fixture.sqlite')
  const first=nativeBase(true,file), second=new DatabaseSync(file)
  try{
    first.exec('BEGIN IMMEDIATE')
    nflag(first,'maintenance','{"mode":"restore","token":"old-owner"}')
    assert.throws(()=>install(second),/database is locked/);controls++
    first.exec('COMMIT')
    assert.throws(()=>install(second),/stock_schema_installation_conflict/);controls++
    first.exec("DELETE FROM system_flags WHERE key='maintenance'")
    first.exec('BEGIN IMMEDIATE');first.exec(migration)
    assert.throws(()=>nflag(second,'maintenance','{"mode":"restore","token":"late-old"}'),/database is locked/);controls++
    first.exec('COMMIT')
    assert.throws(()=>nflag(second,'maintenance','{"mode":"restore","token":"late-old"}'),/stock_transaction_required/);controls++
    assert.throws(()=>second.exec(oldWrites[1]),/stock_transaction_required/);controls++
    check(second.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").get().value,'41')
  }finally{first.close();second.close();fs.rmSync(folder,{recursive:true,force:true})}
}
async function d1Controls(){
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB'],log:new Log(LogLevel.ERROR)})
  try{
    const raw=await mf.getD1Database('DB')
    const dir=path.join(__dirname,'../migrations')
    for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.sql')&&Number(n.slice(0,4))<=242).sort()){
      for(const sql of split(fs.readFileSync(path.join(dir,name),'utf8'))){
        await raw.prepare(sql).run()
      }
    }
    await raw.batch(fixture.map(s=>raw.prepare(s.sql).bind(...(s.args||[]))))
    const old=raw.prepare(oldWrites[1])
    await old.run();await raw.prepare('UPDATE branch_stock SET quantity=7 WHERE id=1001').run()
    await raw.batch(split(migration).map(sql=>raw.prepare(sql)))
    check(await raw.prepare("SELECT value FROM system_flags WHERE key='stock_schema_receipt_boundary'").first('value'),'41')
    for(const sql of oldWrites){await assert.rejects(raw.prepare(sql).run(),/stock_transaction_required/);controls++}
    await assert.rejects(raw.batch([
      raw.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(1,'rolled-back-old','adjust','[]')"), old
    ]),/stock_transaction_required/);controls++
    check(await raw.prepare("SELECT COUNT(*) n FROM stock_mutation_receipts WHERE request_id='rolled-back-old'").first('n'),0)
    const noRow=await raw.batch([
      raw.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(1,'no-row-control','adjust','[]')"),
      raw.prepare('UPDATE branch_stock SET quantity=99 WHERE id=-1')
    ])
    check(noRow[1].meta.changes,0)
    await raw.prepare("UPDATE products SET name='D1 metadata' WHERE id=1001").run()
    await raw.prepare("UPDATE product_batches SET notes='D1 metadata' WHERE id=1001").run()
    const db=new D1Compat(raw)
    const writes=[{sql:'UPDATE branch_stock SET quantity=quantity+1 WHERE id=1001 RETURNING quantity'}, {sql:"INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(1,'new','adjust','[]') RETURNING id"}]
    const out=await api.executeStockTransaction(db,writes,'once');check(out.length,2);check(out[0].results[0].quantity,8)
    check(await raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),0)
    await api.executeRawStockTransaction(raw,[raw.prepare('UPDATE branch_stock SET quantity=quantity-1 WHERE id=1001 RETURNING quantity')])
    for(const e of [null,'','corrupt','counted-tag-v2']){
      if(e===null)await raw.prepare("DELETE FROM system_flags WHERE key='stock_schema_epoch'").run()
      else await raw.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(e).run()
      await assert.rejects(api.executeStockTransaction(db,writes,'once'),err=>err.code==='stock_schema_unavailable');controls++
      check(await raw.prepare('SELECT quantity FROM branch_stock WHERE id=1001').first('quantity'),7)
      check(await raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),0)
    }
    await raw.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").bind(epoch).run()
    await assert.rejects(api.executeStockTransaction(db,[writes[0],{sql:"INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(1,'before','adjust','[]')"}],'once'),/UNIQUE/);controls++
    check(await raw.prepare('SELECT quantity FROM branch_stock WHERE id=1001').first('quantity'),7)
    check(await raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),0)
    await raw.prepare(flag('stock_transaction_permit',epoch).sql).bind('stock_transaction_permit',epoch).run()
    await assert.rejects(api.executeStockTransaction(db,writes,'once'),/UNIQUE/);controls++
    check(await raw.prepare('SELECT quantity FROM branch_stock WHERE id=1001').first('quantity'),7)
    await raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
    let calls=0
    const lost=new Proxy(raw,{get(t,k){if(k==='batch')return async stmts=>{calls++;await t.batch(stmts);throw Error('lost acknowledgement')};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v}})
    await assert.rejects(api.executeRawStockTransaction(lost,[raw.prepare(writes[0].sql)]),/lost acknowledgement/);check(calls,1)
    check(await raw.prepare('SELECT quantity FROM branch_stock WHERE id=1001').first('quantity'),8)
    check(await raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").first('n'),0)
    await api.executeRawStockTransaction(raw,[raw.prepare(flag('maintenance','{}').sql).bind('maintenance','{}')])
    await assert.rejects(old.run(),/stock_transaction_required/);controls++
    await assert.rejects(api.executeStockTransaction(db,[],'once'),err=>err.code==='stock_schema_unavailable');controls++
    await raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    await assert.rejects(old.run(),/stock_transaction_required/);controls++
  }finally{await mf.dispose()}
}
;(async()=>{nativeControls();competingConnections();await d1Controls();console.log('PASS stock schema epoch actual0243: '+controls+' native SQLite/Miniflare controls; fixture seeded before barrier, all old physical/identity writers refused; executor/rollback/lost ACK/maintenance/reset/installation holds/boundary')})().catch(e=>{console.error(e);process.exitCode=1})
