'use strict'
// The call-ceiling native compares the lane's Telegram shift report with the BASE commit's text after one mapping (harness/shift_base_text_map.cjs): the base prints
// money dollars first through money(); the lane prints riel first and the dollar half only when the SHIFT has any dollar (Cash count AND Expenses, one decision).
// The native is not run on a laptop, so the mapping is proven here: base text -> expected mapped text, by fixture. The fixtures are rows the real formatters print
// (the base text at 09e0d8123 and the lane text at HEAD agreed with these rows, probed through the pure formatters over eight shifts).
// Run (from cloudflare/): node scripts/test-shift-close-base-text-map-pure.cjs
const assert = require('node:assert/strict')
const { baseMoneyRielFirst, isShiftReport } = require('./harness/shift_base_text_map.cjs')

const NL = '\n'
const INDENT = '     '
const TITLE = '🧑‍💼 Shift report/របាយការណ៍វេន: Closed/បិទ · 20/11/2026'
const HEADER_BEFORE_CASH = ['· Open/បើក: 20/11/2026 08:15', '=====Sales/ការលក់=====', '· Revenue/ចំណូល: $40.00']
const CASH_HEADER = '====Cash count/ការរាប់សាច់ប្រាក់===='
const PAYMENT = ['=====Payment methods/វិធីទូទាត់=====', '· Cash: 3 · $40.0000', '=====Delivery/ការដឹកជញ្ជូន=====', '· N/A']
const EXPENSES_HEADER = '=====Expenses/ចំណាយ====='
const report = (cash, expenses) => [TITLE, ...HEADER_BEFORE_CASH, CASH_HEADER, ...cash, ...PAYMENT, EXPENSES_HEADER, ...expenses].join(NL)
let passed = 0
const same = (name, base, wanted) => {
  assert.equal(baseMoneyRielFirst(base), wanted, `${name}\n--- mapped ---\n${baseMoneyRielFirst(base)}\n--- wanted ---\n${wanted}`)
  passed += 1
  console.log(`PASS ${name}`)
}

// A dollar shift: every Expenses value becomes riel first with the dollar half, a missing half printed as 0៛ or $0.00; the delivery cost wraps onto a hanging-indent row.
same('dollar shift: delivery cost (wrapped), a row, and the total map to riel first with dollars',
  report(
    ['· Opening cash/សាច់ប្រាក់ដើមវេន: $0.00 · 100,000៛', '· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛', '· Difference/ភាពខុសគ្នា: +$5.00 · −20,000៛'],
    ['· Actual delivery cost/ថ្លៃដឹកដើម:', `${INDENT}$3.00`, '· Ice: $5.00', '· Total/សរុប: $8.00']),
  report(
    ['· Opening cash/សាច់ប្រាក់ដើមវេន: 100,000៛ · $0.00', '· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $5.00', '· Difference/ភាពខុសគ្នា: −20,000៛ · +$5.00'],
    ['· Actual delivery cost/ថ្លៃដឹកដើម:', `${INDENT}0៛ · $3.00`, '· Ice: 0៛ · $5.00', '· Total/សរុប: 0៛ · $8.00']))

// A riel-only expense on a dollar shift keeps its dollar half (per shift, never per line); a two-currency one is reordered.
same('dollar shift: a riel-only row gains $0.00, a two-currency total is reordered',
  report(
    ['· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛'],
    ['· Ice: $5.00', '· Riel snack: 12,300៛', '· Total/សរុប: $5.00 · 12,300៛']),
  report(
    ['· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $5.00'],
    ['· Ice: 0៛ · $5.00', '· Riel snack: 12,300៛ · $0.00', '· Total/សរុប: 12,300៛ · $5.00']))

// A dollar-only value gets 0៛ in front; "$0.00" (both halves zero) is 0៛ · $0.00.
same('dollar shift: "$A" gets 0៛ first and "$0.00" becomes 0៛ · $0.00',
  report(['· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛'], ['· Free item: $0.00', '· Ice: $2.00', '· Total/សរុប: $2.00']),
  report(['· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $5.00'], ['· Free item: 0៛ · $0.00', '· Ice: 0៛ · $2.00', '· Total/សរុប: 0៛ · $2.00']))

// A riel-only shift: riel alone everywhere, "$0.00" becomes 0៛, no "$" is left in the Cash count or Expenses sections.
const rielOnly = baseMoneyRielFirst(report(
  ['· Opening cash/សាច់ប្រាក់ដើមវេន: $0.00 · 100,000៛', '· Closing cash/សាច់ប្រាក់បិទវេន: $0.00 · 240,000៛'],
  ['· Ice: 8,000៛', '· Free item: $0.00', '· Total/សរុប: 8,000៛']))
same('riel-only shift: riel alone on every pair row of both sections',
  report(
    ['· Opening cash/សាច់ប្រាក់ដើមវេន: $0.00 · 100,000៛', '· Closing cash/សាច់ប្រាក់បិទវេន: $0.00 · 240,000៛'],
    ['· Ice: 8,000៛', '· Free item: $0.00', '· Total/សរុប: 8,000៛']),
  report(
    ['· Opening cash/សាច់ប្រាក់ដើមវេន: 100,000៛', '· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛'],
    ['· Ice: 8,000៛', '· Free item: 0៛', '· Total/សរុប: 8,000៛']))
