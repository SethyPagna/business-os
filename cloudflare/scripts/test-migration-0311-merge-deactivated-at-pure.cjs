'use strict'
// Pins migration 0311 (product_batches.merge_deactivated_at) on the REAL migration chain:
//   - the file is LF-only, numbered 0311 once, adds exactly one nullable TEXT column, keeps rowid, carries PRE / POST /
//     RECOVERY notes and states the backfill decision;
//   - a lot that exists before the migration is unchanged by it (the marker is NULL: nothing is reinterpreted);
//   - it splits into the single ALTER statement the D1 runner will execute, and a second run aborts (append-only).
//
// Run (from cloudflare/): node scripts/test-migration-0311-merge-deactivated-at-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0311_product_batches_merge_deactivated_at.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const earlier = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
function chain() {
  const db = new DatabaseSync(':memory:')
  for (const f of earlier) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
  return db
}
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }
const columns = (db) => db.prepare("SELECT name,type,\"notnull\" AS not_null,dflt_value FROM pragma_table_info('product_batches')").all().map((r) => ({ ...r }))

check('the file is LF-only, numbered 0311 once, keeps rowid, and carries PRE / POST / RECOVERY / BACKFILL notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  for (const word of ['PRE-ASSERTION', 'POST-ASSERTION', 'RECOVERY', 'BACKFILL DECISION']) assert.ok(sql.includes(word), word)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0311_')), [migration])
  const statements = sql.replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  assert.deepEqual(statements, ['ALTER TABLE product_batches ADD COLUMN merge_deactivated_at TEXT', 'ALTER TABLE product_batches ADD COLUMN merge_payable_moved INTEGER'])
})

check('it adds exactly two nullable columns and leaves every existing lot unmarked and unchanged', () => {
  const db = chain()
  const before = columns(db)
  assert.equal(before.some((c) => c.name === 'merge_deactivated_at'), false, 'PRE-ASSERTION: the column does not exist yet')
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  db.exec("INSERT INTO products(id,name,is_active) VALUES(1,'P',1)")
  db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,payment_status,credit_due_date) VALUES(5,1,'k',0,'credit','2026-12-01')")
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  const row = () => ({ ...db.prepare('SELECT id,variant_product_id,batch_key,is_active,payment_status,credit_due_date FROM product_batches WHERE id=5').get() })
  const lotBefore = row()
  db.exec(sql)
  const after = columns(db)
  assert.deepEqual(after.filter((c) => !before.some((b) => b.name === c.name)), [{ name: 'merge_deactivated_at', type: 'TEXT', not_null: 0, dflt_value: null }, { name: 'merge_payable_moved', type: 'INTEGER', not_null: 0, dflt_value: null }])
  assert.deepEqual(after.filter((c) => before.some((b) => b.name === c.name)), before, 'no existing column changed')
  assert.deepEqual(row(), lotBefore, 'the existing lot is unchanged')
  assert.equal(db.prepare('SELECT merge_deactivated_at AS m FROM product_batches WHERE id=5').get().m, null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_batches WHERE merge_deactivated_at IS NOT NULL OR merge_payable_moved IS NOT NULL').get().n, 0, 'POST-ASSERTION: nothing marked')
  assert.equal(db.prepare('SELECT rowid AS r FROM product_batches WHERE id=5').get().r, 5, 'still a rowid table')
})

check('append-only: a second run aborts', () => {
  const db = chain()
  db.exec(sql)
  assert.throws(() => db.exec(sql), /duplicate column/i)
})

console.log(`${passed} passed`)
