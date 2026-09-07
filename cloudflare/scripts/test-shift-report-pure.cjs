// S4-7. The shift report message: its shape, its arithmetic, and the two
// places it must refuse to guess. No D1, no bot token, no network.
//
// REDESIGNED Sep 2026 (N42/N38). The owner: "for telegram message can be made
// more clearly, summary, less text, no explanation just arrange all reports
// more concise with breakdowns clearly. like i see shift report is so long,
// much more simpler so easy to understand at a glance", and separately "you
// didn't mention the registered cash dollar and khr in open vs end", and on
// credit "just use credit ... instead of $-n ... just $n".
//
// What this file guards AFTER that redesign:
//
//   * The line set and the ORDER the redesign fixed: identity, then the
//     header totals, then the counts, then registered cash open vs end, then
//     the context block. Order is content here -- a cashier reads this on a
//     phone at closing time -- so it is asserted, not just membership.
//   * Registered cash OPEN and END, both currencies, side by side. That block
//     is the owner's named gap and it is a FACTUAL readout: nothing here
//     compares it against a target, and the words "shortage" and "must match"
//     appear nowhere.
//   * Credit prints as a positive "Credit: $n" and is NOT subtracted from
//     anything above it. Unpaid credit was never collected, so it is not in
//     the drawer figure to begin with; subtracting it would take the money
//     out twice. Asserted directly, on the value.
//   * Exactly ONE difference line, from the ONE shared formula in
//     lib/shiftReconciliation.ts -- the five-part formula the message used to
//     print is gone, but the number it produced is not, and the components
//     (refunds, courier, expenses) still move it. Asserted with a
//     reconciliation whose parts are all distinct.
//   * An OPEN shift renders. Migration 0116 refuses to close a shift on a
//     timer, so a till left running overnight is a normal state, and the
//     report must not print a closing count that never happened or a
//     "difference" that reads as a missing-cash alarm.
//   * Every label is bilingual, via the same dictionary every other Telegram
//     message uses.
//   * The wiring: /shift binds the shift window into every sales query, sees
//     cancelled receipts, and every figure reads the kernel column it claims.
//
// The LAYOUT budget of the redesign (line cap, exact rendered lines,
// bilingual structure parity, retired-string sweep) is pinned separately in
// scripts/test-telegram-shift-report-pure.cjs. This file is the wiring and
// the arithmetic; that one is the shape.
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
// Put another way: telegram.ts asks saleTotals who was billed for a delivery
// fee, so the message and the stored total_usd cannot disagree about it.
// Both lanes added this binding independently; keep exactly ONE.
const saleTotals = loadReal('lib/saleTotals.ts')
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', {
  './financialPrecision': financialPrecision,
  './saleTotals': saleTotals,
})
const lang = loadReal('lib/telegramLang.ts')
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const analytics = loadReal('lib/salesAnalytics.ts', {
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
})
// Sep 6 2026: the owner's low-stock alert setting reaches this module through
// lib/lowStockSettings.ts. The SQL builder is the REAL one -- the clauses
// asserted below are the ones it composes -- while the settings READ answers
// the shipped default, there being no settings row in this harness. The rule
// itself is proven in scripts/test-low-stock-settings-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

// The drawer arithmetic lives in lib/shiftReconciliation.ts and is shared with
// the close routes and the app. Loaded REAL: this file's whole point is that
// the message's numbers are the same numbers, so a stub would test the stub.
// scripts/test-shift-reconciliation-pure.cjs drives it against SQLite.
const paymentMethodRegistry = loadReal('lib/paymentMethodRegistry.ts')
const reconciliationFor = (getDb, salesAnalytics) => loadReal('lib/shiftReconciliation.ts', {
  './db': { getDb },
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': salesAnalytics,
  './paymentMethodRegistry': paymentMethodRegistry,
})
const shiftReconciliation = reconciliationFor(() => { throw new Error('no DB in this test') }, analytics)
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockStub,
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': analytics,
  './shiftReconciliation': shiftReconciliation,
})

const KHMER = /[ក-៿]/
const SEP = lang.BILINGUAL_SEPARATOR

