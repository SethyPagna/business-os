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
  let source = process.env.STOCK_VALUATION_BASELINE && rel === 'routes/inventory.ts' ? execFileSync('git',['show','341b85850e85b8f4478a3677fb3461fee0449cf9:cloudflare/src/routes/inventory.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'}) : process.env.STOCK_FUNDING_BASELINE && rel === 'routes/inventory.ts'
    ? execFileSync('git',['show','38afe764b1182e415c91eba56067b68bc8b05ad1:cloudflare/src/routes/inventory.ts'],{ cwd:path.join(__dirname,'../..'),encoding:'utf8' })
    : fs.readFileSync(sourcePath,'utf8')
  if (process.env.STOCK_FUNDING_FEE_PROVENANCE_BASELINE && rel === 'lib/stockFunding.ts') source=execFileSync('git',['show','f564ed49a9aa7126d56cb2c178341d8b243b5fa6:cloudflare/src/lib/stockFunding.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'})
  if (process.env.STOCK_FUNDING_AMBIGUOUS_BASELINE && rel === 'lib/stockFunding.ts') source=execFileSync('git',['show','ba1e58f28947ce4a7a04ff552e2d13514d8134b8:cloudflare/src/lib/stockFunding.ts'],{cwd:path.join(__dirname,'../..'),encoding:'utf8'})
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
    const atomic=!process.env.STOCK_VALUATION_NONATOMIC_CONTROL
    if (atomic) db.exec('BEGIN IMMEDIATE')
    let results
    try { results=statements.map((statement,index)=>{
      if (hooks.failAt===index) throw new Error('injected statement failure')
      if(hooks.skipAt===index) return {success:true,results:[],meta:{changes:0}}
      return statement.execute()
    }); if (atomic) db.exec('COMMIT') } catch(error) { if (atomic) db.exec('ROLLBACK'); throw error }
    if (hooks.afterCommit) { const hook=hooks.afterCommit; delete hooks.afterCommit; await hook(db) }
    if (hooks.afterBatchThrow) { delete hooks.afterBatchThrow; throw new Error('simulated lost response') }
    return results
  } }
  const baseline=Object.fromEntries(['fees','fee_operation_receipts','audit_logs','inventory_movements'].map(table=>[table,Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)]))
  return { db,d1,hooks,baseline,batchSizes,maxBindings:()=>maxBindings }
}


