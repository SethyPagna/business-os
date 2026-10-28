'use strict'
process.env.AL_PLAN_TIER = process.env.AL_PLAN_TIER || 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const h = await H.startWorker({ d1CallLimit: H.FREE_QUERY_LIMIT,
    patches: process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : [] })
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
    const created = await H.createSale(h, request)
    const stored = await h.one('SELECT id,total_usd FROM sales WHERE client_request_id=?', key)
    assert.ok(stored, `historical fixture must be committed: ${created.status} ${JSON.stringify(created.body)}`)
    const before = await h.one('SELECT COUNT(*) sales,(SELECT SUM(quantity) FROM branch_stock) stock FROM sales')
    const rows = await h.all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', stored.id)
    const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8')
    assert.ok(bytes > 2_000_000, `fixture must exceed one D1 value: ${bytes}`)
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
    console.log(JSON.stringify({status:'PASS',tier:process.env.AL_PLAN_TIER,bytes,createdStatus:created.status,metrics}))
  } finally { await h.mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
