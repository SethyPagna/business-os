// The Sep 6 2026 concision rules and the Sep 21 2026 sectioned layout, pinned
// as measurements rather than taste.
//
// The owner's Sep 6 review, verbatim: "for telegram message can be made more
// clearly, summary, less text, no explanation just arrange all reports more
// concise with breakdowns clearly. like i see shift report is so long, much
// more simpler so easy to understand at a glance" -- and, on the same
// message, "you didn't mention the registered cash dollar and khr in open vs
// end" -- and, on the credit figure, "just use credit ... instead of $-n ...
// just $n".
//
// On Sep 21 2026 the owner pasted the OLD POS's shift report as a LAYOUT
// reference -- information order only, never its wording or branding -- and
// said "Shift should look something like this... Of course. Khmer + english,
// option to choose one or the other language or both and both as default. In
// settings. just smarter and compact, same for other telegram report enough
// spacing and separations that it feels easy to read and clean, using
// dividers, numbered list, etc... title etc...".
//
// What this file checks, each one of which the PRE-REDESIGN report fails:
//
//   1. A HARD LINE CAP. A shift with sales, both discount cuts, expenses, a
//      delivery cost, a refund, credit, a payment-method breakdown and a
//      courier breakdown must render in <= 38 lines. The pre-Sep-6 report
//      rendered a smaller fixture in 55.
//   2. THE EXACT LINES of the busy fixture, in all THREE language modes --
//      'both', 'en' and 'km' -- so "compact" cannot be met by deleting
//      figures the owner asked for, and a language mode cannot be met by
//      cutting a finished string in half (values contain " / " too).
//   3. THE STABLE SHAPE. An open shift, a cancelled shift and a shift that
//      took nothing still print the same six numbered sections, in the same
//      order, with an empty section marked rather than missing.
//   4. THE ABSENCES. The verbose lines the owner called "so long" are named
//      one by one and must not come back: the five-part drawer formula, the
//      two assumption sentences, the itemised cost/average/discount-split
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
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': noDb, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
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
// The riel SIGN is Khmer script but it is a currency symbol, not a word: it
// stays in every language mode, so a "does this line carry Khmer TEXT" probe
// has to take it out first or an English-only report looks bilingual.
const KHMER = /[ក-៿]/
const khmerText = (value) => KHMER.test(String(value).replace(/៛/g, ''))
const RULE = '━'.repeat(18)

/** Render one message in one language mode, then put the mode back. */
const render = (mode, build) => {
  const previous = telegramLang.getTelegramLanguage()
  telegramLang.setTelegramLanguage(mode)
  try { return build() } finally { telegramLang.setTelegramLanguage(previous) }
}

// ---- the fixture -----------------------------------------------------------
// A busy but ordinary closed shift: sales, both discount cuts, a profit, an
// expense in both currencies, a recorded courier payout, a refund, unpaid
// credit, two payment methods, one courier and both halves of the cash count.
// Every optional block is therefore ON, which is what makes the line cap below
// a real ceiling rather than a best case.
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
  itemDiscountUsd: 12.4, invoiceDiscountUsd: 5, grossSalesUsd: 503.65,
  deliveryFeeUsd: 12, deliveryCostUsd: 7.5, deliveryCostRecorded: 3,
  refundUsd: 15, creditUsd: 38,
  otherExpenseUsd: 9.5, otherExpenseKhr: 20000,
  cash: { usd: 160, khr: 160000, needsReview: false },
  paymentMethods: [{ method: 'Cash', count: 18, usd: 300 }, { method: 'ABA', count: 6, usd: 186.25 }],
  deliveries: [{ name: 'Grab', count: 3, feeUsd: 12, costUsd: 7.5 }],
  expenseDetails: [{ label: 'Rent', usd: 9.5, khr: 20000 }],
}
const NOW = Date.parse('2026-09-06T14:00:00.000Z')
const report = render('both', () => telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW))
const lines = report.split('\n')

// ---- 1. the line cap -------------------------------------------------------
// The cap moved from 28 to 38 on Sep 21 2026 with the two breakdown sections
// and the two discount rows the owner's reference reinstated. It is still a
// ceiling: this fixture, with every optional block on, renders in 36.
check(`the shift report stays at a glance (${lines.length} lines, cap 38)`,
  lines.length <= 38, report)