// A closed shift: opened 08:15 local (01:15Z), counted 17:02 local (10:02Z).
const CLOSED = {
  scope_mode: 'per_account',
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

// The post-redesign figure set. Every field here is printed somewhere; there
// is no longer a tax / gross-sale / avg-order / discount-split / margin half
// of this shape, because there are no longer lines for them.
const FIGURES = {
  invoices: 12,
  cancelled: 1,
  edited: 2,
  revenueUsd: 210,
  profitUsd: 93,
  refundUsd: 12,
  deliveryFeeUsd: 6,
  deliveryCostUsd: 3.5,
  deliveryCostRecorded: 2,
  creditUsd: 18,
  otherExpenseUsd: 4,
  otherExpenseKhr: 0,
  cash: { usd: 210, khr: 0, needsReview: false },
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

// --- 1. the redesigned line set, in the redesigned order --------------------

const ORDER = [
  // Who and when.
  'Shop', 'Cashier', 'Branch', 'Shift', 'From', 'To',
  // The header block: the totals the owner reads first. Credit is the LAST
  // of them and is a positive figure, never a deduction.
  'Sales', 'Profit', 'Expenses', 'Delivery fee', 'Not Paid',
  // The counts.
  'Invoices', 'Cancelled', 'Edited',
  // The owner's named gap: registered cash, open vs end.
  'Opening cash', 'Counted cash',
  // Context, and the ONE difference line.
  'Delivery cost', 'Other expenses', 'Refunds', 'Difference',
]
let cursor = -1
for (const english of ORDER) {
  const at = lines.findIndex((line) => line.startsWith(`${english}${SEP}`))
  assert.ok(at > cursor, `"${english}" is out of order (index ${at}, previous ${cursor}) -- the redesign fixed this sequence:\n${report}`)
  cursor = at
}
// And nothing else: a labelled line that is not on the list is a line the
// redesign did not budget for.
const labelled = lines.filter((line) => line.includes(': ') && !line.startsWith('•') && !line.startsWith('  '))
assert.equal(labelled.length, ORDER.length, `the report grew a labelled line the redesign did not budget for:\n${report}`)
console.log(`PASS order: exactly the ${ORDER.length} redesigned lines, in the redesigned sequence`)

// --- 2. every label is bilingual --------------------------------------------

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
assert.equal(valueOf('Sales'), '$210.00')
assert.equal(valueOf('Profit'), '$93.00')
assert.equal(valueOf('Delivery fee'), '$6.00')
assert.equal(valueOf('Delivery cost'), '$3.50')
assert.equal(valueOf('Other expenses'), '$4.00')
assert.equal(valueOf('Refunds'), '$12.00')
assert.equal(valueOf('Invoices'), '12')
assert.equal(valueOf('Cancelled'), '1')
assert.equal(valueOf('Edited'), '2')

// THE EXPENSE TOTAL is the sum of the two lines that explain it, and only of
// those two -- a header figure that does not equal its own breakdown is the
// failure this file exists for.
assert.equal(valueOf('Expenses'), '$7.50')
assert.equal(Math.round((FIGURES.otherExpenseUsd + FIGURES.deliveryCostUsd) * 100) / 100, 7.5)

// THE CREDIT RULING, on the value: positive, the word "credit", and NOT
// removed from any total above it. Sales stays $210.00 with an $18.00 credit
// in the window; a report that subtracted credit would print $192.00.
assert.equal(valueOf('Not Paid'), '$18.00')
assert.ok(!/-\$|\$-/.test(report), `credit (or anything else) rendered as a negative dollar amount:\n${report}`)
assert.notEqual(valueOf('Sales'), '$192.00', 'credit was subtracted from sales -- it is revenue, it was simply not collected')
assert.ok(!/\bCredit\b|ឥណទាន/.test(report), 'the superseded Credit wording must not render')

// Both currencies, never folded together -- the drawer holds dollars and riel
// side by side and merging them would invent an exchange rate.
assert.equal(valueOf('Opening cash'), '$50.00 · 100,000៛')
assert.equal(valueOf('Counted cash'), '$256.00 · 100,000៛')

// From/To are the shift's own moments in the project's dd/mm/yyyy 24-hour
// convention, rendered in business local time (UTC+7): 01:15Z is 08:15 local.
assert.equal(valueOf('From'), '04/09/2026 08:15')
assert.equal(valueOf('To'), '04/09/2026 17:02')
console.log('PASS figures: money, both currencies, dd/mm/yyyy 24-hour local times, and credit as a positive figure')

// --- 3b. the registered-cash block is a readout, not a check ----------------
// The owner's model: the shift's cash registration is a breakdown FOR THE
// REPORT. Nothing here is an "expected must match" gate, and the difference
// line is informational. A regression that reintroduces alarm wording would
// turn a factual readout into an accusation.
for (const banned of ['shortage', 'short by', 'must match', 'mismatch', 'Expected', 'Final amount', 'discrepanc']) {
  assert.ok(!new RegExp(banned, 'i').test(report), `the report reintroduced "${banned}" -- the cash block is a readout, not a check:\n${report}`)
}
// And no explanatory sentence anywhere: every line is a label and a figure,
// a bullet, a rule, or the title.
for (const line of lines.slice(1)) {
  if (!line.trim() || /^[━]+$/.test(line) || line.startsWith('•')) continue
  assert.ok(line.includes(': '), `"${line}" is prose, not a labelled figure`)
  assert.ok(!/\. /.test(line), `"${line}" reads as a sentence`)
}
console.log('PASS readout: registered cash open vs end, no alarm wording, no explanatory sentences')

// --- 3c. THE HONESTY RULE ----------------------------------------------------
// delivery_actual_cost_usd is NULL when nothing was recorded, never 0 -- so a
// shift whose deliveries recorded no courier cost must print NEITHER a $0.00
// cost line NOR that zero inside the expense total, which together would read
// as "delivery was free". Measured Sep 4 2026: 12 of 15,044 sales carry a
// cost, so this is the COMMON case, not the edge one.
const noCost = telegram.formatShiftReport('Shop', CLOSED, {
  ...FIGURES, deliveryCostUsd: 0, deliveryCostRecorded: 0,
}, NOW)
assert.ok(!noCost.includes('Delivery cost'), 'a shift with no recorded courier cost must not print a $0.00 cost')
const noCostLines = noCost.split('\n')
assert.ok(noCostLines.some((line) => line.startsWith(`Delivery fee${SEP}`) && line.endsWith(': $6.00')), 'the charged fee is still reported')
assert.ok(noCostLines.find((line) => line.startsWith(`Expenses${SEP}`)).endsWith(': $4.00'),
  'an unrecorded courier cost must not be folded into the expense total as a zero')
console.log('PASS honesty: an unrecorded courier cost prints no line and enters no total')

// --- 4. the difference is the shared formula's number, once ------------------

// Exactly one difference line, and it is signed.
assert.equal(lines.filter((line) => line.startsWith(`Difference${SEP}`)).length, 1)
// opening 50 + cash 210 - refunds 12 - expenses 4 - courier 3.50 = 240.50,
// counted 256 -> +15.50. Riel: 100,000 in, 100,000 counted -> 0.
assert.equal(valueOf('Difference'), '+$15.50 · 0៛')
assert.equal(50 + 210 - 12 - 4 - 3.5, 240.5)
// And the credit was NOT taken out of it a second time: it was never
// collected, so it is not in the drawer to remove.
assert.notEqual(valueOf('Difference'), '+$33.50 · 0៛', 'credit was subtracted from the drawer -- it was never collected')

// A short drawer shows the sign in front of the currency symbol.
const short = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 235 }, FIGURES, NOW)
const shortDiff = short.split('\n').find((line) => line.startsWith(`Difference${SEP}`))
assert.ok(shortDiff.endsWith(': −$5.50 · 0៛'), `a short drawer must read as a negative amount, got: ${shortDiff}`)
const level = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 240.5 }, FIGURES, NOW)
assert.ok(level.split('\n').find((line) => line.startsWith(`Difference${SEP}`)).endsWith(': $0.00 · 0៛'),
  'a drawer that balances is unsigned')
