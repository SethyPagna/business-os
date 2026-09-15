// Pins the 0165 (product same-name merge) and 0166 (customer same-name+
// phone merge) migrations against a small SYNTHETIC fixture built on the
// REAL migration chain (better-sqlite3, no production data) -- so the rule
// is provable without production access. See migrations/0165_product_same_
// name_merge.sql and 0166_customer_same_name_phone_merge.sql for the full
// rule and scripts/verify-0165-0166-merges.cjs for the production-replica
// rehearsal.
//
// Fixture coverage (one distinguishing case per clause):
//  P1 leading-zero real-barcode pair -> keeper is the clean spelling, cost
//     averaged, stock summed.
//  P2 real barcode vs a "word" barcode -> keeper is the real-barcode row,
//     loser's non-empty brand backfills the keeper's blank brand.
//  P3 both barcodes empty -> merge into the lower id, barcode stays ''.
//  P4 two DIFFERENT real barcodes sharing a name -> both rows survive as
//     separate keepers; a no-barcode third row in the same name cluster
//     attaches to whichever keeper has the higher stock.
//  P5 tag_label row sharing the name -> never merged, never a keeper.
//  P6 is_active=0 row sharing the name -> left alone entirely.
//  P7 sale_items/branch_stock/product_images/promotion_rules repoint +
//     branch_stock SUM-on-overlap + product_images dedupe-by-path.
//  C1 customer pair sharing name+phone -> keeper backfilled, sales/
//     receivables repointed; a same-name DIFFERENT-phone customer is
//     untouched (negative control).
//  Idempotence: re-running both files changes nothing further.
//
// Run: node scripts/test-migration-0165-0166-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0165 = fs.readFileSync(path.join(migrationsDir, '0165_product_same_name_merge.sql'), 'utf8')
const sql0166 = fs.readFileSync(path.join(migrationsDir, '0166_customer_same_name_phone_merge.sql'), 'utf8')

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
function branchStock(productId, branchId, quantity) {
  db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?,?,?)').run(productId, branchId, quantity)
}
db.exec("INSERT INTO branches (id, name) VALUES (1,'Main'),(2,'Second')")

// -- P1: leading-zero real-barcode twins --------------------------------
insertProduct({ id: 101, name: 'Vitamin C Serum', barcode: '008339327539', cost_price_usd: 10, selling_price_usd: 20 })
insertProduct({ id: 102, name: 'Vitamin C Serum', barcode: '8339327539', cost_price_usd: 12, selling_price_usd: 0 })
branchStock(101, 1, 5)
branchStock(102, 1, 3)
branchStock(102, 2, 2)

// -- P2: real barcode vs a word/broken barcode --------------------------
insertProduct({ id: 111, name: 'Charcoal Mask', barcode: '5012345678', brand: '' })
insertProduct({ id: 112, name: 'Charcoal Mask', barcode: 'N/A', brand: 'Freeman' })

// -- P3: both empty ------------------------------------------------------
insertProduct({ id: 121, name: 'Loose Powder', barcode: '' })
insertProduct({ id: 122, name: 'Loose Powder', barcode: '0' })
insertProduct({ id: 123, name: 'Loose Powder', barcode: null })

// -- P4: two different real barcodes + a no-barcode attach --------------
insertProduct({ id: 131, name: 'Lip Tint', barcode: '700111222', stock_quantity: 0 })
insertProduct({ id: 132, name: 'Lip Tint', barcode: '700333444', stock_quantity: 0 })
insertProduct({ id: 133, name: 'Lip Tint', barcode: '' })
branchStock(131, 1, 1)
branchStock(132, 1, 9)

// -- P5: tag_label row must never merge ----------------------------------
insertProduct({ id: 141, name: 'Blush Stick', barcode: '900111222' })
insertProduct({ id: 142, name: 'Blush Stick', barcode: '900111222', tag_label: 'damaged' })

