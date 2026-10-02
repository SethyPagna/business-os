const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

const cache = new Map()
let actor = { id:71, permissions:'{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true,"sales":true,"pos":true}' }
const overrides = {
  '../lib/auth': { requireAuth:async(c,next)=>{c.set('user',actor);return next()} },
  '../durable-objects/broadcastHub': { broadcast:async()=>{} },
  '../lib/telegram': { telegramMoney:()=>'',sendTelegramEvent:async()=>{},formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[],formatSaleTelegramLines:()=>[] },
  '../lib/cache': { bumpVersion:async()=>{},getVersion:async()=>0,cacheKey:(...values)=>values.join(':'),cachedJson:async(c,key,ttl,fn)=>c.json(await fn()) },
}
function load(relative) {
  if(cache.has(relative)) return cache.get(relative).exports
  const file = path.join(__dirname,'../src',relative)
  const source = fs.readFileSync(file,'utf8')
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText
  const module = {exports:{}}
  cache.set(relative,module)
  const local = request => {
    if(Object.hasOwn(overrides,request)) return overrides[request]
    if(request==='./cache') return overrides['../lib/cache']
    if(!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative),request))
    return load(resolved.endsWith('.ts')?resolved:`${resolved}.ts`)
  }
  new Function('require','module','exports',output)(local,module,module.exports)
  return module.exports
}
const inventory = load('routes/inventory.ts').default
const sales = load('routes/sales.ts').default
const context = {waitUntil(promise){Promise.resolve(promise).catch(()=>{})},passThroughOnException(){}}

