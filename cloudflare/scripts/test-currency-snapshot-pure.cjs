// Locks in the forward-only currency rule:
//
//   "conversion is for pos and sales for future pos and sales, doesn't change
//    past... only present future... as we use usd for various stats, but we
//    have two currency using concurrently"
//
// The business prices in USD and settles in USD and KHR concurrently. The
// USD->KHR rate changes over time. A completed sale must keep the rate and the
// KHR amounts it was made at, forever -- changing settings.exchange_rate today
// must not restate yesterday's revenue.
//
// The design already satisfies this: `sales` stores BOTH *_usd and *_khr for
// every money field PLUS its own exchange_rate column, and the dashboard sums
// those stored columns. This test exists so that stays true -- the failure
// mode it guards against is somebody "simplifying" the schema by dropping the
// KHR columns and deriving them from the live rate at read time, which would
// silently rewrite every historical figure the next time the rate moved.
//
// Uses the REAL migration for the sales table rather than a hand-written
// schema, so a column being renamed or dropped fails here too.
//
// Run: node scripts/test-currency-snapshot-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- real schema -----------------------------------------------------------

const initSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8')
const salesDdl = initSql.match(/CREATE TABLE (?:IF NOT EXISTS )?sales\s*\([\s\S]*?\n\);/)
assert.ok(salesDdl, 'could not find the sales table definition in 0001_init.sql')

const db = new Database(':memory:')
db.exec(salesDdl[0])

const MONEY_PAIRS = [
  ['subtotal_usd', 'subtotal_khr'],
  ['discount_usd', 'discount_khr'],
  ['tax_usd', 'tax_khr'],
  ['total_usd', 'total_khr'],
  ['amount_paid_usd', 'amount_paid_khr'],
  ['change_usd', 'change_khr'],
  ['delivery_fee_usd', 'delivery_fee_khr'],
  ['membership_discount_usd', 'membership_discount_khr'],
]

check('every money field on `sales` is stored in BOTH currencies, alongside the row\'s own exchange_rate', () => {
  const cols = new Set(db.prepare('PRAGMA table_info(sales)').all().map((c) => c.name))
  assert.ok(cols.has('exchange_rate'), 'sales must record the rate the sale was made at')
  for (const [usd, khr] of MONEY_PAIRS) {
    assert.ok(cols.has(usd), `sales.${usd} is missing`)
    assert.ok(cols.has(khr), `sales.${khr} is missing -- KHR must be stored, not derived at read time`)
  }
})

// --- two sales at two different rates --------------------------------------

// Mirrors routes/sales.ts: KHR is computed from the rate supplied with the
// request and WRITTEN to the row (see its totalKhr / subtotal_khr / tax_khr
// assignments), not recomputed later.
function recordSale({ id, receipt, totalUsd, rate }) {
  db.prepare(`
    INSERT INTO sales (id, receipt_number, exchange_rate, subtotal_usd, subtotal_khr, total_usd, total_khr, sale_status)
    VALUES (@id, @receipt, @rate, @totalUsd, @subtotalKhr, @totalUsd, @totalKhr, 'completed')
  `).run({
    id, receipt, rate, totalUsd,
    subtotalKhr: Math.round(totalUsd * rate),
    totalKhr: Math.round(totalUsd * rate),
  })
}

const OLD_RATE = 4000
const NEW_RATE = 4200

recordSale({ id: 1, receipt: 'R-OLD', totalUsd: 10, rate: OLD_RATE })   // 40,000 KHR
recordSale({ id: 2, receipt: 'R-NEW', totalUsd: 10, rate: NEW_RATE })   // 42,000 KHR

check('two identical-USD sales made at different rates keep different, correct KHR totals', () => {
  const rows = db.prepare('SELECT id, exchange_rate, total_usd, total_khr FROM sales ORDER BY id').all()
  assert.deepStrictEqual(rows[0], { id: 1, exchange_rate: OLD_RATE, total_usd: 10, total_khr: 40000 })
  assert.deepStrictEqual(rows[1], { id: 2, exchange_rate: NEW_RATE, total_usd: 10, total_khr: 42000 })
})

// --- the actual regression: change the live rate ---------------------------

// The "settings" rate is deliberately just a local variable here. That is the
// point: it exists nowhere in the queries below, so moving it cannot move a
// historical number. If a future refactor makes the read path depend on it,
// these assertions stop holding.
let settingsExchangeRate = OLD_RATE

const DASHBOARD_TOTALS_SQL = `
  SELECT COALESCE(SUM(total_usd), 0) AS total_usd,
         COALESCE(SUM(total_khr), 0) AS total_khr
  FROM sales
  WHERE COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment')
`

check('changing the live settings rate does not move any already-recorded sale', () => {
  const before = db.prepare(DASHBOARD_TOTALS_SQL).get()
  settingsExchangeRate = 8000 // a drastic move, e.g. a currency revaluation
  const after = db.prepare(DASHBOARD_TOTALS_SQL).get()
  assert.deepStrictEqual(after, before, 'historical revenue must not change when the rate is edited')
  assert.strictEqual(after.total_usd, 20)
  assert.strictEqual(after.total_khr, 82000, '40,000 + 42,000 -- each sale at its own rate, not 20 x the new rate')
  assert.notStrictEqual(after.total_khr, 20 * settingsExchangeRate, 'aggregation must not be recomputing from the live rate')
})

check('a NEW sale made after the rate change uses the new rate, without disturbing the old ones', () => {
  recordSale({ id: 3, receipt: 'R-AFTER', totalUsd: 10, rate: settingsExchangeRate })
  const rows = db.prepare('SELECT id, total_khr FROM sales ORDER BY id').all()
  assert.deepStrictEqual(rows, [
    { id: 1, total_khr: 40000 },
    { id: 2, total_khr: 42000 },
    { id: 3, total_khr: 80000 },
  ], 'forward-only: the new rate applies to the new sale and only the new sale')
})

// --- source guards ---------------------------------------------------------
//
// The assertions above run against a local copy of the schema, so they would
// still pass if the real route/dashboard stopped storing or reading these
// columns. These check the actual source.

const salesRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
const compatRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')

check('routes/sales.ts persists exchange_rate and both currency columns on create', () => {
  assert.match(salesRoute, /exchange_rate,\s*\n?\s*subtotal_usd, subtotal_khr/, 'the INSERT must carry exchange_rate and both currency columns')
  assert.match(salesRoute, /total_khr: totalKhr/, 'total_khr must be computed once at sale time and stored')
})

check('routes/compat.ts aggregates the STORED currency columns, never a live-rate product', () => {
  assert.match(compatRoute, /SUM\(total_usd\)[\s\S]{0,80}SUM\(total_khr\)/, 'dashboard totals must sum stored columns')
  assert.doesNotMatch(
    compatRoute,
    /SUM\(\s*total_usd\s*\*\s*[a-zA-Z_@]/,
    'dashboard must never multiply a stored USD total by a rate at read time -- that would restate history',
  )
})

db.close()
console.log(`\n${passed} currency-snapshot checks passed`)
