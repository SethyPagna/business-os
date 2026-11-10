// KHQR S6b: a customer return refunded THROUGH ABA (returns.refund_channel = 'aba') on a sale that fulfilled an online order. Owner ruling 10 Nov 2026: shifts are only for
// understanding, so the refund moves the refunded / revenue figures and the Reports block of ABA refunds, and NEVER a drawer figure. The block reads two disjoint sources
// (refund_noted notes and these returns): the return writes no refund_noted Record, so nothing counts twice.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-order-aba-refund
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
let n = 0
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Refund Serum', 12.5, 100, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const noRefundRight = await h.addEmployee(970, 'aba_returner', { pos: true, sales: true, returns: true, online_orders: true, 'online_orders:refund': false })
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 0 }, 'open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body))
    const drawer = async () => { await new Promise((r) => setTimeout(r, 1100)); return (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'drawer', { observe: true })).body.shift.reconciliation }
    const overview = async () => (await h.call('GET', H.fresh('/api/reports/overview?startDate=2020-01-01&endDate=2099-12-31'), undefined, 'overview')).body.sales
    async function linkedSale() {
      n += 1
      await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
        VALUES ('LB-R${n}', 'aba-refund-${n}', 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, 3, '2026-11-09 03:00:00', '2026-11-09 02:55:00', '2026-11-09 03:00:00')`).run()
      const orderId = (await h.one('SELECT MAX(id) id FROM online_orders')).id
      await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
        VALUES (?, ?, 'order', 25, 'USD', 'paid', 25, 'USD', '2026-11-09 03:00:00', 'QR', 1, '2026-11-09 02:55:00')`).bind(orderId, `WABAREF${String(n).padStart(9, '0')}`).run()
      const made = await H.createSale(h, { key: `aba-refund-sale-${n}`, lines: [{ productId: 12, quantity: 2 }], paymentDetails: [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }], extra: { online_order_id: orderId } })
      assert.equal(made.status, 200, JSON.stringify(made.body))
      const item = await h.one('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', made.body.id)
      return { saleId: made.body.id, orderId, itemId: item.id }
    }
    const ret = (s, key, extra, quantity = 1, cookie) => H.customerReturn(h, { key, saleId: s.saleId, lines: [{ saleItemId: s.itemId, productId: 12, quantity }], extra, cookie })
    const refundNotes = async () => (await h.one("SELECT COUNT(*) c FROM online_order_events WHERE event = 'refund_noted'")).c

    const s = await linkedSale()
    const drawerBefore = await drawer()
    const overviewBefore = await overview()

    // ---- the ABA refund: $12.50 of the $25 paid online
    const first = await ret(s, 'aba-ret-1', { refund_channel: 'aba' })
    assert.equal(first.created.status, 200, JSON.stringify(first.created.body))
    const row = await h.one('SELECT refund_channel, refund_currency, total_refund_usd, owed_reduction_usd FROM returns WHERE sale_id = ?', s.saleId)
    assert.equal(row.refund_channel, 'aba'); assert.equal(row.refund_currency, 'USD'); assert.equal(row.total_refund_usd, 12.5)
    assert.equal(await refundNotes(), 0, 'the return writes NO refund_noted Record (one source per refund)')
    const drawerAfter = await drawer()
    assert.deepEqual(drawerAfter, drawerBefore, 'a refund through ABA moves no drawer figure at all')
    const overviewAfter = await overview()
    assert.equal(overviewAfter.totals.refund_usd, Number(overviewBefore.totals.refund_usd) + 12.5, 'the refunded figure moves')
    assert.equal(overviewAfter.totals.revenue_usd, Number(overviewBefore.totals.revenue_usd) - 12.5, 'so does revenue')
    assert.deepEqual([overviewAfter.online.aba_refund_count, overviewAfter.online.aba_refund_usd], [1, 12.5], 'the Reports block counts the return once')
    console.log('PASS an ABA refund return: channel stored, no Record written, drawer untouched, refunded and revenue move, the Reports block counts it once')

    // ---- control: the same return WITHOUT the channel on a plain cash sale DOES take cash out of the drawer (the instrument can tell the two apart)
    const cashSale = await H.createSale(h, { key: 'aba-ref-cash-sale', lines: [{ productId: 12, quantity: 2 }], paymentDetails: [{ method: 'Cash', amount_usd: 25, amount_khr: 0 }] })
    const cashItem = await h.one('SELECT id FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', cashSale.body.id)
    const beforeCash = await drawer()
    const cashReturn = await H.customerReturn(h, { key: 'aba-ret-cash', saleId: cashSale.body.id, lines: [{ saleItemId: cashItem.id, productId: 12, quantity: 1 }] })
    assert.equal(cashReturn.created.status, 200, JSON.stringify(cashReturn.created.body))
    const afterCash = await drawer()
    assert.notDeepEqual(afterCash, beforeCash, 'control: a cash refund does move the drawer')
    console.log('PASS control: the same return without the channel moves the drawer')

    // ---- the block reads two disjoint sources: a staff note adds one, never two
    await h.db.prepare("INSERT INTO online_order_events (order_id, event, source, amount_usd) VALUES (?, 'refund_noted', 'staff', 5)").bind(s.orderId).run()
    const union = (await overview()).online
    assert.deepEqual([union.aba_refund_count, union.aba_refund_usd], [2, 17.5], 'one return + one note = two refunds, 17.50')
    console.log('PASS the ABA refunds block is the return plus the staff note, each once')

    // ---- guards
    const plain = await H.customerReturn(h, { key: 'aba-ret-plain', saleId: cashSale.body.id, lines: [{ saleItemId: cashItem.id, productId: 12, quantity: 1 }], extra: { refund_channel: 'aba' } })
    assert.equal(plain.created.status, 400, JSON.stringify(plain.created.body)); assert.equal(plain.created.body.code, 'refund_channel_requires_online_order')
    // $12.50 already went back through ABA and $5 was noted: only $7.50 of the $25 is left, so another $12.50 is refused
    const over = await ret(s, 'aba-ret-over', { refund_channel: 'aba' })
    assert.equal(over.created.status, 409, JSON.stringify(over.created.body)); assert.equal(over.created.body.code, 'aba_refund_over_online')
    const khr = await ret(s, 'aba-ret-khr', { refund_channel: 'aba', refund_currency: 'KHR' })
    assert.ok(khr.created.status >= 400, 'ABA refunds are dollars: ' + JSON.stringify(khr.created.body))
    const bad = await ret(s, 'aba-ret-bad', { refund_channel: 'wing' })
    assert.ok(bad.created.status >= 400, 'only aba is a channel')
    const denied = await ret(await linkedSale(), 'aba-ret-denied', { refund_channel: 'aba' }, 1, noRefundRight)
    assert.equal(denied.created.status, 403, 'a returns user without the online order refund action cannot send a refund through ABA: ' + JSON.stringify(denied.created.body))
    assert.equal((await h.one("SELECT COUNT(*) c FROM returns WHERE refund_channel = 'aba'")).c, 1, 'every refusal wrote nothing')
    console.log('PASS guards: a sale with no online order, more than is left online, riel, an unknown channel and a user without the refund action are all refused with nothing written')

    // ---- security review F7: the cap is re-proved INSIDE the return's batch. A staff refund note lands between the return's preflight read and its batch (a trigger on the
    // batch's first guard row stands in for the second staff member); the preflight said yes, the batch must say no, and nothing is written.
    const raced = await linkedSale()
    await h.db.prepare(`CREATE TRIGGER f7_race AFTER INSERT ON system_flags WHEN NEW.key = 'stock_transaction_permit' AND NOT EXISTS (SELECT 1 FROM online_order_events WHERE reference = 'F7-RACE')
      BEGIN INSERT INTO online_order_events (order_id, event, source, amount_usd, reference, sale_id) VALUES (${raced.orderId}, 'refund_noted', 'staff', 20, 'F7-RACE', ${raced.saleId}); END`).run()
    const returnsBefore = (await h.one('SELECT COUNT(*) c FROM returns')).c
    const lost = await ret(raced, 'aba-ret-f7', { refund_channel: 'aba' })
    await h.db.prepare('DROP TRIGGER f7_race').run()
    // (the competing note is rolled back with the refused batch, so the 409 itself is the proof that the race happened: without the trigger the same return succeeds, as the guards above show)
    assert.equal(lost.created.status, 409, JSON.stringify(lost.created.body)); assert.ok(['aba_refund_over_online', 'write_conflict'].includes(lost.created.body.code), 'a real competitor commits first, so the route re-plans and says aba_refund_over_online; here the trigger note rolls back with the batch and it says write_conflict')
    assert.equal((await h.one('SELECT COUNT(*) c FROM returns')).c, returnsBefore, 'the refused return left nothing behind')
    console.log('PASS (F7) an ABA return that lost the race with a refund note is refused inside its own batch (409), nothing written')

    // ---- amendment down: lowering a line of a Fulfilled sale leaves the customer a refund due through ABA, and the staff Orders screens refresh
    const kv = await h.mf.getKVNamespace('CACHE')
    const version = async () => await kv.get('v2:online_orders')
    const amended = await linkedSale()
    const drawerPre = await drawer()
    const dueBefore = (await h.call('GET', H.fresh('/api/online-orders/' + amended.orderId), undefined, 'order before')).body.money.refundDueUsd
    const v0 = await version()
    const down = await H.amendSale(h, amended.saleId, { kind: 'line_quantity_decreased', client_request_id: 'aba-amend-down', sale_item_id: amended.itemId, quantity: 1 })
    assert.equal(down.status, 200, JSON.stringify(down.body))
    for (let i = 0; i < 40 && (await version()) === v0; i += 1) await new Promise((r) => setTimeout(r, 50))
    assert.notEqual(await version(), v0, 'an amendment of a linked sale refreshes the online order screens')
    const dueAfter = (await h.call('GET', H.fresh('/api/online-orders/' + amended.orderId), undefined, 'order after')).body.money.refundDueUsd
    assert.equal(dueBefore, 0); assert.equal(dueAfter === 12.5 ? 12.5 : dueAfter, 12.5, 'one line of two came off: half of what was paid online is due back')
    assert.deepEqual(await drawer(), drawerPre, 'lowering a line of an online-paid sale does not hand change out of any drawer')
    // And that refund goes out through ABA as a return with the channel, which fits in what is left.
    const pay = await ret(amended, 'aba-after-amend', { refund_channel: 'aba' }, 1)
    assert.ok(pay.created.status < 500, JSON.stringify(pay.created.body))
    console.log('PASS amendment down: the order shows the refund due (12.50), the screens refresh')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online order aba refund: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
