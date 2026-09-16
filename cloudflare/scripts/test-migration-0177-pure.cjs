// Pins migration 0177 (product_cost_entries -- a durable record of manual
// cost-price edits) on the REAL migration chain.
//
// Run: node scripts/test-migration-0177-pure.cjs
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

function fresh() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const migration of loadAll()) db.exec(migration)
  return db
}

function tableExists(db, name) {
  return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(name).c === 1
}
function indexExists(db, name) {
  return db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name=?").get(name).c === 1
}

// Full chain: table and index present, table starts empty (no backfill --
// past manual edits left no trace to recover).
{
  const db = fresh()
  assert.strictEqual(tableExists(db, 'product_cost_entries'), true, 'product_cost_entries table exists after the full chain')
  assert.strictEqual(indexExists(db, 'idx_product_cost_entries_product'), true, 'its product index exists')
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_cost_entries').get().c, 0, 'no backfill rows')
  db.close()
}

// A row can actually be written and read back with the columns the writer needs.
{
  const db = fresh()
  db.prepare(`INSERT INTO product_cost_entries (product_id, cost_usd, cost_khr, source, user_id, user_name, baseline_batch_id)
    VALUES (5, 9, 36000, 'manual', 7, 'sethy', 42)`).run()
  const row = db.prepare('SELECT product_id, cost_usd, cost_khr, source, user_id, user_name, baseline_batch_id, created_at FROM product_cost_entries WHERE product_id = 5').get()
  assert.strictEqual(row.product_id, 5)
  assert.strictEqual(row.cost_usd, 9)
  assert.strictEqual(row.cost_khr, 36000)
  assert.strictEqual(row.source, 'manual')
  assert.strictEqual(row.user_id, 7)
  assert.strictEqual(row.user_name, 'sethy')
  assert.strictEqual(row.baseline_batch_id, 42)
  assert.ok(row.created_at, 'created_at defaults')
  db.close()
}

// baseline_batch_id defaults to 0 (no lots yet) when the writer omits it.
{
  const db = fresh()
  db.prepare(`INSERT INTO product_cost_entries (product_id, cost_usd, source) VALUES (6, 3, 'manual')`).run()
  const row = db.prepare('SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = 6').get()
  assert.strictEqual(row.baseline_batch_id, 0, 'DEFAULT 0 -- a product with no lots yet overrides against nothing')
  db.close()
}

// Re-run: no-op (IF NOT EXISTS), table/index still there, no duplicate DDL error.
{
  const db = fresh()
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'migrations', '0177_product_cost_entries.sql'), 'utf8')
  db.exec(sql)
  db.exec(sql)
  assert.strictEqual(tableExists(db, 'product_cost_entries'), true)
  assert.strictEqual(indexExists(db, 'idx_product_cost_entries_product'), true)
  db.close()
}

// Empty DB (just this migration's own SQL on a blank :memory: connection): no-op, table created, 0 rows.
{
  const db = new Database(':memory:')
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'migrations', '0177_product_cost_entries.sql'), 'utf8')
  db.exec(sql)
  assert.strictEqual(tableExists(db, 'product_cost_entries'), true)
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM product_cost_entries').get().c, 0)
  db.close()
}

console.log('test-migration-0177-pure: ok (table + index present after the full chain, row round-trips, idempotent, empty-DB no-op)')
