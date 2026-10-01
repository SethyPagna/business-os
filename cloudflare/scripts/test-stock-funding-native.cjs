const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

const cache = new Map()
let actorId = 71
const overrides = {
  '../lib/auth': { requireAuth: async (c,next) => { c.set('user',{ id:actorId,permissions:'{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true}' }); return next() } },
  '../durable-objects/broadcastHub': { broadcast:async()=>{} },
  '../lib/telegram': { telegramMoney:()=>'',sendTelegramEvent:async()=>{},formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[] },
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname,'../src',rel)
  let source = process.env.STOCK_FUNDING_BASELINE && rel === 'routes/inventory.ts'
    ? execFileSync('git',['show','38afe764b1182e415c91eba56067b68bc8b05ad1:cloudflare/src/routes/inventory.ts'],{ cwd:path.join(__dirname,'../..'),encoding:'utf8' })
    : fs.readFileSync(sourcePath,'utf8')
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

const { getDb } = load('lib/db.ts')
const context = { waitUntil(){},passThroughOnException(){} }
function fixture(hooks={},lot={ quantity:4,free:1,cost:9.9999,gross4:99999 }) {
  const db = openDb(loadAll()).db
  db.limits.variableNumber=100
  assert.equal(db.limits.exprDepth,100); assert.equal(db.limits.variableNumber,100)
  db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(71,'kernel_writer','Kernel Writer','admin123','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true}',1),(72,'other_writer','Other Writer','admin123','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true}',1);
    INSERT INTO suppliers(id,name) VALUES(77,'Source supplier');
    INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(10,'Basis fixture','BASIS',${lot.quantity},1);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
    VALUES(500,10,'basis-lot','BASIS','2026-10-01',1,1,77,'credit',${lot.quantity},${lot.cost},1,2.5);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,${lot.quantity});
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,${lot.quantity});
    INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(900,10,1,500,'add',${lot.quantity},${lot.free},${lot.cost},'original-receipt',71);
