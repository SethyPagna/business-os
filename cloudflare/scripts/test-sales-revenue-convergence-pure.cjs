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
    receipt_number TEXT
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
sale({ id: 6, created_at: AT(15), sale_status: 'completed', subtotal_usd: 70, discount_usd: 0, membership_discount_usd: 10, tax_usd: 0, total_usd: 60 })

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

// ---- 3. Hand-computed expectations (the canonical net-sales definition) ------
const EXPECT = {
  recognizedNet: 85 + 50 + 35 + 60, // S1 85, S2 50, S3 35, S6 60  = 230
  refunds: 20 + 20,                  // S1 20, S6 (15+5)=20         = 40  (supplier & cancelled ignored)
  revenue: 230 - 40,                 //                             = 190
  pending: 180,                      // S4 net (200-20)             = 180
  cost: 30 + 10 + 8 + 12,            // recognized items only       = 60  (awaiting/cancelled excluded)
  storeDelivery: 3,                  // S3 store-absorbed
  recognizedTax: 8 + 4,              // S1 + S2                     = 12
  recognizedDelivery: 6,             // S1 customer-paid (S3 is store, so 0)
}
EXPECT.profit = EXPECT.revenue - EXPECT.cost - EXPECT.storeDelivery // 190-60-3 = 127
EXPECT.collected = EXPECT.revenue + EXPECT.recognizedTax + EXPECT.recognizedDelivery // 190+12+6 = 208

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// CommonJS has no top-level await; the kernel functions are async, so the
// DB-backed checks run inside this IIFE.
;(async () => {
// ---- 4. The REAL kernel over the REAL DB -----------------------------------
const filters = { startDate: '2026-08-01', endDate: '2026-08-31', branchId: null }
const kernel = await lib.getSalesTotals({ __db: db }, filters)

check(`kernel revenue_usd == net sales minus refunds (${EXPECT.revenue})`, kernel.revenue_usd === EXPECT.revenue)
check(`kernel refund_usd == recognized customer refunds only (${EXPECT.refunds})`, kernel.refund_usd === EXPECT.refunds)
check(`kernel pending_revenue_usd == awaiting-payment net, held OUT of revenue (${EXPECT.pending})`, kernel.pending_revenue_usd === EXPECT.pending)
check(`kernel cost_usd counts recognized items only (${EXPECT.cost})`, kernel.cost_usd === EXPECT.cost)
check(`kernel profit_usd = revenue - cost - store-absorbed delivery (${EXPECT.profit})`, kernel.profit_usd === EXPECT.profit)
check(`kernel collected_total_usd = revenue + tax + customer delivery (${EXPECT.collected})`, kernel.collected_total_usd === EXPECT.collected)
check('kernel gross_sales_usd still reports the raw pre-discount subtotal line (unchanged display field)', kernel.gross_sales_usd === 100 + 50 + 40 + 200 + 70) // all non-cancelled subtotals = 460
check('awaiting-payment revenue is NOT folded into revenue (would be 190+180=370 if it were)', kernel.revenue_usd !== EXPECT.revenue + EXPECT.pending)

// ---- 5. Per-period trend must SUM to the headline (shared deriveTotals) ------
const daySeries = await lib.getSalesPeriodSeries({ __db: db }, filters, 'day')
const seriesRevenue = Math.round(daySeries.reduce((s, r) => s + r.revenue_usd, 0) * 100) / 100
const seriesProfit = Math.round(daySeries.reduce((s, r) => s + r.profit_usd, 0) * 100) / 100
check(`per-day trend revenue sums to the headline (${EXPECT.revenue})`, seriesRevenue === EXPECT.revenue)
check(`per-day trend profit sums to the headline (${EXPECT.profit})`, seriesProfit === EXPECT.profit)

// ---- 6. Per-sale day drill must SUM to that day's total --------------------
// S6 is local Aug 15; its one recognized sale nets 60 - 20 refund = 40.
const day15 = await lib.getSalesDayReport({ __db: db }, '2026-08-15', {})
const day15Rows = Math.round(day15.sales.reduce((s, r) => s + r.revenue_usd, 0) * 100) / 100
check('per-sale day-drill rows sum to the day total (S6: 60 net - 20 refund = 40)', day15Rows === 40 && day15.totals.revenue_usd === 40)

// ---- 7. The REAL /stats SQL, extracted verbatim from routes/sales.ts --------
const salesTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
const m = salesTs.match(/SELECT\s+COUNT\(\*\) AS total_count,[\s\S]*?\)\s*r ON r\.sale_id = s\.id/)
assert.ok(m, 'could not locate the /stats revenue SELECT in routes/sales.ts -- did the query shape change?')
// Same local-day (UTC+7) scope the kernel applies, on the `s` alias.
const dateClauseS = `date(s.created_at, '+7 hours') >= @startDate AND s.created_at >= date(@startDate, '-1 day') AND date(s.created_at, '+7 hours') <= @endDate AND s.created_at < date(@endDate, '+1 day')`
const statsRow = db.prepare(`${m[0]} WHERE ${dateClauseS}`).get({ startDate: '2026-08-01', endDate: '2026-08-31' })
const statsRevenue = Math.round((statsRow.revenue_usd || 0) * 100) / 100
const statsPending = Math.round((statsRow.pending_revenue_usd || 0) * 100) / 100

check('the shipped /stats revenue SELECT was found and is on the net-sales basis (subtotal - discounts)',
  /COALESCE\(s\.subtotal_usd, 0\) - COALESCE\(s\.discount_usd, 0\) - COALESCE\(s\.membership_discount_usd, 0\)/.test(m[0]))
check('the shipped /stats revenue SELECT no longer sums total_usd (which folds tax in)',
  !/THEN COALESCE\(s\.total_usd, 0\) - COALESCE\(r\.refund_usd, 0\)/.test(m[0]))

// ---- 8. THE CONVERGENCE: header revenue == kernel revenue, to the cent ------
check(`CONVERGENCE: /stats revenue (${statsRevenue}) == kernel revenue (${kernel.revenue_usd})`, statsRevenue === kernel.revenue_usd)
check(`CONVERGENCE: /stats pending (${statsPending}) == kernel pending (${kernel.pending_revenue_usd})`, statsPending === kernel.pending_revenue_usd)
check('both surfaces equal the hand-computed net-sales revenue (190)', statsRevenue === EXPECT.revenue && kernel.revenue_usd === EXPECT.revenue)

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
