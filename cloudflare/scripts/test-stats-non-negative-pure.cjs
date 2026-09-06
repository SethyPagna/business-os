// N6 (owner, Sep 6 2026): "stats never show negative revenue/profit; returns
// scoped in; cancelled handled correctly." A negative period revenue is a
// SCOPING DEFECT, never something to clamp at display -- so this test proves
// the kernel cannot produce one, on a dataset built entirely out of the four
// shapes that produced one before.
//
// It runs the ACTUAL shipped kernel (lib/salesAnalytics.ts transpiled against a
// real better-sqlite3 DB, the same harness test-sales-revenue-convergence-pure
// uses), and it carries its own POSITIVE CONTROL: the pre-fix expressions are
// rebuilt verbatim and run over the SAME rows, so the fixture is proven to be
// one the old and new implementations actually disagree about. A fixture both
// implementations agree on would make every assertion below vacuous.
//
// The four shapes:
//   S2  subtotal_usd = 0 with a refund   -- the Sep 2-3 import's 22 receipts.
//                                           Old: revenue = MINUS the refund.
//   S3  discounts recorded > subtotal    -- a header that does not foot.
//                                           Old: revenue negative before any refund.
//   S4  refund > the sale's own net      -- Old: revenue negative by the excess.
//   S5  a sale CANCELLED after a return was recorded against it (permitted by
//       saleTransitions.ts) -- contributes 0 on BOTH sides, and is counted.
//   S6  a July sale returned in August   -- the boundary case: the refund
//       belongs to the SALE's bucket, so August's revenue never sees it.
//
// Run (from cloudflare/): node scripts/test-stats-non-negative-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

// ---- 1. Transpile the real kernel with a getDb() shim ----------------------
const srcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const stripped = ('// @ts-nocheck\n' + fs.readFileSync(srcPath, 'utf8'))
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-non-negative-'))
const tsPath = path.join(tmpDir, 'salesAnalytics.ts')
fs.writeFileSync(tsPath, stripped)
const winPath = path.join(tmpDir, 'businessDateWindow.ts')
fs.writeFileSync(winPath, fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath} ${winPath}`, { cwd: tmpDir, stdio: 'inherit' })
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))

// ---- 2. The DB -------------------------------------------------------------
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL,
    tax_usd REAL, total_usd REAL, total_khr REAL,
    delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER,
    delivery_actual_cost_usd REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, branch_name TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT,
    cashier_id INTEGER, cashier_name TEXT,
    payment_method TEXT, receipt_number TEXT, amount_paid_usd REAL, source_return_id INTEGER
  );
  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0
  );
  CREATE TABLE returns (
    id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL,
    status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER,
    supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT
  );
  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT
  );
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, gender TEXT);
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, category TEXT, stock_quantity REAL);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
  CREATE TABLE fees (
    id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER,
    notes TEXT, created_at TEXT
  );
`)

// UTC timestamps that map to local (UTC+7) midday of the named day.
const AT = (month, day) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 05:00:00`

const insSale = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, subtotal_usd, discount_usd, membership_discount_usd, tax_usd, total_usd,
   delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_actual_cost_usd, branch_id, branch_name,
   customer_id, cashier_id, cashier_name, payment_method, receipt_number)
  VALUES (@id,@created_at,@sale_status,@subtotal_usd,@discount_usd,@membership_discount_usd,@tax_usd,@total_usd,
   @delivery_fee_usd,@delivery_fee_paid_by,@is_delivery,@delivery_actual_cost_usd,@branch_id,@branch_name,
   @customer_id,@cashier_id,@cashier_name,@payment_method,@receipt_number)`)
const sale = (o) => insSale.run({
  delivery_fee_usd: 0, delivery_fee_paid_by: 'customer', is_delivery: 0, delivery_actual_cost_usd: null,
  branch_id: 1, branch_name: 'shop', customer_id: null, cashier_id: 7, cashier_name: 'aza',
  payment_method: 'cash', tax_usd: 0, membership_discount_usd: 0, discount_usd: 0,
  receipt_number: String(o.id), ...o,
})

