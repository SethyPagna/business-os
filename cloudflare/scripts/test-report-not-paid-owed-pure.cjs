// RET-A LH-16 (verifier 6 Oct 2026): a sale whose returns cleared its debt is
// not in the reports' Not Paid detail nor in the shift / Telegram credit.
// Owner model: "$10 Not Paid with $4 returned -> revenue $6, Not Paid owes $6
// ... Not Paid and Completed alike in reports."
//
// The real report kernel (salesAnalytics.ts getSalesTotals) over the full
// migrated schema, the real shift arithmetic (composeShiftFigures, which every
// Telegram credit shares through the same totals) and the frontend's own
// credit predicate (statsFormulas.ts isCreditSale) on the same five sales, all
// $10, sold the same day:
//   S1  Not Paid, nothing paid, $4 back lowering the debt      owes $6   credit $6
//   S2  sold Not Paid, $7 paid, $4 back ($3 lowered, $1 cash)  owes $0   NOT credit (M3)
//   S3  Not Paid, $3 paid, nothing back                        owes $7   credit $7
//   S4  sold Not Paid, $4 back recorded before 0234 (cash)     owes $10  credit $10 until 0238
//   S5  Completed, paid                                        owes $0   not credit
// Discriminating: before the fix S2 counted as credit at $6 (pending 28, four
// credit sales, shift credit 28). Revenue is unchanged by the fix: $38.
//
// OWNER RULING 6 Oct 2026 (final): "Credit" is the BALANCE DUE everywhere --
// "a $10 Not Paid sale with $3 paid shows Credit $7" -- read by the one owed
// helper (recordedSaleOutstandingUsd), the Sales page's own reading. So the
// Credit is 6 + 7 + 10 = 23 on every surface: the report totals, the per-sale
// export rows, the /stats header, the shift and Telegram credit, the customer
// drill and the frontend fallback. The CONTROLS that must fail: the sale value
// on the revenue basis (22, S3 at $10 -- pending_revenue_usd, which stays the
// pending-profit footing) and the plain totals (30). S2 stays $0 (LH-16).
//
// Run (from cloudflare/): node scripts/test-report-not-paid-owed-pure.cjs
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

