const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const cache = new Map()
function load(name) {
  assert.ok(['saleItemPricing','moneyPrecision','promotionRules'].includes(name))
  if (cache.has(name)) return cache.get(name)
  const file = path.resolve(__dirname,`../src/lib/${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module = {exports:{}}
  new Function('module','exports','require',code)(module,module.exports,request => {
    assert.ok(/^\.\/(moneyPrecision|promotionRules)$/.test(request))
    return load(request.slice(2))
  })
  cache.set(name,module.exports); return module.exports
}
const p=load('saleItemPricing'), rules=load('promotionRules')
assert.deepEqual(p.capturePricingProduct({id:7,selling_price_usd:10,notes:'private',supplier_id:99,cost_price_usd:4}),{id:7,selling_price_usd:10})
const rule=rules.normalizePromotionRule({id:1,rule_type:'quantity_save',min_quantity:3,save_usd:1,product_ids:[7],scope_type:'products',is_active:1},1)
const pool={version:1,pool_key:'pool-1',evaluation_time:'2026-09-13T00:00:00.000Z',exchange_rate:4000,rules:[rule],lines:[{
  line_key:'a',source:'promotion',product:{id:7,selling_price_usd:10,selling_price_khr:1},selling_price_input_usd:null,manual:{type:'none',value:0}
}]}
const at=(quantity,context=pool)=>p.evaluateCapturedPricingPool(context,{a:quantity}).get('a')
assert.equal(at(3).total_usd,29)
assert.equal(at(3).applied_price_usd,9.6667)
assert.equal(at(3).total_khr,116000,'USD authority, not conflicting catalogue KHR')
assert.equal(at(2).total_usd,20,'captured threshold re-evaluates on quantity change')
const manual=structuredClone(pool); manual.lines[0].manual={type:'fixed',value:1}
assert.equal(at(3,manual).total_usd,26,'fixed manual discount is per-unit after exact promotion')
manual.lines[0].manual={type:'percent',value:12.3456}
assert.equal(at(3,manual).total_usd,25.4198)
manual.lines[0].manual={type:'fixed',value:100}
assert.equal(at(3,manual).total_usd,0)
const stored=p.serializeSaleItemPricing(pool,{a:3},'a',{version:1,lines:[{line_key:'a',amount:29}],discount_usd:1,membership_discount_usd:1,tax_usd:1})
assert.equal(p.parseSaleItemPricing(stored).amounts.total_usd,29)
assert.equal(p.parseSaleItemPricing(stored).receipt_allocation.net_entitlement_usd,28)
assert.equal(p.parseSaleItemPricing(null),null)
const tampered=JSON.parse(stored); tampered.amounts.total_usd=29.0001
assert.throws(()=>p.parseSaleItemPricing(JSON.stringify(tampered)))
for (const quantity of [0,-1,Infinity,NaN,10001]) assert.throws(()=>at(quantity))
const duplicate=structuredClone(pool); duplicate.lines.push(duplicate.lines[0]); assert.throws(()=>at(3,duplicate))
const ambiguous=structuredClone(pool); ambiguous.lines[0].product.selling_price_usd=1.2345; assert.throws(()=>at(3,ambiguous))
const alloc=p.allocateLineMoney4(.0001,[{line_key:'b',amount:1},{line_key:'a',amount:1}])
assert.equal(alloc.get('a'),.0001); assert.equal(alloc.get('b'),0)
assert.deepEqual([...alloc],[...p.allocateLineMoney4(.0001,[{line_key:'a',amount:1},{line_key:'b',amount:1}])])
assert.equal(p.allocateLineMoney4(1e11,[{line_key:'a',amount:1e11}]).get('a'),1e11)
assert.throws(()=>p.allocateLineMoney4(1,[{line_key:'a',amount:0}]))
assert.throws(()=>p.allocateReceiptLines({version:1,lines:[{line_key:'a',amount:1}],discount_usd:2,membership_discount_usd:0,tax_usd:0}))
assert.throws(()=>p.allocateReceiptLines({version:1,lines:[{line_key:'a',amount:1}],discount_usd:1,membership_discount_usd:0,tax_usd:.01}))
const allocated=p.allocateReceiptLines({version:1,lines:[{line_key:'a',amount:1},{line_key:'b',amount:2}],discount_usd:1,membership_discount_usd:1,tax_usd:.1})
assert.equal(load('moneyPrecision').sumMoney4([...allocated.values()].map(line=>line.net_entitlement_usd)),1.1)
const paired=structuredClone(pool)
paired.rules=[rules.normalizePromotionRule({id:2,rule_type:'next_item',min_quantity:1,percent_off:100,product_ids:[7],scope_type:'products',is_active:1},1)]
paired.lines.push({...structuredClone(paired.lines[0]),line_key:'b'})
const pairing=p.evaluateCapturedPricingPool(paired,{a:1,b:1})
assert.equal(pairing.get('a').total_usd,0,'equal-price pooled tie follows stable key')
assert.equal(pairing.get('b').total_usd,10)
paired.lines.reverse()
assert.deepEqual([...p.evaluateCapturedPricingPool(paired,{b:1,a:1})],[...pairing],'pool quote independent of incoming order')
assert.equal(p.evaluateCapturedPricingPool(paired,{a:1,b:2}).get('b').total_usd,20,'whole captured pool re-evaluates quantity')

// Actual SQLite additive migration, existing-column and rollback invariance.
const db=new DatabaseSync(':memory:')
db.exec('CREATE TABLE sale_items(id INTEGER PRIMARY KEY,total_usd REAL,details TEXT); INSERT INTO sale_items VALUES(1,1.23456789,\'historical\')')
const before=db.prepare('SELECT * FROM sale_items').all()
const sql=fs.readFileSync(path.resolve(__dirname,'../migrations/0159_sale_item_pricing_snapshot.sql'),'utf8')
assert.ok(!sql.includes('\r'),'migration remains LF-only')
db.exec(sql)
assert.deepEqual(db.prepare('SELECT id,total_usd,details FROM sale_items').all(),before)
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,null)
db.prepare('UPDATE sale_items SET pricing_snapshot_json=? WHERE id=1').run(stored)
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,stored)
db.exec('BEGIN')
db.prepare('UPDATE sale_items SET pricing_snapshot_json=NULL WHERE id=1').run()
db.exec('ROLLBACK')
assert.equal(db.prepare('SELECT pricing_snapshot_json FROM sale_items').get().pricing_snapshot_json,stored)
db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,price REAL,updated_at TEXT); CREATE TABLE promotion_rules(id INTEGER PRIMARY KEY,is_active INTEGER,save_usd REAL); INSERT INTO products VALUES(7,10,\'same\'); INSERT INTO promotion_rules VALUES(1,1,1)')
const capture=()=>p.pricingSourceGuard(db.prepare('SELECT * FROM products').all(),db.prepare('SELECT * FROM promotion_rules WHERE is_active=1').all())
const guard=capture()
db.prepare(guard.sql).get(guard.params)
db.exec('UPDATE products SET price=11 WHERE id=7')
assert.throws(()=>db.prepare(guard.sql).get(guard.params),'price change without timestamp change invalidates capture')
db.exec('UPDATE products SET price=10 WHERE id=7')
db.prepare(guard.sql).get(guard.params)
db.exec('INSERT INTO promotion_rules VALUES(2,1,2)')
assert.throws(()=>db.prepare(guard.sql).get(guard.params),'new active rule invalidates captured complete membership')
db.exec('BEGIN')
try {
  db.exec("UPDATE sale_items SET details='must rollback' WHERE id=1")
  db.prepare(guard.sql).get(guard.params)
  assert.fail('conflicting transaction must not complete')
} catch { db.exec('ROLLBACK') }
assert.equal(db.prepare('SELECT details FROM sale_items').get().details,'historical')
db.exec('DELETE FROM promotion_rules WHERE id=2')
const emptyRules=p.pricingSourceGuard(db.prepare('SELECT * FROM products').all(),[])
assert.throws(()=>db.prepare(emptyRules.sql).get(emptyRules.params),'expected empty rule capture is guarded too')
db.close()
console.log('PASS actual captured-pricing modules: exact residual/threshold/manual/FX, bounds/tamper, deterministic allocation and additive SQLite migration/rollback')

// Execute the actual Hono sale route and its complete migration fixture.
async function actualRoute() {
  const Module=require('node:module'), file=path.join(__dirname,'test-sale-create-atomic-pure.cjs')
  const source=fs.readFileSync(file,'utf8'), boundary=source.indexOf(';(async () => {')
  assert.ok(boundary>0)
  const harness=new Module(file,module); harness.filename=file; harness.paths=module.paths
  harness._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")+'\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,load,USER,setUser(value){currentUser=value}};',file)
  const h=harness.exports
  const request=()=>({...h.request('exact-line-route'),money_precision_version:1,amount_paid_usd:29,items:[{
    product_id:10,quantity:3,branch_id:1,batch_id:500,client_line_key:'route-a',pricing_source:'promotion',
    price_mode:'selling',product_discount_type:'spoofed',product_discount_label:'spoofed',
    pricing_quote:{gross_usd:30,product_discount_usd:1,manual_discount_usd:0,total_usd:29,total_khr:116000}
  }]})
  const setup=hooks=>{
    const f=h.fixture(hooks)
    f.raw.prepare('UPDATE products SET selling_price_usd=10 WHERE id=10').run()
    f.raw.prepare("INSERT INTO promotion_rules(id,rule_type,min_quantity,save_usd,product_ids,scope_type,is_active) VALUES(1,'quantity_save',3,1,'[10]','products',1)").run()
    return f
  }
  const f=setup()
  const saved=await h.postSale(f.route,request())
  assert.equal(saved.status,200,JSON.stringify(saved.body))
  assert.equal(saved.body.sale.items[0].total_usd,29)
  assert.equal(saved.body.sale.items[0].applied_price_usd,9.6667)
  assert.equal(saved.body.sale.items[0].price_mode,'promotion')
  assert.equal(saved.body.sale.items[0].product_discount_type,'quantity_save')
  assert.equal(saved.body.sale.items[0].product_discount_label,null)
  assert.equal(p.parseSaleItemPricing(saved.body.sale.items[0].pricing_snapshot_json).amounts.total_usd,29)
  p.validateCapturedSaleBasket(saved.body.sale.items,saved.body.sale)
  const wrongIdentity=structuredClone(saved.body.sale.items); wrongIdentity[0].product_id=11
  assert.throws(()=>p.validateCapturedSaleBasket(wrongIdentity,saved.body.sale))
  const missingSnapshot=structuredClone(saved.body.sale.items); missingSnapshot[0].pricing_snapshot_json=null
  assert.throws(()=>p.validateCapturedSaleBasket(missingSnapshot,saved.body.sale))
  const wrongMetadata=structuredClone(saved.body.sale.items);wrongMetadata[0].price_mode='selling'
  assert.throws(()=>p.validateCapturedSaleBasket(wrongMetadata,saved.body.sale))
  const after=h.creationState(f.raw)
  f.raw.prepare('UPDATE promotion_rules SET save_usd=9 WHERE id=1').run()
  const replay=await h.postSale(f.route,{client_request_id:'exact-line-route'})
  assert.equal(replay.status,200)
  assert.equal(replay.body.sale.items[0].pricing_snapshot_json,saved.body.sale.items[0].pricing_snapshot_json)
  assert.deepEqual(h.creationState(f.raw),after)
  const stale=await h.postSale(f.route,{...request(),client_request_id:'stale-exact-quote'})
  assert.equal(stale.status,409); assert.equal(stale.body.code,'sale_pricing_quote_conflict')
  assert.deepEqual(h.creationState(f.raw),after)
  const race=setup({beforeBatch(db){db.prepare('UPDATE promotion_rules SET save_usd=2 WHERE id=1').run()}})
  const before=h.creationState(race.raw)
  const conflict=await h.postSale(race.route,request())
  assert.equal(conflict.status,409,JSON.stringify(conflict.body)); assert.equal(conflict.body.code,'sale_pricing_quote_conflict')
  assert.deepEqual(h.creationState(race.raw),before)
  h.setUser({...h.USER,permissions:'{"all":true}'})
  const addResponse=await h.app.request(`/${saved.body.sale.id}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({money_precision_version:1,client_request_id:'capture-add',expected_exchange_rate:4000,
    items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,client_line_key:'new-line',pricing_source:'selling',pricing_quote:{gross_usd:10,product_discount_usd:0,manual_discount_usd:0,total_usd:10,total_khr:40000}}]})},{DB:f.route},h.executionCtx)
  const added=await addResponse.json()
  assert.equal(addResponse.status,200,JSON.stringify(added))
  assert.equal(added.sale.total_usd,39)
  p.validateCapturedSaleBasket(added.sale.items,added.sale)
  assert.notEqual(p.parseSaleItemPricing(added.sale.items[0].pricing_snapshot_json).pool.pool_key,p.parseSaleItemPricing(added.sale.items[1].pricing_snapshot_json).pool.pool_key)
  const aliasedPools=structuredClone(added.sale.items)
  const aliased=JSON.parse(aliasedPools[1].pricing_snapshot_json)
  aliased.pool.pool_key=JSON.parse(aliasedPools[0].pricing_snapshot_json).pool.pool_key
  aliasedPools[1].pricing_snapshot_json=JSON.stringify(aliased)
  assert.throws(()=>p.validateCapturedSaleBasket(aliasedPools,added.sale),'disjoint contexts may not share one pool identity')
  const transition=async direction=>{
    const history=f.raw.prepare('SELECT * FROM action_history WHERE id=?').get([added.actionHistoryId])
    const payload=JSON.parse(history[direction==='undo'?'undo_payload':'redo_payload'])
    await h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload,{env:{DB:f.route},user:{...h.USER,permissions:'{"all":true}'},direction,historyId:history.id,generation:payload.generation})
  }
  await transition('undo')
  const undone=f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all([saved.body.sale.id])
  assert.equal(undone.length,1); assert.equal(undone[0].pricing_snapshot_json,saved.body.sale.items[0].pricing_snapshot_json)
  await transition('redo')
  const redone=f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all([saved.body.sale.id])
  const redoneHeader=f.raw.prepare('SELECT * FROM sales WHERE id=?').get([saved.body.sale.id])
  p.validateCapturedSaleBasket(redone,redoneHeader)
  assert.deepEqual(redone.map(line=>line.pricing_snapshot_json),added.sale.items.map(line=>line.pricing_snapshot_json))
  const editBody={kind:'line_updated',money_precision_version:1,client_request_id:'captured-quantity-edit',expected_exchange_rate:4000,
    sale_item_id:redone[0].id,quantity:2,pricing_quote:{gross_usd:20,product_discount_usd:0,manual_discount_usd:0,total_usd:20,total_khr:80000}}
  const edit=async()=>{
    const response=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(editBody)},{DB:f.route},h.executionCtx)
    return {status:response.status,body:await response.json()}
  }
  const edited=await edit()
  assert.equal(edited.status,200,JSON.stringify(edited.body))
  assert.equal(edited.body.sale.total_usd,30)
  assert.equal(edited.body.sale.items[0].total_usd,20,'captured original threshold, not current save9 rule')
  p.validateCapturedSaleBasket(edited.body.sale.items,edited.body.sale)
  const editState=h.creationState(f.raw)
  assert.deepEqual((await edit()).body,edited.body)
  assert.deepEqual(h.creationState(f.raw),editState)
  for (const [kind,total,discount] of [['line_quantity_increased',29,1],['line_quantity_decreased',20,0]]) {
    const body={...editBody,kind,client_request_id:kind,quantity:1,pricing_quote:{gross_usd:total+discount,product_discount_usd:discount,manual_discount_usd:0,total_usd:total,total_khr:total*4000}}
    const response=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx)
    const result=await response.json()
    assert.equal(response.status,200,JSON.stringify(result))
    assert.equal(result.sale.items[0].total_usd,total)
    p.validateCapturedSaleBasket(result.sale.items,result.sale)
  }
  const removeBody={kind:'line_removed',money_precision_version:1,client_request_id:'captured-remove',expected_exchange_rate:4000,sale_item_id:redone[0].id}
  const removeResponse=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(removeBody)},{DB:f.route},h.executionCtx)
  const removed=await removeResponse.json()
  assert.equal(removeResponse.status,200,JSON.stringify(removed))
  assert.equal(removed.sale.total_usd,10)
  assert.equal(removed.sale.items.length,1)
  p.validateCapturedSaleBasket(removed.sale.items,removed.sale)
  const replaceBody={kind:'line_replaced',money_precision_version:1,client_request_id:'captured-replace',expected_exchange_rate:4000,sale_item_id:removed.sale.items[0].id,
    replacement:{product_id:10,quantity:2,branch_id:1,client_line_key:'replacement-line',pricing_source:'selling',pricing_quote:{gross_usd:20,product_discount_usd:0,manual_discount_usd:0,total_usd:20,total_khr:80000}}}
  const replaceResponse=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(replaceBody)},{DB:f.route},h.executionCtx)
  const replaced=await replaceResponse.json()
  assert.equal(replaceResponse.status,200,JSON.stringify(replaced))
  assert.equal(replaced.sale.total_usd,20)
  assert.equal(replaced.sale.items.length,1)
  assert.notEqual(replaced.sale.items[0].id,removed.sale.items[0].id)
  p.validateCapturedSaleBasket(replaced.sale.items,replaced.sale)
  const replacementReceipt=JSON.parse(f.raw.prepare("SELECT after_json FROM sale_mutation_receipts WHERE request_id='captured-replace'").get().after_json)
  assert.equal(replacementReceipt.lines[0].id,replaced.sale.items[0].id)
  assert.equal(replacementReceipt.lines[0].pricing_snapshot_json,replaced.sale.items[0].pricing_snapshot_json)
  assert.equal(f.raw.prepare('SELECT SUM(quantity-released_quantity) AS quantity FROM sale_item_batch_allocations WHERE sale_item_id=?').get([replaced.sale.items[0].id]).quantity,2)
  const replacementState=h.creationState(f.raw)
  const replaceRetry=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(replaceBody)},{DB:f.route},h.executionCtx)
  assert.equal(replaceRetry.status,200)
  assert.deepEqual(await replaceRetry.json(),replaced)
  assert.deepEqual(h.creationState(f.raw),replacementState)
  const originalBatch=f.route.batch
  f.route.batch=async statements=>{
    f.route.batch=originalBatch
    f.raw.prepare('UPDATE products SET cost_price_usd=99 WHERE id=10').run()
    return originalBatch(statements)
  }
  const conflictingReplacement={...replaceBody,client_request_id:'replacement-cost-race',sale_item_id:replaced.sale.items[0].id,replacement:{...replaceBody.replacement,client_line_key:'replacement-race'}}
  const refused=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(conflictingReplacement)},{DB:f.route},h.executionCtx)
  assert.equal(refused.status,409,JSON.stringify(await refused.json()))
  assert.deepEqual(h.creationState(f.raw),replacementState,'cost race cannot partially remove the old line or change stock')
  for(const [kind,quantity,total] of [['line_updated',0.1,1],['line_quantity_increased',0.2,3]]) {
    const payload={kind,quantity,money_precision_version:1,client_request_id:'fractional-'+kind,expected_exchange_rate:4000,sale_item_id:replaced.sale.items[0].id,
      pricing_quote:{gross_usd:total,product_discount_usd:0,manual_discount_usd:0,total_usd:total,total_khr:total*4000}}
    const response=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},{DB:f.route},h.executionCtx)
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value))
    assert.equal(value.sale.items[0].quantity,total/10)
    p.validateCapturedSaleBasket(value.sale.items,value.sale)
  }
  const fractionalState=h.creationState(f.raw)
  const tinyResponse=await h.app.request(`/${saved.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'line_quantity_increased',quantity:1e-20,money_precision_version:1,client_request_id:'tiny-positive',expected_exchange_rate:4000,sale_item_id:replaced.sale.items[0].id})},{DB:f.route},h.executionCtx)
  assert.equal(tinyResponse.status,409)
  assert.deepEqual(h.creationState(f.raw),fractionalState,'positive quantity cannot disappear on decimal-to-Number conversion')
  const coupled=setup()
  coupled.raw.prepare('DELETE FROM promotion_rules').run()
  coupled.raw.prepare("INSERT INTO promotion_rules(id,rule_type,min_quantity,percent_off,product_ids,scope_type,is_active) VALUES(2,'next_item',1,100,'[10]','products',1)").run()
  const coupledCreate=await h.postSale(coupled.route,{...request(),client_request_id:'coupled-create',amount_paid_usd:10,items:['a','b'].map(key=>({product_id:10,quantity:1,branch_id:1,batch_id:500,client_line_key:key,pricing_source:'promotion',
    pricing_quote:{gross_usd:10,product_discount_usd:key==='a'?10:0,manual_discount_usd:0,total_usd:key==='a'?0:10,total_khr:key==='a'?0:40000}}))})
  assert.equal(coupledCreate.status,200,JSON.stringify(coupledCreate.body))
  const removeSibling=await h.app.request(`/${coupledCreate.body.sale.id}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'line_removed',money_precision_version:1,client_request_id:'remove-pool-sibling',expected_exchange_rate:4000,sale_item_id:coupledCreate.body.sale.items[1].id})},{DB:coupled.route},h.executionCtx)
  const siblingResult=await removeSibling.json();assert.equal(removeSibling.status,200,JSON.stringify(siblingResult))
  assert.equal(siblingResult.sale.items[0].total_usd,10,'removing qualifying sibling re-evaluates surviving free line')
  p.validateCapturedSaleBasket(siblingResult.sale.items,siblingResult.sale)
  assert.equal(siblingResult.sale.items[0].product_discount_type,null,'lost promotion clears stale discount metadata')
  for(const [source,price] of [['selling',9.5],['wholesale',8],['manual',7.5]]) {
    const metadataDb=h.fixture();metadataDb.raw.prepare('UPDATE products SET wholesale_price_usd=8 WHERE id=10').run()
    const result=await h.postSale(metadataDb.route,{...h.request('metadata-'+source),money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,
      client_line_key:source,pricing_source:source,...(source==='manual'?{selling_price_input_usd:7.5}:{}),price_mode:'promotion',product_discount_type:'spoof',product_discount_label:'spoof',
      pricing_quote:{gross_usd:price,product_discount_usd:0,manual_discount_usd:0,total_usd:price,total_khr:price*4000}}]})
    assert.equal(result.status,200,JSON.stringify(result.body));p.validateCapturedSaleBasket(result.body.sale.items,result.body.sale)
    assert.equal(result.body.sale.items[0].price_mode,source)
    assert.equal(result.body.sale.items[0].product_discount_type,null);assert.equal(result.body.sale.items[0].product_discount_label,null)
    metadataDb.raw.db.close()
  }
  const legacyFingerprint={sale:{id:1},lines:[{id:1,total_usd:1}],amendmentHeadId:0}
  const actualFingerprint={sale:{id:1,money_precision_version:0,calculated_total_usd:null,rounding_adjustment_usd:0},lines:[{id:1,total_usd:1,pricing_snapshot_json:null}],amendmentHeadId:0}
  const matches=h.load('lib/undoAppliers.ts').sameSaleStateFingerprint
  assert.equal(matches(JSON.stringify(actualFingerprint),JSON.stringify(legacyFingerprint)),true)
  actualFingerprint.lines[0].pricing_snapshot_json='{}'
  assert.equal(matches(JSON.stringify(actualFingerprint),JSON.stringify(legacyFingerprint)),false)
  actualFingerprint.lines[0].pricing_snapshot_json=null; actualFingerprint.lines[0].total_usd=2
  assert.equal(matches(JSON.stringify(actualFingerprint),JSON.stringify(legacyFingerprint)),false)
  f.raw.db.close(); race.raw.db.close(); coupled.raw.db.close()
  console.log('PASS actual Hono create exact29 snapshot, pre-policy retry, stale quote and concurrent rule rollback')
}
actualRoute().catch(error=>{console.error(error);process.exitCode=1})
