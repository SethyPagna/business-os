'use strict'
// Pins migration 0271 (sale payment events, lane 6.0.972 slice S1) on the REAL chain of every earlier migration:
// schema only (every sales and sale_items row byte-identical), the two new columns default to "no events, rung at
// checkout", the ledger refuses malformed events, UPDATE always aborts, DELETE aborts outside the restore flag and
// passes inside it, an insert bumps sale_write_revisions, the PRE bound and the POST assertion fire (proven by
// mutating the file), a second apply aborts, and the documented RECOVERY restores the old schema.
//
// Run: node scripts/test-migration-0271-sale-payment-events-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0271_sale_payment_events.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const abortName = error => (String(error.message).match(/sale_payment_events_0271_[a-z]+/) || [''])[0]

function seed(db) {
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  const rows = [['completed', 10], ['awaiting_payment', 12.5], ['cancelled', 9]]
  for (const [index, [status, total]] of rows.entries()) {
    db.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd,amount_paid_usd) VALUES(?,?,1,?,?,?)`)
      .run(`R-${index}`, `seed-${index}`, status, total, index === 1 ? 3 : total)
  }
}
const withoutNew = db => ({
  sales: db.prepare('SELECT * FROM sales ORDER BY id').all().map(({ payments_version, ...row }) => row),
  sale_items: db.prepare('SELECT * FROM sale_items ORDER BY id').all().map(({ added_operation_id, ...row }) => row),
})
const event = (overrides = {}) => ({
  event_id: 'e-1', sale_id: 1, direction: 'in', origin: 'checkout', payment_method: 'Cash',
  payment_details: '[{"method":"Cash","amount_usd":10,"amount_khr":0}]', amount_paid_usd: 10, amount_paid_khr: 0,
  exchange_rate: 4000, received_at: '2026-10-24 02:00:00', ...overrides,
})
// system_flags writes sit behind the 0243 stock permit; the maintenance flag is not stock, so the permit is only borrowed.
function setMode(db, mode) {
  db.exec("INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  if (mode) db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode }))
  db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
}
function insertEvent(db, overrides) {
  const e = event(overrides)
  const cols = Object.keys(e)
  db.prepare(`INSERT INTO sale_payment_events(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => e[c]))
}

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('PRE/POST: row counts and every existing column of every sales and sale_items row are identical; the new columns read "no events"', () => {
  const db = new Database(schema)
  seed(db)
  for (const [sale, name, quantity] of [[1, 'Line A', 1], [1, 'Line B', 2], [2, 'Line C', 3]]) db.prepare('INSERT INTO sale_items(sale_id,product_name,quantity) VALUES(?,?,?)').run(sale, name, quantity)
  const before = withoutNew(db)
  db.exec(sql)
  assert.equal(before.sale_items.length, 3, 'control: the fixture really has sale_items rows to compare')
  assert.deepEqual(withoutNew(db), before)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_items WHERE added_operation_id IS NOT NULL').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales WHERE payments_version <> 0').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_payment_events').get().n, 0)
  db.prepare("INSERT INTO sale_items(sale_id,product_name,quantity) VALUES(1,'P',1)").run()
  assert.equal(db.prepare('SELECT added_operation_id v FROM sale_items ORDER BY id DESC').get().v, null)
  db.close()
})

check('payments_version refuses anything but 0 or 1; a sale written by the old Worker reads version 0', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  assert.throws(() => db.prepare('UPDATE sales SET payments_version = 2 WHERE id = 1').run(), /CHECK/)
  assert.throws(() => db.prepare('UPDATE sales SET payments_version = NULL WHERE id = 1').run(), /NOT NULL/)
  db.prepare("INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd) VALUES('R-old','old',1,'completed',5)").run()
  assert.equal(db.prepare("SELECT payments_version v FROM sales WHERE receipt_number = 'R-old'").get().v, 0)
  db.prepare('UPDATE sales SET payments_version = 1 WHERE id = 1').run()
  db.close()
})

check('the ledger accepts a well formed event and refuses each malformed one', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  insertEvent(db)
  const refused = (overrides, pattern) => assert.throws(() => insertEvent(db, { event_id: `x-${Math.random()}`, ...overrides }), pattern)
  refused({ direction: 'sideways' }, /CHECK/)
  refused({ origin: 'gift' }, /CHECK/)
  refused({ payment_details: 'not json' }, /CHECK/)
  refused({ payment_details: '{"a":1}' }, /CHECK/)
  refused({ amount_paid_usd: -1 }, /CHECK/)
  refused({ amount_paid_khr: -1 }, /CHECK/)
  refused({ exchange_rate: 0 }, /CHECK/)
  refused({ drawer_effect: 2 }, /CHECK/)
  refused({ note: 'x'.repeat(501) }, /CHECK/)
  refused({ payment_method: null }, /NOT NULL/)
  assert.throws(() => insertEvent(db), /UNIQUE/, 'event_id is unique, so the opening event cannot be written twice')
  for (const origin of ['checkout', 'opening', 'added', 'collect', 'late_record', 'undo', 'redo', 'correction']) insertEvent(db, { event_id: `o-${origin}`, origin, direction: origin === 'undo' ? 'out' : 'in' })
  db.close()
})