console.log('PASS difference: one line, signed in front of the currency symbol, credit not double-counted')

// --- 4b. the riel drawer, and the tender summary ----------------------------
// User's 04/09/2026 drawer: shortage already removed before registration.
const expenses = [30000, 20000, 14000, 50000, 30000, 6000]
assert.equal(expenses.reduce((sum, n) => sum + n, 0), 150000)
const rielReport = telegram.formatShiftReport('Shop', {
  ...CLOSED, opening_float_usd: 0, opening_float_khr: 300000 - 16300,
  closing_counted_usd: 0, closing_counted_khr: 133700,
}, {
  ...FIGURES, cash: { usd: 0, khr: 0, needsReview: false },
  refundUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  otherExpenseUsd: 0, otherExpenseKhr: 150000,
}, NOW)
const rielLines = rielReport.split('\n')
assert.ok(rielLines.find((line) => line.startsWith(`Opening cash${SEP}`)).endsWith(': $0.00 · 283,700៛'))
assert.ok(rielLines.find((line) => line.startsWith(`Counted cash${SEP}`)).endsWith(': $0.00 · 133,700៛'))
assert.ok(rielLines.find((line) => line.startsWith(`Expenses${SEP}`)).endsWith(': 150,000៛'))
assert.ok(rielLines.find((line) => line.startsWith(`Difference${SEP}`)).endsWith(': $0.00 · 0៛'))
// The per-expense list is gone: the header total and the "Other expenses"
// line are the breakdown the owner asked for, and six bullets under them is
// the length he asked us to cut.
assert.ok(!rielReport.includes('30,000៛'), 'the report re-grew a per-expense list')

