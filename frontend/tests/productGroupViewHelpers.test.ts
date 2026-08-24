import assert from 'node:assert/strict'
import {
  buildProductGroupPriceLabel,
  buildProductGroupSummaryParts,
} from '../src/components/products/helpers/productGroupViewHelpers.ts'

const fmtUSD = (value: unknown) => `$${Number(value || 0).toFixed(2)}`
const t = (key: string) => ({
  option: 'option',
  options: 'options',
  stock: 'Stock',
} as Record<string, string>)[key] || key

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
  // includeBranches defaults true and branchNames is absent here, so
  // branchCount is 0 -- buildProductGroupBranchLabel now shows "0
  // branches" explicitly instead of returning null/being dropped.
  // No price part: a group's rows can have different prices, and this
  // summary line only ever showed one number for the whole group --
  // dropped rather than show something not representative of every row.
  ['2 options', '14 stock', '0 branches'],
)

assert.deepEqual(
  buildProductGroupSummaryParts({
    items: [{ id: 1 }],
    stockTotal: 1,
    minSellingPriceUsd: 4,
  }, { includeCount: false, t, fmtUSD }),
  ['1 stock', '0 branches'],
)

console.log('productGroupViewHelpers tests passed')