check('and the fixture really is a busy shift, not a quiet one',
  figures.invoices > 20 && figures.creditUsd > 0 && figures.refundUsd > 0
  && figures.deliveryCostRecorded > 0 && figures.otherExpenseKhr > 0
  && figures.paymentMethods.length > 1 && figures.deliveries.length > 0)
// Measured on the ENGLISH rendering: a bilingual line legitimately carries two
// labels, so counting words on it would measure the language pairing rather
// than prose. Prose would show up in either mode; this one is unambiguous.
const englishReport = render('en', () => telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW))
check('no line is a sentence -- the longest is a label and a figure',
  englishReport.split('\n').every((line) => line.split(' ').length <= 12),
  englishReport.split('\n').filter((line) => line.split(' ').length > 12).join('\n'))

// ---- 2. the exact lines, in all three modes --------------------------------
assert.deepEqual(lines, [
  // The TITLE carries the state, the way the owner's reference does
  // ("Shift Report - Open or Closed"), then the business day.
  '🧑‍💼 Shift report / របាយការណ៍វេន — Closed / បានបិទ · 06/09/2026',
  '· Shop / ហាង: Sunrise Mart',
  '· ID / លេខសម្គាល់: S-0906-01',
  '· Cashier / អ្នកគិតប្រាក់: Za',
  '· From / ពី: 06/09/2026 08:15',
  '· To / ទៅ: 06/09/2026 20:02',
  RULE,
  '1. Invoices / វិក្កយបត្រ',
  '· Total / សរុប: 24 · Cancelled / បានបោះបង់: 1 · Edited / បានកែប្រែ: 2',
  RULE,
  '2. Sales / ការលក់',
  '· Revenue / ចំណូល: $486.25',
  '· Discount on items / ការបញ្ចុះតម្លៃលើទំនិញ: $12.40',
  '· Discount on invoices / ការបញ្ចុះតម្លៃលើវិក្កយបត្រ: $5.00',
  '· Gross sales / ការលក់សរុប: $503.65',
  '· Profit / ចំណេញ: $142.60',
  '· Delivery fee / ថ្លៃដឹក: $12.00',
  // POSITIVE, and the owner's own word. Never $-38.00, and never taken off
  // the Revenue or Profit lines above it.
  '· Not Paid / ប្រាក់ជំពាក់: $38.00',
  '· Refunds / ការសងប្រាក់: $15.00',
  RULE,
  // The gap the owner named: registered opening and closing cash, both
  // currencies, then the expected drawer and ONE difference line.
  '3. Cash count / ការរាប់សាច់ប្រាក់',
  '· Opening cash / សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛',
  '· Closing cash / សាច់ប្រាក់បិទវេន: $182.50 · 240,000៛',
  '· Expected cash / សាច់ប្រាក់ត្រូវមាន: $178.00 · 240,000៛',
  '· Difference / ភាពខុសគ្នា: +$4.50 · 0៛',
  RULE,
  '4. Payment methods / វិធីទូទាត់',
  '• Cash — 18 · $300.00',
  '• ABA — 6 · $186.25',
  RULE,
  '5. Delivery / ការដឹកជញ្ជូន',
  '• Grab — 3 · $12.00 fee / ថ្លៃដឹក · $7.50 cost / ថ្លៃដើម',
  RULE,
  // The courier payout is a ROW here, not just a figure inside the total:
  // the bullets and the Total have to add up on the reader's own screen.
  '6. Expenses / ចំណាយ',
  '• Actual delivery cost / ថ្លៃដឹកដើម — $7.50',
  '• Rent — $9.50 · 20,000៛',
  '· Total / សរុប: $17.00 · 20,000៛',
], report)
check('the exact owner sequence renders: title, identity, six numbered sections', true)

// The Expenses total IS its two bullets, not a third figure: 9.50 + 7.50.
check('the Expenses total is exactly its two bullet rows',
  Math.round((figures.otherExpenseUsd + figures.deliveryCostUsd) * 100) / 100 === 17)
