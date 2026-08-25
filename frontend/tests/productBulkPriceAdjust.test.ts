import assert from 'node:assert/strict'
import {
  buildProductBulkPriceAdjustments,
  countProductBulkPriceAdjustments,
  type BulkPriceAdjustment,
} from '../src/components/products/helpers/productWriteHelpers.ts'

// Relative bulk price adjustment: "add $1 to all of these", "take 500 riel
// off", as opposed to the existing bulk pricing which SETS one absolute
// price on every selected product (and would flatten a mixed catalogue to a
// single value).
//
// Everything here is about the ways a money bulk-edit goes wrong quietly:
// touching a field the person did not choose, inventing a price for a
// product nobody has priced, driving a price negative, accumulating
// floating-point dust, or reporting that it changed rows it did not.

const products = [
  { id: 1, selling_price_usd: 10, selling_price_khr: 40000, purchase_price_usd: 6 },
  { id: 2, selling_price_usd: 2.5, selling_price_khr: 10000, purchase_price_usd: 1 },
  { id: 3, selling_price_usd: 0, selling_price_khr: 0, purchase_price_usd: 0 },
]

const adjust = (over: Partial<BulkPriceAdjustment>): BulkPriceAdjustment => ({
  direction: 'increase',
  amount: 1,
  fields: ['selling_price_usd'],
  ...over,
})

// --- the basic operation --------------------------------------------------

{
  const out = buildProductBulkPriceAdjustments(products, adjust({}))
  assert.deepEqual(
    out,
    [
      { id: 1, updates: { selling_price_usd: 11 } },
      { id: 2, updates: { selling_price_usd: 3.5 } },
      { id: 3, updates: { selling_price_usd: 1 } },
    ],
    'increase adds to each product\'s OWN price rather than setting one shared value',
  )
  console.log('PASS increase adds per-product')
}

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ direction: 'decrease', amount: 2 }))
  assert.deepEqual(out.find((r) => r.id === 1)?.updates, { selling_price_usd: 8 })
  assert.deepEqual(out.find((r) => r.id === 2)?.updates, { selling_price_usd: 0.5 })
  console.log('PASS decrease subtracts per-product')
}

// --- scope: only the chosen fields move ----------------------------------

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ fields: ['selling_price_usd'] }))
  for (const row of out) {
    assert.deepEqual(
      Object.keys(row.updates),
      ['selling_price_usd'],
      '"selling price only" must not also move cost price -- that would silently change every margin',
    )
  }
  console.log('PASS selling-price-only touches nothing else')
}

{
  const out = buildProductBulkPriceAdjustments(products, adjust({
    fields: ['selling_price_usd', 'purchase_price_usd'],
  }))
  assert.deepEqual(out.find((r) => r.id === 1)?.updates, { selling_price_usd: 11, purchase_price_usd: 7 })
  console.log('PASS multiple chosen fields all move')
}

{
  assert.deepEqual(buildProductBulkPriceAdjustments(products, adjust({ fields: [] })), [], 'no fields chosen is a no-op')
  console.log('PASS no fields chosen changes nothing')
}

// --- currency: KHR is adjusted in riel, not dollars ----------------------

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ amount: 500, fields: ['selling_price_khr'] }))
  assert.deepEqual(out.find((r) => r.id === 1)?.updates, { selling_price_khr: 40500 })
  assert.deepEqual(out.find((r) => r.id === 2)?.updates, { selling_price_khr: 10500 })
  console.log('PASS KHR adjusts in riel')
}

// --- the zero-price rule -------------------------------------------------

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ skipZeroPriced: true }))
  assert.deepEqual(
    out.map((r) => r.id),
    [1, 2],
    'a 0 price means "not priced yet" -- adding to it would invent a price for a product nobody has priced',
  )
  console.log('PASS skipZeroPriced leaves unpriced products alone')
}

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ skipZeroPriced: false }))
  assert.equal(out.length, 3, 'without the option, a 0-priced product IS adjusted')
  assert.deepEqual(out.find((r) => r.id === 3)?.updates, { selling_price_usd: 1 })
  console.log('PASS the zero rule is opt-in, not forced')
}