let serial=0
const tables=['stock_valuation_sources','stock_valuation_events','stock_valuation_segments','stock_valuation_agreements','stock_valuation_acceptances','stock_valuation_receipts','stock_valuation_guards','stock_valuation_context','stock_funding_sources','stock_funding_events','stock_funding_claims','stock_funding_receipts','stock_funding_guards','audit_logs','branch_batch_stock','branch_stock','products','inventory_movements','product_batches','supplier_invoices','fees']
const snapshot=f=>JSON.stringify(tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()))
const body=(kind,revision,generation,extra={})=>({kind,source_id:'fund-900',expected_revision:revision,expected_generation:generation,client_request_id:`joint-${kind}-${++serial}-request`,...extra})
const admission=(paid=80,quantity=4,cost=100)=>body('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity,free_quantity:1,gross_usd:cost,opening_paid_usd:paid,opening_debt_usd:cost-paid,reconciliation_proof:'Owner-reconciled opening',invoice_id:null}})
async function post(f,b,enabled=true){const r=await app.request('/valuation-experiment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)},{DB:f.d1,...(enabled?{STOCK_VALUATION_EXPERIMENT:'local-fixture-only'}:{})},context);return {status:r.status,data:await r.json().catch(()=>null)}}
async function ok(f,b){const before=f.batchSizes.length;const r=await post(f,b);assert.equal(r.status,200,JSON.stringify(r));assert.equal(f.batchSizes.length,before+1,'one batch per new command');return r.data}
const hold=(rev,gen,q=2)=>body('hold',rev,gen,{segment_id:'original',child_segment_id:'affected',quantity:q,reason:'broken'})
const pending=(rev,gen,amount=30)=>body('pending',rev,gen,{agreement_id:'agreement-main',amount_usd:amount,targets:[{allocation_id:'affected',amount_usd:amount}],proof:'Explicit affected allocation agreement'})
const accept=(rev,gen,shares)=>body('accept',rev,gen,{agreement_id:'agreement-main',shares,proof:'Accepted signed agreement shares'})
async function fixtureE(){const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});const original=f.db.prepare('SELECT received_quantity,received_cost_usd,unit_cost_usd FROM product_batches').get();await ok(f,admission());await ok(f,hold(0,0));const d=await ok(f,body('dispose',1,0,{segment_id:'affected',child_segment_id:'disposed',quantity:1,expense_category:'damage'}));assert.equal(d.totals.historical_loss4,250000);await ok(f,pending(2,0));const a=await ok(f,accept(3,1,[{segment_id:'affected',amount_usd:15},{segment_id:'disposed',amount_usd:15}]));assert.equal(a.funding.debt4,0);assert.equal(a.funding.asset4,100000);assert.equal(a.totals.held_net4,100000);assert.equal(a.totals.historical_loss4,250000);assert.equal(a.totals.recovery4,150000);assert.equal(a.totals.historical_loss4-a.totals.recovery4,100000);assert.equal(a.pending4,0);assert.equal(f.db.prepare("SELECT loss4 FROM stock_valuation_events WHERE kind='dispose'").get().loss4,250000);const refund=body('refund',4,2,{amount_usd:10,proof:'Actual supplier cash refund',cash_method:'cash',cash_reference:'E-REFUND-1',cash_recorded_at:'2026-10-01T11:00:00.000Z'});const r=await ok(f,refund);assert.equal(r.funding.asset4,0);assert.equal(r.funding.cash_in4,100000);assert.deepEqual(r.totals,a.totals);const saved=snapshot(f);const cached=await post(f,refund);assert.equal(cached.status,200);assert.equal(cached.data.replayed,true);assert.equal(snapshot(f),saved);assert.deepEqual(f.db.prepare('SELECT received_quantity,received_cost_usd,unit_cost_usd FROM product_batches').get(),original);assert.equal((await post(f,refund,false)).status,404);f.db.close();console.log('PASS E real Hono joint held/disposed coverage and refund, immutable original loss/acquisition, replay')}
async function fixtureB(){const f=fixture({}, {quantity:10,free:1,cost:100,gross4:1000000});await ok(f,admission(80,10));await ok(f,hold(0,0,4));await ok(f,pending(1,0));await ok(f,accept(2,1,[{segment_id:'affected',amount_usd:30}]));const d=await ok(f,body('dispose',3,2,{segment_id:'affected',child_segment_id:'disposed',quantity:1}));assert.equal(d.totals.historical_loss4,25000);await ok(f,body('pending',4,2,{agreement_id:'agreement-second',amount_usd:4,targets:[{allocation_id:'affected',amount_usd:4}],proof:'Explicit one dollar per original affected unit'}));const a=await ok(f,body('accept',5,3,{agreement_id:'agreement-second',shares:[{segment_id:'affected',amount_usd:3},{segment_id:'disposed',amount_usd:1}],proof:'One dollar per original unit accepted'}));assert.equal(a.totals.recovery4,10000);assert.equal(a.totals.held_net4,45000);assert.equal(a.funding.asset4,140000);assert.equal(a.totals.historical_loss4-a.totals.recovery4,15000);const repaired=await ok(f,body('repair',6,4,{segment_id:'affected',child_segment_id:'repaired',quantity:1}));assert.equal(repaired.segments.find(s=>s.segment_id==='repaired').gross4-repaired.segments.find(s=>s.segment_id==='repaired').coverage4,15000);assert.equal(repaired.totals.historical_loss4,a.totals.historical_loss4);f.db.close();console.log('PASS B later credit split by physical fate; repair exact net basis')}
async function partial(){const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});await ok(f,admission());await ok(f,hold(0,0));await ok(f,pending(1,0));const first=await ok(f,accept(2,1,[{segment_id:'affected',amount_usd:12}]));assert.equal(first.pending4,180000);assert.equal(first.totals.held_net4,380000);const second=await ok(f,accept(3,2,[{segment_id:'affected',amount_usd:18}]));assert.equal(second.pending4,0);assert.equal(second.totals.held_net4,200000);const before=snapshot(f);assert.equal((await post(f,accept(4,3,[{segment_id:'affected',amount_usd:1}]))).status,409);assert.equal(snapshot(f),before);assert.equal((await post(f,hold(0,0))).status,409);assert.equal(snapshot(f),before);f.db.close();console.log('PASS attributable partial acceptance remainder and stale generation')}
async function rollback(){const setup=async hooks=>{const f=fixture(hooks,{quantity:4,free:1,cost:100,gross4:1000000});await ok(f,admission());await ok(f,hold(0,0));await ok(f,pending(1,0));return f};const probe=await setup({});await ok(probe,accept(2,1,[{segment_id:'affected',amount_usd:30}]));const count=probe.batchSizes.at(-1);probe.db.close();for(let i=0;i<count;i++){const f=await setup({});const before=snapshot(f);f.hooks.failAt=i;assert.equal((await post(f,accept(2,1,[{segment_id:'affected',amount_usd:30}]))).status,409,`failure ${i}`);assert.equal(snapshot(f),before,`rollback ${i}`);f.db.close()}console.log(`PASS each joint acceptance statement rollback ${count}`);const lost=await setup({});const b=accept(2,1,[{segment_id:'affected',amount_usd:30}]);lost.hooks.afterBatchThrow=true;assert.equal((await post(lost,b)).data.replayed,true);assert.equal(lost.db.prepare("SELECT COUNT(*) n FROM stock_valuation_events WHERE kind='accept'").get().n,1);lost.db.close();console.log('PASS lost response aggregate replay')}
async function permissions(){const f=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});const b=admission();await ok(f,b);f.db.exec(`UPDATE users SET permissions='{"inventory":true,"contacts":true,"product_cost_view":false,"product_cost_edit":true}' WHERE id=71`);assert.equal((await post(f,b)).status,403);f.db.close();const race=fixture({}, {quantity:4,free:1,cost:100,gross4:1000000});race.hooks.beforeBatch=db=>db.exec(`UPDATE users SET permissions='{}' WHERE id=71`);assert.equal((await post(race,admission())).status,403);assert.equal(race.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events').get().n,0);race.db.close();console.log('PASS current receipt disclosure and commit permissions')}
(async()=>{await fixtureE();await fixtureB();await partial();await rollback();await permissions()})().catch(error=>{console.error(error);process.exitCode=1})
