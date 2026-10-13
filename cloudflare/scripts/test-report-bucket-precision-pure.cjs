'use strict'
// AL Finding L3, owner decision 13 Oct 2026: split reports show 4-decimal
// amounts. Every bucket -- day, week, month, customer, cashier, payment
// method, hour, weekday, branch, product, courier, receipt row, payment-method
// breakdown -- leaves the kernel at 4 places, so its rows add up exactly to
// the window figure; a single headline total keeps its cents.
//
// Fixture: two $1.00 sales whose line cost is $0.0050 each, on different
// days, customers, cashiers, branches, payment methods, hours, products and
// couriers, each with a $0.0050 delivery fee (payable $1.005 -> $1.01, so
// revenue is $1.0050 and profit $1.0050 a sale). Exact COGS is $0.0100 and
// the Overview prints $0.01. Bucketed at cents each row is $0.01 and two rows
// sum to $0.02 -- bf7408b49's day/customer mismatch. Every check below also runs
// its own control: the same rows rounded to cents must NOT reconcile, so a
// fixture that cannot tell 4 places from cents fails here, not silently.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,gender TEXT,is_anonymous INTEGER DEFAULT 0);
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
  INSERT INTO customers(id,name,phone) VALUES(1,'Dara','011'),(2,'Sophea','012');
`)
const insert = sqlite.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,cashier_id,cashier_name,customer_id,customer_name,
    receipt_number,payment_method,subtotal_usd,total_usd,delivery_fee_usd,is_delivery,delivery_contact_id,delivery_contact_name,
    money_precision_version,calculated_total_usd,rounding_adjustment_usd)
  VALUES(@id,@at,'completed',@id,@branch,@id,@cashier,@id,@customer,@receipt,@method,1,1.01,0.005,1,@id,@courier,1,1.005,0.005)`)
