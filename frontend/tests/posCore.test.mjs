import assert from 'node:assert/strict'
import {
  buildProductsById,
  buildVariantChildrenByParentId,
  buildVisibleProductCards,
  findMatchingCartLineIndex,
  getCartLineId,
  getVariantChoices,
  getVariantRootProduct,
  resolveCartPriceValues,
} from '../src/components/pos/posCore.mjs'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('grouped products resolve to their parent card and sorted variant list', () => {
  const products = [
    { id: 1, name: 'Root Product', parent_id: null },
    { id: 3, name: 'Variant B', parent_id: 1 },
    { id: 2, name: 'Variant A', parent_id: 1 },
  ]
  const productsById = buildProductsById(products)
  const children = buildVariantChildrenByParentId(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(getVariantRootProduct(products[1], productsById).id, 1)
  assert.deepEqual(getVariantChoices(visible[0], children).map((item) => item.name), ['Root Product', 'Variant A', 'Variant B'])
  assert.deepEqual(visible.map((item) => item.id), [1])
})

await runTest('same-name standalone products collapse into one POS card with distinct choices', () => {
  const products = [
    { id: 21, name: 'Velvet Tint', parent_id: null, selling_price_usd: 7.5 },
    { id: 22, name: ' Velvet  Tint ', parent_id: null, selling_price_usd: 8.25 },
  ]
  const productsById = buildProductsById(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(visible.length, 1)
  assert.equal(visible[0].__displayName, 'Velvet Tint')
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [22, 21])
})

await runTest('same-name grouped families and standalone items share one POS option card', () => {
  const products = [
    { id: 30, name: 'Glow Serum', is_group: 1 },
    { id: 31, name: 'Glow Serum Large', parent_id: 30, selling_price_usd: 21 },
    { id: 32, name: 'Glow Serum', selling_price_usd: 18 },
  ]
  const productsById = buildProductsById(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(visible.length, 1)
  assert.equal(visible[0].__groupMeta.groupKind, 'option')
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [30, 31, 32])
})

await runTest('group cards still include parent and siblings when only one child matches filters', () => {
  const allProducts = [
    { id: 40, name: 'Glow Cream', is_group: 1, selling_price_usd: 0, stock_quantity: 0 },
    { id: 41, name: 'Glow Cream Small', parent_id: 40, selling_price_usd: 9, stock_quantity: 1 },
    { id: 42, name: 'Glow Cream Large', parent_id: 40, selling_price_usd: 12, stock_quantity: 2 },
  ]
  const productsById = buildProductsById(allProducts)
  const visible = buildVisibleProductCards([allProducts[1]], productsById)

  assert.equal(visible.length, 1)
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [40, 42, 41])
})

await runTest('cart line identity includes product, mode, and branch so modes do not merge', () => {
  const cart = [
    { id: 10, price_mode: 'selling', branch_id: 1, cart_line_id: 'selling-line' },
    { id: 10, price_mode: 'special', branch_id: 1, cart_line_id: 'special-line' },
  ]

  assert.equal(findMatchingCartLineIndex(cart, { productId: 10, priceMode: 'selling', branchId: 1 }), 0)
  assert.equal(findMatchingCartLineIndex(cart, { productId: 10, priceMode: 'special', branchId: 1 }), 1)
  assert.equal(getCartLineId({ id: 4, price_mode: 'selling', branch_id: 2 }), '4:selling:2')
})

await runTest('special price mode prefers special prices and falls back to selling prices', () => {
  const special = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 10, special_price_khr: 41000 },
    'special',
    4100,
  )
  assert.equal(special.price_mode, 'special')
  assert.equal(special.applied_price_usd, 10)
  assert.equal(special.applied_price_khr, 41000)

  const selling = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 0, special_price_khr: 0 },
    'special',
    4100,
  )
  assert.equal(selling.price_mode, 'selling')
  assert.equal(selling.applied_price_usd, 12)
})

if (failed > 0) {
  process.exitCode = 1
}