// One difference line, and it is a fact, not a verdict.
const difference = lines.filter((line) => line.startsWith('· Difference'))
check('there is exactly one difference line and it never calls the till short',
  difference.length === 1 && !/shortage|short|must match|expected to match/i.test(report), report)
// Reinstated Sep 21 2026 -- but still ONE line, not a per-return breakdown.
check('refunds are stated once, in the Sales section',
  lines.filter((line) => line.startsWith('· Refunds')).length === 1, report)

// --- 'en': the English report, with no Khmer word anywhere ------------------
assert.deepEqual(englishReport.split('\n'), [
  '🧑‍💼 Shift report — Closed · 06/09/2026',
  '· Shop: Sunrise Mart',
  '· ID: S-0906-01',
  '· Cashier: Za',
  '· From: 06/09/2026 08:15',
  '· To: 06/09/2026 20:02',
  RULE,
  '1. Invoices',
  '· Total: 24 · Cancelled: 1 · Edited: 2',
  RULE,
  '2. Sales',
  '· Revenue: $486.25',
  '· Discount on items: $12.40',
  '· Discount on invoices: $5.00',
  '· Gross sales: $503.65',
  '· Profit: $142.60',
  '· Delivery fee: $12.00',
  '· Not Paid: $38.00',
  '· Refunds: $15.00',
  RULE,
  '3. Cash count',
  '· Opening cash: $50.00 · 100,000៛',
  '· Closing cash: $182.50 · 240,000៛',
  '· Expected cash: $178.00 · 240,000៛',
  '· Difference: +$4.50 · 0៛',
  RULE,
  '4. Payment methods',
  '• Cash — 18 · $300.00',
  '• ABA — 6 · $186.25',
  RULE,
  '5. Delivery',
  '• Grab — 3 · $12.00 fee · $7.50 cost',
  RULE,
  '6. Expenses',
  '• Actual delivery cost — $7.50',
  '• Rent — $9.50 · 20,000៛',
  '· Total: $17.00 · 20,000៛',
], englishReport)
check('the \'en\' mode report carries no Khmer word at all (the riel sign is a symbol, not a word)',
  !khmerText(englishReport), englishReport)

// --- 'km': the Khmer report. Values -- money, dates, the shop name, a
// payment method, a courier, an expense label -- are DATA and are never
// translated; only the label side changes.
const khmerReport = render('km', () => telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW))
assert.deepEqual(khmerReport.split('\n'), [
  '🧑‍💼 របាយការណ៍វេន — បានបិទ · 06/09/2026',
  '· ហាង: Sunrise Mart',
  '· លេខសម្គាល់: S-0906-01',
  '· អ្នកគិតប្រាក់: Za',
  '· ពី: 06/09/2026 08:15',
  '· ទៅ: 06/09/2026 20:02',
  RULE,
  '1. វិក្កយបត្រ',
  '· សរុប: 24 · បានបោះបង់: 1 · បានកែប្រែ: 2',
  RULE,
  '2. ការលក់',
  '· ចំណូល: $486.25',
  '· ការបញ្ចុះតម្លៃលើទំនិញ: $12.40',
  '· ការបញ្ចុះតម្លៃលើវិក្កយបត្រ: $5.00',
  '· ការលក់សរុប: $503.65',
  '· ចំណេញ: $142.60',
  '· ថ្លៃដឹក: $12.00',
  '· ប្រាក់ជំពាក់: $38.00',
  '· ការសងប្រាក់: $15.00',
  RULE,
  '3. ការរាប់សាច់ប្រាក់',
  '· សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛',
  '· សាច់ប្រាក់បិទវេន: $182.50 · 240,000៛',
  '· សាច់ប្រាក់ត្រូវមាន: $178.00 · 240,000៛',
  '· ភាពខុសគ្នា: +$4.50 · 0៛',
  RULE,
  '4. វិធីទូទាត់',
  '• Cash — 18 · $300.00',
  '• ABA — 6 · $186.25',
  RULE,
  '5. ការដឹកជញ្ជូន',
  '• Grab — 3 · $12.00 ថ្លៃដឹក · $7.50 ថ្លៃដើម',
  RULE,
  '6. ចំណាយ',
  '• ថ្លៃដឹកដើម — $7.50',
  '• Rent — $9.50 · 20,000៛',
  '· សរុប: $17.00 · 20,000៛',
], khmerReport)
// A label position is everything before the first ': ' on a non-bullet line.
// Product names, payment methods and couriers live on bullets and after the
// colon, and must survive untouched -- "Sunrise Mart" is not translatable.
const khmerLabelPositions = khmerReport.split('\n')
  .filter((line) => !line.startsWith('•') && line.includes(': '))
  .map((line) => line.slice(0, line.indexOf(': ')))
