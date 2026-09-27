// Pins migration 0197: the three product FTS update triggers fire only when a
// column THEIR index holds (or the rowid) actually changes.
//
// On the REAL migration chain (better-sqlite3, synthetic rows):
//  1. Each trigger's UPDATE OF list is exactly its FTS table's columns + id
//     (read from the live virtual-table definitions, not hard-coded).
//  2. A stock-only UPDATE does not touch any FTS shadow table after 0197;
//     POSITIVE CONTROL: the same UPDATE rewrites all three before 0197.
//  3. A no-op text UPDATE (SET name = name) does not re-index either.
//  4. Every indexed column, changed alone, still re-indexes: the new token is
//     found, the old one is gone, in each table that holds that column.
//     Includes a rename, NULL -> value and value -> NULL, and an id change.
//  5. A mixed text+stock UPDATE re-indexes.
//  6. FTS5 integrity-check passes on all three tables after the whole run.
//  7. Idempotent re-apply; LF-only.
//
// Run: node scripts/test-migration-0197-products-fts-text-triggers-pure.cjs

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0197_products_fts_text_update_triggers.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')
const TABLES = ['products_fts', 'products_fts_code', 'products_fts_name_trigram']
const TRIGGERS = { products_fts: 'products_fts_au', products_fts_code: 'products_fts_code_au', products_fts_name_trigram: 'products_fts_name_trigram_au' }

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

function buildDb({ apply0197 }) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < FILE)) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  if (apply0197) db.exec(migration)
  const insert = db.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1)`)
  for (let i = 1; i <= 40; i++) insert.run(i, `Rose Glow Serum ${i}`, `SKU${i}`, `88000000${String(i).padStart(5, '0')}`, 'Glowco', 'Face', 'Acme', 'Hydrating serum', 'pcs')
  return db
}

const shadowHash = (db) => {
  const h = crypto.createHash('sha256')
  for (const t of TABLES) for (const row of db.prepare(`SELECT id, block FROM ${t}_data ORDER BY id`).all()) h.update(`${t}:${row.id}:`).update(row.block || Buffer.alloc(0))
  return h.digest('hex')
}
// Membership in the MATCH result set. (Not `AND rowid = ?`: better-sqlite3 binds a JS
// number as REAL, and FTS5 then does not apply the rowid constraint.)
const ftsHas = (db, table, query, id) => db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`).all(query).some((r) => r.rowid === id)
const ftsColumns = (db, table) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table).sql
  return sql.slice(sql.indexOf('(') + 1).split(',').map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s))
}
const triggerUpdateOf = (db, name) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?").get(name).sql
  const m = sql.match(/AFTER UPDATE OF ([^\n]+?) ON products/)
  return m ? m[1].split(',').map((s) => s.trim()) : null
}

// ---- 1. column lists --------------------------------------------------
const db = buildDb({ apply0197: true })
for (const table of TABLES) {
  const cols = ftsColumns(db, table)
  const updateOf = triggerUpdateOf(db, TRIGGERS[table])
  check(`${TRIGGERS[table]} fires on exactly id + ${table}'s columns (${cols.join(', ')})`,
    updateOf && JSON.stringify([...updateOf].sort()) === JSON.stringify(['id', ...cols].sort()))
}

// ---- 2 + 3. stock-only / no-op updates do not re-index ------------------
{
  const control = buildDb({ apply0197: false })
  const before = shadowHash(control)
  control.prepare('UPDATE products SET stock_quantity = stock_quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (1, 2, 3, 4, 5)').run()
  check('POSITIVE CONTROL: before 0197 a stock-only UPDATE rewrites the FTS shadow tables', shadowHash(control) !== before)
}
{
  const before = shadowHash(db)
  db.prepare('UPDATE products SET stock_quantity = stock_quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (1, 2, 3, 4, 5)').run()
  check('after 0197 a stock-only UPDATE leaves every FTS shadow table untouched', shadowHash(db) === before)
  db.prepare('UPDATE products SET name = name, sku = sku, barcode = barcode, stock_quantity = 3 WHERE id = 6').run()
  check('after 0197 a no-op text UPDATE (same values) does not re-index', shadowHash(db) === before)
}

