// CREDIT IS REVENUE AND PROFIT, AND IS REPORTED ONCE (owner, Sep 6 2026):
//
//   "i already mentioned the credit amount/unpaid make it consistent just use
//    credit don't use both, it cause confusion... don't minus for credit amount
//    add into revenue and profit, just note the credit amount is that much so
//    instead of $-n... just $n... so we know no need to remove from profit"
//
// The convergence test next door proves the /stats header and the kernel agree
// on ONE revenue number. It does not prove that number is the credit-INCLUSIVE
// one -- it would stay green if both surfaces moved to the collected basis
// together. This test is the discriminator: every assertion below names the
// value the credit-EXCLUDING implementation would produce on the very same
// rows, so a green run means the two implementations actually disagreed here
// and the shipped one is the owner's.
//
//   figure   credit IN (shipped)   credit OUT (what it must not be)
//   revenue  351                   198
//   COGS      98                    48
//   profit   255                   152
//
// It also pins the fourth property the owner asked for and the third surface
// that has to honour it:
//   * ONCE, not twice: pending_revenue_usd is a SUBSET of revenue_usd, so
//     revenue - pending is not another revenue and revenue + pending is not a
//     total. Nothing may add or subtract the two.
//   * POSITIVE, always: netSaleExpr floors each row at 0, so the credit the
//     header prints can never arrive as $-n.
//   * THREE-WAY PARITY: the kernel's pending, the /stats header's pending (the
//     number the Sales page prints as "Credit") and the frontend's own
//     saleListCreditUsd fallback are the same figure on the same window, so
//     the header and its offline fallback can never show two different credits.
//   * The /stats prose must not contradict the /stats SQL.
//
// Runs the SHIPPED code: salesAnalytics.ts and frontend/src/utils/
// statsFormulas.ts are transpiled and executed, and the header SELECT is
// extracted from routes/sales.ts with its ${...} holes intact and evaluated
// against the kernel's own exported fragments.
//
// Run (from cloudflare/): node scripts/test-credit-in-revenue-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

// ---- 1. Transpile the real kernel + the real frontend mirror ----------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-in-revenue-'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')

const kernelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
// Same shim the convergence test uses: getDb(env) hands back the sqlite handle
// we pass in. \r?\n so this works on a CRLF checkout too.
const kernelStripped = ('// @ts-nocheck\n' + kernelSrc)
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')
fs.writeFileSync(path.join(tmpDir, 'salesAnalytics.ts'), kernelStripped)
fs.writeFileSync(path.join(tmpDir, 'businessDateWindow.ts'),
  fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
fs.writeFileSync(path.join(tmpDir, 'statsFormulas.ts'), '// @ts-nocheck\n'
  + fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'statsFormulas.ts'), 'utf8'))
execSync([
  `node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir}`,
  path.join(tmpDir, 'salesAnalytics.ts'),
  path.join(tmpDir, 'businessDateWindow.ts'),
  path.join(tmpDir, 'statsFormulas.ts'),
].join(' '), { cwd: tmpDir, stdio: 'inherit' })
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))
const front = require(path.join(tmpDir, 'statsFormulas.js'))

// ---- 2. One mixed window with exactly one credit sale in it -----------------
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL,
    tax_usd REAL, total_usd REAL,
    delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER,
    delivery_actual_cost_usd REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, customer_id INTEGER, payment_method TEXT, customer_name TEXT,
    receipt_number TEXT, amount_paid_usd REAL, source_return_id INTEGER
  );
  CREATE TABLE sale_items (
    id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0
  );
  CREATE TABLE returns (
    id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, status TEXT,
    return_scope TEXT, created_at TEXT, branch_id INTEGER
  );
  CREATE TABLE return_items (
    id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT
  );
  CREATE TABLE customers (id INTEGER PRIMARY KEY, membership_number TEXT);
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE fees (
    id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER,
    notes TEXT, created_at TEXT
  );
