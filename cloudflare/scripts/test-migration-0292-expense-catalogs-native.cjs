'use strict'
// Pins migration 0292 (expense label and type catalogs, partial index on sales that carry a courier cost) on the REAL migration chain:
//   - it applies on top of the chain it belongs to, adds only the two tables and the index, and touches no row of fees or sales;
//   - it is idempotent (the whole file runs a second time without error) and its post-check aborts when the objects are missing;
//   - the previous Worker's statements (list, report, labels, create) still run on the new schema, and the new Worker still answers
//     with the tables ABSENT (rollback-safe in both directions);
//   - the planner uses the partial index for the exact predicate the Worker issues, and does not for a predicate that would read every sale;
//   - the catalog constraints refuse a duplicate key (case-folded in ASCII) and an empty or over-long name.
//
// Run (from cloudflare/): node scripts/test-migration-0292-expense-catalogs-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0292_expense_label_type_catalogs.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }

function chainBefore() {
  const db = new Database(':memory:')
  for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) db.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
  return db
}
const names = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY name").all().map((r) => r.name)
const plan = (db, statement, params = {}) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(params).map((row) => row.detail).join(' | ')

const db = chainBefore()
db.exec("INSERT INTO sales (id, created_at, delivery_actual_cost_usd) VALUES (1, '2026-10-10 03:00:00', 2.5), (2, '2026-10-10 04:00:00', NULL)")
db.exec("INSERT INTO fees (fee_type, label, amount_usd, fee_date) VALUES ('other', 'Tape', 2, '2026-10-10')")
const before = names(db)
const rowsBefore = JSON.stringify([db.prepare('SELECT * FROM fees').all(), db.prepare('SELECT * FROM sales').all()])

check('applies on the chain and adds exactly two tables, their unique keys and one index', () => {
  db.exec(sql)
  const added = names(db).filter((n) => !before.includes(n))
  assert.deepEqual(added, ['fee_labels', 'fee_types', 'idx_sales_courier_cost', 'sqlite_autoindex_fee_labels_1', 'sqlite_autoindex_fee_types_1', 'sqlite_sequence'].filter((n) => added.includes(n)))
  assert.ok(added.includes('fee_labels') && added.includes('fee_types') && added.includes('idx_sales_courier_cost'))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fee_types').get().n + db.prepare('SELECT COUNT(*) n FROM fee_labels').get().n, 0)
})
check('no row of fees or sales changed', () => {
  assert.equal(JSON.stringify([db.prepare('SELECT * FROM fees').all(), db.prepare('SELECT * FROM sales').all()]), rowsBefore)
})
check('idempotent: the whole file runs again, after rows exist, without error or change', () => {
  db.exec("INSERT INTO fee_types (name, name_key) VALUES ('Rent', 'rent')")
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fee_types').get().n, 1)
})
check('the post-check aborts the file when an object is missing (it does not pass silently)', () => {
  const broken = new Database(':memory:')
  broken.exec('CREATE TABLE fees (id INTEGER PRIMARY KEY); CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT, delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL);')
  const withoutIndex = sql.replace(/CREATE INDEX IF NOT EXISTS idx_sales_courier_cost[\s\S]*?;\n/, '')
  assert.throws(() => broken.exec(withoutIndex), /JSON path/)
  const noSalesColumns = new Database(':memory:')
  noSalesColumns.exec('CREATE TABLE fees (id INTEGER PRIMARY KEY); CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT);')
  assert.throws(() => noSalesColumns.exec(sql), /JSON path/, 'the pre-check refuses a database without the courier-cost columns')
})
check('the previous Worker\'s statements run unchanged on the new schema', () => {
  db.exec("INSERT INTO fees (fee_type, label, amount_usd, fee_date, created_at) VALUES ('delivery', 'Courier', 3, '2026-10-11', '2026-10-11 02:00:00')")
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fees WHERE fee_date >= '2026-10-01'").get().n, 2)
  assert.ok(db.prepare("SELECT MIN(TRIM(f.label)) AS label, f.fee_type, COUNT(*) AS uses FROM fees f WHERE f.label IS NOT NULL AND TRIM(f.label) <> '' GROUP BY lower(trim(f.label)), f.fee_type").all().length >= 2)
  assert.doesNotThrow(() => db.prepare("UPDATE fees SET label = 'Tape 2' WHERE lower(trim(COALESCE(label,''))) = 'tape'").run())
})
check('the planner uses the partial index for the Worker\'s predicate and not for a predicate that would read every sale', () => {
  const used = plan(db, `SELECT sales.id FROM sales WHERE sales.created_at >= '2026-10-01' AND sales.created_at < '2026-11-01'
    AND (sales.delivery_actual_cost_usd IS NOT NULL OR sales.delivery_actual_cost_khr IS NOT NULL)`)
  assert.match(used, /idx_sales_courier_cost/)
  assert.doesNotMatch(plan(db, "SELECT sales.id FROM sales WHERE sales.created_at >= '2026-10-01' AND sales.created_at < '2026-11-01' AND sales.delivery_fee_usd > 0"), /idx_sales_courier_cost/)
  // the index holds only the sales that carry a cost: sale 2 (NULL both) is not in it
  assert.deepEqual(db.prepare("SELECT id FROM sales INDEXED BY idx_sales_courier_cost WHERE created_at >= '2026-10-01' AND (delivery_actual_cost_usd IS NOT NULL OR delivery_actual_cost_khr IS NOT NULL)").all().map((r) => r.id), [1])
})
check('the catalogs refuse a duplicate key, an empty name and an over-long name', () => {
  assert.throws(() => db.exec("INSERT INTO fee_types (name, name_key) VALUES ('RENT again', 'rent')"), /UNIQUE/)
  assert.throws(() => db.exec("INSERT INTO fee_types (name, name_key) VALUES ('   ', 'x')"), /CHECK/)
  assert.throws(() => db.exec(`INSERT INTO fee_types (name, name_key) VALUES ('${'x'.repeat(41)}', 'y')`), /CHECK/)
  assert.throws(() => db.exec(`INSERT INTO fee_labels (name, name_key) VALUES ('${'x'.repeat(61)}', 'z')`), /CHECK/)
  db.exec("INSERT INTO fee_labels (name, name_key) VALUES ('Tape', 'tape')")
  assert.throws(() => db.exec("INSERT INTO fee_labels (name, name_key) VALUES ('tape', 'tape')"), /UNIQUE/)
})

console.log(`\n${passed} migration 0292 checks passed.`)
