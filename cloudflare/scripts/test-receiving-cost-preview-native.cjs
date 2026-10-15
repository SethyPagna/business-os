const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const filename = path.join(__dirname, 'test-catalog-cost-recompute-native.cjs')
const source = fs.readFileSync(filename, 'utf8')
const boundary = source.indexOf('async function main()')
assert.ok(boundary > 0)
const fixture = new Module(filename, module)
fixture.filename = filename
fixture.paths = Module._nodeModulePaths(path.dirname(filename))
const prefix = source.slice(0, boundary).replace('let sqlite', 'let queries = []; let sqlite')
  .replace('const statement = sqlite.prepare(sql)', 'queries.push(sql); const statement = sqlite.prepare(sql)')
  .replace("['get', 'all', 'run'].map((method)", "['get', 'all', 'run', 'getOnce', 'allOnce'].map((method)")
  .replaceAll('statement[method]', "statement[method.replace('Once','')]")
  .replace('async batch(statements)', 'async batchOnce(statements) { return sqlite.transaction(() => statements.map(({sql,params}) => sqlite.prepare(sql).run(params||{})))() },\n    async batch(statements)')
fixture._compile(prefix + `
module.exports={fresh,request,addBody,catalogCost,load,sql:()=>sqlite,
 setUser:value=>{user=value}, queries:()=>queries, resetQueries:()=>{queries=[]},
 cloneForWriter:()=>{const original=sqlite;sqlite=new Database(original.serialize());original.close()}}`, filename)
const f = fixture.exports
const previewRoute = f.load('routes/productCost.ts').default
const batches = f.load('routes/batches.ts').default
const helper = f.load('lib/receivingCostPreview.ts')
let checks=0, sequence=0

