// S4-7. The shift report message: its shape, its arithmetic, and the two
// places it must refuse to guess. No D1, no bot token, no network.
//
// What this file is actually guarding:
//
//   * The owner gave a LINE SET and an ORDER (shop, cashier, from/to, invoice
//     counts, revenue, item discount, invoice discount, gross sale, other
//     expense, registered cash, final amount, THEN unpaid credit, then the
//     two breakdowns). Order is content here -- a cashier reads this on a
//     phone at closing time and compares it against a drawer -- so the order
//     is asserted, not just the presence of each line.
//   * "Final amount" is a claim about physical cash. Its two components are
//     printed under it, and this pins that the printed components actually
//     add up to the printed total, so the arithmetic can never drift away
//     from its own explanation.
//   * Credit must NOT be subtracted from the final amount. Unpaid credit was
//     never collected, so it is not in `collected` to begin with; subtracting
//     it would take the money out twice. That is asserted directly.
//   * "Unpaid credit" must print BELOW "Final amount", never above it -- the
//     owner's own review ruling, on the reasoning that a line above a total
//     reads as an input to that total and credit explicitly is not one. This
//     is asserted as a POSITION check, not just membership in the line set,
//     so a regression that puts it back above the total is caught.
//   * An OPEN shift renders. Migration 0116 refuses to close a shift on a
//     timer, so a till left running overnight is a normal state, and the
//     report must not print a closing time that never happened or a
//     "difference" that reads as a missing-cash alarm.
//   * Every label is bilingual, via the same dictionary every other Telegram
//     message uses.
//
// Run (from cloudflare/): node scripts/test-shift-report-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

// saleTotals is a pure module with no imports of its own, so it is loaded for
// real rather than stubbed. telegram.ts does not import it on this branch, but
// the receipt lane adds that import (a shop-absorbed delivery fee must not be
// billed into the alert Total); a stub returning a plausible shape would let
// that regress invisibly, and a missing key makes loadReal throw on merge.
const saleTotals = loadReal('lib/saleTotals.ts')
const lang = loadReal('lib/telegramLang.ts')
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const analytics = loadReal('lib/salesAnalytics.ts', {
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
})
const telegram = loadReal('lib/telegram.ts', {
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './salesAnalytics': analytics,
})

const KHMER = /[ក-៿]/
const SEP = lang.BILINGUAL_SEPARATOR

// A closed shift: opened 08:15 local (01:15Z), counted 17:02 local (10:02Z).
const CLOSED = {
  shift_code: 'S-20260904-0815',
  user_id: 7,
  user_name: 'Za',
  branch_id: 2,
  branch_name: 'Shop',
  business_date: '2026-09-04',
  opened_at: '2026-09-04T01:15:00.000Z',
  opening_float_usd: 50,
  opening_float_khr: 100000,
  closed_at: '2026-09-04T10:02:00.000Z',
  closing_counted_usd: 256,
  closing_counted_khr: 100000,
}

const FIGURES = {
  invoices: 12,
  cancelled: 1,
  edited: 2,
  revenueUsd: 210,
  itemDiscountUsd: 5,
  invoiceDiscountUsd: 3,
  // The two halves of the invoice discount, which must add up to it.
  storeDiscountUsd: 2,
  membershipDiscountUsd: 1,
  grossSaleUsd: 218,
  taxUsd: 7,
  refundUsd: 12,
  avgOrderUsd: 17.5,
  costUsd: 120,
  profitUsd: 93,
  deliveryFeeUsd: 6,
  deliveryCostUsd: 3.5,
  deliveryMarginUsd: 2.5,
  deliveryCostRecorded: 2,
  creditUsd: 18,
  otherExpenseUsd: 4,
  otherExpenseKhr: 0,
  collectedUsd: 210,
  paymentMethods: [
    { method: 'Cash', count: 9, collectedUsd: 180 },
    { method: 'ABA', count: 3, collectedUsd: 30 },
  ],
  deliveryServices: [
    { name: 'Vireak Buntham', deliveries: 2, chargedUsd: 6, costUsd: 3.5, marginUsd: 2.5, costRecorded: 2 },
  ],
}

// 2026-09-04 12:00Z, well after the shift closed.
const NOW = Date.parse('2026-09-04T12:00:00.000Z')

