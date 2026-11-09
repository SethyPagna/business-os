'use strict'
// Pins migration 0294 (inventory_check_lot_lines) on the REAL migration chain: a new rowid table only, the PRE/POST assertions fire, the three 0259 tables are byte-for-byte
// unchanged, and the table's own rules hold (scope and batch id agree, quantities are not negative, a line belongs to an item, a line never changes, delete only while the
// restore maintenance flag is set), and the table is in BACKUP_TABLES.
//
// Run: node scripts/test-migration-0294-inventory-check-lot-lines-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0294_inventory_check_lot_lines.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'trigger and migration SQL is LF-only')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }

let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const T = 'inventory_check_lot_lines'
const HISTORY = ['inventory_check_sessions', 'inventory_check_items', 'inventory_check_events', 'inventory_check_approvals']
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))
const objects = db => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => ({ ...row }))

function seed(db) {
  db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES('s1',1,1,7,'t','closed','{}','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z')")
  db.exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_at) VALUES('s1',5,1,'{}',11,'{}','issue',10,'Count differs from stock','2026-11-02T01:00:00Z')")
}
const line = (db, extra = {}) => {
  const row = { session_id: 's1', product_id: 5, branch_id: 1, batch_id: 7, scope: 'lot', seen_quantity: 11, counted_quantity: 10, seen_source: 'screen', created_at: '2026-11-02T01:00:00Z', ...extra }
  const keys = Object.keys(row)
  return db.prepare(`INSERT INTO ${T}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]))
}

check('the table is new: one rowid table, one index and two triggers, no history row changes', () => {
  const db = chain(); seed(db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(T).n, 0, 'absent before')
  const before = Object.fromEntries(HISTORY.map(table => [table, dump(db, table)]))
  const beforeObjects = objects(db)
  db.exec(sql)
  for (const table of HISTORY) assert.deepEqual(dump(db, table), before[table], `${table} unchanged`)
  const added = objects(db).filter(row => !beforeObjects.some(old => old.name === row.name))
  assert.deepEqual(added, [
    { type: 'table', name: T },
    { type: 'trigger', name: 'inventory_check_lot_lines_no_delete' },
    { type: 'trigger', name: 'inventory_check_lot_lines_no_update' },
    { type: 'index', name: 'inventory_check_lot_lines_product' },
  ].sort((a, b) => a.name.localeCompare(b.name)), 'exactly the table, its index and its two triggers')
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${T}`).get().n, 0, 'no row is created by the migration')
  assert.doesNotThrow(() => db.prepare(`SELECT rowid FROM ${T}`).all(), 'a rowid table: backup and restore read rowids')
  assert.ok(!/WITHOUT ROWID/i.test(sql.replace(/--[^\n]*/g, '')), 'never WITHOUT ROWID')
})

check('the PRE assertion aborts a second run and a database without the 0259 tables', () => {
  const db = chain(); db.exec(sql)
  assert.throws(() => db.exec(sql), /inventory_check_lot_lines_0294_pre|already exists/)
  const bare = new DatabaseSync(':memory:')
  assert.throws(() => bare.exec(sql), /inventory_check_lot_lines_0294_pre/)
  assert.equal(bare.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(T).n, 0, 'nothing created on a failed PRE')
})

check('scope and batch id agree, quantities are not negative, the source is one of two, and a line belongs to an item', () => {
  const db = chain(); seed(db); db.exec(sql)
  assert.doesNotThrow(() => line(db), 'a received-date line')
  assert.doesNotThrow(() => line(db, { batch_id: 0, scope: 'branch', seen_quantity: 11 }), 'the branch-total line of the same product')
  assert.throws(() => line(db, { batch_id: 0, scope: 'lot' }), /CHECK|constraint/i, 'a lot line names a received date')
  assert.throws(() => line(db, { batch_id: 9, scope: 'branch' }), /CHECK|constraint/i, 'a branch line is batch 0')
  assert.throws(() => line(db, { batch_id: 8, counted_quantity: -1 }), /CHECK|constraint/i, 'a count is not negative')
  assert.throws(() => line(db, { batch_id: 8, seen_quantity: -1 }), /CHECK|constraint/i, 'the seen figure is not negative')
  assert.doesNotThrow(() => line(db, { batch_id: 8, seen_quantity: null, seen_source: 'write' }), 'a figure recorded at write may be null only as the writer decides (the column allows it)')
  assert.throws(() => line(db, { batch_id: 9, seen_source: 'guess' }), /CHECK|constraint/i, 'the source is screen or write')
  assert.throws(() => line(db, { batch_id: 7 }), /UNIQUE|PRIMARY|constraint/i, 'one line per received date')
  assert.throws(() => line(db, { batch_id: 10, product_id: 99 }), /FOREIGN KEY|constraint/i, 'a line belongs to an item of the session')
  assert.throws(() => line(db, { batch_id: 10, branch_id: 2 }), /FOREIGN KEY|constraint/i, 'and of the same branch')
})

check('a line never changes; delete only while the restore maintenance flag is set', () => {
  const db = chain(); seed(db); db.exec(sql); line(db)
  assert.throws(() => db.prepare(`UPDATE ${T} SET counted_quantity=1`).run(), /inventory_check_lot_line_immutable/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET seen_quantity=1`).run(), /inventory_check_lot_line_immutable/)
  assert.throws(() => db.prepare(`DELETE FROM ${T}`).run(), /inventory_check_lot_line_immutable/)
  db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'").run()
  db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode: 'restore', token: 't' }))
  assert.doesNotThrow(() => db.prepare(`DELETE FROM ${T}`).run(), 'a restore may replace the table')
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${T}`).get().n, 0)
})

check('the table is in BACKUP_TABLES after its parent (a restore replaces parents first)', () => {
  const backup = fs.readFileSync(path.join(__dirname, '../src/lib/backup.ts'), 'utf8')
  const list = backup.slice(backup.indexOf('inventory_check_sessions'))
  const order = ['inventory_check_items', 'inventory_check_approvals', T].map(name => list.indexOf(`'${name}'`))
  assert.ok(order.every(position => position > 0), 'all named in the backup list')
  assert.ok(order[2] > order[0], 'after inventory_check_items, which it references')
})

console.log(`PASS test-migration-0294-inventory-check-lot-lines-native: ${passed} checks`)