{
  // Mixed case: product 3 has selling 0 but the option only skips the field
  // being adjusted, per field, rather than skipping the whole product.
  const mixed = [{ id: 9, selling_price_usd: 0, purchase_price_usd: 5 }]
  const out = buildProductBulkPriceAdjustments(mixed, adjust({
    fields: ['selling_price_usd', 'purchase_price_usd'],
    skipZeroPriced: true,
  }))
  assert.deepEqual(out, [{ id: 9, updates: { purchase_price_usd: 6 } }], 'skips the zero FIELD, still adjusts the priced one')
  console.log('PASS the zero rule applies per field, not per product')
}

// --- never negative -------------------------------------------------------

{
  const out = buildProductBulkPriceAdjustments(products, adjust({ direction: 'decrease', amount: 100 }))
  for (const row of out) {
    for (const value of Object.values(row.updates)) {
      assert.ok((value as number) >= 0, 'a decrease larger than the price must clamp at 0, never go negative')
    }
  }
  assert.deepEqual(out.find((r) => r.id === 1)?.updates, { selling_price_usd: 0 })
  assert.ok(!out.some((r) => r.id === 3), 'a product already at 0 produces no update at all')
  console.log('PASS decrease clamps at zero and skips no-op rows')
}

// --- rounding -------------------------------------------------------------

{
  const messy = [{ id: 7, selling_price_usd: 0.1, selling_price_khr: 100.4 }]
  const usd = buildProductBulkPriceAdjustments(messy, adjust({ amount: 0.2 }))
  assert.deepEqual(usd, [{ id: 7, updates: { selling_price_usd: 0.3 } }], '0.1 + 0.2 must be 0.3, not 0.30000000000000004')
  const khr = buildProductBulkPriceAdjustments(messy, adjust({ amount: 0.6, fields: ['selling_price_khr'] }))
  assert.deepEqual(khr, [{ id: 7, updates: { selling_price_khr: 101 } }], 'KHR rounds to whole riel')
  console.log('PASS money is rounded, so repeated adjustments cannot accumulate dust')
}

// --- no-op safety ---------------------------------------------------------

{
  assert.deepEqual(buildProductBulkPriceAdjustments(products, adjust({ amount: 0 })), [], 'a zero amount writes nothing')
  assert.deepEqual(buildProductBulkPriceAdjustments(products, adjust({ amount: '' })), [], 'a blank amount writes nothing')
  assert.deepEqual(buildProductBulkPriceAdjustments([], adjust({})), [], 'no products, no updates')
  console.log('PASS zero/blank amounts are no-ops rather than same-value writes')
}

{
  // A negative amount is treated as a magnitude; `direction` is the only
  // thing that decides the sign, so "-5" typed into an increase cannot
  // secretly become a decrease.
  const out = buildProductBulkPriceAdjustments(products, adjust({ amount: -5 }))
  assert.deepEqual(out.find((r) => r.id === 1)?.updates, { selling_price_usd: 15 })
  console.log('PASS direction alone decides the sign')
}

// --- counting matches doing ----------------------------------------------

{
  const a = adjust({ skipZeroPriced: true })
  assert.equal(
    countProductBulkPriceAdjustments(products, a),
    buildProductBulkPriceAdjustments(products, a).length,
    'the previewed count must equal what actually gets written',
  )
  assert.equal(countProductBulkPriceAdjustments(products, a), 2)
  console.log('PASS preview count equals the real change count')
}

{
  // Rows with a bad or missing id are ignored rather than producing an
  // update with no target.
  const bad = [{ id: 0, selling_price_usd: 5 }, { selling_price_usd: 5 }, { id: 'x', selling_price_usd: 5 }]
  assert.deepEqual(buildProductBulkPriceAdjustments(bad as never, adjust({})), [])
  console.log('PASS rows without a usable id are ignored')
}

console.log('\nproductBulkPriceAdjust tests passed')
