// KHQR round 3 R3-1: money already handed back out of the drawer (a cash return) is not refunded again through ABA when the sale is cancelled. A cash return comes out of the
// cash the customer tendered first; only the excess came out of their online money. Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-cancel-cash-return
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
let n = 0
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Cancel Serum', 12.5, 500, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    async function paidOrder(usd) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES (?, ?, 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', ?, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).bind('LB-C' + n, 'cancel-cash-' + n, usd).run()
      const id = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', ?, 'USD', 'paid', ?, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(id, `WCANCEL${String(n).padStart(11, '0')}`, usd, usd).run()
      return id
    }
    async function fulfilled(usd, quantity, online, cash) {
      const orderId = await paidOrder(usd)
      const made = await H.createSale(h, { key: `cancel-cash-sale-${n}`, lines: [{ productId: 12, quantity }], status: 'completed',
        paymentDetails: [{ method: 'ABA', amount_usd: online, amount_khr: 0 }, ...(cash ? [{ method: 'Cash', amount_usd: cash, amount_khr: 0 }] : [])], extra: { online_order_id: orderId } })
      assert.equal(made.status, 200, JSON.stringify(made.body))
      const item = await h.one('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', made.body.id)
      return { orderId, saleId: made.body.id, itemId: item.id }
    }
    const cashReturn = async (s, quantity) => { const r = await H.customerReturn(h, { key: `cancel-cash-ret-${s.saleId}-${quantity}-${Math.random()}`, saleId: s.saleId, lines: [{ saleItemId: s.itemId, productId: 12, quantity }] }); assert.equal(r.created.status, 200, JSON.stringify(r.created.body)) }
    const cancel = async (s) => { const r = await h.call('PATCH', '/api/sales/' + s.saleId + '/status', { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: 'cancel-' + s.saleId }, 'cancel'); assert.equal(r.status, 200, JSON.stringify(r.body)) }
    const due = async (s) => (await h.call('GET', H.fresh('/api/online-orders/' + s.orderId), undefined, 'order')).body.money.refund_due_usd
    const note = (s, amount) => h.call('POST', '/api/online-orders/' + s.orderId + '/refund-note', { amount_usd: amount, reference: `ABA-${s.orderId}-${amount}-${Math.random()}` }, 'refund note')

    const control = await fulfilled(25, 2, 25, 0)
    await cancel(control)
    assert.equal(await due(control), 25, 'control: a cancelled sale with no return owes the whole online payment back')

    const full = await fulfilled(25, 2, 25, 0)
    await cashReturn(full, 2)
    assert.equal(await due(full), 0)
    await cancel(full)
    assert.equal(await due(full), 0, 'the whole sale went back as cash, so cancelling it leaves nothing to refund online')
    const refused = await note(full, 25)
    assert.equal(refused.status, 409, JSON.stringify(refused.body)); assert.equal(refused.body.code, 'refund_over_due')
    console.log('PASS pay 25 online, Fulfil, cash return, cancel: refund due 0 and a note is refused')

    const partial = await fulfilled(25, 2, 25, 0)
    await cashReturn(partial, 1)
    await cancel(partial)
    assert.equal(await due(partial), 12.5, 'half went back as cash, half is still owed online')
    assert.equal((await note(partial, 12.5)).status, 201)
    assert.equal((await note(partial, 0.01)).body.code, 'refund_over_due')
    console.log('PASS a partial cash return leaves only the rest due online')

    const mixedWithin = await fulfilled(25, 4, 25, 25)
    await cashReturn(mixedWithin, 2)
    await cancel(mixedWithin)
    assert.equal(await due(mixedWithin), 25, 'a cash return that fits in the cash tendered does not touch the online part')

    const mixedOver = await fulfilled(25, 4, 25, 25)
    await cashReturn(mixedOver, 3)
    await cancel(mixedOver)
    assert.equal(await due(mixedOver), 12.5, 'a cash return past the cash tendered came out of the online money')
    console.log('PASS a sale tendered partly online and partly cash: only the online part is due back online')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online order cancel cash return: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
