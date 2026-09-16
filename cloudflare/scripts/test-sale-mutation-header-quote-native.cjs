const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
if(process.argv[2]) {
 const canonical=text=>text.replace(/\r\n/g,'\n').replace("from './moneyPrecision.ts'","from './moneyPrecision'")
 assert.equal(canonical(fs.readFileSync(process.argv[2],'utf8')),canonical(fs.readFileSync(path.join(__dirname,'../src/lib/saleMutationHeaderQuote.ts'),'utf8')),'frontend/backend quote source parity')
}
const file=path.join(__dirname,'test-sale-create-atomic-pure.cjs'),source=fs.readFileSync(file,'utf8'),boundary=source.indexOf(';(async () => {')
assert.ok(boundary>0)
const harness=new Module(file,module);harness.filename=file;harness.paths=module.paths
harness._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")+'\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,load,USER,setUser(value){currentUser=value}};',file)
const h=harness.exports,q=h.load('lib/saleMutationHeaderQuote.ts')
const basis={subtotal_usd:10,discount_usd:0,membership_discount_usd:0,tax_usd:1,exchange_rate:4000,is_delivery:0,delivery_fee_usd:0}
for(const [sale,settings,reason,tax] of [[basis,{tax_enabled:1,tax_rate:10},'recomputed',2],[{...basis,tax_usd:0},{tax_enabled:1,tax_rate:10},'no_tax_on_sale',0],
  [basis,{tax_enabled:0,tax_rate:10},'tax_disabled',1],[basis,{tax_enabled:1,tax_rate:0},'no_rate',1],[basis,{tax_enabled:1,tax_rate:11},'rate_mismatch',1]]) {
  const quote=q.quoteSaleMutationHeader(sale,20,settings);assert.equal(quote.tax_reason,reason);assert.equal(quote.tax_usd,tax)
  assert.equal(q.compareSaleHeaderQuote(quote,quote),'match');assert.equal(q.compareSaleHeaderQuote(undefined,quote),'missing')
  assert.throws(()=>q.compareSaleHeaderQuote({...quote,subtotal_usd:-1},quote))
}
;(async()=>{
 h.setUser({...h.USER,permissions:'{"all":true}'})
 let race=false
 const f=h.fixture({beforeBatch(db){if(race){race=false;db.prepare("UPDATE settings SET value='0' WHERE key='tax_enabled'").run()}}})
 f.raw.prepare("INSERT INTO settings(key,value) VALUES('tax_enabled','1'),('tax_rate','10')").run()
 const item=key=>({product_id:10,quantity:1,branch_id:1,batch_id:500,client_line_key:key,pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}})
 const created=await h.postSale(f.route,{...h.request('header-sale'),money_precision_version:1,tax_usd:.95,items:[item('original')]})
 assert.equal(created.status,200,JSON.stringify(created.body))
 const sale=created.body.sale
 const send=async body=>{const response=await h.app.request(`/${sale.id}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx);return {status:response.status,body:await response.json()}}
 const body={money_precision_version:1,client_request_id:'header-add',expected_exchange_rate:4000,items:[item('added')]}
 const before=h.creationState(f.raw),missing=await send(body)
 assert.equal(missing.status,409);assert.equal(missing.body.code,'sale_header_quote_conflict');assert.equal(missing.body.proven_uncommitted,true)
 assert.equal(missing.body.header_quote.tax_usd,1.9);assert.equal(missing.body.header_quote.total_usd,20.9)
 assert.deepEqual(h.creationState(f.raw),before)
 assert.equal((await send({...body,expected_header_quote:{...missing.body.header_quote,subtotal_usd:-1}})).status,400)
 assert.deepEqual(h.creationState(f.raw),before)
 const accepted={...body,expected_header_quote:missing.body.header_quote},saved=await send(accepted)
 assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.sale.tax_usd,1.9)
 h.load('lib/saleItemPricing.ts').validateCapturedSaleBasket(saved.body.sale.items,saved.body.sale)
 f.raw.prepare("UPDATE settings SET value='50' WHERE key='tax_rate'").run()
 assert.deepEqual((await send(accepted)).body,saved.body,'committed receipt precedes changed settings/quote evaluation')
 const next={...body,client_request_id:'header-next',items:[item('next')],expected_header_quote:missing.body.header_quote}
 const current=h.creationState(f.raw),stale=await send(next)
 assert.equal(stale.status,409);assert.equal(stale.body.header_quote.tax_reason,'rate_mismatch');assert.equal(stale.body.header_quote.total_usd,30.4)
 assert.deepEqual(h.creationState(f.raw),current)
 race=true
 const raced=await send({...next,expected_header_quote:stale.body.header_quote})
 assert.equal(raced.status,409);assert.deepEqual(h.creationState(f.raw),current,'settings race cannot commit any stock/receipt mutation')
 f.raw.prepare("UPDATE settings SET value='1' WHERE key='tax_enabled'").run()
 f.raw.prepare("UPDATE settings SET value='10' WHERE key='tax_rate'").run()
 const amend=async body=>{const response=await h.app.request(`/${sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx);return {status:response.status,body:await response.json()}}
 const editBody={kind:'line_updated',sale_item_id:saved.body.sale.items[0].id,quantity:2,money_precision_version:1,client_request_id:'taxed-edit',expected_exchange_rate:4000,
   pricing_quote:{gross_usd:19,product_discount_usd:0,manual_discount_usd:0,total_usd:19,total_khr:76000}}
 const editReview=await amend(editBody);assert.equal(editReview.status,409);assert.equal(editReview.body.header_quote.tax_usd,2.85)
 const edit=await amend({...editBody,expected_header_quote:editReview.body.header_quote})
 assert.equal(edit.status,200,JSON.stringify(edit.body));assert.equal(edit.body.sale.total_usd,31.35)
 h.load('lib/saleItemPricing.ts').validateCapturedSaleBasket(edit.body.sale.items,edit.body.sale)
 const removeBody={kind:'line_removed',sale_item_id:edit.body.sale.items[0].id,money_precision_version:1,client_request_id:'taxed-remove',expected_exchange_rate:4000}
 const removeReview=await amend(removeBody);assert.equal(removeReview.status,409);assert.equal(removeReview.body.header_quote.total_usd,10.45)
 const removed=await amend({...removeBody,expected_header_quote:removeReview.body.header_quote})
 assert.equal(removed.status,200,JSON.stringify(removed.body));assert.equal(removed.body.sale.tax_usd,.95)
 h.load('lib/saleItemPricing.ts').validateCapturedSaleBasket(removed.body.sale.items,removed.body.sale)
 f.raw.db.close()
 console.log('PASS exact header reasons, missing/malformed/stale refusal, reviewed tax change, receipt-first replay and atomic settings race')
})().catch(error=>{console.error(error);process.exitCode=1})