`)

const AT = (day) => `2026-08-${String(day).padStart(2, '0')} 05:00:00` // local 12:00 (UTC+7)
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

sale({ id: 1, created_at: AT(10), sale_status: 'completed', subtotal_usd: 100, discount_usd: 10, membership_discount_usd: 5, tax_usd: 8, total_usd: 93, delivery_fee_usd: 6, delivery_fee_paid_by: 'customer', is_delivery: 1, delivery_actual_cost_usd: 4 })
sale({ id: 2, created_at: AT(11), sale_status: '',           subtotal_usd: 50,  discount_usd: 0,  membership_discount_usd: 0,  tax_usd: 4, total_usd: 54 })
sale({ id: 3, created_at: AT(12), sale_status: null,         subtotal_usd: 40,  discount_usd: 5,  membership_discount_usd: 0,  tax_usd: 0, total_usd: 35, delivery_fee_usd: 3, delivery_fee_paid_by: 'store', is_delivery: 1 })
// THE CREDIT SALE. Net 200-20 = 180; goods worth 50 at cost already gone.
sale({ id: 4, created_at: AT(13), sale_status: 'awaiting_payment', subtotal_usd: 200, discount_usd: 20, membership_discount_usd: 0, tax_usd: 10, total_usd: 190 })
sale({ id: 5, created_at: AT(14), sale_status: 'cancelled',  subtotal_usd: 999, discount_usd: 0,  membership_discount_usd: 0,  tax_usd: 50, total_usd: 1049 })
sale({ id: 6, created_at: AT(15), sale_status: 'completed',  subtotal_usd: 80,  discount_usd: 0,  membership_discount_usd: 20, tax_usd: 0, total_usd: 60 })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 90, 1, 101, 'A')
insItem.run(2, 2, 1, 10, 50, 1, 102, 'B')
insItem.run(3, 3, 1, 8, 35, 1, 103, 'C')
insItem.run(4, 4, 1, 50, 180, 1, 104, 'D')  // the credit sale's COGS
insItem.run(5, 5, 1, 999, 999, 1, 105, 'E') // cancelled -> out
insItem.run(6, 6, 1, 12, 60, 1, 106, 'F')

const insRet = db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, status, return_scope, created_at, branch_id) VALUES (?,?,?,?,?,?,?)')
insRet.run(1, 1, 20, 'completed', 'customer', AT(16), 1)
insRet.run(2, 6, 15, 'completed', 'customer', AT(16), 1)
insRet.run(3, 6, 5,  'completed', 'customer', AT(16), 1)
insRet.run(4, 2, 100, 'completed', 'supplier', AT(16), 1)
insRet.run(5, 1, 999, 'cancelled', 'customer', AT(16), 1)
insRet.run(6, 4, 30, 'completed', 'customer', AT(16), 1)
const insRetItem = db.prepare('INSERT INTO return_items (id, return_id, quantity, cost_price_usd, return_to_stock, stock_action) VALUES (?,?,?,?,?,?)')
insRetItem.run(1, 1, 1, 12, 1, 'restock')
insRetItem.run(2, 2, 1, 9, 1, 'damaged')
insRetItem.run(3, 3, 1, 7, 1, 'none')
insRetItem.run(4, 4, 1, 40, 1, 'restock')

// ---- 3. The two implementations, hand-computed ------------------------------
// CREDIT IN (the owner's rule, what must ship):
//   revenue = (85+50+35+180+60) - (17+15+27) = 410 - 59 = 351
//   COGS    = (30+10+8+50+12) - 12 restocked = 98
//   profit  = 351 - 98 + (6-4)               = 255
const IN = { revenue: 351, cogs: 98, profit: 255, credit: 180 }
// CREDIT OUT (the pre-Sep-6 rule, what must NOT ship): drop S4 from every sum.
//   revenue = (85+50+35+60) - (17+15) = 230 - 32 = 198
//   COGS    = (30+10+8+12) - 12       = 48
//   profit  = 198 - 48 + 2            = 152
const OUT = { revenue: 198, cogs: 48, profit: 152 }

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

// The fixture has to be able to tell the two apart, or every check below is
// vacuous. This is the instrument's own calibration, not a restatement.
check('the two implementations really disagree on this fixture (351/98/255 vs 198/48/152)',
  IN.revenue !== OUT.revenue && IN.cogs !== OUT.cogs && IN.profit !== OUT.profit)
check('the whole disagreement is exactly the one credit sale',
  IN.revenue - OUT.revenue === 180 - 27 && IN.cogs - OUT.cogs === 50)

;(async () => {
const filters = { startDate: '2026-08-01', endDate: '2026-08-31', branchId: null }
const kernel = await lib.getSalesTotals({ __db: db }, filters)

// ---- 4. The kernel counts the credit sale in all three figures --------------
check(`kernel revenue_usd includes the credit sale (${IN.revenue}, not ${OUT.revenue})`,
  kernel.revenue_usd === IN.revenue && kernel.revenue_usd !== OUT.revenue)
check(`kernel cost_usd includes the credit sale's COGS (${IN.cogs}, not ${OUT.cogs})`,
  kernel.cost_usd === IN.cogs && kernel.cost_usd !== OUT.cogs)
