// KHQR S4 lifecycle fixes (audit AUDIT-KHQR.md, S4 list): money that arrives where the order did not expect it, orders that would stick, late payments
// whose callback was lost, restore maintenance, PayWay timeouts, the callback throttle. Through the REAL route, store, sweep and migration chain with
// PayWay scripted. Each scenario names the wrong implementation it turns red on; the mutation run is recorded in LANE-KHQR.md.
//
// Run: node scripts/test-online-order-lifecycle-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createOrdersHarness } = require('./harness/load_portal_orders_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.log(`FAIL ${name}`); throw error }
}
const T0 = Date.UTC(2026, 10, 9, 3, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
// The callback route's D1 calls with the real notifier and Telegram configured (measured 7 inside the route, middleware not included), plus a little.
const CALLBACK_D1_CEILING = 10

function world(options = {}) {
  const h = createOrdersHarness({ switchOn: true, spreadNetworks: true, nowMs: T0, ...options })
  h.run("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  seedStockFixture(h.raw.db, () => {
    const id = Number(h.run('INSERT INTO products (name, selling_price_usd, selling_price_khr, is_active, stock_quantity) VALUES (?, ?, ?, 1, 50)', 'Serum', 12.5, 50000).lastInsertRowid)
    h.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 1, 50)', id)
  })
  return h
}
let phoneSeq = 0
const place = async (h, over = {}) => {
  const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: `0${12000000 + (phoneSeq += 1)}`, fulfilment: 'pickup', ...over })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res
}
const payment = (h, id = 1) => h.one('SELECT * FROM online_order_payments WHERE id = ?', id)
const order = (h, id = 1) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const events = (h, id = 1) => h.all('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', id).map((e) => e.event)
const countOf = (h, op) => h.calls.filter((c) => c.op === op).length
const rowsOf = (h) => ({ o: h.one('SELECT COUNT(*) n FROM online_orders').n, p: h.one('SELECT COUNT(*) n FROM online_order_payments').n, e: h.one('SELECT COUNT(*) n FROM online_order_events').n, rev: h.all('SELECT revision FROM online_orders').map((r) => r.revision).join() + '|' + h.all('SELECT revision, last_checked_at FROM online_order_payments').map((r) => `${r.revision}:${r.last_checked_at}`).join() })
const money = (h, id = 1) => h.orders.orderMoney(order(h, id), h.all('SELECT * FROM online_order_payments WHERE order_id = ?', id), h.all('SELECT * FROM online_order_events WHERE order_id = ?', id), null)
const short = (amount) => () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: amount } })
const declined = () => ({ status: { code: '0' }, data: { payment_status_code: 3, original_amount: 25 } })
// A second QR that ABA still accepts for the same order (an edit that did not close the first, or a retry that raced): one more awaiting payment with a QR.
const secondLiveQr = (h, tran = 'WSECONDQR0000000001') => h.run(
  "INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, qr_string, expires_at, revision, created_at) VALUES (1, ?, 'order', 25, 'USD', 'awaiting', '000201SECOND', '2026-11-09 03:15:00', 0, '2026-11-09 03:00:00')", tran)

