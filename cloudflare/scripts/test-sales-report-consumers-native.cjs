const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const file=path.join(__dirname,'test-sale-create-atomic-pure.cjs'),source=fs.readFileSync(file,'utf8'),boundary=source.indexOf(';(async () => {')
assert.ok(boundary>0)
const harness=new Module(file,module);harness.filename=file;harness.paths=module.paths
harness._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")+'\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,cache:overrides["../lib/cache"],setUser(value){currentUser=value}};',file)
const h=harness.exports
;(async()=>{
 const f=h.fixture()
 h.setUser({...h.USER,permissions:'{"all":true}'})
 const created=await h.postSale(f.route,{...h.request('report-sale'),money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,client_line_key:'report-line',pricing_source:'manual',selling_price_input_usd:10,manual_discount_type:'fixed',manual_discount_value:.0044,
   pricing_quote:{gross_usd:10,product_discount_usd:0,manual_discount_usd:.0044,total_usd:9.9956,total_khr:39982.4}}]})
 assert.equal(created.status,200,JSON.stringify(created.body))
 f.raw.prepare("UPDATE sales SET created_at='2026-09-13 01:00:00',is_delivery=1,delivery_actual_cost_usd=2 WHERE id=?").run([created.body.id])
 const paths=['/stats-strip?startDate=2026-09-13&endDate=2026-09-13','/daily-report?startDate=2026-09-13&endDate=2026-09-13','/day-report?date=2026-09-13']
 const get=async url=>{const response=await h.app.request(url,{}, {DB:f.route},h.executionCtx);const text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text)}
 const privateKeys=['cost_usd','profit_usd','pending_cost_usd','pending_profit_usd','delivery_actual_cost_usd','delivery_net_usd','delivery_margin_usd','recognized_delivery_cost_usd','pending_delivery_cost_usd','actual_cost_usd','linked_expense_usd','margin_usd']
 const admin=await get(paths[0]);assert.equal(admin.totals.cost_usd,4);assert.equal(admin.totals.revenue_usd,10,'header adjustment recognized exactly once')
 h.setUser({...h.USER,permissions:'{"sales":true}'})
 const inspect=value=>{if(!value||typeof value!=='object')return;for(const key of privateKeys)assert.equal(Object.prototype.hasOwnProperty.call(value,key),false,key);for(const child of Object.values(value))inspect(child)}
 for(const url of paths){const payload=await get(url);inspect(payload)}
 const listUrl='/?startDate=2026-09-13&endDate=2026-09-13'
 const assertList=async(permissions,admin,delivery)=>{
   h.setUser({...h.USER,permissions:JSON.stringify(permissions)})
   const rows=await get(listUrl),row=rows.find(row=>row.id===created.body.id)
   assert.equal(Object.hasOwn(row,'delivery_actual_cost_usd'),delivery)
   if(delivery)assert.equal(row.delivery_actual_cost_usd,2)
   assert.equal(Object.hasOwn(row,'creation_snapshot_json'),admin)
   assert.equal(Object.hasOwn(row.items[0],'cost_price_usd'),admin)
   assert.equal(Object.hasOwn(row.items[0],'cost_price_khr'),admin)
   assert.ok(row.items[0].pricing_snapshot_json,'public captured pricing remains available')
 }
 for(const [permissions,admin,delivery] of [[{all:true},true,true],[{sales:true},false,true],[{sales:'view'},false,false],[{sales:true,'sales:amend':false},false,false]])await assertList(permissions,admin,delivery)
 const originalCache=h.cache.cachedJsonResponse,cacheEntries=new Map()
 h.cache.cachedJsonResponse=async(request,_context,_key,_ttl,loader)=>{
   if(!cacheEntries.has(request.url))cacheEntries.set(request.url,await loader())
   return cacheEntries.get(request.url)
 }
 await assertList({all:true},true,true)
 await assertList({sales:'view'},false,false)
 await assertList({sales:true},false,true)
 await assertList({sales:true,'sales:amend':false},false,false)
 await assertList({all:true},true,true)
 h.cache.cachedJsonResponse=originalCache
 const module=h.load('routes/sales.ts')
 const courier={charged_fee_usd:5,actual_cost_usd:2,actual_cost_count:1,linked_expense_count:1,linked_expense_usd:2,linked_expense_khr:0,last_expense_at:'private',margin_usd:3}
 assert.deepEqual(module.gateSalesCourierMoney(courier,false),{charged_fee_usd:5})
 assert.equal(module.gateSalesCourierMoney(courier,true),courier)
 h.setUser({...h.USER,permissions:'{"all":true}'})
 for(let index=0;index<3;index++){
   f.raw.prepare("INSERT INTO sales(receipt_number,sale_status,total_usd,created_at,branch_id) VALUES(?,'cancelled',.0044,'2026-09-13 01:00:00',1)").run([`void-${index}`])
   f.raw.prepare("INSERT INTO returns(return_number,total_refund_usd,created_at,branch_id) VALUES(?,.0044,'2026-09-13 01:00:00',1)").run([`activity-${index}`])
 }
 const exact=await get(paths[0])
 assert.deepEqual(exact.by_status.find(row=>row.sale_status==='cancelled'),{sale_status:'cancelled',count:3,total_usd:.01})
 assert.deepEqual(exact.returns,{count:3,refund_usd:.01})
 assert.equal(exact.totals.revenue_usd,10,'independent return-date activity must not be subtracted from sale-basis revenue')
 const filtered=await get('/stats?startDate=2026-09-13&endDate=2026-09-13')
 assert.equal(filtered.total_count,4);assert.equal(filtered.revenue_count,1);assert.equal(filtered.revenue_usd,10)
 const voidOnly=await get('/stats?status=cancelled&search=void')
 assert.equal(voidOnly.total_count,3);assert.equal(voidOnly.revenue_count,0);assert.equal(voidOnly.revenue_usd,0)
 const missing=await get('/stats?search=no-such-customer&cashier=nobody');assert.equal(missing.total_count,0)
 f.raw.prepare("UPDATE returns SET sale_id=? WHERE return_number LIKE 'activity-%'").run([created.body.id])
 const listing=await get('/?startDate=2026-09-13&endDate=2026-09-13')
 const saleRow=listing.find(row=>row.id===created.body.id)
 assert.equal(saleRow.refund_usd,.0132);assert.equal(saleRow.net_total_usd,9.9868);assert.equal(saleRow.return_count,3)
 f.raw.prepare("UPDATE returns SET sale_id=NULL WHERE return_number LIKE 'activity-%'").run()
 const precision=h.load('lib/reportMoneyPrecision.ts')
 h.app.onError((error,c)=>{if(error instanceof precision.ReportMoneyPrecisionError){const mapped=precision.reportMoneyHttpError(error);return c.json({code:error.code},mapped.status)}throw error})
 const prepare=f.route.prepare.bind(f.route);let activityReads=0
 f.route.prepare=sql=>{
   const statement=prepare(sql)
   if(/SELECT id,total_refund_usd/.test(sql))return {...statement,all:params=>{
     if(++activityReads===2)f.raw.prepare("UPDATE returns SET total_refund_usd=.0099 WHERE return_number='activity-0'").run()
     return statement.all(params)
   }}
   return statement
 }
 const raced=await h.app.request(paths[0],{}, {DB:f.route},h.executionCtx)
 assert.equal(raced.status,409);assert.deepEqual(await raced.json(),{code:'snapshot_changed'})
 f.route.prepare=prepare
 h.setUser({...h.USER,permissions:'{}'})
 const denied=await h.app.request(paths[0],{}, {DB:f.route},h.executionCtx);assert.equal(denied.status,403)
 f.raw.db.close()
 console.log('PASS actual employee/admin cost gates, exact status/return activity, independent refund cohort, coherent-read race refusal and adjustment recognition')
})().catch(error=>{console.error(error);process.exitCode=1})