// S1 -- an ordinary healthy receipt, so the window is not made entirely of defects.
sale({ id: 1, created_at: AT(8, 10), sale_status: 'completed', subtotal_usd: 100, discount_usd: 10, membership_discount_usd: 5, tax_usd: 8, total_usd: 93 })
// S2 -- the import defect: header value never written, and it has been refunded.
sale({ id: 2, created_at: AT(8, 11), sale_status: 'completed', subtotal_usd: 0, total_usd: 0 })
// S3 -- discounts recorded larger than the subtotal they come off.
sale({ id: 3, created_at: AT(8, 12), sale_status: 'completed', subtotal_usd: 10, discount_usd: 30, total_usd: 0 })
// S4 -- refunded for more than the receipt ever recognised.
sale({ id: 4, created_at: AT(8, 13), sale_status: 'completed', subtotal_usd: 40, total_usd: 40 })
// S5 -- CANCELLED after a return was recorded against it (saleTransitions.ts:157).
sale({ id: 5, created_at: AT(8, 14), sale_status: 'cancelled', subtotal_usd: 200, total_usd: 200 })
// S6 -- a JULY sale returned in AUGUST: the boundary case.
sale({ id: 6, created_at: AT(7, 20), sale_status: 'completed', subtotal_usd: 60, total_usd: 60 })
// S7 -- SEPTEMBER: sold line has no cost snapshot, its return carries a real cost.
sale({ id: 7, created_at: AT(9, 3), sale_status: 'completed', subtotal_usd: 50, total_usd: 50 })
// S8/S9 -- OCTOBER, the delivery cohort. Every sale in production that carries
// a courier cost is awaiting_payment (12 of 15,044, ids 16836-16872), which is
// exactly the shape the deliveryActualCostExpr comment used to say contributed
// "nothing to a recognized figure yet". recognizedExpr is `<> 'cancelled'`, so
// it always did. S9 additionally carries a standalone `fees` delivery row
// linked to the sale -- the anti-double-count guard must zero its courier cost
// so the same payment is not charged twice.
sale({ id: 8, created_at: AT(10, 5), sale_status: 'awaiting_payment', subtotal_usd: 100, total_usd: 105,
  delivery_fee_usd: 5, delivery_fee_paid_by: 'customer', is_delivery: 1, delivery_actual_cost_usd: 2 })
sale({ id: 9, created_at: AT(10, 6), sale_status: 'awaiting_payment', subtotal_usd: 50, total_usd: 54,
  delivery_fee_usd: 4, delivery_fee_paid_by: 'customer', is_delivery: 1, delivery_actual_cost_usd: 3 })
db.prepare(`INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, created_at)
  VALUES (1, 'delivery', 'Grab', 3, 0, '2026-10-06', 9, 1, '2026-10-06 05:00:00')`).run()

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 90, 1, 101, 'A')
insItem.run(2, 2, 1, 12, 0, 1, 102, 'B')    // real goods left the shelf on an unvalued receipt
insItem.run(3, 3, 1, 5, 10, 1, 103, 'C')
insItem.run(4, 4, 1, 8, 40, 1, 104, 'D')
insItem.run(5, 5, 1, 99, 200, 1, 105, 'E')  // cancelled -- must not reach COGS
insItem.run(6, 6, 1, 20, 60, 1, 106, 'F')
insItem.run(7, 7, 1, null, 50, 1, 107, 'G') // NULL cost snapshot
insItem.run(8, 8, 1, 40, 100, 1, 108, 'H')  // OCTOBER delivery cohort
insItem.run(9, 9, 1, 10, 50, 1, 109, 'I')

const insRet = db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, status, return_scope, created_at, branch_id, reason) VALUES (?,?,?,?,?,?,?,?)')
insRet.run(2, 2, 25, 'completed', 'customer', AT(8, 11), 1, 'damaged')   // refund on the unvalued receipt
insRet.run(4, 4, 100, 'completed', 'customer', AT(8, 13), 1, 'wrong')    // refund > the sale's net (40)
insRet.run(5, 5, 50, 'completed', 'customer', AT(8, 14), 1, 'void')      // return on a sale later CANCELLED
insRet.run(6, 6, 30, 'completed', 'customer', AT(8, 20), 1, 'late')      // AUGUST return, JULY sale
insRet.run(7, 7, 10, 'completed', 'customer', AT(9, 4), 1, 'size')

