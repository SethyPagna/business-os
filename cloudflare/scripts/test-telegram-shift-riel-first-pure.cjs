const productStockGuard = require('./harness/product_stock_guard.cjs')
// Owner A72 + Q3b (A78): riel first, dollars per SHIFT, on the Telegram shift report and the after-shift overview.
//   * a pair prints the riel half first: `100,000៛ · $50.00`, never dollars first;
//   * the dollar half prints on EVERY pair row of a message when the shift has any dollar figure, and on NONE when it has none
//     (a riel-only shift never prints a "$" on a cash row) -- per shift, not per line;
//   * "any dollar figure" is the three registered counts and, in the report, every dollar half of the drawer reconciliation (cash sales, refunds, expenses,
//     courier, expected, counted, difference): a $2 cash sale alone makes the shift a dollar shift;
//   * business results (revenue, profit, refunds, fees...) stay dollars, canonical revenue, whatever the cash rule says.
// Pure: the real lib/telegram.ts over its real helpers, nothing is sent.
// Run (from cloudflare/): node scripts/test-telegram-shift-riel-first-pure.cjs
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
    if (request === './productStockGuard') return productStockGuard
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
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './saleStatusResolution': require('./harness/sale_status_resolution.cjs'), './schemaProbe': schemaProbeReal, './db': noDb, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': noDb })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }
// The drawer arithmetic is the REAL shared one (lib/shiftReconciliation.ts):
// the report must not grow a private second formula for the Difference line.
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': noDb, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', { './schemaObjectProbe': require('./harness/schema_object_probe.cjs'),
  './lowStockSettings': lowStockStub, './db': noDb, './businessDateWindow': businessDateWindow,
  './telegramLang': telegramLang, './salesAnalytics': salesAnalytics, './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation,
})

let passed = 0
const check = (label, cond, detail) => { assert.ok(cond, detail ? `${label}\n${detail}` : label); passed += 1; console.log(`PASS ${label}`) }
const render = (mode, build) => {
  const previous = telegramLang.getTelegramLanguage()
  telegramLang.setTelegramLanguage(mode)
  try { return build() } finally { telegramLang.setTelegramLanguage(previous) }
}
const NOW = Date.parse('2026-11-20T14:00:00.000Z')
const baseShift = {
  shift_code: 'S-1120-01', scope_mode: 'per_account', user_id: 7, user_name: 'Za', branch_id: 1, branch_name: 'Shop', business_date: '2026-11-20',
  opened_at: '2026-11-20T01:15:00.000Z', opening_float_usd: 0, opening_float_khr: 100000, additional_cash_usd: 0, additional_cash_khr: 0,
  closed_at: '2026-11-20T13:02:00.000Z', closing_counted_usd: 0, closing_counted_khr: 240000,
  cancelled_at: null, cancelled_by_user_name: null, cancel_reason: null,
}
const baseFigures = {
  invoices: 3, cancelled: 0, edited: 0, revenueUsd: 40, profitUsd: 12, itemDiscountUsd: 0, invoiceDiscountUsd: 0, grossSalesUsd: 40,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0, refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  cash: { usd: 0, khr: 160000, needsReview: false }, paymentMethods: [{ method: 'Cash', count: 3, usd: 40 }], deliveries: [], expenseDetails: [],
}
const shiftOf = (patch) => ({ ...baseShift, ...patch })
const figuresOf = (patch) => ({ ...baseFigures, ...patch })
const report = (shift, figures) => render('en', () => telegram.formatShiftReport('Leang Cosmetics', shift, figures, NOW))
const overviewFigures = {
  invoices: 3, cancelled: 0, revenueUsd: 40, profitUsd: 12, itemDiscountUsd: 0, invoiceDiscountUsd: 0, grossSalesUsd: 40, deliveryFeeUsd: 0, refundUsd: 0, creditUsd: 0,
  paymentMethods: [{ method: 'Cash', count: 3, usd: 40 }], expenses: { fees: { usd: 0, khr: 0 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 } }, unbranchedFees: null, returns: { count: 0, refundUsd: 0 },
}
const overview = (shift) => render('en', () => telegram.formatShiftOverview('Leang Cosmetics', shift, overviewFigures, undefined, NOW))
/** The cash-count rows of a message: from the Cash count header to the next header. */
const cashRows = (text) => {
  const rows = text.split('\n')
  const start = rows.findIndex((row) => /^=+Cash count=+$/.test(row))
  assert.ok(start >= 0, 'the message has a Cash count section\n' + text)
  const rest = rows.slice(start + 1)
  const end = rest.findIndex((row) => /^=+.*=+$/.test(row))
  return end < 0 ? rest : rest.slice(0, end)
}
const rowOf = (rows, label) => rows.find((row) => row.startsWith(`· ${label}:`)) || ''

