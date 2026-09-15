// Pins migration 0169 (merged product_name snapshot repair) against a small
// SYNTHETIC fixture built on the REAL migration chain (better-sqlite3, no
// production data). See migrations/0169_merged_product_name_snapshots.sql.
//
// Run: node scripts/test-migration-0169-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0165 = fs.readFileSync(path.join(migrationsDir, '0165_product_same_name_merge.sql'), 'utf8')
const sql0168 = fs.readFileSync(path.join(migrationsDir, '0168_transfer_aware_merge.sql'), 'utf8')
const sql0169 = fs.readFileSync(path.join(migrationsDir, '0169_merged_product_name_snapshots.sql'), 'utf8')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)

function insertProduct(p) {
  db.prepare(`INSERT INTO products (id, name, barcode, brand, category, supplier, image_path, description,
      selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr,
      stock_quantity, is_active, is_group, tag_label, name_key)
    VALUES (@id, @name, @barcode, @brand, @category, @supplier, @image_path, @description,
      @selling_price_usd, @selling_price_khr, @wholesale_price_usd, @wholesale_price_khr, @cost_price_usd, @cost_price_khr,
      @stock_quantity, @is_active, @is_group, @tag_label, lower(trim(@name)))`).run({
    barcode: null, brand: null, category: null, supplier: null, image_path: null, description: null,
    selling_price_usd: 0, selling_price_khr: 0, wholesale_price_usd: 0, wholesale_price_khr: 0,
    cost_price_usd: 0, cost_price_khr: 0, stock_quantity: 0, is_active: 1, is_group: 0, tag_label: null,
    ...p,
  })
}
db.exec("INSERT INTO branches (id, name) VALUES (1,'Main'),(2,'Second')")

// -- 0165-style pair: 201 (loser, OLD spelling) / 202 (keeper) -----------
insertProduct({ id: 201, name: 'Old Spelling Serum', barcode: '008339327539' })
insertProduct({ id: 202, name: 'Old Spelling Serum', barcode: '8339327539' })
db.prepare("INSERT INTO sales (id, receipt_number) VALUES (900, 'R1')").run()
// stale: still carries the loser's OLD name even though product_id is 201 pre-merge
db.prepare("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES (1, 900, 201, 'Old Spelling Serum', 1)").run()
db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity)
  VALUES (1, 201, 'Old Spelling Serum', 1, 'Main', 'add', 5)`).run()
db.prepare(`INSERT INTO stock_row_moves (id, source_product_id, source_product_name, destination_product_id, destination_product_name, quantity)
  VALUES (1, 201, 'Old Spelling Serum', 202, 'Old Spelling Serum', 1)`).run()
// This row already carries a DIFFERENT name (independently corrected/renamed
// since) -- must be left untouched, never overwritten to the keeper's name.
db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity)
  VALUES (2, 201, 'Some Other Later Name', 1, 'Main', 'add', 1)`).run()

// -- 0168-style transfer-aware pair: 1616/7161 (production ids) ----------
insertProduct({ id: 1616, name: 'Dior Addict Lip Glow New 075', barcode: '03348901737289', cost_price_usd: 32 })
insertProduct({ id: 7161, name: 'Dior Addict Lip Glow New 075', barcode: '3348901737289', cost_price_usd: 33 })
db.prepare(`INSERT INTO transfer_operation_receipts (id, actor_id, request_id, request_digest, request_json, status, provenance_version)
  VALUES (7, 1, 'r-dior', 'd-dior', '{}', 'pending', 1)`).run()
db.prepare(`INSERT INTO transfer_operation_members
    (receipt_id, ordinal, source_product_id, destination_product_id, source_branch_id, destination_branch_id,
     quantity, untracked_quantity, source_snapshot, destination_snapshot, allocations_json)
  VALUES (7, 0, 1616, 7161, 1, 2, 1, 0, '{}', '{}', '[]')`).run()
db.prepare(`UPDATE transfer_operation_receipts SET status='committed' WHERE id=7`).run()
db.prepare("INSERT INTO returns (id, receipt_number) VALUES (800, 'RET1')").run()
db.prepare(`INSERT INTO return_items (id, return_id, product_id, product_name, quantity)
  VALUES (1, 800, 1616, 'Dior Addict Lip Glow New 075', 1)`).run()

db.exec(sql0165)
db.exec(sql0168)

// Rename the keeper AFTER the merges, same as production ("Old Spelling
// Serum" -> "Clean Spelling Serum") so post-0169 the snapshot columns must
// read the RENAMED current name, not the name captured at merge time.
db.prepare("UPDATE products SET name='Clean Spelling Serum' WHERE id=202").run()

db.exec(sql0169)

// sale_items / inventory_movements: repaired to the keeper's CURRENT name.
assert.strictEqual(db.prepare('SELECT product_name FROM sale_items WHERE id=1').get().product_name, 'Clean Spelling Serum', 'sale_items.product_name repaired to the keeper current name')
assert.strictEqual(db.prepare('SELECT product_name FROM inventory_movements WHERE id=1').get().product_name, 'Clean Spelling Serum', 'inventory_movements.product_name repaired')
// The independently-renamed row is left exactly alone.
assert.strictEqual(db.prepare('SELECT product_name FROM inventory_movements WHERE id=2').get().product_name, 'Some Other Later Name', 'a row already carrying a DIFFERENT name is never overwritten')
// stock_row_moves: both source and destination columns repaired.
const move = db.prepare('SELECT source_product_name, destination_product_name FROM stock_row_moves WHERE id=1').get()
assert.strictEqual(move.source_product_name, 'Clean Spelling Serum', 'stock_row_moves.source_product_name repaired')
assert.strictEqual(move.destination_product_name, 'Clean Spelling Serum', 'stock_row_moves.destination_product_name repaired (already the keeper id pre-merge, still fixed by name match)')
// 0168 transfer-aware pair: return_items repaired too.
assert.strictEqual(db.prepare('SELECT product_name FROM return_items WHERE id=1').get().product_name, 'Dior Addict Lip Glow New 075', 'return_items.product_name repaired via the 0168 map')
// sale_amendments untouched (none seeded; just confirm the migration never references it as a write target)
assert.ok(!/UPDATE sale_amendments/i.test(sql0169), 'sale_amendments is never written by this migration')

// Idempotence: second run changes nothing further.
const before = {
  saleItems: db.prepare('SELECT product_name FROM sale_items WHERE id=1').get().product_name,
  moves: db.prepare('SELECT source_product_name, destination_product_name FROM stock_row_moves WHERE id=1').get(),
}
db.exec(sql0169)
assert.strictEqual(db.prepare('SELECT product_name FROM sale_items WHERE id=1').get().product_name, before.saleItems, 'second run is a no-op (sale_items)')
assert.deepStrictEqual(db.prepare('SELECT source_product_name, destination_product_name FROM stock_row_moves WHERE id=1').get(), before.moves, 'second run is a no-op (stock_row_moves)')

console.log('OK test-migration-0169-pure.cjs')
