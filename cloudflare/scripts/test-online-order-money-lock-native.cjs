// KHQR S6a: the online money of a Fulfilled sale is not the till's to rewrite. A settlement of the Not Paid extra keeps the KHQR part (and works), but no settlement may add
// KHQR money, no correction may replace a linked sale's recorded payment, and no bulk relabel may create or remove it. Controls: the same actions on unlinked sales work.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-money-lock
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
let n = 0
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Lock Serum', 12.5, 100, 2)
    await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind('["Cash","ABA","Card"]').run()
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    async function linkedSale({ quantity, status, till = 0 }) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES ('LB-L${n}', 'lock-${n}', 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).run()
      const orderId = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', 25, 'USD', 'paid', 25, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(orderId, `WLOCK${String(n).padStart(11, '0')}`).run()
      const made = await H.createSale(h, { key: `lock-sale-${n}`, lines: [{ productId: 12, quantity }], status,
        paymentDetails: [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }, ...(till ? [{ method: 'Cash', amount_usd: till, amount_khr: 0 }] : [])], extra: { online_order_id: orderId } })
      assert.equal(made.status, 200, JSON.stringify(made.body))
      return { saleId: made.body.id, orderId }
    }
    const plainNotPaid = async () => {
      n += 1
      const made = await H.createSale(h, { key: `plain-np-${n}`, lines: [{ productId: 12, quantity: 2 }], status: 'awaiting_payment', paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }] })
      assert.equal(made.status, 200, JSON.stringify(made.body)); return made.body.id
    }
    const settle = async (id, details, extra = {}) => {
      const row = await h.one('SELECT updated_at, exchange_rate FROM sales WHERE id = ?', id)
      return h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', payment_details: details, expected_exchange_rate: Number(row.exchange_rate), client_request_id: `settle-${id}-${++n}`, ...extra }, 'settle')
    }
    const sale = (id) => h.one('SELECT sale_status, payment_method, payment_details, amount_paid_usd FROM sales WHERE id = ?', id)

    // The Q3 extra: Fulfil 3 lines against a $25 order, Not Paid; the cashier then takes the $12.50 balance. The KHQR part stays.
    const extra = await linkedSale({ quantity: 3, status: 'awaiting_payment' })
    const settled = await settle(extra.saleId, [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }, { method: 'Cash', amount_usd: 12.5, amount_khr: 0 }])
    assert.equal(settled.status, 200, JSON.stringify(settled.body))
    const after = await sale(extra.saleId)
    assert.equal(after.sale_status, 'completed'); assert.equal(Number(after.amount_paid_usd), 37.5)
    assert.deepEqual(JSON.parse(after.payment_details).map((d) => [d.method, Number(d.amount_usd)]).sort(), [['ABA', 25], ['Cash', 12.5]])
    console.log('PASS the Not Paid extra of a Fulfilled sale is settled at the till and the KHQR part stays in the recorded payment')

    // No settlement may add KHQR money.
    const other = await linkedSale({ quantity: 3, status: 'awaiting_payment' })
    const adds = await settle(other.saleId, [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }, { method: 'ABA', amount_usd: 12.5, amount_khr: 0 }])
    assert.equal(adds.status, 400, JSON.stringify(adds.body)); assert.equal(adds.body.code, 'online_method_requires_order')
    assert.equal((await sale(other.saleId)).sale_status, 'awaiting_payment')
    const plain = await plainNotPaid()
    const plainAdds = await settle(plain, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'ABA', amount_usd: 20, amount_khr: 0 }])
    assert.equal(plainAdds.status, 400, 'the KHQR method is refused on ANY settlement, not only linked ones')
    console.log('PASS a settlement naming the KHQR method is refused (linked or not); the sale stays Not Paid')

    // No correction may replace a linked sale's recorded payment; the same correction works on a plain sale (control).
    const moveBack = async (id) => {
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id)
      return h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'awaiting_payment', expected_updated_at: row.updated_at, client_request_id: `back-${id}-${++n}` }, 'back to not paid')
    }
    const back = await moveBack(extra.saleId)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    const correct = await settle(extra.saleId, [{ method: 'Cash', amount_usd: 37.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(correct.status, 409, JSON.stringify(correct.body)); assert.equal(correct.body.code, 'linked_sale_money_locked')
    assert.deepEqual(JSON.parse((await sale(extra.saleId)).payment_details).map((d) => d.method).sort(), ['ABA', 'Cash'], 'the recorded payment is untouched')
    const plainDone = await settle(plain, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Card', amount_usd: 20, amount_khr: 0 }]); assert.equal(plainDone.status, 200, JSON.stringify(plainDone.body))
    const plainBack = await moveBack(plain); assert.equal(plainBack.status, 200, JSON.stringify(plainBack.body))
    const plainCorrect = await settle(plain, [{ method: 'Cash', amount_usd: 25, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(plainCorrect.status, 200, `control: a plain sale's payment can be corrected: ${JSON.stringify(plainCorrect.body)}`)
    console.log('PASS a linked sale recorded payment cannot be replaced (409 linked_sale_money_locked); control: a plain sale can')

    // Bulk relabel: cannot create online money, cannot remove it; plain relabels still work.
    const relabel = async (id, source, target) => {
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id)
      return h.call('POST', '/api/sales/bulk-update', { client_request_id: `relabel-${id}-${++n}`, items: [{ id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source, target } }, 'relabel')
    }
    const toOnline = await relabel(plain, 'Cash', 'ABA')
    assert.equal(toOnline.status, 400, JSON.stringify(toOnline.body)); assert.equal(toOnline.body.code, 'online_method_requires_order')
    const awayFromOnline = await relabel(extra.saleId, 'ABA', 'Card')
    assert.equal(awayFromOnline.status, 409, JSON.stringify(awayFromOnline.body)); assert.equal(awayFromOnline.body.code, 'linked_sale_money_locked')
    const ordinary = await relabel(plain, 'Cash', 'Card')
    assert.equal(ordinary.status, 200, `control: an ordinary relabel works: ${JSON.stringify(ordinary.body)}`)
    const linkedCash = await relabel(extra.saleId, 'Cash', 'Card')
    assert.equal(linkedCash.status, 200, `control: the till part of a linked sale can be relabelled: ${JSON.stringify(linkedCash.body)}`)
    console.log('PASS bulk relabel cannot create or remove KHQR money; ordinary relabels and the till part of a linked sale still work')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online order money lock: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
