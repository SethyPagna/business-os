// Tests for the "Business summary" workbook backend (Section 5, Sep 2 2026
// RC): routes/reports.ts + lib/salesAnalytics.ts's getBusinessSummaryDayRows.
//
// Two layers, each exercising the REAL shipped code (not a reimplementation):
//
//   1. The day-bucketed kernel: salesAnalytics.ts is transpiled with a
//      getDb() shim (same approach test-sales-revenue-convergence-pure.cjs
//      uses) and getBusinessSummaryDayRows() is called against a real
//      better-sqlite3 fixture -- proves per-day rows reconcile to the
//      canonical revenue/COGS definition and that a NULL cost_price_usd
//      snapshot is flagged (cost_missing_snapshot_lines) WITHOUT changing
//      cost_usd's own COALESCE(...,0) basis.
//
//   2. routes/reports.ts's pure row/day-shaping helpers (buildDaySummaryRow,
//      buildSaleReportRow, buildReturnReportRow, buildExpenseReportRow,
//      mergeReconciliationDays, buildMonthRollups, sumReconciliationTotals)
//      are extracted by regex (reports.ts constructs a live Hono app +
//      imports getDb/auth/permissions at module load, same reason
//      test-fees-pure.cjs extracts routes/fees.ts's helpers instead of
//      requiring the file directly) and unit-tested directly, most
//      importantly the "never assign the key" admin-gating contract: a
//      non-admin caller's row object must never even CONTAIN cost_usd /
//      gross_profit_usd / margin_pct / cost_missing_snapshot_lines keys.
//
// Run (from cloudflare/): node scripts/test-business-workbook-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// =====================================================================
// LAYER 1: getBusinessSummaryDayRows over a real fixture DB
// =====================================================================
const kernelSrcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const kernelSrc = fs.readFileSync(kernelSrcPath, 'utf8')
const strippedKernel = ('// @ts-nocheck\n' + kernelSrc)
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-workbook-pure-'))
const tsPath = path.join(tmpDir, 'salesAnalytics.ts')
fs.writeFileSync(tsPath, strippedKernel)
const winPath = path.join(tmpDir, 'businessDateWindow.ts')
fs.writeFileSync(winPath, fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath} ${winPath}`, {
  cwd: tmpDir,
  stdio: 'inherit',
})
const kernel = require(path.join(tmpDir, 'salesAnalytics.js'))

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    created_at TEXT,
    sale_status TEXT,
    subtotal_usd REAL,
    discount_usd REAL,
    membership_discount_usd REAL,
    tax_usd REAL,
    total_usd REAL,
    delivery_fee_usd REAL,
    delivery_fee_paid_by TEXT,
    is_delivery INTEGER,
    delivery_actual_cost_usd REAL,
    branch_id INTEGER,
    customer_id INTEGER,
    payment_method TEXT,
    customer_name TEXT,
    receipt_number TEXT
  );
  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER,
    quantity REAL,
    cost_price_usd REAL,
    total_usd REAL,
    branch_id INTEGER,
    product_id INTEGER,
    product_name TEXT
  );
  CREATE TABLE returns (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER,
    total_refund_usd REAL,
    status TEXT,
    return_scope TEXT,
    created_at TEXT,
    branch_id INTEGER
  );
  CREATE TABLE customers (id INTEGER PRIMARY KEY, membership_number TEXT);
`)

// Two business days spanning nothing tricky (bucketing itself is pinned by
// the convergence/daterange tests already) -- this fixture's job is COGS
// transparency + the day-row -> Summary-row shape, not re-proving UTC+7.
const AT = (day, hour) => `2026-08-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00` // local = UTC+7