async function main() {
  const db = openDb(loadAll())
  db.exec(`
    INSERT INTO branches(id, name, is_active) VALUES (1, 'Shop', 1);
    INSERT INTO sales(id, receipt_number, branch_id, branch_name, created_at, subtotal_usd, total_usd, amount_paid_usd, amount_paid_khr,
      exchange_rate, sale_status, status_before_return) VALUES
      (1, 'S1', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 0, 0, 4000, 'awaiting_payment', NULL),
      (2, 'S2', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 7, 0, 4000, 'partial_return', 'awaiting_payment'),
      (3, 'S3', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 3, 0, 4000, 'awaiting_payment', NULL),
      (4, 'S4', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 0, 0, 4000, 'partial_return', 'awaiting_payment'),
      (5, 'S5', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4000, 'completed', NULL);
    INSERT INTO returns(id, return_number, sale_id, branch_id, cashier_id, return_scope, reason, total_refund_usd, total_refund_khr,
      exchange_rate, status, created_at, refund_currency, owed_reduction_usd) VALUES
      (11, 'R1', 1, 1, 7, 'customer', 'x', 4, 0, 4000, 'completed', '2026-09-20 05:00:00', 'USD', 4),
      (12, 'R2', 2, 1, 7, 'customer', 'x', 4, 0, 4000, 'completed', '2026-09-20 05:00:00', 'USD', 3),
      (14, 'R4', 4, 1, 7, 'customer', 'x', 4, 0, 4000, 'completed', '2026-09-20 05:00:00', NULL, 0);
    INSERT INTO customers(id, name) VALUES (9, 'Dara');
    UPDATE sales SET customer_id = 9, customer_name = 'Dara' WHERE id IN (2, 3, 4);
  `)
  const kernel = load(path.join(root, 'src/lib/salesAnalytics.ts'), { './db': { getDb: () => db } })
  const shift = load(path.join(root, 'src/lib/shiftReconciliation.ts'), { './db': { getDb: () => db } })
  const front = load(path.join(root, '../frontend/src/utils/statsFormulas.ts'))

  const totals = await kernel.getSalesTotals({}, { startDate: '2026-09-20', endDate: '2026-09-20' })
  assert.equal(totals.revenue_usd, 38, 'revenue is unchanged: $6 + $6 + $10 + $6 + $10')
  assert.equal(totals.pending_tx_count, 3, 'S2 owes $0: it is not a Not Paid sale (S1, S3, S4 are)')
  assert.equal(totals.pending_revenue_usd, 22, 'the pending-profit footing (sale value): $6 + $10 + $6, nothing for S2')
  assert.equal(totals.pending_owed_usd, 23, 'the Credit is the balance due: $6 + $7 + $10, nothing for S2 (not the sale value 22, not the totals 30)')
  assert.equal(totals.collected_total_usd, 16, 'S2 is collected like any paid sale: $7 paid - $1 cash back = $6, plus S5 $10')
  console.log('PASS the report kernel: a debt-cleared sale leaves the Not Paid detail; revenue unchanged')

  // The per-sale rows the Reports list and its export print: S3 owes $7.
  const rows = await kernel.getBusinessSummarySalesRows({}, { startDate: '2026-09-20', endDate: '2026-09-20' })
  const owedBy = Object.fromEntries(rows.map((row) => [row.receipt_number, row.pending_owed_usd]))
  assert.deepEqual(owedBy, { S1: 6, S2: 0, S3: 7, S4: 10, S5: 0 }, 'each export row prints what that sale still owes')
  assert.equal(rows.find((row) => row.receipt_number === 'S3').pending_revenue_usd, 10,
    'CONTROL: the same row\'s sale value is $10 -- the figure the ruling retired from every Credit')
  // The Sales page header (/stats) reduces the same snapshot.
  const stats = kernel.salesTotalsFromSnapshot(await kernel.readSalesReportSnapshot({}, {}, false, (alias) => ({
    sql: `${alias}.id IN (1, 2, 3, 4, 5)`, params: {} })))
  assert.equal(stats.pending_owed_usd, 23, 'the /stats header Credit is the same balance due')
  const salesRoute = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8')
  assert.ok(salesRoute.includes('pending_owed_usd: totals.pending_owed_usd'), 'the /stats header sends the balance due')
  console.log('PASS a $10 Not Paid sale with $3 paid is Credit $7 in the export rows and the header')

  const figures = shift.composeShiftFigures({ opening: null, additionalCash: null, counted: null, totals,
    expenses: null, deliveryFees: null, courier: null })
  assert.equal(figures.credit_usd, 23, 'the shift credit is the balance due and leaves S2 out (not 22, the sale value)')
  const legacy = shift.composeShiftFigures({ opening: null, additionalCash: null, counted: null,
    totals: { ...totals, pending_owed_usd: undefined }, expenses: null, deliveryFees: null, courier: null })
  assert.equal(legacy.credit_usd, 22, 'totals from before pending_owed_usd keep the figure they always printed')
  const telegram = fs.readFileSync(path.join(root, 'src/lib/telegram.ts'), 'utf8')
  assert.equal(telegram.split('creditUsd: totals.pending_owed_usd').length - 1, 3,
    'the day, shift and summary Telegram credits read the same balance due')
  assert.equal(telegram.split('creditUsd: totals.pending_revenue_usd').length - 1, 0,
    'no Telegram credit still prints the sale value')
  const customer = await kernel.getCustomerSalesTotals({}, { startDate: '2026-09-20', endDate: '2026-09-20', customerId: 9 })
  assert.equal(customer.collected_usd, 10, 'the customer drill (SQL twin) collects S2 and still holds S3 and S4 as credit')
  assert.equal(customer.credit_usd, 17, 'the customer drill Credit is what Dara still owes: S3 $7 + S4 $10 (not 16, the sale value)')
  console.log('PASS the shift credit, every Telegram credit and the customer drill are the balance due')

  const listRows = db.db.prepare(`SELECT s.*, (SELECT COALESCE(SUM(owed_reduction_usd), 0) FROM returns r
    WHERE r.sale_id = s.id AND COALESCE(r.status, 'completed') <> 'cancelled') AS return_owed_reduction_usd FROM sales s ORDER BY s.id`).all()
  assert.deepEqual(listRows.filter(front.isCreditSale).map((row) => row.id), [1, 3, 4],
    'the frontend credit predicate agrees with the kernel on the same rows')
  assert.equal(front.saleListCreditUsd(listRows), 23, 'the Sales page fallback Credit is the same balance due')
  assert.equal(front.saleListCreditUsd(listRows.filter((row) => row.id === 3)), 7, 'a $10 Not Paid sale with $3 paid shows Credit $7')
  assert.equal(front.saleListCreditUsd(listRows.filter((row) => row.id === 2)), 0, 'LH-16: a sale cleared by returns shows $0')
  assert.ok(front.isCreditSale({ sale_status: 'partial_return', status_before_return: 'awaiting_payment', subtotal_usd: 19 }),
    'a return-status row with no debt lowered (recorded before 0234) still reads as credit')
  console.log('PASS the frontend credit predicate mirrors the kernel cohort')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
