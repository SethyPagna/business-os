// The Sep 6 2026 report redesign, pinned as measurements rather than taste.
//
// The owner's review, verbatim: "for telegram message can be made more
// clearly, summary, less text, no explanation just arrange all reports more
// concise with breakdowns clearly. like i see shift report is so long, much
// more simpler so easy to understand at a glance" -- and, on the same
// message, "you didn't mention the registered cash dollar and khr in open vs
// end" -- and, on the credit figure, "just use credit ... instead of $-n ...
// just $n".
//
// Four things are checked, each one of which the PRE-REDESIGN report fails:
//
//   1. A HARD LINE CAP. A shift with sales, expenses, a delivery cost, a
//      refund and credit must render in <= 28 lines. The old report rendered
//      the same shift in 55.
//   2. THE EXACT LINES, from a fixture with a credit sale, a recorded
//      delivery cost and an opening/closing count -- so "concise" cannot be
//      met by deleting figures the owner asked for.
//   3. BILINGUAL STRUCTURE PARITY. Every labelled line carries exactly one
//      English label and one Khmer label, so reading the message in either
//      language gives the same sections, in the same order, with the same
//      number of lines. Split the message into an English-only and a
//      Khmer-only view and the two must be structurally identical.
//   4. THE ABSENCES. The verbose lines the owner called "so long" are named
//      one by one and must not come back: the five-part drawer formula, the
//      two assumption sentences, the per-payment-method and per-courier
//      breakdowns, the itemised fee list, the cost/average/discount-split
//      rows, "Unpaid credit", and any "shortage"/"must match" wording.
//
// Pure: it loads the REAL lib/telegram.ts and lib/telegramLang.ts with the D1
// handle stubbed, and renders both the shift report and the day summary
// without a database.
//
// Run (from cloudflare/): node scripts/test-telegram-shift-report-pure.cjs
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

const noDb = { getDb: () => { throw new Error('no DB in this test') } }
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const telegramLang = loadReal('lib/telegramLang.ts')
const saleTotals = loadReal('lib/saleTotals.ts')
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': noDb, './businessDateWindow': businessDateWindow })
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': noDb })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }
// The drawer arithmetic is the REAL shared one (lib/shiftReconciliation.ts):
// the report must not grow a private second formula for the Difference line.
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': noDb, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockStub, './db': noDb, './businessDateWindow': businessDateWindow,
  './telegramLang': telegramLang, './salesAnalytics': salesAnalytics, './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation,
})

let passed = 0
const check = (label, cond, detail) => { assert.ok(cond, detail ? `${label}\n${detail}` : label); passed += 1; console.log(`PASS ${label}`) }

const SEP = telegramLang.BILINGUAL_SEPARATOR
const KHMER = /[ក-៿]/
const RULE = '━'.repeat(18)

// ---- the fixture -----------------------------------------------------------
// A busy but ordinary closed shift: sales, a profit, an expense in both
// currencies, a recorded courier payout, a refund, unpaid credit, and both
// halves of the cash count. Every optional block is therefore ON, which is
// what makes the line cap below a real ceiling rather than a best case.
const shift = {
  shift_code: 'S-0906-01', scope_mode: 'per_account', user_id: 7, user_name: 'Za',
  branch_id: 1, branch_name: 'Shop', business_date: '2026-09-06',
  opened_at: '2026-09-06T01:15:00.000Z', opening_float_usd: 50, opening_float_khr: 100000,
  closed_at: '2026-09-06T13:02:00.000Z', closing_counted_usd: 182.5, closing_counted_khr: 240000,
  cancelled_at: null, cancelled_by_user_name: null, cancel_reason: null,
}
const figures = {
  invoices: 24, cancelled: 1, edited: 2,
  revenueUsd: 486.25, profitUsd: 142.6,
  deliveryFeeUsd: 12, deliveryCostUsd: 7.5, deliveryCostRecorded: 3,
  refundUsd: 15, creditUsd: 38,
  otherExpenseUsd: 9.5, otherExpenseKhr: 20000,
  cash: { usd: 160, khr: 160000, needsReview: false },
}
const NOW = Date.parse('2026-09-06T14:00:00.000Z')
const report = telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW)
const lines = report.split('\n')

// ---- 1. the line cap -------------------------------------------------------
check(`the shift report fits one phone screen (${lines.length} lines, cap 28)`,
  lines.length <= 28, report)
