const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const dispositionSchema = require('./harness/stock_disposition_schema.cjs')
assert.equal(dispositionSchema.includes('\r'),false)
assert.equal(loadAll().filter(sql=>sql===dispositionSchema).length,1)
const cache = new Map()
let actorId = 71
const overrides = {
  '../lib/auth': { requireAuth: async (c,next) => { c.set('user',{ id:actorId,permissions:'{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true}' }); return next() } },
  '../lib/telegram': { sendTelegramEvent:async()=>{},formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[] },
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname,'../src',rel)
  let source = process.env.STOCK_DISPOSITION_BASELINE && rel === 'routes/inventory.ts'
    ? execFileSync('git',['show','e42815342b5910e1be87760e70900758d819fccd:cloudflare/src/routes/inventory.ts'],{ cwd:path.join(__dirname,'../..'),encoding:'utf8' })
    : fs.readFileSync(sourcePath,'utf8')
  if (process.env.STOCK_DISPOSITION_ROUNDED_BASIS_CONTROL && rel === 'lib/stockDispositionBasis.ts') {
    assert.ok(source.includes('const grossTake = gross * ratioNumerator / ratioDenominator'))
    source=source.replace('const grossTake = gross * ratioNumerator / ratioDenominator','const grossTake = BigInt(Math.round(Number(gross) * Number(available.denominator) / Number(available.numerator))) * take.numerator / take.denominator')
  }
  const output = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },fileName:sourcePath }).outputText
  const mod = { exports:{} }; cache.set(rel,mod)
  const requireLocal = request => {
    if (Object.hasOwn(overrides,request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel),request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require','module','exports',output)(requireLocal,mod,mod.exports)
  return mod.exports
}
const app = load('routes/inventory.ts').default
const kernel = load('lib/stockDisposition.ts')
const { getDb } = load('lib/db.ts')
const context = { waitUntil(){},passThroughOnException(){} }
function fixture(hooks={},lot={ quantity:4,free:1,cost:9.9999,gross4:99999 }) {
  const db = openDb(loadAll()).db
  db.limits.variableNumber=100
  assert.equal(db.limits.exprDepth,100); assert.equal(db.limits.variableNumber,100)
  db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(71,'kernel_writer','Kernel Writer','admin123','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true}',1),(72,'other_writer','Other Writer','admin123','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true}',1);
    INSERT INTO suppliers(id,name) VALUES(77,'Fixture supplier');
    INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(10,'Basis fixture','BASIS',${lot.quantity},1);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
    VALUES(500,10,'basis-lot','BASIS','2026-10-01',1,1,77,'credit',${lot.quantity},${lot.cost},1,2.5);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,${lot.quantity});
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,${lot.quantity});
    INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(900,10,1,500,'add',${lot.quantity},${lot.free},${lot.cost},'original-receipt',71);
    INSERT INTO stock_disposition_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,funding_state)
    VALUES('source-900',900,500,10,1,77,'${lot.quantity}','${lot.free}',${lot.gross4},0,${lot.gross4},'reconciled_unpaid');`)
  db.exec('PRAGMA foreign_keys=ON')
  let maxBindings=0
  function prepared(sql,values=[]) {
    maxBindings=Math.max(maxBindings,values.length)
    const execute=()=>{
      const stmt=db.prepare(sql)
      if (/^\s*(?:SELECT|WITH)\b/i.test(sql)) return { success:true,results:sqliteD1Call(stmt,'all',values),meta:{ changes:0 } }
      const result=sqliteD1Call(stmt,'run',values)
      return { success:true,results:[],meta:{ changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid) } }
    }
    return { sql,values,execute,bind:(...params)=>prepared(sql,params),all:async()=>execute(),run:async()=>execute(),first:async()=>execute().results[0] ?? null }
  }
  const batchSizes=[]
  const d1={ prepare:prepared,batch:async statements=>{
    batchSizes.push(statements.length)
    if (hooks.beforeBatch) { const hook=hooks.beforeBatch; delete hooks.beforeBatch; await hook(db,statements) }
    const atomic=!process.env.STOCK_DISPOSITION_NONATOMIC_CONTROL
    if (atomic) db.exec('BEGIN IMMEDIATE')
    let results
    try { results=statements.map((statement,index)=>{
      if (hooks.failAt===index) throw new Error('injected statement failure')
      return statement.execute()
    }); if (atomic) db.exec('COMMIT') } catch(error) { if (atomic) db.exec('ROLLBACK'); throw error }
    if (hooks.afterCommit) { const hook=hooks.afterCommit; delete hooks.afterCommit; await hook(db) }
    if (hooks.afterBatchThrow) { delete hooks.afterBatchThrow; throw new Error('simulated lost response') }
    return results
  } }
  const baseline=Object.fromEntries(['fees','fee_operation_receipts','audit_logs','inventory_movements'].map(table=>[table,Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)]))
  return { db,d1,hooks,baseline,batchSizes,maxBindings:()=>maxBindings }
}
const hold=(request='hold-request-0001',overrides={})=>({ kind:'hold',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:2,coverage_usd:3,coverage_state:'accepted_credit',condition_tag:'broken',reason:'Broken receipt units',extra_fee_usd:0.7,expected_generation:0,client_request_id:request,...overrides })
async function post(f,body,enabled=true) {
  const response=await app.request('/disposition-experiment',{ method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify(body) },{ DB:f.d1,...(enabled ? { STOCK_DISPOSITION_EXPERIMENT:'local-fixture-only' } : {}) },context)
  let data; try { data=await response.json() } catch { data=null }
  return { status:response.status,data }
}
const count=(f,table)=>Number(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)
const snapshot=f=>JSON.stringify(['product_batches','branch_batch_stock','branch_stock','products','inventory_movements','stock_disposition_allocations','stock_disposition_events','stock_disposition_receipts','stock_disposition_fees','fees','fee_operation_receipts','audit_logs'].map(table=>f.db.prepare(`SELECT * FROM ${table}`).all()))
async function permissionControls() {
    const f=fixture(); assert.equal((await post(f,hold())).status,200)
    f.db.exec(`UPDATE users SET permissions='{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":false}' WHERE id=71`)
    assert.equal((await post(f,hold())).status,403,'fee-only revocation must fence cached extra-fee replay')
    const noFee=hold('no-fee-request-0001',{ quantity:1,coverage_usd:0,coverage_state:'none',extra_fee_usd:0,expected_generation:1 })
    assert.equal((await post(f,noFee)).status,200,'no-fee command retains independent inventory permission')
    f.db.exec('DROP TRIGGER IF EXISTS stock_lifecycle_batch_update')
    f.db.exec('UPDATE product_batches SET received_cost_usd=20 WHERE id=500')
    assert.equal((await post(f,noFee)).status,200,'authorized read-only replay does not reread changed entity')
    const lost=fixture({ afterBatchThrow:true,afterCommit:db=>db.exec(`UPDATE users SET permissions='{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":false}' WHERE id=71`) })
    assert.equal((await post(lost,hold())).status,403,'fee-only revocation must fence lost-response recovery')
    assert.equal(count(lost,'stock_disposition_events'),1); assert.equal(count(lost,'fees'),lost.baseline.fees+1)
    f.db.close(); lost.db.close(); console.log('PASS current required fee permission before cached replay and committed-lost-response recovery; no-fee independent and read-only entity replay'); return
}
async function silentControls() {
    for (const [name,sql] of [
      ['fee','CREATE TRIGGER ignore_fee BEFORE INSERT ON fees BEGIN SELECT RAISE(IGNORE); END'],
      ['fee receipt','CREATE TRIGGER ignore_fee_receipt BEFORE INSERT ON fee_operation_receipts BEGIN SELECT RAISE(IGNORE); END'],
      ['fee link','CREATE TRIGGER ignore_fee_link BEFORE INSERT ON stock_disposition_fees BEGIN SELECT RAISE(IGNORE); END'],
      ['fee audit',"CREATE TRIGGER ignore_fee_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='fee' BEGIN SELECT RAISE(IGNORE); END"],
      ['stock audit',"CREATE TRIGGER ignore_stock_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='stock_disposition' BEGIN SELECT RAISE(IGNORE); END"],
      ['allocation','CREATE TRIGGER ignore_allocation BEFORE INSERT ON stock_disposition_allocations BEGIN SELECT RAISE(IGNORE); END'],
      ['event','CREATE TRIGGER ignore_event BEFORE INSERT ON stock_disposition_events BEGIN SELECT RAISE(IGNORE); END'],
      ['receipt','CREATE TRIGGER ignore_stock_receipt BEFORE INSERT ON stock_disposition_receipts BEGIN SELECT RAISE(IGNORE); END'],
      ['batch stock','CREATE TRIGGER ignore_batch_stock BEFORE UPDATE ON branch_batch_stock BEGIN SELECT RAISE(IGNORE); END'],
      ['branch stock','CREATE TRIGGER ignore_branch_stock BEFORE UPDATE ON branch_stock BEGIN SELECT RAISE(IGNORE); END'],
      ['catalog stock','CREATE TRIGGER ignore_catalog_stock BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END'],
      ['CHECK guards','CREATE TRIGGER ignore_check_guards BEFORE INSERT ON stock_disposition_guards BEGIN SELECT RAISE(IGNORE); END'],
      ['guard cleanup','CREATE TRIGGER ignore_guard_cleanup BEFORE DELETE ON stock_disposition_guards BEGIN SELECT RAISE(IGNORE); END'],
      ['fee money mismatch',"CREATE TRIGGER corrupt_fee_money AFTER INSERT ON fees BEGIN UPDATE fees SET amount_usd=9.7 WHERE id=NEW.id; END"],
      ['fee branch mismatch',"CREATE TRIGGER corrupt_fee_branch AFTER INSERT ON fees BEGIN UPDATE fees SET branch_id=NULL WHERE id=NEW.id; END"],
    ]) {
      const f=fixture(); f.db.exec(sql); const before=snapshot(f)
      const result=await post(f,hold())
      assert.equal(result.status,409,`${name}: ignored writes must fail closed`)
      assert.ok(snapshot(f)===before,`${name}: ignored writes rollback all data`)
      assert.equal(count(f,'stock_disposition_guards'),0,`${name}: no leaked assertion guard`)
      f.db.close(); console.log(`PASS silent ${name} refuses409 and full rollback`)
    }
    return
}
async function jsonReceiptControls() {
  const controls = [
    ['false KHR',sql=>sql.replace(/'amount_khr',\?\d+/g,"'amount_khr',json('false')")],
    ['duplicate id',sql=>sql.replace("'id',last_insert_rowid(),","'id',last_insert_rowid(),'id',999,")],
    ['duplicate fee envelope',sql=>sql.replace(/('updated_at',\?\d+\s*)\)\),/,"$1),'fee',json_object('id',999)),")],
    ['duplicate expected key',sql=>sql.replace(/('label',\?\d+,)/,"$1$1")],
    ['extra outer key',sql=>sql.replace("json_object('fee',json_object(","json_object('unknown','extra','fee',json_object(")],
    ['missing key',sql=>sql.replace(/'label',\?\d+,/,"")],
    ['unknown fee key',sql=>sql.replace("'id',last_insert_rowid(),","'unknown','extra','id',last_insert_rowid(),")],
    ['true branch',sql=>sql.replace(/'branch_id',\?\d+/,"'branch_id',json('true')")],
    ['string id',sql=>sql.replace("'id',last_insert_rowid(),","'id',CAST(last_insert_rowid() AS TEXT),")],
    ['null numeric',sql=>sql.replace(/'amount_usd',\?\d+/,"'amount_usd',NULL")],
    ['string zero',sql=>sql.replace(/'amount_khr',\?\d+/,"'amount_khr','0'")],
    ['duplicate escaped id',sql=>sql.replace("json_object('fee',json_object(","replace(json_object('fee',json_object(").replace(/('updated_at',\?\d+\s*)\)\),/,"$1)),'}}',',\"\\u0069d\":999}}'),")],
    ['array fee',sql=>sql.replace("json_object('fee',json_object(","json_object('fee',json_array(")],
    ['missing fee envelope',sql=>sql.replace("json_object('fee',json_object(","json_object('other',json_object(")],
    ['real id schema refusal',sql=>sql.replace("'id',last_insert_rowid(),","'id',CAST(last_insert_rowid() AS REAL),")],
  ]
  const selected=process.env.STOCK_DISPOSITION_JSON_CASE
  const expectedControls=selected ? controls.filter(([name])=>name===selected) : controls
  if (selected) assert.equal(expectedControls.length,1)
  for (const [name,mutate] of expectedControls) {
    const f=fixture(); let captured=0
    f.hooks.beforeBatch=(_db,statements)=>{
      for (let i=0;i<statements.length;i++) {
        const statement=statements[i]
        if (!statement.sql.includes('INSERT INTO fee_operation_receipts')) continue
        const sql=mutate(statement.sql)
        assert.notEqual(sql,statement.sql,`${name}: provider fault must change actual captured SQL`)
        statements[i]=f.d1.prepare(sql).bind(...statement.values); captured++
      }
    }
    const before=snapshot(f),result=await post(f,hold())
    assert.equal(captured,1,`${name}: one actual production-adapter statement captured`)
    assert.equal(result.status,409,`${name}: strict JSON receipt refuses corruption`)
    assert.ok(snapshot(f)===before,`${name}: full atomic rollback`)
    assert.equal(count(f,'stock_disposition_guards'),0)
    f.db.close(); console.log(`PASS provider SQL-fault ${name} refuses409 and full rollback`)
  }
  if (selected) return
  const valid=fixture()
  valid.hooks.beforeBatch=(_db,statements)=>{
    for (let i=0;i<statements.length;i++) {
      const statement=statements[i]
      if (!statement.sql.includes('INSERT INTO fee_operation_receipts')) continue
      const sql=statement.sql.replace(/'amount_khr',(\?\d+)/,"'amount_khr',CAST($1 AS INTEGER)").replace(/'branch_id',(\?\d+)/,"'branch_id',CAST($1 AS INTEGER)")
      statements[i]=valid.d1.prepare(sql).bind(...statement.values)
    }
  }
  assert.equal((await post(valid,hold())).status,200,'legitimate integer/real JSON values remain equivalent')
  const row=valid.db.prepare('SELECT * FROM fee_operation_receipts WHERE fee_id=(SELECT fee_id FROM stock_disposition_fees)').get()
  const parsed=load('lib/feeOperationReceipt.ts').feeOperationReceiptResponse(row)
  assert.equal(typeof parsed.fee.id,'number'); assert.equal(parsed.fee.id,row.fee_id)
  valid.db.close(); console.log('PASS strict receipt feeOperationReceiptResponse parses actual linked numeric id; integer/real equivalence')
}
;(async()=>{
  if (process.env.STOCK_DISPOSITION_POSTCONDITION_CASE === 'permission') return permissionControls()
  if (process.env.STOCK_DISPOSITION_POSTCONDITION_CASE === 'silent') return silentControls()
  if (process.env.STOCK_DISPOSITION_POSTCONDITION_CASE === 'json') return jsonReceiptControls()
  const f=fixture()
  const original=snapshot(f)
  assert.equal((await post(f,hold(),false)).status,404)
  assert.equal(snapshot(f),original)
  const first=await post(f,hold())
  assert.equal(first.status,200,JSON.stringify(first))
  const holdStatementCount=f.batchSizes[0]
  assert.ok(holdStatementCount>14,'postconditions add atomic Hold boundaries')
  assert.equal(count(f,'stock_disposition_guards'),0)
  assert.equal(first.data.gross4,49999); assert.equal(first.data.net4,19999); assert.equal(first.data.recognized4,0)
  assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500').get().quantity,2)
  assert.equal(f.db.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity,2)
  assert.equal(f.db.prepare('SELECT received_cost_usd FROM product_batches WHERE id=500').get().received_cost_usd,9.9999)
  assert.equal(f.db.prepare('SELECT quantity,free_quantity FROM inventory_movements WHERE id=900').get().free_quantity,1)
  assert.equal(count(f,'fees'),f.baseline.fees+1); assert.equal(count(f,'fee_operation_receipts'),f.baseline.fee_operation_receipts+1); assert.equal(count(f,'audit_logs'),f.baseline.audit_logs+2)
  assert.equal(f.db.prepare('SELECT amount_usd FROM fees WHERE id=(SELECT fee_id FROM stock_disposition_fees)').get().amount_usd,0.7)
  const beforeReplay=snapshot(f)
  assert.equal((await post(f,hold())).data.replayed,true); assert.equal(snapshot(f),beforeReplay)
  for (const change of [{ quantity:1 },{ reason:'Other' },{ coverage_usd:2 },{ condition_tag:'damaged' },{ expected_generation:1 },{ supplier_id:78 },{ batch_id:501 },{ product_id:11 },{ extra_fee_usd:0 }]) assert.equal((await post(f,hold('hold-request-0001',change))).status,409)
  actorId=72; assert.equal((await post(f,hold())).status,409); actorId=71
  assert.throws(()=>f.db.prepare('DELETE FROM fees WHERE id=(SELECT fee_id FROM stock_disposition_fees)').run(),/FOREIGN KEY|stock_lifecycle_dependency/)
  assert.throws(()=>f.db.prepare('UPDATE stock_disposition_events SET quantity=99').run(),/immutable/)
  assert.throws(()=>f.db.prepare('UPDATE stock_disposition_sources SET gross4=0').run(),/immutable/)
  const dispose={ kind:'dispose',source_id:'source-900',batch_id:500,product_id:10,branch_id:1,supplier_id:77,allocation_id:first.data.allocation_id,quantity:1,reason:'Disposed broken unit',expense_category:'broken goods',expected_generation:1,client_request_id:'dispose-request-0001' }
  const second=await post(f,dispose)
  const disposeStatementCount=f.batchSizes.at(-1)
  assert.ok(disposeStatementCount>6,'postconditions add atomic Dispose boundaries')
  assert.equal(second.status,200,JSON.stringify(second)); assert.equal(second.data.recognized4,9999); assert.equal(second.data.remaining_gross4-second.data.remaining_coverage4,10000)
  let projection=await kernel.stockDispositionProjection(getDb({ DB:f.d1 }),'source-900')
  assert.equal(projection.held_net4,10000); assert.equal(projection.recognized_loss4,9999); assert.equal(projection.debt4,69999); assert.equal(projection.extra_cash_fee4,7000)
  const third=await post(f,{ ...dispose,expected_generation:2,client_request_id:'dispose-request-0002' })
  assert.equal(third.status,200); assert.equal(third.data.recognized4,10000); assert.equal(third.data.remaining_quantity,'0')
  projection=await kernel.stockDispositionProjection(getDb({ DB:f.d1 }),'source-900')
  assert.equal(projection.sellable_gross4+projection.held_gross4+f.db.prepare("SELECT SUM(gross4) n FROM stock_disposition_events WHERE kind='dispose'").get().n,99999)
  assert.equal(projection.recognized_loss4,19999); assert.equal(count(f,'fees'),f.baseline.fees+1); assert.equal(count(f,'inventory_movements'),f.baseline.inventory_movements)
  assert.equal((await post(f,{ ...dispose,expected_generation:3,client_request_id:'dispose-request-0003' })).status,409)
  for (const change of [{ quantity:0 },{ quantity:1.1e9 },{ quantity:'0.123456789012345678901' },{ coverage_usd:-1 },{ coverage_usd:null },{ coverage_state:'pending' },{ coverage_usd:'Infinity' },{ coverage_usd:10 },{ extra_fee_usd:-1 },{ kind:'repair' },{ reason:'' }]) {
    const x=fixture(); const before=snapshot(x); assert.equal((await post(x,hold('invalid-request-0001',change))).status,400); assert.equal(snapshot(x),before); x.db.close()
  }
  for (let failAt=0;failAt<holdStatementCount;failAt++) {
    const x=fixture({ failAt }); const before=snapshot(x); assert.equal((await post(x,hold())).status,409,`failure index ${failAt}`); assert.ok(snapshot(x)===before,`rollback index ${failAt}`); assert.equal(count(x,'stock_disposition_guards'),0); x.db.close()
  }
  for (const sql of ["UPDATE product_batches SET received_cost_usd=10 WHERE id=500","UPDATE inventory_movements SET free_quantity=0 WHERE id=900","UPDATE users SET permissions='{}' WHERE id=71","UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=500","UPDATE branches SET is_active=0 WHERE id=1","INSERT INTO system_flags(key,value) VALUES('maintenance','active')"]) {
    const x=fixture({ beforeBatch:db=>db.exec(sql) }); const response=await post(x,hold()); assert.ok([403,409].includes(response.status),JSON.stringify(response)); assert.equal(count(x,'stock_disposition_events'),0); assert.equal(count(x,'fees'),x.baseline.fees); x.db.close()
  }
  const lost=fixture({ afterBatchThrow:true }); const lostResult=await post(lost,hold()); assert.equal(lostResult.status,200); assert.equal(lostResult.data.replayed,true); assert.equal(count(lost,'fees'),lost.baseline.fees+1); assert.equal(count(lost,'stock_disposition_events'),1); lost.db.close()
  const denied=fixture(); denied.db.exec("UPDATE users SET permissions='{}' WHERE id=71"); assert.equal((await post(denied,hold())).status,403); assert.equal(count(denied,'fees'),denied.baseline.fees); denied.db.close()
  const unknown=fixture(); unknown.db.exec('DROP TRIGGER IF EXISTS stock_lifecycle_batch_update'); unknown.db.exec('UPDATE product_batches SET received_cost_usd=NULL WHERE id=500'); assert.equal((await post(unknown,hold())).status,409); unknown.db.close()
  const paid=fixture(); paid.db.exec("DROP TRIGGER IF EXISTS stock_lifecycle_batch_update"); paid.db.exec("UPDATE product_batches SET payment_status='paid' WHERE id=500"); assert.equal((await post(paid,hold())).status,409); paid.db.close()
  const zero=fixture({}, { quantity:4,free:1,cost:0,gross4:0 }); const zeroHold=await post(zero,hold('zero-hold-0001',{ coverage_usd:0,coverage_state:'none',extra_fee_usd:0 })); assert.equal(zeroHold.status,200); assert.equal(zeroHold.data.gross4,0); assert.equal(zeroHold.data.net4,0); zero.db.close()
  const fractional=fixture({}, { quantity:0.3,free:0.1,cost:1.0001,gross4:10001 })
  const fractionalHold=await post(fractional,hold('fraction-hold-0001',{ quantity:0.1,coverage_usd:0.2,extra_fee_usd:0 }))
  assert.equal(fractionalHold.status,200,JSON.stringify(fractionalHold)); assert.equal(fractionalHold.data.gross4,3333); assert.equal(fractionalHold.data.net4,1333)
  const fractionalDispose=await post(fractional,{ ...dispose,allocation_id:fractionalHold.data.allocation_id,quantity:0.03,client_request_id:'fraction-dispose-0001' })
  assert.equal(fractionalDispose.status,200,JSON.stringify(fractionalDispose)); assert.equal(fractionalDispose.data.recognized4,399)
  const fractionalFinal=await post(fractional,{ ...dispose,allocation_id:fractionalHold.data.allocation_id,quantity:0.07,expected_generation:2,client_request_id:'fraction-dispose-0002' })
  assert.equal(fractionalFinal.status,200); assert.equal(fractionalFinal.data.recognized4,934)
  const fractionalProjection=await kernel.stockDispositionProjection(getDb({ DB:fractional.d1 }),'source-900')
  assert.equal(fractionalProjection.sellable_quantity,'0.2'); assert.equal(fractionalProjection.held_quantity,'0'); assert.equal(fractionalProjection.physical_quantity,'0.2'); assert.equal(fractionalProjection.sellable_gross4,6668); assert.equal(fractionalProjection.recognized_loss4,1333)
  fractional.db.close()
  const competing=fixture(); competing.hooks.beforeBatch=async()=>assert.equal((await post(competing,hold('competing-request-0001'))).status,200)
  assert.equal((await post(competing,hold('competing-request-0002'))).status,409); assert.equal(count(competing,'stock_disposition_events'),1); assert.equal(count(competing,'fees'),competing.baseline.fees+1); competing.db.close()
  const revoked=fixture(); assert.equal((await post(revoked,hold())).status,200); revoked.db.exec("UPDATE users SET permissions='{}' WHERE id=71"); assert.equal((await post(revoked,hold())).status,403); assert.equal(count(revoked,'stock_disposition_events'),1); revoked.db.close()
  for (let failAt=0;failAt<disposeStatementCount;failAt++) {
    const x=fixture(); const held=await post(x,hold()); const before=snapshot(x); x.hooks.failAt=failAt
    assert.equal((await post(x,{ ...dispose,allocation_id:held.data.allocation_id })).status,409,`dispose rollback ${failAt}`); assert.equal(snapshot(x),before); assert.equal(count(x,'stock_disposition_guards'),0); x.db.close()
  }
  f.db.close()
  console.log(`PASS actual inventory Hono + production getDb native expr100/vars100 Hold->partial/full Dispose; exact99999 basis,30000 accepted credit,7000 cash; fractional0.3/0.1/0.03/0.07 residues; all${holdStatementCount} Hold+${disposeStatementCount} Dispose rollback points; competing generation/replay/current-permission/source/maintenance/lost-response controls; fee FK and append-only guards; maxbindings=${f.maxBindings()}`)
  await permissionControls()
  await silentControls()
  await jsonReceiptControls()
})().catch(error=>{ console.error(error); process.exitCode=1 })
