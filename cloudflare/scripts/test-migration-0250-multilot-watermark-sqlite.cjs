const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// Pins migration 0250 (the multi-lot Revert watermark) on the REAL migration chain: it stores the highest
// inventory_movements.id that exists at apply time, once, as text, in system_flags, and changes nothing else.
//
// Run: node scripts/test-migration-0250-multilot-watermark-sqlite.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0250_multilot_revert_watermark.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const KEY = 'multilot_revert_watermark'
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const flag = db => db.prepare('SELECT value, typeof(value) AS kind FROM system_flags WHERE key = ?').get(KEY)
const addMovements = (db, count) => { for (let i = 0; i < count; i++) db.prepare("INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason) VALUES(1,1,'remove',1,'seed')").run() }
const everything = db => ['inventory_movements', 'branch_stock', 'product_batches', 'dated_stock_count_batch_actions', 'settings', 'system_flags']
  .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})
check('PRE: no row before the migration', () => {
  const db = new Database(schema)
  assert.equal(flag(db), undefined)
  db.close()
})
check('POST: the row holds the highest movement id at apply time, as text', () => {
  const db = new Database(schema)
  addMovements(db, 7)
  db.prepare('DELETE FROM inventory_movements WHERE id IN (2, 5)').run()
  const highest = db.prepare('SELECT MAX(id) AS m FROM inventory_movements').get().m
  assert.equal(highest, 7)
  db.exec(sql)
  assert.deepEqual(flag(db), { value: '7', kind: 'text' })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE id > CAST((SELECT value FROM system_flags WHERE key = ?) AS INTEGER)').get(KEY).n, 0)
  db.close()
})
check('an empty movements table stores 0, and every later movement is above it', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.deepEqual(flag(db), { value: '0', kind: 'text' })
  addMovements(db, 1)
  assert.ok(db.prepare('SELECT MIN(id) AS m FROM inventory_movements').get().m > Number(flag(db).value))
  db.close()
})
check('movements written after the migration stay above the mark, even when older ones are deleted', () => {
  const db = new Database(schema)
  addMovements(db, 4)
  db.exec(sql)
  db.prepare('DELETE FROM inventory_movements').run()
  addMovements(db, 2)
  assert.deepEqual(db.prepare('SELECT id FROM inventory_movements ORDER BY id').all().map(row => row.id), [5, 6])
  db.close()
})
check('applying it twice, or over a hand-written row, changes nothing', () => {
  const db = new Database(schema)
  addMovements(db, 3)
  db.exec(sql)
  addMovements(db, 2)
  db.exec(sql)
  assert.equal(flag(db).value, '3')
  const other = new Database(schema)
  other.prepare("INSERT INTO system_flags(key, value) VALUES(?, '41')").run(KEY)
  addMovements(other, 9)
  other.exec(sql)
  assert.equal(flag(other).value, '41')
  db.close()
  other.close()
})
check('it changes no business row and no other flag', () => {
  const db = new Database(schema)
  addMovements(db, 3)
  seedStockFixture(db, () => db.prepare("INSERT INTO system_flags(key, value) VALUES('maintenance', '{}')").run())
  assert.equal(db.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, '{}')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  const before = everything(db).filter((_, i) => i < 5)
  const flagsBefore = db.prepare('SELECT key, value FROM system_flags ORDER BY key').all()
  db.exec(sql)
  assert.deepEqual(everything(db).filter((_, i) => i < 5), before)
  assert.deepEqual(db.prepare('SELECT key, value FROM system_flags WHERE key <> ? ORDER BY key').all(KEY), flagsBefore)
  db.close()
})
check('control: a statement without the highest-id read would not pass these checks', () => {
  const db = new Database(schema)
  addMovements(db, 5)
  db.exec(sql.replace('CAST(COALESCE(MAX(id), 0) AS TEXT)', "'0'"))
  assert.notEqual(flag(db).value, '5')
  db.close()
})
console.log(`${passed} checks passed`)