// ---- 4. every indexed column still re-indexes --------------------------
const cases = [
  // [column, new value, query that must now match, query that must stop matching, tables holding it]
  ['name', 'Velvet Matte Lipstick 7', 'velvet', 'glow', ['products_fts', 'products_fts_name_trigram']],
  ['sku', 'QZX-778', 'qzx', 'sku7', ['products_fts']],
  ['barcode', '5551234567890', '5551234567890', '8800000000007', ['products_fts']],
  ['brand', 'Lunaria', 'lunaria', 'glowco', ['products_fts']],
  ['category', 'Lips', 'lips', 'face', ['products_fts']],
  ['supplier', 'Borealis', 'borealis', 'acme', ['products_fts']],
  ['description', 'Long wearing formula', 'wearing', 'hydrating', ['products_fts']],
  ['unit', 'tube', 'tube', 'pcs', ['products_fts']],
]
cases.forEach(([column, value, found, gone, tables], index) => {
  const id = 7 + index
  const oldValue = db.prepare(`SELECT ${column} v FROM products WHERE id = ?`).get(id).v
  const scoped = (q) => `${column}:${q}`
  const goneQuery = column === 'sku' ? `sku:${String(oldValue).toLowerCase()}` : column === 'barcode' ? `barcode:${oldValue}` : scoped(gone)
  check(`[${column}] fixture: old value indexed before the edit`, ftsHas(db, 'products_fts', goneQuery, id))
  db.prepare(`UPDATE products SET ${column} = ? WHERE id = ?`).run(value, id)
  for (const table of tables) {
    if (table === 'products_fts') {
      check(`[${column}] products_fts finds the new value`, ftsHas(db, table, scoped(found), id))
      check(`[${column}] products_fts no longer finds the old value`, !ftsHas(db, table, goneQuery, id))
    } else {
      check(`[${column}] ${table} finds the new value by substring`, ftsHas(db, table, '"lvet"', id))
      check(`[${column}] ${table} no longer finds the old value`, !ftsHas(db, table, '"glow"', id))
    }
  }
})
// barcode/sku in the trigram code table
db.prepare("UPDATE products SET barcode = '4449990001112', sku = 'ZZTOP-1' WHERE id = 20").run()
check('[barcode+sku] products_fts_code finds the new barcode fragment', ftsHas(db, 'products_fts_code', '"999000"', 20))
check('[barcode+sku] products_fts_code finds the new sku fragment', ftsHas(db, 'products_fts_code', '"ztop"', 20))
check('[barcode+sku] products_fts_code dropped the old barcode', !ftsHas(db, 'products_fts_code', '"8800000000020"', 20))
// NULL transitions
db.prepare('UPDATE products SET brand = NULL WHERE id = 21').run()
check('[brand -> NULL] old brand no longer indexed', !ftsHas(db, 'products_fts', 'brand:glowco', 21))
db.prepare("UPDATE products SET brand = 'Nimbus' WHERE id = 21").run()
check('[NULL -> brand] new brand indexed', ftsHas(db, 'products_fts', 'brand:nimbus', 21))
// id change moves the rowid in all three tables
db.prepare('UPDATE products SET id = 900 WHERE id = 22').run()
for (const [table, q] of [['products_fts', 'serum'], ['products_fts_code', '"sku22"'], ['products_fts_name_trigram', '"serum 22"']]) {
  check(`[id change] ${table} moved the entry to the new rowid`, ftsHas(db, table, q, 900) && !ftsHas(db, table, q, 22))
}

// ---- 5. mixed text + stock update --------------------------------------
db.prepare("UPDATE products SET name = 'Amber Night Cream', stock_quantity = 0 WHERE id = 23").run()
check('[name + stock] mixed UPDATE re-indexes the name', ftsHas(db, 'products_fts', 'name:amber', 23) && ftsHas(db, 'products_fts_name_trigram', '"mber"', 23))

// ---- 6. integrity -------------------------------------------------------
for (const table of TABLES) {
  let ok = true
  try { db.prepare(`INSERT INTO ${table}(${table}, rank) VALUES('integrity-check', 1)`).run() } catch (e) { ok = false; console.log(e.message) }
  check(`${table} integrity-check against products passes`, ok)
}

// ---- 7. idempotent + LF -------------------------------------------------
db.exec(migration)
check('re-applying 0197 is idempotent (3 triggers, still UPDATE OF)', TABLES.every((t) => triggerUpdateOf(db, TRIGGERS[t])))
check('0197 is LF-only', !migration.includes('\r'))

console.log(`\n${checks} checks passed`)