const insRetItem = db.prepare('INSERT INTO return_items (id, return_id, quantity, cost_price_usd, return_to_stock, stock_action) VALUES (?,?,?,?,?,?)')
insRetItem.run(1, 2, 1, 6, 1, 'restock')   // on the unvalued receipt -- cannot reverse a cost never counted
insRetItem.run(2, 4, 1, 8, 1, 'restock')
insRetItem.run(3, 5, 1, 99, 1, 'restock')  // on the cancelled sale -- must not reverse anything
insRetItem.run(4, 6, 1, 20, 1, 'restock')
insRetItem.run(5, 7, 1, 20, 1, 'restock')  // return cost with no sold-line cost to absorb it

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const r2 = (n) => Math.round(n * 100) / 100

;(async () => {
const AUG = { startDate: '2026-08-01', endDate: '2026-08-31', branchId: null }
const SEP = { startDate: '2026-09-01', endDate: '2026-09-30', branchId: null }

// ---- 3. POSITIVE CONTROL: the pre-fix expressions, over the same rows -------
// If this block did not produce a negative revenue, the fixture would not
// discriminate and every assertion below would pass on the old code too.
const oldNetSale = '(COALESCE(subtotal_usd, 0) - COALESCE(discount_usd, 0) - COALESCE(membership_discount_usd, 0))'
const oldNetRefund = `CASE WHEN COALESCE(subtotal_usd, 0) > 0
    THEN COALESCE(rf.refund_usd, 0) * (${oldNetSale} / COALESCE(subtotal_usd, 0))
    ELSE COALESCE(rf.refund_usd, 0) END`
const augWhere = `date(sales.created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
  AND COALESCE(sales.sale_status, 'completed') <> 'cancelled'`
const recognized = `COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'`
const oldRow = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN ${recognized} THEN ${oldNetSale} - (${oldNetRefund}) ELSE 0 END), 0) AS revenue_usd
  FROM sales ${lib.CUSTOMER_REFUND_JOIN}sales.id WHERE ${augWhere}
`).get()
const oldCostRow = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN ${recognized.replace(/sales\./g, 's.')} THEN si.cost_price_usd * si.quantity ELSE 0 END), 0) AS cost_usd
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE date(s.created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
    AND COALESCE(s.sale_status, 'completed') <> 'cancelled'
`).get()
check(`POSITIVE CONTROL: the pre-fix revenue expression really does go negative on these rows (${r2(oldRow.revenue_usd)})`,
  r2(oldRow.revenue_usd) === -20)
check(`POSITIVE CONTROL: the pre-fix COGS charged the unvalued receipt's goods too (${r2(oldCostRow.cost_usd)} vs 38)`,
  r2(oldCostRow.cost_usd) === 55)

// ---- 4. The shipped kernel -------------------------------------------------
const aug = await lib.getSalesTotals({ __db: db }, AUG)

check(`AUGUST revenue is non-negative and equals net sales minus refunds (${aug.revenue_usd})`, aug.revenue_usd === 85)
check('AUGUST revenue is NOT the old negative figure', aug.revenue_usd !== r2(oldRow.revenue_usd))
check(`net_sales_usd is the pre-refund term of that equation (${aug.net_sales_usd})`, aug.net_sales_usd === 125)
check('revenue_usd = net_sales_usd - refund_usd, exactly', r2(aug.net_sales_usd - aug.refund_usd) === aug.revenue_usd)
check(`refund_usd is capped at each sale's own net -- S4 gives 40, not its charged 100 (${aug.refund_usd})`, aug.refund_usd === 40)
check(`the cash that actually left the till is still reported on the charged basis (${aug.refund_charged_usd})`, aug.refund_charged_usd === 125)
check(`the part no sale could absorb is reported, not swallowed (${aug.refund_excess_usd} = S2's 25 + S4's 60)`, aug.refund_excess_usd === 85)

check(`AUGUST profit is non-negative (${aug.profit_usd})`, aug.profit_usd === 55)
check(`COGS is measured over VALUED receipts only (${aug.cost_usd}: 30 + 8 - 8 restocked)`, aug.cost_usd === 30)
check(`the unvalued receipts are counted, and so is the COGS held out with them (${aug.unvalued_tx_count} / $${aug.unvalued_cost_usd})`,
  aug.unvalued_tx_count === 2 && aug.unvalued_cost_usd === 17)
check('a return against an unvalued receipt reverses nothing (S2 restocked $6 -- it never entered COGS)',
  aug.returned_cost_usd === 8)

check(`a sale CANCELLED after its return contributes 0 on both sides and is counted instead (${aug.cancelled_tx_count})`,
  aug.cancelled_tx_count === 1 && aug.gross_sales_usd === 150 && aug.cost_usd !== 30 + 99)
