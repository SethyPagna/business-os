'use strict'
// Pins migration 0275 (return refund corrections, lane 6.0.997 slice S2) on the REAL chain of every earlier migration:
// schema only (every returns row byte-identical), a normal rowid table (backup, export and reset paginate by rowid),
// the ledger refuses malformed rows, UPDATE always aborts, DELETE aborts outside the restore flag and passes inside it,
// an insert bumps return_write_revisions (not during a restore), both indexes serve their reads, a second apply aborts
// on the PRE bound, the POST assertion fires when the file is mutated, and the documented RECOVERY restores the old schema.
//
// Run: node scripts/test-migration-0275-return-refund-corrections-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0275_return_refund_corrections.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const abortName = error => (String(error.message).match(/return_refund_corrections_0275_[a-z]+/) || [''])[0]

function seed(db) {
  db.prepare("INSERT INTO branches(id,name) VALUES(1,'Shop')").run()
  for (let i = 1; i <= 2; i++) {
    db.prepare("INSERT INTO sales(receipt_number,client_request_id,branch_id,sale_status,total_usd,amount_paid_usd) VALUES(?,?,1,'completed',10,10)").run(`R-${i}`, `seed-${i}`)
    db.prepare("INSERT INTO returns(return_number,return_type,sale_id,branch_id,total_refund_usd,created_at) VALUES(?,?,?,1,4,'2026-10-20 03:00:00')").run(`RT-${i}`, 'customer', i)
  }
}
const returnsRows = db => db.prepare('SELECT * FROM returns ORDER BY id').all()
const row = (overrides = {}) => ({
  operation_id: 'op-1', return_id: 1, sale_id: 1, branch_id: 1, mode: 'today', counts_at: '2026-10-27 02:00:00',
  before_total_refund_usd: 4, after_total_refund_usd: 3, ...overrides,
})
function insertRow(db, overrides) {
  const r = row(overrides)
  const cols = Object.keys(r)
  return db.prepare(`INSERT INTO return_refund_corrections(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => r[c]))
}
// system_flags writes sit behind the 0243 stock permit; the maintenance flag is not stock, so the permit is only borrowed.
function setMode(db, mode) {
  db.exec("INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  if (mode) db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode }))
  db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
}
const revision = (db, id) => (db.prepare('SELECT revision r FROM return_write_revisions WHERE return_id = ?').get(id) || { r: 0 }).r

check('the file is LF-only, a normal rowid table, and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false, 'WITHOUT ROWID breaks backup/export/reset')
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('PRE/POST: every returns row is byte-identical and the ledger starts empty; rowid is selectable', () => {
  const db = new Database(schema)
  seed(db)
  const before = returnsRows(db)
  db.exec(sql)
  assert.equal(before.length, 2, 'control: the fixture really has returns rows')
  assert.deepEqual(returnsRows(db), before)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM return_refund_corrections').get().n, 0)
  insertRow(db)
  assert.equal(db.prepare('SELECT rowid r, id FROM return_refund_corrections').get().r, 1)
  assert.equal(db.prepare('SELECT MAX(rowid) m FROM return_refund_corrections').get().m, 1)
  db.close()
})

check('the ledger accepts a well formed row and refuses each malformed one', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  insertRow(db)
  const refused = (overrides, pattern) => assert.throws(() => insertRow(db, { operation_id: `x-${Math.random()}`, ...overrides }), pattern)
  refused({ mode: 'yesterday' }, /CHECK/)
  refused({ mode: null }, /NOT NULL/)
  refused({ kind: 'delete' }, /CHECK/)
  refused({ counts_at: '2026-10-27T02:00:00Z' }, /CHECK/)
  refused({ counts_at: '27 Oct 2026' }, /CHECK/)
  refused({ counts_at: null }, /NOT NULL/)
  refused({ before_total_refund_usd: -1 }, /CHECK/)
  refused({ after_total_refund_khr: -1 }, /CHECK/)
  refused({ after_owed_reduction_usd: -1 }, /CHECK/)
  refused({ after_refund_currency: 'EUR' }, /CHECK/)
  refused({ before_refund_currency: 'usd' }, /CHECK/)
  refused({ return_id: null }, /NOT NULL/)
  assert.throws(() => insertRow(db), /UNIQUE/, 'operation_id is unique, so a retried write cannot append twice')
  for (const kind of ['edit', 'cancel', 'restore']) for (const mode of ['today', 'original_day']) insertRow(db, { operation_id: `ok-${kind}-${mode}`, kind, mode, after_refund_currency: 'KHR', before_refund_currency: 'USD' })
  assert.equal(db.prepare("SELECT kind FROM return_refund_corrections WHERE operation_id = 'op-1'").get().kind, 'edit', 'kind defaults to edit')
  db.close()
})

check('append-only: UPDATE always aborts; DELETE aborts outside the restore flag and passes inside it', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  insertRow(db)
  assert.throws(() => db.prepare("UPDATE return_refund_corrections SET actor_name = 'x'").run(), /append-only/)
  assert.throws(() => db.prepare('DELETE FROM return_refund_corrections').run(), /immutable/)
  setMode(db, 'other')
  assert.throws(() => db.prepare('DELETE FROM return_refund_corrections').run(), /immutable/, 'a different maintenance mode is not a restore')
  setMode(db, 'restore')
  assert.throws(() => db.prepare("UPDATE return_refund_corrections SET actor_name = 'x'").run(), /append-only/, 'even a restore never rewrites a row')
  db.prepare('DELETE FROM return_refund_corrections').run()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM return_refund_corrections').get().n, 0)
  db.close()
})

check('an insert bumps the return write revision once per row, and not during a restore', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  const start = revision(db, 2)
  const other = revision(db, 1)
  insertRow(db, { return_id: 2, operation_id: 'r-1' })
  assert.equal(revision(db, 2), start + 1)
  insertRow(db, { return_id: 2, operation_id: 'r-2' })
  assert.equal(revision(db, 2), start + 2)
  assert.equal(revision(db, 1), other, 'another return is not bumped')
  setMode(db, 'restore')
  insertRow(db, { return_id: 2, operation_id: 'r-3' })
  assert.equal(revision(db, 2), start + 2)
  db.close()
})

check('the ledger has no foreign key, so the admin data reset is not blocked by it', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_foreign_key_list('return_refund_corrections')").get().n, 0)
  db.close()
})

check('both indexes serve their reads', () => {
  const db = new Database(schema)
  db.exec(sql)
  const plan = query => db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map(r => r.detail).join(' | ')
  assert.match(plan("SELECT * FROM return_refund_corrections WHERE counts_at >= 'a' AND counts_at < 'b'"), /idx_return_refund_corrections_counts/)
  assert.match(plan('SELECT * FROM return_refund_corrections WHERE return_id = 1 ORDER BY id'), /idx_return_refund_corrections_return/)
  db.close()
})

check('a second apply aborts on the PRE bound (and the PRE bound fires when the table is already there)', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.throws(() => db.exec(sql), error => abortName(error) === 'return_refund_corrections_0275_pre')
  db.close()
  const half = new Database(schema)
  half.exec('CREATE TABLE return_refund_corrections (id INTEGER)')
  assert.throws(() => half.exec(sql), error => abortName(error) === 'return_refund_corrections_0275_pre')
  half.close()
})

check('the POST assertion fires when the file is mutated to leave a trigger or an index out', () => {
  const noTrigger = sql.replace(/CREATE TRIGGER return_revision_return_refund_corrections_insert[\s\S]*?\nEND;\n/, '')
  assert.notEqual(noTrigger, sql)
  const noIndex = sql.replace(/CREATE INDEX idx_return_refund_corrections_return [^\n]*\n/, '')
  assert.notEqual(noIndex, sql)
  for (const mutated of [noTrigger, noIndex]) {
    const db = new Database(schema)
    assert.throws(() => db.exec(mutated), error => abortName(error) === 'return_refund_corrections_0275_post')
    db.close()
  }
})

check('the documented RECOVERY returns the schema to the pre-0275 shape', () => {
  const db = new Database(schema)
  seed(db)
  db.exec(sql)
  const recovery = sql.split('\n').filter(line => /^--   DROP/.test(line)).map(line => line.replace(/^--   /, '').replace(/--.*$/, '').trim()).join('\n')
  assert.match(recovery, /DROP TABLE IF EXISTS return_refund_corrections/)
  db.exec(recovery)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%return_refund_corrections%'").get().n, 0)
  assert.equal(returnsRows(db).length, 2)
  db.close()
})

console.log(`\n${passed} checks passed`)