check(`kernel profit_usd includes the credit sale (${IN.profit}, not ${OUT.profit})`,
  kernel.profit_usd === IN.profit && kernel.profit_usd !== OUT.profit)

// ---- 5. Reported ONCE, as a positive subset --------------------------------
check(`kernel reports the credit additionally as pending_revenue_usd (${IN.credit})`,
  kernel.pending_revenue_usd === IN.credit)
check('the credit is POSITIVE -- the owner\'s "$n, not $-n", at the source',
  kernel.pending_revenue_usd > 0)
check('the credit is a SUBSET of revenue, not a complement (revenue > credit, and revenue is not revenue+credit)',
  kernel.revenue_usd > kernel.pending_revenue_usd && kernel.revenue_usd !== OUT.revenue + IN.credit)
check('subtracting the credit from revenue would produce a figure no surface may show',
  kernel.revenue_usd - kernel.pending_revenue_usd === 171 && kernel.revenue_usd - kernel.pending_revenue_usd !== OUT.revenue)
check('collected cash is the ONE figure the credit stays out of',
  kernel.collected_total_usd === 208 && kernel.collected_total_usd < kernel.revenue_usd + 12 + 6)

// A floored net can never go negative, so no surface has anything to clamp.
const flooredRow = db.prepare(`SELECT ${lib.netSaleExpr('')} AS net FROM (SELECT 10 AS subtotal_usd, 99 AS discount_usd, 0 AS membership_discount_usd)`).get()
check('netSaleExpr floors a credit row at 0 rather than emitting a negative', flooredRow.net === 0)

// ---- 6. The /stats header: same SQL the Sales page's "Credit" comes from ----
const salesTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
const m = salesTs.match(/const totals = await db\.prepare\(`([\s\S]*?)`\)\.get</)
assert.ok(m, 'could not locate the /stats revenue SELECT in routes/sales.ts')
const dateClauseS = `date(s.created_at, '+7 hours') >= @startDate AND s.created_at >= date(@startDate, '-1 day') AND date(s.created_at, '+7 hours') <= @endDate AND s.created_at < date(@endDate, '+1 day')`
// eslint-disable-next-line no-new-func -- the input is this repo's own source.
const headerSql = new Function(
  'recognizedExpr', 'netSaleExpr', 'netRefundExpr', 'awaitingExpr', 'CUSTOMER_REFUND_JOIN', 'where',
  'return \`' + m[1] + '\`',
)(lib.recognizedExpr, lib.netSaleExpr, lib.netRefundExpr, lib.awaitingExpr, lib.CUSTOMER_REFUND_JOIN, [dateClauseS])
const stats = db.prepare(headerSql).get({ startDate: '2026-08-01', endDate: '2026-08-31' })
const statsRevenue = Math.round((stats.revenue_usd || 0) * 100) / 100
const statsCredit = Math.round((stats.pending_revenue_usd || 0) * 100) / 100