function fixture() {
  const db = openDb(loadAll()).db
  db.limits.variableNumber=100
  assert.equal(db.limits.exprDepth,100)
  const permissions=actor.permissions
  db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1);
    INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(71,'consumption_writer','Consumption Writer','admin123','${permissions}',1);
    INSERT INTO suppliers(id,name) VALUES(77,'Source supplier');
    INSERT INTO products(id,name,sku,stock_quantity,is_active,selling_price_usd,cost_price_usd) VALUES(10,'Basis fixture','BASIS',4,1,40,25);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd)
      VALUES(500,10,'basis-lot','BASIS','2026-10-01',1,1,77,'credit',4,100,1,25);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,4);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,4);
    INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(900,10,1,500,'add',4,1,100,'original-receipt',71);
    PRAGMA foreign_keys=ON;`)
  const hooks = {}
  const batches = []
  function prepare(sql,values=[]) {
    assert.ok(values.length<=100)
    const execute=()=>{
      const statement=db.prepare(sql)
      if(/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql)) return {success:true,results:sqliteD1Call(statement,'all',values),meta:{changes:0}}
      const result=sqliteD1Call(statement,'run',values)
      return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
    }
    return {sql,values,execute,bind:(...bound)=>prepare(sql,bound),all:async()=>execute(),run:async()=>execute(),first:async()=>execute().results[0]??null}
  }
  const d1={prepare,batch:async statements=>{
    batches.push(statements.map(statement=>statement.sql))
    if(hooks.beforeBatch){const hook=hooks.beforeBatch;delete hooks.beforeBatch;await hook(db,statements)}
    db.exec('BEGIN IMMEDIATE')
    try {
      const result=statements.map((statement,index)=>{
        if(index===hooks.failAt) throw Error('injected statement failure')
        if(index===hooks.skipAt) return {success:true,results:[],meta:{changes:0}}
        return statement.execute()
      })
      db.exec('COMMIT')
      if(hooks.lost){delete hooks.lost;throw Error('simulated lost response')}
      return result
    } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error}
  }}
  return {db,d1,hooks,batches}
}
let serial=0
const valuation=(kind,revision,generation,extra={})=>({kind,source_id:'fund-900',expected_revision:revision,expected_generation:generation,client_request_id:`consumption-${kind}-${++serial}`, ...extra})
async function call(f,app,url,body,method='POST') {
  const response=await app.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.d1,PLAN_TIER:'paid',STOCK_VALUATION_EXPERIMENT:'local-fixture-only',CACHE:{get:async()=>null,put:async()=>{}}},context)
  return {status:response.status,data:await response.json().catch(()=>null)}
}
async function command(f,body) {
  const before=f.batches.length
  const response=await call(f,inventory,'/valuation-experiment',body)
  assert.equal(response.status,200,JSON.stringify(response))
  assert.equal(f.batches.length,before+1)
  return response.data
}
async function repairedFixture() {
  const f=fixture()
  await command(f,valuation('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:4,free_quantity:1,gross_usd:100,opening_paid_usd:80,opening_debt_usd:20,reconciliation_proof:'Owner-reconciled opening',invoice_id:null}}))
  await command(f,valuation('hold',0,0,{segment_id:'original',child_segment_id:'affected',quantity:2,reason:'broken'}))
  await command(f,valuation('dispose',1,0,{segment_id:'affected',child_segment_id:'disposed',quantity:1,expense_category:'damage'}))
  await command(f,valuation('pending',2,0,{agreement_id:'agreement-main',amount_usd:30,targets:[{allocation_id:'affected',amount_usd:30}],proof:'Exact affected shares'}))
  await command(f,valuation('accept',3,1,{agreement_id:'agreement-main',shares:[{segment_id:'affected',amount_usd:15},{segment_id:'disposed',amount_usd:15}],proof:'Accepted exact shares'}))
  const repaired=await command(f,valuation('repair',4,2,{segment_id:'affected',child_segment_id:'repaired',quantity:1}))
  assert.equal(repaired.totals.sellable_net4,600000)
  assert.equal(repaired.totals.historical_loss4,250000)
  assert.equal(repaired.totals.recovery4,150000)
  assert.equal(repaired.segments.find(segment=>segment.segment_id==='repaired').gross4-repaired.segments.find(segment=>segment.segment_id==='repaired').coverage4,100000)
  return f
}
const saleBody=(batch=500)=>({money_precision_version:1,offline_owner:{version:1,actor_id:71,organization_id:null,authority:'http://localhost',runtime:'cloudflare-workers'},branch_id:1,sale_status:'completed',client_request_id:`consumption-sale-${++serial}`,exchange_rate:4000,items:[{product_id:10,quantity:1,branch_id:1,batch_id:batch,price_usd:40,price_khr:160000,client_line_key:'consumption-line',pricing_source:'selling',display_price_mode:'selling',pricing_quote:{gross_usd:40,product_discount_usd:0,manual_discount_usd:0,total_usd:40,total_khr:160000},...(batch===500?{stock_valuation:{source_id:'fund-900',segment_id:'repaired',expected_revision:5,expected_generation:2}}:{})}],payment_method:'Cash',amount_paid_usd:40,amount_paid_khr:0})
async function otherLot() {
  const f=await repairedFixture()
  try {
    f.db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd) VALUES(501,10,'other-lot','OTHER','2026-10-02',1,2,77,'paid',1,25,1,25);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,1);UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=10 AND branch_id=1;UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=10")
    const response=await call(f,sales,'/',saleBody(501))
    assert.equal(response.status,200,JSON.stringify(response))
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity,3)
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=501 AND branch_id=1').get().quantity,0)
    console.log('PASS actual ordinary checkout consumes different nonadmitted lot of the same product')
  } finally {f.db.close()}
}
async function repairedSale() {
  const f=await repairedFixture()
  try {
    const before=f.batches.length
    const response=await call(f,sales,'/',saleBody())
    assert.equal(response.status,200,`repaired admitted share must use ordinary checkout: ${JSON.stringify(response)}`)
    assert.equal(f.batches.length,before+1,'stock valuation and ordinary checkout share one transaction')
    const item=f.db.prepare('SELECT * FROM sale_items').get()
    assert.equal(item.cost_price_usd,10,'captured basis is exact repaired net basis')
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity,2)
    console.log('PASS repaired share ordinary checkout captures exact basis in one transaction')
  } finally {f.db.close()}
}
(async()=>{await otherLot();await repairedSale()})().catch(error=>{console.error(error);process.exitCode=1})