const insSale = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, subtotal_usd, discount_usd, membership_discount_usd, tax_usd, total_usd,
   delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_actual_cost_usd, branch_id, customer_id, payment_method, receipt_number)
  VALUES (@id,@created_at,@sale_status,@subtotal_usd,@discount_usd,@membership_discount_usd,@tax_usd,@total_usd,
   @delivery_fee_usd,@delivery_fee_paid_by,@is_delivery,@delivery_actual_cost_usd,@branch_id,@customer_id,@payment_method,@receipt_number)`)
const sale = (o) => insSale.run({
  delivery_fee_usd: 0, delivery_fee_paid_by: 'customer', is_delivery: 0,
  delivery_actual_cost_usd: null, branch_id: 1, customer_id: null,
  payment_method: 'cash', receipt_number: String(o.id), ...o,
})

// Day 20 (local): two completed sales, one with a NULL cost snapshot on one
// of its two line items (legacy row -- product cost wasn't captured at sale
// time). Day 21: one completed sale, no missing snapshots, plus a customer
// refund.
sale({ id: 1, created_at: AT(20, 5), sale_status: 'completed', subtotal_usd: 100, discount_usd: 10, membership_discount_usd: 0, tax_usd: 5, total_usd: 95 })
sale({ id: 2, created_at: AT(20, 6), sale_status: 'completed', subtotal_usd: 50, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, total_usd: 50 })
sale({ id: 3, created_at: AT(21, 5), sale_status: 'completed', subtotal_usd: 80, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, total_usd: 80 })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 90, 1, 101, 'A')     // S1 line 1: cost known = 30
insItem.run(2, 1, 1, null, 10, 1, 102, 'B')   // S1 line 2: NULL cost snapshot -- missing, counts as 0 in cost_usd
insItem.run(3, 2, 1, 20, 50, 1, 103, 'C')     // S2: cost known = 20
insItem.run(4, 3, 1, 15, 80, 1, 104, 'D')     // S3: cost known = 15

const insRet = db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, status, return_scope, created_at, branch_id) VALUES (?,?,?,?,?,?,?)')
insRet.run(1, 3, 10, 'completed', 'customer', AT(21, 8), 1) // customer refund on S3

;(async () => {
  const filters = { startDate: '2026-08-20', endDate: '2026-08-21', branchId: null }
  const dayRows = await kernel.getBusinessSummaryDayRows({ __db: db }, filters)

  check('getBusinessSummaryDayRows returns exactly the two business days seeded', dayRows.length === 2)
  const day20 = dayRows.find((r) => r.date === '2026-08-20')
  const day21 = dayRows.find((r) => r.date === '2026-08-21')
  assert.ok(day20 && day21, 'both business days must be present')

  // Day 20: revenue = (100-10) + 50 = 140 (no refunds). cost_usd = 30 + 0 (NULL treated as 0 via COALESCE) + 20 = 50.
  check('day 20 net revenue = 140 (100-10 discount, +50)', day20.revenue_usd === 140)
  check('day 20 cost_usd = 50 -- the NULL snapshot line contributes 0, not an error/NaN', day20.cost_usd === 50)
  check('day 20 cost_missing_snapshot_lines = 1 -- flags the NULL line WITHOUT altering cost_usd', day20.cost_missing_snapshot_lines === 1)
  check('day 20 profit_usd = revenue(140) - cost(50) - store-delivery(0) = 90', day20.profit_usd === 90)

  // Day 21: revenue = 80 - 10 refund = 70. cost_usd = 15. No missing snapshots.
  check('day 21 net revenue = 70 (80 gross - 10 customer refund)', day21.revenue_usd === 70)
  check('day 21 cost_usd = 15', day21.cost_usd === 15)
  check('day 21 cost_missing_snapshot_lines = 0 -- no legacy rows that day', day21.cost_missing_snapshot_lines === 0)

  console.log(`\nLayer 1 (kernel): ${passed} check(s) passed so far.\n`)

  // =====================================================================
  // LAYER 2: routes/reports.ts's pure row/day-shaping helpers
  // =====================================================================
  const reportsSourcePath = path.join(__dirname, '..', 'src', 'routes', 'reports.ts')
  const reportsSource = fs.readFileSync(reportsSourcePath, 'utf8').replace(/\r\n/g, '\n')
  const saleTotalsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'saleTotals.ts'), 'utf8').replace(/\r\n/g, '\n')

  function extractFn(name) {
    const re = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`)
    const m = reportsSource.match(re)
    if (!m) throw new Error(`${name} not found in routes/reports.ts -- source may have changed`)
    return m[0].replace('export function', 'function')
  }
  function extractPlainFn(name) {
    const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`)
    const m = reportsSource.match(re)
    if (!m) throw new Error(`${name} not found in routes/reports.ts -- source may have changed`)
    return m[0]
  }
  function extractRound2() {
    const m = saleTotalsSource.match(/export function round2\([\s\S]*?\n\}\n/)
    if (!m) throw new Error('round2 not found in lib/saleTotals.ts')
    return m[0].replace('export function', 'function')
  }

  const combinedSource = [
    extractRound2(),
    extractPlainFn('num'),
    extractFn('buildDaySummaryRow'),
    extractFn('mergeReconciliationDays'),
    extractFn('buildMonthRollups'),
    extractFn('sumReconciliationTotals'),
    extractFn('buildSaleReportRow'),
    extractFn('buildReturnReportRow'),
    extractFn('buildExpenseReportRow'),
    'export { round2, num, buildDaySummaryRow, mergeReconciliationDays, buildMonthRollups, sumReconciliationTotals, buildSaleReportRow, buildReturnReportRow, buildExpenseReportRow }',
  ].join('\n')

  const { outputText } = ts.transpileModule(combinedSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'reports-pure.ts',
  })
  const moduleObj = { exports: {} }
  new Function('exports', outputText)(moduleObj.exports)
  const {
    buildDaySummaryRow, mergeReconciliationDays, buildMonthRollups, sumReconciliationTotals,
    buildSaleReportRow, buildReturnReportRow, buildExpenseReportRow,
  } = moduleObj.exports

  // ---- buildDaySummaryRow: never-assign-the-key admin gating ----
  const daySource = {
    date: '2026-08-20', tx_count: 2, gross_sales_usd: 150, store_discount_usd: 10, membership_discount_usd: 0,
    discount_usd: 10, tax_usd: 5, delivery_usd: 0, refund_usd: 0, revenue_usd: 140, pending_revenue_usd: 0,
    collected_total_usd: 145, cost_usd: 50, profit_usd: 90, cost_missing_snapshot_lines: 1,
  }
  const adminDayRow = buildDaySummaryRow(daySource, true)
  const nonAdminDayRow = buildDaySummaryRow(daySource, false)
  check('admin Summary row includes cost_usd/gross_profit_usd/margin_pct/cost_missing_snapshot_lines', 'cost_usd' in adminDayRow && 'gross_profit_usd' in adminDayRow && 'margin_pct' in adminDayRow && 'cost_missing_snapshot_lines' in adminDayRow)
  check('admin Summary row margin_pct = profit/revenue*100 = 64.29', adminDayRow.margin_pct === 64.29)
  check('non-admin Summary row has NONE of cost_usd/gross_profit_usd/margin_pct/cost_missing_snapshot_lines as KEYS (not blanked -- genuinely absent)',
    !('cost_usd' in nonAdminDayRow) && !('gross_profit_usd' in nonAdminDayRow) && !('margin_pct' in nonAdminDayRow) && !('cost_missing_snapshot_lines' in nonAdminDayRow))
  check('non-admin Summary row still carries every non-cost figure (revenue, tax, discounts, etc.)',
    nonAdminDayRow.net_revenue_usd === 140 && nonAdminDayRow.sales_count === 2 && nonAdminDayRow.collected_total_usd === 145)

  // ---- buildSaleReportRow: same contract, per sale ----
  const saleSource = {
    id: 1, receipt_number: '20260820-050000', created_at: AT(20, 5), business_date: '2026-08-20',
    branch_name: 'shop', cashier_name: 'Za', customer_name: 'Sok', customer_phone: '012345678',
    payment_method: 'cash', sale_status: 'completed', gross_sales_usd: 100, store_discount_usd: 10,
    membership_discount_usd: 0, tax_usd: 5, delivery_usd: 0, refund_usd: 0, net_revenue_usd: 90,
    pending_revenue_usd: 0, cost_usd: 30, cost_missing_snapshot_lines: 1,
  }
  const adminSaleRow = buildSaleReportRow(saleSource, true)
  const nonAdminSaleRow = buildSaleReportRow(saleSource, false)
  check('admin Sales row includes cost_usd/gross_profit_usd/cost_missing_snapshot_lines', 'cost_usd' in adminSaleRow && 'gross_profit_usd' in adminSaleRow && 'cost_missing_snapshot_lines' in adminSaleRow)
  check('admin Sales row gross_profit_usd = net_revenue - cost = 60', adminSaleRow.gross_profit_usd === 60)
  check('non-admin Sales row has NO cost/profit keys at all', !('cost_usd' in nonAdminSaleRow) && !('gross_profit_usd' in nonAdminSaleRow) && !('cost_missing_snapshot_lines' in nonAdminSaleRow))
  check('non-admin Sales row collected_total_usd = revenue+tax+delivery = 95 (still computed)', nonAdminSaleRow.collected_total_usd === 95)

  // ---- buildSaleReportRow when cost_usd/cost_missing_snapshot_lines arrive
  // as NULL (the SQL's own non-admin branch: "NULL AS cost_usd") must not
  // crash even if a caller ever passed isAdmin=true with null source data.
  const nullCostRow = buildSaleReportRow({ ...saleSource, cost_usd: null, cost_missing_snapshot_lines: null }, true)
  check('buildSaleReportRow tolerates NULL cost_usd/cost_missing_snapshot_lines without NaN', nullCostRow.cost_usd === 0 && nullCostRow.cost_missing_snapshot_lines === 0)

  // ---- buildReturnReportRow: counts_toward_revenue flag ----
  const custReturn = buildReturnReportRow({ return_number: 'RET-1', created_at: AT(21, 8), business_date: '2026-08-21', receipt_number: '3', customer_name: 'Sok', supplier_name: null, reason: 'defect', return_type: 'refund', return_scope: 'customer', status: 'completed', total_refund_usd: 10, total_refund_khr: 0 })
  const supplierReturn = buildReturnReportRow({ return_number: 'RET-2', created_at: AT(21, 8), business_date: '2026-08-21', receipt_number: '3', customer_name: null, supplier_name: 'Acme', reason: 'damaged', return_type: 'refund', return_scope: 'supplier', status: 'completed', total_refund_usd: 5, total_refund_khr: 0 })
  const cancelledReturn = buildReturnReportRow({ return_number: 'RET-3', created_at: AT(21, 8), business_date: '2026-08-21', receipt_number: '3', customer_name: 'Sok', supplier_name: null, reason: 'x', return_type: 'refund', return_scope: 'customer', status: 'cancelled', total_refund_usd: 99, total_refund_khr: 0 })
  check('customer-scope, non-cancelled return counts_toward_revenue = 1', custReturn.counts_toward_revenue === 1)
  check('supplier-scope return counts_toward_revenue = 0 (never subtracted from sales revenue)', supplierReturn.counts_toward_revenue === 0)
  check('cancelled return counts_toward_revenue = 0', cancelledReturn.counts_toward_revenue === 0)

  // ---- buildExpenseReportRow ----
  const expenseRow = buildExpenseReportRow({ id: 1, fee_date: '2026-08-20', created_at: AT(20, 9), fee_type: 'rent', label: 'Shop rent', branch_name: 'shop', sale_receipt_number: null, notes: 'Aug rent', amount_usd: 200, amount_khr: 0 })
  check('buildExpenseReportRow shapes date/type/label/amount', expenseRow.date === '2026-08-20' && expenseRow.type === 'rent' && expenseRow.label === 'Shop rent' && expenseRow.amount_usd === 200)

  // ---- mergeReconciliationDays: union of sales-only and expense-only days ----
  const salesByDate = new Map([['2026-08-20', 140], ['2026-08-21', 70]])
  const expensesByDate = new Map([['2026-08-20', 50], ['2026-08-22', 30]]) // 08-22 has an expense but NO sales at all
  const merged = mergeReconciliationDays(salesByDate, expensesByDate)
  check('mergeReconciliationDays produces the UNION of both day sets (3 days), not just sales days', merged.length === 3)
  const day22 = merged.find((d) => d.date === '2026-08-22')
  check('a rent-only day with zero sales revenue still appears (net_revenue=0, expenses=30, reconciliation=-30)',
    day22 && day22.net_revenue_usd === 0 && day22.expenses_usd === 30 && day22.reconciliation_usd === -30)
  const day20Merged = merged.find((d) => d.date === '2026-08-20')
  check('a normal day nets revenue - expenses (140-50=90)', day20Merged.reconciliation_usd === 90)

  // ---- buildMonthRollups + sumReconciliationTotals ----
  const crossMonthDays = mergeReconciliationDays(
    new Map([['2026-08-31', 100], ['2026-09-01', 50]]),
    new Map([['2026-08-31', 20], ['2026-09-01', 10]]),
  )
  const months = buildMonthRollups(crossMonthDays)
  check('buildMonthRollups splits across the calendar month boundary into two months', months.length === 2 && months[0].month === '2026-08' && months[1].month === '2026-09')
  check('August rollup = 100-20 = 80', months[0].reconciliation_usd === 80)
  check('September rollup = 50-10 = 40', months[1].reconciliation_usd === 40)
  const grand = sumReconciliationTotals(crossMonthDays)
  check('sumReconciliationTotals grand total = 150-30 = 120 across both months', grand.reconciliation_usd === 120 && grand.net_revenue_usd === 150 && grand.expenses_usd === 30)

  // =====================================================================
  // LAYER 3: source-lock assertions -- admin gating and the "no shared-list-
  // endpoint reuse for expenses" design rule stay true even if someone edits
  // the route later.
  // =====================================================================
  check('the /business-summary/sales admin costSelect returns NULL for BOTH cost_usd and cost_missing_snapshot_lines when non-admin (never a real number leaking through)',
    /:\s*`NULL AS cost_usd, NULL AS cost_missing_snapshot_lines`/.test(reportsSource))
  check('routes/reports.ts defines its own /business-summary/expenses endpoint (does not import/reuse routes/fees.ts)',
    /app\.get\('\/business-summary\/expenses'/.test(reportsSource) && !/from '\.\.\/routes\/fees'/.test(reportsSource) && !/import .*feesRoute/.test(reportsSource))
  check('the expenses endpoint uses the same snapshot/cursor contract (snapshotMaxId + afterCreatedAt/afterId) as sales/returns',
    (reportsSource.match(/snapshotMaxId/g) || []).length >= 6)

  console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