const cashOnly = telegram.summarizeShiftCash([
  { payment_method: 'Cash', amount_paid_usd: 10, amount_paid_khr: 2000, exchange_rate: 4000 },
  { payment_method: 'ABA', amount_paid_usd: 50, amount_paid_khr: 0 },
  { payment_method: 'Cash + ABA', amount_paid_usd: 20, amount_paid_khr: 0,
    payment_details: JSON.stringify([{ method: 'Cash', amount_usd: 5 }, { method: 'ABA', amount_usd: 15 }]) },
])
assert.deepEqual(cashOnly, { usd: 15, khr: 2000, needsReview: false })
assert.equal(telegram.summarizeShiftCash([{ payment_method: 'Cash', amount_paid_usd: 20, change_usd: 5, change_khr: 20000 }]).needsReview, true)
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 20, amount_paid_khr: 0, total_usd: 15, exchange_rate: 4100,
  change_usd: 5, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000,
}]), { usd: 15, khr: 0, needsReview: false })
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 0, amount_paid_khr: 82000, total_usd: 15, exchange_rate: 4100,
  change_usd: 0, change_khr: 20000, change_is_actual: 1, change_exchange_rate: 4000,
}]), { usd: 0, khr: 62000, needsReview: false })
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 20, amount_paid_khr: 4100, total_usd: 19.5, exchange_rate: 4100,
  change_usd: 1, change_khr: 2000, change_is_actual: 1, change_exchange_rate: 4000,
}]), { usd: 19, khr: 2100, needsReview: false })
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 20, amount_paid_khr: 0, total_usd: 22, exchange_rate: 4100,
  change_usd: 5, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000,
}]), { usd: 15, khr: 0, needsReview: false }, 'later mutable totals do not erase physical change')
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 20, total_usd: 15, exchange_rate: 4100,
  change_usd: 5, change_khr: 0, change_is_actual: 0, change_exchange_rate: null,
}]), { usd: 20, khr: 0, needsReview: true }, 'legacy dual change remains review-only')
assert.deepEqual(telegram.summarizeShiftCash([{
  payment_method: 'Cash', amount_paid_usd: 20, total_usd: 15, exchange_rate: 4100,
  change_usd: 5, change_khr: 0, change_is_actual: 1, change_exchange_rate: null,
}]), { usd: 20, khr: 0, needsReview: true }, 'actual marker without its captured rate fails closed')
for (const change of ['invalid', -1]) assert.equal(telegram.summarizeShiftCash([{ payment_method: 'Cash', amount_paid_usd: 20, change_usd: change }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ payment_method: 'Cash', amount_paid_usd: 20, total_usd: 15 }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ payment_method: '', amount_paid_usd: 20 }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ payment_details: '{broken', amount_paid_usd: 20 }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ amount_paid_usd: 20, payment_details: '[{"method":"Cash","amount_usd":10}]' }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ sale_status:'awaiting_payment', amount_paid_usd:0, change_usd:1 }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ sale_status:'awaiting_payment', amount_paid_usd:0, payment_details:'[{"method":"Cash","amount_usd":10}]' }]).needsReview, true)
assert.equal(telegram.summarizeShiftCash([{ sale_status:'awaiting_payment', amount_paid_usd:0, total_usd:10 }]).needsReview, false)
// When the tender cannot be established the DIFFERENCE is the only thing that
// blanks: the counted cash was physically counted and is still printed, and
// so is everything else a reader can verify by hand.
const unknownCash = telegram.formatShiftReport('Shop', CLOSED, { ...FIGURES, cash: { ...cashOnly, needsReview: true } }, NOW)
assert.ok(unknownCash.includes(lang.labeled('difference', '—')))
assert.ok(unknownCash.includes(lang.labeled('cashEnd', '$256.00 · 100,000៛')), 'a counted drawer is still reported when the tender is ambiguous')
assert.ok(unknownCash.includes(lang.labeled('refunds', '$12.00')), 'and so is everything else that IS known')
console.log('PASS cash: user riel example, separate tender currencies, bank exclusion, split payment and ambiguity guards')

