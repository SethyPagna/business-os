// Pins migration 0173 (Not Paid stock-hold repair for the 21 Sep 4 lines +
// allocation 264) against a SYNTHETIC fixture built on the REAL migration
// chain (better-sqlite3, no production data). The fixture reproduces every
// audited line with its lot so the migration's own "exactly 21 or nothing"
// guard is exercised, then re-executes the file and checks every ledger.
//
// Run: node scripts/test-migration-0173-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0173 = fs.readFileSync(path.join(migrationsDir, '0173_not_paid_stock_hold_repair.sql'), 'utf8')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)

// [sale_item_id, sale_id, product_id, qty, allocation_id, alloc_lot, deduct_lot, lot_qty_before, cost]
const LINES = [
  [40124, 16836, 4276, 1, 8, 51291, 51291, 11, 8],
  [40125, 16837, 4696, 1, 9, 52847, 52847, 4, 5.5],
  [40126, 16838, 2578, 1, 10, 52202, 52202, 3, 12],
  [40127, 16839, 3326, 1, 11, 52413, 52413, 1, 10],
  [40128, 16839, 7892, 1, 12, 52222, 52222, 2, 13.111112],
  [40129, 16839, 2578, 1, 13, 52202, 52202, 3, 12],
  [40130, 16839, 7878, 1, 14, 52209, 52209, 12, 12.131034],
  [40131, 16839, 4181, 1, 15, 52725, 52725, 9, 10.324761],
  [40202, 16870, 5210, 1, 30, 51430, 51430, 5, 28.5],
  [40203, 16871, 9162, 4, 31, 54851, 54851, 9, 7.996503],
  [40204, 16871, 4267, 3, 32, 54838, 54838, 21, 8],
  [40226, 16881, 5131, 1, 53, 55191, 55191, 1, 26.6],
  [40245, 16885, 4774, 1, 72, 55016, 55016, 2, 18],
  [40246, 16885, 9456, 1, 73, 55009, 55009, 10, 34.47222],
  [40247, 16885, 6706, 1, 74, 53477, 53477, 2, 32],
  [40248, 16885, 6796, 1, 75, 53577, 61114, 5, 43],
  [40249, 16885, 7157, 1, 76, 51909, 51909, 4, 32.785714],
  [40250, 16886, 9092, 1, 77, 52753, 52753, 5, 10.045723],
  [40251, 16886, 4232, 1, 78, 52757, 52757, 6, 9.777775],
  [40252, 16886, 4230, 1, 79, 52755, 52755, 13, 10.25],
  [40256, 16888, 5882, 1, 83, 55889, 55889, 5, 34.58],
]

db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Warehouse'), (2, 'Shop')").run()
const insProduct = db.prepare('INSERT OR IGNORE INTO products (id, name, stock_quantity, cost_price_usd) VALUES (?, ?, 0, ?)')
const insLot = db.prepare("INSERT OR IGNORE INTO product_batches (id, variant_product_id, batch_key, lot_code, is_active, unit_cost_usd) VALUES (?, ?, 'k' || ?, 'ADJ09/02/2026', 1, ?)")
const insBbs = db.prepare('INSERT OR IGNORE INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 2, ?)')
const insSale = db.prepare("INSERT OR IGNORE INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id, branch_name) VALUES (?, '20260904-' || ?, 'completed', 0, 2, 'Shop')")
const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, cost_price_usd, branch_id, batch_id) VALUES (?, ?, ?, ?, ?, ?, 2, ?)')
const insAlloc = db.prepare("INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, lot_code, released_at, created_at, released_quantity) VALUES (?, ?, ?, 2, ?, 'ADJ09/02/2026', '2026-09-04 02:25:44', '2026-09-04 02:25:44', ?)")