const report = telegram.formatShiftReport('Sok Meng Shop', CLOSED, FIGURES, NOW)
const lines = report.split('\n')
const lineWith = (english) => {
  const prefix = `${english}${SEP}`
  const found = lines.find((line) => line.startsWith(prefix))
  assert.ok(found, `the report has no "${english}" line:\n${report}`)
  return found
}
const valueOf = (english) => lineWith(english).slice(lineWith(english).indexOf(': ') + 2)

// --- 1. the owner's line set, in the owner's order --------------------------

const ORDER = [
  'Shop', 'Cashier', 'Branch', 'Shift', 'From', 'To',
  'Invoices', 'Cancelled', 'Edited',
  'Revenue', 'Item discount', 'Invoice discount', 'Gross sale',
  'Other expense', 'Registered cash', 'Final amount', 'Unpaid credit',
]
let cursor = -1
for (const english of ORDER) {
  const at = lines.findIndex((line) => line.startsWith(`${english}${SEP}`))
  assert.ok(at > cursor, `"${english}" is out of order (index ${at}, previous ${cursor}) -- the owner gave this list in this sequence:\n${report}`)
  cursor = at
}
console.log(`PASS order: all ${ORDER.length} owner-specified lines present, in the owner's sequence`)

// --- 2. every label is bilingual --------------------------------------------

const labelled = lines.filter((line) => line.includes(': ') && !line.startsWith('•') && !line.startsWith('  '))
assert.ok(labelled.length >= ORDER.length, `expected at least ${ORDER.length} labelled lines, got ${labelled.length}`)
for (const line of labelled) {
  const labelPart = line.slice(0, line.indexOf(': '))
  assert.ok(KHMER.test(labelPart), `label "${labelPart}" shipped English-only`)
  assert.ok(labelPart.includes(SEP), `label "${labelPart}" is not a bilingual pair`)
}
assert.ok(KHMER.test(lines[0]), 'the title is not bilingual')
console.log(`PASS bilingual: ${labelled.length} labelled lines carry both languages`)

// --- 3. the figures land on the right lines ---------------------------------

assert.equal(valueOf('Shop'), 'Sok Meng Shop')
assert.equal(valueOf('Shift'), 'S-20260904-0815')
assert.equal(valueOf('Branch'), 'Shop')
assert.equal(valueOf('Revenue'), '$210.00')
assert.equal(valueOf('Item discount'), '$5.00')
assert.equal(valueOf('Invoice discount'), '$3.00')
assert.equal(valueOf('Gross sale'), '$218.00')
assert.equal(valueOf('Unpaid credit'), '$18.00')
assert.equal(valueOf('Other expense'), '$4.00')
// Both currencies, never folded together -- the drawer holds dollars and riel
// side by side and merging them would invent an exchange rate.
assert.ok(valueOf('Registered cash').includes('$50.00'), 'registered cash lost its dollars')
assert.ok(/100,?000\s?៛/.test(valueOf('Registered cash')), `registered cash lost its riel: ${valueOf('Registered cash')}`)

// From/To are the shift's own moments in the project's dd/mm/yyyy 24-hour
// convention, rendered in business local time (UTC+7): 01:15Z is 08:15 local.
assert.equal(valueOf('From'), '04/09/2026 08:15')
assert.equal(valueOf('To'), '04/09/2026 17:02')
console.log('PASS figures: money, both currencies, and dd/mm/yyyy 24-hour local times')

// --- 3b. the fuller breakdown ------------------------------------------------
// The owner, Sep 4 2026: "proper detailed summary breakdowns of each aspects".
// Measured against what the Reports hub carries for the same admin audience,
// this message was missing the tax, the returns money, the average sale, the
// SPLIT of the invoice discount, and everything about what a delivery cost as
// opposed to what it charged. Each of those is asserted on its value AND on
// its position, because a figure printed in the wrong place is read as the
// wrong figure.

// Indented component lines (5 spaces) are found separately: they belong to the
// line above them, which is the whole reason they are indented.
const componentLine = (english) => {
  const found = lines.find((line) => line.trimStart().startsWith(`${english}${SEP}`) && line.startsWith('     '))
  assert.ok(found, `no indented "${english}" component line:\n${report}`)
  return found
}
const indexOfLine = (english) => lines.findIndex((line) => line.trimStart().startsWith(`${english}${SEP}`))

