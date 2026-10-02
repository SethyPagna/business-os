const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const harnessFile=path.join(__dirname,'test-stock-valuation-consumption-native.cjs')
const harnessSource=fs.readFileSync(harnessFile,'utf8'),boundary=harnessSource.lastIndexOf('(async()=>{consumptionMath();')
assert.ok(boundary>0)
const harness=new Module(harnessFile,module);harness.filename=harnessFile;harness.paths=module.paths
assert.equal(harnessSource.split('function fixture() {').length,2)
assert.equal(harnessSource.split('openDb(loadAll()).db').length,2)
const fixtureSource=harnessSource.slice(0,boundary).replace('function fixture() {','function fixture(migrations=loadAll()) {').replace('openDb(loadAll()).db','openDb(migrations).db')
harness._compile(fixtureSource+'\nmodule.exports={fixture,repairedFixture,command,call,saleBody,valuation,sales,inventory,load,context,setActor(value){actor=value}};',harnessFile)
const h=harness.exports,analytics=h.load('lib/salesAnalytics.ts'),reports=h.load('routes/reports.ts').default
const env=f=>({DB:f.d1,PLAN_TIER:'paid',STOCK_VALUATION_EXPERIMENT:'local-fixture-only',CACHE:{get:async()=>null,put:async()=>{throw Error('unexpected report KV write')}}})
async function get(f,url){const response=await reports.request(url,{},env(f),h.context);const text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text)}
async function costs(f,expected,label){
 const before=f.batches.length
 const snapshot=await analytics.readSalesReportSnapshot(env(f),{})
 assert.equal(analytics.salesTotalsFromSnapshot(snapshot).cost_usd,expected,`${label}: snapshot reducer`)
 assert.equal((await analytics.getSalesTotals(env(f),{})).cost_usd,expected,`${label}: actual totals`)
 assert.equal(analytics.businessSummarySalesRowsFromSnapshot(snapshot).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: records`)
 assert.equal((await analytics.getBusinessSummaryDayRows(env(f),{})).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: day export`)
 assert.equal((await analytics.getProductSalesRanking(env(f),{})).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: product ranking`)
 assert.equal((await get(f,'/overview')).sales.totals.cost_usd,expected,`${label}: real report API`)
 assert.equal((await get(f,'/business-summary/sales')).rows.reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: real record list`)
 assert.equal((await get(f,'/business-summary/sales?intent=export')).totals.cost_usd,expected,`${label}: real export`)
 const db=h.load('lib/db.ts').getDb(env(f)),ledger=h.load('lib/productSalesLedger.ts')
 const ledgerSql=await ledger.buildProductSalesLedgerSqlForDb(db)
 const rows=await db.prepare(ledgerSql).all()
 assert.ok(Math.abs(rows.reduce((sum,row)=>sum+Number(row.cogs_usd),0)-expected)<.005,`${label}: actual product ledger`)
 const metrics=[{id:10}];await h.load('routes/inventory.ts').attachInventoryProductMetrics(db,metrics,{})
 assert.ok(Math.abs(Number(metrics[0].cogs_usd)-(rows.find(row=>row.product_id===10)?.cogs_usd||0))<1e-10,`${label}: real inventory records`)
 for(const url of ['/summary','/summary?branchId=1','/stats']){
  const response=await h.inventory.request(url,{},env(f),h.context),text=await response.text();assert.equal(response.status,200,text)
  const body=JSON.parse(text),cost=Array.isArray(body)?body.reduce((sum,row)=>sum+Number(row.cogs_usd),0):body.item.cogs_usd
  assert.ok(Math.abs(cost-expected)<.005,`${label}: inventory ${url}`)
 }
 assert.equal(f.batches.length,before,`${label}: readers never write business batches`)
}
async function lifecycle(credit=5){
 const f=await h.repairedFixture()
 try{
  const sale=await h.call(f,h.sales,'/',h.saleBody());assert.equal(sale.status,200,JSON.stringify(sale))
  const item=f.db.prepare('SELECT * FROM sale_items').get(),captured={cost:item.cost_price_usd,total:item.total_usd}
  f.db.prepare("UPDATE sales SET created_at='2026-09-01 01:00:00' WHERE id=?").run(item.sale_id)
  await costs(f,10,'captured10')
  const consumed=f.db.prepare("SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE s.fate='consumed'").get()
  await h.command(f,h.valuation('pending',6,2,{agreement_id:'reader-credit',amount_usd:credit,targets:[{allocation_id:'affected',amount_usd:credit}],proof:'Reader late credit'}))
  await h.command(f,h.valuation('accept',7,3,{agreement_id:'reader-credit',shares:[{segment_id:consumed.segment_id,amount_usd:credit}],proof:'Reader exact accepted share'}))
  await costs(f,10-credit,`latecredit${credit}`)
  const day=f.db.prepare("SELECT date(occurred_at,'+7 hours') day FROM stock_valuation_sale_recoveries WHERE kind='accept'").get().day
  assert.equal((await get(f,`/consumption-recoveries?startDate=${day}&endDate=${day}`)).recovery_usd,credit)
  assert.equal((await get(f,'/consumption-recoveries?startDate=2026-09-01&endDate=2026-09-01')).recovery_usd,0)
  assert.equal((await analytics.getSalesTotals(env(f),{startDate:'2026-09-01',endDate:'2026-09-01'})).cost_usd,10-credit,'sale bucket uses current net without adding dated activity')
  assert.equal((await analytics.getSalesTotals(env(f),{startDate:day,endDate:day})).cost_usd,0,'credit-day window has no sale COGS')
  assert.equal((await get(f,'/consumption-recoveries?branchId=2')).recovery_usd,0)
  assert.equal((await get(f,'/consumption-recoveries?productId=20')).recovery_usd,0)
  assert.equal((await get(f,'/consumption-recoveries?customerId=200')).recovery_usd,0)
  assert.equal((await h.call(f,h.sales,`/${item.sale_id}/status`,{sale_status:'cancelled',cancel_reason:'other',cancel_note:'Reader reversal',client_request_id:'reader-cancel'},'PATCH')).status,200)
  await costs(f,0,'cancel0')
  const current=await h.load('lib/stockValuationConsumption.ts').readStockValuationSaleCosts(h.load('lib/db.ts').getDb(env(f)),[item.id])
  assert.equal(current.get(item.id).managed,true);assert.equal(current.get(item.id).net4,0)
  const reversed=await get(f,'/consumption-recoveries');assert.equal(reversed.recovery_usd,0)
  assert.ok(reversed.rows.some(row=>row.kind==='restore'&&row.consumed_recovery4===-credit*10000),'recovery reversal is separately dated signed evidence')
  assert.equal((await h.call(f,h.sales,`/${item.sale_id}/status`,{sale_status:'completed',client_request_id:'reader-uncancel'},'PATCH')).status,200)
  await costs(f,10-credit,`uncancel${10-credit}`)
  assert.equal((await get(f,'/consumption-recoveries')).recovery_usd,0,'uncancel lower capture does not reopen reversed recovery')
  assert.deepEqual({...f.db.prepare('SELECT cost_price_usd AS cost,total_usd AS total FROM sale_items WHERE id=?').get(item.id)},captured)
  console.log(`PASS actual report API/totals/export/ranking consumption10 credit${credit} cancel0 uncancel${10-credit}, immutable capture`)
 }finally{f.db.close()}
}
async function exactResidue(){
 const f=h.fixture()
 try{
  f.db.exec('UPDATE product_batches SET received_quantity=3,received_cost_usd=7.0001,unit_cost_usd=2.3334;UPDATE branch_batch_stock SET quantity=3;UPDATE branch_stock SET quantity=3;UPDATE products SET stock_quantity=3;UPDATE inventory_movements SET quantity=3,free_quantity=0,total_cost_usd=7.0001')
  await h.command(f,h.valuation('admit',0,0,{funding:{movement_id:900,batch_id:500,product_id:10,branch_id:1,supplier_id:77,quantity:3,free_quantity:0,gross_usd:7.0001,opening_paid_usd:7.0001,opening_debt_usd:0,reconciliation_proof:'Exact residue opening',invoice_id:null}}))
  const body=h.saleBody();body.amount_paid_usd=120;body.items[0]={...body.items[0],quantity:3,pricing_quote:{gross_usd:120,product_discount_usd:0,manual_discount_usd:0,total_usd:120,total_khr:480000},stock_valuation:{source_id:'fund-900',segment_id:'original',expected_revision:0,expected_generation:0}}
  const sale=await h.call(f,h.sales,'/',body);assert.equal(sale.status,200,JSON.stringify(sale))
  const item=f.db.prepare('SELECT * FROM sale_items').get();assert.equal(item.cost_price_usd,2.3334);assert.equal(item.quantity,3)
  f.db.exec("INSERT INTO products(id,name,sku,is_active) VALUES(20,'Legacy residue','LEGACY',1);INSERT INTO sales(id,receipt_number,sale_status,subtotal_usd,total_usd,branch_id,money_precision_version) VALUES(9000,'legacy-residue','completed',1,1,1,0);INSERT INTO sale_items(sale_id,product_id,product_name,quantity,total_usd,cost_price_usd,branch_id) VALUES(9000,20,'Legacy residue',1,1,.00485,1)")
  await costs(f,7,'exact70001 plus ordinary legacy .00485')
  const snapshot=await analytics.readSalesReportSnapshot(env(f),{})
  assert.equal(new Map(snapshot.managedSaleCosts).get(item.id).net4,70001)
  assert.equal((await analytics.getProductSalesRanking(env(f),{})).find(row=>row.product_id===10).cost_usd,7)
  console.log('PASS exact70001/Q3 versus rounded70002 at aggregate cent boundary with separate legacy line')
 }finally{f.db.close()}
}
async function gates(){
 const f=await h.repairedFixture(),normal={id:71,permissions:'{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"contacts":true,"sales":true,"pos":true}'}
 try{
  f.db.exec("INSERT INTO customers(id,name) VALUES(88,'Reader customer');INSERT INTO branches(id,name,is_active) VALUES(2,'Other branch',1)")
  const body={...h.saleBody(),customer_id:88,sale_status:'awaiting_payment',payment_method:'Credit',amount_paid_usd:0}
  const sale=await h.call(f,h.sales,'/',body);assert.equal(sale.status,200,JSON.stringify(sale))
  const totals=await analytics.getSalesTotals(env(f),{});assert.equal(totals.cost_usd,10);assert.equal(totals.pending_cost_usd,10)
  assert.equal((await analytics.getSalesTotals(env(f),{branchId:2})).cost_usd,0)
  const customer=(await analytics.getSalesGroupedTotals(env(f),{},'customer')).find(row=>row.entity_id===88)
  assert.equal(customer.cost_usd,10)
  assert.equal((await get(f,'/consumption-recoveries?customerId=88')).recovery_usd,0)
  const consumed=f.db.prepare("SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE s.fate='consumed'").get()
  await h.command(f,h.valuation('pending',6,2,{agreement_id:'gate-credit',amount_usd:5,targets:[{allocation_id:'affected',amount_usd:5}],proof:'Pending reader recovery filters'}))
  await h.command(f,h.valuation('accept',7,3,{agreement_id:'gate-credit',shares:[{segment_id:consumed.segment_id,amount_usd:5}],proof:'Pending reader exact consumed recovery'}))
  const credited=await analytics.getSalesTotals(env(f),{});assert.equal(credited.cost_usd,5);assert.equal(credited.pending_cost_usd,5)
  for(const query of ['status=awaiting_payment','customerId=88','branchId=1','productId=10'])assert.equal((await get(f,'/consumption-recoveries?'+query)).recovery_usd,5,query)
  for(const query of ['status=completed','customerId=89','branchId=2','productId=20'])assert.equal((await get(f,'/consumption-recoveries?'+query)).recovery_usd,0,query)
  h.setActor({...normal,permissions:'{"sales":"view"}'})
  const hidden=await get(f,'/overview'),listing=await get(f,'/business-summary/sales?intent=export')
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const key of ['cost_usd','profit_usd','pending_cost_usd','pending_profit_usd','cost4','recovery4','net4','managedSaleCosts'])assert.equal(Object.hasOwn(value,key),false,key);for(const child of Object.values(value))inspect(child)}
  inspect(hidden);inspect(listing)
  assert.equal((await reports.request('/consumption-recoveries',{},env(f),h.context)).status,403)
  h.setActor({...normal,permissions:'{}'})
  for(const url of ['/overview','/business-summary/sales','/consumption-recoveries'])assert.equal((await reports.request(url,{},env(f),h.context)).status,403)
  h.setActor(normal)
  f.db.exec('DROP TRIGGER stock_valuation_sale_items_identity;UPDATE sale_items SET quantity=2')
  const mismatch=await reports.request('/overview',{},env(f),h.context);assert.equal(mismatch.status,422);assert.equal((await mismatch.json()).code,'unsupported_row')
  await assert.rejects(()=>h.load('lib/productSalesLedger.ts').buildProductSalesLedgerSqlForDb(h.load('lib/db.ts').getDb(env(f))),error=>error.code==='unsupported_row')
  console.log('PASS actual pending/branch/customer/cost permission gates and corrupt partial managed-line refusal')
 }finally{h.setActor(normal);f.db.close()}
 const unvalued=await h.repairedFixture()
 try{
  const body=h.saleBody();body.amount_paid_usd=0;body.items[0]={...body.items[0],pricing_source:'manual',selling_price_input_usd:0,price_usd:0,price_khr:0,pricing_quote:{gross_usd:0,product_discount_usd:0,manual_discount_usd:0,total_usd:0,total_khr:0}}
  const sale=await h.call(unvalued,h.sales,'/',body);assert.equal(sale.status,200,JSON.stringify(sale))
  const totals=await analytics.getSalesTotals(env(unvalued),{});assert.equal(totals.cost_usd,0);assert.equal(totals.unvalued_cost_usd,10)
  assert.equal((await analytics.getProductSalesRanking(env(unvalued),{}))[0].cost_usd,10,'product line view retains its independent unvalued-line policy')
  console.log('PASS actual zero-price managed sale preserves valued/unvalued versus product line gates')
 }finally{unvalued.db.close()}
}
async function partialSchema(){
 const migrations=require('./harness/load_migrations.cjs').loadAll(),before215=migrations.filter(sql=>!sql.includes('CREATE TABLE stock_valuation_events_v4'))
 assert.equal(before215.length,migrations.length-1)
 const f=h.fixture(before215)
 try{
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='stock_valuation_sale_costs'").get().n,0)
  f.db.exec("INSERT INTO sales(id,receipt_number,sale_status,subtotal_usd,total_usd,branch_id,money_precision_version) VALUES(9000,'legacy-partial','completed',20,20,1,0);INSERT INTO sale_items(sale_id,product_id,product_name,quantity,total_usd,cost_price_usd,branch_id) VALUES(9000,10,'Legacy cost',2,20,3,1)")
  await costs(f,6,'real pre0215 legacy')
  assert.equal((await get(f,'/consumption-recoveries')).recovery_usd,0)
  f.db.exec('UPDATE sale_items SET cost_price_usd=NULL')
  const missing=await analytics.getSalesTotals(env(f),{});assert.equal(missing.cost_usd,0);assert.equal(analytics.reportMoneyDiagnostic(missing).unknown_cost_lines,1)
  f.db.exec('UPDATE sale_items SET cost_price_usd=0')
  const zero=await analytics.getSalesTotals(env(f),{});assert.equal(zero.cost_usd,0);assert.equal(analytics.reportMoneyDiagnostic(zero).unknown_cost_lines,0)
  f.db.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','restore')")
  const fenced=await reports.request('/consumption-recoveries',{},env(f),h.context);assert.equal(fenced.status,409);assert.equal((await fenced.json()).code,'maintenance_restore')
  console.log('PASS actual pre0215 schema capability, legacy NULL diagnostics/knownzero and recovery restore fence')
 }finally{f.db.close()}
 const corrupt=h.fixture()
 try{
  corrupt.db.exec('DROP VIEW stock_valuation_sale_costs')
  const response=await reports.request('/overview',{},env(corrupt),h.context);assert.equal(response.status,422);assert.equal((await response.json()).code,'unsupported_row')
  console.log('PASS incomplete valuation schema refuses instead of permissive legacy fallback')
 }finally{corrupt.db.close()}
}
async function coherentReads(){
 for(const kind of ['current','activity']){
  const f=await h.repairedFixture()
  try{
   assert.equal((await h.call(f,h.sales,'/',h.saleBody())).status,200)
   const consumed=f.db.prepare("SELECT s.* FROM stock_valuation_segments_v4 s JOIN stock_valuation_latest e ON e.id=s.event_id WHERE s.fate='consumed'").get()
   await h.command(f,h.valuation('pending',6,2,{agreement_id:'race-credit',amount_usd:5,targets:[{allocation_id:'affected',amount_usd:5}],proof:'Coherent reader race'}))
   let reads=0;const prepare=f.d1.prepare
   const decorate=(statement,sql)=>({...statement,bind:(...values)=>decorate(statement.bind(...values),sql),all:async()=>{
    const result=await statement.all()
    const matched=kind==='current'?sql.includes('SELECT l.sale_item_id,l.source_id,l.quantity,s.consumed_cost4'):sql.includes('FROM (SELECT r.*,r.occurred_at AS created_at')
    if(matched&&++reads===1)await h.command(f,h.valuation('accept',7,3,{agreement_id:'race-credit',shares:[{segment_id:consumed.segment_id,amount_usd:5}],proof:'Atomic accepted credit between reader passes'}))
    return result
   }})
   f.d1.prepare=sql=>decorate(prepare(sql),sql)
   if(kind==='current'){
    assert.equal((await analytics.getSalesTotals(env(f),{})).cost_usd,5)
    assert.ok(reads>=4,'changed current net triggers coherent snapshot retry')
   }else{
    const response=await reports.request('/consumption-recoveries',{},env(f),h.context)
    assert.equal(response.status,409);assert.equal((await response.json()).code,'snapshot_changed');assert.equal(reads,2)
   }
   f.d1.prepare=prepare
   console.log(`PASS actual accepted-credit ${kind} read race yields coherent latest cost or coded activity409`)
  }finally{f.db.close()}
 }
}
(async()=>{if(process.env.STOCK_READER_SECTION==='residue')await exactResidue();else if(process.env.STOCK_READER_SECTION==='gates')await gates();else{await lifecycle();await lifecycle(10);await exactResidue();await gates();await partialSchema();await coherentReads()}})().catch(error=>{console.error(error);process.exitCode=1})