// Lot quantities at branch 2 as audited; 53577 is the empty lot behind line 40248.
const lotQty = new Map()
for (const [, , , , , allocLot, deductLot, before] of LINES) {
  lotQty.set(deductLot, before)
  if (allocLot !== deductLot) lotQty.set(allocLot, 0)
}
const productOf = new Map()
for (const [, , product, , , allocLot, deductLot, , cost] of LINES) {
  insProduct.run(product, 'P' + product, cost)
  productOf.set(allocLot, product)
  productOf.set(deductLot, product)
}
for (const [lot, qty] of lotQty) {
  const line = LINES.find((l) => l[5] === lot || l[6] === lot)
  insLot.run(lot, productOf.get(lot), lot, line[8])
  insBbs.run(lot, qty)
}
// Branch stock and product totals = sum of lots (production ledgers agreed).
for (const product of new Set(LINES.map((l) => l[2]))) {
  const total = db.prepare('SELECT COALESCE(SUM(b.quantity),0) q FROM branch_batch_stock b JOIN product_batches pb ON pb.id=b.batch_id WHERE pb.variant_product_id=?').get(product).q
  db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 2, ?)').run(product, total)
  db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').run(total, product)
}
for (const [item, sale, product, qty, alloc, allocLot, , , cost] of LINES) {
  insSale.run(sale, sale)
  insItem.run(item, sale, product, 'P' + product, qty, cost, allocLot)
  insAlloc.run(alloc, item, allocLot, qty, qty)
}

// Control lines that must NOT be touched: a cancelled Not Paid sale (16835)
// and a completed sale whose movement already exists (16877, old path).
db.prepare("INSERT INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id) VALUES (16835, 'c', 'cancelled', 0, 2), (16877, 'd', 'completed', 0, 2)").run()
db.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, cost_price_usd, branch_id) VALUES (40123, 16835, 4276, 'P4276', 1, 8, 2), (40210, 16877, 4276, 'P4276', 1, 8, 2)").run()
db.prepare("INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_at, released_quantity) VALUES (7, 40123, 51291, 2, 1, '2026-09-04', 1), (40, 40210, 51291, 2, 1, NULL, 0)").run()
db.prepare("INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity, reference_id) VALUES (4276, 2, 'sale', -1, 16877)").run()

// Allocation 264 (sale 16980 amended 1 -> 2, ledgers moved 2).
db.prepare("INSERT INTO products (id, name, stock_quantity) VALUES (5987, 'P5987', 1)").run()
db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (55971, 5987, 'k55971', 1, 13.1)").run()
db.prepare("INSERT INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id) VALUES (16980, 'e', 'awaiting_payment', 0, 2)").run()
db.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, branch_id) VALUES (40441, 16980, 5987, 'P5987', 2, 2)").run()
db.prepare('INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (264, 40441, 55971, 2, 1, 0)').run()
db.prepare("INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity, reference_id) VALUES (5987, 2, 'sale', -1, 16980), (5987, 2, 'sale', -1, 16980)").run()

const itemIds = LINES.map((l) => l[0]).join(',')
assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM sale_item_batch_allocations WHERE released_quantity = quantity AND released_at IS NOT NULL AND sale_item_id IN (${itemIds})`).get().c, 21)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=61114 AND branch_id=2').get().q, 5)

// -- Apply (the chain already ran the file once on the empty DB = no-op).
db.exec(sql0173)

assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_not_paid_repair_0173 WHERE applied = 1').get().c, 21, '21 lines applied')
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE user_name='migration:0173_not_paid_stock_hold_repair' AND movement_type='sale'").get().c, 21)
assert.strictEqual(db.prepare("SELECT SUM(quantity) s FROM inventory_movements WHERE user_name='migration:0173_not_paid_stock_hold_repair'").get().s, -26)
for (const [item, sale, product, qty, alloc, , deductLot, , cost] of LINES) {
  const a = db.prepare('SELECT batch_id, released_quantity, released_at, quantity FROM sale_item_batch_allocations WHERE id=?').get(alloc)
  assert.strictEqual(a.released_quantity, 0, `alloc ${alloc} held`)
  assert.strictEqual(a.released_at, null)
  assert.strictEqual(a.batch_id, deductLot, `alloc ${alloc} lot`)
  assert.strictEqual(a.quantity, qty)
  const m = db.prepare("SELECT quantity, unit_cost_usd, batch_id, branch_name FROM inventory_movements WHERE reference_id=? AND product_id=? AND user_name='migration:0173_not_paid_stock_hold_repair'").get(sale, product)
  assert.strictEqual(m.quantity, -qty, `movement ${item}`)
  assert.strictEqual(m.unit_cost_usd, cost)
  assert.strictEqual(m.batch_id, deductLot)
  assert.strictEqual(m.branch_name, 'Shop')
}
// Lot 52202 served two lines (40126 + 40129): 3 -> 1.
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=52202 AND branch_id=2').get().q, 1)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=61114 AND branch_id=2').get().q, 4)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=53577 AND branch_id=2').get().q, 0, 'empty lot untouched')
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=54851 AND branch_id=2').get().q, 5, '9 - 4')
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=2578 AND branch_id=2').get().q, 1)
assert.strictEqual(db.prepare('SELECT stock_quantity q FROM products WHERE id=2578').get().q, 1)
assert.strictEqual(db.prepare('SELECT lot_code l FROM sale_item_batch_allocations WHERE id=75').get().l, 'ADJ09/02/2026')
// Ledgers agree for every touched product.
assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.id IN (SELECT product_id FROM sale_not_paid_repair_0173)
  AND p.stock_quantity <> (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=p.id)`).get().c, 0)
assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.id IN (SELECT product_id FROM sale_not_paid_repair_0173)
  AND p.stock_quantity <> (SELECT COALESCE(SUM(b.quantity),0) FROM branch_batch_stock b JOIN product_batches pb ON pb.id=b.batch_id WHERE pb.variant_product_id=p.id)`).get().c, 0)
// Controls untouched.
assert.deepStrictEqual(db.prepare('SELECT released_quantity r, batch_id b FROM sale_item_batch_allocations WHERE id=7').get(), { r: 1, b: 51291 })
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE reference_id=16877 AND movement_type='sale'").get().c, 1)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=51291 AND branch_id=2').get().q, 10, 'only line 40124 hit lot 51291')
// Provenance.
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM action_history WHERE entity='sale_not_paid_stock_recovery' AND reversible=0 AND status='recorded' AND created_by_name='migration:0173_not_paid_stock_hold_repair'").get().c, 10)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='correct_awaiting_payment_stock_hold' AND user_name='migration:0173_not_paid_stock_hold_repair'").get().c, 10)
const snap = db.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='sale.not_paid_stock_hold_repair'").all()
assert.strictEqual(snap.length, 1)
const payload = JSON.parse(snap[0].payload_json)
assert.strictEqual(payload.lines.length, 21)
assert.strictEqual(payload.lines.find((l) => l.sale_item_id === 40248).batch_before, 5)
const hist = JSON.parse(db.prepare("SELECT redo_payload FROM action_history WHERE entity='sale_not_paid_stock_recovery' AND entity_id='16885'").get().redo_payload)
assert.strictEqual(hist.held_units_after, 5)
assert.strictEqual(hist.sale_item_ids.length, 5)
// Allocation 264.
assert.strictEqual(db.prepare('SELECT quantity q FROM sale_item_batch_allocations WHERE id=264').get().q, 2)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='sync_amended_allocation_quantity'").get().c, 1)

// -- Second run is a no-op.
const movementsBefore = db.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c
db.exec(sql0173)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, movementsBefore)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=61114 AND branch_id=2').get().q, 4)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM undo_snapshots WHERE kind='sale.not_paid_stock_hold_repair'").get().c, 1)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='sync_amended_allocation_quantity'").get().c, 1)

// -- Guard: a fixture with a partial set (not 21) must abort before writing.
const db2 = new Database(':memory:')
db2.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db2.exec(migration)
db2.prepare("INSERT INTO branches (id, name) VALUES (2, 'Shop')").run()
db2.prepare("INSERT INTO products (id, name, stock_quantity) VALUES (4276, 'P', 11)").run()
db2.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (51291, 4276, 'k', 1, 8)").run()
db2.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (51291, 2, 11)').run()
db2.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (4276, 2, 11)').run()
db2.prepare("INSERT INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id) VALUES (16836, 'a', 'completed', 0, 2)").run()
db2.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity, cost_price_usd, branch_id) VALUES (40124, 16836, 4276, 1, 8, 2)').run()
db2.prepare("INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_at, released_quantity) VALUES (8, 40124, 51291, 2, 1, '2026-09-04', 1)").run()
assert.throws(() => db2.exec(sql0173), /CHECK constraint failed/, 'partial set must abort')
assert.strictEqual(db2.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=51291').get().q, 11, 'nothing written on abort')

console.log('test-migration-0173-pure: ok (21 lines deducted, lot 61114 substitution, allocation 264, controls, idempotent, partial-set guard)')