check(`/stats revenue_usd includes the credit sale (${statsRevenue} == ${IN.revenue}, not ${OUT.revenue})`,
  statsRevenue === IN.revenue && statsRevenue !== OUT.revenue)
check(`/stats revenue_count counts the credit sale (5 non-cancelled, not 4)`,
  Number(stats.revenue_count) === 5)
check('/stats uses recognizedExpr for the headline, never collectedSaleExpr',
  headerSql.includes("<> 'cancelled'") && !headerSql.includes("NOT IN ('cancelled', 'awaiting_payment')"))
check(`PARITY: the header's credit (${statsCredit}) == the kernel's credit (${kernel.pending_revenue_usd})`,
  statsCredit === kernel.pending_revenue_usd)
check(`PARITY: the header's revenue (${statsRevenue}) == the kernel's revenue (${kernel.revenue_usd})`,
  statsRevenue === kernel.revenue_usd)

// ---- 7. The frontend's own fallback shows the SAME credit -------------------
// The Sales header prefers /stats and falls back to reducing over the rows it
// already has. Both paths must produce one credit, or the same page shows two.
const listRows = db.prepare(`
  SELECT s.*, COALESCE(rf.refund_usd, 0) AS refund_usd,
    COALESCE(s.total_usd, 0) - COALESCE(rf.refund_usd, 0) AS net_total_usd
  FROM sales s ${lib.CUSTOMER_REFUND_JOIN}s.id
  WHERE date(s.created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
`).all()
check('the fallback sees every row of the window (6)', listRows.length === 6)
check('isCreditSale picks exactly the awaiting_payment row',
  listRows.filter(front.isCreditSale).map((r) => r.id).join(',') === '4')
check(`THREE-WAY PARITY: frontend saleListCreditUsd (${front.saleListCreditUsd(listRows)}) == header (${statsCredit}) == kernel (${kernel.pending_revenue_usd})`,
  front.saleListCreditUsd(listRows) === statsCredit && statsCredit === kernel.pending_revenue_usd)
check(`the frontend fallback's revenue includes the credit too (${front.saleListRevenueUsd(listRows)} == ${IN.revenue})`,
  front.saleListRevenueUsd(listRows) === IN.revenue)
check('the frontend never produces a negative credit, however the row is shaped',
  front.saleListCreditUsd([{ sale_status: 'awaiting_payment', subtotal_usd: 10, discount_usd: 99, membership_discount_usd: 0 }]) === 0)

// ---- 8. The prose must not contradict the SQL ------------------------------
// The stale comment is the actual failure mode here: a reader who trusts
// "never folded into revenue" edits the query back to the pre-Sep-6 rule and
// every check above goes red at once.
const statsBlock = salesTs.slice(salesTs.indexOf("app.get('/stats'"), salesTs.indexOf("app.get('/stats-strip'"))
const statsPreamble = salesTs.slice(Math.max(0, salesTs.indexOf("app.get('/stats'") - 1800), salesTs.indexOf("app.get('/stats'"))
for (const [name, text] of [['preamble', statsPreamble], ['handler', statsBlock]]) {
  check(`the /stats ${name} no longer claims the credit is excluded from revenue`,
    !/never folded into revenue/i.test(text) && !/excluding cancelled\/awaiting_payment"\s*$/m.test(text))
}
check('the /stats handler says out loud that the credit is inside revenue',
  /INSIDE revenue_usd|Credit is included because recognizedExpr/.test(statsBlock))
check('the sweep can see the sentence it forbids (positive control)',
  /never folded into revenue/i.test('reported separately as pending, never folded into revenue.'))

console.log(`\nALL ${passed} CHECKS PASSED -- credit is inside revenue (${IN.revenue}), COGS (${IN.cogs}) and profit (${IN.profit}), and is reported once, positive, as ${IN.credit}`)
})().catch((e) => { console.error(e); process.exit(1) })