// -- P6: inactive row must be left alone ---------------------------------
insertProduct({ id: 151, name: 'Setting Spray', barcode: '600111222' })
insertProduct({ id: 152, name: 'Setting Spray', barcode: '600111222', is_active: 0 })

// -- P7: repoint fixtures (101 is the loser, 102 is the keeper) ---------
db.prepare('INSERT INTO sales (id, receipt_number) VALUES (900, \'R1\')').run()
db.prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (1, 900, 101, 2)').run()
db.prepare("INSERT INTO product_images (product_id, image_path, sort_order) VALUES (102, 'a.jpg', 0)").run()
db.prepare("INSERT INTO product_images (product_id, image_path, sort_order) VALUES (101, 'a.jpg', 0)").run() // duplicate path -> dedupe
db.prepare("INSERT INTO product_images (product_id, image_path, sort_order) VALUES (101, 'b.jpg', 1)").run() // unique path -> repoint
db.prepare(`INSERT INTO promotion_rules (id, product_ids) VALUES (1, '[101, 999]')`).run()

db.exec(sql0165)

const mapRows = db.prepare('SELECT * FROM product_merge_map_0165 ORDER BY loser_id').all()

// P1 -- the clean (non-padded) spelling on id 102 is the keeper, per the
// keeper tie-break in real_keepers (bc = real_code_key ranks first).
{
  const keeper = db.prepare('SELECT * FROM products WHERE id = 102').get()
  const loser = db.prepare('SELECT * FROM products WHERE id = 101').get()
  assert.ok(!loser, 'P1: leading-zero-padded loser deleted')
  assert.strictEqual(keeper.barcode, '8339327539', 'P1: keeper keeps the clean spelling')
  assert.strictEqual(keeper.cost_price_usd, 11, 'P1: cost averaged (10+12)/2')
  assert.strictEqual(keeper.selling_price_usd, 20, 'P1: keeper 0 selling price falls back to MAX across cluster')
  const stock = db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = 102 ORDER BY branch_id').all()
  assert.deepStrictEqual(stock, [{ branch_id: 1, quantity: 8 }, { branch_id: 2, quantity: 2 }], 'P1: branch_stock summed on overlap, kept on no-overlap')
}

// P2
{
  const keeper = db.prepare('SELECT * FROM products WHERE id = 111').get()
  assert.ok(!db.prepare('SELECT 1 FROM products WHERE id = 112').get(), 'P2: word-barcode loser deleted')
  assert.strictEqual(keeper.barcode, '5012345678', 'P2: real-barcode row is keeper')
  assert.strictEqual(keeper.brand, 'Freeman', 'P2: blank brand backfilled from loser')
}

// P3
{
  assert.ok(db.prepare('SELECT 1 FROM products WHERE id = 121').get(), 'P3: lowest id survives')
  assert.ok(!db.prepare('SELECT 1 FROM products WHERE id = 122').get(), 'P3: loser deleted')
  assert.ok(!db.prepare('SELECT 1 FROM products WHERE id = 123').get(), 'P3: loser deleted')
  assert.strictEqual(db.prepare('SELECT barcode FROM products WHERE id = 121').get().barcode, '', 'P3: no real code anywhere -> empty barcode')
}

// P4
{
  assert.ok(db.prepare('SELECT 1 FROM products WHERE id = 131').get(), 'P4: first real code survives as its own keeper')
  assert.ok(db.prepare('SELECT 1 FROM products WHERE id = 132').get(), 'P4: second real code survives as its own keeper (not merged with the first)')
  assert.ok(!db.prepare('SELECT 1 FROM products WHERE id = 133').get(), 'P4: no-barcode row is a loser')
  const map = mapRows.find((r) => r.loser_id === 133)
  assert.strictEqual(map.keeper_id, 132, 'P4: no-barcode row attaches to the higher-stock real keeper')
}

// P5
{
  assert.ok(db.prepare('SELECT 1 FROM products WHERE id = 141').get(), 'P5: plain row survives')
  const tagged = db.prepare('SELECT 1 FROM products WHERE id = 142').get()
  assert.ok(tagged, 'P5: tagged row is NEVER merged, even sharing name+barcode with a plain row')
}

