'use strict'
// The pure rules of lib/salePaymentWriters.ts (lane 6.0.982, slice S4), run on the real module. The whole-Worker
// behaviour is test-sale-payment-writers-native.cjs; this file pins the rules a native run reaches only indirectly.
// Each check names the plausible wrong rule it is red against.
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({ entryPoints: [path.join(__dirname, '..', 'src/lib/salePaymentWriters.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent' })
const m = { exports: {} }
new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, m, m.exports)
const W = m.exports

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`ok ${name}`) }

const event = (over) => ({ id: 1, event_id: 'e1', sale_id: 7, direction: 'in', origin: 'collect', covers_operation_id: null, operation_id: 'op',
  reverses_event_id: null, payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":20,"amount_khr":0}]', amount_paid_usd: 20,
  amount_paid_khr: 0, change_usd: 7, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000, exchange_rate: 4000, drawer_effect: 1,
  received_at: '2026-10-20 03:00:00', branch_id: 1, cashier_id: 5, cashier_name: 'a', note: null, ...over })
const actor = { receivedAt: '2026-10-26T04:05:06.789Z', branchId: 2, cashierId: 9, cashierName: 'b' }

check('a reversal copies the money AND the change of the event it reverses (red: re-summed details, or change dropped)', () => {
  const collect = event({ event_id: 'op:0:in' })
  const [undo] = W.settlementReplayEvents({ operationId: 'op', direction: 'undo', generation: 0, saleEvents: [collect], actor })
  assert.deepEqual([undo.event_id, undo.direction, undo.origin, undo.reverses_event_id], ['op:1:out', 'out', 'undo', 'op:0:in'])
  assert.deepEqual([undo.amount_paid_usd, undo.change_usd, undo.change_is_actual], [20, 7, 1])
  assert.deepEqual([undo.received_at, undo.branch_id, undo.cashier_id], ['2026-10-26 04:05:06', 2, 9])
})

check('redo answers the undo of the current generation only (red: answers the original again)', () => {
  const saleEvents = [event({ id: 1, event_id: 'op:0:in' }), event({ id: 2, event_id: 'op:1:out', direction: 'out', origin: 'undo', reverses_event_id: 'op:0:in' })]
  const [redo] = W.settlementReplayEvents({ operationId: 'op', direction: 'redo', generation: 1, saleEvents, actor })
  assert.deepEqual([redo.event_id, redo.direction, redo.origin, redo.reverses_event_id], ['op:2:in', 'in', 'redo', 'op:1:out'])
})

check('a later payment of another operation refuses the undo (red: undo under a newer payment)', () => {
  const saleEvents = [event({ id: 1, event_id: 'op:0:in' }), event({ id: 2, event_id: 'other:0:in', operation_id: 'other' })]
  assert.throws(() => W.settlementReplayEvents({ operationId: 'op', direction: 'undo', generation: 0, saleEvents, actor }), (error) => error.code === 'later_payment_depends')
  // An EARLIER event of another operation (the opening, a checkout) does not.
  const earlier = [event({ id: 1, event_id: 'opening:7', origin: 'opening', operation_id: null }), event({ id: 2, event_id: 'op:0:in' })]
  assert.equal(W.settlementReplayEvents({ operationId: 'op', direction: 'undo', generation: 0, saleEvents: earlier, actor }).length, 1)
})

check('a correction operation replays at the corrected payment\'s date and drawer, never now (red: dated now)', () => {
  const saleEvents = [event({ id: 1, event_id: 'op:0:out', direction: 'out', origin: 'correction', reverses_event_id: 'checkout:7' }),
    event({ id: 2, event_id: 'op:0:in', origin: 'correction', payment_method: 'ABA' })]
  const undo = W.settlementReplayEvents({ operationId: 'op', direction: 'undo', generation: 0, saleEvents, actor })
  assert.deepEqual(undo.map((e) => [e.event_id, e.direction, e.origin, e.received_at, e.cashier_id]),
    [['op:1:in', 'in', 'correction', '2026-10-20 03:00:00', 5], ['op:1:out', 'out', 'correction', '2026-10-20 03:00:00', 5]])
})

