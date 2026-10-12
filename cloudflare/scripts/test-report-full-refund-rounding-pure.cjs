'use strict'
// AL Finding L1: a fully refunded v1 sale must earn nothing. The sale's
// rounding adjustment enters revenue (net + adjustment), so once its refunds
// take back the whole entitlement the reversal is on the charged basis too:
// the merchandise plus the refunds' own rounding, capped at what the sale
// recognized. The whole report kernel (lib/salesAnalytics.ts) runs against an
// in-memory SQLite copy of the report columns.
//
// Discrimination, one day per case:
//   A  four $9.9955 sales charged $10.00 and fully refunded $10.00: revenue
//      and profit $0 (bf7408b49: $0.02 = 4 x $0.0045 of sale rounding).
//   B  one kept + two refunded: exactly the kept $10.00 / $9.00. Clamping
//      revenue at zero would still print $10.01.
//   C  ten 2-unit sales with one unit refunded: unchanged merchandise basis
//      ($100.02). Charging partial refunds' rounding too would print $100.00.
//   D  rounding the other way ($9.9925 charged $9.99): $0, not -$0.01.
//   E  refunded more than the merchandise because the payable also rode on a
//      delivery fee: capped at net + adjustment, $0 -- an uncapped reversal
//      prints -$0.02.
//   F  the sale's rounding rode on the unrefunded delivery fee: what the
//      customer did not get back stays recognized ($0.02). Reversing the whole
//      sale adjustment instead would print $0.
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
const db = { prepare(query) { const stmt = sqlite.prepare(query); return {
  all(params = {}) { return stmt.all(params) }, get(params = {}) { return stmt.get(params) },
} } }
const money = load('src/lib/moneyPrecision.ts')
const analytics = load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('src/lib/removalLosses.ts'),
  './businessDateWindow': load('src/lib/businessDateWindow.ts'), './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': money }) })
const entitlement = load('src/lib/customerReturnEntitlement.ts')

