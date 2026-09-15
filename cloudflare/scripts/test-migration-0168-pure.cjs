// Pins the 0168 (transfer-aware product merge) migration against a small
// SYNTHETIC fixture built on the REAL migration chain (better-sqlite3, no
// production data), modeled on the production pair migration 0168 exists
// to fix ("dior addict lip glow new 075", ids 1616/7161). See migrations/
// 0168_transfer_aware_merge.sql for the full rule and header.
//
// Fixture: T1 loser (1616-equivalent, id 1616, barcode with a leading zero)
// is transfer_operation_members.source_product_id; T2 keeper (7161-
// equivalent, id 7161, clean-spelling barcode) is destination_product_id of
// the SAME member row, whose allocations_json references batch 61190 (on
// the loser) as source_batch_id and batch 61204 (on the keeper, SAME
// batch_key as 61190 -- collision case) as destination_batch_id. This is
// exactly the shape 0165 was forced to exclude (P8+P9 combined on one
// pair) and exactly the shape 0168 must resolve.
//
// Run: node scripts/test-migration-0168-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

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

// T1/T2: the transfer-aware pair. 1616 = loser (leading-zero barcode), 7161 =
// keeper (clean spelling) -- same real code, exactly the 0165 step-2 rule.
insertProduct({ id: 1616, name: 'Dior Addict Lip Glow New 075', barcode: '03348901737289', cost_price_usd: 32, brand: '' })
insertProduct({ id: 7161, name: 'Dior Addict Lip Glow New 075', barcode: '3348901737289', cost_price_usd: 33, brand: 'Dior' })
branchStock(1616, 1, 0)
branchStock(7161, 2, 1)

// Loser's other, ordinary (non-transfer-evidenced) lot -- must still repoint normally.
db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, unit_cost_usd) VALUES (61100, 1616, '07122026', 31.87)").run()
// Loser's transfer-evidenced lot (source_batch_id) and keeper's matching-key
// destination lot -- a batch_key COLLISION on repoint, same as production.
db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, unit_cost_usd) VALUES (61190, 1616, '09132026', 33)").run()
db.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, unit_cost_usd) VALUES (61204, 7161, '09132026', 33)").run()

db.prepare(`INSERT INTO transfer_operation_receipts (id, actor_id, request_id, request_digest, request_json, status, provenance_version)
  VALUES (7, 1, 'r-dior', 'd-dior', '{}', 'pending', 1)`).run()
db.prepare(`INSERT INTO transfer_operation_members
    (receipt_id, ordinal, source_product_id, destination_product_id, source_branch_id, destination_branch_id,
     quantity, untracked_quantity, source_snapshot, destination_snapshot, allocations_json)
  VALUES (7, 0, 1616, 7161, 1, 2, 3, 0, '{"id":1616}', '{"id":7161}',
    '[{"source_batch_id":61190,"destination_batch_id":61204,"quantity":3}]')`).run()
db.prepare(`UPDATE transfer_operation_receipts SET status='committed' WHERE id=7`).run()

// Pre-check: before 0168, the ordinary transfer triggers still refuse to
// touch either the product row or the transfer-evidenced lot.
assert.throws(
  () => db.prepare('DELETE FROM products WHERE id = 1616').run(),
  /immutable transfer provenance/,
  'pre: transfer_product_delete still refuses to delete the loser before 0168 runs'
)
assert.throws(
  () => db.prepare('UPDATE product_batches SET variant_product_id = 7161 WHERE id = 61190').run(),
  /immutable transfer provenance/,
  'pre: transfer_batch_identity_update still refuses to reparent the evidenced lot before 0168 runs'
)
assert.throws(
  () => db.prepare("UPDATE transfer_operation_members SET source_product_id = 7161 WHERE receipt_id = 7").run(),
  /transfer provenance is immutable/,
  'pre: transfer_members_immutable_update still refuses any update before 0168 runs'
)

const sql0168 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0168_transfer_aware_merge.sql'), 'utf8')
const start = process.hrtime.bigint()
db.exec(sql0168)
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

// Keeper survives, loser is gone.
{
  const keeper = db.prepare('SELECT * FROM products WHERE id = 7161').get()
  assert.ok(keeper, 'keeper survives')
  assert.ok(!db.prepare('SELECT 1 FROM products WHERE id = 1616').get(), 'loser deleted')
  assert.strictEqual(keeper.barcode, '3348901737289', 'keeper keeps the clean (non-padded) spelling')
  assert.strictEqual(keeper.cost_price_usd, 32.5, 'cost averaged (32+33)/2')
  assert.strictEqual(keeper.brand, 'Dior', 'keeper own non-blank brand kept (not overwritten by loser)')
  const stock = db.prepare('SELECT branch_id, quantity FROM branch_stock WHERE product_id = 7161 ORDER BY branch_id').all()
  assert.deepStrictEqual(stock, [{ branch_id: 1, quantity: 0 }, { branch_id: 2, quantity: 1 }], 'branch_stock folded (no overlap here -> both rows kept, repointed)')
  assert.strictEqual(keeper.stock_quantity, 1, 'stock_quantity recomputed from folded branch_stock')
}

