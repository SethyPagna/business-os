// Pins migration 0175 (catalog cost recompute backfill) on a SYNTHETIC
// fixture over the REAL migration chain. This pins the historical backfill,
// not the later prospective catalog rule in test-catalog-cost-recompute-native.cjs.
//
// Run: node scripts/test-migration-0175-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0175 = fs.readFileSync(path.join(migrationsDir, '0175_catalog_cost_recompute_backfill.sql'), 'utf8')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)

const P = db.prepare('INSERT INTO products (id, name, is_active, cost_price_usd, purchase_price_usd, cost_price_khr) VALUES (?, ?, ?, ?, 0, ?)')
const L = db.prepare('INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, unit_cost_usd) VALUES (?, ?, ?, ?, ?)')
let lot = 1
const lots = (pid, costs, active = 1) => costs.forEach((c) => L.run(lot++, pid, 'k' + lot, active, c))

P.run(1, 'mean', 1, 3, 12000);        lots(1, [3, 5])            // 4.00, KHR untouched
P.run(2, 'dedup', 1, 9, 0);           lots(2, [5, 5, 7])         // (5+7)/2 = 6
P.run(3, 'zero excluded', 1, 1, 0);   lots(3, [0, 8, null])      // 8
P.run(4, 'inactive excluded', 1, 2, 0); lots(4, [10]); lots(4, [40], 0) // 10 (inactive 40 ignored)
P.run(5, 'outlier', 1, 1, 0);         lots(5, [5, 200])          // 200 > 2*5 -> 200
P.run(6, 'no costed lot', 1, 7.5, 0); lots(6, [0])               // untouched
P.run(7, 'no lot', 1, 2.25, 0)                                    // untouched
P.run(8, 'inactive product', 0, 1, 0); lots(8, [9])               // untouched
P.run(9, 'already right', 1, 4, 0);   lots(9, [4])                // purchase mirror only
P.run(10, 'rounding', 1, 0, 0);       lots(10, [1.1, 1.2, 1.4])     // 3.7/3 = 1.2333

db.exec(sql0175)

const row = (id) => db.prepare('SELECT cost_price_usd c, purchase_price_usd p, cost_price_khr k FROM products WHERE id = ?').get(id)
assert.deepStrictEqual(row(1), { c: 4, p: 4, k: 12000 })
assert.deepStrictEqual(row(2), { c: 6, p: 6, k: 0 })
assert.deepStrictEqual(row(3), { c: 8, p: 8, k: 0 })
assert.deepStrictEqual(row(4), { c: 10, p: 10, k: 0 })
assert.deepStrictEqual(row(5), { c: 200, p: 200, k: 0 })
assert.deepStrictEqual(row(6), { c: 7.5, p: 0, k: 0 }, 'no costed lot: untouched')
assert.deepStrictEqual(row(7), { c: 2.25, p: 0, k: 0 }, 'no lot: untouched')
assert.deepStrictEqual(row(8), { c: 1, p: 0, k: 0 }, 'inactive product: untouched')
assert.deepStrictEqual(row(9), { c: 4, p: 4, k: 0 }, 'purchase mirrored')
assert.deepStrictEqual(row(10), { c: 1.2333, p: 1.2333, k: 0 })

const work = db.prepare('SELECT product_id id, cost_before b, cost_after a, applied FROM catalog_cost_recompute_0175 ORDER BY product_id').all()
assert.deepStrictEqual(work.map((w) => w.id), [1, 2, 3, 4, 5, 9, 10])
assert.ok(work.every((w) => w.applied === 1))
assert.strictEqual(work.find((w) => w.id === 5).b, 1)
const snap = db.prepare("SELECT payload_json FROM undo_snapshots WHERE kind = 'catalog.cost_recompute_backfill'").all()
assert.strictEqual(snap.length, 1)
const payload = JSON.parse(snap[0].payload_json)
assert.strictEqual(payload.products.length, 7)
assert.deepStrictEqual(payload.products.find((p) => p.id === 1), { id: 1, cost_before: 3, purchase_before: 0, cost_after: 4 })
const audit = JSON.parse(db.prepare("SELECT details FROM audit_logs WHERE action = 'catalog_cost_recompute_backfill'").get().details)
assert.deepStrictEqual(audit, { source: 'repair-0175', products: 7, cost_changed: 6 })

// Second run: nothing differs any more -> no-op.
db.exec(sql0175)
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM catalog_cost_recompute_0175').get().c, 7)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM undo_snapshots WHERE kind = 'catalog.cost_recompute_backfill'").get().c, 1)
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'catalog_cost_recompute_backfill'").get().c, 1)

// Historical migration remains immutable: its outlier rule is intentional
// even though prospective receipts now use every distinct positive price.
// Runtime behavior has separate native catalog/receipt coverage; never edit
// this historical migration to match a later business-rule change.
assert.match(sql0175, /WHEN MAX\(cost\) > 2 \* MIN\(cost\) THEN MAX\(cost\) ELSE ROUND\(SUM\(cost\) \* 1\.0 \/ COUNT\(\*\), 4\)/)

console.log('test-migration-0175-pure: ok (mean/dedup/zero/inactive/outlier/rounding, untouched rows, purchase mirror, snapshot, idempotent)')
