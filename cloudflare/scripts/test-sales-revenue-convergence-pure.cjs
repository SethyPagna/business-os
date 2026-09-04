// Convergence lock for the CANONICAL revenue definition (user directive,
// Sep 1 2026): "revenue = NET SALES". Two surfaces historically disagreed --
// GET /api/sales/stats used total_usd (tax INCLUDED, awaiting EXCLUDED) while
// the Reports kernel (lib/salesAnalytics.ts deriveTotals) used subtotal-minus-
// discount (tax excluded, awaiting INCLUDED, refunds NOT subtracted). This
// test proves they now produce the BYTE-IDENTICAL number on one mixed dataset,
// and that the number equals the hand-computed net-sales definition.
//
// It runs the ACTUAL shipped code, not a reimplementation:
//   - the kernel: salesAnalytics.ts is transpiled and getSalesTotals() is
//     called against a real better-sqlite3 DB (a getDb shim hands it the DB);
//   - the header: the revenue/pending SELECT is EXTRACTED verbatim from
//     routes/sales.ts source and run against the same DB.
// If either surface's revenue math drifts, the equality assertions here break.
//
// Run (from cloudflare/): node scripts/test-sales-revenue-convergence-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

// ---- 1. Transpile the real kernel, injecting a getDb() that returns our DB ---
const srcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const src = fs.readFileSync(srcPath, 'utf8')
const stripped = ('// @ts-nocheck\n' + src)
  // Replace the D1 db import with a shim: getDb(env) returns the sqlite handle
  // the test passes in. better-sqlite3's prepare().get()/.all() are the same
  // call shape the kernel uses (await on a sync value is a no-op).
  // Match the line end as \r?\n so the strip works on a CRLF checkout too (git
  // autocrlf hands Windows worktrees CRLF, including the deploy-cert worktree);
  // otherwise the import survives and the compile fails on "Cannot find './db'".
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-revenue-conv-'))
const tsPath = path.join(tmpDir, 'salesAnalytics.ts')
fs.writeFileSync(tsPath, stripped)
const winPath = path.join(tmpDir, 'businessDateWindow.ts')
fs.writeFileSync(winPath, fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath} ${winPath}`, {
  cwd: tmpDir,
  stdio: 'inherit',
})
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))

// ---- 2. Real SQLite with the columns both surfaces read --------------------
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
    delivery_contact_id INTEGER,
    delivery_contact_name TEXT,
    branch_id INTEGER,
    customer_id INTEGER,
    payment_method TEXT,
    customer_name TEXT,
    receipt_number TEXT,
    -- What the till actually took, and 0106's link back to the return a
    -- replacement sale settles: collectedExpr reads both to keep an even
    -- exchange out of "collected" while still counting the sale.
    amount_paid_usd REAL,
    source_return_id INTEGER
  );
  CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER,
    quantity REAL,
    cost_price_usd REAL,
    total_usd REAL,
    branch_id INTEGER,
    product_id INTEGER,
    product_name TEXT,
    -- The two per-line discount columns the kernel sums for
    -- item_discount_usd, alongside COGS and over the same rows.
    -- product_discount_* is the catalog promotion (0001); manual_discount_*
    -- is what the cashier knocked off at checkout (0007).
    product_discount_usd REAL DEFAULT 0,
    manual_discount_usd REAL DEFAULT 0
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
  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY,
    return_id INTEGER,
    quantity REAL,
    cost_price_usd REAL,
    return_to_stock INTEGER,
    stock_action TEXT
  );
  CREATE TABLE customers (id INTEGER PRIMARY KEY, membership_number TEXT);
  -- getDeliveryContactTotals also folds courier expense rows (fees linked to a
  -- delivery contact via 0105) into the day report; the columns it reads.
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE fees (
    id INTEGER PRIMARY KEY,
    fee_type TEXT,
    label TEXT,
    amount_usd REAL,
    amount_khr REAL,
    fee_date TEXT,
    sale_id INTEGER,
    branch_id INTEGER,
    delivery_contact_id INTEGER,
    notes TEXT,
    created_at TEXT
  );
`)

// All created_at are UTC that map into local (UTC+7) August 2026 (midday, so
// bucketing is never the variable under test here -- the daterange test owns that).
const AT = (day) => `2026-08-${String(day).padStart(2, '0')} 05:00:00` // local 12:00

