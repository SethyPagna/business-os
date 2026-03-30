/**
 * STANDALONE DATABASE MIGRATION SCRIPT
 * Run once: node fix-database.js
 * Adds missing columns to your existing database without deleting any data.
 */
const path = require('path')
const os   = require('os')
const fs   = require('fs')

// Find the database - same path Electron uses
const platform = process.platform
let userDataPath
if (platform === 'win32')  userDataPath = path.join(process.env.APPDATA, 'business-os')
else if (platform === 'darwin') userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'business-os')
else userDataPath = path.join(os.homedir(), '.config', 'business-os')

const dbPath = path.join(userDataPath, 'business.db')
console.log('Looking for database at:', dbPath)

if (!fs.existsSync(dbPath)) {
  console.log('Database not found — will be created fresh when you run: npm start')
  process.exit(0)
}

let Database
try { Database = require('better-sqlite3') }
catch(e) { console.error('Run this from your project folder after npm install'); process.exit(1) }

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

function addCol(table, col, typedef) {
  const exists = db.prepare(`PRAGMA table_info("${table}")`).all().some(c => c.name === col)
  if (!exists) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${col} ${typedef}`)
    console.log(`  ✓ Added ${table}.${col}`)
  } else {
    console.log(`  ↩ ${table}.${col} already exists`)
  }
}

console.log('\n── Patching sales table ──────────────────────────')
addCol('sales', 'subtotal_usd',     'REAL DEFAULT 0')
addCol('sales', 'subtotal_khr',     'REAL DEFAULT 0')
addCol('sales', 'discount_usd',     'REAL DEFAULT 0')
addCol('sales', 'discount_khr',     'REAL DEFAULT 0')
addCol('sales', 'tax_usd',          'REAL DEFAULT 0')
addCol('sales', 'tax_khr',          'REAL DEFAULT 0')
addCol('sales', 'total_usd',        'REAL DEFAULT 0')
addCol('sales', 'total_khr',        'REAL DEFAULT 0')
addCol('sales', 'payment_currency', "TEXT DEFAULT 'USD'")
addCol('sales', 'amount_paid_usd',  'REAL DEFAULT 0')
addCol('sales', 'amount_paid_khr',  'REAL DEFAULT 0')
addCol('sales', 'change_usd',       'REAL DEFAULT 0')
addCol('sales', 'change_khr',       'REAL DEFAULT 0')
addCol('sales', 'exchange_rate',    'REAL DEFAULT 4100')

// Backfill old data into new columns
const oldCols = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name)
if (oldCols.includes('total') && oldCols.includes('total_usd')) {
  const r = db.prepare(`UPDATE sales SET
    total_usd       = COALESCE(total, 0),
    subtotal_usd    = COALESCE(subtotal, 0),
    discount_usd    = COALESCE(discount, 0),
    tax_usd         = COALESCE(tax, 0),
    amount_paid_usd = COALESCE(amount_paid, 0),
    change_usd      = COALESCE(change_returned, 0)
    WHERE total_usd = 0 AND COALESCE(total, 0) > 0`).run()
  if (r.changes > 0) console.log(`  ✓ Backfilled ${r.changes} existing sales rows`)
}

console.log('\n── Patching products table ────────────────────────')
addCol('products', 'cost_price_usd',        'REAL DEFAULT 0')
addCol('products', 'selling_price_usd',     'REAL DEFAULT 0')
addCol('products', 'cost_price_khr',        'REAL DEFAULT 0')
addCol('products', 'selling_price_khr',     'REAL DEFAULT 0')
addCol('products', 'low_stock_threshold',   'REAL DEFAULT 10')
addCol('products', 'out_of_stock_threshold','REAL DEFAULT 0')
addCol('products', 'custom_fields',         "TEXT DEFAULT '{}'")

const pCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name)
if (pCols.includes('cost_price') && pCols.includes('cost_price_usd')) {
  const r = db.prepare(`UPDATE products SET
    cost_price_usd    = COALESCE(cost_price, 0),
    selling_price_usd = COALESCE(selling_price, 0)
    WHERE cost_price_usd = 0 AND COALESCE(cost_price, 0) > 0`).run()
  if (r.changes > 0) console.log(`  ✓ Backfilled ${r.changes} product price rows`)
}
if (pCols.includes('low_stock_alert') && pCols.includes('low_stock_threshold')) {
  db.exec(`UPDATE products SET low_stock_threshold = COALESCE(low_stock_alert, 10) WHERE low_stock_threshold = 10`)
}

console.log('\n── Patching stock_movements table ─────────────────')
addCol('stock_movements', 'unit_cost_usd',  'REAL DEFAULT 0')
addCol('stock_movements', 'unit_cost_khr',  'REAL DEFAULT 0')
addCol('stock_movements', 'total_cost_usd', 'REAL DEFAULT 0')
addCol('stock_movements', 'total_cost_khr', 'REAL DEFAULT 0')
addCol('stock_movements', 'sale_id',        'INTEGER')

console.log('\n── New settings keys ───────────────────────────────')
const newSettings = {
  currency_usd_symbol: '$', currency_khr_symbol: '៛',
  exchange_rate: '4100',    display_currency: 'USD'
}
const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
Object.entries(newSettings).forEach(([k, v]) => {
  const r = ins.run(k, v)
  if (r.changes) console.log(`  ✓ Added setting: ${k} = ${v}`)
})

console.log('\n── New product tables ──────────────────────────────')
db.exec(`
  CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#3b82f6', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    field_type TEXT DEFAULT 'text', options TEXT DEFAULT '[]',
    sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)
const catCount = db.prepare('SELECT COUNT(*) as c FROM product_categories').get()
if (catCount.c === 0) {
  const cats = ['Electronics','Food & Beverage','Clothing','Health & Beauty','Home & Garden','Office Supplies','Other']
  cats.forEach(c => db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)').run(c))
  console.log('  ✓ Added default categories')
}
const unitCount = db.prepare('SELECT COUNT(*) as c FROM product_units').get()
if (unitCount.c === 0) {
  const units = ['pcs','kg','g','L','mL','box','pack','pair','set','dozen','m','cm']
  units.forEach(u => db.prepare('INSERT OR IGNORE INTO product_units (name) VALUES (?)').run(u))
  console.log('  ✓ Added default units')
}

db.close()
console.log('\n✅ Database migration complete! Now run: npm start\n')