const r4 = (value) => Number(Number(value).toFixed(4))
let nextSale = 1, nextReturn = 1
// One v1 sale of `quantity` units whose line total is `line` (unit cost $1),
// optionally with a customer-paid delivery fee, charged at the cent-rounded
// payable; then each listed refund returns `units` with the payout the
// cumulative cent allocation gives (calculated + its rounding).
function sale({ day, line, quantity = 1, delivery = 0, refunds = [] }) {
  const id = nextSale++
  const raw = r4(line + delivery)
  const payable = Number(raw.toFixed(2))
  sqlite.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,payment_method,subtotal_usd,total_usd,delivery_fee_usd,is_delivery,
      money_precision_version,calculated_total_usd,rounding_adjustment_usd) VALUES(?,?,'completed',1,'Cash',?,?,?,?,1,?,?)`)
    .run(id, `${day} 03:00:00`, line, payable, delivery, delivery ? 1 : 0, raw, r4(payable - raw))
  sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,quantity,total_usd,cost_price_usd) VALUES(?,?,1,?,?,1)').run(id, id, quantity, line)
  const allocation = { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: line }
  let before = 0
  for (const { units, payout } of refunds) {
    const after = before + units
    const beforeMoney = entitlement.prorateCustomerReturnMoney4(line, before, quantity)
    const afterMoney = entitlement.prorateCustomerReturnMoney4(line, after, quantity)
    const calculated = r4(afterMoney - beforeMoney)
    const snapshot = JSON.stringify({ version: 1, sale_id: id, sale_item_id: id, line_key: `line-${id}`, pool_key: `pool-${id}`,
      source_sale_revision: 1, source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: quantity, return_quantity: units,
      returned_quantity_before: before, returned_quantity_after: after, receipt_allocation: allocation, net_entitlement_usd: line,
      calculated_refund_before_usd: beforeMoney, calculated_refund_after_usd: afterMoney, calculated_refund_usd: calculated,
      calculated_refund_khr: r4(calculated * 4000), exchange_rate: 4000, sale_product_entitlement_usd: line,
      sale_product_payout_cap_usd: payable })
    const returnId = nextReturn++
    sqlite.prepare(`INSERT INTO returns(id,sale_id,total_refund_usd,money_precision_version,calculated_refund_usd,rounding_adjustment_usd)
      VALUES(?,?,?,1,?,?)`).run(returnId, id, payout, calculated, r4(payout - calculated))
    sqlite.prepare(`INSERT INTO return_items(id,return_id,cost_price_usd,quantity,stock_action,return_to_stock,sale_item_id,total_usd,refund_snapshot_json)
      VALUES(?,?,1,?,'restock',1,?,?,?)`).run(returnId, returnId, units, id, calculated, snapshot)
    before = after
  }
}
const day = (date) => ({ startDate: date, endDate: date, branchId: 1 })

for (let i = 0; i < 4; i++) sale({ day: '2026-10-01', line: 9.9955, refunds: [{ units: 1, payout: 10 }] })
sale({ day: '2026-10-02', line: 9.9955 })
for (let i = 0; i < 2; i++) sale({ day: '2026-10-02', line: 9.9955, refunds: [{ units: 1, payout: 10 }] })
for (let i = 0; i < 10; i++) sale({ day: '2026-10-03', line: 19.9955, quantity: 2, refunds: [{ units: 1, payout: 10 }] })
for (let i = 0; i < 4; i++) sale({ day: '2026-10-04', line: 9.9925, refunds: [{ units: 1, payout: 9.99 }] })
for (let i = 0; i < 4; i++) sale({ day: '2026-10-05', line: 9.9955, delivery: 1.0045, refunds: [{ units: 1, payout: 10 }] })
for (let i = 0; i < 4; i++) sale({ day: '2026-10-06', line: 9.9995, delivery: 0.996, refunds: [{ units: 1, payout: 10 }] })
// Two-step full refund of one 2-unit sale: the rounding of both returns counts.
sale({ day: '2026-10-07', line: 19.9955, quantity: 2, refunds: [{ units: 1, payout: 10 }, { units: 1, payout: 10 }] })

;(async () => {
  const results = []
  const check = (name, fn) => {
    try { fn(); results.push(true); console.log(`PASS ${name}`) }
    catch (error) { results.push(false); console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`) }
  }
  const surfaces = async (date) => {
    const f = day(date)
    const totals = await analytics.getSalesTotals({}, f)
    const days = await analytics.getBusinessSummaryDayRows({}, f)
    const grouped = await analytics.getSalesGroupedTotals({}, f, 'payment_method')
    const rows = await analytics.getBusinessSummarySalesRows({}, f)
    const report = await analytics.getSalesDayReport({}, date, { branchId: 1 })
    const rowSum = (list, key) => r4(list.reduce((sum, row) => sum + Number(row[key]), 0))
    return { totals, day: days[0], group: grouped[0], rowRevenue: rowSum(rows, 'net_revenue_usd'),
      rowProfit: rowSum(rows, 'gross_profit_usd'), drillRevenue: rowSum(report.sales, 'revenue_usd'), dayReport: report.totals }
  }
  // rows=false: per-receipt rows are cent-rounded before they are summed, so
  // a sub-cent residue per row (C, F) does not reach their sum (finding L3).
  const same = (s, revenue, label, rows = true) => {
    assert.equal(s.totals.revenue_usd, revenue, `${label}: totals revenue`)
    assert.equal(s.day.revenue_usd, revenue, `${label}: day row revenue`)
    assert.equal(s.group.revenue_usd, revenue, `${label}: grouped revenue`)
    assert.equal(s.dayReport.revenue_usd, revenue, `${label}: day-report revenue`)
    if (!rows) return
    assert.equal(Number(s.rowRevenue.toFixed(2)), revenue, `${label}: business-summary sale rows`)
    assert.equal(Number(s.drillRevenue.toFixed(2)), revenue, `${label}: day-report sale rows`)
  }

  const a = await surfaces('2026-10-01')
  check(`A fully refunded: revenue $${a.totals.revenue_usd}, profit $${a.totals.profit_usd}, refunds $${a.totals.refund_usd} (bf7408b49: $0.02 / $0.02 / $39.98)`, () => {
    same(a, 0, 'A')
    assert.equal(a.totals.profit_usd, 0)
    assert.equal(a.day.profit_usd, 0)
    assert.equal(Number(a.rowProfit.toFixed(2)), 0)
    assert.equal(a.totals.refund_usd, 40, 'the recognition reversal equals what was charged and paid back')
    assert.equal(a.totals.collected_total_usd, 0)
  })
  const b = await surfaces('2026-10-02')
  check(`B control 1 kept + 2 refunded: revenue $${b.totals.revenue_usd}, profit $${b.totals.profit_usd} (a zero clamp keeps $10.01)`, () => {
    same(b, 10, 'B')
    assert.equal(b.totals.profit_usd, 9)
  })
  const c = await surfaces('2026-10-03')
  check(`C partial refunds keep the merchandise basis: revenue $${c.totals.revenue_usd} (charging partial rounding too would give $100)`, () => {
    same(c, 100.02, 'C', false)
  })
  const d = await surfaces('2026-10-04')
  check(`D downward rounding fully refunded: revenue $${d.totals.revenue_usd} (bf7408b49: -$0.01)`, () => {
    same(d, 0, 'D')
  })
  const e = await surfaces('2026-10-05')
  check(`E refund rounding above the sale's: capped at net + adjustment, revenue $${e.totals.revenue_usd} (uncapped: -$0.02)`, () => {
    same(e, 0, 'E')
  })
  const f = await surfaces('2026-10-06')
  check(`F sale rounding on the unrefunded delivery fee stays: revenue $${f.totals.revenue_usd} (reversing the whole adjustment: $0)`, () => {
    same(f, 0.02, 'F', false)
  })
  const g = await surfaces('2026-10-07')
  check(`G two partial refunds completing the sale: revenue $${g.totals.revenue_usd}, profit $${g.totals.profit_usd}`, () => {
    same(g, 0, 'G')
    assert.equal(g.totals.profit_usd, 0)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`${failed ? 'RED' : 'GREEN'} full-refund rounding reversal: ${results.length - failed}/${results.length}`)
  if (failed) process.exitCode = 1
})().catch((error) => { console.error(error); process.exitCode = 1 })
