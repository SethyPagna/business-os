// KHQR S4: the PayWay callback (a nudge, never proof) and the cron sweep, through the REAL route and store code on the real migration chain, with PayWay
// scripted. Each scenario names the wrong implementation it must turn red on.
//
// Run: node scripts/test-online-order-callback-sweep-native.cjs
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

function world(options = {}) {
  const h = createOrdersHarness({ switchOn: true, nowMs: T0, ...options })
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
const payment = (h, orderId = 1) => h.one('SELECT * FROM online_order_payments WHERE order_id = ? ORDER BY id DESC', orderId)
const order = (h, id = 1) => h.one('SELECT * FROM online_orders WHERE id = ?', id)
const events = (h, id = 1) => h.all('SELECT * FROM online_order_events WHERE order_id = ? ORDER BY id', id).map((e) => e.event)
const checks = (h) => h.calls.filter((c) => c.op === 'check').length
const rowsOf = (h) => ({ o: h.one('SELECT COUNT(*) n FROM online_orders').n, p: h.one('SELECT COUNT(*) n FROM online_order_payments').n, e: h.one('SELECT COUNT(*) n FROM online_order_events').n, rev: h.all('SELECT revision FROM online_orders').map((r) => r.revision).join() })

async function main() {
  // ------------------------------------------------------------------------------------------------------------------------ callback
  await check('callback: a forged or missing token is refused 403 before any read and any PayWay call (a wrong build checks every caller)', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    h.clearStatements(); h.calls.length = 0
    for (const opts of [{ token: 'x'.repeat(43) }, { token: '' }, { query: `t=${tran}` }, { query: `s=abc` }, { query: '' }, { token: 'AAAA' }]) {
      const r = await h.callback(tran, opts)
      assert.equal(r.status, 403, JSON.stringify(opts)); assert.deepEqual(r.body, { ok: false })
    }
    const other = await h.callback('WOTHERTRAN000000001', { token: (await h.paywayModule.callbackUrlFor(h.env, 'https://shop.example.test', tran)).split('s=')[1] })
    assert.equal(other.status, 403, 'a token for one transaction does not open another')
    assert.equal(h.statements.length, 0, 'no D1 statement'); assert.equal(h.calls.length, 0, 'no PayWay call')
    assert.equal((await h.callback(tran, { method: 'GET' })).status, 404)
    const other2 = await h.callback(tran, { envOverride: { APP_ENCRYPTION_KEY: 'z'.repeat(48) }, token: (await h.paywayModule.callbackUrlFor(h.env, 'https://shop.example.test', tran)).split('s=')[1] })
    assert.equal(other2.status, 403, 'a different key makes every token invalid')
  })

  await check('callback is a NUDGE: the body is never read; PayWay still pending means nothing changes (a wrong build trusts the body)', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    h.script.check = () => h.pending()
    const before = rowsOf(h)
    const r = await h.callback(tran, { body: { status: 'approved', tran_id: tran, amount: 25, apv: 'FORGED', original_amount: 25 } })
    assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true })
    assert.equal(checks(h), 1, 'the Worker asked PayWay itself')
    assert.deepEqual(rowsOf(h), before); assert.equal(order(h).state, 'awaiting_payment'); assert.equal(payment(h).state, 'awaiting')
    const garbage = await h.callback(tran, { body: '{{not json' })
    assert.equal(garbage.status, 200)
  })

  await check('callback: PayWay approves the exact amount, the order is Paid once, with one Records row; a duplicate callback writes nothing', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    h.script.check = () => h.approved(25)
    const r = await h.callback(tran)
    assert.deepEqual(r.body, { ok: true }); assert.equal(order(h).state, 'paid'); assert.ok(order(h).paid_at)
    assert.equal(payment(h).state, 'paid'); assert.equal(payment(h).paid_amount, 25); assert.equal(payment(h).payway_apv, 'APV123')
    assert.deepEqual(events(h), ['created', 'qr_issued', 'verified_paid'])
    const ev = h.one("SELECT * FROM online_order_events WHERE event = 'verified_paid'"); assert.equal(ev.source, 'payway'); assert.equal(ev.amount_usd, 25)
    const before = rowsOf(h); const callsBefore = checks(h)
    await h.callback(tran); await h.callback(tran)
    assert.deepEqual(rowsOf(h), before, 'replays write nothing'); assert.equal(checks(h), callsBefore, 'a paid payment is final: no further PayWay call')
  })

  await check('callback: a wrong amount, an over-payment or a discount goes to review, never Paid', async () => {
    for (const [answer, label] of [[() => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 20 } }), 'short'], [() => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 30 } }), 'over'],
      [() => ({ status: { code: '0' }, data: { payment_status_code: 0, original_amount: 25, discount_amount: 5 } }), 'discount'], [() => ({ status: { code: '0' }, data: { payment_status_code: 4, original_amount: 25 } }), 'refunded']]) {
      const h = world(); await place(h); const tran = payment(h).tran_id
      h.script.check = answer
      await h.callback(tran)
      assert.equal(order(h).state, 'review', label); assert.equal(payment(h).state, 'review', label); assert.ok(events(h).includes('mismatch'), label); assert.ok(!events(h).includes('verified_paid'), label)
    }
  })

  await check('callback settles even with the switch OFF, and a PayWay error or an unknown transaction answers 200 and writes nothing', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    h.state.switchOn = false
    h.script.check = () => ({ status: { code: '5' } })
    let before = rowsOf(h)
    assert.equal((await h.callback(tran)).status, 200); assert.deepEqual(rowsOf(h), before, 'a PayWay error is not an answer')
    h.script.check = () => { throw new Error('socket hang up') }
    assert.equal((await h.callback(tran)).status, 200); assert.deepEqual(rowsOf(h), before)
    h.advance(60_000) // the per-payment throttle: one check per interval, however many callbacks arrive
    h.script.check = () => h.approved(25)
    const tokenFor = async (t) => (await h.paywayModule.callbackUrlFor(h.env, 'https://shop.example.test', t)).split('s=')[1]
    const unknown = await h.callback('WNEVERISSUED000001', { token: await tokenFor('WNEVERISSUED000001') })
    assert.equal(unknown.status, 200); assert.deepEqual(rowsOf(h), before)
    await h.callback(tran)
    assert.equal(order(h).state, 'paid', 'money already taken is handled with the switch off')
  })

  await check('callback without PayWay credentials answers received and does nothing; a late payment after expiry is accepted as late_paid', async () => {
    const h = world(); await place(h); const tran = payment(h).tran_id
    const calls0 = h.calls.length
    assert.deepEqual((await h.callback(tran, { envOverride: { PAYWAY_API_KEY: undefined } })).body, { ok: true }); assert.equal(h.calls.length, calls0)
    h.run("UPDATE online_order_payments SET state = 'expired' WHERE id = 1"); h.run("UPDATE online_orders SET state = 'expired' WHERE id = 1")
    h.script.check = () => h.approved(25)
    await h.callback(tran)
    assert.equal(order(h).state, 'paid'); assert.equal(payment(h).state, 'paid'); assert.ok(events(h).includes('late_paid'))
  })

  await check('callback on a payment the customer had replaced: the money is never dropped and never auto-accepted - it lands in review with what PayWay took, the order goes to review, a replay changes nothing (a wrong build answers "closed" and loses it)', async () => {
    const h = world(); const res = await place(h); const token = res.body.token
    const first = payment(h).tran_id
    const edited = await h.request(`/${token}/edit`, 'POST', { lines: [{ product_id: 1, quantity: 3 }] })
    assert.equal(edited.status, 200)
    assert.equal(h.one('SELECT state FROM online_order_payments WHERE tran_id = ?', first).state, 'cancelled')
    h.script.check = () => h.approved(25)
    await h.callback(first)
    const held = h.one('SELECT * FROM online_order_payments WHERE tran_id = ?', first)
    assert.equal(held.state, 'review'); assert.equal(held.paid_amount, 25); assert.equal(held.payway_apv, 'APV123'); assert.equal(held.paid_at, null)
    assert.equal(order(h).state, 'review', 'a person must look at an order whose customer paid the old price')
    const mismatch = h.one("SELECT * FROM online_order_events WHERE event = 'mismatch'")
    assert.equal(JSON.parse(mismatch.detail_json).reason, 'paid_after_cancel'); assert.equal(mismatch.source, 'payway'); assert.equal(mismatch.amount_usd, 25)
    const money = h.orders.orderMoney(order(h), h.all('SELECT * FROM online_order_payments'), h.all('SELECT * FROM online_order_events'), null)
    assert.equal(money.heldInReviewUsd, 25, 'the money read counts the held money')
    const before = rowsOf(h)
    h.advance(60_000); await h.callback(first); await h.callback(first)
    assert.deepEqual(rowsOf(h), before, 'a replay changes nothing: review is final for every automatic path (staff resolve it)')
    // a decline on a replaced QR changes nothing either
    const h2 = world(); const r2 = await place(h2); const f2 = payment(h2).tran_id
    await h2.request(`/${r2.body.token}/edit`, 'POST', { lines: [{ product_id: 1, quantity: 3 }] })
    h2.script.check = () => ({ status: { code: '0' }, data: { payment_status_code: 3, original_amount: 25 } })
    const rows2 = rowsOf(h2); await h2.callback(f2)
    assert.deepEqual(rowsOf(h2), rows2); assert.equal(h2.one('SELECT state FROM online_order_payments WHERE tran_id = ?', f2).state, 'cancelled')
  })

  // ------------------------------------------------------------------------------------------------------------------------ sweep
  await check('sweep: an idle tick is FOUR statements (open payments, stuck qr_failed orders, the hold marker, late candidates): the three lists each through their partial index, the marker by its primary key, no PayWay call', async () => {
    const h = world()
    h.clearStatements()
    const s = await h.sweep()
    assert.deepEqual(s, { checked: 0, paid: 0, review: 0, failed: 0, expired: [], skipped: 0, late: 0, qrFailedExpired: 0, deferred: false })
    assert.equal(h.statements.length, 4); assert.equal(h.d1.calls, 4); assert.equal(h.calls.length, 0)
    assert.match(h.statements[0], /INDEXED BY idx_online_order_payments_open/)
    assert.match(h.statements[1], /INDEXED BY idx_online_orders_qr_failed/)
    assert.match(h.statements[2], /FROM system_flags WHERE key = @key/, 'the maintenance-hold marker: one primary-key read')
    assert.match(h.statements[3], /INDEXED BY idx_online_order_payments_expired/)
    await place(h); h.clearStatements()
    await h.sweep()
    assert.equal(h.statements.length, 4, 'a payment still inside its lifetime is not even read as a candidate'); assert.equal(h.calls.filter((c) => c.op === 'check').length, 0)
    const bind = (sql) => sql.replace(/@(\w+)/g, (_, n) => ({ expiredBefore: "'2026-11-09 03:00:00'", now: "'2026-11-09 03:00:00'", minutesKey: "'k'", minutesDefault: '15', grace: '120', limit: '5', key: "'online_orders_late_recheck_due'", windowStart: "'2026-11-08 03:00:00'", recheckBefore: "'2026-11-09 03:00:00'" }[n]))
    const plans = h.statements.map((s) => h.all(`EXPLAIN QUERY PLAN ${bind(s)}`).map((r) => r.detail).join(' | '))
    assert.match(plans[0], /idx_online_order_payments_open/); assert.match(plans[1], /idx_online_orders_qr_failed/); assert.match(plans[2], /system_flags/); assert.match(plans[3], /idx_online_order_payments_expired/)
    for (const plan of plans) assert.doesNotMatch(plan, /SCAN (p|o|online_order_payments|online_orders)(?! USING)/)
  })

  await check('sweep: inside the lifetime and the grace nothing expires; after both, PayWay is asked once and a not-paid payment expires with its order and one Records row', async () => {
    const h = world(); await place(h)
    h.advance(15 * MIN + 119_000); h.script.check = () => h.pending()
    assert.equal((await h.sweep()).checked, 0, 'inside the grace')
    h.advance(2_000)
    const s = await h.sweep()
    assert.equal(s.checked, 1); assert.deepEqual(s.expired, [{ orderId: 1, paymentId: 1, purpose: 'order' }])
    assert.equal(order(h).state, 'expired'); assert.equal(payment(h).state, 'expired')
    assert.deepEqual(events(h), ['created', 'qr_issued', 'expired']); assert.equal(h.one("SELECT source FROM online_order_events WHERE event = 'expired'").source, 'sweep')
    const before = rowsOf(h)
    const again = await h.sweep(); assert.equal(again.checked, 0); assert.deepEqual(rowsOf(h), before, 'a second tick does nothing')
  })

  await check('sweep never expires on a guess: it asks PayWay first; paid in the meantime means Paid, a mismatch means review, a PayWay error waits for the next tick (a wrong build expires without asking)', async () => {
    const h = world(); await place(h); await place(h); await place(h)
    h.advance(20 * MIN)
    h.script.check = (b) => (b.tran_id === h.one('SELECT tran_id FROM online_order_payments WHERE id = 1').tran_id ? h.approved(25)
      : b.tran_id === h.one('SELECT tran_id FROM online_order_payments WHERE id = 2').tran_id ? h.approved(9) : { status: { code: '429' } })
    const s = await h.sweep()
    assert.equal(s.checked, 3); assert.equal(s.paid, 1); assert.equal(s.review, 1); assert.equal(s.skipped, 1); assert.deepEqual(s.expired, [])
    assert.deepEqual([1, 2, 3].map((i) => order(h, i).state), ['paid', 'review', 'awaiting_payment'])
    assert.equal(payment(h, 3).state, 'awaiting', 'the unanswered one waits')
    h.script.check = () => { throw new Error('network down') }
    assert.equal((await h.sweep()).skipped, 1); assert.equal(order(h, 3).state, 'awaiting_payment')
    h.script.check = () => ({ status: { code: '6' } })
    const done = await h.sweep()
    assert.equal(done.expired.length, 1, 'PayWay "not found" is an answer: it never saw this transaction'); assert.equal(order(h, 3).state, 'expired')
  })

  await check('sweep without PayWay credentials expires nothing; with the switch OFF it still runs', async () => {
    const h = world(); await place(h); h.advance(30 * MIN); h.script.check = () => h.pending()
    h.clearStatements()
    assert.equal((await h.sweep({ noCredentials: true })).checked, 0); assert.equal(h.statements.length, 0, 'not even a read')
    h.state.switchOn = false
    assert.equal((await h.sweep()).expired.length, 1)
  })

  await check('sweep batch size comes from the plan: Free checks 5 per tick, Paid 25 (a wrong build checks every stale payment in one invocation)', async () => {
    const free = world({ env: { PLAN_TIER: 'free' } })
    for (let i = 0; i < 8; i += 1) await place(free)
    free.advance(30 * MIN); free.script.check = () => free.pending()
    assert.equal((await free.sweep({ env: { PLAN_TIER: 'free' } })).checked, 5)
    assert.equal((await free.sweep({ env: { PLAN_TIER: 'free' } })).checked, 3, 'the rest on the next tick')
    const paid = world({ env: { PLAN_TIER: 'paid' } })
    for (let i = 0; i < 8; i += 1) await place(paid)
    paid.advance(30 * MIN); paid.script.check = () => paid.pending()
    assert.equal((await paid.sweep({ env: { PLAN_TIER: 'paid' } })).checked, 8)
  })

  await check('sweep: an order with a newer live QR keeps awaiting when its old payment expires; an expiring top-up never expires the order', async () => {
    const h = world(); await place(h)
    h.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, amount, currency, state, qr_string, expires_at, revision) VALUES (1, 'WSECONDLIVE0000001', 'order', 25, 'USD', 'awaiting', 'q', '2026-11-09 04:00:00.000', 0)")
    h.advance(20 * MIN); h.script.check = () => h.pending()
    const s = await h.sweep()
    assert.equal(s.checked, 1); assert.equal(payment(h, 1).state, 'awaiting'); assert.equal(h.one('SELECT state FROM online_order_payments WHERE id = 1').state, 'expired')
    assert.equal(order(h).state, 'awaiting_payment', 'the newer QR is still live')
    const h2 = world(); await place(h2)
    h2.script.check = () => h2.approved(25); h2.advance(MIN); await h2.callback(payment(h2).tran_id)
    h2.run("INSERT INTO online_order_requests (order_id, kind, stage, before_json, after_json) VALUES (1, 'items', 'paid', '{}', '{}')")
    h2.run("INSERT INTO online_order_payments (order_id, tran_id, purpose, request_id, amount, currency, state, qr_string, expires_at, revision) VALUES (1, 'WTOPUPLIVE00000001', 'top_up', 1, 5, 'USD', 'awaiting', 'q', '2026-11-09 03:05:00.000', 0)")
    h2.advance(20 * MIN); h2.script.check = () => h2.pending()
    const s2 = await h2.sweep()
    assert.equal(s2.checked, 1); assert.equal(order(h2).state, 'paid'); assert.equal(h2.one("SELECT state FROM online_order_payments WHERE purpose = 'top_up'").state, 'expired')
  })

  await check('sweep: a payment whose QR was never issued (no expires_at) expires after the configured lifetime plus the grace, not before; the lifetime is the setting', async () => {
    const make = async (settings) => {
      const h = world({ settings }); await place(h)
      h.run("UPDATE online_order_payments SET expires_at = NULL, qr_string = NULL WHERE id = 1")
      h.script.check = () => ({ status: { code: '6' } })
      return h
    }
    const a = await make({})
    a.advance(15 * MIN + 100_000); assert.equal((await a.sweep()).checked, 0, '15 minutes plus a little: still inside the grace')
    a.advance(21_000); assert.equal((await a.sweep()).expired.length, 1)
    const b = await make({ online_order_payment_minutes: '5' })
    b.advance(5 * MIN + 121_000); assert.equal((await b.sweep()).expired.length, 1, 'a 5 minute setting is honoured')
    const c = await make({ online_order_payment_minutes: '5' })
    c.advance(5 * MIN + 100_000); assert.equal((await c.sweep()).checked, 0)
    const d = await make({ online_order_payment_minutes: 'oops' })
    d.advance(10 * MIN); assert.equal((await d.sweep()).checked, 0, 'an unreadable setting means the default 15, not 0')
  })

  await check('the */5 Telegram lane runs the drain and then the sweep, each in its own try (a failure in one never skips the other); the sweep step is optional', async () => {
    const lib = world().load
    const { dispatchCron } = lib('lib/cronDispatch.ts')
    const { CRON_TELEGRAM } = lib('lib/cronRotation.ts')
    const run = async ({ failDrain = false, failSweep = false, withSweep = true } = {}) => {
      const order = []
      const deps = {
        drainTelegram: async () => { order.push('drain'); if (failDrain) throw new Error('drain failed') },
        heavySteps: () => [], rotationSteps: () => [], storeFor: () => ({ read: async () => null, write: async () => {} }),
        ...(withSweep ? { sweepOnlineOrders: async () => { order.push('sweep'); if (failSweep) throw new Error('sweep failed') } } : {}),
      }
      await dispatchCron(CRON_TELEGRAM, Date.now(), deps)
      return order
    }
    assert.deepEqual(await run(), ['drain', 'sweep'])
    assert.deepEqual(await run({ failDrain: true }), ['drain', 'sweep'], 'a failed drain does not skip the sweep')
    assert.deepEqual(await run({ failSweep: true }), ['drain', 'sweep'], 'a failed sweep does not throw')
    assert.deepEqual(await run({ withSweep: false }), ['drain'])
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
