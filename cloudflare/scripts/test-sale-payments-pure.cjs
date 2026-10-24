'use strict'
// Pins the pure money core of sale payment events (lane 6.0.972 slice S2, cloudflare/src/lib/salePayments.ts).
// The module is inert: nothing imports it yet. Every case here is chosen so the plausible wrong rule gives a
// different answer than the right one (each is named in its title); frontend/tests/salePaymentsParity.test.ts
// proves the frontend mirror answers the same.
//
// Run: node scripts/test-sale-payments-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}
const financialPrecision = compile('financialPrecision.ts')
const saleStatusResolution = compile('saleStatusResolution.ts', { './financialPrecision': financialPrecision })
const core = compile('salePayments.ts', { './financialPrecision': financialPrecision, './saleStatusResolution': saleStatusResolution })

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const code = (fn) => { try { fn() } catch (error) { return error.code } return null }

// A $10 sale at 4000 riel, V1 money, Not Paid unless a case says otherwise.
const sale = (overrides = {}) => ({ sale_status: 'awaiting_payment', total_usd: 10, exchange_rate: 4000, money_precision_version: 1, ...overrides })
const derive = (overrides = {}, paid = {}, cause = 'payment', lowered = 0) =>
  core.deriveSalePaymentState({ sale: sale(overrides), paidUsd: paid.usd ?? 0, paidKhr: paid.khr ?? 0, debtLoweredUsd: lowered, cause })
const tender = (usd, khr = 0, method = 'Cash') => [{ method, amount_usd: usd, amount_khr: khr }]
const event = (overrides = {}) => core.buildPaymentEvent({ eventId: 'e1', saleId: 7, direction: 'in', origin: 'collect', tender: tender(3), exchangeRate: 4000, receivedAt: '2026-10-25 03:00:00', ...overrides })

// --- status from money ---
check('half-cent edge: short by exactly $0.005 is covered, short by $0.0051 is not (a float or a cent-rounding rule moves it)', () => {
  assert.equal(derive({}, { usd: 9.995 }).saleStatus, 'completed')
  assert.equal(derive({}, { usd: 9.9949 }).saleStatus, 'awaiting_payment')
  assert.equal(derive({}, { usd: 9.9949 }).owedUsd, 0.0051)
  assert.equal(derive({}, { usd: 9.995 }).owedUsd, 0)
})

check('riel-only payment counts at the sale rate: 40,000 covers $10 at 4,000; 20,000 is half and leaves Part paid', () => {
  assert.equal(derive({}, { khr: 40000 }).saleStatus, 'completed')
  assert.equal(derive({}, { khr: 39980 }).saleStatus, 'completed', '20 riel short = exactly $0.005')
  assert.equal(derive({}, { khr: 39979 }).saleStatus, 'awaiting_payment', '21 riel short is past the band')
  const half = derive({}, { khr: 20000 })
  assert.deepEqual([half.saleStatus, half.owedUsd, half.partPaid], ['awaiting_payment', 5, true])
  assert.equal(derive({}, { usd: 2, khr: 20000 }).owedUsd, 3, 'dollars and riel add')
})

check('a return that lowers the debt to $0 leaves the sale Not Paid; the same debt-lowered figure from a payment completes it', () => {
  const byReturn = derive({}, {}, 'return', 10)
  assert.deepEqual([byReturn.saleStatus, byReturn.owedUsd, byReturn.covered, byReturn.partPaid], ['awaiting_payment', 0, true, false])
  assert.equal(derive({}, {}, 'payment', 10).saleStatus, 'completed')
  assert.equal(derive({}, {}, 'amendment', 10).saleStatus, 'completed')
  const partial = derive({}, { usd: 3 }, 'return', 4)
  assert.deepEqual([partial.saleStatus, partial.owedUsd, partial.partPaid], ['awaiting_payment', 3, true], 'the return lowers the debt first')
})