// The cap is only meaningful if the fixture is one the OLD report would have
// blown: it printed eleven money rows, five drawer components, two formula
// rows, two assumption sentences and three bulleted breakdowns for exactly
// these figures. Nothing here is a quiet shift.
check('and the fixture really is a busy shift, not a quiet one',
  figures.invoices > 20 && figures.creditUsd > 0 && figures.refundUsd > 0
  && figures.deliveryCostRecorded > 0 && figures.otherExpenseKhr > 0)
check('no line is a sentence -- the longest is a label and a figure',
  lines.every((line) => line.split(' ').length <= 12), lines.filter((line) => line.split(' ').length > 12).join('\n'))

// ---- 2. the exact lines ----------------------------------------------------
assert.deepEqual(lines, [
  '🧑‍💼 Shift / វេន — 06/09/2026',
  'Shop / ហាង: Sunrise Mart',
  'Cashier / អ្នកគិតប្រាក់: Za',
  'Branch / សាខា: Shop',
  'Shift / វេន: S-0906-01',
  'From / ពី: 06/09/2026 08:15',
  'To / ទៅ: 06/09/2026 20:02',
  RULE,
  // The header block: the owner's five totals, in one fixed order, shared
  // with the day summary.
  'Sales / ការលក់: $486.25',
  'Profit / ចំណេញ: $142.60',
  'Expenses / ចំណាយ: $17.00 · 20,000៛',
  'Delivery fee / ថ្លៃដឹក: $12.00',
  // POSITIVE, and the word "credit" alone. Never $-38.00, and never taken
  // off the Sales or Profit lines above it.
  'Credit / ឥណទាន: $38.00',
  RULE,
  'Invoices / វិក្កយបត្រ: 24',
  'Cancelled / បានបោះបង់: 1',
  'Edited / បានកែ: 2',
  RULE,
  // The gap the owner named: registered cash, open vs end, both currencies.
  'Opening cash / សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛',
  'Counted cash / សាច់ប្រាក់បានរាប់: $182.50 · 240,000៛',
  RULE,
  // Expenses as exactly two plain lines, ONE refunds line, and ONE
  // informational difference line.
  'Delivery cost / ថ្លៃដើមដឹកជញ្ជូន: $7.50',
  'Other expenses / ចំណាយផ្សេងទៀត: $9.50 · 20,000៛',
  'Refunds / ការសងប្រាក់: $15.00',
  'Difference / ភាពខុសគ្នា: +$4.50 · 0៛',
], report)
check('the exact line set renders, with registered cash open vs end in both currencies', true)

// The header Expenses total IS the two lines beneath it, not a third figure:
// 9.50 + 7.50 = 17.00.
check('the header Expenses total is exactly its two component lines',
  Math.round((figures.otherExpenseUsd + figures.deliveryCostUsd) * 100) / 100 === 17)
// One refunds line, not a per-return list.
check('there is exactly one refunds line', lines.filter((line) => line.startsWith('Refunds')).length === 1)
// One difference line, and it is a fact, not a verdict.
const difference = lines.filter((line) => line.startsWith('Difference'))
check('there is exactly one difference line and it never calls the till short',
  difference.length === 1 && !/shortage|short|must match|expected to match/i.test(report), report)

// An OPEN shift has taken no closing count, so it shows the opening half and
// no difference at all -- printing one would read as a missing-cash alarm on
// every till still trading.
const openShift = { ...shift, closed_at: null, closing_counted_usd: null, closing_counted_khr: null }
const openReport = telegram.formatShiftReport('Sunrise Mart', openShift, figures, NOW)
check('an open shift shows the opening count and no difference against a count nobody took',
  openReport.includes('Opening cash / សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛')
  && !openReport.includes('Counted cash')
  && !openReport.includes('Difference'), openReport)
check('and it says it is still open rather than inventing a closing time',
  openReport.includes('still open'), openReport)

// A quiet shift drops every zero line but still states the two totals the
// shop always wants -- a $0.00 day is a fact, not a blank.
const quiet = telegram.formatShiftReport('Sunrise Mart', { ...openShift, opening_float_usd: 0, opening_float_khr: 0 }, {
  invoices: 0, cancelled: 0, edited: 0, revenueUsd: 0, profitUsd: 0,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  cash: { usd: 0, khr: 0, needsReview: false },
}, NOW)
check(`a quiet shift drops every zero line (${quiet.split('\n').length} lines)`,
  quiet.includes('Sales / ការលក់: $0.00') && quiet.includes('Profit / ចំណេញ: $0.00')
  && !quiet.includes('Credit') && !quiet.includes('Delivery') && !quiet.includes('Refunds')
  && !quiet.includes('Cancelled') && !quiet.includes('Edited'), quiet)