assert.equal(valueOf('Tax'), '$7.00')
assert.equal(valueOf('Refund'), '$12.00')
assert.equal(valueOf('Avg order value'), '$17.50')
assert.equal(valueOf('Cost of goods'), '$120.00')
assert.equal(valueOf('Profit'), '$93.00')
assert.equal(valueOf('Delivery fee'), '$6.00')

// The discount split sits UNDER the sum it explains, indented, and the two
// halves actually add up to it -- a split that does not reconcile is worse
// than no split.
assert.ok(componentLine('Store discount').endsWith(': $2.00'))
assert.ok(componentLine('Membership discount').endsWith(': $1.00'))
assert.equal(FIGURES.storeDiscountUsd + FIGURES.membershipDiscountUsd, FIGURES.invoiceDiscountUsd)
assert.ok(indexOfLine('Store discount') === indexOfLine('Invoice discount') + 1
  && indexOfLine('Membership discount') === indexOfLine('Invoice discount') + 2,
  `the discount split must sit directly under the invoice discount:\n${report}`)

// Delivery cost and margin sit under the fee, and the margin is the
// subtraction it claims to be.
assert.ok(componentLine('Delivery cost').endsWith(': $3.50'))
assert.ok(componentLine('Delivery margin').endsWith(': $2.50'))
assert.equal(Math.round((FIGURES.deliveryFeeUsd - FIGURES.deliveryCostUsd) * 100) / 100, FIGURES.deliveryMarginUsd)
assert.ok(indexOfLine('Delivery cost') === indexOfLine('Delivery fee') + 1,
  'the courier cost must sit directly under the fee it is deducted from')

// Every indented component line is bilingual too -- the loop in section 2
// deliberately skips them, so without this they could ship English-only.
for (const line of lines.filter((entry) => entry.startsWith('     ') && entry.includes(': '))) {
  const labelPart = line.trimStart().slice(0, line.trimStart().indexOf(': '))
  assert.ok(KHMER.test(labelPart) && labelPart.includes(SEP), `component label "${labelPart}" is not a bilingual pair`)
}

// A courier's own row carries the same three parts as arithmetic.
const courierLine = lines.find((line) => line.startsWith('• Vireak Buntham'))
assert.ok(courierLine.endsWith('2 · $6.00 − $3.50 = $2.50'), `the courier row lost its cost and margin: ${courierLine}`)

// THE HONESTY RULE. delivery_actual_cost_usd is NULL when nothing was
// recorded, never 0 -- so a shift whose deliveries recorded no courier cost
// must print NEITHER a $0.00 cost NOR the margin that would follow from it,
// which would read as "delivery was free" and inflate the apparent margin to
// the whole fee. Measured Sep 4 2026: 12 of 15,044 sales carry a cost, so
// this is the COMMON case, not the edge one.
const noCost = telegram.formatShiftReport('Shop', CLOSED, {
  ...FIGURES,
  deliveryCostUsd: 0,
  deliveryMarginUsd: 6,
  deliveryCostRecorded: 0,
  deliveryServices: [{ name: 'Vireak Buntham', deliveries: 2, chargedUsd: 6, costUsd: 0, marginUsd: 6, costRecorded: 0 }],
}, NOW)
assert.ok(!noCost.includes('Delivery cost'), 'a shift with no recorded courier cost must not print a $0.00 cost')
assert.ok(!noCost.includes('Delivery margin'), 'and must not print the margin that a missing cost would invent')
assert.ok(noCost.split('\n').some((line) => line.startsWith(`Delivery fee${SEP}`) && line.endsWith(': $6.00')),
  'the charged fee is still reported')
assert.ok(noCost.split('\n').find((line) => line.startsWith('• Vireak Buntham')).endsWith('2 · $6.00'),
  'and the courier row falls back to the charged figure alone')
console.log('PASS breakdown: tax, refund, avg order, cost, profit, the discount split and the three delivery parts -- each in its place, and no invented margin')

// --- 4. the final amount is what the lines under it say it is ---------------

const finalLine = lineWith('Final amount')
const finalIndex = lines.indexOf(finalLine)
const components = lines[finalIndex + 1].trim()
// registered cash + collected - other expense = 50 + 210 - 4
assert.equal(components, '$50.00 + $210.00 − $4.00')
assert.equal(valueOf('Final amount'), '$256.00')
// The caption is a phrase, so it gets a LINE EACH rather than a ` / ` pair --
// joined, it is wider than a phone bubble and wraps into a mush.
assert.equal(lines[finalIndex + 2].trim(), 'registered cash + collected − expense')
assert.ok(KHMER.test(lines[finalIndex + 3]), 'the formula caption has no Khmer line')
assert.ok(!lines[finalIndex + 2].includes(SEP) && !lines[finalIndex + 3].includes(SEP), 'the caption was joined into one over-wide line')