const insSale = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, subtotal_usd, discount_usd, membership_discount_usd, tax_usd, total_usd,
   delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_actual_cost_usd, branch_id, customer_id, payment_method, receipt_number)
  VALUES (@id,@created_at,@sale_status,@subtotal_usd,@discount_usd,@membership_discount_usd,@tax_usd,@total_usd,
   @delivery_fee_usd,@delivery_fee_paid_by,@is_delivery,@delivery_actual_cost_usd,@branch_id,@customer_id,@payment_method,@receipt_number)`)

// total_usd = subtotal - discount - membership + tax (ground truth from the
// create-sale handler); delivery is separate and paid_by decides who bears it.
const sale = (o) => insSale.run({
  delivery_fee_usd: 0, delivery_fee_paid_by: 'customer', is_delivery: 0,
  delivery_actual_cost_usd: null, branch_id: 1, customer_id: null,
  payment_method: 'cash', receipt_number: String(o.id), ...o,
})

// S1 completed, has delivery (customer-paid) + a customer refund
sale({ id: 1, created_at: AT(10), sale_status: 'completed', subtotal_usd: 100, discount_usd: 10, membership_discount_usd: 5, tax_usd: 8, total_usd: 93, delivery_fee_usd: 6, delivery_fee_paid_by: 'customer', is_delivery: 1, delivery_actual_cost_usd: 4 })
// S2 blank status ('' -> completed), plain
sale({ id: 2, created_at: AT(11), sale_status: '', subtotal_usd: 50, discount_usd: 0, membership_discount_usd: 0, tax_usd: 4, total_usd: 54 })
// S3 NULL status (-> completed), STORE-absorbed delivery (a cost, not collected)
sale({ id: 3, created_at: AT(12), sale_status: null, subtotal_usd: 40, discount_usd: 5, membership_discount_usd: 0, tax_usd: 0, total_usd: 35, delivery_fee_usd: 3, delivery_fee_paid_by: 'store', is_delivery: 1 })
// S4 awaiting_payment -> PENDING (net), never revenue
sale({ id: 4, created_at: AT(13), sale_status: 'awaiting_payment', subtotal_usd: 200, discount_usd: 20, membership_discount_usd: 0, tax_usd: 10, total_usd: 190 })
// S5 cancelled -> excluded entirely
sale({ id: 5, created_at: AT(14), sale_status: 'cancelled', subtotal_usd: 999, discount_usd: 0, membership_discount_usd: 0, tax_usd: 50, total_usd: 1049 })
// S6 completed, two customer refunds summing to 20
sale({ id: 6, created_at: AT(15), sale_status: 'completed', subtotal_usd: 80, discount_usd: 0, membership_discount_usd: 20, tax_usd: 0, total_usd: 60 })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 90, 1, 101, 'A')   // S1 cost 30
insItem.run(2, 2, 1, 10, 50, 1, 102, 'B')   // S2 cost 10
insItem.run(3, 3, 1, 8, 35, 1, 103, 'C')    // S3 cost 8
insItem.run(4, 4, 1, 500, 180, 1, 104, 'D') // S4 awaiting cost 500 -> excluded from recognized COGS
insItem.run(5, 5, 1, 999, 999, 1, 105, 'E') // S5 cancelled -> excluded
insItem.run(6, 6, 1, 12, 60, 1, 106, 'F')   // S6 cost 12

const insRet = db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, status, return_scope, created_at, branch_id) VALUES (?,?,?,?,?,?,?)')
insRet.run(1, 1, 20, 'completed', 'customer', AT(16), 1)  // S1 customer refund 20
insRet.run(2, 6, 15, 'completed', 'customer', AT(16), 1)  // S6 refund 15
insRet.run(3, 6, 5, 'completed', 'customer', AT(16), 1)   // S6 refund 5  (two returns, one sale)
insRet.run(4, 2, 100, 'completed', 'supplier', AT(16), 1) // supplier scope -> MUST be ignored for revenue
insRet.run(5, 1, 999, 'cancelled', 'customer', AT(16), 1) // cancelled return -> ignored
insRet.run(6, 4, 30, 'completed', 'customer', AT(16), 1)  // refund on awaiting sale -> doesn't touch revenue

// What came back on the shelf. Return 1 is S1's $20 refund; 1 unit at cost 12
// went back sellable, so 12 of S1's 30 of COGS is no longer cost of goods SOLD.
// The other three lines are the shapes that must NOT reverse: damaged stock is
// held with no sale value, 'none' means the customer kept the goods, and the
// supplier-scope return never touched customer revenue in the first place.
const insRetItem = db.prepare('INSERT INTO return_items (id, return_id, quantity, cost_price_usd, return_to_stock, stock_action) VALUES (?,?,?,?,?,?)')
insRetItem.run(1, 1, 1, 12, 1, 'restock')
insRetItem.run(2, 2, 1, 9, 1, 'damaged')   // return 2 is on S6 -- damaged, no reversal
insRetItem.run(3, 3, 1, 7, 1, 'none')      // return 3 is on S6 -- kept, no reversal
insRetItem.run(4, 4, 1, 40, 1, 'restock')  // return 4 is SUPPLIER scope -- out of scope

// ---- 3. Hand-computed expectations (the canonical net-sales definition) ------
const EXPECT = {
  recognizedNet: 85 + 50 + 35 + 60, // S1 85, S2 50, S3 35, S6 60  = 230
  // Refunds come off revenue on the SAME net basis revenue is measured on.
  // S1 refunded 20 of a sale charged 100 that netted 85 -> 20 * 0.85 = 17.
  // S6 refunded 20 of a sale charged 80 that netted 60  -> 20 * 0.75 = 15.
  // Taking the charged 40 instead would subtract those sales' discounts a
  // SECOND time -- they were already gone when the sale was recognized.
  refunds: 17 + 15,                  //                             = 32
  refundsChargedBasis: 20 + 20,      // the old, doubled figure     = 40
  revenue: 230 - 32,                 //                             = 198
  pending: 180,                      // S4 net (200-20)             = 180
  grossCost: 30 + 10 + 8 + 12,       // recognized items only       = 60
  returnedCost: 12,                  // S1's restocked unit -- back on the shelf
  storeDelivery: 3,                  // S3 store-absorbed: reported, NOT a cost
  recognizedTax: 8 + 4,              // S1 + S2                     = 12
  recognizedDelivery: 6,             // S1 customer-paid (S3 is store, so 0)
  deliveryCost: 4,                   // S1's courier cost recorded on the sale
}
// Goods on the shelf are not goods sold.
EXPECT.cost = EXPECT.grossCost - EXPECT.returnedCost                     // 60-12 = 48
// Delivery contributes once: what the customer paid minus what the courier
// took. The fee the shop WAIVED is not subtracted -- it was never collected,
// so it is already absent from revenue.
EXPECT.deliveryNet = EXPECT.recognizedDelivery - EXPECT.deliveryCost     // 6-4  = 2
EXPECT.profit = EXPECT.revenue - EXPECT.cost + EXPECT.deliveryNet        // 198-48+2 = 152
EXPECT.collected = EXPECT.revenue + EXPECT.recognizedTax + EXPECT.recognizedDelivery // 198+12+6 = 216

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// CommonJS has no top-level await; the kernel functions are async, so the
// DB-backed checks run inside this IIFE.
;(async () => {
// ---- 4. The REAL kernel over the REAL DB -----------------------------------
const filters = { startDate: '2026-08-01', endDate: '2026-08-31', branchId: null }
const kernel = await lib.getSalesTotals({ __db: db }, filters)

check(`kernel revenue_usd == net sales minus refunds (${EXPECT.revenue})`, kernel.revenue_usd === EXPECT.revenue)
check('kernel refund_usd counts recognized CUSTOMER refunds only (supplier and cancelled returns ignored)',
  kernel.refund_usd === EXPECT.refunds)
check(`kernel pending_revenue_usd == awaiting-payment net, held OUT of revenue (${EXPECT.pending})`, kernel.pending_revenue_usd === EXPECT.pending)
check(`kernel cost_usd counts recognized items only, net of restocked returns (${EXPECT.cost})`, kernel.cost_usd === EXPECT.cost)
check(`kernel returned_cost_usd reports the reversal rather than hiding it (${EXPECT.returnedCost})`, kernel.returned_cost_usd === EXPECT.returnedCost)
check('only a RESTOCK reverses COGS -- damaged and kept goods were really consumed (would be 12+9+7=28)',
  kernel.returned_cost_usd === 12)
check('a supplier-scope return never reverses customer COGS (would be 52 if it did)', kernel.returned_cost_usd !== 52)
check(`kernel delivery_net_usd = customer-paid fees - courier cost (${EXPECT.deliveryNet})`, kernel.delivery_net_usd === EXPECT.deliveryNet)
check(`kernel profit_usd = revenue - cost + delivery net (${EXPECT.profit})`, kernel.profit_usd === EXPECT.profit)
check('the WAIVED delivery fee is reported but never charged to profit (the old double minus was -3)',
  kernel.store_delivery_usd === EXPECT.storeDelivery && kernel.profit_usd !== EXPECT.profit - EXPECT.storeDelivery)
check(`kernel refund_usd is apportioned onto the net basis (${EXPECT.refunds}), not the charged one (${EXPECT.refundsChargedBasis})`,
  kernel.refund_usd === EXPECT.refunds && kernel.refund_usd !== EXPECT.refundsChargedBasis)
check(`kernel collected_total_usd = revenue + tax + customer delivery (${EXPECT.collected})`, kernel.collected_total_usd === EXPECT.collected)
check('kernel gross_sales_usd still reports the raw pre-discount subtotal line (unchanged display field)', kernel.gross_sales_usd === 100 + 50 + 40 + 200 + 80) // all non-cancelled subtotals = 470
check('awaiting-payment revenue is NOT folded into revenue (would be 190+180=370 if it were)', kernel.revenue_usd !== EXPECT.revenue + EXPECT.pending)

// ---- 5. Per-period trend must SUM to the headline (shared deriveTotals) ------
const daySeries = await lib.getSalesPeriodSeries({ __db: db }, filters, 'day')
const seriesRevenue = Math.round(daySeries.reduce((s, r) => s + r.revenue_usd, 0) * 100) / 100
const seriesProfit = Math.round(daySeries.reduce((s, r) => s + r.profit_usd, 0) * 100) / 100
check(`per-day trend revenue sums to the headline (${EXPECT.revenue})`, seriesRevenue === EXPECT.revenue)
check(`per-day trend profit sums to the headline (${EXPECT.profit})`, seriesProfit === EXPECT.profit)

// ---- 6. Per-sale day drill must SUM to that day's total --------------------
// S6 is local Aug 15; its one recognized sale nets 60, less the 20 refund put on that same basis (20 * 60/80 = 15), so 45.
const day15 = await lib.getSalesDayReport({ __db: db }, '2026-08-15', {})
const day15Rows = Math.round(day15.sales.reduce((s, r) => s + r.revenue_usd, 0) * 100) / 100
check('per-sale day-drill rows sum to the day total (S6: 60 net - 15 apportioned refund = 45)', day15Rows === 45 && day15.totals.revenue_usd === 45)

// ---- 7. The REAL /stats SQL, EVALUATED from routes/sales.ts ----------------
// This used to pull the SELECT out as literal text. It cannot any more, and
// that is the improvement: the header no longer restates the revenue
// definition, it interpolates the kernel's exported fragments. So the template
// is extracted with its \${...} holes intact and evaluated against the
// transpiled kernel -- the same objects the Worker passes in. A header that
// stopped using the kernel's definition would no longer compile here.
const salesTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
const m = salesTs.match(/const totals = await db\.prepare\(`([\s\S]*?)`\)\.get</)
assert.ok(m, 'could not locate the /stats revenue SELECT in routes/sales.ts -- did the query shape change?')
const headerTemplate = m[1]

check('the header takes its revenue definition FROM the kernel rather than restating it',
  /\${netSaleExpr\('s\.'\)}/.test(headerTemplate)
  && /\${recognizedExpr\('s\.'\)}/.test(headerTemplate)
  && /\${netRefundExpr\('s\.', 'rf\.'\)}/.test(headerTemplate)
  && /\${awaitingExpr\('s\.'\)}/.test(headerTemplate)
  && /\${CUSTOMER_REFUND_JOIN}s\.id/.test(headerTemplate))
check('the header no longer spells the net-sales subtraction out a second time',
  !/COALESCE\(s\.subtotal_usd, 0\) - COALESCE\(s\.discount_usd, 0\)/.test(headerTemplate))
check('the header no longer carries its own copy of the customer-refund subquery',
  !/SELECT sale_id, SUM\(total_refund_usd\) AS refund_usd/.test(headerTemplate))
check('the header no longer sums total_usd (which folds tax in)',
  !/THEN COALESCE\(s\.total_usd, 0\)/.test(headerTemplate))

// Same local-day (UTC+7) scope the kernel applies, on the `s` alias.
const dateClauseS = `date(s.created_at, '+7 hours') >= @startDate AND s.created_at >= date(@startDate, '-1 day') AND date(s.created_at, '+7 hours') <= @endDate AND s.created_at < date(@endDate, '+1 day')`
// eslint-disable-next-line no-new-func -- the input is this repo's own source.
const headerSql = new Function(
  'recognizedExpr', 'netSaleExpr', 'netRefundExpr', 'awaitingExpr', 'CUSTOMER_REFUND_JOIN', 'where',
  'return \`' + headerTemplate + '\`',
)(lib.recognizedExpr, lib.netSaleExpr, lib.netRefundExpr, lib.awaitingExpr, lib.CUSTOMER_REFUND_JOIN, [dateClauseS])
const statsRow = db.prepare(headerSql).get({ startDate: '2026-08-01', endDate: '2026-08-31' })
const statsRevenue = Math.round((statsRow.revenue_usd || 0) * 100) / 100
const statsPending = Math.round((statsRow.pending_revenue_usd || 0) * 100) / 100

// ---- 8. THE CONVERGENCE: header revenue == kernel revenue, to the cent ------
check(`CONVERGENCE: /stats revenue (${statsRevenue}) == kernel revenue (${kernel.revenue_usd})`, statsRevenue === kernel.revenue_usd)
check(`CONVERGENCE: /stats pending (${statsPending}) == kernel pending (${kernel.pending_revenue_usd})`, statsPending === kernel.pending_revenue_usd)
check(`both surfaces equal the hand-computed net-sales revenue (${EXPECT.revenue})`, statsRevenue === EXPECT.revenue && kernel.revenue_usd === EXPECT.revenue)
check(`CONVERGENCE: the header's refund is apportioned too -- the charged basis would have given ${230 - EXPECT.refundsChargedBasis}`,
  statsRevenue !== 230 - EXPECT.refundsChargedBasis)

