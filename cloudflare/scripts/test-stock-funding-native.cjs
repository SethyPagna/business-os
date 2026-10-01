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
;(async()=>{
 if(process.env.STOCK_FUNDING_BASELINE){const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(f,admission());return}
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