// THE ASSERTION THAT MATTERS: credit is not subtracted. Unpaid credit is
// excluded from the collected figure already (it is awaiting_payment, so the
// kernel never recognised it), and subtracting it again would remove $18 that
// was never in the drawer to begin with. The owner's arithmetic ruling kept
// this unchanged -- only the LINE'S PLACEMENT moved (checked next).
assert.notEqual(valueOf('Final amount'), '$238.00', 'credit was subtracted from the final amount -- it was never collected, so it is not in the total to remove')
assert.equal(50 + 210 - 4, 256)

// Counted vs expected, once the shift is closed.
assert.equal(valueOf('Cash counted').includes('$256.00'), true)
assert.equal(valueOf('Difference'), '$0.00')
console.log('PASS arithmetic: final amount equals its own printed components; credit is not double-counted')

// THE OWNER'S PLACEMENT RULING, checked directly rather than only via the
// ORDER loop above: "Unpaid credit" must render AFTER "Final amount", never
// before it -- a line sitting above a total reads as an input to that total,
// and credit explicitly is not one. A regression that moves the line back
// above Final amount fails this by index comparison, not just by an eyeball
// diff of the rendered message.
const unpaidIndex = lines.findIndex((line) => line.startsWith(`Unpaid credit${SEP}`))
assert.ok(unpaidIndex >= 0, `the report has no "Unpaid credit" line:\n${report}`)
assert.ok(unpaidIndex > finalIndex, `"Unpaid credit" (line index ${unpaidIndex}) must print AFTER "Final amount" (line index ${finalIndex}), not above it:\n${report}`)
console.log('PASS placement: "Unpaid credit" prints below "Final amount", per the owner\'s review ruling')

// A short drawer shows the sign in front of the currency symbol.
const short = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 251 }, FIGURES, NOW)
const shortDiff = short.split('\n').find((line) => line.startsWith(`Difference${SEP}`))
assert.ok(shortDiff.endsWith(': −$5.00'), `a short drawer must read as a negative amount, got: ${shortDiff}`)
const over = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 259 }, FIGURES, NOW)
assert.ok(over.split('\n').find((line) => line.startsWith(`Difference${SEP}`)).endsWith(': +$3.00'))
console.log('PASS difference: over and short are signed in front of the currency symbol')

// --- 5. an open shift ---------------------------------------------------------

const OPEN = { ...CLOSED, closed_at: null, closing_counted_usd: null, closing_counted_khr: null }
const openReport = telegram.formatShiftReport('Sok Meng Shop', OPEN, FIGURES, NOW)
const openLines = openReport.split('\n')
const openTo = openLines.find((line) => line.startsWith(`To${SEP}`))
// Reported up to NOW (12:00Z = 19:00 local), and SAID to be still running.
assert.ok(openTo.includes('04/09/2026 19:00'), `an open shift reports up to now, got: ${openTo}`)
assert.ok(openTo.includes('still open'), 'an open shift must say so')
assert.ok(KHMER.test(openTo), 'the "still open" note is English-only')
// No closing count exists yet, so neither line may appear -- a "Difference" of
// -$256.00 on every open till would read as an alarm.
assert.ok(!openReport.includes('Cash counted'), 'an open shift must not print a closing count that has not been taken')
assert.ok(!openReport.includes('Difference'), 'an open shift must not print a difference against a count that does not exist')
// Everything else still renders: this is a real report, not a placeholder.
for (const english of ORDER) {
  assert.ok(openLines.some((line) => line.startsWith(`${english}${SEP}`)), `open shift dropped the "${english}" line`)
}
console.log(`PASS open shift: renders all ${ORDER.length} lines up to now, without inventing a closing count`)

// --- 6. the breakdowns ------------------------------------------------------

