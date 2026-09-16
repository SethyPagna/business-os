// Pins the HELD migration ops/scripts/migration/held/0176_legacy_sep2_3_
// import_stock_deduction.sql (legacy Sep 2-3 sales imported without stock
// deduction) on a SYNTHETIC fixture over the REAL migration chain. The file
// is not in cloudflare/migrations/ (owner decision pending), so this test
// loads it from the held folder; when it is promoted the path below moves.
//
// Run: node scripts/test-migration-held-0176-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const heldPath = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'held', '0176_legacy_sep2_3_import_stock_deduction.sql')
const sql = fs.readFileSync(heldPath, 'utf8')
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'migrations', '0176_legacy_sep2_3_import_stock_deduction.sql')), 'held file must not also sit in the chain')
assert.ok(!/\r/.test(sql), 'LF only')

// Parse the static line table out of the SQL itself so the fixture cannot drift from it.
const lines = [...sql.matchAll(/\((\d{5}), (\d{5}), '(\d{4}-\d{2}-\d{2})'\)/g)].map((m) => ({ item: +m[1], lot: +m[2], day: m[3] }))
assert.strictEqual(lines.length, 38)

// sale_item -> [sale, product, qty, cost] (production shape, 2026-09-16 audit)
const ITEMS = {
  40134: [16842, 8801, 1, 19.101053], 40136: [16843, 5411, 1, 25.5], 40137: [16843, 5140, 1, 27], 40139: [16844, 7276, 1, 37.25],
  40141: [16845, 1578, 1, 42.666667], 40143: [16846, 6020, 1, 40], 40145: [16847, 114, 1, 18], 40146: [16847, 121, 1, 18],
  40148: [16848, 18, 1, 18.03], 40150: [16849, 1369, 1, 8.7], 40152: [16850, 2586, 4, 14], 40153: [16850, 2590, 5, 12],
  40154: [16850, 7875, 5, 12.114286], 40155: [16851, 9552, 3, 26.466667], 40158: [16852, 7878, 3, 12.131034], 40159: [16852, 7893, 2, 12.009259],
  40160: [16852, 7888, 2, 12.021053], 40162: [16853, 5269, 1, 17], 40164: [16854, 8074, 1, 41.222222], 40165: [16855, 7876, 10, 12.186275],
  40166: [16856, 11, 1, 19], 40167: [16856, 9092, 1, 10.045723], 40169: [16857, 111, 1, 18], 40170: [16858, 9571, 1, 27.008772],
  40171: [16858, 6796, 1, 43],
  40172: [16859, 4422, 1, 64.85], 40173: [16859, 9571, 1, 27.008772], 40174: [16860, 9490, 6, 38.848918], 40176: [16860, 9571, 12, 27.008772],
  40177: [16860, 468, 10, 6], 40178: [16860, 446, 3, 7.5], 40179: [16860, 6403, 4, 7.223077], 40180: [16860, 432, 6, 5],
  40181: [16860, 6386, 6, 5.208334], 40183: [16861, 6009, 1, 145], 40185: [16862, 1610, 1, 30.5], 40188: [16863, 1723, 2, 45.5],
  40189: [16863, 7231, 3, 44.910134],
}

function fresh() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const migration of loadAll()) db.exec(migration)
  db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Warehouse'), (2, 'Shop')").run()
  return db
}

function seed(db, { lotQty = (need) => need + 2 } = {}) {
  const P = db.prepare('INSERT OR IGNORE INTO products (id, name, stock_quantity, cost_price_usd) VALUES (?, ?, 0, ?)')
  const L = db.prepare("INSERT OR IGNORE INTO product_batches (id, variant_product_id, batch_key, lot_code, is_active, unit_cost_usd) VALUES (?, ?, 'k' || ?, 'L' || ?, 1, ?)")
  const S = db.prepare("INSERT OR IGNORE INTO sales (id, receipt_number, sale_status, stock_skipped, branch_id, branch_name) VALUES (?, 'legacy-' || ?, 'completed', 0, 2, 'Shop')")
  const I = db.prepare('INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, cost_price_usd, branch_id) VALUES (?, ?, ?, ?, ?, ?, 2)')
  const need = new Map()
  for (const l of lines) {
    const [sale, product, qty, cost] = ITEMS[l.item]
    P.run(product, 'P' + product, cost)
    L.run(l.lot, product, String(l.lot), String(l.lot), cost)
    S.run(sale, sale)
    I.run(l.item, sale, product, 'P' + product, qty, l.item === 40183 ? 0 : cost) // 40183 exercises the lot-cost fallback
    need.set(l.lot, (need.get(l.lot) || 0) + qty)
  }
  for (const [lot, qty] of need) db.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 2, ?)').run(lot, lotQty(qty, lot))
  for (const product of new Set(lines.map((l) => ITEMS[l.item][1]))) {
    const total = db.prepare('SELECT COALESCE(SUM(b.quantity),0) q FROM branch_batch_stock b JOIN product_batches pb ON pb.id=b.batch_id WHERE pb.variant_product_id=?').get(product).q
    db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, 2, ?)').run(product, total)
    db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').run(total, product)
  }
  // Non-deductible neighbours that must be left alone: a NULL-product line and an
  // already-amended line with its own allocation + movement (40175 / 4834).
  db.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, cost_price_usd, branch_id) VALUES (40184, 16861, NULL, 'fee', 1, 0, 2), (40175, 16860, 4834, 'P4834', 6, 40, 2)").run()
  db.prepare("INSERT INTO products (id, name, stock_quantity) VALUES (4834, 'P4834', 0)").run()
  db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (55037, 4834, 'k55037', 1, 40)").run()
  db.prepare('INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_quantity) VALUES (512, 40175, 55037, 2, 3, 0)').run()
  db.prepare("INSERT INTO inventory_movements (product_id, branch_id, movement_type, quantity, reference_id, batch_id) VALUES (4834, 2, 'sale', -3, 16860, 55037)").run()
}