assert.ok(!rielOnly.slice(rielOnly.indexOf('Cash count/'), rielOnly.indexOf('Payment methods/')).includes('$'), 'no dollar left in the riel-only Cash count section')
assert.ok(!rielOnly.slice(rielOnly.indexOf(EXPENSES_HEADER)).includes('$'), 'no dollar left in the riel-only Expenses section')
passed += 1; console.log('PASS riel-only shift: no "$" is left in the Cash count or Expenses sections')

// ONE decision for the message: a dollar only in the Expenses figures makes the Cash count rows dollar rows too (the lane decides from both).
same('dollar only in Expenses: the Cash count rows keep their dollar half, riel first',
  report(['· Opening cash/សាច់ប្រាក់ដើមវេន: $0.00 · 100,000៛', '· Closing cash/សាច់ប្រាក់បិទវេន: $0.00 · 240,000៛'], ['· Ice: $1.00', '· Total/សរុប: $1.00']),
  report(['· Opening cash/សាច់ប្រាក់ដើមវេន: 100,000៛ · $0.00', '· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $0.00'], ['· Ice: 0៛ · $1.00', '· Total/សរុប: 0៛ · $1.00']))
// A negative expected figure ("$-8.00", sign after the "$") is a dollar and maps like any other.
same('a negative expected dollar ("$-8.00 · 260,000៛") maps riel first',
  report(['· Expected cash/សាច់ប្រាក់ត្រូវមាន: $-8.00 · 260,000៛'], ['· Total/សរុប: 8,000៛']),
  report(['· Expected cash/សាច់ប្រាក់ត្រូវមាន: 260,000៛ · $-8.00'], ['· Total/សរុប: 8,000៛ · $0.00']))
// ...and the other way: a dollar only in the Cash count makes a riel-only expense row carry $0.00.
same('dollar only in the Cash count: a riel-only expense row carries $0.00',
  report(['· Opening cash/សាច់ប្រាក់ដើមវេន: $10.00 · 100,000៛'], ['· Ice: 8,000៛', '· Total/សរុប: 8,000៛']),
  report(['· Opening cash/សាច់ប្រាក់ដើមវេន: 100,000៛ · $10.00'], ['· Ice: 8,000៛ · $0.00', '· Total/សរុប: 8,000៛ · $0.00']))

// Only the Expenses section of the SHIFT REPORT is mapped: the overview and anything outside the section keep their text; N/A and an empty section stay.
{
  const overviewTitle = '🧑‍💼 Reports overview/ទិដ្ឋភាពរួមរបាយការណ៍: 20/11/2026'
  const overview = [overviewTitle, CASH_HEADER, '· Opening cash/សាច់ប្រាក់ដើមវេន: $10.00 · 100,000៛', EXPENSES_HEADER, '· Ice: $5.00', '· Total/សរុប: $5.00'].join(NL)
  assert.equal(baseMoneyRielFirst(overview), [overviewTitle, CASH_HEADER, '· Opening cash/សាច់ប្រាក់ដើមវេន: 100,000៛ · $10.00', EXPENSES_HEADER, '· Ice: $5.00', '· Total/សរុប: $5.00'].join(NL))
  assert.ok(isShiftReport(report([], [])) && !isShiftReport(overview))
  passed += 1; console.log('PASS the overview keeps its Expenses text (Cash count only is mapped); isShiftReport tells the two apart')
  const empty = report(['· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛'], ['· N/A'])
  assert.equal(baseMoneyRielFirst(empty), report(['· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $5.00'], ['· N/A']))
  passed += 1; console.log('PASS an empty Expenses section ("· N/A") is left alone')
}

// Rows outside the Expenses section, and an indented row that does not continue a label row, are not touched.
{
  const stray = [TITLE, '=====Sales/ការលក់=====', '· Revenue/ចំណូល: $40.00', '· Profit/ចំណេញ: $12.00', CASH_HEADER, '· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛',
    EXPENSES_HEADER, '· Ice: $5.00', `${INDENT}$9.00`, '· Total/សរុប: $5.00'].join(NL)
  const mapped = baseMoneyRielFirst(stray).split(NL)
  assert.deepEqual(mapped.slice(1, 4), ['=====Sales/ការលក់=====', '· Revenue/ចំណូល: $40.00', '· Profit/ចំណេញ: $12.00'], 'business results stay dollars')
  assert.equal(mapped[8], `${INDENT}$9.00`, 'an indented value under a row that did not wrap is not a continuation')
  assert.equal(mapped[7], '· Ice: 0៛ · $5.00')
  passed += 1; console.log('PASS business results stay dollars; a stray indented value is not mapped')
}

// A label that itself holds ": " keeps its text; only the trailing value is mapped.
same('a label holding ": " keeps its text and only the value is mapped',
  report(['· Closing cash/សាច់ប្រាក់បិទវេន: $5.00 · 240,000៛'], ['· Fee: ice: $2.00 · 8,000៛', '· Total/សរុប: $2.00 · 8,000៛']),
  report(['· Closing cash/សាច់ប្រាក់បិទវេន: 240,000៛ · $5.00'], ['· Fee: ice: 8,000៛ · $2.00', '· Total/សរុប: 8,000៛ · $2.00']))

console.log(`test-shift-close-base-text-map-pure: ${passed} checks ok`)