// --- 4c. refunds and courier payouts still move the difference --------------
// The formula is no longer printed, but it is still the formula: a supplied
// reconciliation with five distinct parts must land on the difference line.
const RECONCILED = {
  opening: { usd: 50, khr: 100000 },
  cash_sales: { usd: 210, khr: 0 },
  refunds: { usd: 12, khr: 0 },
  expenses: { usd: 4, khr: 20000 },
  courier: { usd: 3.5, khr: 0 },
  expected: { usd: 240.5, khr: 80000 },
  counted: { usd: 256, khr: 100000 },
  difference: { usd: 15.5, khr: 20000 },
  needs_review: false,
  review_codes: [],
}
const full = telegram.formatShiftReport('Shop', CLOSED, { ...FIGURES, reconciliation: RECONCILED }, NOW)
const fullLines = full.split('\n')
const fullValue = (english) => {
  const line = fullLines.find((row) => row.startsWith(`${english}${SEP}`))
  assert.ok(line, `no "${english}" line:\n${full}`)
  return line.slice(line.indexOf(': ') + 2)
}
assert.equal(fullValue('Difference'), '+$15.50 · +20,000៛')
assert.notEqual(fullValue('Difference'), '—', 'a shift with a refund must still get a number, not a dash')
assert.equal(50 + 210 - 12 - 4 - 3.5, 240.5)
// A review code blanks the derived figure and nothing else.
const flagged = telegram.formatShiftReport('Shop', CLOSED, {
  ...FIGURES,
  reconciliation: { ...RECONCILED, needs_review: true, review_codes: ['cash_method_unresolved'] },
}, NOW)
assert.ok(flagged.includes(lang.labeled('difference', '—')))
assert.ok(flagged.includes(lang.labeled('refunds', '$12.00')), 'a flagged shift still shows what IS known')
// Cash recognition is the shared module's, by KIND: renaming the method must
// not empty the drawer (the old code compared against two exact spellings).
assert.deepEqual(telegram.summarizeShiftCash([{ payment_method: 'Cash USD', amount_paid_usd: 30, total_usd: 30 }]),
  { usd: 30, khr: 0, needsReview: false }, 'a renamed cash method is still cash')
assert.deepEqual(telegram.summarizeShiftCash([{ payment_method: 'Drawer', amount_paid_usd: 30, total_usd: 30 }],
  { kinds: { drawer: 'cash' } }), { usd: 30, khr: 0, needsReview: false }, 'an explicit kind map settles any name')
console.log('PASS reconciliation: the shared five-part formula still drives the one difference line, and a review code blanks only that')