check(`a JULY sale returned in AUGUST keeps its refund in July -- August's kernel refund is ${aug.refund_usd}, not ${aug.refund_usd + 30}`,
  aug.refund_usd === 40)

// The activity figure the Dashboard/Sales/Returns surfaces report is a
// DIFFERENT question over a DIFFERENT population, and the gap is exactly the
// boundary-crossing refunds. Nothing may subtract one from the other.
const activity = db.prepare(`
  SELECT COALESCE(SUM(total_refund_usd), 0) AS refund_usd FROM returns
  WHERE date(created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
    AND COALESCE(status, 'completed') <> 'cancelled' AND COALESCE(return_scope, 'customer') = 'customer'
`).get()
check(`the return-date ACTIVITY total (${activity.refund_usd}) is not the kernel's reversal (${aug.refund_usd}) -- subtracting it from revenue would give ${r2(aug.revenue_usd - activity.refund_usd)}`,
  activity.refund_usd === 205 && r2(aug.revenue_usd - activity.refund_usd) < 0)

// ---- 5. Every bucket, not just the window ----------------------------------
const days = await lib.getSalesPeriodSeries({ __db: db }, AUG, 'day')
check(`every DAY bucket is non-negative too (${days.map((d) => d.revenue_usd).join(', ')})`,
  days.every((d) => d.revenue_usd >= 0 && d.profit_usd >= 0))
check(`per-day revenue sums to the headline (${r2(days.reduce((s, d) => s + d.revenue_usd, 0))})`,
  r2(days.reduce((s, d) => s + d.revenue_usd, 0)) === aug.revenue_usd)
check(`per-day profit sums to the headline (${r2(days.reduce((s, d) => s + d.profit_usd, 0))})`,
  r2(days.reduce((s, d) => s + d.profit_usd, 0)) === aug.profit_usd)
check('the period row carries gross_sales_usd and refund_usd -- the two Revenue Flow series that used to read undefined',
  days.every((d) => typeof d.gross_sales_usd === 'number' && typeof d.refund_usd === 'number')
  && r2(days.reduce((s, d) => s + d.gross_sales_usd, 0)) === aug.gross_sales_usd
  && r2(days.reduce((s, d) => s + d.refund_usd, 0)) === aug.refund_usd)
check('and they are not all zero, which is what a missing key rendered as',
  days.some((d) => d.gross_sales_usd > 0) && days.some((d) => d.refund_usd > 0))
check(`the cancelled receipt is counted on its own day bucket, not in the money (${days.reduce((s, d) => s + d.cancelled_tx_count, 0)})`,
  days.reduce((s, d) => s + d.cancelled_tx_count, 0) === 1)

for (const by of ['cashier', 'branch', 'payment_method', 'customer', 'hour', 'weekday']) {
  const rows = await lib.getSalesGroupedTotals({ __db: db }, AUG, by)
  check(`grouped by ${by}: no row shows negative revenue or profit`,
    rows.every((r) => r.revenue_usd >= 0 && r.profit_usd >= 0))
  check(`grouped by ${by}: rows sum back to the window revenue (${r2(rows.reduce((s, r) => s + r.revenue_usd, 0))})`,
    r2(rows.reduce((s, r) => s + r.revenue_usd, 0)) === aug.revenue_usd)
  check(`grouped by ${by}: cancelled_tx_count rides along additively`,
    rows.every((r) => typeof r.cancelled_tx_count === 'number'))
}

const summaryDays = await lib.getBusinessSummaryDayRows({ __db: db }, AUG)
check('the business-summary day rows obey the same invariants',
  summaryDays.every((r) => r.revenue_usd >= 0 && r.profit_usd >= 0 && r.avg_order_usd >= 0))

// ---- 6. The COGS floor now reports what it absorbs -------------------------
const sep = await lib.getSalesTotals({ __db: db }, SEP)
check(`SEPTEMBER: a sold line with no cost snapshot cannot absorb its return's cost -- the shortfall is reported (${sep.returned_cost_shortfall_usd})`,
  sep.returned_cost_shortfall_usd === 20 && sep.cost_usd === 0)
check(`SEPTEMBER revenue and profit stay non-negative (${sep.revenue_usd} / ${sep.profit_usd})`,
  sep.revenue_usd === 40 && sep.profit_usd === 40)
check(`AUGUST absorbed every returned cost it counted, so it reports no shortfall (${aug.returned_cost_shortfall_usd})`, aug.returned_cost_shortfall_usd === 0)

