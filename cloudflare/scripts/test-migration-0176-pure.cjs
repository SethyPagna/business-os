// Pins migration 0176 (allocation rows for the two pre-4a2ce71b replacement
// lines) on a SYNTHETIC fixture over the REAL migration chain.
//
// Run: node scripts/test-migration-0176-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0176_sale_replacement_line_allocation_repair.sql'), 'utf8')

function fresh() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const migration of loadAll()) db.exec(migration)
  return db
}

// [sale_item_id, sale_id, product_id, lot_id, movement quantity]
const LINES = [[40431, 16972, 5348, 56716, -1], [40506, 16927, 4684, 56575, -1]]

function seed(db, { movementFor = () => true, status = 'completed' } = {}) {
  db.prepare("INSERT INTO branches (id, name) VALUES (2, 'Shop')").run()
  for (const [item, sale, product, lot, mv] of LINES) {
    db.prepare('INSERT INTO products (id, name, stock_quantity) VALUES (?, ?, 5)').run(product, 'P' + product)
    db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, expiry_date, is_active) VALUES (?, ?, 'k' || ?, 'LOT' || ?, '2027-01-01', 1)").run(lot, product, String(lot), String(lot))
    db.prepare("INSERT INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id) VALUES (?, 'r' || ?, ?, 0, 2)").run(sale, String(sale), status)
    db.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, branch_id) VALUES (?, ?, ?, 1, 2)').run(item, sale, product)
    if (movementFor(item)) db.prepare("INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity, reference_id, batch_id) VALUES (?, 2, 'sale', ?, ?, ?)").run(product, mv, sale, lot)
  }
  // control: an unrelated completed line with its own row already
  db.prepare("INSERT INTO products (id, name) VALUES (77, 'control')").run()
  db.prepare("INSERT INTO sale_items (id, sale_id, product_id, quantity, branch_id) VALUES (40999, 16972, 77, 1, 2)").run()
  db.prepare('INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (900, 40999, 56716, 2, 1, 0)').run()
}

// full apply
const db = fresh()
seed(db)
db.exec(sql)
const rows = db.prepare('SELECT sale_item_id, batch_id, branch_id, quantity, released_quantity, released_at, lot_code, expiry_date FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506) ORDER BY sale_item_id').all()
assert.deepStrictEqual(rows, [
  { sale_item_id: 40431, batch_id: 56716, branch_id: 2, quantity: 1, released_quantity: 0, released_at: null, lot_code: 'LOT56716', expiry_date: '2027-01-01' },
  { sale_item_id: 40506, batch_id: 56575, branch_id: 2, quantity: 1, released_quantity: 0, released_at: null, lot_code: 'LOT56575', expiry_date: '2027-01-01' },
])
const audit = db.prepare("SELECT entity_id, record_id, details FROM audit_logs WHERE action = 'repair_replacement_line_allocation' ORDER BY entity_id").all()
assert.strictEqual(audit.length, 2)
assert.strictEqual(JSON.parse(audit[0].details).batch_id, 56716)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations WHERE id = ? AND sale_item_id = 40431').get(audit[0].record_id).c, 1, 'audit record_id points at the inserted row')
assert.strictEqual(db.prepare('SELECT quantity q FROM sale_item_batch_allocations WHERE id = 900').get().q, 1, 'control untouched')
// stock ledgers are not touched: the units already left when the sale was rung
assert.strictEqual(db.prepare('SELECT stock_quantity q FROM products WHERE id = 5348').get().q, 5)

// second run: no-op
db.exec(sql)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506)').get().c, 2)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'repair_replacement_line_allocation'").get().c, 2)

// a line whose movement is missing gets nothing (the guard is the movement, not the id)
const db2 = fresh()
seed(db2, { movementFor: (item) => item !== 40506 })
db2.exec(sql)
assert.deepStrictEqual(db2.prepare('SELECT sale_item_id FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506)').all().map((r) => r.sale_item_id), [40431])

// a sale that is not completed gets nothing
const db3 = fresh()
seed(db3, { status: 'cancelled' })
db3.exec(sql)
assert.strictEqual(db3.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506)').get().c, 0)

// empty database: no-op
const db4 = fresh()
db4.exec(sql)
assert.strictEqual(db4.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations').get().c, 0)

console.log('test-migration-0176-pure: ok (2 rows from the lines\' own movements, audit per row, control untouched, guards, idempotent)')
