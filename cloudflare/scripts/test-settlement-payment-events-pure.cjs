'use strict'
// Pins the pure settlement event planner (lib/settlementPaymentEvents.ts), the change-carrying out event
// (lib/salePayments.ts) and the added-rows-only settlement plan (lib/paymentSettlement.ts). Slice S0 of
// Records/Design/2026-11-10/LATER-PAYMENT-SHIFT-PLAN.md. Every case names the plausible wrong rule it separates.
//
// SPE_MUTANT=<name> runs the same cases against a deliberately wrong implementation; each must go red:
//   out_drops_change  collect_recounts_old  correction_out_no_change  collect_uses_whole_tender  opening_at_now
//   undo_reverses_self  negative_change_allowed  change_whole_not_delta  undo_ignores_opening
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const MUTANT = process.env.SPE_MUTANT || ''
const mutations = {
  out_drops_change: ['salePayments.ts', 'const change = input.change ?? null', 'const change = input.direction === "out" ? null : input.change ?? null'],
  collect_recounts_old: ['paymentSettlement.ts', 'if (!preserved) addedPaymentDetails.push', 'addedPaymentDetails.push'],
  correction_out_no_change: ['settlementPaymentEvents.ts', 'change: stateChange(outState)', 'change: void 0'],
  collect_uses_whole_tender: ['settlementPaymentEvents.ts', 'mode === "apply" && input.addedPaymentDetails ? [...input.addedPaymentDetails] : addedRows(input.before, input.after)', 'tenderRows(input.after)'],
  opening_at_now: ['settlementPaymentEvents.ts', 'const opening = converts ? buildOpeningPaymentEvent(sale) : null', 'const opening = converts ? { ...buildOpeningPaymentEvent(sale), received_at: input.now } : null'],
  undo_reverses_self: ['settlementPaymentEvents.ts', 'const previous = input.generation - 1', 'const previous = input.generation'],
  negative_change_allowed: ['settlementPaymentEvents.ts', 'if (usd < 0 || khr < 0) fail3(', 'if (false) fail3('],
  change_whole_not_delta: ['settlementPaymentEvents.ts', 'const usd = Math.round((a.usd - b.usd) * 1e4) / 1e4', 'const usd = a.usd'],
  undo_ignores_opening: ['settlementPaymentEvents.ts', 'const reversesOpening = converts && opening ? opening.event_id : null', 'const reversesOpening = null'],
}