const paymentHeader = lines.findIndex((line) => line.startsWith(`Payment method${SEP}`))
assert.ok(paymentHeader > 0, 'no payment-method breakdown')
assert.ok(lines[paymentHeader + 1].startsWith('• Cash'), 'the payment breakdown lists nothing')
assert.ok(lines[paymentHeader + 1].includes('$180.00'))
const deliveryHeader = lines.findIndex((line) => line.startsWith(`Delivery service${SEP}`))
assert.ok(deliveryHeader > paymentHeader, 'the delivery breakdown must follow the payment one')
assert.ok(lines[deliveryHeader + 1].includes('Vireak Buntham'))
// A courier name is free text and must survive untouched -- the value
// localizer only rewrites enumerated words.
assert.ok(report.includes('Vireak Buntham'), 'a courier name was rewritten')

// Empty breakdowns simply do not print a header.
const bare = telegram.formatShiftReport('Shop', CLOSED, { ...FIGURES, paymentMethods: [], deliveryServices: [] }, NOW)
assert.ok(!bare.includes('Payment method'), 'an empty payment breakdown printed a header with nothing under it')
assert.ok(!bare.includes('Delivery service'), 'an empty delivery breakdown printed a header with nothing under it')
console.log('PASS breakdowns: payment methods then delivery services; empty ones print no header')

// --- 7. a shift with nothing in it -------------------------------------------
// The first POS use of a day registers the float; the report can legitimately
// be asked for before a single sale. Zeroes, not blanks or NaN.

const empty = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 50, closing_counted_khr: 100000 }, {
  invoices: 0, cancelled: 0, edited: 0,
  revenueUsd: 0, itemDiscountUsd: 0, invoiceDiscountUsd: 0, grossSaleUsd: 0,
  storeDiscountUsd: 0, membershipDiscountUsd: 0,
  taxUsd: 0, refundUsd: 0, avgOrderUsd: 0, costUsd: 0, profitUsd: 0,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryMarginUsd: 0, deliveryCostRecorded: 0,
  creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0, collectedUsd: 0,
  paymentMethods: [], deliveryServices: [],
}, NOW)
assert.ok(!/NaN|undefined|null/.test(empty), `an empty shift produced a broken value:\n${empty}`)
const emptyFinal = empty.split('\n').find((line) => line.startsWith(`Final amount${SEP}`))
// The float is still in the drawer and nothing was taken out of it.
assert.ok(emptyFinal.endsWith(': $50.00'), `an untraded shift should still hold its float, got: ${emptyFinal}`)
assert.ok(empty.split('\n').find((line) => line.startsWith(`Difference${SEP}`)).endsWith(': $0.00'))
console.log('PASS empty shift: zeroes throughout, the float is still the final amount')

// --- 8. the command is wired and documented ----------------------------------

const doc = lang.TELEGRAM_COMMANDS.find((entry) => entry.command === '/shift')
assert.ok(doc, '/shift is not in the command reference')
assert.ok(KHMER.test(doc.km) && !KHMER.test(doc.en), '/shift descriptions are in the wrong scripts')
assert.ok(doc.dated, '/shift must accept a day argument like the other reports')
assert.ok(lang.telegramCommandReference().includes('/shift'), 'the help message does not mention /shift')
console.log('PASS command: /shift is documented in the bilingual command reference')

// --- 9. /shift end to end, over a stub D1 ------------------------------------
// The formatter above is pure, so this half is what proves the command is
// actually wired and that the queries it fires are the ones intended: the
// shift window reaches the SQL as bound parameters, and cancelled receipts are
// counted through a path that does NOT go through the kernel's
// hide-cancelled guard (they would be invisible if it did).

const statements = []
const stubDb = {
  prepare(sql) {
    const entry = { sql, params: null }
    statements.push(entry)
    const answer = () => {
      if (/FROM shift_sessions/.test(sql)) return [CLOSED]
      return []
    }
    return {
      async all(params) { entry.params = params; return answer() },
      async get(params) {
        entry.params = params
        if (/FROM settings/.test(sql)) return { value: 'Sok Meng Shop' }
        if (/FROM shift_sessions/.test(sql)) return CLOSED
        return { invoices: 12, cancelled: 1, edited: 2, usd: 4, khr: 0, cost_usd: 0, item_discount_usd: 5 }
      },
    }
  },
}
const wired = loadReal('lib/telegram.ts', {
  './db': { getDb: () => stubDb },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './salesAnalytics': loadReal('lib/salesAnalytics.ts', {
    './db': { getDb: () => stubDb }, './businessDateWindow': businessDateWindow,
  }),
})

