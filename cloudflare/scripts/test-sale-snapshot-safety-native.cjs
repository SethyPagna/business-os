'use strict'
process.env.AL_PLAN_TIER = process.env.AL_PLAN_TIER || 'free'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const guard = 'assertSaleSnapshotBudget(priced)'
  const historicalSeedPatch = fs.readFileSync(path.join(__dirname,'../src/routes/sales.ts'),'utf8').includes(guard)
    ? [{name:'historical pre-guard fixture only',file:'src/routes/sales.ts',from:guard,to:`if(c.req.header('x-al-historical-fixture')!=='1') ${guard}`}] : []
  const mutants = {
    'no-admission':{file:'src/lib/saleSnapshotBudget.ts',from:'if (serializedSaleSnapshotBytes(value) + SALE_SNAPSHOT_FRAMING_RESERVE > SALE_SNAPSHOT_BYTE_BUDGET)',to:'if (false)'},
    'character-count':{file:'src/lib/saleSnapshotBudget.ts',from:'return encoder.encode(json).byteLength',to:'return json.length'},
  }
  if(process.env.MUTANT&&!mutants[process.env.MUTANT])throw new Error('Unknown snapshot mutant')
  const patches = process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : historicalSeedPatch
  if(process.env.MUTANT)patches.push({name:process.env.MUTANT,...mutants[process.env.MUTANT]})
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
      cases:{create:refused.status,add:added.status,amend:amended.status,ascii:ascii.status,khmer:unicode.status},
      maxPhysicalCalls:Math.max(...h.metrics.filter(entry=>entry.label!=='login').map(entry=>entry.calls)),metrics}))
  } finally { await h.mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
