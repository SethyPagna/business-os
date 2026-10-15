import assert from 'node:assert/strict'
import { mergeSameDetailRows } from '../src/utils/productGrouping.ts'
import { resolveProductMergeEconomics } from '../src/utils/productMerge.ts'

const economics = resolveProductMergeEconomics([
  { id: 1, cost_price_usd: 4, selling_price_usd: 5, wholesale_price_usd: 3 },
  { id: 2, cost_price_usd: 5, selling_price_usd: 9, wholesale_price_usd: 4 },
  { id: 3, cost_price_usd: 6, selling_price_usd: 7, wholesale_price_usd: 2 },
])
assert.equal(economics.merged.cost_price_usd, 5)
assert.equal(economics.merged.selling_price_usd, 9)
assert.equal(economics.merged.wholesale_price_usd, 4)
assert.equal(resolveProductMergeEconomics([
  { id: 11, cost_price_usd: 130.6595 },
  { id: 12, cost_price_usd: 130.6596 },
]).merged.cost_price_usd, 130.6596)

const rows = mergeSameDetailRows([
  { id: 1, name: 'Tea', barcode: '000123', cost_price_usd: 4, selling_price_usd: 5 },
  { id: 2, name: ' tea ', barcode: '00123', cost_price_usd: 5, selling_price_usd: 9 },
  { id: 3, name: 'TEA', barcode: '123', cost_price_usd: 6, selling_price_usd: 7 },
])
assert.equal(rows.length, 1)
assert.equal(rows[0].cost_price_usd, 5)
assert.equal(rows[0].selling_price_usd, 9)
assert.equal(rows[0].barcode, '123')

const quarantined = mergeSameDetailRows([
  { id: 4, name: 'Cream', barcode: '456', cost_price_usd: -1 },
  { id: 5, name: 'Cream', barcode: '0456', cost_price_usd: 4 },
])
assert.equal(quarantined.length, 2)

assert.deepEqual(resolveProductMergeEconomics([{ cost_price_usd: null }, { cost_price_usd: null }]).merged, { cost_price_usd: null })
assert.deepEqual(resolveProductMergeEconomics([{}, {}]).merged, {})
assert.equal(resolveProductMergeEconomics([{ cost_price_usd: null }, { cost_price_usd: 0 }]).merged.cost_price_usd, 0)
assert.equal(resolveProductMergeEconomics([{ cost_price_usd: 0 }, { cost_price_usd: 5 }]).merged.cost_price_usd, 5)
assert.equal(mergeSameDetailRows([
  { id: 10, name: 'Unknown', barcode: '123', cost_price_usd: null },
  { id: 11, name: 'Unknown', barcode: '0123', cost_price_usd: null },
])[0].cost_price_usd, null)

console.log('productMergeKernel: all checks passed')
