// A fresh deployment is the one world every data migration was never written
// against: the whole chain applied, in order, to an EMPTY database. The two
// existing chain-applying tests (lot-ledger reconcile, stock-in invoice
// report) stop at a specific migration to seed a "before" world; nothing
// pinned the full chain itself, so a migration that breaks only on empty
// tables (or only in combination with a later one) would first fail on a real
// `wrangler d1 migrations apply` against a new environment.
//
// Same method as the rest of the suite: the real files, real SQLite (the
// engine D1 runs), executed in filename order exactly as wrangler does.
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

const sqlite = new Database(':memory:')

check('every migration applies in order to an empty database', () => {
  assert.ok(migrationFiles.length >= 84, `expected the full chain, found ${migrationFiles.length} files`)
  for (const file of migrationFiles) {
    try {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    } catch (error) {
      throw new Error(`${file} failed on a fresh database: ${error.message}`)
    }
  }
})

check('the schema passes SQLite integrity_check after the full chain', () => {
  const row = sqlite.prepare('PRAGMA integrity_check').get()
  assert.strictEqual(row.integrity_check, 'ok')
})

check('the tables every core surface reads from all exist', () => {
  const tables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  )
  const required = [
    'products', 'branch_stock', 'branch_batch_stock', 'product_batches',
    'sales', 'sale_items', 'sale_item_batch_allocations',
    'returns', 'return_items', 'return_item_batch_allocations',
    'customers', 'suppliers', 'delivery_contacts', 'branches',
    'users', 'user_sessions', 'import_jobs', 'inventory_movements', 'settings',
  ]
  const missing = required.filter((t) => !tables.has(t))
  assert.deepStrictEqual(missing, [], `missing core tables: ${missing.join(', ')}`)
})

let branchId = 0
let productId = 0
let batchId = 0

check('branch_stock refuses a negative quantity (oversell CHECK survives the chain)', () => {
  sqlite.exec("INSERT INTO branches (name) VALUES ('Test Branch')")
  branchId = sqlite.prepare('SELECT last_insert_rowid() AS id').get().id
  sqlite.exec("INSERT INTO products (name) VALUES ('Test Product')")
  productId = sqlite.prepare('SELECT last_insert_rowid() AS id').get().id
  sqlite.prepare('INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES (?, ?, 1)').run(branchId, productId)
  assert.throws(
    () => sqlite.prepare('UPDATE branch_stock SET quantity = quantity - 2 WHERE branch_id = ? AND product_id = ?').run(branchId, productId),
    /CHECK constraint failed/,
    'a concurrent oversell must abort, not clamp',
  )
  const qty = sqlite.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ?').get(branchId, productId)
  assert.strictEqual(qty.quantity, 1, 'the failed oversell must leave stock untouched')
})

check('branch_batch_stock refuses a negative quantity (per-lot CHECK survives the chain)', () => {
  const batchCols = sqlite.prepare('PRAGMA table_info(product_batches)').all().map((r) => r.name)
  assert.ok(batchCols.includes('received_cost_usd'), 'migration 0080 column present')
  sqlite.prepare("INSERT INTO product_batches (variant_product_id, batch_key) VALUES (?, '08302026')").run(productId)
  batchId = sqlite.prepare('SELECT last_insert_rowid() AS id').get().id
  sqlite.prepare('INSERT INTO branch_batch_stock (branch_id, batch_id, quantity) VALUES (?, ?, 1)').run(branchId, batchId)
  assert.throws(
    () => sqlite.prepare('UPDATE branch_batch_stock SET quantity = quantity - 2 WHERE branch_id = ? AND batch_id = ?').run(branchId, batchId),
    /CHECK constraint failed/,
  )
})

check('write-time search columns from migration 0082 exist on sales and returns', () => {
  for (const table of ['sales', 'returns']) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
    assert.ok(cols.includes('search_normalized'), `${table}.search_normalized missing`)
  }
})

check('no declared foreign key dangles after the full chain', () => {
  const rows = sqlite.prepare('PRAGMA foreign_key_check').all()
  assert.deepStrictEqual(rows, [], `foreign_key_check reported: ${JSON.stringify(rows.slice(0, 5))}`)
})

console.log(`\n${passed} checks passed (${migrationFiles.length} migrations in the chain)`)