check('a return never moves a Completed sale either, even when the money no longer covers it', () => {
  assert.equal(derive({ sale_status: 'completed' }, { usd: 4 }, 'return', 0).saleStatus, 'completed')
  assert.equal(derive({ sale_status: 'completed' }, { usd: 4 }, 'payment', 0).saleStatus, 'awaiting_payment', 'control: a payment write re-derives')
})

check('lowering the total to covered gives Completed; the control that is still short stays Not Paid', () => {
  assert.equal(derive({ total_usd: 8 }, { usd: 8 }, 'amendment').saleStatus, 'completed')
  assert.equal(derive({ total_usd: 10 }, { usd: 8 }, 'amendment').saleStatus, 'awaiting_payment')
  assert.equal(derive({ sale_status: 'completed', total_usd: 13 }, { usd: 10 }, 'amendment').saleStatus, 'awaiting_payment', 'a raise moves Completed to Not Paid')
})

check('Cancelled is separate and never re-derived; retired return labels read as their payment state', () => {
  const cancelled = derive({ sale_status: 'cancelled' }, { usd: 10 })
  assert.deepEqual([cancelled.saleStatus, cancelled.partPaid], ['cancelled', false])
  assert.equal(derive({ sale_status: 'cancelled' }, { usd: 3 }).partPaid, false)
  assert.equal(derive({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }, { usd: 10 }).saleStatus, 'completed')
  assert.equal(derive({ sale_status: 'awaiting_delivery' }, { usd: 3 }).saleStatus, 'awaiting_payment')
})

check('unreadable sale money throws instead of guessing a status', () => {
  assert.throws(() => derive({ exchange_rate: 0 }, { usd: 10 }))
  assert.throws(() => derive({ total_usd: null }, { usd: 10 }))
})

// --- instalments and reversals through the event sums ---
const money = (direction, usd, khr = 0) => ({ direction, amount_paid_usd: usd, amount_paid_khr: khr })
const statusOf = (events, overrides = {}) => {
  const net = core.netPaymentTotals(events)
  return derive(overrides, { usd: net.paidUsd, khr: net.paidKhr })
}

check('instalments: $4 then 12,000 riel then $3 reach Completed only on the last, and Part paid shows in between', () => {
  const first = statusOf([money('in', 4)])
  assert.deepEqual([first.saleStatus, first.partPaid, first.owedUsd], ['awaiting_payment', true, 6])
  const second = statusOf([money('in', 4), money('in', 0, 12000)])
  assert.deepEqual([second.saleStatus, second.partPaid, second.owedUsd], ['awaiting_payment', true, 3])
  const third = statusOf([money('in', 4), money('in', 0, 12000), money('in', 3)])
  assert.deepEqual([third.saleStatus, third.partPaid, third.owedUsd], ['completed', false, 0])
})

check('an out event reverses an in event: in $10 then out $10 is Not Paid with nothing paid; out $4 leaves $6 paid', () => {
  assert.deepEqual(core.netPaymentTotals([money('in', 10), money('out', 10)]), { paidUsd: 0, paidKhr: 0 })
  const reversed = statusOf([money('in', 10), money('out', 10)], { sale_status: 'completed' })
  assert.deepEqual([reversed.saleStatus, reversed.partPaid, reversed.owedUsd], ['awaiting_payment', false, 10])
  const partly = statusOf([money('in', 10), money('out', 4)], { sale_status: 'completed' })
  assert.deepEqual([partly.saleStatus, partly.partPaid, partly.owedUsd], ['awaiting_payment', true, 4])
  assert.deepEqual(core.netPaymentTotals([money('in', 0.1), money('in', 0.2)]), { paidUsd: 0.3, paidKhr: 0 }, 'exact, not 0.30000000000000004')
  assert.equal(core.netPaymentTotals([money('out', 1)]).paidUsd, -1, 'never clamped: more out than in is visible')
})

check('Part paid is only Not Paid with money taken, in either currency', () => {
  assert.equal(core.salePartPaid('awaiting_payment', 0, 0), false)
  assert.equal(core.salePartPaid('awaiting_payment', 0.01, 0), true)
  assert.equal(core.salePartPaid('awaiting_payment', 0, 100), true)
  assert.equal(core.salePartPaid('completed', 10, 0), false)
  assert.equal(core.salePartPaid('cancelled', 3, 0), false)
})

