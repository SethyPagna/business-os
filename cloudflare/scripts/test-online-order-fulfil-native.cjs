// KHQR S6a: Fulfil. POST /api/sales with `online_order_id` on the REAL Worker (workerd + D1, every migration), driven the way the POS does. The sale is an ordinary
// version 0 sale; the order link, its Records and the sale commit in ONE batch or not at all. Each scenario names the wrong implementation it must turn red on.
//
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-fulfil
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const METHOD = 'ABA'
let n = 0

async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Fulfil Serum', 12.5, 100, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(METHOD).run()
    const employee = await h.addEmployee(960, 'fulfil_cashier', { pos: true, sales: true })

    /** A PAID order of `usd` dollars with one paid payment, as the callback would leave it. */
    async function paidOrder({ usd = 25, state = 'paid', branch = 1 } = {}) {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES (?, ?, ?, 'pickup', ?, 'Dara', '012345678', 'USD', ?, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).bind(`LB-F${n}`, `fulfil-hash-${n}`, state, branch, usd).run()
      const id = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', ?, 'USD', ?, ?, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(id, `WFULFIL${String(n).padStart(12, '0')}`, usd, state === 'review' ? 'review' : 'paid', usd).run()
      return id
    }
    const sale = (key, orderId, { quantity = 2, khqr = 25, till = 0, status = 'completed', extra = {}, cookie, actor } = {}) => H.createSale(h, {
      key, lines: [{ productId: 12, quantity }], status, cookie,
      paymentDetails: [...(khqr ? [{ method: METHOD, amount_usd: khqr, amount_khr: 0 }] : []), ...(till ? [{ method: 'Cash', amount_usd: till, amount_khr: 0 }] : [])],
      extra: { ...(orderId == null ? {} : { online_order_id: orderId }), ...(actor ? { offline_owner: { ...h.owner, actor_id: actor } } : {}), ...extra }, label: key,
    })
    const order = (id) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
    const events = async (id) => (await h.all('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', id)).map((e) => e.event)
    const sales = async () => (await h.one('SELECT COUNT(*) AS c FROM sales')).c
    const staffView = async (id) => (await h.call('GET', `/api/online-orders/${id}`, undefined, 'staff view')).body

    // ------------------------------------------------------------------------------------------------------------------------------------------ happy path
    const first = await paidOrder()
    const before = await sales()
    const done = await sale('fulfil-1', first)
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const row = await h.one('SELECT * FROM sales WHERE id = ?', done.body.id)
    assert.equal(row.payments_version, 0, 'an ordinary version 0 sale'); assert.equal(row.total_usd, 25); assert.equal(row.sale_status, 'completed')
    assert.equal((await order(first)).state, 'fulfilled'); assert.equal((await order(first)).sale_id, done.body.id); assert.equal((await order(first)).revision, 4)
    assert.deepEqual(await events(first), ['payment_recorded_on_sale', 'fulfilled'])
    assert.equal((await h.one("SELECT amount_usd, sale_id FROM online_order_events WHERE event = 'payment_recorded_on_sale' AND order_id = ?", first)).amount_usd, 25)
    assert.equal(await sales(), before + 1)
    const view = await staffView(first)
    assert.equal(view.status, 'completed'); assert.equal(view.money.refundDueUsd, 0); assert.equal(view.money.recordedOnSaleUsd, 25); assert.equal(view.money.toRecordUsd, 0)
    console.log('PASS Fulfil: one atomic batch links the order, writes both Records rows and leaves an ordinary completed version 0 sale')

    // replay: the same request id returns the receipt and writes nothing more
    const again = await sale('fulfil-1', first)
    assert.equal(again.status, 200); assert.equal(again.body.duplicate, true); assert.equal(again.body.id, done.body.id)
    assert.deepEqual(await events(first), ['payment_recorded_on_sale', 'fulfilled']); assert.equal(await sales(), before + 1)
    // a DIFFERENT request for the same (now fulfilled) order is refused and records no sale
    const second = await sale('fulfil-1b', first)
    assert.equal(second.status, 409); assert.equal(second.body.code, 'order_already_fulfilled'); assert.equal(await sales(), before + 1)
    console.log('PASS Fulfil replay returns the receipt unchanged; another request for a fulfilled order is refused with no sale')

    // ------------------------------------------------------------------------------------------------------------------------------------------ refusals
    const open = await paidOrder()
    const count = await sales()
    const mismatch = await sale('fulfil-2', open, { khqr: 20, till: 5 })
    assert.equal(mismatch.status, 409); assert.equal(mismatch.body.code, 'online_tender_mismatch'); assert.equal(await sales(), count)
    const noOrder = await sale('fulfil-3', null)
    assert.equal(noOrder.status, 400); assert.equal(noOrder.body.code, 'online_method_requires_order'); assert.equal(await sales(), count)
    const inReview = await paidOrder({ state: 'review' })
    const review = await sale('fulfil-4', inReview)
    assert.equal(review.status, 409); assert.equal(review.body.code, 'order_in_review')
    const missing = await sale('fulfil-5', 987654)
    assert.equal(missing.status, 404); assert.equal(missing.body.code, 'order_not_found')
    const badId = await sale('fulfil-6', 'abc')
    assert.equal(badId.status, 400); assert.equal(badId.body.code, 'online_order_invalid')
    const unpaid = await paidOrder({ state: 'awaiting_payment' })
    await h.db.prepare("UPDATE online_order_payments SET state = 'awaiting', paid_amount = NULL, paid_at = NULL WHERE order_id = ?").bind(unpaid).run()
    const notPaid = await sale('fulfil-7', unpaid)
    assert.equal(notPaid.status, 409); assert.equal(notPaid.body.code, 'order_not_paid')
    const otherBranch = await paidOrder({ branch: 2 })
    assert.equal((await sale('fulfil-8', otherBranch)).status, 409)
    assert.equal(await sales(), count, 'no refusal left a sale behind')
    assert.equal((await order(open)).state, 'paid'); assert.equal((await order(open)).sale_id, null)
    // staff without the online_orders view action cannot Fulfil (pos and sales are not enough)
    const denied = await sale('fulfil-9', open, { cookie: employee, actor: 960 })
    assert.equal(denied.status, 403); assert.equal((await order(open)).state, 'paid')
    console.log('PASS Fulfil refusals: tender must be the cover, the method needs an order, review/unpaid/missing/other-branch/invalid orders and a cashier without the view action are refused, each leaving no sale')

    // ------------------------------------------------------------------------------------------------------------------------------------------ different lines (Q3)
    const fewer = await paidOrder({ usd: 25 })
    const cheap = await sale('fulfil-10', fewer, { quantity: 1, khqr: 12.5 })
    assert.equal(cheap.status, 200, JSON.stringify(cheap.body))
    assert.equal((await h.one("SELECT amount_usd FROM online_order_events WHERE event = 'payment_recorded_on_sale' AND order_id = ?", fewer)).amount_usd, 12.5, 'the event states what the sale covered')
    const fewerView = await staffView(fewer)
    assert.equal(fewerView.money.refundDueUsd, 12.5, 'the lines the cashier removed are refundable through ABA'); assert.equal(fewerView.money.toRecordUsd, 12.5)
    const tooMuch = await paidOrder({ usd: 25 })
    assert.equal((await sale('fulfil-11', tooMuch, { quantity: 1, khqr: 25 })).body.code, 'online_tender_mismatch', 'the tender may not exceed what the sale is worth')
    const more = await paidOrder({ usd: 25 })
    const dearer = await sale('fulfil-12', more, { quantity: 3, khqr: 25, status: 'awaiting_payment' })
    assert.equal(dearer.status, 200, JSON.stringify(dearer.body))
    const dearerView = await staffView(more)
    assert.equal(dearerView.status, 'balance_due'); assert.equal(dearerView.money.balanceDueUsd, 12.5); assert.equal(dearerView.money.refundDueUsd, 0)
    const withTill = await paidOrder({ usd: 25 })
    assert.equal((await sale('fulfil-13', withTill, { quantity: 3, khqr: 25, till: 12.5 })).status, 200, 'the extra can be paid at the till at once')
    assert.equal((await staffView(withTill)).status, 'completed')
    console.log('PASS Fulfil with other lines: fewer lines record less and leave refund due, more lines are the sale\'s Not Paid balance or paid at the till')

    // ------------------------------------------------------------------------------------------------------------------------------------------ the race
    const raced = await paidOrder()
    const before2 = await sales()
    const [a, b] = await Promise.all([sale('fulfil-race-a', raced), sale('fulfil-race-b', raced)])
    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 409], `exactly one Fulfil wins: ${JSON.stringify([a.body.code, b.body.code])}`)
    assert.ok(['order_already_fulfilled', 'online_order_changed'].includes((a.status === 409 ? a : b).body.code))
    assert.equal(await sales(), before2 + 1, 'the loser left NO sale behind (atomic)')
    assert.equal((await h.one("SELECT COUNT(*) c FROM online_order_events WHERE order_id = ? AND event = 'payment_recorded_on_sale'", raced)).c, 1)
    console.log('PASS two cashiers Fulfilling the same order at once: one sale, one link, one set of Records')

    // ------------------------------------------------------------------------------------------------------------------------------------------ plain sales are untouched
    const plain = await H.createSale(h, { key: 'plain-1', lines: [{ productId: 12, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }], label: 'plain' })
    assert.equal(plain.status, 200, JSON.stringify(plain.body))
    assert.equal((await h.one("SELECT COUNT(*) c FROM online_order_events")).c, (await h.one("SELECT COUNT(*) c FROM online_order_events WHERE order_id IN (SELECT id FROM online_orders WHERE sale_id IS NOT NULL)")).c, "a plain sale writes no online order Record")
    // call-count parity of a plain sale is pinned by test-call-counting-parity-native, which this change leaves green
    console.log('PASS a plain sale is unchanged (no online_order_id, no extra statement)')
  } finally {
    await h.mf.dispose()
  }
}
main().then(() => { console.log('online order fulfil: ok'); process.exit(0) }).catch((error) => { console.error(error); process.exit(1) })