insert.run({ id: 1, at: '2026-10-03 03:00:00', branch: 'Shop', cashier: 'Mia', customer: 'Dara', receipt: 'R1', method: 'Cash', courier: 'Courier A' })
insert.run({ id: 2, at: '2026-10-04 05:00:00', branch: 'Store', cashier: 'Sok', customer: 'Sophea', receipt: 'R2', method: 'ABA', courier: 'Courier B' })
sqlite.exec(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd)
  VALUES(1,1,701,'Tester A',1,1,0.005),(2,2,702,'Tester B',1,1,0.005)`)

const db = { prepare(query) { const stmt = sqlite.prepare(query); return {
  all(params = {}) { return stmt.all(params) }, get(params = {}) { return stmt.get(params) },
} } }
const money = load('src/lib/moneyPrecision.ts')
const analytics = load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('src/lib/removalLosses.ts'),
  './businessDateWindow': load('src/lib/businessDateWindow.ts'), './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': money }) })

const f = { startDate: '2026-10-03', endDate: '2026-10-04' }
const sum4 = (rows, key) => Number(rows.reduce((total, row) => total + Number(row[key]), 0).toFixed(4))
const cents = (rows, key) => rows.map((row) => ({ ...row, [key]: Number(Number(row[key]).toFixed(2)) }))

;(async () => {
  const results = []
  const check = (name, fn) => {
    try { fn(); results.push(true); console.log(`PASS ${name}`) }
    catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`) }
  }
  const totals = await analytics.getSalesTotals({}, f)
  check(`headline totals keep cents: cost $${totals.cost_usd}, profit $${totals.profit_usd}, delivery $${totals.delivery_usd}`, () => {
    assert.equal(totals.cost_usd, 0.01)
    assert.equal(totals.profit_usd, 2.01)
    assert.equal(totals.delivery_usd, 0.01)
  })
  // rows: the bucket rows; key: the money field; each: the exact per-row value;
  // total: what the rows must add up to.
  const reconciles = (label, rows, key, each, total) => check(`${label}: ${rows.length} rows of ${key} ${rows.map((row) => row[key]).join(' + ')} = ${sum4(rows, key)} (window ${total})`, () => {
    assert.equal(rows.length, 2, 'one row per sale in this fixture')
    for (const row of rows) assert.equal(row[key], each, 'the row carries 4 places')
    assert.equal(sum4(rows, key), total, 'the rows add up to the window figure')
    assert.notEqual(sum4(cents(rows, key), key), total, 'control: the same rows at cents would not add up')
  })

  const days = await analytics.getBusinessSummaryDayRows({}, f)
  reconciles('day rows (business summary)', days, 'cost_usd', 0.005, totals.cost_usd)
  reconciles('day rows (business summary)', days, 'profit_usd', 1.005, totals.profit_usd)
  for (const granularity of ['day']) {
    const periods = await analytics.getBusinessSummaryPeriodRows({}, f, granularity)
    reconciles(`/periods ${granularity} rows`, periods, 'cost_usd', 0.005, totals.cost_usd)
    reconciles(`/periods ${granularity} rows`, periods, 'profit_usd', 1.005, totals.profit_usd)
  }
  const series = await analytics.getSalesPeriodSeries({}, f, 'day')
  reconciles('Dashboard / daily-report period series', series, 'cost_usd', 0.005, totals.cost_usd)
  reconciles('Dashboard / daily-report period series', series, 'profit_usd', 1.005, totals.profit_usd)
  for (const by of analytics.SALES_GROUP_KEYS) {
    const report = await analytics.getSalesGroupedReport({}, f, by)
    reconciles(`/grouped by ${by}`, report.rows, 'cost_usd', 0.005, totals.cost_usd)
    reconciles(`/grouped by ${by}`, report.rows, 'profit_usd', 1.005, totals.profit_usd)
    check(`/grouped by ${by} window totals carry 4 places (cost ${report.totals.cost_usd})`, () => assert.equal(report.totals.cost_usd, 0.01))
  }
  const products = await analytics.getProductSalesReport({}, f)
  reconciles('/grouped by product', products.rows, 'cost_usd', 0.005, totals.cost_usd)
  check(`/grouped by product totals (cost ${products.totals.cost_usd}, profit ${products.totals.profit_usd})`, () => {
    assert.equal(products.totals.cost_usd, 0.01); assert.equal(products.totals.profit_usd, 1.99)
  })
  const receipts = await analytics.getBusinessSummarySalesRows({}, f)
  reconciles('business-summary receipt rows', receipts, 'cost_usd', 0.005, totals.cost_usd)
  reconciles('business-summary receipt rows', receipts, 'delivery_usd', 0.005, totals.delivery_usd)
  const couriers = await analytics.getDeliveryContactTotals({}, f)
  reconciles('courier rows', couriers, 'charged_fee_usd', 0.005, totals.delivery_usd)
  const snapshot = await analytics.readSalesReportSnapshot({}, f)
  const methods = analytics.paymentMethodBreakdownFromSnapshot(snapshot)
  // v1 payables and refunds are whole cents, so this split has no sub-cent
  // part to lose; it still carries the kernel's exact value and adds up.
  check(`payment-method breakdown (stats strip, day report): ${methods.map((row) => row.collected_usd).join(' + ')} = collected ${totals.collected_total_usd}`, () => {
    assert.equal(sum4(methods, 'collected_usd'), totals.collected_total_usd)
  })
  const dayReport = await analytics.getSalesDayReport({}, '2026-10-03', {})
  check(`day report: receipts carry 4 places, totals keep cents (receipt revenue ${dayReport.sales.map((row) => row.revenue_usd).join(',')}, totals cost ${dayReport.totals.cost_usd})`, () => {
    assert.deepEqual(dayReport.sales.map((row) => row.revenue_usd), [1.005])
    assert.equal(dayReport.totals.cost_usd, 0.01, 'one sale: $0.005 COGS is a headline, printed at cents')
    assert.equal(dayReport.payment_methods[0].collected_usd, 1.01)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`${failed ? 'RED' : 'GREEN'} 4-decimal bucket rows: ${results.length - failed}/${results.length}`)
  if (failed) process.exitCode = 1
})().catch((error) => { console.error(error); process.exitCode = 1 })