// ---- 1. a riel-only shift: no "$" on any cash row, riel alone ---------------------------------------------------------------
{
  const rows = cashRows(report(shiftOf({}), figuresOf({})))
  check('riel-only shift: Opening, Cash used and Closing print the riel alone', rowOf(rows, 'Opening cash') === '· Opening cash: 100,000៛' && rowOf(rows, 'Cash used') === '· Cash used: 0៛' && rowOf(rows, 'Closing cash') === '· Closing cash: 240,000៛', rows.join('\n'))
  check('riel-only shift: Expected and Difference print the riel alone, signed', rowOf(rows, 'Expected cash') === '· Expected cash: 260,000៛' && rowOf(rows, 'Difference') === '· Difference: −20,000៛', rows.join('\n'))
  check('riel-only shift: no "$" anywhere in the Cash count section', !rows.join('\n').includes('$'), rows.join('\n'))
  const open = cashRows(report(shiftOf({ closed_at: null, closing_counted_usd: null, closing_counted_khr: null }), figuresOf({})))
  check('an open riel-only shift has no closing row and no "$"', !rowOf(open, 'Closing cash') && !open.join('\n').includes('$'), open.join('\n'))
}

// ---- 2. a shift with only a $5 closing count: riel first, then dollars, on EVERY pair row ---------------------------------------
{
  const text = report(shiftOf({ closing_counted_usd: 5 }), figuresOf({}))
  const rows = cashRows(text)
  check('closing count of $5 only: Opening, Cash used and Closing all read riel then dollars', rowOf(rows, 'Opening cash') === '· Opening cash: 100,000៛ · $0.00' && rowOf(rows, 'Cash used') === '· Cash used: 0៛ · $0.00' && rowOf(rows, 'Closing cash') === '· Closing cash: 240,000៛ · $5.00', rows.join('\n'))
  check('closing count of $5 only: Expected and Difference carry the dollar half too, riel first', /^· Expected cash: 260,000៛ · \$0\.00$/.test(rowOf(rows, 'Expected cash')) && /^· Difference: −20,000៛ · \+\$5\.00$/.test(rowOf(rows, 'Difference')), rows.join('\n'))
  for (const row of rows.filter((r) => r.includes('$') && !/Review/.test(r))) check('dollars are never first: ' + row, !/^· [^:]+: [+−]?\$/.test(row), row)
}

// ---- 3. a shift whose only dollar is a $2 cash sale: the same rule (the report reads the reconciliation too) --------------------
{
  const text = report(shiftOf({}), figuresOf({ cash: { usd: 2, khr: 160000, needsReview: false } }))
  const rows = cashRows(text)
  check('a $2 cash sale only: every pair row shows the dollar half, riel first', rows.filter((r) => /^· (Opening cash|Cash used|Closing cash|Expected cash|Difference):/.test(r)).length === 5
    && rows.filter((r) => /^· (Opening cash|Cash used|Closing cash|Expected cash|Difference):/.test(r)).every((r) => /៛ · [+−]?\$\d/.test(r)), rows.join('\n'))
  check('a $2 cash sale only: Expected is $2 over the float', rowOf(rows, 'Expected cash') === '· Expected cash: 260,000៛ · $2.00', rows.join('\n'))
}

// ---- 4. the overview: the closing shift's three registered rows, same rule -----------------------------------------------------
{
  const riels = cashRows(overview(shiftOf({})))
  check('overview, riel-only shift: three rows, riel alone, no "$"', riels.length === 3 && !riels.join('\n').includes('$') && rowOf(riels, 'Opening cash') === '· Opening cash: 100,000៛', riels.join('\n'))
  const dollars = cashRows(overview(shiftOf({ closing_counted_usd: 5 })))
  check('overview, $5 closing: every row riel then dollars', dollars.length === 3 && dollars.every((r) => /៛ · \$\d/.test(r)) && rowOf(dollars, 'Closing cash') === '· Closing cash: 240,000៛ · $5.00', dollars.join('\n'))
  const added = cashRows(overview(shiftOf({ additional_cash_usd: 2 })))
  check('overview, $2 cash used: the shift is a dollar shift on every row', added.every((r) => /៛ · \$\d/.test(r)), added.join('\n'))
}

// ---- 5. business results stay dollars (canonical revenue), whatever the cash rule says ------------------------------------------
{
  const text = report(shiftOf({}), figuresOf({}))
  check('a riel-only shift still prints Revenue, Profit and the payment methods in dollars', text.includes('· Revenue: $40.00') && text.includes('· Profit: $12.00') && text.includes('Cash: 3 · $40.0000'), text)
  const full = report(shiftOf({ closing_counted_usd: 5 }), figuresOf({}))
  check('and the same lines are unchanged on a dollar shift', full.includes('· Revenue: $40.00') && full.includes('· Profit: $12.00'), full)
}