// ---- 3. bilingual structure parity -----------------------------------------
// Every labelled line is `English / ខ្មែរ: value`. Strip one language and the
// message must still have the same lines, in the same order, with the same
// section rules in the same places -- that is what "the same report in both
// languages" means when only the labels are doubled.
function languageView(text, which) {
  return text.split('\n').map((line) => {
    const split = line.indexOf(': ')
    if (split <= 0) return line
    const labelPart = line.slice(0, split)
    if (!labelPart.includes(SEP)) return line
    const halves = labelPart.split(SEP)
    return `${which === 'en' ? halves[0] : halves[1]}: ${line.slice(split + 2)}`
  })
}
const en = languageView(report, 'en')
const km = languageView(report, 'km')
check('both languages render the same number of lines', en.length === km.length)
check('and the section rules fall in exactly the same places',
  JSON.stringify(en.map((l, i) => (l === RULE ? i : -1)).filter((i) => i >= 0))
  === JSON.stringify(km.map((l, i) => (l === RULE ? i : -1)).filter((i) => i >= 0)))
check('and every line carries the same value in both views',
  en.every((line, index) => line.slice(line.indexOf(': ') + 2) === km[index].slice(km[index].indexOf(': ') + 2)))
const labelled = lines.filter((line) => line.indexOf(': ') > 0 && line.slice(0, line.indexOf(': ')).includes(SEP))
check(`every labelled line has one English label and one Khmer label (${labelled.length} lines)`,
  labelled.every((line) => {
    const halves = line.slice(0, line.indexOf(': ')).split(SEP)
    return halves.length === 2 && !KHMER.test(halves[0]) && KHMER.test(halves[1])
  }), labelled.join('\n'))

// The day summary is built from the same header order, so the parity check
// and the section order have to hold there too -- one shape, every report.
//
// THE FIXTURE CARRIES THE SHIFT'S OWN NUMBERS, courier payout included,
// because the two reports print the same word -- `Expenses / ចំណាយ` -- and a
// shared word may not name two different sums. It named two until Sep 7 2026:
// the day header added up the fees table alone and printed no delivery-cost
// component at all, so a single-shift day showed `/shift` "Expenses: $17.00"
// against `/report` "Expenses: $9.50" with nothing on either message
// explaining the $7.50 gap.
const daySummary = telegram.formatDaySummary({
  date: '2026-09-06',
  sales: {
    count: 24, usd: 486.25, cancelled: 1, refundUsd: 15, profitUsd: 142.6,
    deliveryFeeUsd: 12, creditUsd: 38,
    // Same source as the shift's: getSalesTotals' delivery_actual_cost_usd /
    // _count. A NULL cost is "not recorded", never $0.00 (see
    // deliveryActualCostExpr), which is what the count is for.
    deliveryCostUsd: 7.5, deliveryCostRecorded: 3,
  },
  fees: { count: 2, usd: 9.5, khr: 20000 },
  stockIn: { count: 3, quantity: 120 },
  stockOut: { count: 1, quantity: 4 },
}, [{ cashier: 'za01', count: 18, usd: 300 }, { cashier: 'sok', count: 6, usd: 186.25 }])
const daySections = daySummary.split('\n')
assert.deepEqual(daySections.slice(0, 7), [
  '📊 Business summary / សង្ខេបអាជីវកម្ម — 06/09/2026',
  RULE,
  'Sales / ការលក់: $486.25',
  'Profit / ចំណេញ: $142.60',
  'Expenses / ចំណាយ: $17.00 · 20,000៛',
  'Delivery fee / ថ្លៃដឹក: $12.00',
  'Credit / ឥណទាន: $38.00',
], daySummary)
check(`the day summary leads with the SAME five totals in the same order (${daySections.length} lines)`, true)
// The day's Expenses total is arithmetic, exactly as the shift's is above:
// the fees table plus the courier money actually paid out, and nothing else.
check('the day Expenses total is the fees table plus the recorded delivery cost',
  Math.round((9.5 + 7.5) * 100) / 100 === 17
  && daySummary.includes('Expenses / ចំណាយ: $17.00 · 20,000៛'), daySummary)
