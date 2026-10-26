'use strict'
// Pins migration 0273 (Conflicts marks, indexes and the old-zero watermark, lane 6.0.988) on the REAL chain of every earlier migration:
// the watermark is the highest products.id as text, no business row (products, lots, stock, damaged lots) changes, the marks table
// refuses an unknown mark and a duplicate, the PRE assertion fires on a second apply and on any pre-existing object, the POST assertion
// fires when the file is mutated to skip an index, the documented RECOVERY restores the old schema, and the barcode indexes use the
// same blank-character list as JavaScript trim().
//
// Run: node scripts/test-migration-0273-conflict-marks-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0273_conflict_marks_and_indexes.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

const OBJECTS = ['product_conflict_marks', 'idx_products_unknown_cost', 'idx_product_batches_unknown_cost', 'idx_damaged_lots_unknown_cost',
  'idx_products_zero_cost', 'idx_products_empty_barcode', 'idx_products_placeholder_barcode']
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const abortName = error => (/bad JSON path: '\$\[(\w+)\]'/.exec(String(error.message)) || [])[1]
const present = db => db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${OBJECTS.map(() => '?').join(',')}) ORDER BY name`).all(...OBJECTS).map(r => r.name)

function seeded() {
  const db = new Database(schema)
  seedStockFixture(db, () => {
    const add = db.prepare('INSERT INTO products(id, name, barcode, cost_price_usd, is_active) VALUES (?,?,?,?,?)')
    add.run(1, 'Unknown cost', '8850000000011', null, 1)
    add.run(2, 'Old zero', '0', 0, 1)
    add.run(41, 'Highest', '', 3, 1)
    db.prepare("INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (1, 'k1', 1, NULL, '2026-10-01')").run()
  })
  return db
}
const business = db => ({
  products: db.prepare('SELECT * FROM products ORDER BY id').all(),
  lots: db.prepare('SELECT * FROM product_batches ORDER BY id').all(),
  stock: db.prepare('SELECT * FROM branch_batch_stock ORDER BY id').all(),
  damaged: db.prepare('SELECT * FROM damaged_stock_lots ORDER BY id').all(),
})

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('applying it stores the highest product id as the watermark and leaves every business row byte-identical', () => {
  const db = seeded()
  const before = business(db)
  assert.equal(before.products.length, 3, 'control: the fixture has products')
  assert.equal(before.lots.length, 1, 'control: the fixture has a lot')
  db.exec(sql)
  assert.deepEqual(business(db), before)
  assert.equal(db.prepare("SELECT value v FROM system_flags WHERE key = 'cost_zero_watermark'").get().v, '41')
  assert.deepEqual(present(db), [...OBJECTS].sort())
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_conflict_marks').get().n, 0)
  db.close()
})

check('an empty catalog stores the watermark 0', () => {
  const db = new Database(schema)
  db.exec(sql)
  assert.equal(db.prepare("SELECT value v FROM system_flags WHERE key = 'cost_zero_watermark'").get().v, '0')
  db.close()
})

check('the marks table refuses an unknown mark and a second mark of the same kind on one product', () => {
  const db = seeded()
  db.exec(sql)
  db.prepare("INSERT INTO product_conflict_marks(product_id, mark) VALUES (1, 'no_barcode')").run()
  db.prepare("INSERT INTO product_conflict_marks(product_id, mark) VALUES (1, 'zero_cost_confirmed')").run()
  assert.throws(() => db.prepare("INSERT INTO product_conflict_marks(product_id, mark) VALUES (1, 'no_barcode')").run(), /UNIQUE|PRIMARY/)
  assert.throws(() => db.prepare("INSERT INTO product_conflict_marks(product_id, mark) VALUES (2, 'dismissed')").run(), /CHECK/)
  db.close()
})

check('PRE: a second apply aborts, and so does any single pre-existing object or flag', () => {
  const twice = seeded()
  twice.exec(sql)
  assert.throws(() => twice.exec(sql), error => abortName(error) === 'conflict_marks_0273_pre')
  twice.close()
  for (const stub of ['CREATE INDEX idx_products_zero_cost ON products(id)', 'CREATE TABLE product_conflict_marks(x)', "INSERT INTO system_flags(key, value) VALUES ('cost_zero_watermark', '5')"]) {
    const db = seeded()
    db.exec(stub)
    assert.throws(() => db.exec(sql), error => abortName(error) === 'conflict_marks_0273_pre', stub)
    db.close()
  }
})

check('POST: a file that skips an index aborts at the POST assertion (proven by mutating the file)', () => {
  const db = seeded()
  const mutated = sql.replace(/CREATE INDEX idx_products_placeholder_barcode[^;]*;/, '')
  assert.notEqual(mutated, sql, 'control: the mutation removed the index')
  assert.throws(() => db.exec(mutated), error => abortName(error) === 'conflict_marks_0273_post')
  db.close()
})

check('RECOVERY: the documented drops restore the schema, and the file can then be applied again', () => {
  const db = seeded()
  db.exec(sql)
  for (const name of OBJECTS.filter(n => n.startsWith('idx_'))) db.exec(`DROP INDEX IF EXISTS ${name}`)
  db.exec('DROP TABLE IF EXISTS product_conflict_marks')
  db.exec("DELETE FROM system_flags WHERE key = 'cost_zero_watermark'")
  assert.deepEqual(present(db), [])
  db.exec(sql)
  assert.deepEqual(present(db), [...OBJECTS].sort())
  db.close()
})

check('the barcode indexes strip exactly the characters JavaScript trim() strips, and the Worker constant says the same', () => {
  const expected = []
  for (let cp = 0; cp <= 0xffff; cp++) if (String.fromCodePoint(cp).trim() === '') expected.push(cp)
  const inMigration = [...sql.matchAll(/char\(([\d,]+)\)/g)].map(m => m[1])
  assert.equal(inMigration.length, 3, 'two barcode indexes: one trim in the empty index, two in the placeholder index')
  for (const list of inMigration) assert.deepEqual(list.split(',').map(Number), expected)
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/productDataGaps.ts'), 'utf8')
  const constant = /JS_TRIM_CODE_POINTS = \[([\d, ]+)\] as const/.exec(source)
  assert.ok(constant, 'the constant is found')
  assert.deepEqual(constant[1].split(',').map(n => Number(n.trim())), expected)
})

console.log(`${passed} migration 0273 checks PASS`)