// ---- 9. NO SIXTH COPY: sweep every route and lib for the raw refund --------
// The double-minus is not a bug in one query, it is a phrasing that reads as
// obviously correct -- "revenue minus what we refunded" -- and so gets retyped.
// Revenue is net of both discounts; a refund is the CHARGED line price, which is
// not. Subtracting it raw takes the discounts off a second time. netRefundExpr
// scales by netSale/subtotal and is the only sanctioned way to say it.
//
// compat.ts carried five such copies behind the Dashboard while sales.ts and the
// kernel were converging perfectly, so this sweeps the tree rather than a list.
const srcRoot = path.join(__dirname, '..', 'src')
const sourceFiles = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.ts')) sourceFiles.push(full)
  }
})(srcRoot)
check(`the sweep actually found the worker source (${sourceFiles.length} .ts files)`, sourceFiles.length > 20)

// netSaleExpr(...) followed by a bare "- COALESCE(<alias>refund_usd, 0)".
const rawRefund = /netSaleExpr\([^)]*\)\}\s*-\s*COALESCE\([a-z]*\.?refund_usd/
const offenders = sourceFiles.filter((f) => rawRefund.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(srcRoot, f))
check(`no source file subtracts an un-apportioned refund from net sales${offenders.length ? ' -- found in ' + offenders.join(', ') : ''}`,
  offenders.length === 0)

// And the guard has to be able to see one. Prove it against a synthetic line
// rather than trusting that a regex which matched nothing was ever right.
check('the sweep regex recognises the double-minus it exists to forbid',
  rawRefund.test("COALESCE(SUM(${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0)), 0) AS revenue_usd")
  && !rawRefund.test("COALESCE(SUM(${netSaleExpr('s.')} - ${netRefundExpr('s.', 'rf.')}), 0) AS revenue_usd"))

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
