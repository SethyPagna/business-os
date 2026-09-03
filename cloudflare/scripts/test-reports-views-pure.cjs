// Tests for the Reports redesign backend (Sep 3 2026, lane fx/reports-redesign):
// lib/salesAnalytics.ts's getSalesGroupedTotals + getProductSalesRanking and
// routes/sales.ts's gateGroupedRow.
//
// Layer 1 is carried forward UNCHANGED from the orphaned lane sec-10 (branch
// rc/sec-10-reports, tip 539567e2): it is the reconciliation proof and depends
// only on files that exist on this base. sec-10 Layer 2 tested
// routes/reports.ts, which does NOT exist on this base, so it is replaced by
// the equivalent contract on the route this lane actually ships.
//
// Same two-layer approach as test-business-workbook-pure.cjs, exercising the
// REAL shipped code (not a reimplementation):
//
//   1. The kernel is transpiled with a getDb() shim and run against a real
//      better-sqlite3 fixture. The contract under test is "one revenue
//      definition, sliced": for EVERY group key the grouped rows must sum
//      back to getSalesTotals for the same filters (tx_count, revenue,
//      pending credit, refunds, COGS, profit), so a By-customer / By-cashier
//      / Payment / Hours / Weekdays / Branches view can never disagree with
//      the Overview. The product ranking must count recognized sales only
//      and flag NULL cost snapshots without altering cost_usd's basis.
//
//   2. routes/sales.ts's gateGroupedRow is extracted by regex (sales.ts
//      constructs a live Hono app at module load) and unit-tested directly:
//      the admin-gating contract is that a non-admin caller's row object
//      must never even CONTAIN cost_usd / profit_usd / margin_pct /
//      cost_missing_snapshot_lines keys -- absence, not a blanked zero.
//
// Run (from cloudflare/): node scripts/test-reports-views-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)

// =====================================================================
// LAYER 1: getSalesGroupedTotals / getProductSalesRanking over a fixture DB
// =====================================================================
const kernelSrcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const kernelSrc = fs.readFileSync(kernelSrcPath, 'utf8')
const strippedKernel = ('// @ts-nocheck\n' + kernelSrc)
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-views-pure-'))
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
    branch_name TEXT,
    customer_id INTEGER,
    customer_name TEXT,
    cashier_id INTEGER,
    cashier_name TEXT,
    payment_method TEXT,
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

// created_at is stored as UTC; the kernel shifts +7h to the business day.
// 2026-08-20 = Thursday, 2026-08-23 = Sunday, 2026-08-24 = Monday.
const UTC = (day, hour) => `2026-08-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:30:00`