check(`no English word survives on a label position in 'km' mode (${khmerLabelPositions.length} labels)`,
  khmerLabelPositions.every((labelPart) => !/[A-Za-z]/.test(labelPart)),
  khmerLabelPositions.filter((labelPart) => /[A-Za-z]/.test(labelPart)).join('\n'))
check('...while the VALUES are untouched in every mode',
  khmerReport.includes('Sunrise Mart') && khmerReport.includes('• Cash — 18 · $300.00')
  && khmerReport.includes('• Rent — $9.50 · 20,000៛'), khmerReport)
// Every mode is the SAME report: same number of lines, same rules in the same
// places. That is what "one message, three renderings" means.
const rulePositions = (text) => text.split('\n').map((line, index) => (line === RULE ? index : -1)).filter((index) => index >= 0)
check('all three modes render the same line count and the same divider positions',
  lines.length === englishReport.split('\n').length && lines.length === khmerReport.split('\n').length
  && JSON.stringify(rulePositions(report)) === JSON.stringify(rulePositions(englishReport))
  && JSON.stringify(rulePositions(report)) === JSON.stringify(rulePositions(khmerReport)))
// The mode is a module-level variable; leaving it set would poison the next
// message. render() restores it, and this is the check that says so.
check('rendering in another mode does not change the default',
  telegramLang.getTelegramLanguage() === 'both'
  && telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW) === report)
// Unknown settings values fall back to the bilingual default rather than
// blanking a report.
check('an unknown or empty language setting falls back to both',
  render('klingon', () => telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW)) === report
  && render('', () => telegram.formatShiftReport('Sunrise Mart', shift, figures, NOW)) === report)

// ---- 3. the shape is stable across shift states ----------------------------
const sectionTitles = (text) => text.split('\n').filter((line) => /^\d\. /.test(line))
const SIX_SECTIONS = [
  '1. Invoices / វិក្កយបត្រ', '2. Sales / ការលក់', '3. Cash count / ការរាប់សាច់ប្រាក់',
  '4. Payment methods / វិធីទូទាត់', '5. Delivery / ការដឹកជញ្ជូន', '6. Expenses / ចំណាយ',
]
assert.deepEqual(sectionTitles(report), SIX_SECTIONS, report)

// An OPEN shift has taken no closing count, so it shows the opening half and
// no difference at all -- printing one would read as a missing-cash alarm on
// every till still trading. The title, not a tag on the To line, says it.
const openShift = { ...shift, closed_at: null, closing_counted_usd: null, closing_counted_khr: null }
const openReport = render('both', () => telegram.formatShiftReport('Sunrise Mart', openShift, figures, NOW))
assert.deepEqual(sectionTitles(openReport), SIX_SECTIONS, openReport)
check('an open shift shows the opening count and no difference against a count nobody took',
  openReport.startsWith('🧑‍💼 Shift report / របាយការណ៍វេន — Open / កំពុងបើក · 06/09/2026')
  && openReport.includes('· Opening cash / សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛')
  && !openReport.includes('Closing cash')
  && !openReport.includes('Difference'), openReport)
// FIXED Sep 22 2026. The To line used to print `formatBusinessDateTime(now)`,
// which on a shift opened minutes ago rendered IDENTICAL to the From line --
// a window that reads as zero minutes long, which is what the owner pasted --
// and on a long one rendered a closing time that never happened. It now
// carries the same state pair the title does, so it cannot be misread as a
// timestamp at all.
check('an open shift states "open" on its To line instead of a closing time that never happened',
  openReport.includes('· To / ទៅ: Open / កំពុងបើក')
  && !openReport.includes('· To / ទៅ: 06/09/2026'), openReport)
