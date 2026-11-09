// KHQR S2: the pure online order state core (lib/onlineOrders.ts). The vocabulary is pinned to migration 0293's CHECK lists, the
// transition table is checked against a hand-written expectation over every (from, to, source) triple, and "who can make an order
// Paid" is proven narrow: only a verified PayWay answer (payway or sweep), never a customer, never staff pressing a button on an
// unpaid order. Identifiers, limits and the request rules ride along.
//
// Run: node scripts/test-online-order-state-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { loadTsLibGraph } = require('./harness/load_ts_lib.cjs')
const graph = loadTsLibGraph(['onlineOrders', 'planTier'])
const O = new Proxy(graph.onlineOrders, {
  // planTier remembers the first tier it reads for the life of the isolate; a test that reads both tiers resets it between calls.
  get: (target, key) => (typeof target[key] === 'function' ? (...args) => { graph.planTier.__resetPlanTierCacheForTests(); return target[key](...args) } : target[key]),
})

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
const FREE = { PLAN_TIER: 'free' }
const PAID = { PLAN_TIER: 'paid' }

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0293_online_orders.sql'), 'utf8')
const listAfter = (table, column) => {
  const block = migration.slice(migration.indexOf(`CREATE TABLE ${table} (`))
  const match = new RegExp(`${column} TEXT[^\\n]*?CHECK \\(${column} IN \\(([^)]*)\\)`, 's').exec(block)
  assert.ok(match, `${table}.${column} CHECK list`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

check('the vocabulary equals the migration CHECK lists, name for name', () => {
  assert.deepEqual([...O.ORDER_STATES], listAfter('online_orders', 'state'))
  assert.deepEqual([...O.PAYMENT_STATES], listAfter('online_order_payments', 'state'))
  assert.deepEqual([...O.REQUEST_KINDS], listAfter('online_order_requests', 'kind'))
  assert.deepEqual([...O.REQUEST_STAGES], listAfter('online_order_requests', 'stage'))
  assert.deepEqual([...O.ORDER_EVENTS], listAfter('online_order_events', 'event'))
  assert.deepEqual([...O.EVENT_SOURCES], listAfter('online_order_events', 'source'))
})

// The expected table, written out by hand from design A1.2 and NOT derived from the module.
const EXPECTED = [
  ['awaiting_payment', 'awaiting_payment', 'customer'], ['awaiting_payment', 'qr_failed', 'customer'],
  ['awaiting_payment', 'paid', 'payway'], ['awaiting_payment', 'paid', 'sweep'],
  ['awaiting_payment', 'review', 'payway'], ['awaiting_payment', 'review', 'sweep'],
  ['awaiting_payment', 'expired', 'sweep'],
  ['awaiting_payment', 'cancelled', 'customer'], ['awaiting_payment', 'cancelled', 'staff'],
  ['qr_failed', 'awaiting_payment', 'customer'], ['qr_failed', 'expired', 'sweep'],
  ['qr_failed', 'cancelled', 'customer'], ['qr_failed', 'cancelled', 'staff'],
  ['paid', 'paid', 'staff'], ['paid', 'cancelled', 'staff'], ['paid', 'fulfilled', 'staff'],
  ['review', 'paid', 'staff'], ['review', 'cancelled', 'staff'],
  ['expired', 'paid', 'payway'], ['expired', 'paid', 'sweep'],
].map((row) => row.join('>'))

check('every (from, to, source) triple: exactly the expected ones are allowed, nothing else', () => {
  const allowed = []
  for (const from of O.ORDER_STATES) for (const to of O.ORDER_STATES) for (const source of O.EVENT_SOURCES) {
    if (O.canTransition(from, to, source)) allowed.push([from, to, source].join('>'))
  }
  assert.deepEqual(allowed.sort(), [...EXPECTED].sort())
  assert.equal(allowed.length, 20)
})

check('POSITIVE CONTROL: the matrix is not trivially empty or full, and junk inputs are refused', () => {
  assert.ok(O.canTransition('paid', 'fulfilled', 'staff'))
  assert.ok(!O.canTransition('paid', 'fulfilled', 'customer'))
  for (const bad of [['x', 'paid', 'payway'], ['paid', 'x', 'staff'], ['paid', 'paid', 'robot'], ['', '', ''], [undefined, 'paid', 'staff'], ['__proto__', 'paid', 'staff'], ['constructor', 'paid', 'staff']]) {
    assert.equal(O.canTransition(...bad), false, bad.join('>'))
  }
})

check('terminal states have no way out, and only a verified PayWay answer makes an unpaid order Paid', () => {
  for (const to of O.ORDER_STATES) for (const source of O.EVENT_SOURCES) {
    assert.equal(O.canTransition('cancelled', to, source), false)
    assert.equal(O.canTransition('fulfilled', to, source), false)
  }
  const makesPaid = []
  for (const from of ['awaiting_payment', 'qr_failed', 'expired', 'review']) for (const source of O.EVENT_SOURCES) {
    if (O.canTransition(from, 'paid', source)) makesPaid.push(`${from}>${source}`)
  }
  assert.deepEqual(makesPaid.sort(), ['awaiting_payment>payway', 'awaiting_payment>sweep', 'expired>payway', 'expired>sweep', 'review>staff'])
  assert.equal(O.canTransition('awaiting_payment', 'paid', 'staff'), false, 'staff cannot mark an unpaid order Paid')
  assert.equal(O.canTransition('awaiting_payment', 'paid', 'customer'), false, 'a customer cannot either')
  assert.equal(O.canTransition('qr_failed', 'paid', 'payway'), false, 'a failed QR has no payment to confirm')
})

check('every allowed transition names an event the table accepts; a late payment is late_paid and a resolved review is resolved', () => {
  for (const row of EXPECTED) {
    const [from, to] = row.split('>')
    assert.ok(O.ORDER_EVENTS.includes(O.transitionEvent(from, to)), row)
  }
  assert.equal(O.transitionEvent('expired', 'paid'), 'late_paid')
  assert.equal(O.transitionEvent('review', 'paid'), 'resolved')
  assert.equal(O.transitionEvent('awaiting_payment', 'paid'), 'verified_paid')
  assert.equal(O.transitionEvent('awaiting_payment', 'review'), 'mismatch')
  assert.equal(O.transitionEvent('awaiting_payment', 'awaiting_payment'), 'edited')
  assert.equal(O.transitionEvent('qr_failed', 'awaiting_payment'), 'qr_issued')
  assert.equal(O.transitionEvent('paid', 'fulfilled'), 'fulfilled')
})

check('payment rows: money arrives only awaiting -> paid (or a late paid after expiry, or a resolved review)', () => {
  assert.ok(O.canPaymentTransition('awaiting', 'paid'))
  assert.ok(O.canPaymentTransition('expired', 'paid'))
  assert.ok(O.canPaymentTransition('review', 'paid'))
  for (const dead of ['paid', 'cancelled', 'failed']) for (const to of O.PAYMENT_STATES) assert.equal(O.canPaymentTransition(dead, to), false, `${dead} is final`)
  assert.equal(O.canPaymentTransition('cancelled', 'paid'), false, 'a closed QR never becomes money')
  assert.equal(O.canPaymentTransition('nope', 'paid'), false)
})

// ---- is this PayWay answer the money for this order? ---------------------------------------------------------------------------
const approved = (over = {}) => ({ state: 'approved', originalAmount: 24.5, totalAmount: 24.5, discountAmount: 0, ...over })
check('paidMatchesOrder: exact cents only; partial, over, sub-cent, discount, currency and not-approved are all refused', () => {
  const usd = { amount: 24.5, currency: 'USD' }
  assert.deepEqual(O.paidMatchesOrder(usd, approved()), { ok: true })
  assert.deepEqual(O.paidMatchesOrder(usd, approved({ originalAmount: 24.5, totalAmount: null })), { ok: true })
  assert.deepEqual(O.paidMatchesOrder({ amount: 0.1 + 0.2, currency: 'USD' }, approved({ originalAmount: 0.3 })), { ok: true }, 'float noise on our side still compares in cents')
  const refused = (check, reason, order = usd, cb) => assert.deepEqual(O.paidMatchesOrder(order, check, cb), { ok: false, reason })
  refused(approved({ originalAmount: 24.49 }), 'amount_mismatch')
  refused(approved({ originalAmount: 24.51 }), 'amount_mismatch')
  refused(approved({ originalAmount: 12.25 }), 'amount_mismatch')
  refused(approved({ originalAmount: 24.499 }), 'amount_unreadable')
  refused(approved({ originalAmount: null, totalAmount: null }), 'amount_unreadable')
  refused(approved({ discountAmount: 1 }), 'discount_applied')
  refused(approved({ state: 'pending' }), 'not_approved')
  refused(approved({ state: 'declined' }), 'not_approved')
  refused(approved({ state: 'refunded' }), 'not_approved')
  refused(approved(), 'currency_mismatch', usd, 'KHR')
  assert.deepEqual(O.paidMatchesOrder(usd, approved(), 'usd'), { ok: true })
  assert.deepEqual(O.paidMatchesOrder(usd, approved(), null), { ok: true })
  assert.deepEqual(O.paidMatchesOrder({ amount: 100000, currency: 'KHR' }, approved({ originalAmount: 100000 })), { ok: true })
  refused(approved({ originalAmount: 100000.5 }), 'amount_mismatch', { amount: 100000, currency: 'KHR' })
  refused(approved({ originalAmount: 99900 }), 'amount_mismatch', { amount: 100000, currency: 'KHR' })
})

check('classifyCheck: the callback or sweep outcome of a check; only an exact approved match is Paid', () => {
  const usd = { amount: 24.5, currency: 'USD' }
  assert.equal(O.classifyCheck(usd, approved()), 'paid')
  assert.equal(O.classifyCheck(usd, approved({ originalAmount: 10 })), 'review', 'a partial payment is never Paid')
  assert.equal(O.classifyCheck(usd, approved({ originalAmount: 30 })), 'review', 'an over-payment is reviewed, not accepted')
  assert.equal(O.classifyCheck(usd, approved({ state: 'refunded' })), 'review')
  assert.equal(O.classifyCheck(usd, approved({ state: 'pending' })), 'pending')
  assert.equal(O.classifyCheck(usd, approved({ state: 'declined' })), 'failed')
  assert.equal(O.classifyCheck(usd, approved({ state: 'cancelled' })), 'failed')
  assert.equal(O.classifyCheck(usd, approved(), 'KHR'), 'review')
})

// ---- identifiers --------------------------------------------------------------------------------------------------------------
check('order numbers: W + Cambodia date + 4 characters, readable, and deterministic for the injected random', () => {
  const at = new Date(Date.UTC(2026, 10, 9, 18, 30))
  const random = Uint8Array.from([0, 1, 2, 31])
  const no = O.makeOrderNo(at, random)
  assert.equal(no, 'W261110012Z')
  assert.ok(O.isOrderNo(no))
  assert.equal(O.makeOrderNo(new Date(Date.UTC(2026, 10, 9, 16, 59)), random).slice(0, 7), 'W261109', 'before 17:00 UTC it is still the 9th in Cambodia')
  assert.equal(O.makeOrderNo(new Date(Date.UTC(2026, 10, 9, 17, 0)), random).slice(0, 7), 'W261110', 'from 17:00 UTC it is the 10th')
  for (const bad of ['', 'W261109ABCI', 'w261109ABCD', 'W26110ABCD', 'W261109ABCDE', 'X261109ABCD', 'W261109ABCL']) assert.equal(O.isOrderNo(bad), false, bad)
  assert.throws(() => O.makeOrderNo(at, Uint8Array.from([1, 2])), /order_no_invalid_input/)
  assert.throws(() => O.makeOrderNo(new Date('x'), random), /order_no_invalid_input/)
})

const tokenChecks = (async () => {
  const random = Uint8Array.from({ length: 16 }, (_, i) => i * 17 + 3)
  const { token, hash } = await O.createOrderToken(random)
  assert.equal(token, Buffer.from(random).toString('base64url'))
  assert.equal(token.length, 22)
  assert.ok(O.isOrderToken(token))
  assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'))
  assert.equal(await O.hashOrderToken(token), hash)
  assert.notEqual((await O.createOrderToken(Uint8Array.from({ length: 16 }, (_, i) => i))).token, token)
  assert.ok(!hash.includes(token))
  for (const bad of ['', 'short', `${token}x`, `${token.slice(0, 21)}!`, null, 7]) assert.equal(O.isOrderToken(bad), false)
  await assert.rejects(() => O.createOrderToken(Uint8Array.from([1, 2, 3])), /order_token_invalid_input/)
  passed += 1; console.log('PASS order token creation, hashing and shape (async part)')
})()

// ---- limits and the request window --------------------------------------------------------------------------------------------
check('limit readers follow the plan tier (Free is stricter, except the nudge gap where longer is cheaper)', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ product_id: i + 1, quantity: 1 }))
  assert.equal(O.orderLinesError(lines(20), FREE), null)
  assert.equal(O.orderLinesError(lines(21), FREE), 'too_many_lines')
  assert.equal(O.orderLinesError(lines(50), PAID), null)
  assert.equal(O.orderLinesError(lines(51), PAID), 'too_many_lines')
  assert.equal(O.orderLinesError([], PAID), 'lines_required')
  assert.equal(O.orderLinesError(null, PAID), 'lines_required')
  for (const bad of [{ product_id: 1, quantity: 0 }, { product_id: 1, quantity: 100 }, { product_id: 1, quantity: 1.5 }, { product_id: 0, quantity: 1 }, { product_id: 'a', quantity: 1 }, null]) {
    assert.equal(O.orderLinesError([bad], PAID), 'invalid_line', JSON.stringify(bad))
  }
  assert.equal(O.orderLinesError([{ product_id: 1, quantity: 99 }], PAID), null)
  assert.equal(O.orderLinesError([{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }], PAID), 'duplicate_product')
  assert.equal(O.openUnpaidAllowed(19, FREE), true)
  assert.equal(O.openUnpaidAllowed(20, FREE), false)
  assert.equal(O.openUnpaidAllowed(99, PAID), true)
  assert.equal(O.openUnpaidAllowed(100, PAID), false)
  assert.equal(O.sweepBatchSize(FREE), 5)
  assert.equal(O.sweepBatchSize(PAID), 25)
  assert.equal(O.adminPageRows(FREE), 50)
  assert.equal(O.adminPageRows(PAID), 100)
  const now = new Date(Date.UTC(2026, 10, 9, 8, 0, 40))
  assert.equal(O.nudgeCheckDue(null, now, FREE), true)
  assert.equal(O.nudgeCheckDue('2026-11-09 08:00:20', now, FREE), false, '20 s ago: Free asks 30')
  assert.equal(O.nudgeCheckDue('2026-11-09 08:00:20', now, PAID), true, '20 s ago: Paid asks 15')
  assert.equal(O.nudgeCheckDue('2026-11-09T08:00:10.000Z', now, FREE), true)
  assert.equal(O.nudgeCheckDue('garbage', now, FREE), true, 'an unreadable stamp never blocks a check')
})