// --- building events ---
check('an event sums its tender rows exactly, joins distinct methods, and records the real time and cashier', () => {
  const built = event({ tender: [{ method: 'Cash', amount_usd: 0.1, amount_khr: 0 }, { method: 'ABA', amount_usd: 0.2, amount_khr: 4000 }, { method: 'Cash', amount_usd: 0, amount_khr: 100 }], branchId: 2, cashierId: 5, cashierName: 'Dara', operationId: 'op-1', coversOperationId: 'g1' })
  assert.equal(built.amount_paid_usd, 0.3)
  assert.equal(built.amount_paid_khr, 4100)
  assert.equal(built.payment_method, 'Cash + ABA')
  assert.deepEqual(JSON.parse(built.payment_details), [{ method: 'Cash', amount_usd: 0.1, amount_khr: 0 }, { method: 'ABA', amount_usd: 0.2, amount_khr: 4000 }, { method: 'Cash', amount_usd: 0, amount_khr: 100 }])
  assert.deepEqual([built.event_id, built.sale_id, built.direction, built.origin, built.drawer_effect, built.received_at, built.branch_id, built.cashier_id, built.cashier_name, built.operation_id, built.covers_operation_id],
    ['e1', 7, 'in', 'collect', 1, '2026-10-25 03:00:00', 2, 5, 'Dara', 'op-1', 'g1'])
})

check('a late-recorded payment keeps its real past date and counts in no drawer, and refuses an explicit drawer', () => {
  const late = event({ origin: 'late_record', receivedAt: '2026-09-02 08:00:00' })
  assert.deepEqual([late.drawer_effect, late.received_at], [0, '2026-09-02 08:00:00'])
  assert.equal(code(() => event({ origin: 'late_record', drawerEffect: 1 })), 'payment_event_late_drawer')
  assert.equal(event({ origin: 'collect', drawerEffect: 0 }).drawer_effect, 0, 'other origins may opt out')
})

check('direction and origin must agree: undo is out and names its target, redo is in, only undo and correction take money out', () => {
  const undo = event({ origin: 'undo', direction: 'out', reversesEventId: 'e0' })
  assert.deepEqual([undo.direction, undo.reverses_event_id, undo.change_usd], ['out', 'e0', 0])
  assert.equal(code(() => event({ origin: 'undo', direction: 'out' })), 'payment_event_reversal_target_required')
  assert.equal(code(() => event({ origin: 'undo', direction: 'in', reversesEventId: 'e0' })), 'payment_event_direction_invalid')
  assert.equal(code(() => event({ origin: 'redo', direction: 'out' })), 'payment_event_direction_invalid')
  assert.equal(code(() => event({ origin: 'collect', direction: 'out' })), 'payment_event_direction_invalid')
  assert.equal(event({ origin: 'correction', direction: 'out' }).direction, 'out')
  assert.equal(event({ origin: 'redo' }).direction, 'in')
  assert.equal(code(() => event({ origin: 'opening' })), 'payment_event_origin_invalid', 'the opening event has its own builder')
  assert.equal(code(() => event({ origin: 'gift' })), 'payment_event_origin_invalid')
})

check('an event refuses: no id, no rows, no money, a negative or unreadable amount, a bad rate, no time, a long note', () => {
  assert.equal(code(() => event({ eventId: ' ' })), 'payment_event_id_required')
  assert.equal(code(() => event({ tender: [] })), 'payment_event_tender_required')
  assert.equal(code(() => event({ tender: tender(3, 0, '  ') })), 'payment_event_tender_required')
  assert.equal(code(() => event({ tender: tender(0, 0) })), 'payment_event_no_money')
  assert.equal(code(() => event({ tender: tender(-1, 0) })), 'payment_event_amount_invalid')
  assert.equal(code(() => event({ tender: tender(Number.NaN, 0) })), 'payment_event_amount_invalid')
  assert.equal(code(() => event({ tender: tender('abc', 0) })), 'payment_event_amount_invalid')
  assert.equal(code(() => event({ exchangeRate: 0 })), 'payment_event_rate_invalid')
  assert.equal(code(() => event({ exchangeRate: -4000 })), 'payment_event_rate_invalid')
  assert.equal(code(() => event({ receivedAt: '' })), 'payment_event_time_required')
  assert.equal(code(() => event({ note: 'x'.repeat(501) })), 'payment_event_note_too_long')
  assert.equal(event({ note: 'x'.repeat(500) }).note.length, 500)
})

