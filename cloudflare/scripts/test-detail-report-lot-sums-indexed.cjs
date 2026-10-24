// 6.0.970: the product detail report (and its supplier-purchases drill-down) summed
// branch_batch_stock for ALL lots (`GROUP BY batch_id` over the whole table, ~48k rows) to answer for one
// product's few lots. The grouped subquery is now restricted to this product's lots, which SQLite answers
// from idx_branch_batch_stock_batch_branch_unique (batch_id, branch_id).
//
// Proves, on a fixture with many other products' lots and multi-branch stock: the old (whole table) and new
// (restricted) forms return identical per-lot quantities for every product (including lots with no stock rows,
// NULL quantities and multi-branch sums), the executed plan never scans branch_batch_stock, the old plan does
// (control), and all three route queries carry the restricted form.
//
// Run: node scripts/test-detail-report-lot-sums-indexed.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const OLD_INNER = 'SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id'
const NEW_INNER = 'SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id = @productId) GROUP BY batch_id'

const source = fs.readFileSync(path.join(__dirname, '../src/routes/products.ts'), 'utf8')
assert.ok(!source.includes(OLD_INNER), 'no whole-table per-lot sum remains in products.ts')
assert.equal(source.split(NEW_INNER).length - 1, 3, 'detail-report suppliers + batches and supplier-purchases all use the restricted sum')

const db = new DatabaseSync(':memory:')
for (const sql of loadAll({ through: 242 })) db.exec(sql)
db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1)")
db.exec('BEGIN IMMEDIATE')
db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
let lotId = 0
for (let productId = 1; productId <= 40; productId += 1) {
  for (let n = 0; n < 1 + (productId % 4); n += 1) {
    lotId += 1
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at) VALUES(?,?,?,1,?)').run(lotId, productId, `k${lotId}`, '2026-10-01')
    if (lotId % 7 === 0) continue                                    // a lot with no stock rows at all
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(lotId, lotId % 5)
    if (lotId % 3 === 0) db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,2,?)').run(lotId, lotId % 4)
  }
}
db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
db.exec('COMMIT')

const query = (inner) => `SELECT pb.id, bbs.qty FROM product_batches pb LEFT JOIN (${inner}) bbs ON bbs.batch_id = pb.id
  WHERE pb.variant_product_id = @productId ORDER BY pb.id`
const run = (sql, productId, explain) => {
  const statement = db.prepare(`${explain ? 'EXPLAIN QUERY PLAN ' : ''}${sql}`)
  return statement.all({ productId })
}

let compared = 0
for (let productId = 1; productId <= 40; productId += 1) {
  const before = run(query(OLD_INNER).replace(/@productId/g, '@productId'), productId, false)
  const after = run(query(NEW_INNER), productId, false)
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)), `product ${productId}`)
  compared += before.length
}
assert.ok(compared >= lotId, 'every lot compared')
assert.ok(db.prepare('SELECT COUNT(*) AS n FROM branch_batch_stock WHERE quantity=0').get().n > 0, 'fixture includes zero quantities')

const planOf = (inner) => run(query(inner), 5, true).map((row) => row.detail)
const oldPlan = planOf(OLD_INNER), newPlan = planOf(NEW_INNER)
assert.ok(oldPlan.some((detail) => /SCAN (branch_batch_stock|bbs)/.test(detail) || /SCAN branch_batch_stock/.test(detail)), `control: old form scans the table (${oldPlan.join(' | ')})`)
assert.ok(!newPlan.some((detail) => /SCAN branch_batch_stock/.test(detail)), `new form never scans branch_batch_stock (${newPlan.join(' | ')})`)
assert.ok(newPlan.some((detail) => /SEARCH branch_batch_stock USING (COVERING )?INDEX/.test(detail)), `new form seeks by index (${newPlan.join(' | ')})`)
console.log(`PASS lot sums identical for 40 products (${compared} lots), indexed plan`)
