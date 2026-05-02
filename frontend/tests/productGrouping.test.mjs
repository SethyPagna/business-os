import assert from 'node:assert/strict'
import { buildProductGroups, buildProductGroupSections, getNameInitialSection, normalizeProductGroupName } from '../src/utils/productGrouping.mjs'

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

await runTest('normalizeProductGroupName collapses whitespace and casing', () => {
  assert.equal(normalizeProductGroupName('  Eros   Eau  De Parfum '), 'eros eau de parfum')
})

await runTest('buildProductGroups merges same-name standalone products into one clean cluster', () => {
  const products = [
    { id: 1, name: 'Eros Eau de Parfum 200ml', stock_quantity: 2, selling_price_usd: 115 },
    { id: 2, name: '  Eros   Eau de Parfum 200ml ', stock_quantity: 3, selling_price_usd: 118, supplier: 'Supplier B' },
  ]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))

  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'Eros Eau de Parfum 200ml')
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[0].stockTotal, 5)
  assert.equal(groups[0].minSellingPriceUsd, 115)
  assert.equal(groups[0].maxSellingPriceUsd, 118)
})

await runTest('buildProductGroups keeps explicit parent-child variants under one root cluster', () => {
  const products = [
    { id: 10, name: 'Gloss', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    { id: 11, name: 'Gloss Pink', parent_id: 10, stock_quantity: 1, selling_price_usd: 7.5 },
    { id: 12, name: 'Gloss Nude', parent_id: 10, stock_quantity: 4, selling_price_usd: 8.25 },
  ]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))

  assert.equal(groups.length, 1)
  assert.equal(groups[0].leadProduct.id, 10)
  assert.deepEqual(groups[0].sellableItems.map((item) => item.id), [12, 11])
  assert.deepEqual(groups[0].sellableItems.map((item) => item.__variantLabel), ['#1', '#2'])
  assert.equal(groups[0].groupKind, 'variant')
})

await runTest('buildProductGroupSections splits grouped products by leading letter for quick navigation', () => {
  const products = [
    { id: 1, name: 'Alpha', stock_quantity: 1, selling_price_usd: 5 },
    { id: 2, name: 'Alpha', stock_quantity: 1, selling_price_usd: 6 },
    { id: 3, name: 'Beta', stock_quantity: 1, selling_price_usd: 7 },
  ]
  const sections = buildProductGroupSections(products, {
    productsById: new Map(products.map((product) => [product.id, product])),
    sortDirection: 'desc',
  })

  assert.deepEqual(sections.map((section) => section.label), ['A', 'B'])
  assert.equal(sections[0].groups[0].items.length, 2)
  assert.equal(sections[1].groups[0].name, 'Beta')
})

await runTest('buildProductGroups merges same-name roots into one option group', () => {
  const products = [
    { id: 20, name: 'Serum', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    { id: 21, name: 'Serum Large', parent_id: 20, stock_quantity: 2, selling_price_usd: 15 },
    { id: 22, name: 'Serum', stock_quantity: 4, selling_price_usd: 18 },
  ]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))

  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 3)
  assert.equal(groups[0].groupKind, 'option')
  assert.deepEqual(groups[0].sellableItems.map((item) => item.id), [21, 22])
})

await runTest('buildProductGroupSections supports Khmer initial sections', () => {
  const products = [
    { id: 1, name: 'ក្រែមលាបមុខ', stock_quantity: 1, selling_price_usd: 5 },
    { id: 2, name: 'Alpha', stock_quantity: 1, selling_price_usd: 6 },
    { id: 3, name: 'សាប៊ូ', stock_quantity: 1, selling_price_usd: 7 },
  ]
  const sections = buildProductGroupSections(products, {
    productsById: new Map(products.map((product) => [product.id, product])),
  })

  assert.equal(getNameInitialSection('ក្រែមលាបមុខ'), 'ក')
  assert.deepEqual(sections.map((section) => section.label), ['A', 'ក', 'ស'])
})

await runTest('buildProductGroups expands a filtered child back to the full product family', () => {
  const allProducts = [
    { id: 30, name: 'Mask', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    { id: 31, name: 'Mask Small', parent_id: 30, stock_quantity: 1, selling_price_usd: 5.5 },
    { id: 32, name: 'Mask Large', parent_id: 30, stock_quantity: 2, selling_price_usd: 7.25 },
  ]
  const productsById = new Map(allProducts.map((product) => [product.id, product]))
  const groups = buildProductGroups([allProducts[2]], productsById)

  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].items.map((item) => item.id), [30, 32, 31])
  assert.deepEqual(groups[0].matchedIds, [32])
})

if (failed > 0) {
  process.exitCode = 1
}
