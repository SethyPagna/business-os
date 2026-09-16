import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '../src/components/sales/Sales.tsx'), 'utf8')

assert.match(source, /const itemDiscountUsd = Number\(totals\.item_discount_usd\) \|\| 0/)
assert.match(source, /const recognizedGrossUsd = \(Number\(totals\.gross_sales_usd\) \|\| 0\) \+ itemDiscountUsd/)
assert.match(source, /const totalDiscountUsd = Number\.isFinite\(explicitTotalDiscountUsd\)[\s\S]*\? explicitTotalDiscountUsd[\s\S]*: itemDiscountUsd \+ invoiceDiscountUsd/)
assert.match(source, /translateOr\('stats_gross', 'Gross sales'\), value: fmtUSD\(recognizedGrossUsd\)/)
assert.match(source, /translateOr\('discounts_total', 'Total discounts'\), value: fmtUSD\(totalDiscountUsd\)/)
assert.match(source, /label: t\('revenue'\) \|\| 'Revenue', value: fmtUSD\(revenueUsd\)/)

const normalize = (totals: Record<string, number | undefined>) => {
  const itemDiscountUsd = Number(totals.item_discount_usd) || 0
  const gross = (Number(totals.gross_sales_usd) || 0) + itemDiscountUsd
  const explicit = Number(totals.total_discount_usd)
  const discounts = Number.isFinite(explicit) ? explicit : itemDiscountUsd + (Number(totals.discount_usd) || 0)
  return { gross, discounts, revenue: Number(totals.revenue_usd) || 0 }
}

assert.deepEqual(
  normalize({ gross_sales_usd: 190, item_discount_usd: 10, discount_usd: 5, total_discount_usd: 15, revenue_usd: 185 }),
  { gross: 200, discounts: 15, revenue: 185 },
)
assert.deepEqual(
  normalize({ gross_sales_usd: 190, item_discount_usd: 0, discount_usd: 5, revenue_usd: 185 }),
  { gross: 190, discounts: 5, revenue: 185 },
)

console.log('sales header stats: all cases pass')
