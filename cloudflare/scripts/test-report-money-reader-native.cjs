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
  new Function('require','module','exports',source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

function schema(db, precise) {
  db.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER DEFAULT 0);
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,
      cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
      subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,
      delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
      source_return_id INTEGER,amount_paid_usd REAL${precise ? ',money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0' : ''});
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,
      cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0);
    CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',total_refund_usd REAL${precise ? ',money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0' : ''});
    CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER);
  `)
}
function adapter(sql, hook) {
  return { prepare(query) { const stmt = sql.prepare(query); return {
    all(params = {}) { if (hook) hook(query, params); return stmt.all(params) },
    get(params = {}) { if (hook) hook(query, params); return stmt.get(params) },
  } } }
}
function kernel(sql, hook) {
  cache.clear()
  const db = adapter(sql, hook)
  const dates = load('src/lib/businessDateWindow.ts')
  const money = load('src/lib/moneyPrecision.ts')
  const reportMoney = load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': money })
  return load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db }, './businessDateWindow': dates, './reportMoneyPrecision': reportMoney })
}
const filters = { startDate: '2026-09-01', endDate: '2026-09-30', branchId: 2 }

;(async () => {
  const legacyDb = new Database(':memory:'); schema(legacyDb, false)
  legacyDb.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd) VALUES(1,'2026-09-01 01:00:00','completed',2,100,100)`).run()
  const addLegacyItem = legacyDb.prepare('INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(?,1,.33335,1,1.23456)')
  for (let id = 1; id <= 100; id += 1) addLegacyItem.run(id)
  const legacy = kernel(legacyDb)
  const legacyTotals = await legacy.getSalesTotals({}, filters)
  assert.equal(legacyTotals.cost_usd, 41.15, 'legacy unit cost retains >4 recorded places until the aggregate boundary')
  assert.equal(legacy.reportMoneyDiagnostic(legacyTotals).precision_mode, 'exact_recorded')
  console.log('PASS pre-0158 SELECT omits absent columns and legacy >4dp products aggregate exactly')

  const preciseDb = new Database(':memory:'); schema(preciseDb, true)
  preciseDb.exec(`
    INSERT INTO sales(id,created_at,sale_status,branch_id,receipt_number,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
      VALUES(1,'2026-09-01 01:00:00','completed',2,'P',10.004,10.01,1,10.0055,.0045),
            (2,'2026-09-02 01:00:00','awaiting_payment',2,'N',5.004,5.00,1,5.004,-.004);
    INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(1,1,1,10.004,2.0000),(2,2,1,5.004,NULL);
  `)
  const precise = kernel(preciseDb)
  const days = await precise.getBusinessSummaryDayRows({}, filters)
  assert.deepEqual(days.map((row) => row.revenue_usd), [10.01, 5], 'positive/negative saved sale adjustments affect recognized revenue once')
  assert.equal(days[1].pending_revenue_usd, 5)
  const total = await precise.getSalesTotals({}, filters)
  assert.equal(total.revenue_usd, 15.01)
  const sharedSnapshot = await precise.readSalesReportSnapshot({}, filters)
  assert.deepEqual(precise.salesTotalsFromSnapshot(sharedSnapshot), total,
    'a caller can reuse the canonical totals reducer without a second report formula')
  assert.deepEqual(precise.paymentMethodBreakdownFromSnapshot(sharedSnapshot), await precise.getPaymentMethodBreakdown({}, filters),
    'payment grouping can reuse the same verified snapshot as totals')
  const periods = await precise.getBusinessSummaryPeriodRows({}, filters, 'month')
  assert.equal(periods[0].revenue_usd, total.revenue_usd, 'period reads the same recorded operands instead of summing displayed days')
  const series = await precise.getSalesPeriodSeries({}, filters, 'day')
  assert.deepEqual(series.map((row) => row.revenue_usd), days.map((row) => row.revenue_usd))
  const grouped = await precise.getSalesGroupedTotals({}, filters, 'payment_method')
  assert.equal(grouped[0].revenue_usd, total.revenue_usd)
  const products = await precise.getProductSalesRanking({}, filters)
  assert.equal(products[0].line_sales_usd, 15.01, 'product money is exact line money without header adjustment allocation')
  const detail = await precise.getBusinessSummarySalesRows({}, filters)
  assert.deepEqual(detail.map((row) => row.net_revenue_usd), [10.01, 5])
  assert.deepEqual(precise.reportMoneyDiagnostic(total), { precision_mode: 'canonical_v1', complete: false, unknown_cost_lines: 1, contributing_rows: 4 })
  console.log('PASS canonical v1 totals/day/period/group/product/detail coherence, positive/negative adjustment, pending parity, and unknown-cost diagnostic')
  preciseDb.exec('UPDATE sales SET subtotal_usd=1.00001 WHERE id=1')
  await assert.rejects(() => precise.getSalesTotals({}, filters), (error) => error.code === 'invalid_saved_money4')
  console.log('PASS malformed v1 scalar is refused')

  const conflictDb = new Database(':memory:'); schema(conflictDb, true)
  conflictDb.exec(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
    VALUES(1,'2026-09-01 01:00:00','completed',2,1,1,1,1,0)`)
  let mutations = 0
  const conflict = kernel(conflictDb, (query) => {
    if (query.includes('delivery_has_linked_fee') && query.includes('FROM sales s WHERE')) {
      mutations += 1; conflictDb.exec(`UPDATE sales SET subtotal_usd=subtotal_usd+1,total_usd=total_usd+1,calculated_total_usd=calculated_total_usd+1 WHERE id=1`)
    }
  })
  await assert.rejects(() => conflict.readSalesReportSnapshot({}, filters), (error) => error.code === 'snapshot_changed')
  conflictDb.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode: 'restore' }))
  await assert.rejects(() => conflict.readSalesReportSnapshot({}, filters), (error) => error.code === 'maintenance_restore')
  assert.ok(mutations >= 4)
  console.log('PASS exact two-pass scalar comparison retries once, then refuses; restore mode always refuses')

  const largeDb = new Database(':memory:'); schema(largeDb, true)
  const sale = largeDb.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd)
    VALUES(?,'2026-09-01 01:00:00','completed',2,1,1,1,1,0)`)
  const item = largeDb.prepare('INSERT INTO sale_items(id,sale_id,quantity,total_usd,cost_price_usd) VALUES(?,?,.33333,1,1.2345)')
  largeDb.transaction(() => {
    for (let id = 1; id <= 15_000; id += 1) sale.run(id)
    for (let id = 1; id <= 50_000; id += 1) item.run(id, (id % 15_000) + 1)
  })()
  let pageCalls = 0
  const started = process.hrtime.bigint()
  const large = kernel(largeDb, (query, params) => {
    if (query.includes('@reportPageSize')) { pageCalls += 1; assert.ok(params.reportPageSize <= 500) }
  })
  const snapshot = await large.readSalesReportSnapshot({}, filters)
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  assert.equal(snapshot.row_count, 65_000)
  assert.ok(pageCalls >= 260, 'both passes page all contributing rows')
  console.log(`PASS native 15k headers + 50k items, row_count=${snapshot.row_count}, page_max=500, elapsed_ms=${elapsedMs.toFixed(1)} (local SQLite instrumentation; not D1 latency)`)
  legacyDb.close(); preciseDb.close(); conflictDb.close(); largeDb.close()
})().catch((error) => { console.error(error); process.exitCode = 1 })