check('the request window is a setting: 7 days by default, whole days 1..30, anything else falls back to 7', () => {
  assert.equal(O.REQUEST_WINDOW_DAYS_KEY, 'online_order_request_days')
  assert.equal(O.resolveRequestWindowDays(undefined), 7)
  assert.equal(O.resolveRequestWindowDays(null), 7)
  assert.equal(O.resolveRequestWindowDays(''), 7)
  for (const [raw, days] of [['1', 1], ['14', 14], [' 30 ', 30], [21, 21]]) assert.equal(O.resolveRequestWindowDays(raw), days)
  for (const bad of ['0', '31', '-3', '7.5', 'abc', '1e1', 0, 31, 7.5, NaN]) assert.equal(O.resolveRequestWindowDays(bad), 7, String(bad))
})

// ---- requests: state is read from events, and the rules for a new one ---------------------------------------------------------
const order = (over = {}) => ({ id: 1, state: 'paid', goods_total_usd: 24.5, currency: 'USD', paid_at: '2026-11-09 08:00:00', created_at: '2026-11-09 07:50:00', ...over })
const NOW = new Date(Date.UTC(2026, 10, 10, 8, 0, 0))
const base = { order: order(), payments: [{ id: 1, state: 'paid', paid_amount: 24.5 }], sale: null, requests: [], events: [], kind: 'address', now: NOW, windowDays: 7 }

