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
  '../lib/telegram': { telegramMoney:()=>'',sendTelegramEvent:async()=>{},formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[],formatSaleTelegramLines:()=>[],formatSaleStatusTelegramLines:()=>[] },
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
        if(hooks.beforeStatement) hooks.beforeStatement(db,statement,index)
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
async function repairedSale(credit=5) {
  const f=await repairedFixture()
  try {
    const before=f.batches.length
    const response=await call(f,sales,'/',saleBody())
    assert.equal(response.status,200,`repaired admitted share must use ordinary checkout: ${JSON.stringify(response)}`)
    const checkoutBatches=f.batches.slice(before).filter(statements=>statements.some(sql=>/INSERT INTO sales\b/.test(sql)))
    assert.equal(checkoutBatches.length,1,'ordinary checkout commits exactly one business transaction')
    assert.equal(checkoutBatches[0].filter(sql=>/INSERT INTO stock_valuation_events_v4\b/.test(sql)).length,1,'valuation is in the same ordinary checkout transaction')
    assert.ok(f.batches.slice(before).every(statements=>statements===checkoutBatches[0]||statements.every(sql=>!/stock_valuation|sale_items|inventory_movements|branch_stock|branch_batch_stock/.test(sql))),'background setting registration cannot commit business stock separately')
    const item=f.db.prepare('SELECT * FROM sale_items').get()
    assert.equal(item.cost_price_usd,10,'captured basis is exact repaired net basis')
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity,2)
    const consumed=f.db.prepare("SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE e.source_id='fund-900' AND s.fate='consumed'").get()
    assert.equal(consumed.consumed_cost4,100000)
    assert.equal(consumed.consumed_recovery4,0)
    await assertCostProjection(f,item.id,100000,0)
    const v3=f.db.prepare("SELECT * FROM stock_valuation_receipts WHERE request_id LIKE 'consumption-repair-%'").get()
    const replay=await call(f,inventory,'/valuation-experiment',JSON.parse(v3.request_json))
    assert.equal(replay.status,200,JSON.stringify(replay))
    assert.equal(replay.data.valuation_version,3)
    assert.equal(replay.data.replayed,true)
    assert.equal(JSON.stringify({...replay.data,replayed:undefined}),v3.response_json)
    await command(f,valuation('pending',6,2,{agreement_id:'agreement-consumed',amount_usd:credit,targets:[{allocation_id:'affected',amount_usd:credit}],proof:'Extra accepted consumed-share credit'}))
    const accepted=await command(f,valuation('accept',7,3,{agreement_id:'agreement-consumed',shares:[{segment_id:consumed.segment_id,amount_usd:credit}],proof:'Exact consumed share accepted'}))
    assert.equal(accepted.totals.consumed_cost4,100000)
    assert.equal(accepted.totals.consumed_recovery4,credit*10000)
    assert.equal(accepted.totals.historical_loss4,250000)
    assert.equal(accepted.totals.recovery4,150000)
    assert.equal(accepted.funding.asset4,(10+credit)*10000)
    await assertCostProjection(f,item.id,100000,credit*10000)
    const saleId=item.sale_id
    const cancellation={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Customer cancelled',client_request_id:`consumption-cancel-${++serial}`}
    const batchesBeforeCancel=f.batches.length
    const cancelled=await call(f,sales,`/${saleId}/status`,cancellation,'PATCH')
    assert.equal(cancelled.status,200,JSON.stringify(cancelled))
    assert.equal(f.batches.length,batchesBeforeCancel+1)
    const restored=f.db.prepare('SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE s.segment_id=?').get(consumed.segment_id)
    assert.equal(restored.fate,'sellable')
    assert.equal(restored.gross4-restored.coverage4,(10-credit)*10000)
    assert.equal(restored.consumed_cost4,0)
    assert.equal(restored.consumed_recovery4,0)
    await assertCostProjection(f,item.id,0,0)
    assert.equal(f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity,3)
    const immutableSale=f.db.prepare('SELECT cost_price_usd,total_usd FROM sale_items WHERE id=?').get(item.id)
    assert.equal(immutableSale.cost_price_usd,10)
    assert.equal(immutableSale.total_usd,40,'supplier credit does not alter customer money')
    const saved=f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events_v4').get().n
    assert.equal((await call(f,sales,`/${saleId}/status`,cancellation,'PATCH')).status,200)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_events_v4').get().n,saved)
    const uncancelled=await call(f,sales,`/${saleId}/status`,{sale_status:'completed',client_request_id:`consumption-uncancel-${++serial}`},'PATCH')
    assert.equal(uncancelled.status,200,JSON.stringify(uncancelled))
    const takenAgain=f.db.prepare('SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE s.segment_id=?').get(consumed.segment_id)
    assert.equal(takenAgain.fate,'consumed')
    assert.equal(takenAgain.consumed_cost4,(10-credit)*10000)
    assert.equal(takenAgain.consumed_recovery4,0)
    await assertCostProjection(f,item.id,(10-credit)*10000,0)
    const dated=f.db.prepare('SELECT r.kind,r.consumed_cost4,r.consumed_recovery4 FROM stock_valuation_sale_recoveries r JOIN stock_valuation_history_events e ON e.id=r.event_id WHERE r.sale_item_id=? ORDER BY e.revision').all(item.id).map(row=>({...row}))
    assert.deepEqual(dated,[{kind:'consume',consumed_cost4:100000,consumed_recovery4:0},{kind:'accept',consumed_cost4:0,consumed_recovery4:credit*10000},{kind:'restore',consumed_cost4:-100000,consumed_recovery4:-credit*10000},...(credit===10?[]:[{kind:'reconsume',consumed_cost4:(10-credit)*10000,consumed_recovery4:0}])])
    assert.equal(f.db.prepare('SELECT cost_price_usd FROM sale_items WHERE id=?').get(item.id).cost_price_usd,10)
    console.log(`PASS actual repaired checkout10 late credit${credit} cancel basis${10-credit} uncancel cost${10-credit}, immutable sale money`)
  } finally {f.db.close()}
}
async function exactPool() {
  const f=fixture()
  try {
    f.db.exec('UPDATE products SET stock_quantity=3 WHERE id=10;UPDATE product_batches SET received_quantity=3,received_cost_usd=7.0001 WHERE id=500;UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=500;UPDATE branch_stock SET quantity=3 WHERE product_id=10;UPDATE inventory_movements SET quantity=3,total_cost_usd=7.0001 WHERE id=900')
    await command(f,valuation('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:3,free_quantity:1,gross_usd:7.0001,opening_paid_usd:7.0001,opening_debt_usd:0,reconciliation_proof:'Paid plus free exact average pool',invoice_id:null}}))
    const costs=[]
    for(let revision=0;revision<3;revision++) {
      const body=saleBody();body.items[0].stock_valuation={source_id:'fund-900',segment_id:'original',expected_revision:revision,expected_generation:0}
      const response=await call(f,sales,'/',body)
      assert.equal(response.status,200,JSON.stringify(response))
      const item=f.db.prepare('SELECT id,cost_price_usd FROM sale_items ORDER BY id DESC LIMIT 1').get()
      const cost=f.db.prepare('SELECT cost4 FROM stock_valuation_sale_costs WHERE sale_item_id=?').get(item.id).cost4
      costs.push(cost)
      await assertCostProjection(f,item.id,cost,0)
    }
    assert.equal(costs.reduce((sum,n)=>sum+n,0),70001)
    assert.equal(f.db.prepare('SELECT SUM(quantity) quantity FROM branch_batch_stock WHERE batch_id=500').get().quantity,0)
    assert.notEqual(costs[0]*3,70001)
    console.log('PASS three actual paid-plus-free pool checkouts preserve exact70001 residue with SQL/API parity')
  } finally {f.db.close()}
}
async function assertCostProjection(f,item,cost4,recovery4) {
  const {getDb}=load('lib/db.ts'),{readStockValuationSaleCosts}=load('lib/stockValuationConsumption.ts')
  const result=await readStockValuationSaleCosts(getDb({DB:f.d1}),[item,999999])
  assert.deepEqual(result.get(item),{managed:true,quantity:'1',cost4,recovery4,net4:cost4-recovery4,sourceIds:['fund-900']})
  assert.equal(result.has(999999),false)
  assert.deepEqual({...f.db.prepare('SELECT managed,quantity,cost4,recovery4,net4,source_ids_json FROM stock_valuation_sale_costs WHERE sale_item_id=?').get(item)},{managed:1,quantity:1,cost4,recovery4,net4:cost4-recovery4,source_ids_json:'["fund-900"]'})
}

function businessState(f) {
  const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'stock_%' OR name LIKE 'sale%' OR name IN ('products','product_batches','branch_stock','branch_batch_stock','inventory_movements','audit_logs','fees','sqlite_sequence')) ORDER BY name").all()
  return JSON.stringify(tables.map(({name})=>[name,f.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
}
async function soldFixture() {
  const f=await repairedFixture(),body=saleBody()
  const response=await call(f,sales,'/',body)
  assert.equal(response.status,200,JSON.stringify(response))
  const item=f.db.prepare('SELECT * FROM sale_items').get()
  return {...f,body,item}
}
async function failures() {
  const template=await soldFixture()
  const checkout=template.batches.find(statements=>statements.some(sql=>/INSERT INTO sales\b/.test(sql)))
  template.db.close()
  const f=await repairedFixture(),body=saleBody(),baseline=businessState(f)
  try {
    for(let index=0;index<checkout.length;index++) {
      f.hooks.failAt=index
      const result=await call(f,sales,'/',body)
      assert.notEqual(result.status,200,`checkout ignored failure ${index}`)
      assert.equal(businessState(f),baseline,`checkout rollback ${index}`)
    }
    delete f.hooks.failAt
    for(const [index,sql] of checkout.entries()) if(/^(INSERT INTO stock_valuation|DELETE FROM stock_valuation|UPDATE branch_batch_stock|INSERT INTO branch_stock|UPDATE products|INSERT INTO inventory_movements|INSERT INTO audit_logs)/.test(sql.trim())) {
      f.hooks.skipAt=index
      const result=await call(f,sales,'/',body)
      assert.notEqual(result.status,200,`checkout ignored write ${index}: ${sql}`)
      assert.equal(businessState(f),baseline,`checkout ignored write rollback ${index}`)
    }
    console.log(`PASS checkout each statement rollback ${checkout.length}, ignored required valuation/stock writes`)
  } finally {f.db.close()}
  const s=await soldFixture(),cancel={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Native test cancellation',client_request_id:`negative-cancel-${++serial}`}
  let restore
  try {
    const response=await call(s,sales,`/${s.item.sale_id}/status`,cancel,'PATCH')
    assert.equal(response.status,200,JSON.stringify(response))
    restore=s.batches.find(statements=>statements.some(sql=>/INSERT INTO stock_valuation_events_v4/.test(sql))&&statements.some(sql=>/SET sale_status/.test(sql)))
  } finally {s.db.close()}
  const r=await soldFixture(),saved=businessState(r)
  try {
    for(let index=0;index<restore.length;index++) {
      r.hooks.failAt=index
      const response=await call(r,sales,`/${r.item.sale_id}/status`,cancel,'PATCH')
      assert.notEqual(response.status,200,`restore ignored failure ${index}`)
      assert.equal(businessState(r),saved,`restore rollback ${index}`)
    }
    delete r.hooks.failAt
    for(const [index,sql] of restore.entries()) if(/^(INSERT INTO stock_valuation|DELETE FROM stock_valuation|INSERT INTO branch_batch_stock|UPDATE sale_item_batch_allocations|INSERT INTO inventory_movements|INSERT INTO audit_logs)/.test(sql.trim())) {
      r.hooks.skipAt=index
      const response=await call(r,sales,`/${r.item.sale_id}/status`,cancel,'PATCH')
      assert.notEqual(response.status,200,`restore ignored write ${index}: ${sql}`)
      assert.equal(businessState(r),saved,`restore ignored write rollback ${index}`)
    }
    console.log(`PASS cancellation each statement rollback ${restore.length}, ignored upsert/allocation/context cleanup`)
  } finally {r.db.close()}
}
async function custody() {
  const f=await soldFixture(),cancel={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Native test cancellation',client_request_id:`custody-cancel-${++serial}`}
  try {
    const baseline=businessState(f)
    const v3=f.db.prepare('SELECT * FROM stock_valuation_events ORDER BY revision LIMIT 1').get()
    assert.throws(()=>f.db.prepare('INSERT INTO stock_valuation_events(id,source_id,revision,kind,loss4,recovery4,actor_id,occurred_at) VALUES(?,?,7,\'hold\',0,0,71,?)').run('old-writer','fund-900',v3.occurred_at),/valuation_global_identity_conflict/)
    assert.throws(()=>f.db.prepare('INSERT INTO stock_valuation_events_v4(id,source_id,revision,kind,loss4,recovery4,actor_id,occurred_at,consumed_cost4,consumed_recovery4) VALUES(?,?,7,\'hold\',0,0,71,?,0,0)').run(v3.id,'fund-900',v3.occurred_at),/valuation_global_identity_conflict/)
    assert.throws(()=>f.db.prepare('INSERT INTO stock_valuation_events_v4(id,source_id,revision,kind,loss4,recovery4,actor_id,occurred_at,consumed_cost4,consumed_recovery4) VALUES(?,?,6,\'hold\',0,0,71,?,0,0)').run('collision','fund-900',v3.occurred_at),/valuation_global_identity_conflict/)
    f.db.exec('SAVEPOINT global_receipt')
    const receipt=f.db.prepare('SELECT * FROM stock_valuation_receipts LIMIT 1').get()
    f.db.prepare('INSERT INTO stock_valuation_events_v4(id,source_id,revision,kind,loss4,recovery4,actor_id,occurred_at,consumed_cost4,consumed_recovery4) VALUES(?,?,7,\'hold\',0,0,71,?,0,0)').run('receipt-collision','fund-900',v3.occurred_at)
    assert.throws(()=>f.db.prepare('INSERT INTO stock_valuation_receipts_v4 VALUES(?,?,?,?,?,?)').run(receipt.request_id,'receipt-collision',71,receipt.request_digest,receipt.request_json,receipt.response_json),/UNIQUE constraint failed: stock_valuation_request_identities.request_id/)
    f.db.exec('ROLLBACK TO global_receipt; RELEASE global_receipt')
    assert.equal(businessState(f),baseline)
    let probes=0
    f.hooks.beforeStatement=(db,statement)=>{
      if(/^INSERT INTO stock_valuation_sale_operation_context/.test(statement.sql.trim())) {
        const event=db.prepare("SELECT * FROM stock_valuation_latest WHERE source_id='fund-900'").get()
        const link=db.prepare('SELECT * FROM stock_valuation_sale_links').get(),token=db.prepare('SELECT token FROM stock_valuation_guards').get().token
        const valid=[token,event.id,'fund-900','restore',link.segment_id,link.id,link.sale_allocation_id,0,1,3]
        for(const [index,value] of [[2,'foreign-source'],[3,'consume'],[4,'foreign-segment'],[5,'foreign-consumption'],[6,999999]]) {
          const wrong=[...valid];wrong[index]=value
          assert.throws(()=>db.prepare('INSERT INTO stock_valuation_sale_operation_context VALUES(?,?,?,?,?,?,?,?,?,?)').run(...wrong),/valuation_sale_context_unowned/)
          probes++
        }
      }
      if(!/^INSERT INTO branch_batch_stock/.test(statement.sql.trim())) return
      assert.equal(db.prepare("SELECT kind FROM stock_valuation_sale_operation_context").get().kind,'restore')
      for(const [batch,branch,quantity] of [[500,1,0.5],[500,1,2],[500,2,1]]) {
        assert.throws(()=>db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity').run(batch,branch,quantity),/stock_lifecycle_dependency/)
        probes++
      }
      assert.throws(()=>db.exec('UPDATE stock_valuation_sale_operation_context SET sale_allocation_id=999'),/valuation context immutable/)
      assert.throws(()=>db.exec('UPDATE stock_valuation_sale_operation_context SET source_id=\'other\''),/valuation context immutable/)
      assert.throws(()=>db.exec('UPDATE stock_valuation_context SET remaining_quantity=999'),/valuation context immutable|stock_lifecycle_dependency/)
      assert.throws(()=>db.exec('DELETE FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1'),/stock_lifecycle_dependency/)
      probes+=4
    }
    const response=await call(f,sales,`/${f.item.sale_id}/status`,cancel,'PATCH')
    assert.equal(response.status,200,JSON.stringify(response))
    assert.equal(probes,12)
    delete f.hooks.beforeStatement
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_valuation_sale_operation_context').get().n,0)
    assert.throws(()=>f.db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,1) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+1'),/stock_lifecycle_dependency/)
    const {planSaleStockTransition}=load('lib/saleTransitions.ts'),{orderStockValuationReconsume}=load('lib/stockValuationConsumption.ts')
    const allocation=f.db.prepare('SELECT * FROM sale_item_batch_allocations WHERE sale_item_id=?').get(f.item.id)
    const original=planSaleStockTransition({saleId:f.item.sale_id,oldStatus:'cancelled',newStatus:'completed',items:[{...f.item,allocations:[allocation]}],returnedByItem:new Map(),reason:'restore exact',userId:71,userName:'Writer',skipStock:false}).statements
    const ordered=orderStockValuationReconsume(original,{batchId:500,branchId:1,productId:10,allocationId:allocation.id,quantity:1})
    assert.equal(ordered.length,original.length)
    assert.deepEqual(ordered.map(row=>JSON.stringify(row)).sort(),original.map(row=>JSON.stringify(row)).sort())
    assert.ok(ordered.every(row=>original.includes(row)))
    assert.ok(ordered.findIndex(row=>/^UPDATE branch_batch_stock/.test(row.sql))<ordered.findIndex(row=>/^INSERT INTO branch_stock/.test(row.sql)))
    console.log('PASS global v3/v4 id/revision/request identities, exact restore capability negatives and unchanged reconsume statement multiset')
  } finally {f.db.close()}
}
async function racesAndMovementProof() {
  const f=await repairedFixture(),loser=saleBody(),winner=saleBody()
  try {
    let winnerState
    f.hooks.beforeBatch=async()=>{const response=await call(f,sales,'/',winner);assert.equal(response.status,200,JSON.stringify(response));winnerState=businessState(f)}
    const response=await call(f,sales,'/',loser)
    assert.equal(response.status,409,JSON.stringify(response))
    assert.equal(businessState(f),winnerState)
  } finally {f.db.close()}
  const r=await soldFixture()
  try {
    let winnerState
    const cancel={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Concurrent cancellation',client_request_id:`race-cancel-${++serial}`}
    r.hooks.beforeBatch=async()=>{const response=await call(r,sales,`/${r.item.sale_id}/status`,{...cancel,client_request_id:`race-winner-${++serial}`},'PATCH');assert.equal(response.status,200,JSON.stringify(response));winnerState=businessState(r)}
    const response=await call(r,sales,`/${r.item.sale_id}/status`,cancel,'PATCH')
    assert.equal(response.status,409,JSON.stringify(response))
    assert.equal(businessState(r),winnerState)
  } finally {r.db.close()}
  for(const sabotage of ['duplicate','quantity','cost','foreign','actor']) {
    const n=await repairedFixture(),saved=businessState(n)
    try {
      n.hooks.beforeStatement=(db,statement)=>{
        if(!/^INSERT INTO stock_valuation_sale_movements/.test(statement.sql)) return
        if(sabotage==='duplicate') db.exec("INSERT INTO inventory_movements(product_id,branch_id,batch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reference_id,user_id,user_name) SELECT product_id,branch_id,batch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reference_id,user_id,user_name FROM inventory_movements WHERE movement_type='sale'")
        else db.exec(`UPDATE inventory_movements SET ${sabotage==='quantity'?'quantity=-2':sabotage==='cost'?'unit_cost_usd=99':sabotage==='foreign'?'batch_id=NULL':'user_id=NULL'} WHERE movement_type='sale'`)
      }
      const response=await call(n,sales,'/',saleBody())
      assert.notEqual(response.status,200,`movement ${sabotage}`)
      assert.equal(businessState(n),saved,`movement ${sabotage} rollback`)
    } finally {n.db.close()}
  }
  console.log('PASS actual checkout/cancel races preserve winner, duplicate/missing/foreign/wrong quantity-cost-actor movement rollback')
}
async function reconsumeIgnores() {
  const f=await soldFixture(),cancel={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Ignored reconsume probe',client_request_id:`ignore-restore-${++serial}`}
  try {
    assert.equal((await call(f,sales,`/${f.item.sale_id}/status`,cancel,'PATCH')).status,200)
    const saved=businessState(f),body={sale_status:'completed',client_request_id:`ignore-reconsume-${++serial}`}
    let selected
    f.hooks.beforeBatch=(db,statements)=>{selected=statements.map((statement,index)=>({index,sql:statement.sql})); f.hooks.failAt=0}
    assert.notEqual((await call(f,sales,`/${f.item.sale_id}/status`,body,'PATCH')).status,200)
    delete f.hooks.failAt
    for(const {index,sql} of selected) if(/^(UPDATE branch_batch_stock|UPDATE sale_item_batch_allocations|DELETE FROM stock_valuation|INSERT INTO stock_valuation_sale_movements|INSERT INTO inventory_movements)/.test(sql.trim())) {
      f.hooks.skipAt=index
      const response=await call(f,sales,`/${f.item.sale_id}/status`,body,'PATCH')
      assert.notEqual(response.status,200,`ignored reconsume ${index}: ${sql}`)
      assert.equal(businessState(f),saved,`ignored reconsume rollback ${index}`)
    }
    console.log('PASS reconsume ignored lot/allocation/movement and final context cleanup rollback')
  } finally {f.db.close()}
}
async function replayPermissions() {
  const originalActor=actor
  const f=await repairedFixture(),body=saleBody()
  try {
    f.hooks.lost=true
    const response=await call(f,sales,'/',body)
    assert.equal(response.status,200,JSON.stringify(response))
    assert.equal(response.data.duplicate,true)
    const item=f.db.prepare('SELECT * FROM sale_items').get(),saved=businessState(f)
    assert.equal((await call(f,sales,'/',body)).status,200)
    assert.equal(businessState(f),saved)
    const changed=structuredClone(body); changed.items[0].stock_valuation.segment_id='original'
    const conflict=await call(f,sales,'/',changed)
    assert.equal(conflict.status,409,JSON.stringify(conflict))
    assert.equal(conflict.data.code,'valuation_sale_intent_conflict')
    const basic='{"sales":true,"pos":true}'
    f.db.prepare('UPDATE users SET permissions=? WHERE id=71').run(basic)
    actor={...actor,permissions:basic}
    const hidden=await call(f,sales,'/',body)
    assert.equal(hidden.status,200,JSON.stringify(hidden))
    const wire=JSON.stringify(hidden.data)
    assert.equal(/cost_price|consumed_cost4|consumed_recovery4|gross4|coverage4/.test(wire),false,wire)
    assert.equal(hidden.data.sale.items[0].applied_price_usd,40)
    f.db.prepare('UPDATE users SET permissions=? WHERE id=71').run('{}')
    const forbidden=await call(f,sales,'/',body)
    assert.equal(forbidden.status,403,JSON.stringify(forbidden))
    f.db.prepare('UPDATE users SET permissions=? WHERE id=71').run(originalActor.permissions)
    actor=originalActor
    const cancel={sale_status:'cancelled',cancel_reason:'other',cancel_note:'Native test cancellation',client_request_id:`lost-cancel-${++serial}`}
    f.hooks.lost=true
    assert.equal((await call(f,sales,`/${item.sale_id}/status`,cancel,'PATCH')).status,200)
    const cancelled=businessState(f)
    assert.equal((await call(f,sales,`/${item.sale_id}/status`,cancel,'PATCH')).status,200)
    assert.equal(businessState(f),cancelled)
    f.db.prepare('UPDATE users SET permissions=? WHERE id=71').run('{"pos":true}')
    assert.equal((await call(f,sales,`/${item.sale_id}/status`,cancel,'PATCH')).status,403)
    console.log('PASS checkout/status lost response, exact intent replay, current permission recheck and no-cost cashier disclosure')
  } finally {actor=originalActor;f.db.close()}
}
async function historicalAncestralEntitlement() {
  console.log('HISTORICAL SUPERSEDED POLICY: permanent ancestral entitlement was rejected by the 2026-10-02 council; this is not current acceptance')
  const f=await soldFixture()
  try {
    const consumed=f.db.prepare('SELECT segment_id FROM stock_valuation_sale_links').get()
    await command(f,valuation('pending',6,2,{agreement_id:'new-receipt-credit',amount_usd:5,targets:[{allocation_id:'affected',amount_usd:5}],proof:'Later accepted credit'}))
    await command(f,valuation('accept',7,3,{agreement_id:'new-receipt-credit',shares:[{segment_id:consumed.segment_id,amount_usd:5}],proof:'Accepted consumed five'}))
    assert.equal((await call(f,sales,`/${f.item.sale_id}/status`,{sale_status:'cancelled',cancel_reason:'other',cancel_note:'Native test cancellation',client_request_id:`new-receipt-cancel-${++serial}`},'PATCH')).status,200)
    const next=saleBody();next.items[0].stock_valuation={source_id:'fund-900',segment_id:consumed.segment_id,expected_revision:9,expected_generation:4}
    const response=await call(f,sales,'/',next)
    assert.equal(response.status,200,`new receipt must consume restored lower basis preserving original lineage: ${JSON.stringify(response)}`)
    const newItem=f.db.prepare('SELECT id,cost_price_usd FROM sale_items WHERE sale_id<>?').get(f.item.sale_id)
    assert.equal(newItem.cost_price_usd,5)
    await assertCostProjection(f,f.item.id,0,0)
    await assertCostProjection(f,newItem.id,50000,0)
    const oldUncancel={sale_status:'completed',client_request_id:`parent-reclaim-${++serial}`}
    assert.equal((await call(f,sales,`/${f.item.sale_id}/status`,oldUncancel,'PATCH')).status,409,'parent cannot reclaim units still consumed by child')
    const child=f.db.prepare('SELECT * FROM stock_valuation_sale_links WHERE sale_item_id=?').get(newItem.id)
    await command(f,valuation('pending',10,4,{agreement_id:'child-credit',amount_usd:2,targets:[{allocation_id:'affected',amount_usd:2}],proof:'Child later credit'}))
    await command(f,valuation('accept',11,5,{agreement_id:'child-credit',shares:[{segment_id:child.segment_id,amount_usd:2}],proof:'Child accepted two'}))
    const cancel=(request)=>({sale_status:'cancelled',cancel_reason:'other',cancel_note:'Reallocation lifecycle',client_request_id:request})
    assert.equal((await call(f,sales,`/${child.sale_id}/status`,cancel(`child-cancel-${++serial}`),'PATCH')).status,200)
    const grand=saleBody();grand.items[0].stock_valuation={source_id:'fund-900',segment_id:child.segment_id,expected_revision:13,expected_generation:6}
    const grandResponse=await call(f,sales,'/',grand)
    assert.equal(grandResponse.status,200,JSON.stringify(grandResponse))
    const grandItem=f.db.prepare('SELECT * FROM sale_items ORDER BY id DESC LIMIT 1').get(),grandLink=f.db.prepare('SELECT * FROM stock_valuation_sale_links WHERE sale_item_id=?').get(grandItem.id)
    await assertCostProjection(f,grandItem.id,30000,0)
    await command(f,valuation('pending',14,6,{agreement_id:'grandchild-credit',amount_usd:1,targets:[{allocation_id:'affected',amount_usd:1}],proof:'Grandchild later credit'}))
    await command(f,valuation('accept',15,7,{agreement_id:'grandchild-credit',shares:[{segment_id:grandLink.segment_id,amount_usd:1}],proof:'Grandchild accepted one'}))
    assert.equal((await call(f,sales,`/${grandItem.sale_id}/status`,cancel(`grandchild-cancel-${++serial}`),'PATCH')).status,200)
    const reclaimed=await call(f,sales,`/${f.item.sale_id}/status`,oldUncancel,'PATCH')
    assert.equal(reclaimed.status,200,`all same units are restored, parent must reclaim current basis2: ${JSON.stringify(reclaimed)}`)
    await assertCostProjection(f,f.item.id,20000,0)
    await assertCostProjection(f,newItem.id,0,0)
    await assertCostProjection(f,grandItem.id,0,0)
    assert.equal((await call(f,sales,`/${child.sale_id}/status`,{sale_status:'completed',client_request_id:`child-blocked-${++serial}`},'PATCH')).status,409)
    assert.equal((await call(f,sales,`/${f.item.sale_id}/status`,cancel(`parent-second-cancel-${++serial}`),'PATCH')).status,200)
    const childReclaimed=await call(f,sales,`/${child.sale_id}/status`,{sale_status:'completed',client_request_id:`child-reclaim-${++serial}`},'PATCH')
    assert.equal(childReclaimed.status,200,JSON.stringify(childReclaimed))
    await assertCostProjection(f,newItem.id,20000,0)
    assert.deepEqual(f.db.prepare('SELECT cost_price_usd FROM sale_items ORDER BY id').all().map(row=>row.cost_price_usd),[10,5,3])
    assert.equal(f.db.prepare("SELECT credit4 FROM stock_funding_latest WHERE source_id='fund-900'").get().credit4,380000)
  } finally {f.db.close()}
}
async function unidentifiedBatchAdmission() {
  const f=fixture()
  try {
    f.db.exec("UPDATE products SET stock_quantity=2,cost_price_usd=10 WHERE id=10;UPDATE product_batches SET received_quantity=2,received_cost_usd=20,unit_cost_usd=10 WHERE id=500;UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=500;UPDATE branch_stock SET quantity=2 WHERE product_id=10;UPDATE inventory_movements SET quantity=1,free_quantity=0,total_cost_usd=10 WHERE id=900;INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(901,10,1,500,'add',1,0,10,'unadmitted-second-receipt',71)")
    const before=businessState(f),body=valuation('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:1,free_quantity:0,gross_usd:10,opening_paid_usd:10,opening_debt_usd:0,reconciliation_proof:'Only X is identified; Y source is not admitted',invoice_id:null}})
    const response=await call(f,inventory,'/valuation-experiment',body)
    assert.equal(response.status,409,JSON.stringify(response))
    assert.equal(response.data.code,'funding_source_identity_or_shared_receipt')
    assert.equal(businessState(f),before)
    console.log('PASS actual shared-batch unidentified-Y admission refuses atomically; this is the upstream admission boundary, NOT an uncancel-selection certificate')
  } finally {f.db.close()}
}
async function currentAssignmentXY(variant='available') {
  const f=fixture()
  const currentSegments=()=>f.db.prepare("SELECT s.* FROM stock_valuation_history_segments s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE e.source_id='fund-900' ORDER BY s.segment_id").all()
  const immutableTables=['stock_valuation_history_events','stock_valuation_history_segments','stock_valuation_history_acceptances','stock_valuation_history_receipts','stock_valuation_sale_links','stock_valuation_sale_movements']
  const immutableSnapshot=()=>immutableTables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all().map(row=>JSON.stringify(row))])
  const assertImmutable=saved=>{for(const [table,rows] of saved){const current=new Set(f.db.prepare(`SELECT * FROM ${table}`).all().map(row=>JSON.stringify(row)));for(const row of rows)assert.ok(current.has(row),`immutable ${table}: ${row}`)}}
  const assertClean=()=>{for(const {name} of f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'stock_*context' OR name GLOB 'stock_*guards')").all())assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,0,`capability cleanup ${name}`)}
  const cancel=request=>({sale_status:'cancelled',cancel_reason:'other',cancel_note:'Current assignment X/Y',client_request_id:request})
  const head=()=>f.db.prepare("SELECT e.revision,g.generation FROM stock_valuation_latest e JOIN stock_funding_latest g ON g.source_id=e.source_id WHERE e.source_id='fund-900'").get()
  const select=(segment)=>{const body=saleBody(),latest=head();body.items[0].stock_valuation={source_id:'fund-900',segment_id:segment,expected_revision:latest.revision,expected_generation:latest.generation};return body}
  const stock=()=>f.db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1').get().quantity
  try {
    f.db.exec('UPDATE products SET stock_quantity=2,cost_price_usd=10 WHERE id=10;UPDATE product_batches SET received_quantity=2,received_cost_usd=20,unit_cost_usd=10 WHERE id=500;UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=500;UPDATE branch_stock SET quantity=2 WHERE product_id=10;UPDATE inventory_movements SET quantity=2,free_quantity=0,total_cost_usd=20 WHERE id=900')
    await command(f,valuation('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:2,free_quantity:0,gross_usd:20,opening_paid_usd:20,opening_debt_usd:0,reconciliation_proof:'X/Y original paid receipt',invoice_id:null}}))
    await command(f,valuation('hold',0,0,{segment_id:'original',child_segment_id:'x-held',quantity:1,reason:'broken'}))
    await command(f,valuation('pending',1,0,{agreement_id:'x-credit-eight',amount_usd:8,targets:[{allocation_id:'x-held',amount_usd:8}],proof:'X only eight'}))
    await command(f,valuation('accept',2,1,{agreement_id:'x-credit-eight',shares:[{segment_id:'x-held',amount_usd:8}],proof:'X accepted eight'}))
    await command(f,valuation('repair',3,2,{segment_id:'x-held',child_segment_id:'x-repaired',quantity:1}))
    assert.deepEqual(currentSegments().map(s=>[s.allocation_id,s.quantity,s.gross4-s.coverage4]).sort(),[['original','1',100000],['x-held','1',20000]])
    const parentBody=select('x-repaired'),parentResponse=await call(f,sales,'/',parentBody)
    assert.equal(parentResponse.status,200,JSON.stringify(parentResponse))
    const parent=f.db.prepare('SELECT * FROM sale_items').get()
    await assertCostProjection(f,parent.id,20000,0)
    const parentHistory=immutableSnapshot(),parentMoney=JSON.stringify(f.db.prepare('SELECT cost_price_usd,cost_price_khr,total_usd,total_khr,pricing_snapshot_json FROM sale_items WHERE id=?').get(parent.id))
    const firstCancel=cancel(`xy-parent-cancel-${++serial}`)
    assert.equal((await call(f,sales,`/${parent.sale_id}/status`,firstCancel,'PATCH')).status,200)
    await assertCostProjection(f,parent.id,0,0)
    assert.equal(stock(),2)
    assertImmutable(parentHistory)
    assertClean()
    const cancelled=businessState(f)
    assert.equal((await call(f,sales,`/${parent.sale_id}/status`,firstCancel,'PATCH')).status,200)
    assert.equal(businessState(f),cancelled,'cancel replay has no durable effects')
    const restoredX=currentSegments().find(s=>s.allocation_id==='x-held'&&s.fate==='sellable')
    assert.equal(restoredX.gross4-restoredX.coverage4,20000)
    const childBody=select(restoredX.segment_id),beforeChild=f.batches.length,childResponse=await call(f,sales,'/',childBody)
    if(childResponse.status!==200) {
      assert.equal(businessState(f),cancelled,'refused child checkout must be atomic')
      assertClean()
      console.log(`OBSERVED X/Y ${variant}: actual admit Q2/G20, X accepted8/repaired2, parent checkout2/cancel/replay succeeded; child checkout=${childResponse.status}. Parent select-Y, later X credit, second cancel and variant assertions NOT EXECUTED.`)
    }
    assert.equal(childResponse.status,200,`current-assignment policy requires a new receipt to buy restored X2: ${JSON.stringify(childResponse)}`)
    const childBatches=f.batches.slice(beforeChild),businessBatches=childBatches.filter(statements=>statements.some(sql=>/INSERT INTO sales\b/.test(sql)))
    assert.equal(businessBatches.length,1)
    assert.ok(childBatches.every(statements=>statements===businessBatches[0]||statements.every(sql=>!/stock_valuation|sale_items|inventory_movements|branch_stock|branch_batch_stock/.test(sql))))
    const child=f.db.prepare('SELECT * FROM sale_items WHERE id<>?').get(parent.id)
    await assertCostProjection(f,child.id,20000,0)
    const afterChild=businessState(f)
    assert.equal((await call(f,sales,'/',childBody)).status,200)
    assert.equal(businessState(f),afterChild,'child checkout replay adds no epoch or effects')
    const uncancel={sale_status:'completed',client_request_id:`xy-parent-uncancel-${++serial}`}
    if(variant!=='available') {
      if(variant==='held') {const latest=head();await command(f,valuation('hold',latest.revision,latest.generation,{segment_id:'original',child_segment_id:'y-held',quantity:1,reason:'broken'}))}
      else if(variant==='consumed') assert.equal((await call(f,sales,'/',select('original'))).status,200)
      else throw Error(`Unsupported actual X/Y variant ${variant}`)
      const unavailable=businessState(f),response=await call(f,sales,`/${parent.sale_id}/status`,uncancel,'PATCH')
      assert.equal(response.status,409,JSON.stringify(response))
      assert.equal(businessState(f),unavailable,'unavailable Y must not take child-owned X')
      await assertCostProjection(f,child.id,20000,0)
      assertImmutable(parentHistory)
      assertClean()
      console.log(`PASS actual X/Y ${variant} selection refusal is atomic while child owns X`)
      return
    }
    const beforeUncancel=immutableSnapshot(),response=await call(f,sales,`/${parent.sale_id}/status`,uncancel,'PATCH')
    assert.equal(response.status,200,`parent selects eligible Y10 while child owns X2: ${JSON.stringify(response)}`)
    await assertCostProjection(f,parent.id,100000,0)
    await assertCostProjection(f,child.id,20000,0)
    assert.equal(stock(),0)
    assertImmutable(beforeUncancel)
    const reconsumed=businessState(f)
    assert.equal((await call(f,sales,`/${parent.sale_id}/status`,uncancel,'PATCH')).status,200)
    assert.equal(businessState(f),reconsumed,'uncancel replay must not select again')
    const childX=currentSegments().find(s=>s.allocation_id==='x-held'&&s.fate==='consumed'),creditHead=head()
    await command(f,valuation('pending',creditHead.revision,creditHead.generation,{agreement_id:'x-credit-one',amount_usd:1,targets:[{allocation_id:'x-held',amount_usd:1}],proof:'Additional X only one'}))
    const acceptHead=head(),accepted=await command(f,valuation('accept',acceptHead.revision,acceptHead.generation,{agreement_id:'x-credit-one',shares:[{segment_id:childX.segment_id,amount_usd:1}],proof:'Child X accepted one'}))
    assert.equal(accepted.funding.credit4,90000)
    assert.equal(accepted.funding.asset4,90000)
    await assertCostProjection(f,parent.id,100000,0)
    await assertCostProjection(f,child.id,20000,10000)
    const beforeFinal=immutableSnapshot(),secondCancel=cancel(`xy-parent-second-cancel-${++serial}`)
    assert.equal((await call(f,sales,`/${parent.sale_id}/status`,secondCancel,'PATCH')).status,200)
    await assertCostProjection(f,parent.id,0,0)
    await assertCostProjection(f,child.id,20000,10000)
    assert.equal(stock(),1)
    assert.deepEqual(currentSegments().map(s=>[s.allocation_id,s.fate,s.quantity,s.gross4-s.coverage4]).sort(),[['original','sellable','1',100000],['x-held','consumed','1',10000]])
    assertImmutable(beforeFinal)
    assertImmutable(parentHistory)
    assert.equal(JSON.stringify(f.db.prepare('SELECT cost_price_usd,cost_price_khr,total_usd,total_khr,pricing_snapshot_json FROM sale_items WHERE id=?').get(parent.id)),parentMoney)
    const rows=f.db.prepare('SELECT sale_item_id,managed,quantity,cost4,recovery4,net4 FROM stock_valuation_sale_costs ORDER BY sale_item_id').all().map(row=>({...row}))
    assert.deepEqual(rows,[{sale_item_id:parent.id,managed:1,quantity:1,cost4:0,recovery4:0,net4:0},{sale_item_id:child.id,managed:1,quantity:1,cost4:20000,recovery4:10000,net4:10000}])
    const activity=f.db.prepare('SELECT sale_item_id,SUM(consumed_cost4) cost4,SUM(consumed_recovery4) recovery4 FROM stock_valuation_sale_recoveries GROUP BY sale_item_id ORDER BY sale_item_id').all().map(row=>({...row}))
    assert.deepEqual(activity,[{sale_item_id:parent.id,cost4:0,recovery4:0},{sale_item_id:child.id,cost4:20000,recovery4:10000}])
    assert.deepEqual(f.db.prepare("SELECT sale_item_id,SUM(consumed_recovery4) recovery4 FROM stock_valuation_sale_recoveries WHERE kind='accept' GROUP BY sale_item_id").all().map(row=>({...row})),[{sale_item_id:child.id,recovery4:10000}])
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM (SELECT sale_item_id,event_id,COUNT(*) n FROM stock_valuation_sale_recoveries GROUP BY sale_item_id,event_id HAVING COUNT(*)>1)').get().n,0,'activity aggregates assignments without fanout')
    const completed=businessState(f)
    assert.equal((await call(f,sales,`/${parent.sale_id}/status`,secondCancel,'PATCH')).status,200)
    assert.equal(businessState(f),completed)
    assertClean()
    console.log('PASS actual X2/Y10 current epochs: child owns X, parent selects/releases Y, X credit stays child-only, quantity once, immutable history and exact current/dated money')
  } finally {f.db.close()}
}
function consumptionMath() {
  const { planValuationSaleSegments, applyValuationCoverage, valuationTotals }=load('lib/stockValuationMath.ts')
  const original=[
    {segment_id:'original',allocation_id:'original',fate:'sellable',quantity:'2',gross4:500000,coverage4:0,loss4:0,recovery4:0,reason:''},
    {segment_id:'disposed',allocation_id:'affected',fate:'disposed',quantity:'1',gross4:250000,coverage4:150000,loss4:250000,recovery4:150000,reason:'broken'},
    {segment_id:'repaired',allocation_id:'affected',fate:'sellable',quantity:'1',gross4:250000,coverage4:150000,loss4:0,recovery4:0,reason:''},
  ]
  const saved=JSON.stringify(original)
  for(const credit of [50000,100000]) {
    let segments=planValuationSaleSegments(original,{kind:'consume',segment_id:'repaired',child_segment_id:'consumed',quantity:1,consumption_id:'sale-link'})
    let totals=valuationTotals(segments,1000000,'4',4)
    assert.equal(totals.consumed_cost4,100000)
    assert.equal(totals.consumed_recovery4,0)
    segments=segments.map(segment=>segment.segment_id==='consumed'?applyValuationCoverage(segment,credit):segment)
    totals=valuationTotals(segments,1000000,'4',4)
    assert.equal(totals.consumed_cost4-totals.consumed_recovery4,100000-credit)
    assert.equal(totals.historical_loss4,250000)
    assert.equal(totals.recovery4,150000)
    segments=planValuationSaleSegments(segments,{kind:'restore',segment_id:'consumed',quantity:1,consumption_id:'sale-link'})
    totals=valuationTotals(segments,1000000,'4',4)
    assert.equal(totals.consumed_cost4,0)
    assert.equal(totals.consumed_recovery4,0)
    assert.equal(totals.sellable_net4,600000-credit)
    assert.throws(()=>planValuationSaleSegments(segments,{kind:'restore',segment_id:'consumed',quantity:1,consumption_id:'sale-link'}))
    segments=planValuationSaleSegments(segments,{kind:'reconsume',segment_id:'consumed',quantity:1,consumption_id:'sale-link'})
    totals=valuationTotals(segments,1000000,'4',4)
    assert.equal(totals.consumed_cost4,100000-credit)
    assert.equal(totals.consumed_recovery4,0)
    assert.equal(totals.historical_loss4,250000)
    assert.equal(totals.recovery4,150000)
  }
  assert.equal(JSON.stringify(original),saved)
  for(const [quantity,gross4,takes] of [['3',70001,['1','1','1']],['0.3',99999,['0.1','0.1','0.1']]]) {
    let segments=[{segment_id:'pool',allocation_id:'pool',fate:'sellable',quantity,gross4,coverage4:0,loss4:0,recovery4:0,reason:''}]
    for(const [index,take] of takes.entries()) segments=planValuationSaleSegments(segments,{kind:'consume',segment_id:'pool',child_segment_id:`take-${index}`,quantity:take,consumption_id:`link-${index}`})
    const totals=valuationTotals(segments,gross4,quantity,4)
    assert.equal(totals.consumed_cost4,gross4)
    assert.equal(totals.sellable_quantity,'0')
    assert.equal(totals.consumed_quantity,quantity)
  }
  assert.notEqual(23334*3,70001,'four-decimal unit snapshots cannot replace exact captured line cost')
  console.log('PASS exact consumed10 credit5/10 restore5/0 reconsume5/0; disposed history unchanged')
}
(async()=>{const section=process.env.STOCK_CONSUMPTION_SECTION;consumptionMath();if(section==='epoch-unidentified'){await unidentifiedBatchAdmission();return}if(section==='epoch-xy'||section==='new-receipt'){await currentAssignmentXY();return}if(section==='epoch-xy-held'||section==='epoch-xy-consumed'){await currentAssignmentXY(section.slice('epoch-xy-'.length));return}if(section!=='math'){await otherLot();await repairedSale();if(!section||section==='failures')await failures();if(!section||section==='security'){await custody();await replayPermissions();await racesAndMovementProof();await reconsumeIgnores()}if(!section||section==='exact'){await repairedSale(10);await exactPool()}if(section==='historical-ancestry')await historicalAncestralEntitlement()}})().catch(error=>{console.error(error);process.exitCode=1})
