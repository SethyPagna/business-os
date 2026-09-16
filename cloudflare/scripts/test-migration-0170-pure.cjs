// Pins migration 0170 (product-merge lineage evidence repair) against a
// small SYNTHETIC fixture built on the REAL migration chain (better-sqlite3,
// no production data). See
// migrations/0170_product_merge_lineage_evidence_repair.sql and
// lib/productMergeLineage.ts (Sentry BUSINESS-OS-1F: migrations 0165/0168
// reparented sale_items.product_id via raw SQL without writing the
// product.merge undo_snapshots evidence the lineage resolver requires).
//
// Run: node scripts/test-migration-0170-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0170 = fs.readFileSync(path.join(migrationsDir, '0170_product_merge_lineage_evidence_repair.sql'), 'utf8')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)

// -- Fixture: a 0165-style loser/keeper pair whose sale_item was reparented
// by the migration (product_id already reads the keeper) but which never
// got a product.merge undo_snapshots row -- reproducing the exact
// production gap, without depending on 0165's own eligibility scan.
db.prepare(`INSERT INTO product_merge_map_0165 (loser_id, keeper_id, name_key, loser_json)
  VALUES (9091, 4227, 'maybelline matte liquid lipstick new 125', '{"id":9091,"name":"Maybelline Matte Liquid Lipstick New 125"}')`).run()
db.prepare("INSERT INTO sales (id, receipt_number) VALUES (17039, 'R-17039')").run()
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, pricing_snapshot_json)
  VALUES (40587, 17039, 4227, 'Maybelline Matte Liquid Lipstick New 125', 1,
    '{"line_key":"L1","pool":{"lines":[{"line_key":"L1","product":{"id":9091}}]}}')`).run()

// A second, 0168-style pair. This item's evidence gap is left EXACTLY as
// production reported it -- no undo_snapshots row mentions sale_item 40611.
db.prepare(`INSERT INTO product_merge_map_0168 (loser_id, keeper_id, name_key, loser_json)
  VALUES (7510, 7509, 'dior rouge blush 212', '{"id":7510,"name":"Dior Rouge Blush 212"}')`).run()
db.prepare("INSERT INTO sales (id, receipt_number) VALUES (17042, 'R-17042')").run()
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, pricing_snapshot_json)
  VALUES (40611, 17042, 7509, 'Dior Rouge Blush 212', 1,
    '{"line_key":"L2","pool":{"lines":[{"line_key":"L2","product":{"id":7510}}]}}')`).run()

// A third sale_item already carries VALID prior evidence (as a normal
// foldDuplicateProductInto merge would have written) -- the repair must
// never duplicate it.
db.prepare(`INSERT INTO product_merge_map_0165 (loser_id, keeper_id, name_key, loser_json)
  VALUES (500, 600, 'already evidenced', '{}')`).run()
db.prepare("INSERT INTO sales (id, receipt_number) VALUES (900, 'R-900')").run()
db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, pricing_snapshot_json)
  VALUES (9001, 900, 600, 'Already Evidenced', 1,
    '{"line_key":"L3","pool":{"lines":[{"line_key":"L3","product":{"id":500}}]}}')`).run()
db.prepare(`INSERT INTO undo_snapshots (kind, status, payload_json)
  VALUES ('product.merge','applied',?)`).run([JSON.stringify({ dupId: 500, keeperId: 600, reparentedSaleItemIds: [9001] })])

// -- Positive control: reproduce the production defect before the repair --
// no evidence yet covers sale_items 40587 or 40611, while 9001 already has
// its own (pre-existing, non-repair) evidence.
function evidenceCount(saleItemId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM undo_snapshots u
    WHERE u.kind IN ('product.merge','product.merge.bulk','product.merge.group.child')
      AND u.status = 'applied' AND json_valid(u.payload_json) = 1
      AND (
        (u.kind IN ('product.merge','product.merge.group.child')
          AND EXISTS (SELECT 1 FROM json_each(u.payload_json, '$.reparentedSaleItemIds') i WHERE i.value = @id))
        OR (u.kind = 'product.merge.bulk'
          AND EXISTS (SELECT 1 FROM json_each(u.payload_json, '$.reversals') r,
                        json_each(r.value, '$.reparentedSaleItemIds') i WHERE i.value = @id))
      )
  `).get({ id: saleItemId }).n
}
assert.strictEqual(evidenceCount(40587), 0, 'positive control: sale_item 40587 reproduces the production gap before repair')
assert.strictEqual(evidenceCount(40611), 0, 'positive control: sale_item 40611 reproduces the production gap before repair')
assert.strictEqual(evidenceCount(9001), 1, 'sale_item 9001 already has its own (non-repair) evidence')

// -- Run the repair --
db.exec(sql0170)

assert.strictEqual(evidenceCount(40587), 1, 'repair-0170 wrote evidence for sale_item 40587')
assert.strictEqual(evidenceCount(40611), 1, 'repair-0170 wrote evidence for sale_item 40611')
assert.strictEqual(evidenceCount(9001), 1, 'already-evidenced sale_item 9001 was not duplicated')

const row = db.prepare(`SELECT * FROM undo_snapshots
  WHERE kind='product.merge' AND status='applied' AND json_valid(payload_json)=1
    AND json_extract(payload_json,'$.source')='repair-0170'
    AND EXISTS (SELECT 1 FROM json_each(payload_json,'$.reparentedSaleItemIds') i WHERE i.value=40587)`).get()
assert.ok(row, 'a repair-0170 evidence row exists for sale_item 40587')
const payload = JSON.parse(row.payload_json)
assert.strictEqual(payload.dupId, 9091, 'evidence records the captured (loser) product id')
assert.strictEqual(payload.keeperId, 4227, 'evidence records the live (keeper) product id')
assert.deepStrictEqual(payload.reparentedSaleItemIds, [40587], 'evidence names exactly the reparented sale_item')

// The temp working table must not survive the migration.
assert.strictEqual(
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='product_merge_lineage_repair_0170'").get().n,
  0,
  'the temporary repair table is dropped',
)

// -- Idempotence: a second run adds nothing further --
const before = db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE json_extract(payload_json,'$.source')='repair-0170'").get().n
db.exec(sql0170)
const after = db.prepare("SELECT COUNT(*) AS n FROM undo_snapshots WHERE json_extract(payload_json,'$.source')='repair-0170'").get().n
assert.strictEqual(after, before, 'second run is a no-op')
assert.strictEqual(evidenceCount(40587), 1, 'no duplicate evidence for 40587 after a second run')
assert.strictEqual(evidenceCount(40611), 1, 'no duplicate evidence for 40611 after a second run')

console.log('OK test-migration-0170-pure.cjs')