async function main() {
  // ------------------------------------------------------------------------------------------------------------ 2: siblings
  await check('paying one QR closes every live sibling QR at ABA, exactly once each, and cancels them in the same commit (a wrong build leaves the other QR payable)', async () => {
    const h = world(); await place(h); secondLiveQr(h); secondLiveQr(h, 'WTHIRDQR00000000002')
    h.script.check = () => h.approved(25)
    h.calls.length = 0
    await h.callback(payment(h, 1).tran_id)
    assert.equal(order(h).state, 'paid')
    const closes = h.calls.filter((c) => c.op === 'close').map((c) => c.body.tran_id).sort()
    assert.deepEqual(closes, ['WSECONDQR0000000001', 'WTHIRDQR00000000002'], 'one close per sibling, none for the paid payment')
    assert.deepEqual([2, 3].map((i) => payment(h, i).state), ['cancelled', 'cancelled'])
    h.calls.length = 0; h.advance(MIN); await h.callback(payment(h, 1).tran_id); await h.sweep()
    assert.equal(countOf(h, 'close'), 0, 'a replay closes nothing again')
  })

  await check('a sibling without an issued QR is not closed (nothing exists at ABA), and a failed close never undoes the payment', async () => {
    const h = world(); await place(h)
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, revision, created_at) VALUES (1, 'WNOQR00000000000003', 'order', 25, 'USD', 'awaiting', 0, '2026-11-09 03:00:00')")
    h.script.check = () => h.approved(25); h.script.close = () => { throw new Error('socket hang up') }
    h.calls.length = 0
    await h.callback(payment(h, 1).tran_id)
    assert.equal(countOf(h, 'close'), 0); assert.equal(order(h).state, 'paid'); assert.equal(payment(h, 2).state, 'cancelled')
    const h2 = world(); await place(h2); secondLiveQr(h2)
    h2.script.check = () => h2.approved(25); h2.script.close = () => { throw new Error('socket hang up') }
    await h2.callback(payment(h2, 1).tran_id)
    assert.equal(order(h2).state, 'paid', 'best effort: the QR expires on its own')
  })

  await check('a lost race announces nothing: a stale twin applying the same approval changes no row and fires no notice (a wrong build announces on noop)', async () => {
    const h = world(); await place(h)
    const stale = payment(h); const staleOrder = order(h)
    h.script.check = () => h.approved(25)
    await h.callback(stale.tran_id)
    assert.equal(order(h).state, 'paid')
    const seen = []
    const twin = h.deps({ notify: async (event) => { seen.push(event.kind) } })
    const check = await h.paywayModule.checkTransaction(h.transportOf, h.credentials(), new Date(T0), stale.tran_id).catch(() => null)
    void check
    const approved = { ok: true, state: 'approved', originalAmount: 25, totalAmount: 25, discountAmount: 0, paymentAmount: 25, refundAmount: null, paymentCurrency: 'USD', apv: 'APV123', transactionDate: null, bankRef: null, paymentType: null, bankName: null }
    const before = rowsOf(h)
    const outcome = await h.store.applyCheckResult(twin, { id: 1, state: staleOrder.state }, stale, approved, 'payway', null)
    assert.equal(outcome, 'noop'); assert.deepEqual(seen, []); assert.deepEqual(rowsOf(h), before)
    // the first writer's own announcement fires exactly once
    const h2 = world(); await place(h2); const seen2 = []
    const p2 = payment(h2)
    assert.equal(await h2.store.applyCheckResult(h2.deps({ notify: async (event) => { seen2.push(event.kind) } }), { id: 1, state: 'awaiting_payment' }, p2, approved, 'payway', null), 'paid')
    assert.deepEqual(seen2, ['paid'])
  })

  // ------------------------------------------------------------------------------------------------------------ 3: review money
  await check('$20 paid on a $25 order: the payment keeps what PayWay took (amount, currency, APV, bank fields), the money read counts it, cancelling makes it refundable', async () => {
    const h = world(); await place(h)
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20, total_amount: 20, apv: 'APVREV', bank_ref: 'BANKREF9', payment_type: 'KHQR', bank_name: 'ACLEDA' } })
    await h.callback(payment(h).tran_id)
    const p = payment(h)
    assert.equal(p.state, 'review'); assert.equal(p.paid_amount, 20); assert.equal(p.paid_currency, 'USD'); assert.equal(p.payway_apv, 'APVREV'); assert.equal(p.paid_at, null)
    assert.equal(p.payway_bank_ref, 'BANKREF9'); assert.equal(p.payway_payment_type, 'KHQR'); assert.equal(p.payway_bank_name, 'ACLEDA')
    assert.equal(order(h).state, 'review')
    assert.equal(money(h).heldInReviewUsd, 20); assert.equal(money(h).onlineInUsd, 0)
    h.run("UPDATE online_orders SET state = 'cancelled' WHERE id = 1")
    assert.equal(money(h).refundDueUsd, 20, 'the money PayWay took is refundable')
  })

  await check('a refunded or discounted answer holds only what was actually taken (a refunded check holds 0; a discount holds the discounted total)', async () => {
    const h = world(); await place(h)
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 4, original_amount: 25, total_amount: 25 } })
    await h.callback(payment(h).tran_id)
    assert.equal(payment(h).state, 'review'); assert.equal(payment(h).paid_amount, 0)
    const d = world(); await place(d)
    d.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 25, discount_amount: 5, total_amount: 20 } })
    await d.callback(payment(d).tran_id)
    assert.equal(payment(d).state, 'review'); assert.equal(payment(d).paid_amount, 20)
  })

  await check('a payment held in review is never flipped to paid by a later matching check (staff resolve it): the mutant that allows review -> paid pays an order whose price changed', async () => {
    const h = world(); const res = await place(h)
    const first = payment(h).tran_id
    await h.request(`/${res.body.token}/edit`, 'POST', { lines: [{ product_id: 1, quantity: 3 }] })
    h.script.check = () => h.approved(25)
    await h.callback(first)
    assert.equal(payment(h, 1).state, 'review')
    h.advance(MIN); await h.callback(first)
    h.advance(20 * MIN); await h.sweep()
    assert.equal(payment(h, 1).state, 'review', 'still held')
    assert.notEqual(order(h).state, 'paid', 'the order was not paid by the old QR')
    // and the row guard holds on its own, whoever calls it: applying a matching approval to a payment already held in review changes nothing
    const approvedCheck = { ok: true, state: 'approved', originalAmount: 25, totalAmount: 25, discountAmount: 0, paymentAmount: 25, refundAmount: null, paymentCurrency: 'USD', apv: 'APV123', transactionDate: null, bankRef: null, paymentType: null, bankName: null }
    const before = rowsOf(h)
    assert.equal(await h.store.applyCheckResult(h.deps({ notify: async () => {} }), { id: 1, state: order(h).state }, payment(h, 1), approvedCheck, 'payway', null), 'noop')
    assert.equal(payment(h, 1).state, 'review'); assert.deepEqual(rowsOf(h), before)
  })

  // ------------------------------------------------------------------------------------------------------------ 4: expired -> review, top-up
  await check('a late mismatch on an EXPIRED order moves it to review and into the attention index; a top-up mismatch raises the chip with the order staying paid', async () => {
    const h = world(); await place(h)
    h.advance(20 * MIN); h.script.check = () => h.pending(); await h.sweep()
    assert.equal(order(h).state, 'expired')
    h.script.check = short(20)
    h.advance(MIN); await h.callback(payment(h).tran_id)
    assert.equal(order(h).state, 'review'); assert.equal(payment(h).state, 'review'); assert.equal(payment(h).paid_amount, 20)
    const mismatch = h.one("SELECT * FROM online_order_events WHERE event = 'mismatch'"); assert.equal(mismatch.from_state, 'expired'); assert.equal(mismatch.to_state, 'review')
    const attention = h.all("SELECT id FROM online_orders INDEXED BY idx_online_orders_attention WHERE state IN ('paid','review')").map((r) => r.id)
    assert.deepEqual(attention, [1], 'staff can find it')
    const view = h.orders.onlineOrderView(order(h), h.all('SELECT * FROM online_order_payments'), h.all('SELECT * FROM online_order_events'), null)
    assert.ok(view.chips.includes('needs_review'))
    // top-up
    const t = world(); await place(t); t.script.check = () => t.approved(25); await t.callback(payment(t).tran_id)
    t.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, created_at) VALUES (1, 'items', 'paid', '{}', '{}', '2026-11-09 03:01:00')")
    t.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, qr_string, expires_at, revision, created_at) VALUES (1, 'WTOPUP0000000000001', 'top_up', 1, 5, 'USD', 'awaiting', '000201TOP', '2026-11-09 03:20:00', 0, '2026-11-09 03:05:00')")
    t.script.check = short(3); t.advance(MIN)
    await t.callback('WTOPUP0000000000001')
    assert.equal(order(t).state, 'paid', 'the order itself stays paid'); assert.equal(payment(t, 2).state, 'review'); assert.equal(payment(t, 2).paid_amount, 3)
    const v2 = t.orders.onlineOrderView(order(t), t.all('SELECT * FROM online_order_payments'), t.all('SELECT * FROM online_order_events'), null)
    assert.ok(v2.chips.includes('needs_review'), 'a mismatched top-up is visible')
    assert.equal(money(t).heldInReviewUsd, 3)
  })

  // ------------------------------------------------------------------------------------------------------------ 5: no stuck orders
  await check('a declined check on the only payment ends the order in qr_failed (never "awaiting" for ever); after the lifetime plus grace the sweep expires it with one Records row', async () => {
    const h = world(); const res = await place(h)
    h.advance(2 * MIN); h.script.check = declined
    await h.callback(payment(h).tran_id)
    assert.equal(payment(h).state, 'failed'); assert.equal(order(h).state, 'qr_failed')
    assert.deepEqual(events(h), ['created', 'qr_issued', 'note', 'qr_failed'])
    const before = rowsOf(h).e; h.advance(MIN); await h.callback(payment(h).tran_id)
    assert.equal(rowsOf(h).e, before, 'a replay adds no Records row'); assert.equal(order(h).state, 'qr_failed')
    let s = await h.sweep(); assert.equal(s.qrFailedExpired, 0, 'inside the lifetime')
    h.advance(15 * MIN + 119_000 - MIN); s = await h.sweep(); assert.equal(s.qrFailedExpired, 0, 'inside the grace (counted from the decline, one minute of it already passed)')
    h.advance(2_000); s = await h.sweep()
    assert.equal(s.qrFailedExpired, 1); assert.equal(order(h).state, 'expired')
    assert.equal(events(h).filter((e) => e === 'expired').length, 1)
    const again = await h.sweep(); assert.equal(again.qrFailedExpired, 0)
    assert.equal(events(h).filter((e) => e === 'expired').length, 1)
    // an expired order can get a new QR (the customer's "Get a new QR")
    const retry = await h.request(`/${res.body.token}/retry`, 'POST', {})
    assert.ok([200, 201].includes(retry.status), JSON.stringify(retry.body))
  })

  await check('a declined payment does not strand an order that has a newer live QR, and a declined top-up never fails the order', async () => {
    const h = world(); await place(h); secondLiveQr(h)
    h.script.check = declined
    await h.callback(payment(h, 1).tran_id)
    assert.equal(payment(h, 1).state, 'failed'); assert.equal(order(h).state, 'awaiting_payment', 'another QR is still live')
    const t = world(); await place(t); t.script.check = () => t.approved(25); await t.callback(payment(t).tran_id)
    t.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json, created_at) VALUES (1, 'items', 'paid', '{}', '{}', '2026-11-09 03:01:00')")
    t.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, qr_string, expires_at, revision, created_at) VALUES (1, 'WTOPUP0000000000009', 'top_up', 1, 5, 'USD', 'awaiting', '000201TOP', '2026-11-09 03:20:00', 0, '2026-11-09 03:05:00')")
    t.script.check = declined; t.advance(MIN); await t.callback('WTOPUP0000000000009')
    assert.equal(order(t).state, 'paid'); assert.equal(payment(t, 2).state, 'failed')
  })

  await check('an order whose QR never started (qr_failed at creation) also expires after the lifetime plus grace', async () => {
    const h = world(); h.script.generate = () => ({ status: { code: '5' } })
    const res = await h.request('/', 'POST', { lines: [{ product_id: 1, quantity: 2 }], name: 'Dara', phone: '012700001', fulfilment: 'pickup' })
    assert.equal(res.status, 502); assert.equal(order(h).state, 'qr_failed')
    h.advance(15 * MIN + 121_000)
    const s = await h.sweep(); assert.equal(s.qrFailedExpired, 1); assert.equal(order(h).state, 'expired')
  })

  // ------------------------------------------------------------------------------------------------------------ 6: late money without a callback
  await check('late money without a callback: an expired payment approved 30 minutes after expiry is found by the next tick (late_paid); the interval, the window and the budget are the plan\'s', async () => {
    const h = world(); await place(h)
    h.advance(20 * MIN); h.script.check = () => h.pending(); await h.sweep()
    assert.equal(order(h).state, 'expired')
    h.advance(30 * MIN); h.script.check = () => h.approved(25)
    h.calls.length = 0
    const s = await h.sweep()
    assert.equal(s.late, 1); assert.equal(s.paid, 1)
    assert.equal(order(h).state, 'paid'); assert.equal(payment(h).state, 'paid'); assert.ok(events(h).includes('late_paid'))
    assert.equal(h.one("SELECT source FROM online_order_events WHERE event = 'late_paid'").source, 'sweep')
  })

  await check('the late re-check asks each expired payment at most once per plan interval (Paid 10 min, Free 30), only inside the plan window (Paid 72 h, Free 24), within the tick budget', async () => {
    const h = world(); await place(h)
    h.advance(20 * MIN); h.script.check = () => h.pending(); await h.sweep()
    h.calls.length = 0
    h.advance(5 * MIN); await h.sweep()
    assert.equal(countOf(h, 'check'), 0, 'inside the interval nothing is asked (expiry stamps the check time)')
    h.advance(6 * MIN); let s = await h.sweep()
    assert.equal(s.late, 1, 'after the 10 minutes the paid plan allows'); assert.equal(countOf(h, 'check'), 1)
    h.advance(5 * MIN); await h.sweep(); assert.equal(countOf(h, 'check'), 1, 'asked once per interval, not once per tick')
    h.advance(73 * HOUR); await h.sweep(); assert.equal(countOf(h, 'check'), 1, 'older than the window: never asked again')
    // Free: 30-minute interval, 24-hour window
    const f = world({ env: { PLAN_TIER: 'free' } }); await place(f)
    f.advance(20 * MIN); f.script.check = () => f.pending(); await f.sweep(); f.calls.length = 0
    f.advance(11 * MIN); await f.sweep(); assert.equal(countOf(f, 'check'), 0, 'Free waits the longer 30 minutes')
    f.advance(20 * MIN); await f.sweep(); assert.equal(countOf(f, 'check'), 1)
    f.advance(25 * HOUR); await f.sweep(); assert.equal(countOf(f, 'check'), 1, 'Free window is 24 hours')
    // budget: with the batch used up by overdue payments, late checks wait
    const b = world({ env: { PLAN_TIER: 'free' } })
    for (let i = 0; i < 6; i += 1) await place(b)
    b.advance(20 * MIN); b.script.check = () => b.pending()
    const first = await b.sweep(); assert.equal(first.checked, 5); assert.equal(first.late, 0, 'the awaiting payments used the whole Free budget')
  })

  // ------------------------------------------------------------------------------------------------------------ 7: maintenance
  await check('while a maintenance hold is set, the GET status nudge does 0 writes and 0 PayWay calls; without it the same poll nudges (a wrong build writes during a restore)', async () => {
    const h = world(); const res = await place(h); const token = res.body.token
    h.advance(2 * MIN); h.script.check = () => h.pending()
    h.run("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
    h.run("INSERT INTO system_flags (key, value, updated_at) VALUES ('maintenance', ?, CURRENT_TIMESTAMP)", JSON.stringify({ mode: 'restore', token: 't', backupKey: 'b', startedAt: '2026-11-09T03:00:00Z', startedBy: 'a', updatedAt: '2026-11-09T03:00:00Z', phase: 'running' }))
    h.calls.length = 0
    const before = rowsOf(h)
    h.clearStatements()
    const during = await h.request(`/${token}/status`, 'GET')
    assert.equal(during.status, 200)
    assert.equal(h.calls.length, 0, 'no PayWay call'); assert.deepEqual(rowsOf(h), before, 'no write')
    assert.ok(!h.statements.some((s) => /^(UPDATE|INSERT|DELETE)/i.test(s)), 'not even a claim')
    h.run("DELETE FROM system_flags WHERE key = 'maintenance'")
    h.run("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
    h.advance(MIN)
    await h.request(`/${token}/status`, 'GET')
    assert.equal(countOf(h, 'check'), 1, 'the same poll nudges once the hold is gone')
  })

  // ------------------------------------------------------------------------------------------------------------ 8: transport, throttle, header
  await check('the PayWay transport gives up after the plan timeout, the credentials carry it, and a hung call never outlives it', async () => {
    const h = world()
    const creds = h.credentials()
    assert.equal(creds.timeoutMs, 8000); assert.equal(h.paywayModule.paywayCredentials(h.env).timeoutMs, undefined, 'lib/payway.ts stays free of the plan: the config module attaches it')
    const seen = []
    const transport = h.load('lib/paywayTransport.ts').fetchPaywayTransport
    const realFetch = global.fetch
    const keepAlive = setInterval(() => {}, 20) // AbortSignal.timeout timers are unref'd: without this the test process would exit while it waits
    global.fetch = (url, init) => new Promise((resolve, reject) => {
      seen.push(init.signal ? 'signal' : 'none')
      if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
    try {
      const started = Date.now()
      await assert.rejects(transport({ url: 'https://payway.invalid/check', body: { a: 1 }, timeoutMs: 60 }))
      assert.ok(Date.now() - started < 3000, 'cut off by the timeout')
      assert.deepEqual(seen, ['signal'])
      // through the PayWay client the abort becomes the fixed reason word, never a thrown URL
      const failed = await h.paywayModule.checkTransaction(transport, { ...creds, timeoutMs: 40 }, new Date(T0), 'WHUNG0000000000001').then(() => 'ok', (e) => e.reason)
      assert.equal(failed, 'transport_failed')
    } finally { global.fetch = realFetch; clearInterval(keepAlive) }
    assert.equal(h.credentials({ env: { PLAN_TIER: 'free' } }).timeoutMs, 8000)
  })

  await check('callback throttle: five valid callbacks within seconds cost ONE PayWay call; the next interval asks again (a wrong build spends a call per callback)', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    h.script.check = () => h.pending(); h.calls.length = 0
    for (let i = 0; i < 5; i += 1) { h.advance(2_000); assert.equal((await h.callback(tran)).status, 200) }
    assert.equal(countOf(h, 'check'), 1)
    h.advance(20_000); await h.callback(tran)
    assert.equal(countOf(h, 'check'), 2)
    // and the throttle is shared with the poll and the sweep claim: a payment just checked by the poll is not asked again by the callback
    const g = world(); const r = await place(g); g.advance(2 * MIN); g.script.check = () => g.pending(); g.calls.length = 0
    await g.request(`/${r.body.token}/status`, 'GET'); assert.equal(countOf(g, 'check'), 1)
    await g.callback(payment(g).tran_id); assert.equal(countOf(g, 'check'), 1, 'one shared interval')
  })

  await check('the callback logs only whether the signature header was present, never its value', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    const lines = []
    const realLog = console.log
    console.log = (...args) => { lines.push(args.join(' ')) }
    try {
      await h.callback(tran, { headers: { 'x-payway-hmac-sha512': 'SECRETSIGNATUREVALUE' } })
      await h.callback(tran)
    } finally { console.log = realLog }
    const marks = lines.filter((l) => l.includes('signature header'))
    assert.deepEqual(marks.map((l) => l.split('signature header ')[1]), ['present', 'absent'])
    assert.ok(!lines.join('\n').includes('SECRETSIGNATUREVALUE'))
  })

  // ------------------------------------------------------------------------------------------------------------ 8: live refresh
  await check('every committed transition bumps the online_orders data version and broadcasts once; a replay bumps nothing (a wrong build bumps per check)', async () => {
    const h = world(); const res = await place(h)
    assert.deepEqual(h.bumps, ['online_orders']); assert.equal(h.broadcasts.length, 1); assert.equal(h.broadcasts[0].channel, 'onlineOrders')
    h.bumps.length = 0; h.broadcasts.length = 0
    h.script.check = () => h.approved(25)
    const tran = payment(h).tran_id
    await h.callback(tran)
    assert.deepEqual(h.bumps, ['online_orders']); assert.equal(h.broadcasts.length, 1)
    h.bumps.length = 0; h.broadcasts.length = 0
    h.advance(MIN); await h.callback(tran); await h.callback(tran); await h.sweep()
    assert.equal(h.bumps.length, 0, 'a replay bumps nothing'); assert.equal(h.broadcasts.length, 0)
    // each customer change moves the screens too
    const e = world(); const r2 = await place(e); e.bumps.length = 0
    await e.request(`/${r2.body.token}/edit`, 'POST', { name: 'Dara Two' }); assert.equal(e.bumps.length, 1)
    await e.request(`/${r2.body.token}/cancel`, 'POST', {}); assert.equal(e.bumps.length, 2)
    void res
  })

  // ------------------------------------------------------------------------------------------------------------ verifier R1: stale snapshots
  const APPROVED = { ok: true, state: 'approved', originalAmount: 25, totalAmount: 25, discountAmount: 0, paymentAmount: 25, refundAmount: null, paymentCurrency: 'USD', apv: 'APV123', transactionDate: null, bankRef: null, paymentType: null, bankName: null }
  await check('a callback holding a stale snapshot (the sweep expired the payment meanwhile) still lands the money on the order: paid, exactly one late_paid row, no second PayWay call (a wrong build leaves payment paid and order expired)', async () => {
    const h = world(); await place(h)
    const stale = payment(h); const staleOrder = order(h)
    h.advance(20 * MIN); h.script.check = () => h.pending(); await h.sweep()
    assert.equal(order(h).state, 'expired'); assert.equal(payment(h).state, 'expired')
    const seen = []; h.calls.length = 0
    const out = await h.store.applyCheckResult(h.deps({ notify: async (event) => { seen.push(event.kind) } }), { id: 1, state: staleOrder.state }, stale, APPROVED, 'payway', null)
    assert.equal(out, 'paid'); assert.equal(order(h).state, 'paid'); assert.equal(payment(h).state, 'paid'); assert.equal(payment(h).paid_amount, 25)
    assert.equal(events(h).filter((e) => e === 'late_paid').length, 1, 'one late_paid row'); assert.ok(!events(h).includes('verified_paid'))
    assert.deepEqual(seen, ['paid']); assert.equal(countOf(h, 'check'), 0, 'the same answer is re-applied, PayWay is not asked again')
    assert.equal(money(h).onlineInUsd, 25); assert.equal(money(h).refundDueUsd, 0)
    // a mismatch through the same race: held in review on the order, which moves to review
    const r = world(); await place(r)
    const rs = payment(r); const ro = order(r)
    r.advance(20 * MIN); r.script.check = () => r.pending(); await r.sweep()
    const short = { ...APPROVED, originalAmount: 20, totalAmount: 20, paymentAmount: 20 }
    assert.equal(await r.store.applyCheckResult(r.deps({ notify: async () => {} }), { id: 1, state: ro.state }, rs, short, 'payway', null), 'review')
    assert.equal(order(r).state, 'review'); assert.equal(payment(r).paid_amount, 20); assert.equal(events(r).filter((e) => e === 'mismatch').length, 1)
    // a decline through the race changes nothing (the payment is no longer awaiting)
    const d = world(); await place(d); const ds = payment(d); const dob = order(d)
    d.advance(20 * MIN); d.script.check = () => d.pending(); await d.sweep()
    const before = rowsOf(d)
    assert.equal(await d.store.applyCheckResult(d.deps({ notify: async () => {} }), { id: 1, state: dob.state }, ds, { ...APPROVED, state: 'declined' }, 'payway', null), 'noop')
    assert.deepEqual(rowsOf(d), before)
  })

  await check('late money on a payment an edit had cancelled is found by the sweep without any callback: review with its amount, the paid_after_cancel mismatch, the order moves to review (a wrong build only re-checks expired payments)', async () => {
    const h = world(); const res = await place(h); const first = payment(h).tran_id
    await h.request('/' + res.body.token + '/edit', 'POST', { lines: [{ product_id: 1, quantity: 3 }] })
    assert.equal(payment(h, 1).state, 'cancelled')
    h.script.check = (b) => (b.tran_id === first ? h.approved(25) : h.pending())
    h.advance(11 * MIN)
    const s = await h.sweep()
    assert.equal(s.late >= 1, true); assert.equal(s.review, 1)
    const p = payment(h, 1); assert.equal(p.state, 'review'); assert.equal(p.paid_amount, 25); assert.equal(p.paid_at, null)
    const mismatch = h.one("SELECT * FROM online_order_events WHERE event = 'mismatch'"); assert.equal(JSON.parse(mismatch.detail_json).reason, 'paid_after_cancel'); assert.equal(mismatch.source, 'sweep')
    assert.equal(order(h).state, 'review')
    // asked once per interval, and a cancelled payment with no QR is never asked about
    h.calls.length = 0; h.advance(MIN); await h.sweep(); assert.equal(h.calls.filter((c) => c.op === 'check' && c.body.tran_id === first).length, 0, 'review is final for the sweep')
    const n = world(); await place(n)
    n.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, expires_at, revision, created_at) VALUES (1, 'WNOQRCANCELLED00001', 'order', 25, 'USD', 'cancelled', '2026-11-09 03:10:00', 0, '2026-11-09 03:00:00')")
    n.advance(MIN); n.script.check = () => n.approved(25); n.calls.length = 0; await n.sweep()
    assert.equal(n.calls.filter((c) => c.body.tran_id === 'WNOQRCANCELLED00001').length, 0, 'nothing exists at ABA for a payment that never got a QR')
  })

  await check('every Records-row guard of a money transition plans through idx_online_order_events_payment, never a scan of the events table (verifier R3)', async () => {
    const h = world()
    const bind = (sql) => sql.replace(/@(\w+)/g, (_, name) => ({ pid: '1', oid: '1', source: "'payway'", at: "'2026-11-09 03:00:00'", amount: '1', detail: "'{}'", from: "'awaiting_payment'", to: "'paid'", usd: '1', event: "'verified_paid'", newRev: '1', pstate: "'paid'" }[name] ?? '1'))
    const plansOf = async (drive) => {
      h.clearStatements(); await drive()
      return h.statements.filter((s) => /NOT EXISTS \(SELECT 1 FROM online_order_events WHERE payment_id = @pid/.test(s)).map((s) => h.all('EXPLAIN QUERY PLAN ' + bind(s)).map((r) => r.detail).join(' | '))
    }
    await place(h); const t1 = payment(h).tran_id
    h.script.check = () => h.approved(25)
    const paid = await plansOf(() => h.callback(t1))
    await place(h); const t2 = payment(h, 2).tran_id
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } })
    const review = await plansOf(() => h.callback(t2))
    await place(h); const t3 = payment(h, 3).tran_id
    h.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 3, original_amount: 25 } })
    const failed = await plansOf(() => h.callback(t3))
    for (const [label, plans] of [['paid', paid], ['review', review], ['declined', failed]]) {
      assert.ok(plans.length >= 1, label + ': the guard statement was found')
      for (const plan of plans) { assert.match(plan, /idx_online_order_events_payment/, label); assert.doesNotMatch(plan, /SCAN online_order_events(?! USING)/, label) }
    }
  })

  // ------------------------------------------------------------------------------------------------------------ verifier R4: D1 budget
  await check('a busy Free tick stops at its D1 budget (real notifier, Telegram configured): the rest waits for the next tick, the invocation stays inside 50 calls; the Paid plan does not defer; the callback route has its own ceiling', async () => {
    const realFetch = global.fetch
    global.fetch = async (url) => { if (!String(url).startsWith('https://api.telegram.org/')) throw new Error('unexpected network call'); return new Response(JSON.stringify({ ok: true }), { status: 200 }) }
    try {
      const configured = (tier) => world({ env: { PLAN_TIER: tier, TELEGRAM_BOT_TOKEN: '123456:test-token' }, settings: { telegram_chat_id: '-1001' } })
      const h = configured('free')
      for (let i = 0; i < 5; i += 1) await place(h)
      h.advance(20 * MIN); h.script.check = () => h.approved(25)
      h.clearStatements()
      const first = await h.sweep()
      assert.equal(first.deferred, true, 'the budget ran out'); assert.ok(first.paid >= 1 && first.paid < 5, 'some were settled: ' + first.paid)
      assert.ok(h.d1.calls <= 50, 'inside the invocation limit: ' + h.d1.calls); assert.ok(h.d1.calls <= 40, 'with margin for the Telegram drain that shares the invocation: ' + h.d1.calls)
      const second = await h.sweep()
      assert.equal(first.paid + second.paid, 5, 'nothing is lost, the rest is settled by the next tick')
      assert.equal(h.one("SELECT COUNT(*) n FROM online_orders WHERE state = 'paid'").n, 5)
      const paidPlan = configured('paid')
      for (let i = 0; i < 5; i += 1) await place(paidPlan)
      paidPlan.advance(20 * MIN); paidPlan.script.check = () => paidPlan.approved(25)
      const all = await paidPlan.sweep(); assert.equal(all.deferred, false); assert.equal(all.paid, 5)
      // the callback route: one money transition with the real notifier is bounded too
      const c = configured('free'); await place(c); c.script.check = () => c.approved(25); c.clearStatements()
      await c.callback(payment(c).tran_id)
      assert.ok(c.d1.calls <= CALLBACK_D1_CEILING, 'callback D1 calls ' + c.d1.calls + ' > ' + CALLBACK_D1_CEILING)
    } finally { global.fetch = realFetch }
  })

  console.log(`online order lifecycle: ${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
