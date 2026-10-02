const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const harnessFile=path.join(__dirname,'test-stock-valuation-consumption-native.cjs')
const harnessSource=fs.readFileSync(harnessFile,'utf8'),boundary=harnessSource.lastIndexOf('(async()=>{consumptionMath();')
assert.ok(boundary>0)
const harness=new Module(harnessFile,module);harness.filename=harnessFile;harness.paths=module.paths
harness._compile(harnessSource.slice(0,boundary)+'\nmodule.exports={fixture,repairedFixture,command,call,saleBody,valuation,sales,inventory,load,context,setActor(value){actor=value}};',harnessFile)
const h=harness.exports,analytics=h.load('lib/salesAnalytics.ts'),reports=h.load('routes/reports.ts').default
const env=f=>({DB:f.d1,PLAN_TIER:'paid',STOCK_VALUATION_EXPERIMENT:'local-fixture-only',CACHE:{get:async()=>null,put:async()=>{}}})
async function get(f,url){const response=await reports.request(url,{},env(f),h.context);const text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text)}
async function costs(f,expected,label){
 const snapshot=await analytics.readSalesReportSnapshot(env(f),{})
 assert.equal(analytics.salesTotalsFromSnapshot(snapshot).cost_usd,expected,`${label}: snapshot reducer`)
 assert.equal((await analytics.getSalesTotals(env(f),{})).cost_usd,expected,`${label}: actual totals`)
 assert.equal(analytics.businessSummarySalesRowsFromSnapshot(snapshot).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: records`)
 assert.equal((await analytics.getBusinessSummaryDayRows(env(f),{})).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: day export`)
 assert.equal((await analytics.getProductSalesRanking(env(f),{})).reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: product ranking`)
 assert.equal((await get(f,'/overview')).sales.totals.cost_usd,expected,`${label}: real report API`)
 assert.equal((await get(f,'/business-summary/sales')).rows.reduce((sum,row)=>sum+row.cost_usd,0),expected,`${label}: real record list`)
 assert.equal((await get(f,'/business-summary/sales?intent=export')).totals.cost_usd,expected,`${label}: real export`)
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
  assert.equal((await h.call(f,h.sales,`/${item.sale_id}/status`,{sale_status:'cancelled',cancel_reason:'other',cancel_note:'Reader reversal',client_request_id:'reader-cancel'},'PATCH')).status,200)
  await costs(f,0,'cancel0')
  assert.equal((await h.call(f,h.sales,`/${item.sale_id}/status`,{sale_status:'completed',client_request_id:'reader-uncancel'},'PATCH')).status,200)
  await costs(f,10-credit,`uncancel${10-credit}`)
  assert.deepEqual(f.db.prepare('SELECT cost_price_usd AS cost,total_usd AS total FROM sale_items WHERE id=?').get(item.id),captured)
  console.log('PASS actual report API/totals/export/ranking consumption10 credit5 cancel0 uncancel5, immutable capture')
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
(async()=>{if(process.env.STOCK_READER_SECTION==='residue')await exactResidue();else{await lifecycle();await lifecycle(10);await exactResidue()}})().catch(error=>{console.error(error);process.exitCode=1})
