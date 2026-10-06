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
//   S3  Not Paid, $3 paid, nothing back                        owes $7   credit $10 (sale value)
//   S4  sold Not Paid, $4 back recorded before 0234 (cash)     owes $10  credit $6 until 0238
//   S5  Completed, paid                                        owes $0   not credit
// Discriminating: before the fix S2 counted as credit at $6 (pending 28, four
// credit sales, shift credit 28). Revenue is unchanged by the fix: $38.
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
    UPDATE sales SET customer_id = 9, customer_name = 'Dara' WHERE id IN (2, 4);
  `)
  const kernel = load(path.join(root, 'src/lib/salesAnalytics.ts'), { './db': { getDb: () => db } })
  const shift = load(path.join(root, 'src/lib/shiftReconciliation.ts'), { './db': { getDb: () => db } })
  const front = load(path.join(root, '../frontend/src/utils/statsFormulas.ts'))

  const totals = await kernel.getSalesTotals({}, { startDate: '2026-09-20', endDate: '2026-09-20' })
  assert.equal(totals.revenue_usd, 38, 'revenue is unchanged: $6 + $6 + $10 + $6 + $10')
  assert.equal(totals.pending_tx_count, 3, 'S2 owes $0: it is not a Not Paid sale (S1, S3, S4 are)')
  assert.equal(totals.pending_revenue_usd, 22, 'the Not Paid detail: $6 + $10 + $6, nothing for S2')
  assert.equal(totals.collected_total_usd, 16, 'S2 is collected like any paid sale: $7 paid - $1 cash back = $6, plus S5 $10')
  console.log('PASS the report kernel: a debt-cleared sale leaves the Not Paid detail; revenue unchanged')

  const figures = shift.composeShiftFigures({ opening: null, additionalCash: null, counted: null, totals,
    expenses: null, deliveryFees: null, courier: null })
  assert.equal(figures.credit_usd, 22, 'the shift credit leaves S2 out')
  const telegram = fs.readFileSync(path.join(root, 'src/lib/telegram.ts'), 'utf8')
  assert.equal(telegram.split('creditUsd: totals.pending_revenue_usd').length - 1, 3,
    'the day, shift and summary Telegram credits read the same kernel figure, so they leave S2 out too')
  const customer = await kernel.getCustomerSalesTotals({}, { startDate: '2026-09-20', endDate: '2026-09-20', customerId: 9 })
  assert.equal(customer.collected_usd, 10, 'the customer drill (SQL twin) collects S2 and still holds S4 as credit')
  console.log('PASS the shift credit and every Telegram credit leave a debt-cleared sale out')

  const listRows = db.db.prepare(`SELECT s.*, (SELECT COALESCE(SUM(owed_reduction_usd), 0) FROM returns r
    WHERE r.sale_id = s.id AND COALESCE(r.status, 'completed') <> 'cancelled') AS return_owed_reduction_usd FROM sales s ORDER BY s.id`).all()
  assert.deepEqual(listRows.filter(front.isCreditSale).map((row) => row.id), [1, 3, 4],
    'the frontend credit predicate agrees with the kernel on the same rows')
  assert.ok(front.isCreditSale({ sale_status: 'partial_return', status_before_return: 'awaiting_payment', subtotal_usd: 19 }),
    'a return-status row with no debt lowered (recorded before 0234) still reads as credit')
  console.log('PASS the frontend credit predicate mirrors the kernel cohort')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