const longMessage = 'Cash សាច់ប្រាក់ 🍋‍🟩\n'.repeat(400)
const parts = telegram.splitTelegramMessage(longMessage)
assert.ok(parts.length > 1 && parts.every((part) => part.length <= 3900))
assert.equal(parts.join(''), longMessage)
assert.ok(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part)))
console.log('PASS long reports: all text retained across bounded Telegram messages')
for (const length of [0,1,3899,3900,3901,7800]) {
 const text='x'.repeat(length);const chunks=telegram.splitTelegramMessage(text)
 assert.equal(chunks.join(''),text);assert.ok(chunks.every(part=>part.length>0&&part.length<=3900))
}

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
assert.ok(!openLines.some((line) => line.startsWith(`Counted cash${SEP}`)), 'an open shift must not print a closing count that has not been taken')
assert.ok(!openReport.includes('Difference'), 'an open shift must not print a difference against a count that does not exist')
// The registered-cash block still carries its open half: that is the whole
// point of showing open vs end.
assert.ok(openLines.some((line) => line.startsWith(`Opening cash${SEP}`)), 'an open shift still reports its registered opening cash')
// Everything else still renders: this is a real report, not a placeholder.
for (const english of ORDER.filter((entry) => entry !== 'Counted cash' && entry !== 'Difference')) {
  assert.ok(openLines.some((line) => line.startsWith(`${english}${SEP}`)), `open shift dropped the "${english}" line`)
}
console.log(`PASS open shift: renders ${ORDER.length - 2} lines up to now, without inventing a closing count`)

// --- 6. a shift with nothing in it -------------------------------------------
// The first POS use of a day registers the float; the report can legitimately
// be asked for before a single sale. Zeroes, not blanks or NaN -- and the
// zero-valued context lines drop out, which is what makes a quiet shift short.

const empty = telegram.formatShiftReport('Shop', { ...CLOSED, closing_counted_usd: 50, closing_counted_khr: 100000 }, {
  invoices: 0, cancelled: 0, edited: 0,
  revenueUsd: 0, profitUsd: 0, refundUsd: 0,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  cash: { usd: 0, khr: 0, needsReview: false },
}, NOW)
const emptyLines = empty.split('\n')
assert.ok(!/NaN|undefined|null/.test(empty), `an empty shift produced a broken value:\n${empty}`)
// Sales and Profit print even at zero -- a day that took nothing is a fact --
// while every optional line is gone.
assert.ok(emptyLines.find((line) => line.startsWith(`Sales${SEP}`)).endsWith(': $0.00'))
assert.ok(emptyLines.find((line) => line.startsWith(`Profit${SEP}`)).endsWith(': $0.00'))
for (const dropped of ['Expenses', 'Delivery fee', 'Not Paid', 'Cancelled', 'Edited', 'Delivery cost', 'Other expenses', 'Refunds']) {
  assert.ok(!emptyLines.some((line) => line.startsWith(`${dropped}${SEP}`)), `a quiet shift still printed a zero "${dropped}" line`)
}
// The float is still in the drawer and nothing was taken out of it.
assert.ok(emptyLines.find((line) => line.startsWith(`Opening cash${SEP}`)).endsWith(': $50.00 · 100,000៛'))
assert.ok(emptyLines.find((line) => line.startsWith(`Difference${SEP}`)).endsWith(': $0.00 · 0៛'))
assert.ok(emptyLines.length < lines.length, 'a quiet shift must be shorter than a busy one')
console.log(`PASS empty shift: ${emptyLines.length} lines, zero-valued lines dropped, the float is still the drawer`)

// --- 7. the command is wired and documented ----------------------------------

const doc = lang.TELEGRAM_COMMANDS.find((entry) => entry.command === '/shift')
assert.ok(doc, '/shift is not in the command reference')
assert.ok(KHMER.test(doc.km) && !KHMER.test(doc.en), '/shift descriptions are in the wrong scripts')
assert.ok(doc.dated, '/shift must accept a day argument like the other reports')
assert.ok(lang.telegramCommandReference().includes('/shift'), 'the help message does not mention /shift')
console.log('PASS command: /shift is documented in the bilingual command reference')

