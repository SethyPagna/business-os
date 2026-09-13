// Reuse the existing real-module Hono + migrated SQLite fixture, not its tests.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const file = path.join(__dirname,'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file,'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file,module); harness.filename=file; harness.paths=module.paths
harness._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,USER,setUser(value){currentUser=value},load};',file)
const h = harness.exports
// Test client explicitly accepts only a definite, non-mutating header review
// response, then keeps that exact quote frozen for retries. No runtime bypass.
const requestActual=h.app.request.bind(h.app),reviewedBodies=new Map()
h.app.request=async(url,init,env,ctx)=>{
  if(init?.method!=='POST'||!/^\/\d+\/(items|amendments)$/.test(String(url)))return requestActual(url,init,env,ctx)
  const body=JSON.parse(init.body),key=body.client_request_id
  if(reviewedBodies.has(key))return requestActual(url,{...init,body:JSON.stringify({...body,expected_header_quote:reviewedBodies.get(key)})},env,ctx)
  const first=await requestActual(url,init,env,ctx),review=await first.clone().json()
  if(first.status!==409||review.code!=='sale_header_quote_conflict')return first
  assert.equal(review.proven_uncommitted,true)
  const frozen=JSON.stringify({...body,expected_header_quote:review.header_quote});reviewedBodies.set(key,review.header_quote)
  return requestActual(url,{...init,body:frozen},env,ctx)
}
const kernel=h.load('lib/moneyPrecision.ts')
function intent(key,base,quantity=1,fixed=0,rate=4000) {
  const gross=kernel.multiplyMoney4(base,quantity),manual=kernel.multiplyMoney4(fixed,quantity),total=kernel.subtractMoney4(gross,manual)
  return {product_id:10,quantity,branch_id:1,batch_id:500,client_line_key:key,pricing_source:'manual',selling_price_input_usd:base,
    manual_discount_type:fixed?'fixed':null,manual_discount_value:fixed,pricing_quote:{gross_usd:gross,product_discount_usd:0,manual_discount_usd:manual,total_usd:total,total_khr:kernel.multiplyMoney4(total,rate)}}
}
const originalRequest=h.request
h.request=id=>({...originalRequest(id),items:[intent(id+'-line',9.5)]})
async function run() {
  const f = h.fixture()
  f.raw.prepare('UPDATE products SET cost_price_usd=1.2345 WHERE id=10').run()
  const body = { ...h.request('precision-new'), money_precision_version:1, discount_usd:.0001,
    items:[{...intent('precision-line',1.24,1,.0055),selling_price_input_usd:1.23004}] }
  const result = await h.postSale(f.route,body)
  assert.equal(result.status,200,JSON.stringify(result.body))
  const sale = result.body.sale
  assert.equal(sale.money_precision_version,1)
  assert.equal(sale.calculated_total_usd,1.2344)
  assert.equal(sale.rounding_adjustment_usd,-.0044)
  assert.equal(sale.total_usd,1.23)
  assert.equal(sale.items[0].total_usd,1.2345)
  assert.equal(sale.items[0].cost_price_usd,1.2345)
  const before = h.creationState(f.raw)
  const retry = await h.postSale(f.route,{client_request_id:body.client_request_id})
  assert.equal(retry.status,200); assert.equal(retry.body.duplicate,true)
  assert.deepEqual(h.creationState(f.raw),before)
  const legacy = await h.postSale(f.route,h.request('unreceipted-legacy'))
  assert.equal(legacy.status,409); assert.equal(legacy.body.code,'money_precision_review_needed')
  assert.deepEqual(h.creationState(f.raw),before)
  const recovery = async () => {
    const response = await h.app.request('/create-receipt?client_request_id=precision-new',{}, {DB:f.route},h.executionCtx)
    return { status:response.status, cache:response.headers.get('cache-control'),body:await response.json() }
  }
  assert.equal((await recovery()).body.committed,true)
  h.setUser({...h.USER,id:72})
  assert.deepEqual((await recovery()).body,{committed:false})
  h.setUser({...h.USER,permissions:'{}'})
  assert.equal((await recovery()).status,403)
  h.setUser({...h.USER,id:73,permissions:'{"all":true}'})
  const admin = await recovery(); assert.equal(admin.body.committed,true); assert.equal(admin.cache,'private, no-store')
  h.setUser(h.USER)
  console.log('PASS actual create v1, exact line/cost/header, legacy compatibility refusal, receipt recovery/current authority')
  h.setUser({...h.USER,permissions:'{"all":true}'})
  f.raw.prepare("INSERT INTO settings(key,value) VALUES('exchange_rate','5000') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  const add = async payload => {
    const response = await h.app.request(`/${sale.id}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:f.route},h.executionCtx)
    return {status:response.status,body:await response.json()}
  }
  const added = await add({money_precision_version:1,client_request_id:'add-precise',expected_exchange_rate:4000,
    items:[intent('add-line',1,.5,.9998)]})
  assert.equal(added.status,200,JSON.stringify(added.body))
  assert.equal(added.body.sale.money_precision_version,1)
  assert.equal(added.body.sale.items.length,2)
  const header = f.raw.prepare('SELECT * FROM sales WHERE id=@id').get({id:sale.id})
  assert.equal(header.calculated_total_usd,1.2345); assert.equal(header.exchange_rate,4000)
  assert.equal(f.raw.prepare('SELECT total_usd FROM sale_items WHERE sale_id=@id ORDER BY id DESC LIMIT 1').get({id:sale.id}).total_usd,.0001)
  assert.equal(f.raw.prepare('SELECT applied_price_khr FROM sale_items WHERE id=@id').get({id:sale.items[0].id}).applied_price_khr,sale.items[0].applied_price_khr)
  console.log('PASS actual add fractional exact4 and saved-rate preservation across Settings change')
  const replay = async direction => {
    const history = f.raw.prepare('SELECT * FROM action_history WHERE id=@id').get({id:added.body.actionHistoryId})
    const payload = JSON.parse(history[direction==='undo'?'undo_payload':'redo_payload'])
    const applier = h.load('lib/undoAppliers.ts').resolveUndoApplier(payload)
    await applier.run(payload,{env:{DB:f.route},user:{...h.USER,permissions:'{"all":true}'},direction,
      historyId:history.id,generation:payload.generation})
  }
  await replay('undo')
  assert.equal(f.raw.prepare('SELECT calculated_total_usd FROM sales WHERE id=@id').get({id:sale.id}).calculated_total_usd,1.2344)
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=@id').get({id:sale.id}).n,1)
  await replay('redo')
  assert.equal(f.raw.prepare('SELECT calculated_total_usd FROM sales WHERE id=@id').get({id:sale.id}).calculated_total_usd,1.2345)
  assert.equal(f.raw.prepare('SELECT total_usd FROM sale_items WHERE sale_id=@id ORDER BY id DESC LIMIT 1').get({id:sale.id}).total_usd,.0001)
  console.log('PASS actual server-managed add undo/redo restores four-place parent and line snapshots')
  const amendment = async payload => {
    const response = await h.app.request(`/${sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:f.route},h.executionCtx)
    return {status:response.status,body:await response.json()}
  }
  const editBody = {money_precision_version:1,client_request_id:'edit-precise',expected_exchange_rate:4000,
    kind:'line_updated',sale_item_id:sale.items[0].id,quantity:2,applied_price_usd:1.2345,
    base_price_usd:1.24,manual_discount_type:'fixed',manual_discount_value:.0055,manual_discount_usd:.0055,
    pricing_quote:intent('edit',1.24,2,.0055).pricing_quote}
  const edited = await amendment(editBody)
  assert.equal(edited.status,200,JSON.stringify(edited.body))
  assert.equal(edited.body.sale.calculated_total_usd,2.469)
  assert.equal(edited.body.sale.total_usd,2.47)
  assert.equal(edited.body.sale.rounding_adjustment_usd,.001)
  assert.equal(edited.body.sale.items[0].total_usd,2.469)
  const editedState = h.creationState(f.raw)
  const editedRetry = await amendment(editBody)
  assert.deepEqual(editedRetry.body,edited.body)
  assert.deepEqual(h.creationState(f.raw),editedState)
  console.log('PASS actual versioned edit, canonical transactional receipt and exact retry')
  const waiting = await h.postSale(f.route,{...h.request('waiting-precise'),money_precision_version:1,
    sale_status:'awaiting_payment',amount_paid_usd:0,amount_paid_khr:0,payment_details:[],
    items:[intent('waiting-line',1.24,1,.0055)]})
  assert.equal(waiting.status,200,JSON.stringify(waiting.body))
  const waitingId = waiting.body.id
  const savedHeader = f.raw.prepare('SELECT * FROM sales WHERE id=@id').get({id:waitingId})
  const savedLines = f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id').all({id:waitingId})
  const settled = await h.app.request(`/${waitingId}/status`,{method:'PATCH',headers:{'content-type':'application/json'},
    body:JSON.stringify({client_request_id:'settle-precise',sale_status:'completed',expected_exchange_rate:4000,
      payment_details:[{method:'Cash',amount_usd:1,amount_khr:920}]})},{DB:f.route},h.executionCtx)
  const settledBody = await settled.json()
  assert.equal(settled.status,200,JSON.stringify(settledBody))
  const settledHeader = f.raw.prepare('SELECT * FROM sales WHERE id=@id').get({id:waitingId})
  for(const key of ['exchange_rate','subtotal_usd','subtotal_khr','total_usd','total_khr','money_precision_version','calculated_total_usd','rounding_adjustment_usd'])
    assert.equal(settledHeader[key],savedHeader[key],key)
  assert.deepEqual(f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id').all({id:waitingId}),savedLines)
  assert.equal(settledHeader.amount_paid_usd,1);assert.equal(settledHeader.amount_paid_khr,920)
  console.log('PASS actual mixed USD/KHR payment uses saved rate and preserves complete v1 basket')
  const records = h.load('lib/saleRecords.ts').buildSaleRecords({sale:savedHeader})
  const creation = records.find(row=>row.kind==='sale_created')
  const rawChange = creation.changes.find(row=>row.field==='calculated_total_usd')
  assert.deepEqual(rawChange.before,{state:'known_none'})
  assert.deepEqual(rawChange.after,{state:'known_value',value:1.2345})
  const historical = h.load('lib/saleRecords.ts').buildSaleRecords({sale:{...savedHeader,creation_snapshot_json:null}})
  assert.equal(historical.find(row=>row.kind==='sale_created').changes.some(row=>row.field==='calculated_total_usd'),false)
  const ledger = f.raw.prepare('SELECT * FROM sale_amendments WHERE sale_id=@id ORDER BY id').all({id:sale.id})
  const mutations = h.load('lib/saleRecords.ts').buildSaleRecords({sale,ledger})
  assert.ok(mutations.some(row=>row.changes.some(change=>change.field==='calculated_total_usd')))
  console.log('PASS Records durable v1 creation/change facts and absent historical precision remain distinct')
  let mutateBeforeBatch = false
  const raced = h.fixture({beforeBatch(db){if(mutateBeforeBatch){mutateBeforeBatch=false;
    db.prepare('UPDATE sale_items SET cost_price_usd=8.7654 WHERE sale_id=1').run()}}})
  const raceCreate = await h.postSale(raced.route,{...h.request('race-create'),money_precision_version:1})
  assert.equal(raceCreate.status,200)
  mutateBeforeBatch=true
  const rejected = await h.app.request('/1/items',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({money_precision_version:1,client_request_id:'race-add',expected_exchange_rate:4000,
      items:[intent('race-add-line',1)]})},{DB:raced.route},h.executionCtx)
  assert.equal(rejected.status,409,JSON.stringify(await rejected.json()))
  assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n,1)
  assert.equal(raced.raw.prepare('SELECT cost_price_usd FROM sale_items').get().cost_price_usd,8.7654)
  assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM sale_mutation_receipts').get().n,0)
  assert.equal(raced.raw.prepare('SELECT quantity FROM branch_stock').get().quantity,9)
  console.log('PASS concurrent captured child mutation rejects entire add transaction without stock/receipt side effects')
  const legacyDb = h.fixture()
  const legacyCreate = await h.postSale(legacyDb.route,{...h.request('legacy-captured'),money_precision_version:1})
  assert.equal(legacyCreate.status,200)
  legacyDb.raw.prepare('UPDATE sales SET money_precision_version=0,calculated_total_usd=NULL,rounding_adjustment_usd=0 WHERE id=1').run()
  const legacyHeader = legacyDb.raw.prepare('SELECT * FROM sales WHERE id=1').get()
  const upgradeResponse = await h.app.request('/1/items',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({money_precision_version:1,client_request_id:'upgrade-add',expected_exchange_rate:4000,
      items:[intent('upgrade-line',1,.5,.9998)]})},{DB:legacyDb.route},h.executionCtx)
  const upgrade = await upgradeResponse.json()
  assert.equal(upgradeResponse.status,200,JSON.stringify(upgrade))
  const undoHistory = legacyDb.raw.prepare('SELECT * FROM action_history WHERE id=@id').get({id:upgrade.actionHistoryId})
  const undoPayload = JSON.parse(undoHistory.undo_payload)
  await h.load('lib/undoAppliers.ts').resolveUndoApplier(undoPayload).run(undoPayload,
    {env:{DB:legacyDb.route},user:{...h.USER,permissions:'{"all":true}'},direction:'undo',historyId:undoHistory.id,generation:0})
  assert.deepEqual(legacyDb.raw.prepare('SELECT * FROM sales WHERE id=1').get(),legacyHeader)
  const fingerprint = h.load('lib/undoAppliers.ts').sameSaleStateFingerprint
  const {money_precision_version,calculated_total_usd,rounding_adjustment_usd,...oldHeader} = legacyHeader
  const oldFingerprint = JSON.stringify({sale:oldHeader,lines:[],amendmentHeadId:0})
  assert.equal(fingerprint(JSON.stringify({sale:legacyHeader,lines:[],amendmentHeadId:0}),oldFingerprint),true)
  assert.equal(fingerprint(JSON.stringify({sale:{...legacyHeader,customer_name:'changed'},lines:[],amendmentHeadId:0}),oldFingerprint),false)
  assert.equal(fingerprint(JSON.stringify({sale:{...legacyHeader,money_precision_version:1},lines:[],amendmentHeadId:0}),oldFingerprint),false)
  assert.throws(()=>h.load('lib/saleLineAddition.ts').saleMoneyUpdateStatement(1,{total_usd:1,calculated_total_usd:null}),/incomplete/)
  console.log('PASS v0 upgrade undo restores full header; old fingerprint permits only absent default precision fields')
  legacyDb.raw.prepare('UPDATE products SET cost_price_usd=NULL,cost_price_khr=NULL WHERE id=10').run()
  const unknownCost = await h.postSale(legacyDb.route,{...h.request('null-cost'),money_precision_version:1})
  assert.equal(unknownCost.status,200,JSON.stringify(unknownCost.body))
  assert.equal(unknownCost.body.sale.items[0].cost_price_usd,null)
  assert.equal(unknownCost.body.sale.items[0].cost_price_khr,null)
  legacyDb.raw.prepare('UPDATE sale_items SET applied_price_usd=1.23456,pricing_snapshot_json=NULL WHERE sale_id=1').run()
  const originalHistoricalLine=legacyDb.raw.prepare('SELECT * FROM sale_items WHERE sale_id=1').get()
  const recordedLegacy = await h.app.request('/1/items',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({money_precision_version:1,client_request_id:'ambiguous-upgrade',expected_exchange_rate:4000,
      items:[intent('ambiguous-line',1)]})},{DB:legacyDb.route},h.executionCtx)
  const recordedBody=await recordedLegacy.json()
  assert.equal(recordedLegacy.status,200,JSON.stringify(recordedBody))
  assert.equal(recordedBody.sale.money_precision_version,0)
  assert.deepEqual(legacyDb.raw.prepare('SELECT * FROM sale_items WHERE id=@id').get({id:originalHistoricalLine.id}),originalHistoricalLine)
  const missingCapturedId=unknownCost.body.sale.id
  legacyDb.raw.prepare('UPDATE sale_items SET pricing_snapshot_json=NULL WHERE sale_id=@id').run({id:missingCapturedId})
  const beforeMissingCapture=h.creationState(legacyDb.raw)
  const rejectedCaptured=await h.app.request(`/${missingCapturedId}/items`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({money_precision_version:1,client_request_id:'missing-v1-capture',expected_exchange_rate:4000,items:[intent('missing-capture-line',1)]})},{DB:legacyDb.route},h.executionCtx)
  assert.equal(rejectedCaptured.status,409)
  assert.deepEqual(h.creationState(legacyDb.raw),beforeMissingCapture)
  console.log('PASS legacy add preserves unknown/five-place snapshots; parent v1 still refuses missing capture')
  const totalInput = {subtotalUsd:1,discountUsd:0,membershipDiscountUsd:0,taxUsd:0,isDelivery:false,
    deliveryFeeUsd:0,deliveryFeePaidBy:'customer',exchangeRate:4020,rawAmountPaidUsd:1,rawAmountPaidKhr:20}
  for (const version of [0,1]) {
    const result = h.load('lib/saleTotals.ts').computeSaleTotals({...totalInput,moneyPrecisionVersion:version})
    assert.equal(result.changeUsd,0);assert.equal(result.changeKhr,20)
  }
  const preciseChangeDb = h.fixture()
  const changeBody = {...h.request('native-change'),money_precision_version:1,exchange_rate:4020,
    amount_paid_usd:1,amount_paid_khr:20,
    items:[intent('native-line',1,1,0,4020)]}
  const preciseChange = await h.postSale(preciseChangeDb.route,changeBody)
  assert.equal(preciseChange.status,200,JSON.stringify(preciseChange.body))
  assert.equal(preciseChange.body.sale.change_usd,0);assert.equal(preciseChange.body.sale.change_khr,20)
  const settlement = h.load('lib/paymentSettlement.ts').planSaleSettlement({moneyPrecisionVersion:1,
    configuredMethodsRaw:'["Cash"]',paymentDetailsRaw:[{method:'Cash',amount_usd:1,amount_khr:20}],
    existingPaidUsd:0,existingPaidKhr:0,totalUsd:1,exchangeRate:4020})
  assert.equal(settlement.changeUsd,0);assert.equal(settlement.changeKhr,20)
  const actualChange = await h.postSale(preciseChangeDb.route,{...changeBody,client_request_id:'recorded-native-change',
    change_is_actual:true,change_usd:0,change_khr:20})
  assert.equal(actualChange.status,200,JSON.stringify(actualChange.body))
  const actualAdd = await h.app.request(`/${actualChange.body.id}/items`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({money_precision_version:1,client_request_id:'actual-change-add',expected_exchange_rate:4020,
      items:[intent('actual-add-line',.1,1,0,4020)]})},{DB:preciseChangeDb.route},h.executionCtx)
  const actualAdded = await actualAdd.json()
  assert.equal(actualAdd.status,200,JSON.stringify(actualAdded))
  assert.equal(actualAdded.sale.change_is_actual,1)
  assert.equal(actualAdded.sale.change_usd,0);assert.equal(actualAdded.sale.change_khr,20)
  assert.equal(actualAdded.sale.change_exchange_rate,actualChange.body.sale.change_exchange_rate)
  console.log('PASS exact native change USD1+KHR20 at4020 yields USD0/KHR20; legacy and recorded actual change preserved')
}
run().catch(error=>{console.error(error);process.exitCode=1})
