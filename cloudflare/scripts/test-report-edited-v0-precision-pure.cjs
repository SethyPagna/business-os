const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id === './db') return { getDb: () => db }
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts')
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

const sqlite = new Database(':memory:')
const db = { prepare(query) { const stmt = sqlite.prepare(query); return {
  all(params = {}) { return stmt.all(params) }, get(params = {}) { return stmt.get(params) },
} } }
sqlite.exec(`
  CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER DEFAULT 0);
  CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
  CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT);
  CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,
    cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
    subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,
    delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
    source_return_id INTEGER,amount_paid_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,
    calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
  CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,
    cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0);
  CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',
    total_refund_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
  CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER,
    sale_item_id INTEGER,total_usd REAL,refund_snapshot_json TEXT);
`)
const addSale = sqlite.prepare(`INSERT INTO sales
  (id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
  VALUES (@id,@at,'completed',1,@subtotal,@payable,@version,@raw,@adjustment)`)
const addItem = sqlite.prepare(`INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES (@id,@id,1,@subtotal,2)`)
for (const row of [
  { id: 1, at: '2026-09-01 01:00:00', subtotal: 10, payable: 10, version: 0, raw: null, adjustment: 0 },
  { id: 2, at: '2026-09-02 01:00:00', subtotal: 5.004, payable: 5, version: 0, raw: 5.004, adjustment: -.004 },
  { id: 3, at: '2026-09-03 01:00:00', subtotal: 10.0055, payable: 10.01, version: 0, raw: 10.0055, adjustment: .0045 },
  { id: 4, at: '2026-09-04 01:00:00', subtotal: 3.004, payable: 3, version: 1, raw: 3.004, adjustment: -.004 },
]) { addSale.run(row); addItem.run(row) }

const analytics = load('src/lib/salesAnalytics.ts')
const filters = { startDate: '2026-09-01', endDate: '2026-09-30', branchId: 1 }
;(async () => {
  const days = await analytics.getBusinessSummaryDayRows({}, filters)
  assert.deepEqual(days.map((row) => row.revenue_usd), [10, 5, 10.01, 3],
    'untouched v0 stays unchanged; edited v0 and v1 apply the validated signed adjustment once')
  assert.deepEqual(days.map((row) => row.profit_usd), [8, 3, 8.01, 1],
    'profit derives from adjusted revenue minus unchanged recorded cost without adding adjustment twice')
  const totals = await analytics.getSalesTotals({}, filters)
  assert.equal(totals.revenue_usd, 28.01)
  assert.equal(totals.profit_usd, 20.01)
  assert.equal(totals.collected_total_usd, 28.01,
    'collected consumes saved payable totals and does not add header adjustment again')
  assert.equal(analytics.reportMoneyDiagnostic(totals).precision_mode, 'exact_recorded',
    'edited v0 retains legacy operand semantics and does not relabel the cohort canonical v1')

  sqlite.prepare(`UPDATE sales SET calculated_total_usd=5.004,rounding_adjustment_usd=0 WHERE id=2`).run()
  await assert.rejects(() => analytics.getSalesTotals({}, filters), (error) => error.code === 'unsupported_row',
    'a partial or inconsistent edited-v0 equation refuses instead of treating adjustment as zero')
  sqlite.prepare(`UPDATE sales SET calculated_total_usd=NULL,rounding_adjustment_usd=.001 WHERE id=2`).run()
  await assert.rejects(() => analytics.getSalesTotals({}, filters), (error) => error.code === 'unsupported_row',
    'legacy NULL raw metadata cannot carry a nonzero inferred adjustment')
  console.log('OK edited-v0 report precision: raw presence is strict, adjustment is applied once, legacy history is unchanged')
})().catch((error) => { console.error(error); process.exitCode = 1 })
