// RET-A verify R3 (E2): Collected counts what an exchange's replacement was
// paid with -- its dollars AND its riel -- in every reader of the report kernel
// (totals, payment-method breakdown, business-summary rows, day report rows,
// customer drill), never above the replacement's total.
//
// The verifier's CL2 shape on the full migrated schema: two identical
// exchanges, a $1.23 line returned and swapped for a $1.23 replacement paid
// from the refund -- one refunded in dollars (the replacement records
// $1.23), one in riel (it records 5,000 riel at the refund's riel basis). The
// till took the same value for both, so both must report the same Collected.
// Old-model replacements (only the top-up recorded) keep their top-up; a riel
// top-up now counts as well; nothing counts above the sale's total.
// Discriminating: the previous kernel read amount_paid_usd only, so the riel
// replacement collected $0 ($1.23 short).
//
// Run (from cloudflare/): node scripts/test-report-collected-replacement-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(file, overrides = {}) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(file), id)
      return load(target.endsWith('.ts') ? target : `${target}.ts`, overrides)
    }
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`)

async function main() {
  const db = openDb(loadAll())
  const basis = 5000 / 1.23
  db.exec(`
    INSERT INTO branches(id, name, is_active) VALUES (1, 'Shop', 1);
    INSERT INTO customers(id, name) VALUES (7, 'Dollar swap'), (8, 'Riel swap'), (9, 'Old model');
    INSERT INTO sales(id, receipt_number, branch_id, branch_name, created_at, subtotal_usd, total_usd, amount_paid_usd, amount_paid_khr,
      exchange_rate, sale_status, customer_id, payment_method) VALUES
      (1, 'O1', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4100, 'partial_return', 7, 'Cash'),
      (2, 'O2', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4100, 'partial_return', 8, 'Cash');
    INSERT INTO returns(id, return_number, sale_id, branch_id, cashier_id, return_scope, reason, total_refund_usd, total_refund_khr,
      exchange_rate, status, created_at, refund_currency, owed_reduction_usd) VALUES
      (1, 'R1', 1, 1, 7, 'customer', 'x', 1.23, 5000, 4100, 'completed', '2026-09-20 05:00:00', 'USD', 0),
      (2, 'R2', 2, 1, 7, 'customer', 'x', 1.23, 5000, 4100, 'completed', '2026-09-20 05:00:00', 'KHR', 0);
    INSERT INTO sales(id, receipt_number, branch_id, branch_name, created_at, subtotal_usd, total_usd, amount_paid_usd, amount_paid_khr,
      exchange_rate, sale_status, source_return_id, customer_id, payment_method) VALUES
      (11, 'XU', 1, 'Shop', '2026-09-20 05:00:00', 1.23, 1.23, 1.23, 0, 4100, 'completed', 1, 7, 'Cash'),
      (12, 'XR', 1, 'Shop', '2026-09-20 05:00:00', 1.23, 1.23, 0, 5000, ${basis}, 'completed', 2, 8, 'Cash'),
      (21, 'OLD-USD', 1, 'Shop', '2026-09-20 06:00:00', 5, 5, 1, 0, 4000, 'completed', 1, 9, 'Card'),
      (22, 'OLD-KHR', 1, 'Shop', '2026-09-20 06:00:00', 5, 5, 0, 4000, 4000, 'completed', 2, 9, 'Card'),
      (23, 'CAPPED', 1, 'Shop', '2026-09-20 06:00:00', 1, 1, 1, 4000, 4000, 'completed', 2, 9, 'Card');
  `)
  const kernel = load(path.join(root, 'src/lib/salesAnalytics.ts'), { './db': { getDb: () => db } })
  const f = { startDate: '2026-09-20', endDate: '2026-09-20' }

  // Customer drill: the two exchanges collected the same.
  const dollarDrill = await kernel.getCustomerSalesTotals({}, { ...f, customerId: 7 })
  const rielDrill = await kernel.getCustomerSalesTotals({}, { ...f, customerId: 8 })
  assert.equal(dollarDrill.collected_usd, 11.23, 'the dollar swap: $10 sale + $1.23 replacement')
  assert.equal(rielDrill.collected_usd, dollarDrill.collected_usd, 'CL2: the riel swap collects the same as the dollar swap (was $10.00)')
  assert.equal((await kernel.getCustomerSalesTotals({}, { ...f, customerId: 9 })).collected_usd, 3,
    'old model: $1 dollar top-up + 4,000 riel top-up ($1) + a capped $1 sale')

  // Business-summary rows (per sale).
  const snapshot = await kernel.readSalesReportSnapshot({}, f)
  const rows = new Map(kernel.businessSummarySalesRowsFromSnapshot(snapshot).map((row) => [Number(row.id ?? row.sale_id), row]))
  const collectedOf = (id) => Number([...Object.entries(rows.get(id) || {})].find(([key]) => /collected/.test(key))?.[1])
  near(collectedOf(12), 1.23, 'summary row: the riel-funded replacement collected its riel')
  near(collectedOf(11), 1.23, 'summary row: the dollar-funded replacement')
  near(collectedOf(21), 1, 'summary row: an old-model dollar top-up is unchanged')
  near(collectedOf(22), 1, 'summary row: an old-model riel top-up now counts')
  near(collectedOf(23), 1, 'summary row: never above the sale total')

  // Day report per-sale rows and the totals.
  const day = await kernel.getSalesDayReport({}, '2026-09-20')
  const daySale = (receipt) => day.sales.find((sale) => sale.receipt_number === receipt)
  near(daySale('XR').collected_usd, daySale('XU').collected_usd, 'day report: XR collected == XU collected')
  const totals = await kernel.getSalesTotals({}, f)
  // $10 - $1.23 refunded, twice, + both replacements + the old-model three.
  near(totals.collected_total_usd, (10 - 1.23) * 2 + 1.23 * 2 + 3, 'totals: Collected counts the riel replacement')

  // Payment-method breakdown.
  const methods = new Map((await kernel.getPaymentMethodBreakdown({}, f)).map((row) => [row.payment_method, row]))
  near(methods.get('Cash').collected_usd, (10 - 1.23) * 2 + 1.23 * 2, 'payment methods: Cash')
  near(methods.get('Card').collected_usd, 3, 'payment methods: Card (old-model replacements)')

  // CONTROL: the dollars-only reading this replaces gives the riel swap $0.
  const dollarsOnly = (id) => Number(db.db.prepare('SELECT amount_paid_usd AS v FROM sales WHERE id = ?').get(id).v)
  assert.equal(dollarsOnly(12), 0, 'CONTROL: amount_paid_usd alone reads the riel replacement as $0 collected')
  console.log('PASS Collected counts a replacement\'s dollars and riel, never above its total, in the drill, summary rows, day report, totals and payment methods')
}

main().catch((error) => { console.error(error); process.exit(1) })
