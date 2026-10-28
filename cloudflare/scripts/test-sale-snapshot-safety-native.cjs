'use strict'
process.env.AL_PLAN_TIER = process.env.AL_PLAN_TIER || 'free'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const guard = 'assertSaleSnapshotBudget({ header:saleInsertStatement.params, items:priced })'
  const historicalSeedPatch = fs.readFileSync(path.join(__dirname,'../src/routes/sales.ts'),'utf8').includes(guard)
    ? [{name:'historical pre-guard fixture only',file:'src/routes/sales.ts',from:guard,to:`if(c.req.header('x-al-historical-fixture')!=='1') ${guard}`},
       {name:'historical create residual fixture only',file:'src/routes/sales.ts',from:'snapshotHeaderBytes:serializedSaleSnapshotBytes(saleInsertStatement.params)',
        to:"snapshotHeaderBytes:c.req.header('x-al-historical-fixture')==='1'?-100_000_000:serializedSaleSnapshotBytes(saleInsertStatement.params)"}] : []
  const mutants = {
    'no-admission':{file:'src/lib/saleSnapshotBudget.ts',from:'if (serializedSaleSnapshotBytes(value) + generatedIdBytes + SALE_SNAPSHOT_FRAMING_RESERVE > SALE_SNAPSHOT_BYTE_BUDGET)',to:'if (false)'},
    'character-count':{file:'src/lib/saleSnapshotBudget.ts',from:'return encoder.encode(json).byteLength',to:'return json.length'},
  }
  if(process.env.MUTANT&&!mutants[process.env.MUTANT])throw new Error('Unknown snapshot mutant')
  const patches = process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : historicalSeedPatch
  if(process.env.MUTANT)patches.push({name:process.env.MUTANT,...mutants[process.env.MUTANT]})
  if(!process.env.BASE_COMMIT)patches.push({name:'lot label changes after preflight',file:'src/routes/sales.ts',
    from:"createResults = await executeStockTransaction(db, statements, 'retry') as typeof createResults",
    to:"if(c.req.header('x-al-lot-growth')&&attempt===0)await db.prepare('UPDATE product_batches SET lot_code=? WHERE variant_product_id IN(15000,15001,15002,15003)').run([c.req.header('x-al-lot-growth')==='quoted'?'\"'.repeat(1_100_000):'ក'.repeat(200_000)]); createResults = await executeStockTransaction(db, statements, 'retry') as typeof createResults"})
  if(process.env.RESIDUAL_ONLY==='1')patches.push({name:'exercise SQL receipt residual',file:'src/routes/sales.ts',
    from:'const {budgetStates,canonicalAvailable,identityBindings,response,...row}=input',
    to:'const {budgetStates:omittedBudgetStates,canonicalAvailable,identityBindings,response,...row}=input; const budgetStates=[]'})
  const h = await H.startWorker({ d1CallLimit: H.FREE_QUERY_LIMIT,patches })
  const metrics = []
  try {
    const lines = []
    for (let index = 0; index < 60; index++) {
      const productId = 15000 + index
      await H.seedProduct(h, productId, `Snapshot recovery product ${index}`, 10, 100, 4)
      await h.db.prepare('UPDATE products SET brand=?,category=? WHERE id=?')
        .bind('Recovery pricing brand for retained proof', 'Recovery category for retained proof', productId).run()
      lines.push({ productId, quantity: 1 })
    }
    const key = 'snapshot-recovery-history'
    const request = { key, lines, paymentDetails: [{ method:'Cash',amount_usd:600,amount_khr:0 }] }
    const ordinaryCall = h.call
    h.call = (method,url,body,label,options={}) => ordinaryCall(method,url,body,label,{...options,headers:{...options.headers,'x-al-historical-fixture':'1'}})
    const created = await H.createSale(h, request)
    h.call = ordinaryCall
    const stored = await h.one('SELECT id,total_usd FROM sales WHERE client_request_id=?', key)
    assert.ok(stored, `historical fixture must be committed: ${created.status} ${JSON.stringify(created.body)}`)
    const before = await h.one('SELECT COUNT(*) sales,(SELECT SUM(quantity) FROM branch_stock) stock FROM sales')
    const rows = await h.all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', stored.id)
    const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8')
    assert.ok(bytes > 2_000_000, `fixture must exceed one D1 value: ${bytes}`)
    await assert.rejects(()=>h.one('SELECT json_group_array(pricing_snapshot_json) AS snapshots FROM sale_items WHERE sale_id=?',stored.id),/too big|SQLITE_TOOBIG/i)
    const recovered = await h.call('GET', '/api/sales/create-receipt?client_request_id='+key, undefined, 'oversized receipt recovery')
    metrics.push(h.metrics.at(-1))
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(recovered.body.committed, true)
    assert.equal(recovered.body.response.id, stored.id)
    assert.equal(recovered.body.response.sale.items.length, 60)
    assert.equal(recovered.body.response.sale.total_usd, 600)
    assert.deepEqual(recovered.body.response.sale.items.map(row=>row.id), rows.map(row=>row.id))
    assert.ok(recovered.body.response.sale.items.every(row=>typeof row.pricing_snapshot_json==='string' && JSON.parse(row.pricing_snapshot_json).version===1))
    assert.deepEqual(recovered.body.response.sale.items.map(row=>row.pricing_snapshot_json), rows.map(row=>row.pricing_snapshot_json))
    const replay = await H.createSale(h, request)
    metrics.push(h.metrics.at(-1))
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.duplicate, true)
    assert.equal(replay.body.id, stored.id)
    assert.deepEqual(replay.body.sale, recovered.body.response.sale)
    assert.deepEqual(await h.one('SELECT COUNT(*) sales,(SELECT SUM(quantity) FROM branch_stock) stock FROM sales'), before)
    for (const entry of metrics) assert.ok(entry.calls > 0 && entry.calls <= H.FREE_QUERY_LIMIT, JSON.stringify(entry))
    const staffCookie = await h.addEmployee(1501,'snapshot_staff',{pos:true,sales:true})
    const forbidden = await h.call('GET','/api/sales/create-receipt?client_request_id='+key,undefined,'other cashier recovery',{cookie:staffCookie})
    assert.equal(forbidden.status,200)
    assert.equal(forbidden.body.committed,false,'receipt recovery stays bound to original cashier or admin')
    const state = async () => ({
      sales:await h.all('SELECT * FROM sales ORDER BY id'),
      items:await h.all('SELECT * FROM sale_items ORDER BY id'),
      saleAudit:await h.all("SELECT * FROM audit_logs WHERE entity IN('sale','sale_creation') ORDER BY id"),
      tables:await h.one(`SELECT (SELECT COUNT(*) FROM sales) sales,(SELECT COUNT(*) FROM sale_items) items,
        (SELECT COUNT(*) FROM sale_mutation_receipts) receipts,(SELECT COUNT(*) FROM inventory_movements) movements,
        (SELECT COUNT(*) FROM sale_amendments) amendments,(SELECT COUNT(*) FROM action_history) history`),
      stock:await h.all('SELECT product_id,quantity FROM branch_stock ORDER BY product_id'),
      lots:await h.all('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id'),
    })
    const prior = await state()
    const refused = await H.createSale(h,{...request,key:'snapshot-new-too-large'})
    assert.equal(refused.status,409,JSON.stringify(refused.body))
    assert.equal(refused.body.code,'sale_snapshot_too_large')
    assert.equal(refused.body.proven_uncommitted,true)
    assert.deepEqual(await state(),prior)
    const absent = await h.call('GET','/api/sales/create-receipt?client_request_id=snapshot-new-too-large',undefined,'refused sale is absent')
    assert.equal(absent.body.committed,false)
    const smaller = await H.createSale(h,{key:'snapshot-new-too-large',lines:lines.slice(0,1),paymentDetails:[{method:'Cash',amount_usd:10,amount_khr:0}]})
    assert.equal(smaller.status,200,JSON.stringify(smaller.body))
    const addBefore = await state()
    const added = await H.addSaleItems(h,smaller.body.id,'snapshot-add-too-large',lines.slice(0,50))
    assert.equal(added.status,409,JSON.stringify(added.body))
    assert.equal(added.body.code,'sale_snapshot_too_large')
    assert.equal(added.body.proven_uncommitted,true)
    assert.deepEqual(await state(),addBefore)
    const amendBase = await H.createSale(h,{key:'snapshot-amend-base',lines:lines.slice(0,24),paymentDetails:[{method:'Cash',amount_usd:240,amount_khr:0}]})
    assert.equal(amendBase.status,200,JSON.stringify(amendBase.body).slice(0,250))
    await H.seedProduct(h,16000,'Snapshot replacement',10,100,4)
    await h.db.prepare('UPDATE products SET brand=? WHERE id=16000').bind('a'.repeat(90_000)).run()
    const amendBefore = await state()
    const amended = await H.amendSale(h,amendBase.body.id,{client_request_id:'snapshot-amend-too-large',kind:'line_replaced',
      sale_item_id:amendBase.body.sale.items[0].id,expected_updated_at:amendBase.body.sale.updated_at,
      replacement:{product_id:16000,quantity:1,branch_id:1,batch_id:21000,client_line_key:'snapshot-replacement',pricing_source:'selling',
        pricing_quote:{gross_usd:10,product_discount_usd:0,manual_discount_usd:0,total_usd:10,total_khr:40000}}})
    assert.equal(amended.status,409,JSON.stringify(amended.body))
    assert.equal(amended.body.code,'sale_snapshot_too_large')
    assert.equal(amended.body.proven_uncommitted,true)
    assert.deepEqual(await state(),amendBefore)
    await h.db.prepare('INSERT INTO delivery_contacts(id,name,address) VALUES(?,?,?)')
      .bind(17000,'Snapshot courier','ក'.repeat(400_000)).run()
    const deliveryBefore=await state()
    const delivery=await H.amendSale(h,amendBase.body.id,{client_request_id:'snapshot-delivery-too-large',kind:'delivery_added',
      delivery_contact_id:17000,delivery_fee_usd:1,expected_updated_at:amendBase.body.sale.updated_at})
    assert.equal(delivery.status,409,JSON.stringify(delivery.body))
    assert.equal(delivery.body.code,'sale_snapshot_too_large')
    assert.equal(delivery.body.proven_uncommitted,true)
    assert.deepEqual(await state(),deliveryBefore)
    await h.db.prepare('UPDATE sales SET is_delivery=1 WHERE id=?').bind(stored.id).run()
    const costBefore=await state()
    const cost=await H.amendSale(h,stored.id,{client_request_id:'snapshot-cost-too-large',kind:'delivery_actual_cost_changed',
      delivery_actual_cost_usd:1,expected_updated_at:recovered.body.response.sale.updated_at})
    assert.equal(cost.status,409,JSON.stringify(cost.body))
    assert.equal(cost.body.code,'sale_snapshot_too_large')
    assert.equal(cost.body.proven_uncommitted,true)
    assert.deepEqual(await state(),costBefore)
    const lotGrowthBefore=await state()
    h.call = (method,url,body,label,options={}) => ordinaryCall(method,url,body,label,{...options,headers:{...options.headers,'x-al-lot-growth':'1'}})
    const lotGrowth=await H.createSale(h,{key:'snapshot-lot-growth',lines:lines.slice(0,4),paymentDetails:[{method:'Cash',amount_usd:40,amount_khr:0}]})
    h.call=ordinaryCall
    assert.equal(lotGrowth.status,409,JSON.stringify(lotGrowth.body))
    assert.equal(lotGrowth.body.code,'sale_snapshot_too_large')
    assert.equal(lotGrowth.body.proven_uncommitted,true)
    assert.deepEqual(await state(),lotGrowthBefore)
    await h.db.prepare("UPDATE product_batches SET lot_code='Recovered fixture lot' WHERE variant_product_id IN(15000,15001,15002,15003)").run()
    const quotedBefore=await state()
    h.call = (method,url,body,label,options={}) => ordinaryCall(method,url,body,label,{...options,headers:{...options.headers,'x-al-lot-growth':'quoted'}})
    const quotedGrowth=await H.createSale(h,{key:'snapshot-quoted-lot-growth',lines:lines.slice(0,4),paymentDetails:[{method:'Cash',amount_usd:40,amount_khr:0}]})
    h.call=ordinaryCall
    assert.equal(quotedGrowth.status,409,JSON.stringify(quotedGrowth.body))
    assert.equal(quotedGrowth.body.code,'sale_snapshot_too_large')
    assert.equal(quotedGrowth.body.proven_uncommitted,true)
    assert.deepEqual(await state(),quotedBefore)
    await h.db.prepare("UPDATE product_batches SET lot_code='Recovered fixture lot' WHERE variant_product_id IN(15000,15001,15002,15003)").run()
    const fallbackBase=await H.createSale(h,{key:'snapshot-small-fallback',lines:lines.slice(0,1),paymentDetails:[{method:'Cash',amount_usd:10,amount_khr:0}],extra:{is_delivery:true,delivery_fee_usd:0,delivery_fee_paid_by:'customer'}})
    assert.equal(fallbackBase.status,200,JSON.stringify(fallbackBase.body))
    await h.db.prepare("UPDATE sale_items SET pricing_snapshot_json='{}' WHERE sale_id=?").bind(fallbackBase.body.id).run()
    const fallbackBefore=await state()
    const fallbackRequest={client_request_id:'snapshot-small-fallback-cost',kind:'delivery_actual_cost_changed',delivery_actual_cost_usd:1,expected_updated_at:fallbackBase.body.sale.updated_at}
    const fallback=await H.amendSale(h,fallbackBase.body.id,fallbackRequest)
    assert.equal(fallback.status,200,JSON.stringify(fallback.body))
    assert.equal(fallback.body.canonical_receipt_available,false)
    const fallbackAfter=await state()
    assert.deepEqual(fallbackAfter.items,fallbackBefore.items)
    assert.deepEqual(fallbackAfter.stock,fallbackBefore.stock)
    assert.deepEqual(fallbackAfter.lots,fallbackBefore.lots)
    const fallbackReplay=await H.amendSale(h,fallbackBase.body.id,fallbackRequest)
    assert.equal(fallbackReplay.status,200,JSON.stringify(fallbackReplay.body))
    assert.deepEqual(fallbackReplay.body,fallback.body)
    assert.deepEqual(await state(),fallbackAfter)
    await h.db.batch(lines.slice(0,25).map(({productId})=>h.db.prepare('UPDATE products SET brand=? WHERE id=?').bind('a'.repeat(1000),productId)))
    const ascii = await H.createSale(h,{key:'snapshot-ascii-25',lines:lines.slice(0,25),paymentDetails:[{method:'Cash',amount_usd:250,amount_khr:0}]})
    assert.equal(ascii.status,200,JSON.stringify(ascii.body).slice(0,250))
    await h.db.batch(lines.slice(0,25).map(({productId})=>h.db.prepare('UPDATE products SET brand=? WHERE id=?').bind('ក'.repeat(1000),productId)))
    const unicodeBefore = await state()
    const unicode = await H.createSale(h,{key:'snapshot-khmer-25',lines:lines.slice(0,25),paymentDetails:[{method:'Cash',amount_usd:250,amount_khr:0}]})
    assert.equal(unicode.status,409,JSON.stringify(unicode.body))
    assert.equal(unicode.body.code,'sale_snapshot_too_large')
    assert.deepEqual(await state(),unicodeBefore)
    for (const entry of h.metrics.filter(entry=>entry.label!=='login')) assert.ok(entry.calls <= H.FREE_QUERY_LIMIT,JSON.stringify(entry))
    console.log(JSON.stringify({status:'PASS',tier:process.env.AL_PLAN_TIER,bytes,createdStatus:created.status,
      cases:{create:refused.status,add:added.status,amend:amended.status,delivery:delivery.status,cost:cost.status,lotGrowth:lotGrowth.status,quotedGrowth:quotedGrowth.status,fallback:fallback.status,ascii:ascii.status,khmer:unicode.status},
      maxPhysicalCalls:Math.max(...h.metrics.filter(entry=>entry.label!=='login').map(entry=>entry.calls)),metrics}))
  } finally { await h.mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
