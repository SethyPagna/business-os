'use strict'
// Pins migration 0300 (partial index on sales.delivery_contact_id) on the REAL migration chain:
//   - it adds exactly one index and changes no table or row (sales, fees, delivery_contacts);
//   - the PRE check aborts when the column is missing or the index already exists, and the POST check aborts when the index is not the partial one;
//   - the planner SEARCHes sales by it for the exact usage read and in-batch guard the delete issues (lifted from lib/contactDeleteGuard.ts), and for the
//     plain equality the rename count and the merge repoint use, and NOT before the migration (SCAN);
//   - a sale with no delivery person is not in the index (it is partial);
//   - the file is LF-only.
//
// Run (from cloudflare/): node scripts/test-migration-0300-sales-delivery-contact-index-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0300_sales_delivery_contact_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'migration SQL is LF-only')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => ({ ...r }))
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }))
const plan = (db, statement, ...params) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...params).map((r) => r.detail).join(' | ')

// The statements the delete issues, lifted from the source so a reworded one is caught.
const guardSource = fs.readFileSync(path.join(__dirname, '../src/lib/contactDeleteGuard.ts'), 'utf8').replace(/\r\n/g, '\n')
const between = (from, to, start = 0) => { const a = guardSource.indexOf(from, start); return guardSource.slice(a + from.length, guardSource.indexOf(to, a + from.length)) }
const usageSql = between('db.prepare(`', '`)').replace(/@ids/g, '?')
const named = between('const named = `', '`')
const guardSql = between("sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM sales WHERE ${named})", '`').replace(/^/, 'SELECT CASE WHEN EXISTS (SELECT 1 FROM sales WHERE ' + named + ')').replace(/\$\{named\}/g, named).replace(/\$\{[A-Z_]+\}/g, 'x').replace(/@ids/g, '?')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const db = chain()
db.exec("INSERT INTO delivery_contacts(id,name) VALUES (1,'A'),(2,'B')")
db.exec("INSERT INTO sales(id,created_at,delivery_contact_id) VALUES (1,'2026-11-01 01:00:00',1),(2,'2026-11-01 02:00:00',NULL),(3,'2026-11-01 03:00:00',2)")
db.exec("INSERT INTO fees(fee_type,label,amount_usd,fee_date,delivery_contact_id) VALUES ('delivery','x',2,'2026-11-01',1)")
const before = objects(db)
const rowsBefore = JSON.stringify(['sales', 'fees', 'delivery_contacts'].map((t) => dump(db, t)))

check('before the migration the usage read SCANs sales (the cost this fixes)', () => {
  assert.match(plan(db, usageSql, '[1]', '[1]'), /SCAN sales/)
})
check('applies and adds exactly one index; no row of sales, fees or delivery_contacts changes', () => {
  db.exec(sql)
  const added = objects(db).filter((r) => !before.some((b) => b.name === r.name))
  assert.deepEqual(added, [{ type: 'index', name: 'idx_sales_delivery_contact' }])
  assert.equal(JSON.stringify(['sales', 'fees', 'delivery_contacts'].map((t) => dump(db, t))), rowsBefore)
})
check('the usage read and the in-batch guard SEARCH sales by the partial index', () => {
  assert.match(plan(db, usageSql, '[1]', '[1]'), /SEARCH sales USING (COVERING )?INDEX idx_sales_delivery_contact/)
  assert.doesNotMatch(plan(db, usageSql, '[1]', '[1]'), /SCAN sales/)
  assert.match(plan(db, guardSql, '[1]', '[1]'), /SEARCH sales USING (COVERING )?INDEX idx_sales_delivery_contact/)
  assert.doesNotMatch(plan(db, guardSql, '[1]', '[1]'), /SCAN sales/)
})
check('the rename-impact count and the merge repoint (plain equality) use it too', () => {
  assert.match(plan(db, 'SELECT COUNT(*) AS n FROM sales WHERE delivery_contact_id = ?', 1), /idx_sales_delivery_contact/)
  assert.match(plan(db, 'UPDATE sales SET delivery_contact_id = ?, delivery_contact_name = ? WHERE delivery_contact_id = ?', 2, 'B', 1), /idx_sales_delivery_contact/)
})
check('the index is partial: a sale with no delivery person has no entry, and answers stay identical', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='idx_sales_delivery_contact' AND sql LIKE '%WHERE delivery_contact_id IS NOT NULL%'").get().n, 1)
  assert.deepEqual(db.prepare(usageSql).all('[1,2]', '[1,2]').map((r) => ({ ...r })).sort((a, b) => a.contact_id - b.contact_id || a.kind.localeCompare(b.kind)),
    [{ contact_id: 1, kind: 'fees', n: 1 }, { contact_id: 1, kind: 'sales', n: 1 }, { contact_id: 2, kind: 'sales', n: 1 }])
})
check('PRE aborts when the index already exists (a second run), POST aborts on a non-partial index', () => {
  assert.throws(() => db.exec(sql), /0300_pre|malformed JSON|JSON path/i)
  const plain = chain()
  const mutated = sql.replace(' WHERE delivery_contact_id IS NOT NULL;', ';')
  assert.notEqual(mutated, sql)
  assert.throws(() => plain.exec(mutated), /0300_post|malformed JSON|JSON path/i)
})
check('PRE aborts when the column is missing', () => {
  const bare = new DatabaseSync(':memory:')
  bare.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY)')
  assert.throws(() => bare.exec(sql), /0300_pre|malformed JSON|JSON path/i)
})
console.log(`${passed} checks passed.`)