check('change rides an incoming event and never an outgoing one', () => {
  const withChange = event({ tender: tender(10), change: { usd: 0, khr: 12000, isActual: true, exchangeRate: 4000 } })
  assert.deepEqual([withChange.change_khr, withChange.change_is_actual, withChange.change_exchange_rate], [12000, 1, 4000])
  const out = event({ origin: 'undo', direction: 'out', reversesEventId: 'e0', change: { usd: 5, khr: 0, isActual: true, exchangeRate: 4000 } })
  assert.deepEqual([out.change_usd, out.change_is_actual, out.change_exchange_rate], [0, 0, null])
})

check('the opening event copies the sale tender at the sale time, so SUM(events) equals the sale columns', () => {
  const details = '[{"method":"Cash","amount_usd":5,"amount_khr":0},{"method":"ABA","amount_usd":0,"amount_khr":20000}]'
  const opening = core.buildOpeningPaymentEvent({ id: 16860, payment_method: 'Cash + ABA', payment_details: details,
    amount_paid_usd: 5, amount_paid_khr: 20000, change_usd: 0, change_khr: 100, change_is_actual: 1, change_exchange_rate: 4000, exchange_rate: 4100,
    created_at: '2026-09-01 02:00:00', branch_id: 1, cashier_id: 3, cashier_name: 'Sokha' })
  assert.deepEqual([opening.event_id, opening.origin, opening.direction, opening.drawer_effect, opening.received_at, opening.amount_paid_usd, opening.amount_paid_khr, opening.exchange_rate, opening.cashier_id],
    ['opening:16860', 'opening', 'in', 1, '2026-09-01 02:00:00', 5, 20000, 4100, 3])
  assert.equal(opening.payment_details, details, 'a stored details list is kept verbatim')
  assert.deepEqual(core.netPaymentTotals([opening]), { paidUsd: 5, paidKhr: 20000 })
})

check('the opening event synthesises details when the stored list is empty, invalid or missing; null for a sale with nothing paid; throws on no rate', () => {
  const base = { id: 1, payment_method: 'ABA', amount_paid_usd: 4, amount_paid_khr: 0, exchange_rate: 4000, created_at: '2026-09-01 02:00:00' }
  for (const bad of [undefined, null, '', '[]', 'not json', '{"a":1}']) {
    assert.deepEqual(JSON.parse(core.buildOpeningPaymentEvent({ ...base, payment_details: bad }).payment_details), [{ method: 'ABA', amount_usd: 4, amount_khr: 0 }])
  }
  assert.equal(core.buildOpeningPaymentEvent({ ...base, payment_method: null }).payment_method, 'Cash')
  assert.equal(core.buildOpeningPaymentEvent({ ...base, amount_paid_usd: 0, amount_paid_khr: 0 }), null)
  assert.equal(core.buildOpeningPaymentEvent({ ...base, amount_paid_usd: null, amount_paid_khr: null }), null)
  assert.equal(code(() => core.buildOpeningPaymentEvent({ ...base, exchange_rate: 0 })), 'payment_event_rate_invalid')
})

// --- allocation to operation groups ---
const alloc = (groups, events, debtLoweredUsd = 0) => core.allocatePaymentsToGroups({ groups, events, debtLoweredUsd })
const ev = (direction, usd, covers = null, khr = 0, rate = 4000) => ({ direction, amount_paid_usd: usd, amount_paid_khr: khr, covers_operation_id: covers, exchange_rate: rate })
const POS = (amountUsd) => ({ id: null, amountUsd })
const view = (result) => result.groups.map(group => `${group.id ?? 'pos'}:${group.tag}:${group.paidUsd}/${group.owedUsd}`)