check('append-only: UPDATE always aborts; DELETE aborts outside the restore flag and passes inside it', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  insertEvent(db)
  assert.throws(() => db.prepare("UPDATE sale_payment_events SET note = 'x'").run(), /append-only/)
  assert.throws(() => db.prepare('DELETE FROM sale_payment_events').run(), /immutable/)
  setMode(db, 'other')
  assert.throws(() => db.prepare('DELETE FROM sale_payment_events').run(), /immutable/, 'a different maintenance mode is not a restore')
  setMode(db, 'restore')
  assert.throws(() => db.prepare("UPDATE sale_payment_events SET note = 'x'").run(), /append-only/, 'even a restore never rewrites an event')
  db.prepare('DELETE FROM sale_payment_events').run()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_payment_events').get().n, 0)
  db.close()
})

check('an insert bumps the sale write revision once, and not during a restore', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  const revision = () => (db.prepare('SELECT revision r FROM sale_write_revisions WHERE sale_id = 2').get() || { r: 0 }).r
  const start = revision()
  insertEvent(db, { sale_id: 2, event_id: 'r-1' })
  assert.equal(revision(), start + 1)
  insertEvent(db, { sale_id: 2, event_id: 'r-2' })
  assert.equal(revision(), start + 2)
  setMode(db, 'restore')
  insertEvent(db, { sale_id: 2, event_id: 'r-3' })
  assert.equal(revision(), start + 2)
  db.close()
})

check('the ledger has no foreign key to sales, so the admin data reset is not blocked by it', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_foreign_key_list('sale_payment_events')").get().n, 0)
  db.close()
})

check('both indexes serve their reads', () => {
  const db = new Database(schema)
  db.exec(sql)
  const plan = query => db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map(row => row.detail).join(' | ')
  assert.match(plan('SELECT * FROM sale_payment_events WHERE sale_id = 1 ORDER BY id'), /idx_sale_payment_events_sale/)
  assert.match(plan("SELECT * FROM sale_payment_events WHERE received_at >= 'a' AND received_at < 'b' AND branch_id = 1"), /idx_sale_payment_events_received/)
  db.close()
})

check('a second apply aborts on the PRE bound (and the PRE bound fires for each of its three conditions)', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.throws(() => db.exec(sql), error => abortName(error) === 'sale_payment_events_0271_pre')
  db.close()
  for (const [label, stmt] of [
    ['sales column present', 'ALTER TABLE sales ADD COLUMN payments_version INTEGER'],
    ['sale_items column present', 'ALTER TABLE sale_items ADD COLUMN added_operation_id TEXT'],
    ['table present', 'CREATE TABLE sale_payment_events (id INTEGER)'],
  ]) {
    const half = new Database(schema)
    half.exec(stmt)
    assert.throws(() => half.exec(sql), error => abortName(error) === 'sale_payment_events_0271_pre', label)
    half.close()
  }
})

check('the POST assertion fires when the file is mutated to leave a trigger out', () => {
  const mutated = sql.replace(/CREATE TRIGGER sale_revision_sale_payment_events_insert[\s\S]*?\nEND;\n/, '')
  assert.notEqual(mutated, sql)
  const db = new Database(schema)
  assert.throws(() => db.exec(mutated), error => abortName(error) === 'sale_payment_events_0271_post')
  db.close()
})

check('the documented RECOVERY returns the schema to the pre-0271 shape', () => {
  const db = new Database(schema)
  seed(db)
  const columnsBefore = table => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(row => row.name)
  const salesBefore = columnsBefore('sales')
  const itemsBefore = columnsBefore('sale_items')
  db.exec(sql)
  const recovery = sql.split('\n').filter(line => /^--   (DROP|ALTER)/.test(line)).map(line => line.replace(/^--   /, '').replace(/--.*$/, '').trim()).join('\n')
  assert.match(recovery, /DROP TABLE IF EXISTS sale_payment_events/)
  db.exec(recovery)
  assert.deepEqual(columnsBefore('sales'), salesBefore)
  assert.deepEqual(columnsBefore('sale_items'), itemsBefore)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%sale_payment_events%'").get().n, 0)
  db.close()
})

console.log(`\n${passed} checks passed`)
