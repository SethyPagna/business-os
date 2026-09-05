// Owner ask N6: the Telegram day / cashier / sales reports must read the SAME
// kernel every other stat surface reads. They did not.
//
// `/report` and `/summary` answered with
//     SELECT COUNT(*), SUM(total_usd), SUM(total_khr) FROM sales WHERE <day>
// with no status filter at all. That figure:
//   * counted VOIDED receipts as takings,
//   * called the tax and the delivery fee "sales",
//   * subtracted no refund,
// so the number the owner reads on a phone at closing time disagreed with the
// Sales page, the Dashboard, the Reports hub -- and with the SHIFT report
// three hundred lines further down the very same file, which has read the
// kernel since S4-7. `/cashiers` had the identical defect, one slice down.
//
// This test renders the real messages against a real (in-memory) database
// through the real kernel, and carries a POSITIVE CONTROL: the pre-fix SQL is
// rebuilt verbatim and run over the same rows, so the fixture is proven to be
// one the old and new implementations actually disagree about.
//
// Run (from cloudflare/): node scripts/test-telegram-day-report-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const Database = require('better-sqlite3')

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

// ---- the database -----------------------------------------------------------
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, receipt_number TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL,
    tax_usd REAL, total_usd REAL, total_khr REAL,
    delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER,
    delivery_actual_cost_usd REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, branch_name TEXT, customer_id INTEGER, customer_name TEXT,
    cashier_id INTEGER, cashier_name TEXT, payment_method TEXT, amount_paid_usd REAL
  );
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    applied_price_usd REAL, applied_price_khr REAL,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL,
    status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER,
    supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT);
  CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT);
  CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER, created_by INTEGER, created_at TEXT);
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, movement_type TEXT, quantity REAL, created_at TEXT);
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
`)

// 2026-08-10 05:00Z = 12:00 local (UTC+7). The day is not the variable here.
const AT = '2026-08-10 05:00:00'
const ins = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, receipt_number, subtotal_usd, discount_usd, membership_discount_usd, tax_usd,
   total_usd, total_khr, delivery_fee_usd, delivery_fee_paid_by, is_delivery, branch_id, branch_name, cashier_id, cashier_name, payment_method)
  VALUES (@id,@created_at,@sale_status,@receipt_number,@subtotal_usd,@discount_usd,0,@tax_usd,
   @total_usd,@total_khr,@delivery_fee_usd,'customer',0,1,'shop',@cashier_id,@cashier_name,'cash')`)
const sale = (o) => ins.run({ discount_usd: 0, tax_usd: 0, total_khr: 0, delivery_fee_usd: 0, created_at: AT, ...o })

// A real sale: $100 of goods, $10 off, $8 tax, $5 delivery. Revenue is $90 --
// the tax and the delivery fee are not sales.
sale({ id: 1, sale_status: 'completed', receipt_number: '20260810-090000', subtotal_usd: 100, discount_usd: 10, tax_usd: 8, delivery_fee_usd: 5, total_usd: 103, total_khr: 412000, cashier_id: 1, cashier_name: 'aza' })
// A VOIDED receipt, for a large amount. Worth nothing, and the old query
// counted every cent of it.
sale({ id: 2, sale_status: 'cancelled', receipt_number: '20260810-100000', subtotal_usd: 500, total_usd: 500, total_khr: 2000000, cashier_id: 1, cashier_name: 'aza' })
// A sale refunded the same day: $40 rung up, $15 given back. Revenue is $25.
sale({ id: 3, sale_status: 'completed', receipt_number: '20260810-110000', subtotal_usd: 40, total_usd: 40, total_khr: 160000, cashier_id: 2, cashier_name: 'sok' })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name, applied_price_usd, applied_price_khr) VALUES (?,?,?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 100, 1, 101, 'Lamp', 100, 400000)
insItem.run(2, 2, 1, 200, 500, 1, 102, 'Sofa', 500, 2000000)
insItem.run(3, 3, 1, 10, 40, 1, 103, 'Mug', 40, 160000)

db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, total_refund_khr, status, return_scope, created_at, branch_id, reason) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(1, 3, 15, 0, 'completed', 'customer', AT, 1, 'damaged')
db.prepare('INSERT INTO return_items (id, return_id, quantity, cost_price_usd, return_to_stock, stock_action) VALUES (?,?,?,?,?,?)')
  .run(1, 1, 1, 4, 1, 'restock')