// P6
{
  assert.ok(db.prepare('SELECT 1 FROM products WHERE id = 151').get(), 'P6: active row survives')
  const inactive = db.prepare('SELECT 1 FROM products WHERE id = 152').get()
  assert.ok(inactive, 'P6: inactive row is left alone (not merged, not deleted)')
}

// P7
{
  assert.strictEqual(db.prepare('SELECT product_id FROM sale_items WHERE id = 1').get().product_id, 102, 'P7: sale_items repointed')
  const images = db.prepare('SELECT image_path FROM product_images WHERE product_id = 102 ORDER BY image_path').all().map((r) => r.image_path)
  assert.deepStrictEqual(images, ['a.jpg', 'b.jpg'], 'P7: images deduped by path, unique paths repointed')
  const ruleIds = JSON.parse(db.prepare('SELECT product_ids FROM promotion_rules WHERE id = 1').get().product_ids)
  assert.deepStrictEqual(ruleIds, [102, 999], 'P7: promotion_rules.product_ids rewritten, untouched id kept')
}

// Idempotence for 0165
const mapCountBefore = db.prepare('SELECT COUNT(*) c FROM product_merge_map_0165').get().c
db.exec(sql0165)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_merge_map_0165').get().c, mapCountBefore, '0165: second run adds no map rows')
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE user_name='migration:0165_product_same_name_merge'").get().c, mapCountBefore, '0165: audit row count matches map row count after second run')

// ---------------------------------------------------------------- 0166 --
db.prepare("INSERT INTO customers (id, name, phone, email) VALUES (25000, 'ah ling', '099503494', NULL)").run()
db.prepare("INSERT INTO customers (id, name, phone, email) VALUES (25001, 'ah ling', '099503494', 'ling@example.com')").run()
db.prepare("INSERT INTO customers (id, name, phone) VALUES (30000, 'ah ling', '099999999')").run() // different phone -> negative control
db.prepare("INSERT INTO sales (id, receipt_number, customer_id) VALUES (901, 'R2', 25001)").run()
db.prepare("INSERT INTO customer_receivables (id, legacy_id, customer_id, customer_name, invoice_date, status, source_file, source_row) VALUES (1, 1, 25001, 'ah ling', '2026-01-01', 'open', 'f', 1)").run()

db.exec(sql0166)

{
  assert.ok(db.prepare('SELECT 1 FROM customers WHERE id = 25000').get(), 'C1: lowest id survives as keeper')
  assert.ok(!db.prepare('SELECT 1 FROM customers WHERE id = 25001').get(), 'C1: same name+phone loser deleted')
  assert.ok(db.prepare('SELECT 1 FROM customers WHERE id = 30000').get(), 'C1: same name DIFFERENT phone is untouched (negative control)')
  assert.strictEqual(db.prepare('SELECT email FROM customers WHERE id = 25000').get().email, 'ling@example.com', 'C1: keeper blank email backfilled from loser')
  assert.strictEqual(db.prepare('SELECT customer_id FROM sales WHERE id = 901').get().customer_id, 25000, 'C1: sales.customer_id repointed')
  assert.strictEqual(db.prepare('SELECT customer_id FROM customer_receivables WHERE id = 1').get().customer_id, 25000, 'C1: customer_receivables.customer_id repointed')
}

const custMapCountBefore = db.prepare('SELECT COUNT(*) c FROM customer_merge_map_0166').get().c
db.exec(sql0166)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM customer_merge_map_0166').get().c, custMapCountBefore, '0166: second run adds no map rows')
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE user_name='migration:0166_customer_same_name_phone_merge'").get().c, custMapCountBefore, '0166: audit row count matches map row count after second run')

console.log('OK test-migration-0165-0166-pure.cjs (' + mapRows.length + ' product losers, ' + custMapCountBefore + ' customer losers)')
