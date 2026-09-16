// Pins migration 0174 (leading-zero twin merge for the four audited pairs)
// against a SYNTHETIC fixture on the REAL migration chain (better-sqlite3,
// no production data): the four pairs with lots, stock and a sale line on
// a loser; then a second fixture where one pair's barcodes genuinely differ
// and must NOT merge.
//
// Run: node scripts/test-migration-0174-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0174 = fs.readFileSync(path.join(migrationsDir, '0174_product_leading_zero_twins_merge.sql'), 'utf8')

function fresh() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const migration of loadAll()) db.exec(migration)
  db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Warehouse'), (2, 'Shop')").run()
  return db
}

function seed(db, overrides = {}) {
  const P = db.prepare('INSERT INTO products (id, name, barcode, is_active, cost_price_usd, purchase_price_usd, selling_price_usd, brand, stock_quantity) VALUES (?, ?, ?, 1, ?, 0, ?, ?, 0)')
  P.run(5205, 'Secret Powder Fresh ប្រអប់', '037000256823', 3.5, 6, 'Secret')
  P.run(9709, 'Secret Powder Fresh (ប្រអប់)', '037000256823', 0, 0, null)
  P.run(1560, 'Degree Shower Clean Set', '079400490704', 4, 7, null)
  P.run(7117, 'Degree Shower Clean (set)', '079400490704', 4.2, 0, 'Degree')
  P.run(5063, 'Rare Powder Blush Happy', '0840122906596', 24.4, 39, 'Rare')
  P.run(9609, 'Rare Powder Blush-Happy', overrides.barcode9609 || '840122906596', 24.394739, 39, null)
  P.run(8660, 'Lancôme Absolue Riche Cream Refill 60ml', '3614272049154', 272, 380, 'Lancôme')
  P.run(3470, 'Lancome Absolue Riche Cream Refill 60ml', overrides.barcode3470 || '03614272049154', 250, 380, null)
  // unrelated control product
  P.run(77, 'Control', '0123456789', 1, 2, null)

  const L = db.prepare('INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, is_active, unit_cost_usd) VALUES (?, ?, ?, ?, 1, ?)')
  L.run(5205, 5205, 'import', 'IMP', 3.5)
  L.run(51464, 9709, 'import', 'ADJ09/02/2026', 0)          // batch_key collision with the keeper's lot
  L.run(1560, 1560, 'import', 'IMP', 4)
  L.run(51442, 7117, 'latest-data-20260902-v1:7117', 'ADJ09/02/2026', 0)
  L.run(1, 5063, 'a', 'A', 24.4)
  L.run(2, 5063, 'b', 'B', 25.5)
  L.run(3, 5063, 'c', 'C', 22)
  L.run(55156, 9609, 'latest-data-20260902-v1:9609', 'ADJ09/02/2026', 24.394739)
  L.run(46281, 8660, 'r272', 'R', 272)
  L.run(4, 8660, 'free', 'F', 0)
  L.run(3470, 3470, 'import', 'IMP', 0)
  L.run(770, 77, 'x', 'X', 1)

  const B = db.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, ?)')
  B.run(55156, 2, 5)
  B.run(1, 1, 2)
  B.run(770, 1, 3)
  const S = db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)')
  S.run(9609, 2, 5)
  S.run(5063, 1, 2)
  S.run(5063, 2, 0)
  S.run(77, 1, 3)
  db.prepare('UPDATE products SET stock_quantity = 5 WHERE id = 9609').run()
  db.prepare('UPDATE products SET stock_quantity = 2 WHERE id = 5063').run()
  db.prepare('UPDATE products SET stock_quantity = 3 WHERE id = 77').run()

  db.prepare("INSERT INTO sales (id, receipt_number, sale_status) VALUES (900, 'R900', 'completed'), (901, 'R901', 'completed')").run()
  db.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES (9001, 900, 9609, 'Rare Powder Blush-Happy', 1), (9002, 901, 9609, 'Rare Powder Blush-Happy', 2), (28039, 901, 8660, 'Lancôme', 1)").run()
  db.prepare("INSERT INTO inventory_movements (product_id, product_name, movement_type, quantity, reference_id) VALUES (9609, 'x', 'sale', -1, 900)").run()
}

// ---------------------------------------------------------------- full set
const db = fresh()
seed(db)
db.exec(sql0174)

assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_merge_map_0174').get().c, 4)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM products WHERE id IN (9709,7117,9609,3470)').get().c, 0, 'losers deleted')
const barcodes = Object.fromEntries(db.prepare('SELECT id, barcode FROM products WHERE id IN (5205,1560,5063,8660,77)').all().map((r) => [r.id, r.barcode]))
assert.deepStrictEqual(barcodes, { 5205: '37000256823', 1560: '79400490704', 5063: '840122906596', 8660: '3614272049154', 77: '0123456789' })
// lots repointed; collision suffixed
assert.strictEqual(db.prepare('SELECT variant_product_id v FROM product_batches WHERE id = 55156').get().v, 5063)
assert.strictEqual(db.prepare('SELECT batch_key k FROM product_batches WHERE id = 51464').get().k, 'import-merged-9709-51464')
assert.strictEqual(db.prepare('SELECT variant_product_id v FROM product_batches WHERE id = 51464').get().v, 5205)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_batches WHERE variant_product_id IN (9709,7117,9609,3470)').get().c, 0)
// stock folded onto the keeper, ledgers agree
assert.deepStrictEqual(db.prepare('SELECT branch_id b, quantity q FROM branch_stock WHERE product_id = 5063 ORDER BY branch_id').all(), [{ b: 1, q: 2 }, { b: 2, q: 5 }])
assert.strictEqual(db.prepare('SELECT stock_quantity q FROM products WHERE id = 5063').get().q, 7)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM branch_stock WHERE product_id IN (9709,7117,9609,3470)').get().c, 0)
assert.strictEqual(db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id = 55156').get().q, 5, 'lot stock untouched (row follows its lot)')
// keeper cost from active lots: 5063 = mean(24.4, 25.5, 22, 24.394739) = 24.0737; purchase mirrored
const p5063 = db.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id = 5063').get()
assert.strictEqual(p5063.c, 24.0737)
assert.strictEqual(p5063.p, 24.0737)
// 8660: distinct non-zero lot costs = {272} -> 272 (free lot excluded, loser's 250 scalar not a lot)
assert.strictEqual(db.prepare('SELECT cost_price_usd c FROM products WHERE id = 8660').get().c, 272)
// 1560: only costed lot 4 -> 4 (pair fallback avg(4, 4.2) superseded by the lot figure)
assert.strictEqual(db.prepare('SELECT cost_price_usd c FROM products WHERE id = 1560').get().c, 4)
// blank brand filled from the loser
assert.strictEqual(db.prepare('SELECT brand b FROM products WHERE id = 1560').get().b, 'Degree')
// sale lines and movements reparented
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sale_items WHERE product_id = 5063').get().c, 2)
assert.strictEqual(db.prepare('SELECT product_id p FROM inventory_movements WHERE reference_id = 900').get().p, 5063)
// lineage evidence: one product.merge row per pair, reparented ids recorded
const snaps = db.prepare("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' AND json_extract(payload_json, '$.source') = 'repair-0174' ORDER BY id").all().map((r) => JSON.parse(r.payload_json))
assert.strictEqual(snaps.length, 4)
const s9609 = snaps.find((s) => s.dupId === 9609)
assert.deepStrictEqual(s9609.reparentedSaleItemIds.sort(), [9001, 9002])
assert.strictEqual(s9609.keeperId, 5063)
assert.deepStrictEqual(s9609.lotIds, [55156])
// audit rows carry the loser pre-image
const audit = db.prepare("SELECT record_id, old_value FROM audit_logs WHERE user_name = 'migration:0174_product_leading_zero_twins_merge' ORDER BY record_id").all()
assert.strictEqual(audit.length, 4)
assert.strictEqual(JSON.parse(audit.find((a) => a.record_id === '9609').old_value).barcode, '840122906596')
// control untouched
assert.deepStrictEqual(db.prepare('SELECT stock_quantity q, cost_price_usd c FROM products WHERE id = 77').get(), { q: 3, c: 1 })

// second run: no-op
const counts = () => ({
  products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
  snaps: db.prepare("SELECT COUNT(*) c FROM undo_snapshots WHERE kind='product.merge'").get().c,
  audit: db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c,
  cost: db.prepare('SELECT cost_price_usd c FROM products WHERE id = 5063').get().c,
  merged: db.prepare('SELECT auto_merged_count c FROM products WHERE id = 5063').get().c,
})
const before = counts()
db.exec(sql0174)
assert.deepStrictEqual(counts(), before)
assert.strictEqual(before.merged, 1)

// ------------------------------------------- genuinely different barcode
const db2 = fresh()
seed(db2, { barcode3470: '3614272049161' })
db2.exec(sql0174)
assert.strictEqual(db2.prepare('SELECT COUNT(*) c FROM product_merge_map_0174').get().c, 3)
assert.strictEqual(db2.prepare('SELECT COUNT(*) c FROM products WHERE id = 3470').get().c, 1, 'different real barcode must not fold')
assert.strictEqual(db2.prepare('SELECT barcode b FROM products WHERE id = 8660').get().b, '3614272049154', 'keeper untouched when its pair is refused')
assert.strictEqual(db2.prepare('SELECT COUNT(*) c FROM products WHERE id IN (9709,7117,9609)').get().c, 0)

// ----------------------------------------------- empty database: no-op
const db3 = fresh()
db3.exec(sql0174)
assert.strictEqual(db3.prepare('SELECT COUNT(*) c FROM product_merge_pairs_0174').get().c, 0)

console.log('test-migration-0174-pure: ok (4 pairs folded, barcode zero-stripped, lots/stock/sales/movements repointed, lot-derived cost, lineage evidence, refused pair, idempotent)')