check('requestStates reads the state from events only: pending, accepted, rejected, withdrawn, applied, reversed', () => {
  const requests = [1, 2, 3, 4, 5, 6].map((id) => ({ id, kind: 'items', stage: 'paid' }))
  const events = [
    { event: 'request_submitted', request_id: 1 },
    { event: 'request_accepted', request_id: 2, public_comment: 'We will call you' },
    { event: 'request_rejected', request_id: 3, public_comment: 'Opened item' },
    { event: 'request_withdrawn', request_id: 4 },
    { event: 'request_accepted', request_id: 5 }, { event: 'request_applied', request_id: 5, action_history_id: 50 },
    { event: 'request_accepted', request_id: 6 }, { event: 'request_applied', request_id: 6, action_history_id: 60 },
  ]
  const states = O.requestStates(requests, events, new Set([60]))
  assert.deepEqual(states.map((s) => s.status), ['pending', 'accepted', 'rejected', 'withdrawn', 'applied', 'reversed'])
  assert.equal(states[1].publicComment, 'We will call you')
  assert.equal(states[2].publicComment, 'Opened item')
  assert.equal(O.requestStates(requests, events)[5].status, 'applied', 'without the undone set nothing reads as reversed')
})

check('requestAllowed: stage, kind, window, one pending, the cap, and closed orders', () => {
  assert.deepEqual(O.requestAllowed(base, FREE), { ok: true, stage: 'paid' })
  const refuse = (over, reason, env = FREE) => assert.deepEqual(O.requestAllowed({ ...base, ...over }, env), { ok: false, reason }, reason)
  refuse({ order: order({ state: 'awaiting_payment' }) }, 'not_ready')
  refuse({ order: order({ state: 'cancelled' }) }, 'not_ready')
  refuse({ order: order({ state: 'expired' }) }, 'not_ready')
  refuse({ kind: 'return' }, 'kind_not_allowed')
  refuse({ kind: 'refund' }, 'kind_not_allowed')
  refuse({ now: new Date(Date.UTC(2026, 10, 16, 8, 0, 1)) }, 'window_closed')
  assert.equal(O.requestAllowed({ ...base, now: new Date(Date.UTC(2026, 10, 16, 8, 0, 0)) }, FREE).ok, true, 'the last second of day 7 is still open')
  assert.equal(O.requestAllowed({ ...base, now: new Date(Date.UTC(2026, 10, 20, 8, 0, 0)), windowDays: 14 }, FREE).ok, true, 'the window is the setting')
  refuse({ requests: [{ id: 1, kind: 'address', stage: 'paid' }], events: [{ event: 'request_submitted', request_id: 1 }] }, 'one_pending')
  const decided = (n) => ({
    requests: Array.from({ length: n }, (_, i) => ({ id: i + 1, kind: 'note', stage: 'paid' })),
    events: Array.from({ length: n }, (_, i) => ({ event: 'request_rejected', request_id: i + 1 })),
  })
  assert.equal(O.requestAllowed({ ...base, ...decided(4) }, FREE).ok, true)
  refuse(decided(5), 'too_many', FREE)
  assert.equal(O.requestAllowed({ ...base, ...decided(5) }, PAID).ok, true, 'Paid allows 10')
  refuse(decided(10), 'too_many', PAID)
  const fulfilled = order({ state: 'fulfilled', sale_id: 9 })
  const sale = { id: 9, sale_status: 'completed', total_usd: 24.5, amount_paid_usd: 24.5, amount_paid_khr: 0, exchange_rate: 4000, money_precision_version: 1, created_at: '2026-11-09 09:00:00' }
  assert.deepEqual(O.requestAllowed({ ...base, order: fulfilled, sale, kind: 'return' }, FREE), { ok: true, stage: 'after_sale' })
  assert.equal(O.requestAllowed({ ...base, order: fulfilled, sale, now: new Date(Date.UTC(2026, 10, 16, 8, 59, 0)), kind: 'return' }, FREE).ok, true,
    'a return window starts at hand-over (the sale), not at payment')
  refuse({ order: fulfilled, sale: { ...sale, return_state: 'full' }, kind: 'return' }, 'closed_order')
  refuse({ order: fulfilled, sale: { ...sale, sale_status: 'cancelled' }, kind: 'note' }, 'closed_order')
  const cancelledSale = { ...base, order: fulfilled, sale: { ...sale, sale_status: 'cancelled' }, kind: 'note', payments: [{ id: 1, state: 'paid', paid_amount: 24.5 }] }
  const recorded = { event: 'payment_recorded_on_sale', payment_id: 1, sale_id: 9 }
  assert.equal(O.requestAllowed({ ...cancelledSale, events: [recorded] }, FREE).ok, true, 'cancelled but money still to refund: the customer may still write')
  assert.deepEqual(O.requestAllowed({ ...cancelledSale, events: [recorded, { event: 'refund_noted', amount_usd: 24.5, sale_id: 9 }] }, FREE), { ok: false, reason: 'closed_order' }, 'cancelled and refunded in full is closed')
})

check('the stage table: a return exists only once there is a sale', () => {
  assert.deepEqual([...O.requestKindsForStage('paid')], ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel'])
  assert.deepEqual([...O.requestKindsForStage('after_sale')], ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel', 'return'])
  assert.equal(O.requestStage({ state: 'paid' }), 'paid')
  assert.equal(O.requestStage({ state: 'review' }), 'paid')
  assert.equal(O.requestStage({ state: 'fulfilled' }), 'after_sale')
  assert.equal(O.requestStage({ state: 'awaiting_payment' }), null)
})

tokenChecks.then(() => console.log(`\n${passed} checks passed`)).catch((e) => { console.error(e); process.exit(1) })