// ------------------------------------------------------------- full apply
const db = fresh()
seed(db)
db.exec(sql)

assert.strictEqual(db.prepare('SELECT COUNT(*) c, SUM(quantity) u FROM legacy_import_stock_repair_0176 WHERE applied = 1').get().c, 38)
assert.strictEqual(db.prepare('SELECT SUM(quantity) u FROM legacy_import_stock_repair_0176 WHERE applied = 1').get().u, 107)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE user_name = 'migration:0176_legacy_sep2_3_import_stock_deduction'").get().c, 38)
for (const l of lines) {
  const [sale, product, qty, cost] = ITEMS[l.item]
  const a = db.prepare('SELECT batch_id, quantity, released_quantity, lot_code FROM sale_item_batch_allocations WHERE sale_item_id = ?').all(l.item)
  assert.strictEqual(a.length, 1, `one allocation for ${l.item}`)
  assert.deepStrictEqual(a[0], { batch_id: l.lot, quantity: qty, released_quantity: 0, lot_code: 'L' + l.lot })
  const m = db.prepare("SELECT quantity, unit_cost_usd, batch_id, reason FROM inventory_movements WHERE reference_id = ? AND product_id = ? AND user_name LIKE 'migration:0176%'").get(sale, product)
  assert.strictEqual(m.quantity, -qty)
  assert.strictEqual(m.unit_cost_usd, cost, `cost ${l.item} (lot fallback for 40183)`)
  assert.strictEqual(m.batch_id, l.lot)
  assert.match(m.reason, new RegExp(l.day))
  assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id = ? AND branch_id = 2').get(l.lot).q >= 0, true)
}
// shared lot 55125 served 40170 (1) + 40173 (1) + 40176 (12): seeded 14+2 -> 2
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id = 55125').get().q, 2)
assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.id IN (SELECT product_id FROM legacy_import_stock_repair_0176)
  AND p.stock_quantity <> (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id = p.id)`).get().c, 0)
assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.id IN (SELECT product_id FROM legacy_import_stock_repair_0176)
  AND p.stock_quantity <> (SELECT COALESCE(SUM(b.quantity),0) FROM branch_batch_stock b JOIN product_batches pb ON pb.id=b.batch_id WHERE pb.variant_product_id=p.id)`).get().c, 0)
// neighbours untouched
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations WHERE sale_item_id IN (40175, 40184)').get().c, 1)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE reference_id = 16860 AND product_id = 4834").get().c, 1)
// provenance
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM action_history WHERE entity = 'sale_legacy_import_stock_deduction' AND reversible = 0").get().c, new Set(lines.map((l) => ITEMS[l.item][0])).size)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'deduct_legacy_import_sale_stock'").get().c, new Set(lines.map((l) => ITEMS[l.item][0])).size)
const payload = JSON.parse(db.prepare("SELECT payload_json FROM undo_snapshots WHERE kind = 'sale.legacy_import_stock_deduction'").get().payload_json)
assert.strictEqual(payload.lines.length, 38)
assert.strictEqual(payload.lines.filter((l) => l.invoice_day === '2026-09-02').length, 13)
assert.ok(db.prepare('SELECT COUNT(*) c FROM legacy_import_stock_repair_0176 WHERE allocation_id IS NULL').get().c === 0)

// second run: no-op
const before = db.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c
db.exec(sql)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, before)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations').get().c, 39)

// --------------------------------------------- insufficient lot -> abort
const db2 = fresh()
seed(db2, { lotQty: (need, lot) => (lot === 52207 ? need - 1 : need) })
assert.throws(() => db2.exec(sql), /CHECK constraint failed/)
assert.strictEqual(db2.prepare('SELECT COUNT(*) c FROM sale_item_batch_allocations').get().c, 1, 'nothing written on abort')

// ------------------------------------------------ empty database: no-op
const db3 = fresh()
db3.exec(sql)
assert.strictEqual(db3.prepare('SELECT COUNT(*) c FROM legacy_import_stock_repair_0176').get().c, 0)

console.log('test-migration-held-0176-pure: ok (38 lines / 107 units, allocations, lot-cost fallback, shared lots, neighbours untouched, abort on shortfall, idempotent)')