// ---- 6. the per-shift test itself, row by row ------------------------------------------------------------------------------------
{
  const pair = (usd, khr) => ({ usd, khr })
  const recon = (patch = {}) => ({ opening: pair(0, 0), additional_cash: pair(0, 0), cash_sales: pair(0, 0), refunds: pair(0, 0), expenses: pair(0, 0), courier: pair(0, 0), expected: pair(0, 0), counted: pair(0, 0), difference: pair(0, 0), needs_review: false, review_codes: [], ...patch })
  const base = { opening_float_usd: 0, additional_cash_usd: 0, closing_counted_usd: null }
  check('shiftHasUsdCash: zeros, nulls and no reconciliation are riel-only', !telegram.shiftHasUsdCash(base) && !telegram.shiftHasUsdCash({ opening_float_usd: null, additional_cash_usd: undefined, closing_counted_usd: null }, recon({ expected: pair(null, 5) })))
  check('shiftHasUsdCash: each registered dollar count makes it a dollar shift', telegram.shiftHasUsdCash({ ...base, opening_float_usd: 1 }) && telegram.shiftHasUsdCash({ ...base, additional_cash_usd: 1 }) && telegram.shiftHasUsdCash({ ...base, closing_counted_usd: 1 }))
  for (const key of ['cash_sales', 'refunds', 'expenses', 'courier', 'expected', 'counted', 'difference']) check(`shiftHasUsdCash: a dollar ${key} makes it a dollar shift`, telegram.shiftHasUsdCash(base, recon({ [key]: pair(0.5, 0) })))
}

// ---- 7. Expenses follow the same per-shift rule as the Cash count rows (riel first, dollar half on every row or on none) ------------
{
  const sectionRows = (text, name) => {
    const rows = text.split('\n')
    const start = rows.findIndex((row) => row === `=====${name}=====`)
    assert.ok(start >= 0, `the message has an ${name} section\n` + text)
    const rest = rows.slice(start + 1)
    const end = rest.findIndex((row) => /^=+.*=+$/.test(row))
    return end < 0 ? rest : rest.slice(0, end)
  }
  const ice = (usd, khr) => ({ otherExpenseUsd: usd, otherExpenseKhr: khr, expenseDetails: [{ label: 'Ice', usd, khr }] })

  const dollars = report(shiftOf({ closing_counted_usd: 5 }), figuresOf(ice(2, 8000)))
  const dollarRows = sectionRows(dollars, 'Expenses')
  check('a dollar shift with a $2 + 8,000៛ expense: the row reads riel first, then dollars', rowOf(dollarRows, 'Ice') === '· Ice: 8,000៛ · $2.00', dollarRows.join('\n'))
  check('a dollar shift with a $2 + 8,000៛ expense: the total reads riel first, then dollars', rowOf(dollarRows, 'Total') === '· Total: 8,000៛ · $2.00', dollarRows.join('\n'))
  check('the Closing cash row of the same shift is the same shape', rowOf(cashRows(dollars), 'Closing cash') === '· Closing cash: 240,000៛ · $5.00', cashRows(dollars).join('\n'))

  const rielExpense = report(shiftOf({ closing_counted_usd: 5 }), figuresOf(ice(0, 8000)))
  const rielExpenseRows = sectionRows(rielExpense, 'Expenses')
  check('a dollar shift with a riel-only expense: the row keeps its dollar half (per shift, not per line), as the Cash count rows do', rowOf(rielExpenseRows, 'Ice') === '· Ice: 8,000៛ · $0.00' && rowOf(rielExpenseRows, 'Total') === '· Total: 8,000៛ · $0.00' && rowOf(cashRows(rielExpense), 'Opening cash') === '· Opening cash: 100,000៛ · $0.00', rielExpenseRows.join('\n'))

  const rielOnly = report(shiftOf({}), figuresOf(ice(0, 8000)))
  const rielOnlyRows = sectionRows(rielOnly, 'Expenses')
  check('a riel-only shift with a riel expense: the row and the total print the riel alone', rowOf(rielOnlyRows, 'Ice') === '· Ice: 8,000៛' && rowOf(rielOnlyRows, 'Total') === '· Total: 8,000៛', rielOnlyRows.join('\n'))
  check('a riel-only shift: no "$" anywhere in the Expenses section', !rielOnlyRows.join('\n').includes('$'), rielOnlyRows.join('\n'))

  const delivery = sectionRows(report(shiftOf({ closing_counted_usd: 5 }), figuresOf({ ...ice(2, 8000), deliveryCostUsd: 1, deliveryCostRecorded: 1 })), 'Expenses')
  check('the delivery cost row and the total follow the same rule', rowOf(delivery, 'Actual delivery cost') === '· Actual delivery cost: 0៛ · $1.00' && rowOf(delivery, 'Total') === '· Total: 8,000៛ · $3.00', delivery.join('\n'))
  const noDetails = sectionRows(report(shiftOf({ closing_counted_usd: 5 }), figuresOf({ otherExpenseUsd: 0, otherExpenseKhr: 8000 })), 'Expenses')
  check('with no per-expense rows the single other-expenses row follows the same rule', noDetails.length === 2 && noDetails.every((row) => /^· [^:]+: 8,000៛ · \$0\.00$/.test(row)), noDetails.join('\n'))
  check('dollars are never first on an Expenses row', ![dollarRows, rielExpenseRows, delivery].some((rows) => rows.some((row) => /^· [^:]+: [+−]?\$/.test(row))))
}

console.log(`PASS ${passed} Telegram riel-first checks`)
