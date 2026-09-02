const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const root = path.resolve(__dirname, '..')
const migration = (name) => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')
const db = new Database(':memory:')

try {
  db.exec(migration('0001_init.sql'))
  // 0084's production migration also updates a later-created audit table;
  // this focused harness needs only the schema prerequisite used by 0088.
  db.exec('ALTER TABLE inventory_movements ADD COLUMN batch_id INTEGER;')
  db.exec(migration('0088_legacy_finance_and_audit_ledgers.sql'))
  db.exec(migration('0090_legacy_inventory_effect_stock_guard.sql'))
  db.exec(migration('0092_legacy_inventory_effect_guard_idempotency.sql'))
  db.exec(migration('0101_legacy_inventory_effect_historical_cost.sql'))

  db.exec(`
    INSERT INTO branches (id,name) VALUES (1,'Shop');
    INSERT INTO products (id,name,cost_price_usd,cost_price_khr,stock_quantity) VALUES (10,'Historical item',9,36000,5);
    INSERT INTO branch_stock (product_id,branch_id,quantity) VALUES (10,1,5);
    INSERT INTO product_batches (id,variant_product_id,batch_key) VALUES (20,10,'opening');
    INSERT INTO branch_batch_stock (batch_id,branch_id,quantity) VALUES (20,1,5);
  `)

  db.prepare(`INSERT INTO legacy_inventory_effects
    (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at,unit_cost_usd,unit_cost_khr)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('legacy-sale:test:0', 10, 1, 20, -2, 2, 'sale', 'Historical sale', 99, '2026-09-01T01:00:00.000Z', 2.5, 0)

  const movement = db.prepare("SELECT unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr FROM inventory_movements WHERE reason='Historical sale'").get()
  assert.deepEqual(movement, { unit_cost_usd: 2.5, unit_cost_khr: 0, total_cost_usd: 5, total_cost_khr: 0 })
  assert.equal(db.prepare('SELECT cost_price_usd FROM products WHERE id=10').pluck().get(), 9, 'historical movement must not mutate catalog cost')
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id=10').pluck().get(), 3)
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').pluck().get(), 3)
  assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=20 AND branch_id=1').pluck().get(), 3)

  db.prepare(`INSERT INTO legacy_inventory_effects
    (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('legacy-transfer:test:in', 10, 1, 20, 1, 1, 'transfer_in', 'Transfer without source cost', 100, '2026-09-01T02:00:00.000Z')
  const fallback = db.prepare("SELECT unit_cost_usd,total_cost_usd FROM inventory_movements WHERE reason='Transfer without source cost'").get()
  assert.deepEqual(fallback, { unit_cost_usd: 9, total_cost_usd: 9 }, 'cost-less transfer keeps the explicit catalog fallback')

  console.log('PASS legacy inventory effects preserve historical sale cost without mutating catalog cost')
} finally {
  db.close()
}
