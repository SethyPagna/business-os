'use strict'
// The real sales kernel (src/lib/salesAnalytics.ts and the modules it reads) compiled with esbuild and run against
// an in-memory SQLite that carries the sales-side schema, so a pure test can call readSalesReportSnapshot and the
// reducers exactly as the Worker does. `patches` rewrite the kernel source in memory (mutation controls); nothing on
// disk changes.
//
//   const world = makeKernelWorld({ patches: [{ file: 'src/lib/salesAnalytics.ts', from: '...', to: '...' }] })
//   world.sqlite.exec('INSERT ...'); const snapshot = await world.analytics.readSalesReportSnapshot(world.env, filters)
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..', '..')

function makeKernelWorld({ patches = [] } = {}) {
  const cache = new Map()
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,gender TEXT,is_anonymous INTEGER DEFAULT 0);
    CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,
      cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
      subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,
      delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
      delivery_contact_id INTEGER,delivery_contact_name TEXT,
      source_return_id INTEGER,amount_paid_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,
      calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,
      cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0);
    CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',
      total_refund_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER,
      sale_item_id INTEGER,total_usd REAL,refund_snapshot_json TEXT);
  `)
  let statements = 0
  const db = { prepare(query) {
    const stmt = sqlite.prepare(query)
    return { all(params = {}) { statements += 1; return stmt.all(params) }, get(params = {}) { statements += 1; return stmt.get(params) } }
  } }
  function load(relative, overrides = {}) {
    const file = path.resolve(root, relative)
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const patch of patches.filter((p) => file.replaceAll('\\', '/').endsWith(`/${p.file}`))) {
      assert.equal(text.split(patch.from).length - 1, 1, `mutant anchor must occur once: ${patch.from.slice(0, 70)}`)
      text = text.replace(patch.from, () => patch.to)
    }
    const source = transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    new Function('require', 'module', 'exports', source)((id) => {
      if (id in overrides) return overrides[id]
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
      return require(id)
    }, mod, mod.exports)
    return mod.exports
  }
  const money = load('src/lib/moneyPrecision.ts')
  const analytics = load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('src/lib/removalLosses.ts'),
    './businessDateWindow': load('src/lib/businessDateWindow.ts'), './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': money }) })
  return { sqlite, analytics, load, env: {}, statements: () => statements }
}

module.exports = { makeKernelWorld }