// ---- 6b. The awaiting-payment delivery cohort is INSIDE the realised figures
// (ask item 4). deliveryActualCostExpr's note used to end "so this expression
// contributes nothing to a recognized figure yet", reasoning from a cohort that
// is entirely awaiting_payment. recognizedExpr admits awaiting_payment, so the
// courier cost reduced delivery_net_usd and profit_usd the whole time -- and
// was reported a SECOND time as pending_delivery_cost_usd, which is a subset,
// not a complement. This pins the corrected comment to behaviour.
const OCT = { startDate: '2026-10-01', endDate: '2026-10-31', branchId: null }
const oct = await lib.getSalesTotals({ __db: db }, OCT)
check(`OCTOBER: an awaiting_payment sale's courier cost enters recognized_delivery_cost_usd (${oct.recognized_delivery_cost_usd})`,
  oct.recognized_delivery_cost_usd === 2)
check(`...so it reduces delivery_net_usd: charged 9 - paid 2 = ${oct.delivery_net_usd}`,
  oct.recognized_delivery_usd === 9 && oct.delivery_net_usd === 7)
check(`...and therefore profit_usd today (${oct.profit_usd} = revenue ${oct.revenue_usd} - COGS ${oct.cost_usd} + delivery net ${oct.delivery_net_usd})`,
  oct.revenue_usd === 150 && oct.cost_usd === 50 && oct.profit_usd === 107)
check('POSITIVE CONTROL: the retired claim ("contributes nothing to a recognized figure") would have given delivery_net 9 and profit 109',
  oct.delivery_net_usd !== 9 && oct.profit_usd !== 109)
check(`the SAME cost is additionally reported as pending_delivery_cost_usd -- a subset, never added on top (${oct.pending_delivery_cost_usd})`,
  oct.pending_delivery_cost_usd === 2 && oct.pending_delivery_usd === 5 + 4)
check(`the pending block mirrors the realised one over the same cohort (${oct.pending_revenue_usd} / ${oct.pending_profit_usd})`,
  oct.pending_revenue_usd === 150 && oct.pending_cost_usd === 50 && oct.pending_profit_usd === 107)
check(`the anti-double-count guard zeroes the courier cost of a sale that also has a standalone delivery fee row (S9's $3 is charged once, in fees)`,
  oct.recognized_delivery_cost_usd === 2 && oct.delivery_actual_cost_usd === 5)
check(`OCTOBER revenue and profit stay non-negative`, oct.revenue_usd >= 0 && oct.profit_usd >= 0)
// The comment may still QUOTE the refuted sentence -- it does, inside the
// retraction that names it -- but it may never assert it. So the check is
// positional: every occurrence has to sit inside "used to conclude ... That
// was already false", never standing on its own as the note's conclusion.
const kernelSource = fs.readFileSync(srcPath, 'utf8')
const claimHits = [...kernelSource.matchAll(/contributes nothing to a recognized figure/g)]
check(`the deliveryActualCostExpr note states the claim only to retract it (${claimHits.length} occurrence(s))`,
  claimHits.length === 1
  && /used to conclude[\s\S]{0,120}contributes nothing to a recognized figure/.test(kernelSource)
  && /That was already false when\s*\n\/\/ it was written/.test(kernelSource))

// ---- 7. pending_item_discount_usd is no longer dropped on the floor --------
const derived = lib.deriveTotals({ tx_count: 1, recognized_net_usd: 10 }, 0, 0, { itemDiscountUsd: 3, pendingItemDiscountUsd: 4, cancelledTxCount: 2, unvaluedCostUsd: 9 })
check('deriveTotals emits pending_item_discount_usd instead of accepting and discarding it',
  derived.pending_item_discount_usd === 4 && derived.item_discount_usd === 3)
check('deriveTotals emits cancelled_tx_count and unvalued_cost_usd',
  derived.cancelled_tx_count === 2 && derived.unvalued_cost_usd === 9)

// ---- 8. The invariants, stated as invariants -------------------------------
check('netSaleExpr floors ONE sale at zero rather than clamping a total',
  /^MAX\(0, /.test(lib.netSaleExpr('s.')))
check('netRefundExpr caps ONE sale\'s refund at that sale\'s own net',
  lib.netRefundExpr('s.', 'rf.').startsWith('MIN(' + lib.netSaleExpr('s.')))

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
