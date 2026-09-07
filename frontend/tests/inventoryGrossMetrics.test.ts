import assert from 'node:assert/strict'
import fs from 'node:fs'

import { normalizeDashboardGrossMetrics } from '../src/api/dashboardTransport.ts'

const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

const displayed = normalizeDashboardGrossMetrics({
  gross_sales_usd: 190,
  item_discount_usd: 10,
  store_discount_usd: 5,
  membership_discount_usd: 0,
  discount_usd: 5,
  total_discount_usd: 15,
  revenue_usd: 185,
})

assert.equal(displayed.gross_sales_usd, 200, 'pre-discount gross adds item discounts once')
assert.equal(displayed.total_discount_usd, 15, 'total discounts include item and invoice discounts once')
assert.equal(displayed.revenue_usd, 185, 'canonical net revenue remains unchanged')
assert.equal(
  normalizeDashboardGrossMetrics({ gross_sales_usd: 100, item_discount_usd: 0, total_discount_usd: 0 }).gross_sales_usd,
  100,
  'zero-discount gross remains unchanged',
)

assert.match(inventory, /const stripDisplayTotals = normalizeDashboardGrossMetrics\(kernelTotals\)/)
assert.match(inventory, /const stripGross = Number\(stripDisplayTotals\.gross_sales_usd\)/)
assert.match(inventory, /const stripTotalDiscount = Number\(stripDisplayTotals\.total_discount_usd\)/)
assert.match(inventory, /rpt_item_discounts[\s\S]{0,280}stripItemDiscount/)
assert.match(inventory, /discounts_total[\s\S]{0,220}stripTotalDiscount/)
assert.match(inventory, /stripTotalDiscount \/ stripGross/)

console.log('PASS inventory gross and discount presentation parity')
