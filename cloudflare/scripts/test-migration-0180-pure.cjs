// Pins migration 0180 (index sale_item_batch_allocations by batch_id) on the
// REAL migration chain: the index is absent before, present after, on the
// column the header names, and the migration is schema-only -- it touches
// zero rows anywhere in the database.
//
// Run: node scripts/test-migration-0180-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const INDEX_NAME = 'idx_sale_item_batch_allocations_batch'

function loadUpTo(maxNumber) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => Number(f.slice(0, 4)) <= maxNumber)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

const migration0180Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0180_sale_item_batch_allocations_batch_index.sql'), 'utf8')

function indexInfo(db, name) {
  return db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='index' AND name=?").get(name)
}

function seeded() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const m of loadUpTo(179)) db.exec(m)

  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (1, 'Alice', 'LC-00001')`).run()
  db.prepare(`INSERT INTO sales (id, receipt_number, total_usd) VALUES (1, 'R1', 10)`).run()
  db.prepare(`INSERT INTO branches (id, name) VALUES (1, 'Main')`).run()
  const cols = db.prepare("PRAGMA table_info(sale_item_batch_allocations)").all().map((c) => c.name)
  assert.ok(cols.includes('batch_id'), 'sale_item_batch_allocations has a batch_id column to index')
  if (cols.includes('sale_item_id')) {
    db.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, quantity) VALUES (1, 7, 3)`).run()
  }

  return db
}

function fullSnapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
  const snapshot = {}
  for (const t of tables) {
    snapshot[t] = db.prepare(`SELECT * FROM "${t}"`).all()
  }
  return snapshot
}

// --- PRE: index does not exist yet ------------------------------------------
{
  const db = seeded()
  assert.strictEqual(indexInfo(db, INDEX_NAME), undefined, 'PRE: the index does not exist before 0180 runs')
  db.close()
}

// --- POST: index exists, on the right table/column, and no row anywhere moved
{
  const db = seeded()
  const before = fullSnapshot(db)

  db.exec(migration0180Sql)

  const info = indexInfo(db, INDEX_NAME)
  assert.ok(info, 'POST: the index exists after 0180 runs')
  assert.strictEqual(info.tbl_name, 'sale_item_batch_allocations', 'the index is on sale_item_batch_allocations')
  assert.ok(/\(\s*batch_id\s*\)/.test(info.sql), 'the index is on the batch_id column the header names')

  const after = fullSnapshot(db)
  assert.deepStrictEqual(after, before, 'schema-only migration: no row anywhere is inserted, updated or deleted')

  db.close()
}

// --- Re-run: idempotent (IF NOT EXISTS) -------------------------------------
{
  const db = seeded()
  db.exec(migration0180Sql)
  db.exec(migration0180Sql)
  assert.ok(indexInfo(db, INDEX_NAME), 'index still present after a second run, no duplicate-index error')
  db.close()
}

console.log('test-migration-0180-pure: ok (index absent before, present after on batch_id, schema-only -- zero rows touched, idempotent)')