async function preview(lines, raw) {
  const snapshot=f.sql().serialize()
  f.resetQueries()
  const response=await previewRoute.request('/receiving-cost-preview', {method:'POST',headers:{'Content-Type':'application/json'},body:raw??JSON.stringify({lines})},{})
  const text=await response.text();let body;try{body=JSON.parse(text)}catch{body=text}
  assert.deepEqual(f.sql().serialize(),snapshot,'preview changes no database bytes, history, cache, or receipt')
  return {status:response.status,body,queries:f.queries().slice(),cache:response.headers.get('Cache-Control')}
}
const line=(cost,quantity=1,extra={})=>({key:'line-1',wire:'adjust',body:f.addBody({unitCostUsd:cost,quantity,receivedDate:'03/09/2026',...extra})})
async function add(cost,quantity=1,date='01/09/2026',extra={}) {
  const result=await f.request(f.addBody({unitCostUsd:cost,quantity,receivedDate:date,...(cost===0?{freeGoods:true}:{}),...extra}))
  assert.equal(result.status,200,JSON.stringify(result))
}
function manual(cost) {
  const plan=f.load('lib/catalogCostRecompute.ts').planManualCostChange(1,f.sql().prepare('SELECT cost_price_usd,cost_price_khr FROM products WHERE id=1').get(),{cost_price_usd:cost},{id:null,name:'Fixture'})
  if(plan?.entry)f.sql().prepare(plan.entry.sql).run(plan.entry.params)
  f.sql().prepare('UPDATE products SET cost_price_usd=?,purchase_price_usd=? WHERE id=1').run(cost,cost)
}
async function writer(input) {
  if(input.wire==='adjust')return f.request(input.body)
  if(input.wire==='stock_session')return f.load('lib/stockSession.ts').commitStockSession({DB:{},PLAN_TIER:'paid'}, {id:7,name:'Operator',permissions:JSON.stringify({inventory:true,product_cost_edit:true,product_cost_view:true})}, {client_request_id:`preview-session-${++sequence}-abcdefgh`,mode:'stock_in',items:[{line_id:`preview-line-${sequence}`, ...input.body}]})
  const b=input.body
  const body={client_request_id:`preview-receive-${++sequence}-abcdefgh`,product_id:b.productId,branch_id:b.branchId,quantity:b.quantity,free_quantity:b.freeQuantity,unit_cost_usd:b.unitCostUsd,free_goods:b.freeGoods,batch_id:b.batchId,received_date:b.receivedDate,supplier_name:b.supplierName,supplier_id:b.supplierId}
  const response=await batches.request('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{},{waitUntil:()=>{},passThroughOnException:()=>{}})
  return {status:response.status,body:await response.json()}
}
async function parity(input,expected) {
  const result=await preview([input])
  assert.equal(result.status,200,JSON.stringify(result))
  const row=result.body.results[0]
  assert.equal(row.status,'ready',JSON.stringify(row))
  if(expected!==undefined)assert.equal(row.afterUsd,expected)
  assert.equal(result.queries.length,1,'one coherent SELECT for every forecast')
  assert.equal(result.cache,'no-store')
  const khr=f.catalogCost().khr
  f.cloneForWriter()
  const committed=await writer(input)
  assert.equal(committed.status??200,200,JSON.stringify(committed))
  assert.equal(row.afterUsd,f.catalogCost().usd,'forecast equals real cloned writer')
  assert.equal(f.catalogCost().khr,khr,'receipt does not derive KHR')
  return row
}
async function check(name,action) {
  f.fresh()
  try{await action();checks++;console.log(`PASS ${name}`)}finally{f.sql().close()}
}
async function main() {
  if(process.env.RECEIVING_PREVIEW_WORKER_ONLY==='1')return wholeWorker()
  await check('raw negative sub-four-place receipt cannot round into free goods',async()=>{
    for(const wire of ['receive','adjust']) {
      const input={...line(-0.00001,1,{freeGoods:true}),wire}
      assert.equal((await writer(input)).status,400)
      const result=await preview([input]);assert.equal(result.body.results[0].status,'unavailable')
    }
  })
  await check('malformed JSON primitives cannot turn advisory validation into500',async()=>{
    for(const field of ['wire','productId','branchId','supplierId','supplierName','receivedDate','batchId']) {
      const input=line(3)
      if(field==='wire')input.wire={toString:0}
      else input.body[field]={toString:0}
      const result=await preview([input]);assert.equal(result.status,200);assert.equal(result.body.results[0].status,'unavailable',field)
    }
    const supplier=await preview([line(3,1,{supplierName:null,supplierId:1})]);assert.equal(supplier.body.results[0].reason,'supplier_required')
    for(const quantity of ['2',1_000_000_001])assert.equal((await preview([{key:'atomic',wire:'stock_session',body:{kind:'receive',product_id:1,branch_id:1,quantity,unit_cost_usd:6,received_date:'03/09/2026',supplier_name:'Acme'}}])).body.results[0].reason,'invalid_quantity')
  })
  await check('excluded free quantities use eligible weight',async()=>{await add(4,5);await add(0,5,'02/09/2026');await parity(line(8,5),6)})
  await check('unrounded numerator differs from rounded catalog reconstruction',async()=>{await add(1.0001);await add(1.0002,1,'02/09/2026');assert.equal(f.catalogCost().usd,1.0002);await parity(line(1.0001),1.0001)})
  await check('manual positive baseline weights overridden stock',async()=>{await add(4,4);manual(10);await add(20,2,'02/09/2026');await parity(line(30,2),17.5)})
  for(const cost of [null,0])await check(`manual ${cost} preserves actual entry semantics`,async()=>{await add(4,4);manual(cost);await parity(line(8,2),cost===null?5.3333:8)})
  await check('global cross-branch available weight',async()=>{await add(4,2);f.sql().exec("INSERT INTO branches(id,name,is_active) VALUES(2,'Storage',1)");await add(8,3,'02/09/2026',{branchId:2});await parity(line(8,2),6.8571)})
  await check('same-day automatic exact-price target',async()=>{await add(4,2);await add(8,2,'02/09/2026');await parity(line(4,2,{receivedDate:'01/09/2026'}),5.3333);assert.equal(f.sql().prepare('SELECT COUNT(*) n FROM product_batches').get().n,2)})
  await check('explicit target preserves original date',async()=>{await add(4,2);const batch=f.sql().prepare('SELECT id FROM product_batches').get().id;await parity(line(4,2,{batchId:batch,receivedDate:'31/12/2026'}),4);assert.equal(f.sql().prepare('SELECT received_at FROM product_batches').get().received_at,'2026-09-01')})
  await check('inactive empty target reactivates without bypassing stocked-lot guard',async()=>{await add(4,2);const batch=f.sql().prepare('SELECT id FROM product_batches').get().id;assert.throws(()=>f.sql().exec('UPDATE product_batches SET is_active=0'),/positive branch stock/);await f.request({productId:1,branchId:1,type:'remove',quantity:2,reason:'Fixture'});f.sql().exec('UPDATE product_batches SET is_active=0');await parity(line(4,2,{batchId:batch}),4);assert.equal(f.sql().prepare('SELECT is_active FROM product_batches').get().is_active,1)})
  for(const which of ['wrong_cost','baseline','foreign_product','missing','legacy_precision'])await check(`explicit stale target ${which} unavailable`,async()=>{
    await add(4,2);const batch=f.sql().prepare('SELECT id FROM product_batches').get().id
    let cost=which==='wrong_cost'?8:4,target=which==='missing'?999:batch
    if(which==='baseline')manual(10)
    if(which==='foreign_product')f.sql().exec("INSERT INTO products(id,name) VALUES(2,'Other');UPDATE product_batches SET variant_product_id=2")
    if(which==='legacy_precision')f.sql().exec('UPDATE product_batches SET unit_cost_usd=4.00001')
    const result=await preview([line(cost,2,{batchId:target})]);assert.equal(result.body.results[0].reason,'invalid_target');assert.equal(result.body.results[0].afterUsd,null)
    const actual=await writer(line(cost,2,{batchId:target}));assert.equal(actual.status,400,JSON.stringify(actual))
  })
  await check('legacy five-place lot not merged into new rounded price',async()=>{await add(4,2);f.sql().exec('UPDATE product_batches SET unit_cost_usd=4.00001');await parity(line(4,2,{receivedDate:'01/09/2026'}),4);assert.equal(f.sql().prepare('SELECT COUNT(*) n FROM product_batches').get().n,2)})
  await check('sold-out fallback survives free receipt',async()=>{await add(8,2);await f.request({productId:1,branchId:1,type:'remove',quantity:2,reason:'Fixture'});await parity(line(0,2,{freeGoods:true}),8)})
  await check('tagged receipt has net zero shelf delta',async()=>{await add(4,2);await parity(line(8,2,{conditionTag:'damaged'}),4)})
  await check('new tagged lot still changes sold-out fallback',async()=>{await parity(line(8,2,{conditionTag:'damaged'}),8)})
  await check('direct receive paid/free dilution parity',async()=>{await add(4,2);await parity({...line(8,2,{freeQuantity:2}),wire:'receive'},4)})
  await check('direct adjust paid/free dilution parity',async()=>{await add(4,2);await parity(line(8,2,{freeQuantity:2}),4)})
  await check('fully free direct receipt is zero even with absent cost',async()=>{await parity(line(null,0,{freeQuantity:3}),0)})
  await check('unknown is retained separately from zero',async()=>{f.sql().exec('UPDATE products SET cost_price_usd=NULL,purchase_price_usd=NULL');await parity(line(0,1,{freeGoods:true}),null)})
  await check('NULL receipt is refused rather than converted to free',async()=>{const result=await preview([line(null)]);assert.equal(result.body.results[0].reason,'cost_required');assert.equal((await writer(line(null))).status,400)})
  await check('undeclared zero is refused',async()=>{const result=await preview([line(0)]);assert.equal(result.body.results[0].reason,'free_goods_required')})
  await check('nearest four places uses actual receipt kernel',async()=>{await parity(line(1.23456),1.2346)})
  await check('canonical stock-session already-effective quantity/cost stays undiluted',async()=>{await add(4,2);await parity({key:'atomic',wire:'stock_session',body:{kind:'receive',product_id:1,branch_id:1,quantity:4,unit_cost_usd:6,received_date:'03/09/2026',supplier_name:'Acme'}},5.3333)})
  await check('body shape, capacity, duplicate and unsupported operations',async()=>{
    assert.equal((await preview([],JSON.stringify({lines:[]}))).status,400)
    assert.equal((await preview(Array.from({length:26},(_,i)=>({...line(3),key:String(i)})))).status,400)
    assert.equal((await preview([line(3)],'x'.repeat(65537))).status,413)
    assert.equal((await preview([line(3),{...line(4),key:'second'}])).body.results.every(r=>r.reason==='duplicate_product'),true)
    assert.equal((await preview([line(3,1,{type:'remove'})])).body.results[0].reason,'unsupported_operation')
    assert.equal((await preview([{key:'new',wire:'stock_session',body:{kind:'create_receive'}}])).body.results[0].reason,'unsupported_operation')
  })
  await check('active product and branch scope with current cost-view denial',async()=>{
    assert.equal((await preview([line(3,1,{branchId:999})])).body.results[0].reason,'branch_unavailable')
    f.sql().exec('UPDATE products SET is_active=0');assert.equal((await preview([line(3)])).body.results[0].reason,'product_unavailable')
    f.setUser({id:7,permissions:JSON.stringify({inventory:true,products:true,product_cost_edit:true})})
    const denied=await preview([line(3)]);assert.equal(denied.status,403);assert.equal(denied.queries.length,0);assert.equal(denied.body.results,undefined)
  })
  await check('one and 25 lines use one read, no per-line DB calls',async()=>{
    for(let id=2;id<=25;id++)f.sql().prepare('INSERT INTO products(id,name) VALUES(?,?)').run(id,`Product ${id}`)
    const lines=Array.from({length:25},(_,i)=>({...line(8),key:`line-${i}`,body:{...line(8).body,productId:i+1}}))
    const many=await preview(lines);assert.equal(many.body.results.length,25);assert.equal(many.queries.length,1);assert.ok(many.body.results.every(r=>r.afterUsd===8))
    const plans=f.sql().prepare('EXPLAIN QUERY PLAN '+helper.RECEIVING_COST_PREVIEW_SQL).all({lines:JSON.stringify(helper.parseReceivingCostPreview({lines}))})
    console.log('PLAN '+JSON.stringify(plans.map(row=>row.detail)))
  })
  console.log(`PASS ${checks} native groups; all forecasts read-only; cloned real writer parity`)
  if(process.env.RECEIVING_PREVIEW_SQLITE_ONLY!=='1')await wholeWorker()
}

async function wholeWorker() {
  const {startWorker}=require('./harness/al_money_native.cjs')
  for(const tier of ['free','paid']) {
    process.env.AL_PLAN_TIER=tier
    const h=await startWorker()
    try {
      for(let id=1;id<=25;id++)await h.db.prepare('INSERT INTO products(id,name,cost_price_usd,cost_price_khr) VALUES(?,?,NULL,123.4567)').bind(id,`Preview ${id}`).run()
      await h.db.prepare("INSERT INTO branches(id,name,is_active) VALUES(2,'Inactive fixture',0)").run()
      const lines=Array.from({length:25},(_,i)=>({...line(8),key:`line-${i}`,body:{...line(8).body,productId:i+1}}))
      const tables=await h.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
      const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,(await h.all(`SELECT * FROM "${name.replaceAll('"','""')}"`)).map(row=>JSON.stringify(row)).sort()])))
      const before=await snapshot()
      for(const size of [1,25]) {
        const result=await h.call('POST','/api/products/receiving-cost-preview',{lines:lines.slice(0,size)},`${tier} ${size} preview`)
        assert.equal(result.status,200,JSON.stringify(result.body))
        assert.equal(result.body.results.length,size)
        assert.ok(result.body.results.every(row=>row.status==='ready'&&row.beforeUsd===null&&row.afterUsd===8))
      }
      const measured=h.metrics.filter(m=>m.label.endsWith(' preview'))
      assert.equal(measured[0].statements,measured[1].statements,'full request query count constant from1to25')
      assert.ok(measured.every(m=>m.statements<=(tier==='free'?50:1000)))
      assert.deepEqual(await snapshot(),before,'actual full Worker preview creates no persistent database changes')
      const viewer=await h.addEmployee(911,'preview_viewer',{products:true,inventory:true,product_cost_view:true})
      assert.equal((await h.call('POST','/api/products/receiving-cost-preview',{lines:[lines[0]]},`${tier} viewer`,{cookie:viewer})).status,200)
      await h.db.prepare('UPDATE users SET permissions=? WHERE id=911').bind(JSON.stringify({product_cost_view:false})).run()
      const revoked=await h.call('POST','/api/products/receiving-cost-preview',{lines:[lines[0]]},`${tier} revoked viewer`,{cookie:viewer})
      assert.equal(revoked.status,403,JSON.stringify(revoked.body));assert.equal(revoked.body.results,undefined)
      const blind=await h.addEmployee(912,'preview_blind',{products:true,inventory:true,product_cost_edit:true})
      assert.equal((await h.call('POST','/api/products/receiving-cost-preview',{lines:[lines[0]]},`${tier} cost edit alone`,{cookie:blind})).status,403)
      assert.equal((await h.call('POST','/api/products/receiving-cost-preview',{lines:[lines[0]]},`${tier} no session`,{cookie:null})).status,401)
      const inactive=await h.call('POST','/api/products/receiving-cost-preview',{lines:[line(8,1,{branchId:2})]},`${tier} inactive branch`)
      assert.equal(inactive.body.results[0].reason,'branch_unavailable')
      const negative=await h.call('POST','/api/products/receiving-cost-preview',{lines:[line(-0.00001,1,{freeGoods:true})]},`${tier} raw negative`)
      assert.equal(negative.body.results[0].status,'unavailable')
      for(let id=1;id<=25;id++) {
        await h.db.prepare("INSERT INTO product_batches(variant_product_id,batch_key,received_at,unit_cost_usd,is_active) VALUES(?,?,'2026-09-01',4,1)").bind(id,`preview-base-${id}`).run()
        const batch=await h.one('SELECT MAX(id) id FROM product_batches')
        await h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,2)').bind(batch.id).run()
      }
      await h.db.prepare("WITH RECURSIVE ids(id) AS (SELECT 100 UNION ALL SELECT id+1 FROM ids WHERE id<599) INSERT INTO products(id,name) SELECT id,'Unrelated '||id FROM ids").run()
      await h.db.prepare("INSERT INTO product_batches(variant_product_id,batch_key,received_at,unit_cost_usd,is_active) SELECT id,'unrelated-'||id,'2026-09-01',99,1 FROM products WHERE id>=100").run()
      await h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT id,1,100 FROM product_batches WHERE variant_product_id>=100').run()
      for(const size of [1,25]) {
        const normalized=helper.parseReceivingCostPreview({lines:lines.slice(0,size)})
        const query=await h.db.prepare(helper.RECEIVING_COST_PREVIEW_SQL).bind(JSON.stringify(normalized)).all().catch(error=>{throw new Error('raw preview row measurement: '+error.message)})
        assert.equal(query.results.length,size)
        assert.ok(query.results.every(row=>row.afterUsd===5.3333))
        console.log(`ROWS ${tier} lines=${size} requestedLots=${size} unrelatedLots=500 rows_read=${query.meta.rows_read} rows_written=${query.meta.rows_written}`)
        assert.equal(query.meta.rows_written,0)
      }
      console.log('HTTP '+JSON.stringify({tier,metrics:h.metrics.filter(m=>!m.label.startsWith('login'))}))
      console.log(`PASS ${tier} whole Worker authenticated current permissions,1/25constant budgets,scope and zero persistent writes`)
    } finally {await h.mf.dispose()}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})

