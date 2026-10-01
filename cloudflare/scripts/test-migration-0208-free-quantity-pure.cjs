// Pins migration 0208 (inventory_movements.free_quantity) on the REAL migration
// chain (better-sqlite3, synthetic rows, no production data).
//
//  1. The column does not exist before 0208; it exists after, NOT NULL, default 0.
//  2. Pre/post assertions from the file's header: 0 rows before, 1 column after,
//     and no historical movement gets a non-zero free count.
//  3. Existing movements keep every other value.
//  4. The file is LF-only, is the only file claiming number 0208, and sorts
//     after the audit-log indexes (0207) so the chain stays append-only.
//  5. The documented recovery drops the column and leaves stock untouched.
//
// Run: node scripts/test-migration-0208-free-quantity-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0208_inventory_movements_free_quantity.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
check('0208 is the only file claiming that number', files.filter((f) => f.startsWith('0208_')).length === 1)
check('0208 comes after 0207 and nothing claims the old 0206 slot for this change', files.indexOf(FILE) > files.indexOf('0207_audit_logs_indexes.sql') && !files.some((f) => /^0206_.*free_quantity/.test(f)))
check('0208 is LF-only', !migration.includes('\r'))

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const file of files.filter((f) => f < FILE)) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))

const columnCount = () => db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('inventory_movements') WHERE name = 'free_quantity'").get().n
check('pre-assert: the column does not exist before 0208', columnCount() === 0)

db.prepare("INSERT INTO products (id, name, barcode, stock_quantity, is_active) VALUES (1, 'Gloss', '885', 12, 1)").run()
db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Shop')").run()
const movementColumns = db.prepare("SELECT name FROM pragma_table_info('inventory_movements')").all().map((row) => row.name)
db.prepare(`INSERT INTO inventory_movements (product_id, branch_id, quantity, unit_cost_usd, total_cost_usd, reason) VALUES (1, 1, 12, 3.5, 35, 'receive')`).run()
const before = db.prepare('SELECT * FROM inventory_movements').all()
check('a historical movement exists to check against', before.length === 1 && movementColumns.includes('quantity'))

db.exec(migration)
check('post-assert: the column exists after 0208', columnCount() === 1)
const info = db.prepare("SELECT type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('inventory_movements') WHERE name = 'free_quantity'").get()
check('the column is INTEGER NOT NULL DEFAULT 0', info.type === 'INTEGER' && info.nn === 1 && String(info.dflt) === '0')
check('post-assert: no historical movement carries free units', db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE free_quantity <> 0').get().n === 0)
const after = db.prepare('SELECT * FROM inventory_movements').all()
const { free_quantity: _free, ...rest } = after[0]
check('the historical movement keeps every other value', JSON.stringify(rest) === JSON.stringify(before[0]))

db.exec('ALTER TABLE inventory_movements DROP COLUMN free_quantity')
check('documented recovery drops the column', columnCount() === 0)
check('recovery leaves the movement and stock untouched', JSON.stringify(db.prepare('SELECT * FROM inventory_movements').all()) === JSON.stringify(before) && db.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity === 12)

console.log(`\n${checks} check(s) passed.`)
