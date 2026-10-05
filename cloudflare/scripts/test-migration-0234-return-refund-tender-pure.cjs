// Pins migration 0234 (owner rulings 29 Sep 2026: a refund records its currency
// and the part that lowered a Not Paid sale's debt) on the REAL migration chain.
//
//  1. Pre/post: the returns row count and both refund sums are unchanged; every
//     existing row reads as a dollar refund recorded before the currency
//     (refund_currency NULL) with no debt lowered (owed_reduction_usd 0).
//  2. The schema refuses a currency other than USD/KHR and a debt reduction
//     that is negative or larger than the refund, on insert and on update.
//  3. A legacy row with a negative refund stays editable (the cap binds only
//     when a debt was lowered).
//  4. The file is two ADD COLUMN statements and nothing else (no trigger, so
//     test-held-0200 can classify it independent), and is LF-only.
//
// Run: node scripts/test-migration-0234-return-refund-tender-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0234_return_refund_tender.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < FILE)) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

const insertLegacy = db.prepare(`INSERT INTO returns (id, return_number, sale_id, return_scope, total_refund_usd, total_refund_khr, exchange_rate, status)
  VALUES (?, ?, ?, 'customer', ?, ?, 4100, 'completed')`)
insertLegacy.run(1, 'R-1', 11, 10, 41000)
insertLegacy.run(2, 'R-2', 12, -2.5, -10250)
insertLegacy.run(3, 'R-3', 13, 0, 0)
db.prepare(`INSERT INTO returns (id, return_number, sale_id, return_scope, total_refund_usd, total_refund_khr, exchange_rate, status,
  money_precision_version, calculated_refund_usd, rounding_adjustment_usd) VALUES (4, 'R-4', 14, 'customer', 7.25, 29725, 4100, 'completed', 1, 7.25, 0)`).run()

const PRE_POST = `SELECT COUNT(*) AS n, ROUND(SUM(total_refund_usd), 4) AS usd, SUM(total_refund_khr) AS khr FROM returns`
const before = db.prepare(PRE_POST).get()
const objectsBefore = db.prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all()
const columnsBefore = db.prepare('PRAGMA table_info(returns)').all().map((c) => c.name)

db.exec(migration)

const after = db.prepare(PRE_POST).get()
check('pre/post: row count and both refund sums are identical', JSON.stringify(before) === JSON.stringify(after))
const defaults = db.prepare('SELECT id, refund_currency, owed_reduction_usd FROM returns ORDER BY id').all()
check('every existing row reads as a refund recorded before the currency, with no debt lowered',
  defaults.every((row) => row.refund_currency === null && row.owed_reduction_usd === 0))

const columnsAfter = db.prepare('PRAGMA table_info(returns)').all().map((c) => c.name)
check('exactly two columns are added', JSON.stringify(columnsAfter.filter((c) => !columnsBefore.includes(c))) === JSON.stringify(['refund_currency', 'owed_reduction_usd']))
const objectsAfter = db.prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all()
const added = objectsAfter.filter((o) => !objectsBefore.some((b) => b.type === o.type && b.name === o.name))
check('no trigger or other schema object is added', JSON.stringify(added) === JSON.stringify([]))
const codeLines = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--'))
check('the file is two ADD COLUMN statements and nothing else',
  codeLines.length === 2 && codeLines.every((line) => /^ALTER TABLE returns ADD COLUMN \w+ /.test(line)))

const refused = (sql) => {
  try { db.prepare(sql).run(); return false } catch (error) { return /CHECK constraint failed/.test(error.message) }
}
check('insert: a currency other than USD or KHR is refused',
  refused("INSERT INTO returns (id, return_number, total_refund_usd, refund_currency) VALUES (5, 'R-5', 10, 'EUR')"))
check('insert: a debt reduction above the refund is refused',
  refused("INSERT INTO returns (id, return_number, total_refund_usd, refund_currency, owed_reduction_usd) VALUES (5, 'R-5', 10, 'USD', 10.01)"))
check('insert: a negative debt reduction is refused',
  refused("INSERT INTO returns (id, return_number, total_refund_usd, refund_currency, owed_reduction_usd) VALUES (5, 'R-5', 10, 'USD', -1)"))
check('insert: a debt reduction that is not a number is refused',
  refused("INSERT INTO returns (id, return_number, total_refund_usd, refund_currency, owed_reduction_usd) VALUES (5, 'R-5', 10, 'USD', 'five')"))
db.prepare("INSERT INTO returns (id, return_number, total_refund_usd, refund_currency, owed_reduction_usd) VALUES (5, 'R-5', 10, 'KHR', 10)").run()
check('insert: a riel refund that lowered the whole debt is accepted', db.prepare('SELECT owed_reduction_usd FROM returns WHERE id = 5').get().owed_reduction_usd === 10)

check('update: a currency other than USD or KHR is refused', refused("UPDATE returns SET refund_currency = 'THB' WHERE id = 1"))
check('update: lowering the refund below the debt it lowered is refused', refused('UPDATE returns SET total_refund_usd = 9 WHERE id = 5'))
db.prepare('UPDATE returns SET total_refund_usd = -3, total_refund_khr = -12300 WHERE id = 2').run()
check('update: a legacy negative refund with no debt lowered stays editable', db.prepare('SELECT total_refund_usd FROM returns WHERE id = 2').get().total_refund_usd === -3)

check('the migration file is LF-only', !migration.includes('\r'))

console.log(`\ntest-migration-0234-return-refund-tender-pure: ${checks} checks passed`)