// Ordinary lot repoints like a normal merge.
{
  const lot = db.prepare('SELECT variant_product_id, batch_key FROM product_batches WHERE id = 61100').get()
  assert.strictEqual(lot.variant_product_id, 7161, 'non-transfer-evidenced lot repointed to keeper')
  assert.strictEqual(lot.batch_key, '07122026', 'its batch_key is untouched (no collision)')
}

// Transfer-evidenced lot: repointed AND collision-suffixed.
{
  const lot = db.prepare('SELECT variant_product_id, batch_key FROM product_batches WHERE id = 61190').get()
  assert.strictEqual(lot.variant_product_id, 7161, 'transfer-evidenced lot IS repointed by 0168 (unlike 0165, which could never reach it)')
  assert.strictEqual(lot.batch_key, '09132026-merged-1616-61190', 'batch_key collision with the keeper\'s own lot is suffixed, same rule as 0165')
  const stillThere = db.prepare('SELECT variant_product_id FROM product_batches WHERE id = 61204').get()
  assert.strictEqual(stillThere.variant_product_id, 7161, 'the keeper\'s own destination lot is untouched')
}

// Transfer provenance rewritten to the keeper on both sides.
{
  const member = db.prepare('SELECT source_product_id, destination_product_id FROM transfer_operation_members WHERE receipt_id = 7 AND ordinal = 0').get()
  assert.strictEqual(member.source_product_id, 7161, 'source_product_id rewritten from loser to keeper')
  assert.strictEqual(member.destination_product_id, 7161, 'destination_product_id (already keeper) stays keeper')
}

// Both trigger families are restored and still enforced afterward.
{
  const triggerNames = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('transfer_batch_identity_update','transfer_members_immutable_update','transfer_product_delete','transfer_product_identity_update')").all().map((r) => r.name)
  assert.strictEqual(triggerNames.length, 4, 'all four transfer trigger names still exist after 0168')
  assert.throws(
    () => db.prepare("UPDATE transfer_operation_members SET quantity = 5 WHERE receipt_id = 7").run(),
    /transfer provenance is immutable/,
    'post: transfer_members_immutable_update is back and still enforced for an UNRELATED edit'
  )
  assert.throws(
    () => db.prepare('UPDATE product_batches SET variant_product_id = 999 WHERE id = 61204').run(),
    /immutable transfer provenance/,
    'post: transfer_batch_identity_update is back and still enforced (a genuine reparent attempt on the evidenced destination lot is still blocked)'
  )
}

// No orphans: nothing still references the deleted loser id.
{
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM branch_stock WHERE product_id = 1616').get().c, 0, 'no orphan branch_stock')
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_batches WHERE variant_product_id = 1616').get().c, 0, 'no orphan product_batches')
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transfer_operation_members WHERE source_product_id = 1616 OR destination_product_id = 1616').get().c, 0, 'no orphan transfer_operation_members')
}

// Audit trail.
{
  const audit = db.prepare("SELECT * FROM audit_logs WHERE user_name = 'migration:0168_transfer_aware_merge'").all()
  assert.strictEqual(audit.length, 1, 'one audit row for the one merged loser')
  assert.strictEqual(audit[0].record_id, '1616', 'audit row records the loser id')
  const preimage = JSON.parse(audit[0].old_value)
  assert.strictEqual(preimage.barcode, '03348901737289', 'audit pre-image carries the loser\'s original (padded) barcode for recovery')
}

// Idempotence: re-running is a no-op.
const mapCountBefore = db.prepare('SELECT COUNT(*) c FROM product_merge_map_0168').get().c
db.exec(sql0168)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_merge_map_0168').get().c, mapCountBefore, 'second run adds no map rows')
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE user_name='migration:0168_transfer_aware_merge'").get().c, mapCountBefore, 'audit row count matches map row count after second run')
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM products WHERE id = 7161').get().c, 1, 'keeper still present after second run')

assert.ok(elapsedMs < 2000, `0168 must run well under a couple seconds for a single-pair fixture (took ${elapsedMs.toFixed(1)}ms)`)

console.log(`OK test-migration-0168-pure.cjs (1 transfer-aware loser merged, ${elapsedMs.toFixed(1)}ms)`)