// --- 8. /shift end to end, over a stub D1 ------------------------------------
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
const stubAnalytics = loadReal('lib/salesAnalytics.ts', {
  './db': { getDb: () => stubDb }, './businessDateWindow': businessDateWindow,
})
const wired = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockStub,
  './db': { getDb: () => stubDb },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': stubAnalytics,
  './shiftReconciliation': reconciliationFor(() => stubDb, stubAnalytics),
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
  assert.ok(windowed.length >= 4, `expected the kernel, the counts and the reconciliation legs to be windowed, got ${windowed.length}`)
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
  // The two breakdown queries the redesign dropped must not come back: they
  // were the longest part of the message and the owner asked for it short.
  assert.ok(!statements.some((s) => /AS payment_method/.test(s.sql)), '/shift re-issued the payment-method breakdown query')
  assert.ok(!statements.some((s) => /AS delivery_contact_name/.test(s.sql)), '/shift re-issued the delivery-contact breakdown query')
  console.log(`PASS wiring: /shift issued ${statements.length} statements, ${windowed.length} of them window-bound, counts see cancelled receipts, no breakdown queries`)

  const shopWide = { ...CLOSED, scope_mode: 'shop_wide' }
  assert.equal(telegram.shiftFilters(shopWide, NOW).cashierId, null, 'shop-wide reports do not narrow sales to the opener')
  // The policy lives with the query that enforces it, which is now the shared
  // reconciliation module rather than this message builder.
  const reconSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'shiftReconciliation.ts'), 'utf8')
  assert.match(reconSource, /if \(shift\.scope_mode !== 'shop_wide'\)[\s\S]{0,180}fees\.created_by = @createdBy/, 'shop-wide expenses do not narrow to the opener')
  assert.match(reconSource, /fees\.branch_id = @branchId OR fees\.branch_id IS NULL/, 'a NULL-branch expense must count against the open drawer')
  assert.ok(!/=== 'cash'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')),
    'the report must not compare a payment method against a literal name again')

  // An unknown day answers, rather than rendering an empty skeleton.
  statements.length = 0
  const emptyDb = { prepare: (sql) => ({ async all() { return [] }, async get() { return {} } }) }
  const wiredEmpty = loadReal('lib/telegram.ts', {
    './lowStockSettings': lowStockStub,
    './db': { getDb: () => emptyDb },
    './businessDateWindow': businessDateWindow,
    './telegramLang': lang,
    './saleTotals': saleTotals,
    './nativeSaleChange': nativeSaleChange,
    './salesAnalytics': loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => emptyDb }, './businessDateWindow': businessDateWindow }),
    './shiftReconciliation': reconciliationFor(() => emptyDb, loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => emptyDb }, './businessDateWindow': businessDateWindow })),
  })
  return wiredEmpty.telegramCommandReply({}, '/shift 03/09/2026', NOW)
}).then((reply) => {
  assert.ok(reply.includes('No shift was registered'), `a day with no shift must say so:\n${reply}`)
  assert.ok(KHMER.test(reply), 'the empty-day answer is English-only')
  console.log('PASS empty day: a day with no registered shift is answered bilingually, not with a blank report')

  // --- 9. every figure comes from the kernel column it claims to ------------
  //
  // Sections 1-4 drive formatShiftReport directly, so they pin the LAYOUT and
  // the arithmetic but not the wiring: shiftFigures could read refund_usd into
  // the credit line and every one of them would still pass. The stub in
  // section 8 answers all its money queries with the same shape, so it cannot
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
        // Refunds issued in the window, and courier payouts, each from its own
        // query -- distinct values so a crossed source shows on the line.
        if (/FROM returns/.test(sql)) return { usd: 12, khr: 0 }
        if (/delivery_actual_cost_khr/.test(sql)) return { usd: 3.5, khr: 0 }
        throw new Error(`unexpected .get in the mapping stub:\n${sql}`)
      }
      return {
        async get(params) { void params; return answerGet() },
        async all(params) {
          void params
          if (/FROM shift_sessions/.test(sql)) return [CLOSED]
          if (/SUM\(SUM\(amount_usd\)\) OVER/.test(sql)) return [{label:'Example expense',usd:4,khr:0,overall_usd:4,overall_khr:0}]
          return []
        },
      }
    },
  }
  const wiredMapping = loadReal('lib/telegram.ts', {
    './lowStockSettings': lowStockStub,
    './db': { getDb: () => mappingDb },
    './businessDateWindow': businessDateWindow,
    './telegramLang': lang,
    './saleTotals': saleTotals,
    './nativeSaleChange': nativeSaleChange,
    './salesAnalytics': loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => mappingDb }, './businessDateWindow': businessDateWindow }),
    './shiftReconciliation': reconciliationFor(() => mappingDb, loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => mappingDb }, './businessDateWindow': businessDateWindow })),
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
  assert.equal(mappedValue('Sales'), '$210.00', 'sales is recognized net sales minus refunds')
  // revenue 210 - cost 120 + delivery net (6 - 3.5) = 92.50, the kernel's own
  // profit definition. Asserted as a VALUE so a second profit rule invented
  // here would show up as a different number.
  assert.equal(mappedValue('Profit'), '$92.50', 'profit is the kernel definition, not one computed in the message')
  assert.equal(mappedValue('Other expenses'), '$4.00', 'the expense total comes from the grouped query')
  assert.equal(mappedValue('Refunds'), '$12.00', 'the refunds line must read refund_usd, not the unpaid credit')
  assert.equal(mappedValue('Not Paid'), '$18.00', 'credit must read pending_revenue_usd, not the refund')
  assert.equal(mappedValue('Delivery fee'), '$6.00', 'the customer-paid delivery fee')
  assert.equal(mappedValue('Delivery cost'), '$3.50', 'the courier money actually paid out')
  // 4.00 other + 3.50 courier, the two lines under it.
  assert.equal(mappedValue('Expenses'), '$7.50', 'the header expense total is its own two lines')
  assert.equal(mappedValue('Invoices'), '12')
  assert.equal(mappedValue('Cancelled'), '1')
  assert.equal(mappedValue('Edited'), '2')
  assert.equal(mappedValue('Opening cash'), '$50.00 · 100,000៛', 'the registered opening cash is the shift row, both currencies')
  assert.equal(mappedValue('Counted cash'), '$256.00 · 100,000៛', 'and the counted cash is the shift row too')
  // opening 50 + cash 0 - refunds 12 - expenses 4 - courier 3.50 = 30.50,
  // counted 256 -> +225.50. Riel: 100,000 in, 100,000 counted -> 0.
  assert.equal(mappedValue('Difference'), '+$225.50 · 0៛', 'the difference is the five components this stub supplied, and nothing else')
  console.log('PASS sources: every figure reads the kernel column it claims, proved with distinct values end to end')
  console.log('OK test-shift-report-pure')
}).then(async () => {
  const sender = loadReal('lib/telegram.ts', {
    './db': { getDb: () => ({prepare:()=>({all:async()=>[
      {key:'telegram_chat_id',value:'123'}, {key:'telegram_automation_enabled',value:'1'},
    ]})}) },
    './businessDateWindow':businessDateWindow,'./telegramLang':lang,'./saleTotals':saleTotals,'./nativeSaleChange':nativeSaleChange,'./salesAnalytics':analytics,'./lowStockSettings':lowStockStub,
    './shiftReconciliation': shiftReconciliation,
  })
  const originalFetch=global.fetch; const sent=[]
  try {
    global.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true}}
    await sender.sendTelegramEvent({TELEGRAM_BOT_TOKEN:'local-test-only'}, {type:'sales',lines:Array.from({length:80},(_,i)=>`Line ${i} ${'ដារ៉ា'.repeat(20)}`)})
    assert.ok(sent.length>1)
    assert.ok(sent.every(part=>part.chat_id==='123'&&part.text.length>0&&part.text.length<=3900))
    assert.ok(sent.map(part=>part.text).join('').includes('Line 79'), 'last line must be sent, not truncated')
    global.fetch=async()=>({ok:false,status:429,text:async()=>''})
    await assert.rejects(sender.sendTelegramEvent({TELEGRAM_BOT_TOKEN:'local-test-only'}, {type:'sales',lines:['test']}), /429/)
    console.log('PASS Telegram sender: multiple bounded nonempty requests retain last line; rejected delivery is not reported as success; fetch stub only')
  } finally { global.fetch=originalFetch }
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
