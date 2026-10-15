const assert = require('node:assert/strict')
const { startWorker, seedProduct } = require('./harness/al_money_native.cjs')
;(async () => {
  const h = await startWorker()
  try {
    await seedProduct(h, 701, 'Supplier test', 10, 20, 2)
    const body = { client_request_id: 'supplier-explicit-null', branch_id: 1, supplier_name: 'Synthetic supplier', reason: 'Synthetic', settlement: 'refund', supplier_compensation_usd: null, supplier_compensation_khr: null, items: [{ product_id: 701, quantity: 1, cost_price_usd: 2, cost_price_khr: 8000 }] }
    const result = await h.call('POST', '/api/returns/supplier', body)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const row = await h.one('SELECT supplier_compensation_usd,supplier_compensation_khr,supplier_loss_usd FROM returns WHERE id=?', result.body.id)
    assert.equal(row.supplier_compensation_usd, null)
    assert.equal(row.supplier_compensation_khr, null)
    assert.equal(row.supplier_loss_usd, null)
    const retry = await h.call('POST', '/api/returns/supplier', body)
    assert.equal(retry.status, 200)
    assert.equal(retry.body.id, result.body.id)
    assert.equal((await h.one('SELECT quantity FROM branch_stock WHERE product_id=701 AND branch_id=1')).quantity, 19)
    for (const [index, value, expected] of [[1, undefined, 2], [2, 0, 0], [3, 1.1234, 1.1234]]) {
      const control = await h.call('POST', '/api/returns/supplier', { ...body, client_request_id: `supplier-control-${index}`, supplier_compensation_usd: value, supplier_compensation_khr: value })
      assert.equal(control.status, 200, JSON.stringify(control.body))
      assert.equal((await h.one('SELECT supplier_compensation_usd FROM returns WHERE id=?', control.body.id)).supplier_compensation_usd, expected)
    }
    const beforeInvalid = await h.one('SELECT quantity FROM branch_stock WHERE product_id=701 AND branch_id=1')
    for (const value of ['12oops', '1e309', true]) {
      const invalid = await h.call('POST', '/api/returns/supplier', { ...body, client_request_id: `supplier-invalid-${value}`, supplier_compensation_usd: value })
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body))
      assert.equal(invalid.body.code, 'invalid_supplier_compensation')
    }
    assert.equal((await h.one('SELECT quantity FROM branch_stock WHERE product_id=701 AND branch_id=1')).quantity, beforeInvalid.quantity)
    console.log('PASS real Worker supplier explicit NULL/absent/0/4dp compensation, malformed refusal and retry')
  } finally { await h.mf.dispose() }
})().catch(error => { console.error(error); process.exitCode = 1 })
