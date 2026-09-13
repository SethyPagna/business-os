const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const file=path.join(__dirname,'test-sale-create-atomic-pure.cjs'),source=fs.readFileSync(file,'utf8'),boundary=source.indexOf(';(async () => {')
assert.ok(boundary>0)
const fixtureModule=new Module(file,module);fixtureModule.filename=file;fixtureModule.paths=module.paths
assert.ok(source.includes("fs.readFileSync(sourcePath, 'utf8')"))
fixtureModule._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")
 .replace("fs.readFileSync(sourcePath, 'utf8')","(fs.readFileSync(sourcePath, 'utf8')+(rel==='routes/sales.ts'?'\\nexport {capturePrecisionBasket};':''))")
 +'\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};',file)
const h=fixtureModule.exports,helper=h.load('lib/historicalSalePricing.ts')
const contract=h.load('lib/saleMoneyPrecision.ts')
const headerHelper=h.load('lib/saleMutationHeaderQuote.ts')
const tinyHeader=headerHelper.quoteSaleMutationHeader({money_precision_version:0,subtotal_usd:.00007,discount_usd:.00003,membership_discount_usd:.00003,tax_usd:0,exchange_rate:4000},.00007,{tax_enabled:0,tax_rate:0})
assert.equal(tinyHeader.calculated_total_usd,0)
assert.equal(tinyHeader.discount_usd,.00003)
assert.equal(headerHelper.compareSaleHeaderQuote(tinyHeader,tinyHeader),'match')
const migrationDb=new(require('node:sqlite').DatabaseSync)(':memory:')
migrationDb.exec('CREATE TABLE sales(id INTEGER PRIMARY KEY,total_usd REAL); INSERT INTO sales VALUES(1,1.234567)')
const initialSchema=fs.readFileSync(path.join(__dirname,'../migrations/0158_sale_return_money_precision.sql'),'utf8').split('ALTER TABLE returns')[0]
migrationDb.exec(initialSchema)
const unchanged=JSON.stringify(migrationDb.prepare('SELECT * FROM sales').all())
const migration=fs.readFileSync(path.join(__dirname,'../migrations/0161_sale_edited_legacy_money_precision.sql'),'utf8')
assert.ok(!migration.includes('\r'));migrationDb.exec(migration)
assert.equal(JSON.stringify(migrationDb.prepare('SELECT * FROM sales').all()),unchanged)
for(const [raw,adjust,payable] of [[1.2345,-.0045,1.23],[1.235,.005,1.24],[1e11,0,1e11]]){
 migrationDb.prepare('UPDATE sales SET calculated_total_usd=?,rounding_adjustment_usd=?,total_usd=? WHERE id=1').run(raw,adjust,payable)
 contract.validateSaleMoneySnapshot(migrationDb.prepare('SELECT * FROM sales').get())
}
for(const [raw,adjust,payable] of [[1.23456,-.00456,1.23],[1,.01,1.01],[1.235,-.005,1.23],[1e11+.0001,0,1e11+.0001]])
 assert.throws(()=>migrationDb.prepare('UPDATE sales SET calculated_total_usd=?,rounding_adjustment_usd=?,total_usd=? WHERE id=1').run(raw,adjust,payable))