function load(entry, mutate) {
  const out = buildSync({
    stdin: { contents: entry, resolveDir: path.join(__dirname, '..', 'src', 'lib'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
    external: ['cloudflare:*', 'node:*'],
  })
  let text = out.outputFiles[0].text
  const mutation = mutations[MUTANT]
  if (mutate && mutation) {
    assert.ok(text.includes(mutation[1]), `mutation anchor present for ${MUTANT}`)
    text = text.replace(mutation[1], () => mutation[2])
  }
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', text)(require, loaded, loaded.exports)
  return loaded.exports
}
if (MUTANT) assert.ok(mutations[MUTANT], 'known mutant')

const core = load(["settlementPaymentEvents", "salePayments", "paymentSettlement", "saleStatusResolution"].map((m) => `export * from './${m}'`).join('; '), true)
const shift = load("export * from './shiftReconciliation'", false)
const planner = core
const payments = core
const settlement = core
const { planSettlementPaymentEvents, SettlementEventError } = planner
const { planSaleSettlement, SettlementValidationError } = settlement

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const code = (fn) => { try { fn() } catch (error) { return error.code } return null }

const NOW = '2026-11-12 03:30:00'
const CREATED = '2026-11-10T02:15:00.000Z'
const money = (v) => Math.round(v * 1e4) / 1e4

// A sale's payment columns from a tender (rows) and the change handed back.
const state = (rows, change = {}, extra = {}) => ({
  payment_method: [...new Set(rows.map((r) => r.method))].join(' + '),
  payment_details: JSON.stringify(rows),
  amount_paid_usd: money(rows.reduce((s, r) => s + r.amount_usd, 0)),
  amount_paid_khr: money(rows.reduce((s, r) => s + r.amount_khr, 0)),
  change_usd: change.usd ?? 0, change_khr: change.khr ?? 0, change_is_actual: change.usd || change.khr ? 1 : 0, change_exchange_rate: change.usd || change.khr ? 4000 : null,
  exchange_rate: 4000, ...extra,
})
const cash = (usd, khr = 0) => ({ method: 'Cash', amount_usd: usd, amount_khr: khr })
const aba = (usd, khr = 0) => ({ method: 'ABA', amount_usd: usd, amount_khr: khr })
const saleRow = (st, over = {}) => ({ id: 77, created_at: CREATED, branch_id: 1, cashier_id: 5, cashier_name: 'Ring', payments_version: 0, ...st, ...over })
const who = { cashierId: 9, cashierName: 'Collector', drawerBranchId: 2 }
const plan = (over) => planSettlementPaymentEvents({ operationId: 'op1', generation: 0, now: NOW, correction: false, mode: 'apply', ...who, ...over })

// The reader the drawer uses, fed event rows exactly as shiftPaymentEventRows shapes them.
const asRow = (e, total) => ({ ...e, sale_status: 'completed', total_usd: e.direction === 'out' ? undefined : total })
const drawer = (events, total) => {
  const r = shift.summarizeShiftCashEvents(events.map((e) => asRow(e, total)), {})
  return { usd: r.usd, khr: r.khr, dUsd: r.digital.usd, dKhr: r.digital.khr, codes: r.reviewCodes }
}
const drawerOfState = (st, total) => {
  const r = shift.summarizeShiftCashDetail([{ ...st, sale_status: 'completed', total_usd: total }], {})
  return { usd: r.usd, khr: r.khr, dUsd: r.digital.usd, dKhr: r.digital.khr, codes: r.reviewCodes }
}
const all = (plans) => plans.flatMap((p) => [...(p.opening ? [p.opening] : []), ...p.events])

// --- the change defect -------------------------------------------------------
check('an out event carries the change of the tender it reverses: $20 cash with $5 change corrected to ABA $15 leaves the drawer at 0 cash, not -$5', () => {
  const before = state([cash(20)], { usd: 5 })
  const after = state([aba(15)])
  const p = plan({ sale: saleRow(before), before, after, correction: true })
  const events = all([p])
  assert.deepEqual(events.map((e) => [e.origin, e.direction, e.amount_paid_usd, e.change_usd, e.received_at]),
    [['opening', 'in', 20, 5, '2026-11-10 02:15:00'], ['correction', 'out', 20, 5, '2026-11-12 03:30:00'], ['correction', 'in', 15, 0, '2026-11-12 03:30:00']])
  assert.deepEqual(drawer(events, 15), { usd: 0, khr: 0, dUsd: 15, dKhr: 0, codes: [] }, 'all windows together')
  assert.deepEqual(drawer(events.slice(0, 1), 15), { usd: 15, khr: 0, dUsd: 0, dKhr: 0, codes: [] }, 'creation shift keeps its $15 net')
  assert.deepEqual(drawer(events.slice(1), 15), { usd: -15, khr: 0, dUsd: 15, dKhr: 0, codes: [] }, 'the correction shift: cash -15, digital +15')
})

check('buildPaymentEvent keeps the change on an out (undo and correction) and still refuses an out of any other origin', () => {
  const out = payments.buildPaymentEvent({ eventId: 'o', saleId: 1, direction: 'out', origin: 'undo', reversesEventId: 'e0', tender: [cash(5)], exchangeRate: 4000, receivedAt: NOW, change: { usd: 5, khr: 0, isActual: true, exchangeRate: 4000 } })
  assert.deepEqual([out.change_usd, out.change_is_actual, out.change_exchange_rate], [5, 1, 4000])
  assert.equal(code(() => payments.buildPaymentEvent({ eventId: 'o', saleId: 1, direction: 'out', origin: 'collect', tender: [cash(5)], exchangeRate: 4000, receivedAt: NOW })), 'payment_event_direction_invalid')
})

// --- collect delta -----------------------------------------------------------
const settle = (existing, request, total, extra = {}) => planSaleSettlement({
  configuredMethodsRaw: '["Cash","ABA"]', paymentDetailsRaw: request, totalUsd: total, exchangeRate: 4000, moneyPrecisionVersion: 1,
  existingPaidUsd: existing.reduce((s, r) => s + r.amount_usd, 0), existingPaidKhr: existing.reduce((s, r) => s + r.amount_khr, 0),
  existingPaymentDetailsRaw: JSON.stringify(existing), existingPaymentMethodRaw: 'Cash', ...extra,
})
const afterOf = (p) => ({ payment_method: p.paymentMethod, payment_details: p.paymentDetailsJson, amount_paid_usd: p.amountPaidUsd, amount_paid_khr: p.amountPaidKhr,
  change_usd: p.changeUsd, change_khr: p.changeKhr, change_is_actual: 0, change_exchange_rate: p.changeExchangeRate, exchange_rate: p.exchangeRate })

check('settlement plan exposes only the rows the request added: a $10 deposit plus [Cash 10, Cash 40] adds Cash 40, never $50', () => {
  const p = settle([cash(10)], [cash(10), cash(40)], 50)
  assert.deepEqual(p.addedPaymentDetails, [{ method: 'Cash', amount_usd: 40, amount_khr: 0 }])
  assert.equal(p.amountPaidUsd, 50, 'the stored tender is still the whole thing')
  const dup = settle([cash(10)], [cash(10), cash(10)], 20)
  assert.deepEqual(dup.addedPaymentDetails, [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], 'duplicate same-method rows match only one recorded row')
  const none = settle([], [cash(25)], 25)
  assert.deepEqual(none.addedPaymentDetails, none.paymentDetails, 'a sale with no money yet adds every row')
})

check('the collect event holds only new money: opening $10 at creation, collect $40 at now by the collector, net $50', () => {
  const before = state([cash(10)])
  const p = settle([cash(10)], [cash(10), cash(40)], 50)
  const after = afterOf(p)
  const out = plan({ sale: saleRow(before), before, after, addedPaymentDetails: p.addedPaymentDetails })
  const [opening, collect] = all([out])
  assert.deepEqual([opening.origin, opening.amount_paid_usd, opening.received_at, opening.cashier_id, opening.branch_id], ['opening', 10, '2026-11-10 02:15:00', 5, 1])
  assert.deepEqual([collect.origin, collect.direction, collect.amount_paid_usd, collect.received_at, collect.cashier_id, collect.cashier_name, collect.branch_id, collect.event_id, collect.operation_id],
    ['collect', 'in', 40, NOW, 9, 'Collector', 2, 'settle:op1:0', 'op1'])
  assert.deepEqual(payments.netPaymentTotals(all([out])), { paidUsd: 50, paidKhr: 0 })
  assert.equal(out.convertsToVersion1, true)
})

check('a version 1 sale writes no second opening', () => {
  const before = state([cash(10)])
  const p = settle([cash(10)], [cash(10), cash(40)], 50)
  const out = plan({ sale: saleRow(before, { payments_version: 1 }), before, after: afterOf(p), addedPaymentDetails: p.addedPaymentDetails })
  assert.equal(out.opening, null)
  assert.equal(out.events.length, 1)
  assert.equal(out.convertsToVersion1, false)
})

// --- change delta ------------------------------------------------------------
check('the collect carries the change that grew (after - before), not the whole after change', () => {
  const before = state([cash(40)], { usd: 2 })
  const after = state([cash(40), cash(20)], { usd: 7 })
  const out = plan({ sale: saleRow(before, { payments_version: 1 }), before, after, addedPaymentDetails: [cash(20)] })
  assert.deepEqual([out.events[0].change_usd, out.events[0].change_khr, out.events[0].change_is_actual, out.events[0].change_exchange_rate], [5, 0, 1, 4000])
})

check('a settlement that lowered the change is refused as settlement_change_unreadable, not recorded as negative money', () => {
  const before = state([cash(40)], { usd: 5 })
  const after = state([cash(40), cash(20)], { usd: 1 })
  assert.equal(code(() => plan({ sale: saleRow(before, { payments_version: 1 }), before, after, addedPaymentDetails: [cash(20)] })), 'settlement_change_unreadable')
})

// --- correction pair ---------------------------------------------------------
check('a correction is an out of the whole old tender and an in of the whole new tender, both at now, ids :out and :in', () => {
  const before = state([cash(30), aba(0, 8000)], { khr: 400 })
  const after = state([aba(40)])
  const out = plan({ sale: saleRow(before, { payments_version: 1 }), before, after, correction: true, generation: 0 })
  assert.deepEqual(out.events.map((e) => [e.event_id, e.direction, e.origin, e.amount_paid_usd, e.amount_paid_khr, e.change_khr, e.received_at, e.reverses_event_id]),
    [['settle:op1:0:out', 'out', 'correction', 30, 8000, 400, NOW, null], ['settle:op1:0:in', 'in', 'correction', 40, 0, 0, NOW, null]])
  assert.equal(out.opening, null)
})

// --- ids and reversal chain --------------------------------------------------
check('undo and redo ids follow the generation: undo :1 reverses :0, redo :2, undo :3 reverses :2', () => {
  const before = state([cash(10)])
  const after = state([cash(10), cash(40)])
  const base = { sale: saleRow(after, { payments_version: 1 }), before, after }
  const undo1 = plan({ ...base, mode: 'undo', generation: 1 }).events[0]
  assert.deepEqual([undo1.event_id, undo1.direction, undo1.origin, undo1.reverses_event_id, undo1.amount_paid_usd, undo1.received_at], ['settle:op1:1', 'out', 'undo', 'settle:op1:0', 40, NOW])
  const redo2 = plan({ ...base, sale: saleRow(before, { payments_version: 1 }), mode: 'redo', generation: 2 }).events[0]
  assert.deepEqual([redo2.event_id, redo2.direction, redo2.origin, redo2.amount_paid_usd], ['settle:op1:2', 'in', 'redo', 40])
  const undo3 = plan({ ...base, mode: 'undo', generation: 3 }).events[0]
  assert.deepEqual([undo3.event_id, undo3.reverses_event_id], ['settle:op1:3', 'settle:op1:2'])
})

check('a correction replay swaps the pair and its out reverses the previous generation in', () => {
  const before = state([cash(20)], { usd: 5 })
  const after = state([aba(15)])
  const base = { sale: saleRow(after, { payments_version: 1 }), before, after, correction: true }
  const undo = plan({ ...base, mode: 'undo', generation: 1 }).events
  assert.deepEqual(undo.map((e) => [e.event_id, e.direction, e.origin, e.amount_paid_usd, e.payment_method, e.change_usd, e.reverses_event_id]),
    [['settle:op1:1:out', 'out', 'undo', 15, 'ABA', 0, 'settle:op1:0:in'], ['settle:op1:1:in', 'in', 'correction', 20, 'Cash', 5, null]])
  const redo = plan({ ...base, sale: saleRow(before, { payments_version: 1 }), mode: 'redo', generation: 2 }).events
  assert.deepEqual(redo.map((e) => [e.event_id, e.direction, e.amount_paid_usd, e.reverses_event_id]), [['settle:op1:2:out', 'out', 20, 'settle:op1:1:in'], ['settle:op1:2:in', 'in', 15, null]])
})

check('every event of a plan passes buildPaymentEvent: undo is an out naming its target, redo an in (wrong direction/origin is refused by the builder)', () => {
  assert.equal(code(() => payments.buildPaymentEvent({ eventId: 'x', saleId: 1, direction: 'in', origin: 'undo', tender: [cash(1)], exchangeRate: 4000, receivedAt: NOW })), 'payment_event_direction_invalid')
  assert.equal(code(() => payments.buildPaymentEvent({ eventId: 'x', saleId: 1, direction: 'out', origin: 'redo', tender: [cash(1)], exchangeRate: 4000, receivedAt: NOW })), 'payment_event_direction_invalid')
  assert.equal(code(() => payments.buildPaymentEvent({ eventId: 'x', saleId: 1, direction: 'out', origin: 'undo', tender: [cash(1)], exchangeRate: 4000, receivedAt: NOW })), 'payment_event_reversal_target_required')
})

// --- opening from the current state of a replay -------------------------------
check('undo of a pre-fix settlement opens from the CURRENT (after) tender at creation, then reverses the opening', () => {
  const before = state([cash(10)])
  const after = state([cash(10), cash(40)])
  const out = plan({ sale: saleRow(after), before, after, mode: 'undo', generation: 1 })
  assert.deepEqual([out.opening.event_id, out.opening.amount_paid_usd, out.opening.received_at, out.opening.origin], ['opening:77', 50, '2026-11-10 02:15:00', 'opening'])
  assert.deepEqual([out.events[0].origin, out.events[0].amount_paid_usd, out.events[0].reverses_event_id], ['undo', 40, 'opening:77'])
  assert.deepEqual(payments.netPaymentTotals(all([out])), { paidUsd: 10, paidKhr: 0 }, 'net equals the before tender the undo restored')
})

check('redo of a pre-fix settlement opens from the before tender then adds the collect', () => {
  const before = state([cash(10)])
  const after = state([cash(10), cash(40)])
  const out = plan({ sale: saleRow(before), before, after, mode: 'redo', generation: 2 })
  assert.deepEqual([out.opening.amount_paid_usd, out.events[0].origin, out.events[0].amount_paid_usd], [10, 'redo', 40])
  assert.deepEqual(payments.netPaymentTotals(all([out])), { paidUsd: 50, paidKhr: 0 })
})

// --- the invariant over a whole life -----------------------------------------
function life(name, total, s0, s1, correction, rowsAdded) {
  check(`invariant: net events and the drawer equal the sale columns after apply, undo, redo, undo (${name})`, () => {
    const ledger = []
    let version = 0
    const step = (mode, generation, current, expected) => {
      const p = plan({ sale: saleRow(current, { payments_version: version }), before: s0, after: s1, correction, mode, generation, addedPaymentDetails: mode === 'apply' ? rowsAdded : undefined })
      ledger.push(p)
      version = 1
      const events = all(ledger)
      const net = payments.netPaymentTotals(events)
      assert.deepEqual([net.paidUsd, net.paidKhr], [Number(expected.amount_paid_usd), Number(expected.amount_paid_khr)], `${mode} ${generation}: net totals`)
      assert.deepEqual(drawer(events, total), drawerOfState(expected, total), `${mode} ${generation}: drawer figures`)
    }
    step('apply', 0, s0, s1)
    step('undo', 1, s1, s0)
    step('redo', 2, s0, s1)
    step('undo', 3, s1, s0)
    const ids = all(ledger).map((e) => e.event_id)
    assert.equal(new Set(ids).size, ids.length, 'event ids are unique')
  })
  check(`invariant on a pre-fix sale: first write is a replay (${name})`, () => {
    const events = all([plan({ sale: saleRow(s1), before: s0, after: s1, correction, mode: 'undo', generation: 1 })])
    const net = payments.netPaymentTotals(events)
    assert.deepEqual([net.paidUsd, net.paidKhr], [Number(s0.amount_paid_usd), Number(s0.amount_paid_khr)])
    assert.deepEqual(drawer(events, total), drawerOfState(s0, total))
  })
}
{
  const s0 = state([cash(10)])
  const s1 = state([cash(10), cash(45)], { usd: 5 })
  life('collect with change', 50, s0, s1, false, [cash(45)])
}
{
  const s0 = state([cash(20)], { usd: 5 })
  const s1 = state([aba(15)])
  life('correction cash with change to ABA', 15, s0, s1, true, undefined)
}
{
  const s0 = state([aba(10)])
  const s1 = state([aba(10), cash(0, 20000)], { khr: 12000 })
  life('collect riel with riel change', 12, s0, s1, false, [cash(0, 20000)])
}

// --- riel rules --------------------------------------------------------------
check('riel: new cash riel must be whole 100s, non-cash may be odd, a recorded legacy cash row survives, and an undo reverses a legacy non-100 row as it is', () => {
  const refuse = (rows) => code(() => planSaleSettlement({ configuredMethodsRaw: '["Cash","ABA"]', paymentDetailsRaw: rows, existingPaidUsd: 0, existingPaidKhr: 0, totalUsd: 1, exchangeRate: 4000, moneyPrecisionVersion: 1 }))
  assert.equal(refuse([cash(0, 4050)]), 'riel_cash_not_hundreds')
  assert.equal(refuse([{ method: 'ABA', amount_usd: 0, amount_khr: 4050 }]), null)
  const legacy = state([cash(0, 50)])
  const kept = planSaleSettlement({ configuredMethodsRaw: '["Cash","ABA"]', paymentDetailsRaw: [cash(0, 50), cash(0, 4000)], existingPaidUsd: 0, existingPaidKhr: 50,
    existingPaymentDetailsRaw: legacy.payment_details, existingPaymentMethodRaw: 'Cash', totalUsd: 1, exchangeRate: 4000, moneyPrecisionVersion: 1 })
  assert.deepEqual(kept.addedPaymentDetails, [{ method: 'Cash', amount_usd: 0, amount_khr: 4000 }], 'only the added hundreds row is a collect')
  const after = state([cash(0, 50), cash(0, 4000)])
  const undo = plan({ sale: saleRow(after, { payments_version: 1 }), before: legacy, after: { ...after, ...afterOf(kept), change_is_actual: 0 }, mode: 'undo', generation: 1 }).events[0]
  assert.deepEqual([undo.amount_paid_khr, undo.direction], [4000, 'out'])
  const legacyUndo = plan({ sale: saleRow(legacy, { payments_version: 1 }), before: state([]), after: legacy, mode: 'undo', generation: 1 }).events[0]
  assert.deepEqual([legacyUndo.amount_paid_khr, legacyUndo.direction], [50, 'out'], 'the stored 50-riel row is reversed unvalidated')
  const floor = core.rielCashFloor
  assert.deepEqual([floor(12399), floor(99), floor(12400)], [12300, 0, 12400], 'computed cash riel (refunds, change) rounds down to 100')
})

check('unreadable rows and a settlement that dropped a recorded row fail closed', () => {
  const before = state([cash(10)])
  assert.equal(code(() => plan({ sale: saleRow(before), before, after: state([aba(50)]), mode: 'undo', generation: 1 })), 'settlement_tender_unreadable')
  assert.equal(code(() => plan({ sale: saleRow(before), before, after: before, mode: 'undo', generation: 1 })), 'settlement_nothing_to_record')
  assert.equal(code(() => plan({ sale: saleRow(before), before: { ...before, payment_details: '{bad' }, after: state([cash(10), cash(5)]), mode: 'undo', generation: 1 })), 'settlement_tender_unreadable')
})

console.log(`${passed} passed`)
