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
    const samples = [
      ['2026-09-01', 'Mixed', 'credit', 5.1234, null, -1.1234, null],
      ['2026-09-01', 'Mixed', 'credit', null, 0, null, 0],
      ['2026-09-02', 'Unknown', 'writeoff', null, null, null, null],
      ['2026-09-03', 'Zero', 'replacement', 0, 0, 0, 0],
      ['2026-09-03', 'Known', 'refund', 2, 8000.1234, 1.2345, 3.1234],
    ]
    const insert = async (sample, branch = 1, status = 'completed', scope = 'supplier') => {
      const [day, reason, type, usd, khr, lossUsd, lossKhr] = sample
      await h.db.prepare('INSERT INTO returns(return_scope,branch_id,status,created_at,reason,return_type,supplier_compensation_usd,supplier_compensation_khr,supplier_loss_usd,supplier_loss_khr,total_refund_usd,total_refund_khr) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(scope, branch, status, `${day} 12:00:00`, reason, type, usd, khr, lossUsd, lossKhr, scope === 'customer' ? 50.1234 : 0, scope === 'customer' ? 123.456 : 0).run()
    }
    for (const sample of samples) await insert(sample)
    await insert(['2026-09-01', 'Excluded', 'refund', 100, 100, 100, 100], 1, 'cancelled')
    await insert(['2026-09-01', 'Excluded', 'refund', 100, 100, 100, 100], 2)
    await insert(['2026-08-01', 'Excluded', 'refund', 100, 100, 100, 100])
    await insert(['2026-09-01', 'Customer', 'refund', 0, 0, 0, 0], 1, 'completed', 'customer')
    const reportUrl = '/api/returns/report?startDate=2026-09-01&endDate=2026-09-03&branchId=1&scope=supplier'
    const report = await h.call('GET', reportUrl)
    assert.equal(report.status, 200, JSON.stringify(report.body))
    assert.equal(report.body.totals.count, 5)
    assert.equal(report.body.totals.compensation_usd, 7.1234)
    assert.equal(report.body.totals.loss_usd, 0.1111)
    assert.equal(report.body.totals.compensation_khr, 8000.1234)
    for (const field of ['compensation_usd', 'compensation_khr', 'loss_usd', 'loss_khr']) {
      assert.equal(report.body.totals[`${field}_unknown_count`], 2)
      assert.equal(report.body.totals[`${field}_known_count`], 3)
      for (const key of ['days', 'by_reason', 'by_type']) {
        const unknown = report.body[key].find(row => row.date === '2026-09-02' || row.reason === 'Unknown' || row.return_type === 'writeoff')
        assert.equal(unknown[field], null, `${key} ${field}: all unknown`)
        assert.equal(unknown[`${field}_unknown_count`], 1)
      }
    }
    assert.equal(report.body.by_reason.find(row => row.reason === 'Zero').loss_usd, 0)
    assert.equal(report.body.by_reason.find(row => row.reason === 'Mixed').loss_usd, -1.1234)
    const customer = await h.call('GET', reportUrl.replace('scope=supplier', 'scope=customer'))
    assert.equal(customer.body.totals.count, 1)
    assert.equal(customer.body.totals.refund_usd, 50.12)
    assert.equal(customer.body.totals.refund_khr, 123)
    const blind = await h.addEmployee(1903, 'supplier-blind', { returns: true, product_cost_view: false })
    const denied = await h.call('GET', reportUrl, undefined, 'denied report', { cookie: blind })
    assert.equal(denied.status, 200)
    assert.ok(!JSON.stringify(denied.body).includes('compensation_usd'))
    assert.ok(!JSON.stringify(denied.body).includes('loss_usd'))
    console.log('PASS real Worker supplier report completeness, signed4dp, all groups, scope/branch/time/cancelled and denied actor')
    console.log('PASS real Worker supplier explicit NULL/absent/0/4dp compensation, malformed refusal and retry')
  } finally { await h.mf.dispose() }
})().catch(error => { console.error(error); process.exitCode = 1 })