assert.throws(()=>contract.validateSaleMoneySnapshot({money_precision_version:0,calculated_total_usd:1,total_usd:1}))
assert.throws(()=>contract.validateSaleMoneySnapshot({calculated_total_usd:null,rounding_adjustment_usd:0,total_usd:1}))
migrationDb.close()
const historical={id:1,quantity:3,applied_price_usd:9,base_price_usd:10,manual_discount_type:'fixed',manual_discount_value:1,manual_discount_usd:1,pricing_snapshot_json:null,cost_price_usd:null,total_usd:27,total_khr:108000}
assert.deepEqual(helper.planHistoricalSaleLine(historical,{},3,4000).row,historical)
const reduced=helper.planHistoricalSaleLine(historical,{},2,4000)
assert.equal(reduced.row.total_usd,18);assert.equal(reduced.row.pricing_snapshot_json,null);assert.equal(reduced.row.cost_price_usd,null)
assert.equal(reduced.row.applied_price_usd,9);assert.equal(reduced.row.manual_discount_value,1)
assert.throws(()=>helper.planHistoricalSaleLine(historical,{base_price_usd:-.00001},2,4000))
const rawFallback=helper.planHistoricalSaleLine({...historical,quantity:1,applied_price_usd:1.23454,base_price_usd:null,manual_discount_type:null,manual_discount_usd:0,manual_discount_value:0},{},3,4000)
assert.equal(rawFallback.row.applied_price_usd,1.23454);assert.equal(rawFallback.row.total_usd,3.7036);assert.equal(rawFallback.quote.manual_discount_usd,0)
assert.equal(helper.planHistoricalSaleLine({...historical,base_price_usd:0},{},2,4000).row.total_usd,18)
assert.throws(()=>helper.planHistoricalSaleLine(historical,{base_price_usd:1.23004},2,4000))
assert.equal(helper.planHistoricalSaleLine({...historical,manual_discount_type:null,manual_discount_value:0,manual_discount_usd:0},{selling_price_input_usd:1.23004},2,4000).row.base_price_usd,1.24)
;(async()=>{
 h.setUser({...h.USER,permissions:'{"all":true}'})
 let race=false
 const f=h.fixture({beforeBatch(db){if(race){race=false;db.prepare("UPDATE sales SET notes='concurrent edit' WHERE client_request_id='historical-fixture'").run()}}})
 const created=await h.postSale(f.route,{...h.request('historical-fixture'),money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,
  client_line_key:'original',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}]})
 assert.equal(created.status,200,JSON.stringify(created.body))
 const id=created.body.sale.id
 // Local fixture only: represent a real pre-migration sale with unknown pricing.
 f.raw.prepare('UPDATE sales SET money_precision_version=0,calculated_total_usd=NULL,rounding_adjustment_usd=0 WHERE id=?').run([id])
 f.raw.prepare('UPDATE sale_items SET pricing_snapshot_json=NULL WHERE sale_id=?').run([id])
 const line=f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').get([id])
 h.setUser({...h.USER,role_code:'employee',permissions:'{"sales":true,"pos":true}'})
 const planned=helper.planHistoricalSaleLine(line,{},2,4000)
 const body={kind:'line_updated',sale_item_id:line.id,quantity:2,money_precision_version:1,expected_exchange_rate:4000,client_request_id:'historical-qty',pricing_quote:planned.quote}
 const send=async payload=>{const r=await h.app.request(`/${id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:f.route},h.executionCtx);return {status:r.status,body:await r.json()}}
 const review=await send(body)
 assert.equal(review.status,409,JSON.stringify(review.body));assert.equal(review.body.code,'sale_header_quote_conflict')
 const accepted={...body,expected_header_quote:review.body.header_quote},saved=await send(accepted)
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 const after=f.raw.prepare('SELECT * FROM sales WHERE id=?').get([id]),item=f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id])
 assert.equal(after.money_precision_version,0);assert.equal(after.calculated_total_usd,19);assert.equal(after.rounding_adjustment_usd,0)
 assert.equal(item.pricing_snapshot_json,null);assert.equal(item.total_usd,19);assert.equal(after.total_usd,19)
 assert.equal((await send(accepted)).status,200)
 assert.equal((await send({...body,client_request_id:'historical-negative',kind:'line_quantity_increased',quantity:-1})).status,400)
 assert.equal((await send({...body,client_request_id:'historical-noop',quantity:2})).status,400)
 // Independent legacy before-image: add/undo must restore unknown header data.
 f.raw.prepare('UPDATE sales SET calculated_total_usd=NULL,rounding_adjustment_usd=0 WHERE id=?').run([id])
 const reviewed=async(payload,route='amendments')=>{
  const dispatch=async body=>{const r=await h.app.request(`/${id}/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx);return {status:r.status,body:await r.json()}}
  const raw={money_precision_version:1,expected_exchange_rate:4000,...payload},first=await dispatch(raw)
  assert.equal(first.status,409,JSON.stringify(first.body));assert.equal(first.body.code,'sale_header_quote_conflict')
  const result=await dispatch({...raw,expected_header_quote:first.body.header_quote});assert.equal(result.status,200,JSON.stringify(result.body));return result
 }
 const plain=key=>({product_id:10,quantity:1,branch_id:1,batch_id:500,client_line_key:key,pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}})
 const addition=await reviewed({client_request_id:'historical-add',items:[plain('added')]},'items')
 assert.equal(f.raw.prepare('SELECT total_usd FROM sales WHERE id=?').get([id]).total_usd,28.5)
 assert.equal(f.raw.prepare('SELECT pricing_snapshot_json FROM sale_items WHERE id=?').get([line.id]).pricing_snapshot_json,null)
 let replayGuard
 const replay=async direction=>{
  const history=f.raw.prepare('SELECT * FROM action_history WHERE id=?').get([addition.body.actionHistoryId])
  const payload=JSON.parse(history[direction==='undo'?'undo_payload':'redo_payload'])
  const replayDb={...f.route,batch:async statements=>{replayGuard=statements.find(statement=>statement.sql.includes('@replaySale'));return f.route.batch(statements)}}
  await h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload,{env:{DB:replayDb},user:{...h.USER,permissions:'{"all":true}'},direction,historyId:history.id,generation:payload.generation})
 }
 await replay('undo');assert.equal(f.raw.prepare('SELECT total_usd FROM sales WHERE id=?').get([id]).total_usd,19)
 assert.equal(f.raw.prepare('SELECT calculated_total_usd FROM sales WHERE id=?').get([id]).calculated_total_usd,null)
 assert.equal(f.raw.prepare('SELECT pricing_snapshot_json FROM sale_items WHERE id=?').get([line.id]).pricing_snapshot_json,null)
 await replay('redo');assert.equal(f.raw.prepare('SELECT total_usd FROM sales WHERE id=?').get([id]).total_usd,28.5)
 const added=f.raw.prepare('SELECT id FROM sale_items WHERE sale_id=? AND id<>?').get([id,line.id]).id
 await reviewed({client_request_id:'historical-replace',kind:'line_replaced',sale_item_id:added,replacement:plain('replacement')})
 const replacement=f.raw.prepare('SELECT id FROM sale_items WHERE sale_id=? AND id<>?').get([id,line.id]).id
 await reviewed({client_request_id:'historical-remove',kind:'line_removed',sale_item_id:replacement})
 assert.equal(f.raw.prepare('SELECT total_usd FROM sales WHERE id=?').get([id]).total_usd,19)
 const lineBeforeFee=f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id])
 f.raw.prepare('UPDATE sales SET is_delivery=1,subtotal_usd=19.00004,discount_usd=.00003,discount_khr=.12 WHERE id=?').run([id])
 await reviewed({client_request_id:'historical-fee',kind:'delivery_fee_changed',delivery_fee_usd:1.2345})
 const feeHeader=f.raw.prepare('SELECT * FROM sales WHERE id=?').get([id])
 assert.equal(feeHeader.subtotal_usd,19.00004);assert.equal(feeHeader.discount_usd,.00003);assert.equal(feeHeader.discount_khr,.12)
 assert.equal(feeHeader.calculated_total_usd,20.2345);assert.equal(feeHeader.total_usd,20.23);assert.equal(feeHeader.rounding_adjustment_usd,-.0045)
 assert.deepEqual(f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id]),lineBeforeFee)
 const current=f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id])
 const raceBody={...body,client_request_id:'historical-race',quantity:3,pricing_quote:helper.planHistoricalSaleLine(current,{},3,4000).quote}
 const raceReview=await send(raceBody);assert.equal(raceReview.body.code,'sale_header_quote_conflict')
 const stockBefore=f.raw.prepare('SELECT * FROM branch_stock').all(),historyBefore=f.raw.prepare('SELECT COUNT(*) n FROM sale_amendments').get().n
 race=true
 const raced=await send({...raceBody,expected_header_quote:raceReview.body.header_quote})
 assert.equal(raced.status,409);assert.equal(raced.body.code,'write_conflict')
 assert.deepEqual(f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id]),current)
 assert.deepEqual(f.raw.prepare('SELECT * FROM branch_stock').all(),stockBefore)
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM sale_amendments').get().n,historyBefore)
 h.setUser({...h.USER,role_code:'employee',permissions:'{"sales":"view"}'})
 assert.equal((await send({...raceBody,client_request_id:'denied-edit'})).status,403)
 h.setUser({...h.USER,role_code:'employee',permissions:'{"sales":true,"pos":true}'})
 f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment',amount_paid_usd=0,amount_paid_khr=0,payment_details='[]' WHERE id=?").run([id])
 f.raw.prepare("INSERT INTO settings(key,value) VALUES('exchange_rate','5000') ON CONFLICT(key) DO UPDATE SET value='5000'").run()
 const beforePayment=f.raw.prepare('SELECT * FROM sales WHERE id=?').get([id]),beforePaymentLines=f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').all([id])
 const settled=await h.app.request(`/${id}/status`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({client_request_id:'historical-pay',sale_status:'completed',expected_exchange_rate:4000,payment_details:[{method:'Cash',amount_usd:20,amount_khr:920}]})},{DB:f.route},h.executionCtx)
 assert.equal(settled.status,200,JSON.stringify(await settled.json()))
 const paid=f.raw.prepare('SELECT * FROM sales WHERE id=?').get([id])
 for(const key of ['money_precision_version','calculated_total_usd','rounding_adjustment_usd','subtotal_usd','subtotal_khr','discount_usd','discount_khr','total_usd','total_khr','exchange_rate'])assert.equal(paid[key],beforePayment[key],key)
 assert.deepEqual(f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').all([id]),beforePaymentLines)
 f.raw.prepare('UPDATE sale_items SET total_usd=NULL WHERE id=?').run([line.id])
 const unknown=f.raw.prepare('SELECT * FROM sale_items WHERE id=?').get([line.id])
 const unknownBody={...body,client_request_id:'historical-null-total',quantity:3,pricing_quote:helper.planHistoricalSaleLine(unknown,{},3,4000).quote}
 const unknownReview=await send(unknownBody);assert.equal(unknownReview.body.code,'historical_line_total_review_needed')
 assert.equal(unknownReview.body.expected_recorded_line_total_usd,19)
 const knownBasis={...unknownBody,expected_recorded_line_total_usd:19},headerReview=await send(knownBasis)
 assert.equal(headerReview.body.code,'sale_header_quote_conflict')
 const frozenFallback={...knownBasis,expected_header_quote:headerReview.body.header_quote}
 assert.equal((await send(frozenFallback)).status,200)
 const nativeBasket=await h.load('routes/sales.ts').capturePrecisionBasket(f.route,f.raw.prepare('SELECT * FROM sales WHERE id=?').get([id]))
 const {Miniflare}=require('miniflare'),mf=new Miniflare({modules:true,script:'',d1Databases:['DB']})
 try{
  const native=await mf.getD1Database('DB'),required=new Set(['sales','sale_items','sale_mutation_guards','products','promotion_rules'])
  assert.ok(replayGuard)
  const tables=new Set(f.raw.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name))
  for(const match of replayGuard.sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]\w*)/gi))if(tables.has(match[1]))required.add(match[1])
  for(const name of required)for(const fk of f.raw.db.prepare(`PRAGMA foreign_key_list(${name})`).all())required.add(fk.table)
  const schema=f.raw.db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name<>'sqlite_sequence'").all().filter(row=>required.has(row.tbl_name))
  await native.batch(schema.map(row=>native.prepare(row.sql)))
  const inserts=[]
  for(const name of required)for(const row of f.raw.db.prepare(`SELECT * FROM ${name}`).all()){
   const keys=Object.keys(row);inserts.push(native.prepare(`INSERT INTO ${name}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...Object.values(row)))
  }
  await native.batch([native.prepare('PRAGMA defer_foreign_keys=ON'),...inserts])
  const adapter=h.load('lib/db.ts').getDb({DB:native})
  const captured=f.raw.prepare('SELECT * FROM products WHERE id=10').get()
  const sourceGuard=h.load('lib/saleItemPricing.ts').pricingSourceGuard([captured],[])
  await adapter.batch([sourceGuard])
  await adapter.batch([{sql:'DELETE FROM sale_mutation_guards',params:{}},nativeBasket.guard])
  await native.prepare("UPDATE products SET name='changed concurrently' WHERE id=10").run()
  await assert.rejects(adapter.batch([sourceGuard,{sql:'UPDATE products SET stock_quantity=999 WHERE id=10',params:{}}]))
  assert.notEqual((await native.prepare('SELECT stock_quantity FROM products WHERE id=10').first()).stock_quantity,999)
  await native.prepare("UPDATE sales SET notes='native concurrent edit' WHERE id=?").bind(id).run()
  await assert.rejects(adapter.batch([{sql:'DELETE FROM sale_mutation_guards',params:{}},nativeBasket.guard,{sql:'UPDATE products SET stock_quantity=998 WHERE id=10',params:{}}]))
  assert.notEqual((await native.prepare('SELECT stock_quantity FROM products WHERE id=10').first()).stock_quantity,998)
  // Stale undo is expected to refuse, but its actual wide guard must compile
  // under native D1's depth100 limit before checking the old evidence.
  await assert.rejects(adapter.batch([{sql:'DELETE FROM sale_mutation_guards',params:{}},replayGuard]),/CHECK constraint failed|malformed JSON/)
 }finally{await mf.dispose()}
 f.raw.exec('DROP TRIGGER sales_money_precision_update_0161')
 assert.equal((await send(frozenFallback)).status,200,'committed receipt must precede readiness and repricing')
 const missingSchema=await send({...frozenFallback,client_request_id:'schema-unavailable'})
 assert.equal(missingSchema.status,409);assert.equal(missingSchema.body.code,'historical_sale_schema_not_ready')
 const g=h.fixture(),deliveryCreated=await h.postSale(g.route,{...h.request('delivery-legacy-fixture'),money_precision_version:1,items:[plain('delivery-original')]})
 assert.equal(deliveryCreated.status,200)
 const deliveryId=deliveryCreated.body.sale.id
 g.raw.prepare('UPDATE sales SET money_precision_version=0,calculated_total_usd=NULL,rounding_adjustment_usd=0 WHERE id=?').run([deliveryId])
 g.raw.prepare('UPDATE sale_items SET pricing_snapshot_json=NULL WHERE sale_id=?').run([deliveryId])
 g.raw.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(7,'Driver','010')").run()
 const deliveryLines=g.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').all([deliveryId])
 const deliveryBody={money_precision_version:1,kind:'delivery_added',delivery_contact_id:7,delivery_fee_usd:.0001,delivery_actual_cost_usd:.0001,expected_exchange_rate:4000,client_request_id:'historical-delivery-added'}
 const sendDelivery=async payload=>{const r=await h.app.request(`/${deliveryId}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:g.route},h.executionCtx);return {status:r.status,body:await r.json()}}
 const deliveryReview=await sendDelivery(deliveryBody);assert.equal(deliveryReview.body.code,'sale_header_quote_conflict')
 const deliverySaved=await sendDelivery({...deliveryBody,expected_header_quote:deliveryReview.body.header_quote})
 assert.equal(deliverySaved.status,200,JSON.stringify(deliverySaved.body))
 assert.equal(deliverySaved.body.sale.money_precision_version,0);assert.equal(deliverySaved.body.sale.calculated_total_usd,9.5001)
 assert.equal(deliverySaved.body.sale.rounding_adjustment_usd,-.0001)
 assert.deepEqual(g.raw.prepare('SELECT * FROM sale_items WHERE sale_id=?').all([deliveryId]),deliveryLines)
 g.raw.db.close()
 f.raw.db.close()
 console.log('PASS historical migration invariance/bounds; employee quantity/add/replace/remove/fee; NULL undo/redo; raw operands; savedFX settlement; fallback review; concurrency/permissions; receipt-first schema recovery')
})().catch(error=>{console.error(error);process.exitCode=1})
