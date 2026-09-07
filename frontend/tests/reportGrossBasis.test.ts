import assert from 'node:assert/strict'
import { basisValue, buildIncomeStatement, normalizeTotals, sumTotals } from '../src/components/sales/reports/reportModel.ts'

// Two sales: list prices total 200, item discount 10, invoice discount 5.
// Headline, grouped shares and statement must describe the same gross figure.
const totals = normalizeTotals({
  gross_sales_usd: 190, item_discount_usd: 10, store_discount_usd: 5,
  total_discount_usd: 15, revenue_usd: 185, collected_total_usd: 85,
})!
assert.equal(basisValue(totals, 'gross'), 200)
assert.equal(basisValue(totals, 'revenue'), 185)
assert.equal(basisValue(totals, 'collected'), 85)
const statement = buildIncomeStatement({ sales: totals, profitMode: 'net', khrToUsd: (amount) => amount / 4100 })
assert.equal(statement.find(row => row.key === 'total_sales')?.usd, basisValue(totals, 'gross'))
const second = normalizeTotals({ gross_sales_usd: 50, item_discount_usd: 50, revenue_usd: 50 })!
const combined = sumTotals([totals, second])
assert.equal(basisValue(combined, 'gross'), 300)
assert.equal(basisValue(totals, 'gross') / basisValue(combined, 'gross'), 2 / 3)
assert.equal(basisValue(normalizeTotals({ gross_sales_usd: 20 }), 'gross'), 20)
assert.equal(basisValue(null, 'gross'), 0)
console.log('PASS gross report bases agree with displayed statement and grouped totals')
