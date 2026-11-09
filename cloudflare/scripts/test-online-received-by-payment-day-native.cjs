// KHQR S6a, lead condition 2 and 3: an online order paid on day 1 and fulfilled on day 3. Money RECEIVED belongs to day 1 (PayWay's paid_at) and not again to day 3;
// revenue belongs to day 3 (the sale). Real Worker, real migrations, the reports overview the Reports page reads.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-received-by-payment-day
'use strict'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
const DAY1 = '2026-11-02', DAY2 = '2026-11-03', DAY3 = '2026-11-04'
async function main() {
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 12, 'Day Serum', 12.5, 100, 2)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method','ABA') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
      VALUES ('LB-DAY', 'day-hash', 'paid', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, 3, '${DAY1} 03:00:00', '${DAY1} 02:55:00', '${DAY1} 03:00:00')`).run()
    const orderId = (await h.one('SELECT MAX(id) id FROM online_orders')).id
    await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
      VALUES (?, 'WDAY000000000001', 'order', 25, 'USD', 'paid', 25, 'USD', '${DAY1} 03:00:00', 'QR', 1, '${DAY1} 02:55:00')`).bind(orderId).run()
    const dated = async (key, date, args) => {
      const sale = await H.createSale(h, { key, ...args })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      await h.db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').bind(`${date} 04:00:00`, sale.body.id).run()
      return sale
    }
    const cash = [{ method: 'Cash', amount_usd: 12.5, amount_khr: 0 }]
    await dated('day-cash-1', DAY1, { lines: [{ productId: 12, quantity: 1 }], paymentDetails: cash })
    await dated('day-cash-3', DAY3, { lines: [{ productId: 12, quantity: 1 }], paymentDetails: cash })
    // The Fulfil, rung on day 3.
    await dated('day-fulfil', DAY3, { lines: [{ productId: 12, quantity: 2 }], paymentDetails: [{ method: 'ABA', amount_usd: 25, amount_khr: 0 }], extra: { online_order_id: orderId } })
    assert.equal((await h.one('SELECT state FROM online_orders WHERE id = ?', orderId)).state, 'fulfilled')

    const overview = async (date) => (await h.call('GET', H.fresh(`/api/reports/overview?startDate=${date}&endDate=${date}`), undefined, `overview ${date}`)).body.sales
    const abaRow = (sales) => sales.payment_methods.find((row) => row.payment_method.toLowerCase() === 'aba')
    const d1 = await overview(DAY1), d2 = await overview(DAY2), d3 = await overview(DAY3)
    assert.equal(d1.totals.collected_total_usd, 37.5, 'day 1 received: the cash sale plus the online money paid that day')
    assert.equal(abaRow(d1).collected_usd, 25, 'day 1 KHQR row: the online money on its paid day')
    assert.equal(d1.totals.revenue_usd, 12.5, 'day 1 revenue: only its own sale (the online order is not revenue until fulfilled)')
    assert.equal(d2.totals.collected_total_usd, 0, 'day 2: nothing')
    assert.equal(d3.totals.collected_total_usd, 12.5, 'day 3 received: its cash sale only, NOT the online money again')
    assert.equal(abaRow(d3).collected_usd, 0, 'day 3 KHQR row: the fulfil tender is not received that day')
    assert.equal(d3.totals.revenue_usd, 37.5, 'day 3 revenue: the fulfilled sale and its cash sale')
    // Across the whole range the online money is counted exactly once.
    const all = (await h.call('GET', H.fresh(`/api/reports/overview?startDate=${DAY1}&endDate=${DAY3}`), undefined, 'overview range')).body.sales
    assert.equal(all.totals.collected_total_usd, 50, 'three days together: 12.5 + 12.5 + 25, once'); assert.equal(all.totals.revenue_usd, 50)
    console.log('PASS paid day 1, fulfilled day 3: received on day 1, not on day 3; revenue on day 3; the range counts it once')

    // Control: the same report with the filters the overlay cannot honour stays the kernel's own figure (a status filter).
    const filtered = (await h.call('GET', H.fresh(`/api/reports/overview?startDate=${DAY3}&endDate=${DAY3}&status=completed`), undefined, 'overview filtered')).body.sales
    assert.equal(filtered.totals.collected_total_usd, 37.5, 'a filtered view is the kernel figure, unadjusted')
    console.log('PASS control: a narrowed view (status filter) is left as the sale-dated kernel figure')

    // ---- the two report blocks: "Paid online, to fulfil" (by paid_at) and "Refunds sent through ABA" (by the Records row's date); neither is revenue.
    const before2 = await overview(DAY2)
    assert.deepEqual(before2.online, { paid_to_fulfil_orders: 0, paid_to_fulfil_usd: 0, aba_refund_count: 0, aba_refund_usd: 0 })
    await h.db.prepare(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, revision, paid_at, created_at, updated_at)
      VALUES ('LB-DAY2', 'day2-hash', 'paid', 'pickup', 1, 'Sok', '012888777', 'USD', 25, '[]', 1, 3, '${DAY2} 05:00:00', '${DAY2} 04:55:00', '${DAY2} 05:00:00')`).run()
    const day2Order = (await h.one('SELECT MAX(id) id FROM online_orders')).id
    await h.db.prepare(`INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, paid_amount, paid_currency, paid_at, qr_string, revision, created_at)
      VALUES (?, 'WDAY200000000002', 'order', 25, 'USD', 'paid', 25, 'USD', '${DAY2} 05:00:00', 'QR', 1, '${DAY2} 04:55:00')`).bind(day2Order).run()
    await h.db.prepare("INSERT INTO online_order_events (order_id, event, source, amount_usd, created_at) VALUES (?, 'refund_noted', 'staff', 10, ?)").bind(orderId, `${DAY3} 06:00:00`).run()
    const after2 = await overview(DAY2), after3 = await overview(DAY3), after1 = await overview(DAY1)
    assert.deepEqual(after2.online, { paid_to_fulfil_orders: 1, paid_to_fulfil_usd: 25, aba_refund_count: 0, aba_refund_usd: 0 }, 'day 2: one order paid and waiting to be handed over')
    assert.deepEqual(after3.online, { paid_to_fulfil_orders: 0, paid_to_fulfil_usd: 0, aba_refund_count: 1, aba_refund_usd: 10 }, 'day 3: the refund sent through ABA; the day-1 order was fulfilled, so it is not "to fulfil"')
    assert.deepEqual(after1.online, { paid_to_fulfil_orders: 0, paid_to_fulfil_usd: 0, aba_refund_count: 0, aba_refund_usd: 0 })
    // Revenue is identical before and after a paid, unfulfilled order and a refund note; the money is only RECEIVED (collected) on its paid day.
    assert.equal(after2.totals.revenue_usd, before2.totals.revenue_usd, 'revenue does not move for an order nobody has handed over'); assert.equal(after2.totals.revenue_usd, 0)
    assert.equal(after2.totals.collected_total_usd, 25, 'day 2 received the online money'); assert.equal(after3.totals.revenue_usd, d3.totals.revenue_usd)
    // A narrowed view carries no blocks (the same rule as the received overlay).
    const narrowed = (await h.call('GET', H.fresh(`/api/reports/overview?startDate=${DAY2}&endDate=${DAY2}&status=completed`), undefined, 'overview narrowed')).body.sales
    assert.equal(narrowed.online, null)
    console.log('PASS report blocks: Paid online to fulfil by paid_at, Refunds sent through ABA by date, revenue untouched, none on a narrowed view')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online received by payment day: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
// The Telegram overview's Received line carries the same rule (it is composed in the Worker, not reachable from this harness): pin the wiring so it cannot be dropped silently.
const telegramSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
assert.match(telegramSource, /received = receivedWithOnlinePaid\(received, await onlineReceivedOverlay\(env, filters\)\)/, 'Telegram overview Received calls the pure fold (tested in test-online-received-by-day-pure.cjs)')
