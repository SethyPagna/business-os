// Real-SQLite regression lock for the Reports-hub money aggregation
// (Part 553). Fees and returns are recorded in EITHER USD or KHR (never
// both on one row); the /report endpoints used to SUM(amount_usd) only, so
// a whole month of KHR-denominated fees/refunds reported as "$0.00" (user:
// "the fees showing no rows even though there are many fees"). The fix sums
// BOTH currencies. This test runs the EXACT money-sum SQL those two routes
// use against a real better-sqlite3 fixture and asserts both totals.
//
// Run (from cloudflare/): node scripts/test-report-currency-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
const fs = require('node:fs')

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, amount_usd REAL, amount_khr REAL, fee_date TEXT, branch_id INTEGER);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, total_refund_usd REAL, total_refund_khr REAL,
    supplier_compensation_usd REAL, supplier_compensation_khr REAL, supplier_loss_usd REAL, supplier_loss_khr REAL,
    return_scope TEXT, status TEXT, branch_id INTEGER, created_at TEXT);
`)
// 3 KHR-only fees + 1 USD-only fee, all inside Aug 2026.
const insFee = db.prepare('INSERT INTO fees (fee_type, amount_usd, amount_khr, fee_date, branch_id) VALUES (?,?,?,?,1)')
insFee.run('delivery', 0, 40000, '2026-08-05')
insFee.run('delivery', 0, 18000, '2026-08-06')
insFee.run('expense', 0, 73500, '2026-08-06')
insFee.run('expense', 12.5, 0, '2026-08-07')
insFee.run('expense', 5, 0, '2026-07-31') // OUT of range -- must be excluded
// 1 KHR-only customer return in range.
db.prepare(`INSERT INTO returns (total_refund_usd, total_refund_khr, supplier_compensation_usd, supplier_compensation_khr, supplier_loss_usd, supplier_loss_khr, return_scope, status, branch_id, created_at)
  VALUES (0, 51250, 0, 0, 0, 0, 'customer', 'completed', 1, '2026-08-10 03:00:00')`).run()

// --- fees /report money expression (verbatim from routes/fees.ts) --------
const feeMoney = 'ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd, ROUND(COALESCE(SUM(amount_khr), 0), 0) AS amount_khr'
check('fees report sums BOTH currencies, range-scoped by fee_date', () => {
  const totals = db.prepare(`SELECT COUNT(*) AS count, ${feeMoney} FROM fees f WHERE f.fee_date BETWEEN '2026-08-01' AND '2026-08-31'`).get()
  assert.equal(totals.count, 4, 'the out-of-range July fee is excluded')
  assert.equal(totals.amount_usd, 12.5, 'USD fees still sum')
  assert.equal(totals.amount_khr, 131500, 'KHR fees are summed (was dropped -> $0.00 bug)')
})
check('fees by_type carries KHR too', () => {
  const rows = db.prepare(`SELECT fee_type, COUNT(*) AS count, ${feeMoney} FROM fees f WHERE f.fee_date BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY fee_type ORDER BY amount_khr DESC`).all()
  const delivery = rows.find((r) => r.fee_type === 'delivery')
  assert.ok(delivery && delivery.amount_khr === 58000, `delivery KHR summed, got ${delivery && delivery.amount_khr}`)
})

// --- returns /report money expression (verbatim from routes/returns.ts) --
const retMoney = `ROUND(COALESCE(SUM(total_refund_usd), 0), 2) AS refund_usd,
  ROUND(COALESCE(SUM(total_refund_khr), 0), 0) AS refund_khr`
check('returns report sums refund KHR, scoped + customer + not-cancelled', () => {
  const where = `date(created_at) BETWEEN date('2026-08-01') AND date('2026-08-31') AND COALESCE(return_scope,'customer')='customer' AND COALESCE(status,'completed')<>'cancelled'`
  const totals = db.prepare(`SELECT COUNT(*) AS count, ${retMoney} FROM returns WHERE ${where}`).get()
  assert.equal(totals.count, 1)
  assert.equal(totals.refund_usd, 0)
  assert.equal(totals.refund_khr, 51250, 'KHR refund is summed')
})

// --- source guard: the routes must keep summing KHR --------------------
check('the route files still sum both currencies (no silent regression)', () => {
  const feesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'fees.ts'), 'utf8')
  const returnsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
  assert.match(feesSrc, /SUM\(amount_khr\)/, 'fees /report must sum amount_khr')
  assert.match(returnsSrc, /SUM\(total_refund_khr\)/, 'returns /report must sum total_refund_khr')
})

db.close()
console.log(`\nALL ${passed} CHECKS PASSED`)
