import assert from 'node:assert/strict'
import {
  buildProductGroupPriceLabel,
  buildProductGroupSummaryParts,
} from '../src/components/products/helpers/productGroupViewHelpers.mjs'

const fmtUSD = (value) => `$${Number(value || 0).toFixed(2)}`
const t = (key) => ({
  option: 'option',
  options: 'options',
  stock: 'Stock',
}[key] || key)

assert.equal(
  buildProductGroupPriceLabel({ hasMultipleItems: true, minSellingPriceUsd: 5, maxSellingPriceUsd: 9 }, fmtUSD),
  '$5.00 - $9.00',
  'multiple item groups show a price range',
)

assert.equal(
  buildProductGroupPriceLabel({ hasMultipleItems: true, minSellingPriceUsd: 7, maxSellingPriceUsd: 7 }, fmtUSD),
  '$7.00',
  'same min/max groups show one price',
)

assert.equal(
  buildProductGroupPriceLabel({ hasMultipleItems: false, minSellingPriceUsd: 0, maxSellingPriceUsd: 12 }, fmtUSD),
  '$12.00',
  'single item groups show the available max price',
)

assert.deepEqual(
  buildProductGroupSummaryParts({
    items: [{ id: 1 }, { id: 2 }],
    stockTotal: 14,
    hasMultipleItems: true,
    minSellingPriceUsd: 5,
    maxSellingPriceUsd: 9,
  }, { t, fmtUSD }),
  ['2 options', '14 stock', '$5.00 - $9.00'],
)

assert.deepEqual(
  buildProductGroupSummaryParts({
    items: [{ id: 1 }],
    stockTotal: 1,
    minSellingPriceUsd: 4,
  }, { includeCount: false, t, fmtUSD }),
  ['1 stock', '$4.00'],
)

console.log('productGroupViewHelpers tests passed')