// ---- the real modules -------------------------------------------------------
const dbShim = { getDb: () => db }
const lang = loadReal('lib/telegramLang.ts')
const saleTotals = loadReal('lib/saleTotals.ts')
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const analytics = loadReal('lib/salesAnalytics.ts', { './db': dbShim, './businessDateWindow': businessDateWindow })
const telegram = loadReal('lib/telegram.ts', {
  './db': dbShim,
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': analytics,
})

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

;(async () => {
// ---- POSITIVE CONTROL: what the reports used to say --------------------------
const oldDay = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_khr), 0) AS khr
  FROM sales WHERE ${businessDateWindow.localDateRangeClause('created_at', '@date', '@date')}`).get({ date: '2026-08-10' })
check(`POSITIVE CONTROL: the pre-fix day query really did report ${oldDay.count} receipts and $${oldDay.usd}`,
  oldDay.count === 3 && oldDay.usd === 643)
const oldCashiers = db.prepare(`SELECT COALESCE(NULLIF(TRIM(cashier_name), ''), 'Unknown') AS cashier,
    COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd
  FROM sales WHERE ${businessDateWindow.localDateRangeClause('created_at', '@date', '@date')}
  GROUP BY 1 ORDER BY usd DESC`).all({ date: '2026-08-10' })
check(`POSITIVE CONTROL: and credited the voided receipt to its cashier ($${oldCashiers[0].usd} for ${oldCashiers[0].cashier})`,
  oldCashiers[0].cashier === 'aza' && oldCashiers[0].usd === 603)

// ---- what the kernel says ----------------------------------------------------
const totals = await analytics.getSalesTotals({}, { startDate: '2026-08-10', endDate: '2026-08-10', branchId: null })
check(`the kernel's revenue for the day is $${totals.revenue_usd} (net sales $130 less the $15 refund)`,
  totals.revenue_usd === 115 && totals.tx_count === 2 && totals.cancelled_tx_count === 1 && totals.refund_usd === 15)

// ---- the rendered message ----------------------------------------------------
const report = await telegram.telegramCommandReply({}, '/report 10/08/2026')
check('the day report renders', report.includes('10/08/2026') && report.length > 40)
check(`the Sales line carries the KERNEL revenue, not the old gross ($115.00 present, $643.00 absent)`,
  report.includes('$115.00') && !report.includes('$643.00'))
check('and the kernel receipt count, not the count that included the void',
  /2 receipt/.test(report) && !/3 receipt/.test(report))
check('the refund that produced the difference is printed, so the number explains itself',
  report.includes('$15.00'))
check('the voided receipt is REPORTED as voided rather than silently counted or silently dropped',
  /Cancelled/.test(report) && /1 receipt/.test(report))
check('the tax and the delivery fee are not inside the sales figure',
  !report.includes('$103.00') && !report.includes('$128.00'))

check(`each cashier's line is the same kernel sliced, so aza shows $90.00 not $603.00`,
  report.includes('aza') && report.includes('$90.00') && !report.includes('$603.00'))
check('and sok shows the refunded sale net, $25.00', report.includes('sok') && report.includes('$25.00'))
// The strongest statement available on a rendered message: the two cashier
// figures add up to the headline. They could not before -- one of them
// included a void.
check('the per-cashier revenues sum to the day revenue (90 + 25 = 115)', 90 + 25 === totals.revenue_usd)

// ---- /sales ------------------------------------------------------------------
const salesMsg = await telegram.telegramCommandReply({}, '/sales 10/08/2026')
check('the /sales total is the kernel total too', salesMsg.includes('$115.00') && !salesMsg.includes('$643.00'))
check('the receipt LIST does not show the voided receipt under a total it is not part of',
  salesMsg.includes('20260810-090000') && salesMsg.includes('20260810-110000') && !salesMsg.includes('20260810-100000'))

// ---- one implementation, not a lookalike ------------------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
check('telegram.ts no longer sums sale totals for the day or cashier reports at all',
  !/SUM\(total_usd\), 0\) AS usd/.test(src))
check('the day and cashier figures come from the kernel entry points',
  /getSalesTotals\(env, dayFilters\(date\)\)/.test(src)
  && /getSalesGroupedTotals\(env, dayFilters\(date\), 'cashier'/.test(src))
check('the shift report, which already read the kernel, is untouched by this change',
  /getSalesTotals\(env, filters\)/.test(src) && /shiftInvoiceCounts\(env, shift, nowMs\)/.test(src))

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
