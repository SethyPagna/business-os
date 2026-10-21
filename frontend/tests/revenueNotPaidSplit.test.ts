// Revenue WITH and WITHOUT Not Paid on every screen (owner, 20 Oct 2026), and
// the Not Paid line as the amount still OWED (owner, 21 Oct 2026). The Worker
// kernel computes the pair once (cloudflare/scripts/test-revenue-not-paid-split-pure.cjs);
// these checks hold the screens to it: Reports' statement and totals, the
// shift report rows, and the Dashboard / Sales / Inventory cards.
//
// Run (from frontend/): node tests/revenueNotPaidSplit.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildIncomeStatement, normalizeTotals, sumTotals } from '../src/components/sales/reports/reportModel.ts'
import { shiftFigureRows, type ShiftFiguresShape } from '../src/components/shifts/shiftReportModel.ts'

let passed = 0
const test = (name: string, fn: () => void): void => { fn(); passed += 1; console.log(`PASS ${name}`) }
const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

// The kernel's own figures for the Worker fixture: revenue 40.01 = paid only
// 15.01 + Not Paid 25.00; profit 16.01 = 5.01 + 11.00; still owed 23.01.
const kernel = {
  tx_count: 3, gross_sales_usd: 63.01, store_discount_usd: 0, membership_discount_usd: 0, discount_usd: 0, item_discount_usd: 0,
  total_discount_usd: 0, tax_usd: 0, delivery_usd: 2, store_delivery_usd: 0, delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0,
  delivery_sale_count: 1, delivery_margin_usd: 2, delivery_net_usd: 2, recognized_delivery_usd: 2, recognized_delivery_cost_usd: 0,
  net_sales_usd: 63.01, refund_usd: 23, revenue_usd: 40.01, pending_revenue_usd: 25, revenue_without_not_paid_usd: 15.01,
  not_paid_owed_usd: 23.01, collected_total_usd: 19.01, avg_order_usd: 13.34, pending_tx_count: 2, pending_gross_sales_usd: 38.01,
  pending_store_discount_usd: 0, pending_membership_discount_usd: 0, pending_delivery_usd: 2, pending_delivery_cost_usd: 0,
  cancelled_tx_count: 1, cost_usd: 26, profit_usd: 16.01, profit_without_not_paid_usd: 5.01, pending_cost_usd: 16, pending_profit_usd: 11,
  cost_missing_snapshot_lines: 0,
}
const memo = (totals: Record<string, unknown>) => Object.fromEntries(buildIncomeStatement({
  sales: normalizeTotals(totals), profitMode: 'gross', khrToUsd: (khr: number) => khr / 4100,
}).filter((line) => line.group === 'pending').map((line) => [line.key, line.usd]))

test('Reports statement: Not Paid, revenue and profit without it, and what it still owes', () => {
  assert.deepEqual(memo(kernel), { pending_revenue: 25, revenue_paid_only: 15.01, profit_paid_only: 5.01, not_paid_owed: 23.01 })
  assert.equal(Math.round((kernel.revenue_usd - kernel.revenue_without_not_paid_usd) * 100), Math.round(kernel.pending_revenue_usd * 100))
})

test('a caller without cost sees the revenue pair and the amount owed, never a paid-only profit', () => {
  const { cost_usd: _c, profit_usd: _p, profit_without_not_paid_usd: _w, pending_cost_usd: _pc, pending_profit_usd: _pp, ...staff } = kernel
  assert.deepEqual(memo(staff), { pending_revenue: 25, revenue_paid_only: 15.01, not_paid_owed: 23.01 })
})

test('an older Worker that sent no pair prints no $0.00 lines for it', () => {
  const { revenue_without_not_paid_usd: _r, not_paid_owed_usd: _o, profit_without_not_paid_usd: _w, ...old } = kernel
  assert.deepEqual(memo(old), { pending_revenue: 25 })
})

test('grouped and period totals sum the pair only when every row carried it', () => {
  const rows = [normalizeTotals(kernel)!, normalizeTotals({ ...kernel, revenue_without_not_paid_usd: 1.5, not_paid_owed_usd: 2, profit_without_not_paid_usd: 0.5 })!]
  const sum = sumTotals(rows)
  assert.equal(sum.revenue_without_not_paid_usd, 16.51)
  assert.equal(sum.not_paid_owed_usd, 25.01)
  assert.equal(sum.profit_without_not_paid_usd, 5.51)
  const { revenue_without_not_paid_usd: _r, ...partial } = kernel
  assert.equal(sumTotals([rows[0], normalizeTotals(partial)!]).revenue_without_not_paid_usd, undefined)
})

const shiftFigures: ShiftFiguresShape = {
  opening: { usd: 0, khr: 0 }, closing: { usd: 0, khr: 0 }, sales_usd: 40.01, cogs_usd: 26, profit_usd: 16.01,
  sales_without_not_paid_usd: 15.01, profit_without_not_paid_usd: 5.01, delivery_fee_usd: 2, credit_usd: 23.01, refunds_usd: 23,
  delivery_cost: { usd: 0, khr: 0 }, other_expenses: { usd: 0, khr: 0 },
}
test('shift report: paid-only revenue under sales, paid-only profit under profit, and the amount still owed', () => {
  const rows = shiftFigureRows(shiftFigures)
  assert.deepEqual(rows.map((row) => [row.key, row.usd]), [
    ['sales', 40.01], ['revenue_paid_only', 15.01], ['cogs', 26], ['profit', 16.01], ['profit_paid_only', 5.01],
    ['delivery_fees', 2], ['delivery_actual_cost', 0], ['shift_other_expenses', 0], ['refunds', 23], ['not_paid_owed', 23.01],
  ])
  const quiet = shiftFigureRows({ ...shiftFigures, sales_without_not_paid_usd: 40.01, profit_without_not_paid_usd: 16.01, credit_usd: 0 })
  assert.equal(quiet.some((row) => row.key.endsWith('_paid_only')), false, 'no Not Paid sales: no paid-only rows')
})

test('Dashboard, Sales and Inventory cards read the kernel pair (never derive it) and label it in both packs', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['revenue_paid_only', 'profit_paid_only', 'not_paid_owed', 'rpt_hint_revenue_paid_only', 'rpt_hint_not_paid_owed']) {
    assert.ok(en[key] && /[ក-៿]/.test(km[key] || ''), `${key} is in both packs`)
  }
  assert.equal(en.revenue_paid_only, 'Revenue (paid only)')
  assert.equal(en.not_paid_owed, 'Still owed')
  const dashboard = read('../src/components/dashboard/Dashboard.tsx')
  assert.match(dashboard, /const aRevenuePaidOnly = analytics\?\.totals\?\.revenue_without_not_paid_usd\r?\n/)
  assert.match(dashboard, /translateOr\('profit_paid_only', 'Profit \(paid only\)'\), value: fmtUSD\(aProfitPaidOnly\)/)
  assert.match(dashboard, /translateOr\('not_paid_owed', 'Still owed'\), value: fmtUSD\(aNotPaidOwed\)/)
  const sales = read('../src/components/sales/Sales.tsx')
  assert.match(sales, /salesStats\.revenue_without_not_paid_usd/)
  assert.match(sales, /translateOr\('revenue_paid_only', 'Revenue \(paid only\)'\), value: fmtUSD\(revenuePaidOnly\)/)
  const inventory = read('../src/components/inventory/Inventory.tsx')
  assert.match(inventory, /kernelTotals\.revenue_without_not_paid_usd/)
})

console.log(`\n${passed} passed`)