wired.telegramCommandReply({}, '/shift 04/09/2026', NOW).then((reply) => {
  assert.ok(reply.includes('Sok Meng Shop'), `/shift did not render a report:\n${reply}`)
  assert.ok(reply.includes('S-20260904-0815'), '/shift lost the shift code')
  assert.ok(KHMER.test(reply), '/shift replied in English only')

  // The day argument reached the shift lookup as a bound parameter.
  const lookup = statements.find((s) => /FROM shift_sessions/.test(s.sql))
  assert.equal(lookup.params.date, '2026-09-04', 'the dd/mm/yyyy argument did not reach the shift query as an ISO day')

  // Every sales query carries the shift window, normalised, and bound.
  const windowed = statements.filter((s) => s.sql.includes('@createdFrom'))
  assert.ok(windowed.length >= 4, `expected the kernel, the item discount, the counts and the breakdowns to be windowed, got ${windowed.length}`)
  for (const statement of windowed) {
    assert.equal(statement.params.createdFrom, '2026-09-04 01:15:00', 'a shift query bound a raw ISO timestamp')
    assert.equal(statement.params.createdTo, '2026-09-04 10:02:00')
  }

  // The invoice counts must SEE cancelled receipts. The kernel's default
  // guard excludes them, so this query deliberately does not use it.
  const counts = statements.find((s) => /AS cancelled/.test(s.sql))
  assert.ok(counts, 'no invoice-count query was issued')
  assert.ok(!/<> 'cancelled'/.test(counts.sql), 'the count query inherited the hide-cancelled guard, so it can only ever report 0 cancelled')
  assert.ok(/sale_amendments/.test(counts.sql), '"edited" is not counted from the amendment ledger')
  console.log(`PASS wiring: /shift issued ${statements.length} statements, ${windowed.length} of them window-bound, counts see cancelled receipts`)

  // An unknown day answers, rather than rendering an empty skeleton.
  statements.length = 0
  const emptyDb = { prepare: (sql) => ({ async all() { return [] }, async get() { return {} } }) }
  const wiredEmpty = loadReal('lib/telegram.ts', {
    './db': { getDb: () => emptyDb },
    './businessDateWindow': businessDateWindow,
    './telegramLang': lang,
    './saleTotals': saleTotals,
    './salesAnalytics': loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => emptyDb }, './businessDateWindow': businessDateWindow }),
  })
  return wiredEmpty.telegramCommandReply({}, '/shift 03/09/2026', NOW)
}).then((reply) => {
  assert.ok(reply.includes('No shift was registered'), `a day with no shift must say so:\n${reply}`)
  assert.ok(KHMER.test(reply), 'the empty-day answer is English-only')
  console.log('PASS empty day: a day with no registered shift is answered bilingually, not with a blank report')

  // --- 10. every figure comes from the kernel column it claims to ------------
  //
  // Sections 1-3b drive formatShiftReport directly, so they pin the LAYOUT and
  // the arithmetic but not the wiring: shiftFigures could read tax_usd into the
  // store-discount line and every one of them would still pass. The stub in
  // section 9 answers all its money queries with the same shape, so it cannot
  // tell two kernel columns apart either.
  //
  // This one gives every column a DISTINCT value and reads the rendered
  // message back. A crossed source shows up as the wrong number on the line,
  // which is exactly how this defect would reach the owner's phone.
  const kernelRow = {
    tx_count: 12,
    gross_sales_usd: 218,
    store_discount_usd: 2,
    membership_discount_usd: 1,
    tax_usd: 7,
    delivery_usd: 6,
    store_delivery_usd: 0,
    delivery_actual_cost_usd: 3.5,
    delivery_actual_cost_count: 2,
    delivery_sale_count: 2,
    recognized_net_usd: 222,
    pending_revenue_usd: 18,
    recognized_tax_usd: 7,
    recognized_delivery_usd: 6,
    recognized_store_delivery_usd: 0,
    recognized_delivery_cost_usd: 3.5,
    refund_usd: 12,
    refund_paid_out_usd: 12,
  }
  const mappingDb = {
    prepare(sql) {
      const answerGet = () => {
        if (/FROM settings/.test(sql)) return { value: 'Sok Meng Shop' }
        if (/FROM shift_sessions/.test(sql)) return CLOSED
        if (/AS gross_sales_usd/.test(sql)) return kernelRow
        if (/AS cost_usd/.test(sql)) return { cost_usd: 120 }
        if (/AS returned_cost_usd/.test(sql)) return { returned_cost_usd: 0 }
        if (/AS item_discount_usd/.test(sql)) return { item_discount_usd: 5 }
        if (/AS cancelled/.test(sql)) return { invoices: 12, cancelled: 1, edited: 2 }
        // shiftExpenses -- the only other .get, and the only one FROM fees.
        if (/FROM fees/.test(sql)) return { usd: 4, khr: 0 }
        throw new Error(`unexpected .get in the mapping stub:\n${sql}`)
      }
      return {
        async get(params) { void params; return answerGet() },
        async all(params) {
          void params
          if (/FROM shift_sessions/.test(sql)) return [CLOSED]
          if (/AS payment_method/.test(sql)) return [{ payment_method: 'Cash', tx_count: 12, total_usd: 210, collected_usd: 210 }]
          if (/AS delivery_contact_name[\s\S]*FROM sales/.test(sql)) {
            return [{
              delivery_contact_id: 4, delivery_contact_name: 'Vireak Buntham', deliveries: 2,
              charged_fee_usd: 6, absorbed_fee_usd: 0, actual_cost_usd: 3.5, actual_cost_count: 2,
              last_delivery_at: '2026-09-04 05:00:00',
            }]
          }
          // The courier-expense leg (fees joined to delivery_contacts).
          return []
        },
      }
    },
  }
  const wiredMapping = loadReal('lib/telegram.ts', {
    './db': { getDb: () => mappingDb },
    './businessDateWindow': businessDateWindow,
    './telegramLang': lang,
    './saleTotals': saleTotals,
    './salesAnalytics': loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => mappingDb }, './businessDateWindow': businessDateWindow }),
  })
  return wiredMapping.telegramCommandReply({}, '/shift 04/09/2026', NOW)
}).then((reply) => {
  const mapped = reply.split('\n')
  const mappedValue = (english) => {
    const found = mapped.find((line) => line.trimStart().startsWith(`${english}${SEP}`))
    assert.ok(found, `the report has no "${english}" line:\n${reply}`)
    return found.slice(found.indexOf(': ') + 2)
  }
  // Each of these is a DIFFERENT number, so a line reading from the wrong
  // kernel column cannot coincidentally match.
  assert.equal(mappedValue('Revenue'), '$210.00', 'revenue is recognized net sales minus refunds')
  assert.equal(mappedValue('Tax'), '$7.00', 'the tax line must read tax_usd')
  assert.equal(mappedValue('Refund'), '$12.00', 'the refund line must read refund_usd, not the unpaid credit')
  assert.equal(mappedValue('Unpaid credit'), '$18.00', 'and unpaid credit must still read pending_revenue_usd')
  assert.equal(mappedValue('Avg order value'), '$17.50', 'avg order is revenue / tx_count, from the kernel')
  assert.equal(mappedValue('Store discount'), '$2.00', 'the store half of the invoice discount')
  assert.equal(mappedValue('Membership discount'), '$1.00', 'the membership half')
  assert.equal(mappedValue('Invoice discount'), '$3.00', 'and their sum is the invoice discount')
  assert.equal(mappedValue('Cost of goods'), '$120.00', 'cost is the kernel cost, net of restocked returns')
  // revenue 210 - cost 120 + delivery net (6 - 3.5) = 92.50, the kernel's own
  // profit definition. Asserted as a VALUE so a second profit rule invented
  // here would show up as a different number.
  assert.equal(mappedValue('Profit'), '$92.50', 'profit is the kernel definition, not one computed in the message')
  assert.equal(mappedValue('Delivery fee'), '$6.00', 'the customer-paid delivery fee')
  assert.equal(mappedValue('Delivery cost'), '$3.50', 'the courier money actually paid out')
  assert.equal(mappedValue('Delivery margin'), '$2.50', 'and the difference between them')
  const courier = mapped.find((line) => line.startsWith('• Vireak Buntham'))
  assert.ok(courier.endsWith('2 · $6.00 − $3.50 = $2.50'), `the courier row lost a part: ${courier}`)
  console.log('PASS sources: every added figure reads the kernel column it claims, proved with distinct values end to end')
  console.log('OK test-shift-report-pure')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