check('unlinked money pays the POS group first: $10 on a $10 POS + $3 added leaves the addition Unpaid', () => {
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 10)])), ['pos:paid:10/0', 'g1:unpaid:0/3'])
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 8)])), ['pos:part_paid:8/2', 'g1:unpaid:0/3'])
})

check('linked money goes to its group first: $3 linked to the addition pays it, not the POS group', () => {
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 3, 'g1')])), ['pos:unpaid:0/10', 'g1:paid:3/0'])
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 10), ev('in', 3, 'g1')])), ['pos:paid:10/0', 'g1:paid:3/0'])
})

check('the POS group is first even when listed last; the rest fill oldest first in the order given', () => {
  assert.deepEqual(view(alloc([{ id: 'g1', amountUsd: 3 }, { id: 'g2', amountUsd: 4 }, POS(10)], [ev('in', 12)])), ['g1:part_paid:2/1', 'g2:unpaid:0/4', 'pos:paid:10/0'])
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }, { id: 'g2', amountUsd: 4 }], [ev('in', 15)])), ['pos:paid:10/0', 'g1:paid:3/0', 'g2:part_paid:2/2'])
})

check('an out event linked to a group reverses it; an unlinked out reduces the shared pool', () => {
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 3, 'g1'), ev('out', 3, 'g1')])), ['pos:unpaid:0/10', 'g1:unpaid:0/3'])
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 13), ev('out', 5)])), ['pos:part_paid:8/2', 'g1:unpaid:0/3'])
})

check('riel money counts at its own event rate, and a partly paid group is Part paid', () => {
  assert.deepEqual(view(alloc([POS(10)], [ev('in', 0, null, 40000, 4000)])), ['pos:paid:10/0'])
  assert.deepEqual(view(alloc([POS(10)], [ev('in', 0, null, 20500, 4100)])), ['pos:part_paid:5/5'])
  assert.deepEqual(view(alloc([POS(10)], [ev('in', 0, null, 39980, 4000)])), ['pos:paid:9.995/0.005'], 'inside the half-cent band is Paid')
  assert.deepEqual(view(alloc([POS(10)], [ev('in', 9.9949)])), ['pos:part_paid:9.9949/0.0051'])
})

check('debt lowered by a return counts as credit before cash: a $13 sale with $10 paid and $3 lowered is all Paid', () => {
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 10)], 3)), ['pos:paid:10/0', 'g1:paid:3/0'])
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: 3 }], [], 10)), ['pos:paid:10/0', 'g1:unpaid:0/3'])
})

check('overpaying a group spills its excess to the pool; money linked to an unlisted group is not lost', () => {
  const spill = alloc([POS(10), { id: 'g1', amountUsd: 3 }], [ev('in', 5, 'g1')])
  assert.deepEqual(view(spill), ['pos:part_paid:2/8', 'g1:paid:3/0'])
  assert.deepEqual(view(alloc([POS(10)], [ev('in', 10, 'ghost')])), ['pos:paid:10/0'])
  assert.equal(alloc([POS(10)], [ev('in', 12)]).unallocatedUsd, 2)
  assert.equal(alloc([POS(10)], [ev('in', 4), ev('out', 9)]).unallocatedUsd, 0, 'a pool never goes negative')
})

check('a group that lowered the total needs nothing and reads Paid; duplicate or double POS groups are refused', () => {
  assert.deepEqual(view(alloc([POS(10), { id: 'g1', amountUsd: -2 }], [ev('in', 10)])), ['pos:paid:10/0', 'g1:paid:0/0'])
  assert.throws(() => alloc([POS(10), POS(5)], []), /one POS/)
  assert.throws(() => alloc([{ id: 'g1', amountUsd: 1 }, { id: 'g1', amountUsd: 1 }], []), /unique/)
})

console.log(`\n${passed} checks passed`)