check('live events drop a reversed event and a reversed reversal (red: counting the undo pair as live)', () => {
  const rows = [event({ event_id: 'a' }), event({ event_id: 'b', direction: 'out', reverses_event_id: 'a' }), event({ event_id: 'c', reverses_event_id: 'b' })]
  assert.deepEqual(W.livePaymentEvents(rows).map((e) => e.event_id), ['c'])
})

check('a correction is dated at the LATEST live payment and replaces the whole tender (red: the first payment, or a refusal)', () => {
  assert.equal(W.correctionAnchor([], null), null)
  const tender = event({ event_id: 'opening:7', amount_paid_usd: 10 })
  const deposit = event({ id: 1, event_id: 'checkout:7', received_at: '2026-10-01 01:00:00' })
  const settle = event({ id: 2, event_id: 'op:0:in', received_at: '2026-10-05 01:00:00' })
  const anchor = W.correctionAnchor([deposit, settle], tender)
  assert.equal(anchor.event.event_id, 'op:0:in')
  const [out, inn] = W.settlementApplyEvents({ operationId: 'fix', saleId: 7, exchangeRate: 4000, added: [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }],
    change: { usd: 0, khr: 0, isActual: false, exchangeRate: null }, actor, correction: anchor })
  assert.deepEqual([out.direction, out.origin, out.amount_paid_usd, out.received_at, out.reverses_event_id], ['out', 'correction', 10, '2026-10-05 01:00:00', null])
  assert.deepEqual([inn.direction, inn.origin, inn.payment_method, inn.received_at, inn.cashier_id], ['in', 'correction', 'ABA', '2026-10-05 01:00:00', 5])
  // An undone payment is not live: the correction falls back to the one before it.
  const undone = [deposit, settle, event({ id: 3, event_id: 'op:1:out', direction: 'out', origin: 'undo', reverses_event_id: 'op:0:in' })]
  assert.equal(W.correctionAnchor(undone, tender).event.event_id, 'checkout:7')
})

check('the collecting branch is the active successor of a retired branch (red: the retired branch, which has no drawer)', () => {
  const directory = [{ id: 1, name: 'Old Shop', is_active: 0, successor_branch_id: 2 }, { id: 2, name: 'LC Store', is_active: 1, successor_branch_id: null }, { id: 3, name: 'Gone', is_active: 0, successor_branch_id: null }]
  assert.equal(W.collectingBranchId(directory, 1), 2)
  assert.equal(W.collectingBranchId(directory, 2), 2)
  assert.equal(W.collectingBranchId(directory, 3), 3)
  assert.equal(W.collectingBranchId(directory, null), null)
})

check('instalment rows merge per method key and keep the first label (red: the list grows past the row limit)', () => {
  assert.deepEqual(W.mergeTenderRows([{ method: 'Cash', amount_usd: 3, amount_khr: 0 }, { method: 'ABA', amount_usd: 4, amount_khr: 0 }, { method: 'cash', amount_usd: 0.1, amount_khr: 12000 }]),
    [{ method: 'Cash', amount_usd: 3.1, amount_khr: 12000 }, { method: 'ABA', amount_usd: 4, amount_khr: 0 }])
})

check('an opening that cannot be built keeps the sale on version 0 instead of failing the payment (red: throws)', () => {
  assert.deepEqual(W.openingDecision({ id: 7, payments_version: 0, amount_paid_usd: 1, exchange_rate: 4000, created_at: 'not a time' }), { kind: 'stay_version0', reason: 'payment_event_time_required' })
  const opened = W.openingDecision({ id: 7, payments_version: 0, amount_paid_usd: 1, exchange_rate: 4000, payment_method: 'Cash', created_at: '2026-08-20T03:00:00.000Z' })
  assert.equal(opened.event.received_at, '2026-08-20 03:00:00')
  assert.deepEqual(W.openingDecision({ id: 7, payments_version: 1 }), { kind: 'version1' })
})