`)
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
    const atomic=!process.env.STOCK_FUNDING_NONATOMIC_CONTROL
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

const admission=(paid=0,extra={})=>({ kind:'admit',source_id:'fund-900',movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:4,free_quantity:1,gross_usd:100,opening_paid_usd:paid,opening_debt_usd:100-paid,reconciliation_proof:'Owner-reconciled receipt/payment source fixture',invoice_id:null,expected_generation:0,client_request_id:'fund-admit-0001',...extra })
async function post(f,body,enabled=true) {
 const r=await app.request('/funding-experiment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.d1,...(enabled?{STOCK_FUNDING_EXPERIMENT:'local-fixture-only'}:{})},context)
 return {status:r.status,data:await r.json().catch(()=>null)}
}

const command=(kind,generation,extra={})=>({kind,source_id:'fund-900',expected_generation:generation,proof:'Actual independently reconciled evidence fixture',client_request_id:`fund-${kind}-${generation}-0001`,...extra})
const snapshot=f=>JSON.stringify(['stock_funding_invoice_openings','stock_funding_sources','stock_funding_claims','stock_funding_events','stock_funding_receipts','stock_funding_guards','audit_logs','fees','fee_operation_receipts','product_batches','inventory_movements','branch_batch_stock','branch_stock','products','supplier_invoices'].map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()))
async function ap(f){const r=await app.request('/funding-experiment/ap',{}, {DB:f.d1,STOCK_FUNDING_EXPERIMENT:'local-fixture-only'},context);return {status:r.status,data:await r.json().catch(()=>null)}}
async function ok(f,body){const r=await post(f,body);assert.equal(r.status,200,JSON.stringify(r));return r.data}
async function shippingFee(f){const fees=load('routes/fees.ts').default;const r=await fees.request('/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fee_money_version:1,fee_type:'other',label:'Shipping',amount_usd:7,amount_khr:0,fee_date:'2026-10-01',branch_id:1,sale_id:null,delivery_contact_id:null,notes:'Actual extra shipping',client_request_id:'shipping-posted-0001'})},{DB:f.d1},context);const body=await r.json();assert.equal(r.status,201,JSON.stringify(body));return body.fee.id}

function invoice(f,id=100,total=200,paid=80,debt=120){f.db.prepare(`INSERT INTO supplier_invoices(id,source_branch,branch_id,legacy_id,supplier_id,supplier_name,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(?,'Shop',1,?,77,'Source supplier','2026-10-01',?,?,?,'partial','proven-opening-fixture',1)`).run(id,id,total,paid,debt)}
function secondSource(f){f.db.exec(`INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(11,'Second source','SECOND',4,1);INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,supplier_id,received_quantity,received_cost_usd,received_branch_id) VALUES(501,11,'second-fund','2026-10-01',1,77,4,100,1);INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(901,11,1,501,'add',4,1,100,'second-receipt',71)`)}
async function invoiceControls(){
 const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});invoice(f);invoice(f,101,25,0,25);secondSource(f)
 const before=JSON.stringify(f.db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all())
 await ok(f,admission(40,{invoice_id:100}));await ok(f,admission(40,{source_id:'fund-901',movement_id:901,batch_id:501,product_id:11,invoice_id:100,client_request_id:'fund-admit-second-0001'}))
 await ok(f,command('pending',0,{amount_usd:30,claim_id:'claim-linked'}));await ok(f,command('accept',1,{claim_id:'claim-linked'}))
 const a=await ap(f);assert.equal(a.status,200,JSON.stringify(a));assert.equal(a.data.debt4,1150000);assert.equal(a.data.native_sources.length,0);assert.equal(a.data.invoices[0].current_debt4,900000);assert.deepEqual(a.data.invoices[0].source_ids,['fund-900','fund-901']);assert.equal(a.data.invoices[1].outstanding_balance_usd,25);assert.deepEqual(a.data.invoices[1].source_ids,[])
 assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM supplier_invoices ORDER BY id').all()),before)
 f.db.exec('UPDATE supplier_invoices SET outstanding_balance_usd=119 WHERE id=100');assert.equal((await ap(f)).status,409);f.db.close()
 const capped=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});invoice(capped,100,100,40,60);secondSource(capped);await ok(capped,admission(40,{invoice_id:100}));const old=snapshot(capped);assert.equal((await post(capped,admission(40,{source_id:'fund-901',movement_id:901,batch_id:501,product_id:11,invoice_id:100,client_request_id:'over-cap-second-0001'}))).status,409);assert.equal(snapshot(capped),old);capped.db.close()
 console.log('PASS explicit multi-source imported allocations bounded; linked AP debt once, unlinked original preserved; stale header refuses')
}
async function permissionControls(){
 const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});f.db.exec(`INSERT INTO roles(id,code,name,permissions) VALUES(91,'funding-fixture','Funding role','{"inventory":true,"contacts":true,"fees":true,"product_cost_view":true,"product_cost_edit":true}');UPDATE users SET role_id=91,permissions='{}' WHERE id=71`)
 const body=admission(100);await ok(f,body);assert.equal((await ap(f)).status,200)
 for(const [key,value] of [['contacts:edit',false],['inventory:adjust',false],['product_cost_edit',false],['product_cost_view',false]]){f.db.prepare('UPDATE users SET permissions=? WHERE id=71').run(JSON.stringify({[key]:value}));const old=snapshot(f);assert.equal((await post(f,body)).status,403,key);assert.equal(snapshot(f),old)}
 f.db.exec(`UPDATE users SET permissions='{}' WHERE id=71`);await ok(f,command('pending',0,{amount_usd:30,claim_id:'role-claim'}));await ok(f,command('accept',1,{claim_id:'role-claim'}));const refund=command('refund',2,{amount_usd:10,cash_method:'cash',cash_reference:'ROLE-REFUND',cash_recorded_at:'2026-10-01T11:00:00.000Z'});await ok(f,refund)
 f.db.exec(`UPDATE roles SET permissions='{"inventory":true,"contacts":true,"fees":false,"product_cost_view":true,"product_cost_edit":true}' WHERE id=91`);assert.equal((await post(f,refund)).status,403);assert.equal((await post(f,body)).status,200,'no-cash historical opening replay independent of fees');assert.equal((await post(f,command('refund',3,{amount_usd:1,cash_method:'bank',cash_reference:'BAD-METHOD',cash_recorded_at:'2026-10-01T11:00:00.000Z'}))).status,400);assert.equal((await ap(f)).status,200)
 f.db.exec(`UPDATE users SET permissions='{"contacts:view":false}' WHERE id=71`);assert.equal((await ap(f)).status,200,'contacts writes imply view per existing owner rule');f.db.exec(`UPDATE users SET permissions='{"contacts:view":false,"contacts:add":false,"contacts:edit":false}' WHERE id=71`);assert.equal((await ap(f)).status,403);f.db.close()
 const lost=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(lost,admission(100));await ok(lost,command('pending',0,{amount_usd:30,claim_id:'lost-claim'}));await ok(lost,command('accept',1,{claim_id:'lost-claim'}));lost.hooks.afterBatchThrow=true;lost.hooks.afterCommit=db=>db.exec(`UPDATE users SET permissions='{"inventory":true,"contacts":true,"fees":false,"product_cost_view":true,"product_cost_edit":true}' WHERE id=71`);assert.equal((await post(lost,command('refund',2,{amount_usd:10,cash_method:'cash',cash_reference:'LOST-PERM-REFUND',cash_recorded_at:'2026-10-01T11:00:00.000Z'}))).status,403);assert.equal(lost.db.prepare('SELECT cash_in4 FROM stock_funding_latest').get().cash_in4,100000);lost.db.close()
 console.log('PASS current nonadmin role grants/user action overrides, cost grants, cash-only revocation cached and lost-response; default bank refusal')
}
async function prepare(kind){
 const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
 if(kind==='admit-linked'){invoice(f,100,100,40,60);return {f,body:admission(40,{invoice_id:100})}}
 if(kind==='admit')return {f,body:admission(40)}
 await ok(f,admission(kind==='refund'?100:40))
 if(kind==='pending')return {f,body:command('pending',0,{amount_usd:30,claim_id:'claim-boundary'})}
 if(['accept','cancel','refund'].includes(kind)){await ok(f,command('pending',0,{amount_usd:30,claim_id:'claim-boundary'}));if(kind==='refund')await ok(f,command('accept',1,{claim_id:'claim-boundary'}))}
 if(kind==='accept'||kind==='cancel')return {f,body:command(kind,1,{claim_id:'claim-boundary'})}
 if(kind==='shipping'){const fee=await shippingFee(f);return {f,body:command('shipping',0,{fee_id:fee,amount_usd:7})}}
 return {f,body:command(kind,kind==='refund'?2:0,{amount_usd:10,cash_method:'cash',cash_reference:'BOUNDARY-CASH',cash_recorded_at:'2026-10-01T11:00:00.000Z'})}
}
async function rollbackControls(){
 for(const kind of ['admit','admit-linked','pending','accept','cancel','payment','refund','shipping']){
  const positive=await prepare(kind);await ok(positive.f,positive.body);const length=positive.f.batchSizes.at(-1);positive.f.db.close()
  for(let index=0;index<length;index++){const {f,body}=await prepare(kind);const before=snapshot(f);f.hooks.failAt=index;const r=await post(f,body);assert.equal(r.status,409,`${kind} boundary${index}: ${JSON.stringify(r)}`);assert.equal(snapshot(f),before,`${kind} rollback boundary${index}`);f.db.close()}
  console.log(`PASS all ${length} actual statement failure boundaries ${kind}`)
 }
 for(const [name,kind,sql] of [
  ['source','admit',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_sources BEGIN SELECT RAISE(IGNORE); END"],
  ['invoice opening','admit-linked',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_invoice_openings BEGIN SELECT RAISE(IGNORE); END"],
  ['claim','pending',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_claims BEGIN SELECT RAISE(IGNORE); END"],
  ['event','payment',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_events BEGIN SELECT RAISE(IGNORE); END"],
  ['audit','payment',"CREATE TRIGGER silent BEFORE INSERT ON audit_logs WHEN NEW.entity='stock_funding' BEGIN SELECT RAISE(IGNORE); END"],
  ['receipt','payment',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_receipts BEGIN SELECT RAISE(IGNORE); END"],
  ['all guards','payment',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_guards BEGIN SELECT RAISE(IGNORE); END"],
  ['post guard','payment',"CREATE TRIGGER silent BEFORE INSERT ON stock_funding_guards WHEN NEW.token LIKE '%:post' BEGIN SELECT RAISE(IGNORE); END"],
  ['guard cleanup','payment',"CREATE TRIGGER silent BEFORE DELETE ON stock_funding_guards BEGIN SELECT RAISE(IGNORE); END"]]){
  const {f,body}=await prepare(kind);f.db.exec(sql);const before=snapshot(f);assert.equal((await post(f,body)).status,409,name);assert.equal(snapshot(f),before,name);f.db.close()
 }
 for(const [name,mutate] of [['false amount',v=>v.replace('"cash_out4":100000','"cash_out4":false')],['duplicate key',v=>v.replace('"paid4":500000','"paid4":500000,"paid4":999')],['duplicate envelope',v=>v.slice(0,-1)+',"funding_version":999}'],['unknown key',v=>v.slice(0,-1)+',"unknown":0}']]){
  const {f,body}=await prepare('payment');const before=snapshot(f);f.hooks.beforeBatch=(_db,statements)=>{const index=statements.findIndex(s=>s.sql.startsWith('INSERT INTO stock_funding_receipts'));assert.ok(index>=0);const original=statements[index];const values=original.values.map(v=>typeof v==='string'&&v.startsWith('{"funding_version":2')?mutate(v):v);assert.notDeepEqual(values,original.values);statements[index]=f.d1.prepare(original.sql).bind(...values)};assert.equal((await post(f,body)).status,409,name);assert.equal(snapshot(f),before,name);f.db.close()
 }
 console.log('PASS 9 silent RAISE(IGNORE) and4 driver-captured strict receipt JSON corruption rollback controls; fault reachability not claimed')
}
async function admissionControls(){
 for(const [name,extra] of [['negative paid',{opening_paid_usd:-1}],['inconsistent opening',{opening_paid_usd:40,opening_debt_usd:70}],['boolean gross',{gross_usd:false}],['excess free',{free_quantity:5}],['unsupported precision',{gross_usd:'100.00001'}],['missing explicit invoice',{invoice_id:undefined}],['unknown supplier',{supplier_id:78}],['nonfinite amount',{gross_usd:'Infinity'}]]){
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});const before=snapshot(f);const r=await post(f,admission(0,extra));assert.ok([400,409].includes(r.status),`${name}: ${JSON.stringify(r)}`);assert.equal(snapshot(f),before);f.db.close()
 }
 for(const [name,sql] of [['unknown receipt cost','UPDATE inventory_movements SET total_cost_usd=NULL WHERE id=900'],['KHR unsupported','UPDATE inventory_movements SET total_cost_khr=400000 WHERE id=900'],['shared batch receipt',"INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(10,1,500,'add',1,0,0,'shared',71)"]]){
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});f.db.exec(sql);const before=snapshot(f);assert.equal((await post(f,admission())).status,409,name);assert.equal(snapshot(f),before);f.db.close()
 }
 const fractional=fixture({}, {quantity:0.5,free:0.125,cost:9.9999,gross4:99999});const r=await ok(fractional,admission(0,{quantity:0.5,free_quantity:0.125,gross_usd:'9.9999',opening_debt_usd:'9.9999'}));assert.equal(r.gross4,99999);assert.equal(fractional.db.prepare('SELECT quantity FROM stock_funding_sources').get().quantity,'0.5');fractional.db.close()
 const identity=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(identity,admission(40));actorId=72;assert.equal((await post(identity,admission(40))).status,409);actorId=71;identity.db.close()
 console.log('PASS admission unknown/negative/nonfinite/precision/shared/KHR refusals, fractional paid/free source and actor replay fence')
}
async function raceControls(){
 const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(f,admission(40));const body=command('payment',0,{amount_usd:10,cash_method:'cash',cash_reference:'RACE-PAYMENT',cash_recorded_at:'2026-10-01T11:00:00.000Z'});f.hooks.beforeBatch=async()=>{await ok(f,{...body,client_request_id:'race-other-writer-0001',cash_reference:'RACE-OTHER'})};assert.equal((await post(f,body)).status,409);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_funding_events WHERE kind='payment'").get().n,1);f.db.close()
 const lost=await prepare('payment');lost.f.hooks.afterBatchThrow=true;const r=await ok(lost.f,lost.body);assert.equal(r.replayed,true);assert.equal(lost.f.db.prepare("SELECT COUNT(*) n FROM stock_funding_events WHERE kind='payment'").get().n,1);lost.f.db.exec('UPDATE product_batches SET received_cost_usd=110 WHERE id=500');assert.equal((await ok(lost.f,lost.body)).replayed,true,'readonly committed replay avoids changed entity');assert.equal((await post(lost.f,{...lost.body,client_request_id:'different-next-payment',expected_generation:1,cash_reference:'NEXT-PAYMENT'})).status,409);lost.f.db.close()
 const drift=await prepare('admit-linked');drift.f.hooks.beforeBatch=db=>db.exec('UPDATE supplier_invoices SET amount_paid_usd=41,outstanding_balance_usd=59 WHERE id=100');assert.equal((await post(drift.f,drift.body)).status,409);assert.equal(drift.f.db.prepare('SELECT COUNT(*) n FROM stock_funding_sources').get().n,0);drift.f.db.close()
 console.log('PASS generation race, committed lost response, authorized readonly replay and source/header TOCTOU refusal')
}
;(async()=>{
 if(process.env.STOCK_FUNDING_BASELINE){const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(f,admission());return}
 if(!process.env.STOCK_FUNDING_SMOKE){await admissionControls();await invoiceControls();await permissionControls();await raceControls();await rollbackControls()}
 for(const paid of [0,40,80,100]){
  const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000})
  assert.equal((await post(f,admission(paid),false)).status,404)
  const original=JSON.stringify(f.db.prepare('SELECT * FROM inventory_movements WHERE id=900').get())
  const opening=await ok(f,admission(paid));assert.equal(opening.paid4,paid*10000);assert.equal(opening.cash_out4,0)
  const pending=await ok(f,command('pending',0,{amount_usd:30,claim_id:'claim-A'}));assert.equal(pending.debt4,(100-paid)*10000);assert.equal(pending.asset4,0)
  const acceptBody=command('accept',1,{claim_id:'claim-A'}),accepted=await ok(f,acceptBody)
  assert.equal(accepted.debt4,Math.max(0,70-paid)*10000);assert.equal(accepted.asset4,Math.max(0,paid-70)*10000)
  const unchanged=snapshot(f);assert.equal((await ok(f,acceptBody)).replayed,true);assert.equal(snapshot(f),unchanged)
  assert.equal((await post(f,{...acceptBody,proof:'Changed intent'})).status,409)
  let generation=2
  if(paid===100){const refund=command('refund',2,{amount_usd:10,cash_method:'cash',cash_reference:'ACTUAL-REFUND-10',cash_recorded_at:'2026-10-01T11:00:00.000Z'});const r=await ok(f,refund);assert.equal(r.asset4,200000);assert.equal(r.cash_in4,100000);assert.equal((await ok(f,refund)).replayed,true);assert.equal((await post(f,{...refund,expected_generation:3,client_request_id:'another-refund-intent-0001'})).status,409);generation=3}
  if(accepted.debt4){const pay=await ok(f,command('payment',generation,{amount_usd:accepted.debt4/10000,cash_method:'cash',cash_reference:'ACTUAL-PAYMENT',cash_recorded_at:'2026-10-01T11:01:00.000Z'}));assert.equal(pay.debt4,0);assert.equal(pay.cash_out4,accepted.debt4);generation++}
  const fee=await shippingFee(f),shipping=await ok(f,command('shipping',generation,{amount_usd:7,fee_id:fee}));assert.equal(shipping.shipping4,70000);assert.equal(shipping.gross4,1000000);assert.equal(shipping.credit4,300000)
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM inventory_movements WHERE id=900').get()),original)
  const a=await ap(f);assert.equal(a.status,200);assert.equal(a.data.debt4,0);assert.equal(a.data.refund_asset4,paid===100?200000:Math.max(0,paid-70)*10000)
  console.log(`PASS actual adapter source paid${paid}, pending/accepted credit30, debt/asset/refund/payment/replay and posted shipping7; maxslots${f.maxBindings()}`);f.db.close()
 }
})().catch(e=>{console.error(e);process.exitCode=1})