const insSale = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, subtotal_usd, discount_usd, membership_discount_usd, tax_usd, total_usd,
   delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_actual_cost_usd,
   branch_id, branch_name, customer_id, customer_name, cashier_id, cashier_name, payment_method, receipt_number)
  VALUES (@id,@created_at,@sale_status,@subtotal_usd,@discount_usd,@membership_discount_usd,@tax_usd,@total_usd,
   @delivery_fee_usd,@delivery_fee_paid_by,@is_delivery,@delivery_actual_cost_usd,
   @branch_id,@branch_name,@customer_id,@customer_name,@cashier_id,@cashier_name,@payment_method,@receipt_number)`)
const sale = (o) => insSale.run({
  sale_status: 'completed', discount_usd: 0, membership_discount_usd: 0, tax_usd: 0,
  delivery_fee_usd: 0, delivery_fee_paid_by: 'customer', is_delivery: 0, delivery_actual_cost_usd: null,
  branch_id: 1, branch_name: 'Shop', customer_id: null, customer_name: '', cashier_id: 10, cashier_name: 'Za',
  payment_method: 'Cash', receipt_number: String(o.id), ...o,
})

// Thu 20 (UTC 05:30 -> 12:30 local): Alice pays cash, store discount 10, tax 5.
sale({ id: 1, created_at: UTC(20, 5), subtotal_usd: 100, discount_usd: 10, tax_usd: 5, total_usd: 95, customer_id: 1, customer_name: 'Alice' })
// Thu 20 (UTC 06:30 -> 13:30 local): walk-in (no customer id), ABA Bank, same cashier.
sale({ id: 2, created_at: UTC(20, 6), subtotal_usd: 50, total_usd: 50, customer_name: 'Walk in', payment_method: 'ABA Bank' })
// Sun 23 (UTC 22:30 -> Mon 24 05:30 local -- crosses the UTC+7 midnight): Bob, cashier Mia, store-paid delivery 3.
sale({ id: 3, created_at: UTC(23, 22), subtotal_usd: 80, total_usd: 80, customer_id: 2, customer_name: 'Bob', cashier_id: 11, cashier_name: 'Mia', delivery_fee_usd: 3, delivery_fee_paid_by: 'store', is_delivery: 1 })
// Mon 24: Bob again, awaiting payment -> pending credit, NOT revenue, NOT in COGS.
sale({ id: 4, created_at: UTC(24, 3), sale_status: 'awaiting_payment', subtotal_usd: 40, total_usd: 40, customer_id: 2, customer_name: 'Bob', cashier_id: 11, cashier_name: 'Mia' })
// Mon 24: cancelled -> excluded from everything.
sale({ id: 5, created_at: UTC(24, 4), sale_status: 'cancelled', subtotal_usd: 999, total_usd: 999, customer_id: 1, customer_name: 'Alice' })
// Mon 24: warehouse branch, payment method blank -> 'unknown' bucket.
sale({ id: 6, created_at: UTC(24, 6), subtotal_usd: 20, total_usd: 20, branch_id: 2, branch_name: 'Warehouse', payment_method: '', customer_name: 'walk in ' })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 90, 1, 101, 'A')     // S1: cost 30
insItem.run(2, 1, 1, null, 10, 1, 102, 'B')   // S1: NULL cost snapshot (counts 0, flagged)
insItem.run(3, 2, 2, 10, 50, 1, 101, 'A')     // S2: 2 x A, cost 20
insItem.run(4, 3, 1, 15, 80, 1, 104, 'D')     // S3: cost 15
insItem.run(5, 4, 1, 12, 40, 1, 104, 'D')     // S4 (awaiting): must not count anywhere
insItem.run(6, 5, 1, 500, 999, 1, 101, 'A')   // S5 (cancelled): must not count anywhere
insItem.run(7, 6, 1, 8, 20, 2, 105, 'E')      // S6: cost 8

const insRet = db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, status, return_scope, created_at, branch_id) VALUES (?,?,?,?,?,?,?)')
insRet.run(1, 3, 10, 'completed', 'customer', UTC(24, 8), 1) // customer refund on S3

;(async () => {
  const env = { __db: db }
  const filters = { startDate: '2026-08-20', endDate: '2026-08-24', branchId: null }
  const totals = await kernel.getSalesTotals(env, filters)

  // Sanity on the canonical figures the views must reconcile to:
  // recognized: S1 (90 net), S2 (50), S3 (80), S6 (20) = 240; refunds 10 -> revenue 230.
  // pending: S4 = 40. COGS: 30 + 0 + 20 + 15 + 8 = 73. profit: 230 - 73 - 3 (store delivery) = 154.
  check('fixture: canonical revenue = 230 (240 net - 10 refund)', near(totals.revenue_usd, 230))
  check('fixture: pending credit = 40 (the awaiting sale, not revenue)', near(totals.pending_revenue_usd, 40))
  check('fixture: COGS = 73 (NULL snapshot counts 0; awaiting + cancelled items excluded)', near(totals.cost_usd, 73))
  check('fixture: profit = 154 (revenue - COGS - store-paid delivery 3)', near(totals.profit_usd, 154))
  check('fixture: tx_count = 5 (cancelled excluded, awaiting counted as a transaction)', totals.tx_count === 5)

  for (const groupBy of kernel.SALES_GROUP_KEYS) {
    const rows = await kernel.getSalesGroupedTotals(env, filters, groupBy)
    check(`${groupBy}: rows come back (${rows.length})`, rows.length > 0)
    for (const key of ['tx_count', 'revenue_usd', 'pending_revenue_usd', 'refund_usd', 'cost_usd', 'profit_usd', 'gross_sales_usd', 'collected_total_usd']) {
      check(`${groupBy}: sum(${key}) over groups = getSalesTotals (${sum(rows, key)} vs ${totals[key]})`, near(sum(rows, key), totals[key]))
    }
    check(`${groupBy}: every row carries cost_missing_snapshot_lines`, rows.every((r) => typeof r.cost_missing_snapshot_lines === 'number'))
    check(`${groupBy}: missing-snapshot lines total 1 across groups`, sum(rows, 'cost_missing_snapshot_lines') === 1)
  }

  // ---- customer identity: id wins, legacy name-only sales fold by lowercase/trimmed name ----
  const byCustomer = await kernel.getSalesGroupedTotals(env, filters, 'customer')
  const alice = byCustomer.find((r) => r.key === 'id:1')
  const bob = byCustomer.find((r) => r.key === 'id:2')
  const walkIn = byCustomer.find((r) => r.key === 'name:walk in')
  check('customer: Alice keyed by id ("id:1"), labelled by name, entity_id 1', !!alice && alice.label === 'Alice' && alice.entity_id === 1)
  check('customer: Alice revenue 90 (the cancelled 999 sale never counts)', !!alice && near(alice.revenue_usd, 90))
  check('customer: Bob revenue 70 (80 - 10 refund), pending 40 kept apart', !!bob && near(bob.revenue_usd, 70) && near(bob.pending_revenue_usd, 40))
  check('customer: "Walk in" and "walk in " fold into one name bucket (2 tx, 70 revenue)', !!walkIn && walkIn.tx_count === 2 && near(walkIn.revenue_usd, 70) && walkIn.entity_id === null)
  check('customer: sorted by revenue desc', byCustomer[0].key === 'id:1' && byCustomer[1].key === 'id:2')

  // ---- cashier ----
  const byCashier = await kernel.getSalesGroupedTotals(env, filters, 'cashier')
  const za = byCashier.find((r) => r.key === 'id:10')
  const mia = byCashier.find((r) => r.key === 'id:11')
  check('cashier: Za = S1 + S2 + S6 (3 tx, revenue 160)', !!za && za.tx_count === 3 && near(za.revenue_usd, 160) && za.label === 'Za')
  check('cashier: Mia = S3 + S4 (2 tx, revenue 70, pending 40, profit 80-15-3-10=52)', !!mia && mia.tx_count === 2 && near(mia.revenue_usd, 70) && near(mia.pending_revenue_usd, 40) && near(mia.profit_usd, 52))

  // ---- payment method: case/space-insensitive key, blank -> 'unknown' ----
  const byPayment = await kernel.getSalesGroupedTotals(env, filters, 'payment_method')
  const cash = byPayment.find((r) => r.key === 'cash')
  const unknown = byPayment.find((r) => r.key === 'unknown')
  check('payment: cash bucket keyed lowercase, label as stored ("Cash"), 3 tx (S1, S3, S4)', !!cash && cash.label === 'Cash' && cash.tx_count === 3)
  check('payment: a blank method lands in "unknown", never a phantom empty bucket', !!unknown && unknown.tx_count === 1 && !byPayment.some((r) => r.key === ''))

  // ---- hour / weekday: UTC+7 business clock, clock order ----
  const byHour = await kernel.getSalesGroupedTotals(env, filters, 'hour')
  check('hour: keys are the LOCAL hour (UTC 05:30 -> "12"; UTC 22:30 -> "05" next day)', byHour.some((r) => r.key === '12') && byHour.some((r) => r.key === '05') && !byHour.some((r) => r.key === '22'))
  check('hour: rows in clock order', byHour.every((r, i) => i === 0 || byHour[i - 1].key <= r.key))
  const byWeekday = await kernel.getSalesGroupedTotals(env, filters, 'weekday')
  const thu = byWeekday.find((r) => r.key === '4')
  const mon = byWeekday.find((r) => r.key === '1')
  check('weekday: Thursday (4) = S1 + S2; Monday (1) = S3 (crossed midnight) + S4 + S6; no Sunday bucket', !!thu && thu.tx_count === 2 && !!mon && mon.tx_count === 3 && !byWeekday.some((r) => r.key === '0'))

  // ---- branch ----
  const byBranch = await kernel.getSalesGroupedTotals(env, filters, 'branch')
  const shop = byBranch.find((r) => r.key === '1')
  const wh = byBranch.find((r) => r.key === '2')
  check('branch: Shop 4 tx / Warehouse 1 tx, labels from the branch_name snapshot', !!shop && shop.tx_count === 4 && shop.label === 'Shop' && !!wh && wh.tx_count === 1 && wh.label === 'Warehouse')

  // ---- the same filters narrow every view the same way ----
  const abaOnly = await kernel.getSalesGroupedTotals(env, { ...filters, paymentMethod: 'ABA Bank' }, 'customer')
  const abaTotals = await kernel.getSalesTotals(env, { ...filters, paymentMethod: 'ABA Bank' })
  check('paymentMethod filter: grouped rows still reconcile to getSalesTotals (revenue 50)', near(sum(abaOnly, 'revenue_usd'), abaTotals.revenue_usd) && near(abaTotals.revenue_usd, 50))
  const limited = await kernel.getSalesGroupedTotals(env, filters, 'customer', 1)
  check('limit caps the row count (top by revenue)', limited.length === 1 && limited[0].key === 'id:1')

  // ---- product ranking ----
  const products = await kernel.getProductSalesRanking(env, filters)
  const a = products.find((r) => r.product_id === 101)
  const b = products.find((r) => r.product_id === 102)
  const d = products.find((r) => r.product_id === 104)
  check('products: A = S1 + S2 lines only (2 sales, qty 3, line sales 140, cost 50) -- the cancelled sale\'s A line is excluded', !!a && a.sale_count === 2 && a.qty === 3 && near(a.line_sales_usd, 140) && near(a.cost_usd, 50) && near(a.profit_usd, 90))
  check('products: B flags its NULL cost snapshot (cost 0, 1 missing line)', !!b && near(b.cost_usd, 0) && b.cost_missing_snapshot_lines === 1)
  check('products: D counts the completed S3 line only, not the awaiting S4 line (qty 1, 80)', !!d && d.qty === 1 && near(d.line_sales_usd, 80))
  check('products: ranked by line sales desc', products.every((r, i) => i === 0 || products[i - 1].line_sales_usd >= r.line_sales_usd))
  const productsAba = await kernel.getProductSalesRanking(env, { ...filters, paymentMethod: 'ABA Bank' })
  check('products: the payment filter narrows the ranking (only S2\'s A line: qty 2, 50)', productsAba.length === 1 && productsAba[0].product_id === 101 && productsAba[0].qty === 2)

  console.log(`\nLayer 1 (kernel): ${passed} check(s) passed so far.\n`)

  // =====================================================================
  // LAYER 2: routes/sales.ts's gateGroupedRow
  // The admin-gating contract is ABSENCE, not blanking: a non-admin's row
  // object must not even contain the cost/profit keys, so a client cannot
  // render a 0 and imply the margin was zero.
  // =====================================================================
  const salesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8').replace(/\r\n/g, '\n')
  const gateSrc = salesSource.match(/export function gateGroupedRow[<(][\s\S]*?\n\}\n/)
  if (!gateSrc) throw new Error('gateGroupedRow not found in routes/sales.ts -- source may have changed')
  const { outputText } = ts.transpileModule(
    gateSrc[0].replace('export function', 'function') + '\nexports.gateGroupedRow = gateGroupedRow\n',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: 'gate.ts' },
  )
  const mod = { exports: {} }
  new Function('exports', outputText)(mod.exports)
  const { gateGroupedRow } = mod.exports

  const SECRET = ['cost_usd', 'profit_usd', 'margin_pct', 'cost_missing_snapshot_lines']
  const row = { key: 'id:1', label: 'Alice', tx_count: 5, revenue_usd: 230, pending_revenue_usd: 40, cost_usd: 73, profit_usd: 154, margin_pct: 66.96, cost_missing_snapshot_lines: 1 }
  const staff = gateGroupedRow(row, false)
  check('gateGroupedRow(non-admin): no cost/profit/margin/missing key exists at all', SECRET.every((k) => !(k in staff)))
  check('gateGroupedRow(non-admin): the public figures survive untouched', staff.revenue_usd === 230 && staff.tx_count === 5 && staff.pending_revenue_usd === 40 && staff.label === 'Alice')
  const admin = gateGroupedRow(row, true)
  check('gateGroupedRow(admin): every key is carried through unchanged', SECRET.every((k) => k in admin) && admin.cost_usd === 73 && admin.profit_usd === 154)
  check('gateGroupedRow(non-admin): does not mutate the row it was given', 'cost_usd' in row && row.cost_usd === 73)

  // The gate must survive a real kernel row, not just a hand-written literal.
  const liveRow = (await kernel.getSalesGroupedTotals(env, filters, 'customer'))[0]
  check('gateGroupedRow: a real kernel row carries cost_usd before gating', 'cost_usd' in liveRow)
  check('gateGroupedRow(non-admin): the same real row loses every admin key', SECRET.every((k) => !(k in gateGroupedRow(liveRow, false))))

  console.log(`\nAll ${passed} check(s) passed.`)
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