// ...and it prints the same two component lines under it that the shift does,
// so the reader can see which half is which without a second command.
check('and it prints the same two component lines the shift prints',
  daySummary.includes('Delivery cost / ថ្លៃដើមដឹកជញ្ជូន: $7.50')
  && daySummary.includes('Other expenses / ចំណាយផ្សេងទៀត: $9.50 · 20,000៛'), daySummary)

// THE SHARED HEADER, BYTE FOR BYTE. One set of numbers, two reports, one
// block of five lines: if either formatter ever computes a header figure its
// own way again, these two strings stop matching.
const headerBlock = (text) => {
  const rows = text.split('\n')
  const first = rows.indexOf(RULE)
  const next = rows.indexOf(RULE, first + 1)
  return rows.slice(first + 1, next < 0 ? rows.length : next)
}
check('one set of numbers renders a byte-identical five-line header in both reports',
  headerBlock(report).length === 5 && headerBlock(report).join('\n') === headerBlock(daySummary).join('\n'),
  `${headerBlock(report).join('\n')}\n---\n${headerBlock(daySummary).join('\n')}`)

// The cap moved from 20 to 24 on Sep 7 2026 with the expense split above: a
// day with two cashiers, both currencies, stock movement in and out AND a
// recorded courier payout is the fullest message this formatter can produce.
check('the day summary fits one phone screen too', daySections.length <= 24, daySummary)
check('and its cashier bullets are name, receipts, money -- nothing else',
  daySummary.includes('• za01 — 18 · $300.00') && daySummary.includes('• sok — 6 · $186.25'), daySummary)
const dayEn = languageView(daySummary, 'en')
const dayKm = languageView(daySummary, 'km')
check('the day summary is structurally identical in both languages',
  dayEn.length === dayKm.length
  && JSON.stringify(dayEn.map((l, i) => (l === RULE ? i : -1))) === JSON.stringify(dayKm.map((l, i) => (l === RULE ? i : -1))))

// ---- 4. the absences -------------------------------------------------------
// Each string below is a line the PRE-REDESIGN report printed for this very
// fixture. They are the measurement of "so long", and they are the reason
// this file fails against the code as it stood before Sep 6 2026.
const RETIRED = [
  'Cost of goods',            // an eleven-row money block, of which this was one
  'Avg order value',
  'Item discount',
  'Invoice discount',
  'Store discount',
  'Membership discount',
  'Gross sale',
  'Delivery margin',
  'Cash sales',               // the five printed drawer components...
  'Courier /',
  'Expected /',
  'Unpaid credit',            // ...and the credit line that sat under them
  'Payment method',           // the three bulleted breakdowns
  'Delivery service',
  'Fees /',
  'assumed paid from the drawer',   // the two explanatory sentences
  'not a cash-flow ledger',
]
for (const retired of RETIRED) {
  assert.ok(!report.includes(retired), `"${retired}" is back in the shift report:\n${report}`)
}
check(`all ${RETIRED.length} retired verbose lines stay out of the shift report`, true)
// The arithmetic rows the old message spelled out under Expected.
check('the five-part drawer formula is not spelled out any more',
  !/\$[\d.]+ \+ \$[\d.]+ − \$/.test(report) && !/៛ \+ [\d,]+៛ − /.test(report), report)
// The one thing that must NOT have been dropped along with them: the drawer
// arithmetic still comes from the shared module, it is simply printed as one
// line instead of eight.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
check('the Difference line is still the shared reconciliation, not a private formula',
  /computeShiftReconciliation\(/.test(source) && /loadShiftReconciliation\(/.test(source)
  && !/opening[^\n]*\+[^\n]*cashSales[^\n]*-[^\n]*expenses/.test(source))
// Called, not merely unprinted: the two breakdown queries are gone from
// shiftFigures, so a shift message costs two fewer round trips than it did.
// (The names survive in a comment there saying where they still live, which
// is why this looks for the CALL rather than the word.)
check('and the two dropped breakdown queries are really gone from shiftFigures',
  !/getPaymentMethodBreakdown\(/.test(source) && !/getDeliveryContactTotals\(/.test(source))

console.log(`\nALL ${passed} CHECKS PASSED`)