// The defect in its own right: a shift opened one minute ago must not print
// the same value on both bound lines.
const justOpened = render('both', () => telegram.formatShiftReport('Sunrise Mart', { ...openShift, opened_at: '2026-09-06T13:59:00.000Z' }, figures, NOW))
const boundLines = justOpened.split('\n').filter((line) => /^· (From|To) \//.test(line))
check('the From and To lines of a just-opened shift are never the same string',
  boundLines.length === 2 && boundLines[0] !== boundLines[1], justOpened)
// A CLOSED shift still prints its real closing timestamp -- the fix is scoped
// to the open case and nothing else.
check('a closed shift still prints its real closing time',
  report.includes('· To / ទៅ: 06/09/2026 20:02'), report)

const partiallyRegistered = render('both', () => telegram.formatShiftReport('Sunrise Mart', {
  ...openShift, opening_float_usd: null, opening_float_khr: 0,
}, figures, NOW))
check('blank opening cash stays unknown while explicit zero stays measured',
  partiallyRegistered.includes('Opening cash / សាច់ប្រាក់ដើមវេន: — · 0៛'), partiallyRegistered)

// A cancelled shift is terminal, and says who cancelled it and why. The state
// is in the title; the three provenance lines sit under the identity block.
const cancelledReport = render('both', () => telegram.formatShiftReport('Sunrise Mart', {
  ...openShift, cancelled_at: '2026-09-06T04:30:00.000Z',
  cancelled_by_user_name: 'Manager', cancel_reason: 'Duplicate opening',
}, figures, NOW))
assert.deepEqual(sectionTitles(cancelledReport), SIX_SECTIONS, cancelledReport)
check('a cancelled shift names the state in the title and keeps its by/reason lines',
  cancelledReport.startsWith('🧑‍💼 Shift report / របាយការណ៍វេន — Cancelled / បានបោះបង់ · 06/09/2026')
  && cancelledReport.includes('Cancelled by / បោះបង់ដោយ: Manager')
  && cancelledReport.includes('Reason / មូលហេតុ: Duplicate opening')
  && cancelledReport.includes('To / ទៅ: 06/09/2026 11:30'), cancelledReport)

// A quiet shift drops every zero line but still states the two totals the shop
// always wants -- a $0.00 day is a fact, not a blank -- and still prints all
// six sections, the empty ones marked. The owner's reference shows every
// section even when the shop took nothing.
const quiet = render('both', () => telegram.formatShiftReport('Sunrise Mart', { ...openShift, opening_float_usd: 0, opening_float_khr: 0 }, {
  invoices: 0, cancelled: 0, edited: 0, revenueUsd: 0, profitUsd: 0,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  cash: { usd: 0, khr: 0, needsReview: false },
}, NOW))
assert.deepEqual(quiet.split('\n'), [
  '🧑‍💼 Shift report / របាយការណ៍វេន — Open / កំពុងបើក · 06/09/2026',
  '· Shop / ហាង: Sunrise Mart',
  '· ID / លេខសម្គាល់: S-0906-01',
  '· Cashier / អ្នកគិតប្រាក់: Za',
  '· From / ពី: 06/09/2026 08:15',
  '· To / ទៅ: Open / កំពុងបើក',
  RULE,
  '1. Invoices / វិក្កយបត្រ',
  '· Total / សរុប: 0',
  RULE,
  '2. Sales / ការលក់',
  // A shift that took nothing prints $0.00 and NOTHING in riel. The owner's
  // Sep 22 2026 paste showed `Revenue: $0.00 · 000៛` -- a riel figure with no
  // value, and a zero-padding no formatter in lib/telegram.ts produces. These
  // two rows are USD-only by construction; pinned here so an edit that adds a
  // riel equivalent has to face the zero case first.
  '· Revenue / ចំណូល: $0.00',
  '· Profit / ចំណេញ: $0.00',
  RULE,
  '3. Cash count / ការរាប់សាច់ប្រាក់',
  '· Opening cash / សាច់ប្រាក់ដើមវេន: $0.00 · 0៛',
  '· Expected cash / សាច់ប្រាក់ត្រូវមាន: $0.00 · 0៛',
  RULE,
  '4. Payment methods / វិធីទូទាត់',
  // `N/A` since Sep 22 2026 (owner: "show n/a"). The bare `—` it replaced
  // read as a value that failed to render rather than as "nothing here".
  '· N/A',
  RULE,
  '5. Delivery / ការដឹកជញ្ជូន',
  '· N/A',
  RULE,
  '6. Expenses / ចំណាយ',
  '· N/A',
], quiet)
check(`a shift that took nothing keeps all six sections and marks the empty ones (${quiet.split('\n').length} lines)`,
  !quiet.includes('Not Paid') && !quiet.includes('Delivery fee') && !quiet.includes('Refunds')
  && !quiet.includes('Cancelled') && !quiet.includes('Edited'), quiet)
check('the retired em-dash empty marker is gone from every section',
  !quiet.split('\n').includes('—') && quiet.split('\n').filter((line) => line === '· N/A').length === 3, quiet)
check('a zero row carries no empty riel figure',
  !/^· (Revenue|Profit)[^\n]*៛/m.test(quiet), quiet)

// An unrecorded courier cost is NULL, never $0.00 (deliveryActualCostExpr), so
// a courier with no payout recorded shows the fee alone rather than claiming
// the courier worked for free.
const noCourierCost = render('both', () => telegram.formatShiftReport('Sunrise Mart', shift, {
  ...figures, deliveries: [{ name: 'Grab', count: 3, feeUsd: 12, costUsd: 0 }],
}, NOW))
check('a courier with no recorded payout shows no $0.00 cost tail',
  noCourierCost.includes('• Grab — 3 · $12.00 fee / ថ្លៃដឹក')
  && !noCourierCost.includes('$0.00 cost'), noCourierCost)

// p5/losses (Sep 15 2026, owner: "i see the report says row removed has 1 no
// cost price. this is impossible find issue and fix"): the Loss line's
// unvalued-count suffix must survive into the KHMER rendering too, not just
// the English one -- a regression that stripped it on one language path would
// slip through a check that only ever read the English text.
const lossFigures = { ...figures, removalLossUsd: 12.5, removalLossUnvaluedRows: 1 }
const lossEn = render('en', () => telegram.formatShiftReport('Sunrise Mart', shift, lossFigures, NOW))
const lossKm = render('km', () => telegram.formatShiftReport('Sunrise Mart', shift, lossFigures, NOW))
check('the shift report Loss line carries the unvalued-count suffix in English',
  lossEn.split('\n').includes('· Loss: $12.50 (1?)'), lossEn)
check('...and the SAME suffix survives in the Khmer rendering of the same line',
  lossKm.split('\n').includes('· ខាតបង់: $12.50 (1?)'), lossKm)
// Loss sits directly below Not Paid, the owner's "also add one row below
// unpaid in reports as well".
const lossBoth = render('both', () => telegram.formatShiftReport('Sunrise Mart', shift, lossFigures, NOW)).split('\n')
check('and Loss sits directly below Not Paid',
  lossBoth.findIndex((line) => line.startsWith('· Loss')) === lossBoth.findIndex((line) => line.startsWith('· Not Paid')) + 1, lossBoth.join('\n'))

// The 8-row cap with an "Other" fold is applied in shiftFigures (it needs the
// kernel rows), so the formatter is pinned on the rows it is handed.
const many = render('both', () => telegram.formatShiftReport('Sunrise Mart', shift, {
  ...figures,
  paymentMethods: [...Array(7)].map((_, i) => ({ method: `M${i + 1}`, count: 1, usd: 1 }))
    .concat([{ method: 'Other / ផ្សេងទៀត', count: 5, usd: 5 }]),
}, NOW))
check('a capped payment breakdown prints its fold row like any other row',
  many.split('\n').filter((line) => line.startsWith('• M')).length === 7
  && many.includes('• Other / ផ្សេងទៀត — 5 · $5.00'), many)

// ---- 4. the day summary, same treatment ------------------------------------
// One set of numbers, two reports. The Sales section is the SAME block of
// lines in both, byte for byte -- if either formatter ever computes a figure
// its own way again, these two strings stop matching. (The fixture carries no
// discounts, because DayStats has no discount fields to print: the shift's
// two extra rows come from ShiftReportFigures only.)
const dayStats = {
  date: '2026-09-06',
  sales: {
    count: 24, usd: 486.25, cancelled: 1, refundUsd: 15, profitUsd: 142.6,
    deliveryFeeUsd: 12, creditUsd: 38,
    // Same source as the shift's: getSalesTotals' delivery_actual_cost_usd /
    // _count. A NULL cost is "not recorded", never $0.00, which is what the
    // count is for.
    deliveryCostUsd: 7.5, deliveryCostRecorded: 3,
  },
  fees: { count: 2, usd: 9.5, khr: 20000 },
  stockIn: { count: 3, quantity: 120 },
  stockOut: { count: 1, quantity: 4 },
}
const daySummary = render('both', () => telegram.formatDaySummary(dayStats, [{ cashier: 'za01', count: 18, usd: 300 }, { cashier: 'sok', count: 6, usd: 186.25 }]))
const daySections = daySummary.split('\n')
assert.deepEqual(daySections, [
  '📊 Business summary / សង្ខេបអាជីវកម្ម — 06/09/2026',
  RULE,
  '1. Sales / ការលក់',
  '· Revenue / ចំណូល: $486.25',
  '· Profit / ចំណេញ: $142.60',
  '· Delivery fee / ថ្លៃដឹក: $12.00',
  '· Not Paid / ប្រាក់ជំពាក់: $38.00',
  '· Refunds / ការសងប្រាក់: $15.00',
  RULE,
  '2. Invoices / វិក្កយបត្រ',
  '· Total / សរុប: 24 · Cancelled / បានបោះបង់: 1',
  RULE,
  '3. Expenses / ចំណាយ',
  '· Actual delivery cost / ថ្លៃដឹកដើម: $7.50',
  '· Other expenses / ចំណាយផ្សេងទៀត: $9.50 · 20,000៛',
  '· Total / សរុប: $17.00 · 20,000៛',
  RULE,
  '4. Stock / ស្តុក',
  '· Stock in / ស្តុកចូល: 3 movement(s) / ចលនាស្តុក · 120 unit(s) / ឯកតា',
  '· Stock out / ស្តុកចេញ: 1 movement(s) / ចលនាស្តុក · 4 unit(s) / ឯកតា',
  RULE,
  '5. Cashiers / អ្នកគិតប្រាក់',
  '• za01 — 18 · $300.00',
  '• sok — 6 · $186.25',
], daySummary)
check(`the day summary is titled, numbered and divided the same way (${daySections.length} lines)`, true)
// The day's Expenses total is arithmetic, exactly as the shift's is above: the
// fees table plus the courier money actually paid out, and nothing else. They
// print the same word, so they may not name two different sums -- they did
// until Sep 7 2026.
check('the day Expenses total is the fees table plus the recorded delivery cost',
  Math.round((9.5 + 7.5) * 100) / 100 === 17
  && daySummary.includes('Total / សរុប: $17.00 · 20,000៛'), daySummary)
check('the day summary fits one phone screen too', daySections.length <= 26, daySummary)
check('and its cashier bullets are name, receipts, money -- nothing else',
  daySummary.includes('• za01 — 18 · $300.00') && daySummary.includes('• sok — 6 · $186.25'), daySummary)

// THE SHARED SALES SECTION, BYTE FOR BYTE.
const sectionBlock = (text, title) => {
  const rows = text.split('\n')
  const first = rows.findIndex((line) => line.endsWith(title))
  const next = rows.indexOf(RULE, first + 1)
  return rows.slice(first + 1, next < 0 ? rows.length : next)
}
const shiftNoDiscounts = render('both', () => telegram.formatShiftReport('Sunrise Mart', shift, { ...figures, itemDiscountUsd: 0, invoiceDiscountUsd: 0 }, NOW))
check('one set of numbers renders a byte-identical Sales section in both reports',
  sectionBlock(shiftNoDiscounts, 'Sales / ការលក់').length === 5
  && sectionBlock(shiftNoDiscounts, 'Sales / ការលក់').join('\n') === sectionBlock(daySummary, 'Sales / ការលក់').join('\n'),
  `${sectionBlock(shiftNoDiscounts, 'Sales / ការលក់').join('\n')}\n---\n${sectionBlock(daySummary, 'Sales / ការលក់').join('\n')}`)

// The day summary honours the language mode through the same one variable.
const dayKm = render('km', () => telegram.formatDaySummary(dayStats, [{ cashier: 'za01', count: 18, usd: 300 }]))
check('the day summary renders in Khmer only when the shop chose km',
  dayKm.startsWith('📊 សង្ខេបអាជីវកម្ម — 06/09/2026')
  && dayKm.includes('1. ការលក់') && dayKm.includes('ចំណូល: $486.25')
  && !/[A-Za-z]/.test(dayKm.split('\n')[3]), dayKm)
// Section numbering follows the sections that actually print: a category the
// owner switched off must not leave a hole in the numbering.
const salesOff = render('both', () => telegram.formatDaySummary(dayStats, [], { sales: false, stock_in: false, stock_out: false }))
// UPDATED Sep 23 2026: Cashiers now appears as section 2 with `· N/A` under
// it. There is no category switch for cashiers, so an empty cashier list is
// "nobody rang anything up today", which is a fact the report states -- while
// Sales, Stock in and Stock out, switched OFF here, still leave nothing at
// all. That is the distinction the fix had to keep: off removes the section,
// empty prints N/A.
check('numbering closes up when a switched-off category removes a section',
  salesOff.split('\n').filter((line) => /^\d\. /.test(line)).join(' | ') === '1. Expenses / ចំណាយ | 2. Cashiers / អ្នកគិតប្រាក់', salesOff)
check('a switched-off category leaves no N/A placeholder behind either',
  !salesOff.includes('Sales / ការលក់') && !salesOff.includes('Stock / ស្តុក'), salesOff)

// ---- 5. the absences -------------------------------------------------------
// Each string below is a line the PRE-REDESIGN report printed for this very
// fixture. They are the measurement of "so long".
//
// 'Payment method' and 'Delivery service' LEFT this list on Sep 21 2026: the
// owner's reference layout has a section for each, so they are reinstated --
// as two compact bulleted sections, not as the prose blocks they used to be.
const RETIRED = [
  'Cost of goods',            // an eleven-row money block, of which this was one
  'Avg order value',
  'Store discount',
  'Membership discount',
  // 'Gross sale' left this list on Sep 21 2026: the owner's reference layout
  // lists it under the two discount cuts (printed only when a cut exists).
  'Delivery margin',
  'Cash sales',               // the five printed drawer components...
  'Courier /',
  'Expected /',
  'Unpaid credit',            // ...and the credit line that sat under them
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
// The one thing that must NOT have been dropped: the drawer arithmetic still
// comes from the shared module, printed as one line instead of eight.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
check('the Difference line is still the shared reconciliation, not a private formula',
  /computeShiftReconciliation\(/.test(source) && /loadShiftReconciliation\(/.test(source)
  && !/opening[^\n]*\+[^\n]*cashSales[^\n]*-[^\n]*expenses/.test(source))
// Reinstated Sep 21 2026: the two breakdowns are read from the SAME kernel
// entry points routes/reports.ts uses, never re-derived here.
check('the two breakdown sections read the kernel, not a private query',
  /getPaymentMethodBreakdown\(env, filters\)/.test(source) && /getDeliveryContactTotals\(env, filters\)/.test(source)
  && !/SELECT[^;]*GROUP BY[^;]*payment_method/i.test(source))
// The language mode is applied at COMPOSITION. A post-hoc split on ' / ' would
// cut a value in half -- a note, a courier name or a fold label can contain it.
check('the language mode is applied while composing, never by splitting finished text',
  /withLanguage\(/.test(source) && !/split\(BILINGUAL_SEPARATOR/.test(source)
  && !/replace\([^\n]*BILINGUAL_SEPARATOR[^\n]*''\)/.test(source))

console.log(`\nALL ${passed} CHECKS PASSED`)
