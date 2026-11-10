// KHQR round 2, D1: a refund note written BEFORE Fulfil reduces the money the sale may take, and stays subtracted after the sale, so the same dollars can never be
// refunded and sold. Real Worker (workerd + D1, every migration), the real staff and sales routes.
//
// Run (from cloudflare/): node scripts/test-online-order-refund-before-fulfil-native.cjs
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const METHOD = 'ABA'
let n = 0

async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Refund Serum', 12.5, 200, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(METHOD).run()

    async function paidTwice(usd = 25) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES (?, ?, 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', ?, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).bind(`LB-R${n}`, `refund-hash-${n}`, usd).run()
      const id = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      for (const part of ['A', 'B']) {
        await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
          VALUES (?, ?, 'order', ?, 'USD', 'paid', ?, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(id, `WREFUND${part}${String(n).padStart(11, '0')}`, usd, usd).run()
      }
      return id
    }
    const sale = (key, orderId, { quantity, khqr, till = 0 }) => H.createSale(h, {
      key, lines: [{ productId: 12, quantity }], status: 'completed',
      paymentDetails: [...(khqr ? [{ method: METHOD, amount_usd: khqr, amount_khr: 0 }] : []), ...(till ? [{ method: 'Cash', amount_usd: till, amount_khr: 0 }] : [])],
      extra: { online_order_id: orderId }, label: key,
    })
    const view = async (id) => (await h.call('GET', `/api/online-orders/${id}`, undefined, 'staff view')).body
    const refund = (id, amount) => h.call('POST', `/api/online-orders/${id}/refund-note`, { amount_usd: amount, reference: `ABA-${id}-${amount}` }, 'refund note')
    const sales = async () => (await h.one('SELECT COUNT(*) AS c FROM sales')).c

    const first = await paidTwice()
    assert.equal((await refund(first, 25)).status, 201, 'the excess $25 is refunded before the sale')
    const before = await view(first)
    assert.equal(before.money.available_usd, 25, 'the Worker publishes what the till may still take')
    assert.equal(before.money.refund_due_usd, 0)
    const count = await sales()
    const tooMuch = await sale('refund-fulfil-1', first, { quantity: 4, khqr: 50 })
    assert.equal(tooMuch.status, 409, JSON.stringify(tooMuch.body)); assert.equal(tooMuch.body.code, 'online_tender_mismatch')
    assert.equal(await sales(), count, 'no sale was written on the refunded money')
    const fine = await sale('refund-fulfil-2', first, { quantity: 4, khqr: 25, till: 25 })
    assert.equal(fine.status, 200, JSON.stringify(fine.body))
    const after = await view(first)
    assert.equal(after.money.refund_due_usd, 0, 'after the sale the refunded $25 is not owed again')
    assert.equal((await refund(first, 25)).body.code, 'refund_over_due', 'the same money cannot be refunded twice')
    console.log('PASS a refund note before Fulfil reduces what the sale may take and stays subtracted after it')

    const second = await paidTwice()
    assert.equal((await refund(second, 25)).status, 201)
    assert.equal((await sale('refund-fulfil-3', second, { quantity: 2, khqr: 25 })).status, 200)
    const view2 = await view(second)
    assert.equal(view2.money.refund_due_usd, 0); assert.equal((await refund(second, 25)).body.code, 'refund_over_due')
    console.log('PASS the reviewer sequence: pay twice, refund, fulfil the order total, refund due stays 0')

    const third = await paidTwice()
    assert.equal((await sale('refund-fulfil-4', third, { quantity: 2, khqr: 25 })).status, 200)
    assert.equal((await view(third)).money.refund_due_usd, 25, 'without a note the second payment is still refundable')
    assert.equal((await refund(third, 10)).status, 201); assert.equal((await view(third)).money.refund_due_usd, 15, 'a note after the sale still lowers it')
    console.log('PASS a note written after the sale lowers refund due, and the unrefunded excess is still owed')
  } finally {
    await h.mf.dispose()
  }
}
main().then(() => { console.log('online order refund before fulfil: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