check('the checkout event is copied from the sale row in SQL, canonical time, only when money was paid', () => {
  const sql = W.checkoutPaymentEventStatement('key').sql
  assert.match(sql, /strftime\('%Y-%m-%d %H:%M:%S', s\.created_at\)/)
  assert.match(sql, /COALESCE\(s\.amount_paid_usd,0\)>0 OR COALESCE\(s\.amount_paid_khr,0\)>0/)
})

check('a refund_credit row is never merged and keeps its flag; plain rows still merge (red: rebuilt as method + amounts)', () => {
  const rows = W.storedTenderRows('[{"method":"Cash","amount_usd":5,"amount_khr":0,"refund_credit":true},{"method":"Cash","amount_usd":2,"amount_khr":0},{"method":"cash","amount_usd":1,"amount_khr":0}]')
  assert.deepEqual(W.mergeTenderRows(rows), [{ method: 'Cash', amount_usd: 5, amount_khr: 0, refund_credit: true }, { method: 'Cash', amount_usd: 3, amount_khr: 0 }])
})

check('the change a correction takes back is the net change of the events, not the sale columns (red: only the last payment change)', () => {
  const evs = [event({ event_id: 'a', change_usd: 1, change_is_actual: 1, change_exchange_rate: 4000 }), event({ event_id: 'b', change_usd: 2, change_is_actual: 1, change_exchange_rate: 4100 }),
    event({ event_id: 'c', direction: 'out', origin: 'undo', reverses_event_id: 'zz', change_usd: 0.5, change_is_actual: 1, change_exchange_rate: 4000 })]
  assert.deepEqual(W.netEventChange(evs), { change_usd: 2.5, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000 })
  assert.equal(W.netEventChange([...evs, event({ event_id: 'd', change_usd: 1, change_is_actual: 0 })]).change_is_actual, 0)
  const anchor = W.correctionAnchor(evs.slice(0, 2), event({ event_id: 'tender', change_usd: 2, change_is_actual: 1 }))
  assert.equal(anchor.tender.change_usd, 3)
})

check('a correction carries the refund credit: the customer tender is the sale minus the credit (red: whole tender or credit lost)', () => {
  const sale = { id: 9, amount_paid_usd: 16, amount_paid_khr: 0, payment_method: 'Cash + ABA', exchange_rate: 4000, created_at: '2026-10-01 03:00:00',
    payment_details: '[{"method":"Cash","amount_usd":5,"amount_khr":0,"refund_credit":true},{"method":"ABA","amount_usd":11,"amount_khr":0}]' }
  const split = W.splitRefundCredit(sale)
  assert.deepEqual([split.creditUsd, split.creditKhr, split.creditRows.length, split.creditRows[0].refund_credit], [5, 0, 1, true])
  assert.deepEqual([split.customerSale.amount_paid_usd, split.customerSale.payment_method, JSON.parse(split.customerSale.payment_details)], [11, 'ABA', [{ method: 'ABA', amount_usd: 11, amount_khr: 0 }]])
  const tender = W.saleTenderEvent(split.customerSale, '2026-10-01 03:00:00')
  assert.equal(tender.amount_paid_usd, 11)
  // No credit: the sale passes through unchanged. A credit larger than the recorded total is refused (null), never clamped.
  const plain = { ...sale, payment_details: '[{"method":"Cash","amount_usd":16,"amount_khr":0}]' }
  assert.equal(W.splitRefundCredit(plain).customerSale, plain)
  assert.equal(W.splitRefundCredit({ ...sale, amount_paid_usd: 4 }), null)
})

console.log(`${passed} checks passed`)
