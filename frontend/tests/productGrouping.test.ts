import assert from 'node:assert/strict'
import { buildProductCategorySections, buildProductGroups, buildProductGroupSections, getNameInitialSection, hideZeroStockGroupedChildRows, normalizeProductGroupName } from '../src/utils/productGrouping.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
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

await runTest('buildProductGroups sorts same-name variants by branch before price, then by barcode', () => {
  // Regression test for the previously-blocked "Groups sort order" request:
  // name -> branch -> price -> barcode. A product isn't tied to one branch
  // (it carries a branch_stock array), so "branch" here means each
  // product's primary branch label (alphabetically-first branch it has
  // stock in) -- see getPrimaryBranchLabel in productGrouping.ts.
  const products = [
    { id: 30, name: 'Board', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    // Same name as its sibling; cheaper, but stocked only at the
    // alphabetically-later branch -- should sort AFTER its sibling despite
    // the lower price, proving branch outranks price.
    {
      id: 31, name: 'Board Standard', parent_id: 30, stock_quantity: 5, selling_price_usd: 10,
      branch_stock: [{ branch_id: 2, branch_name: 'Siem Reap', quantity: 5 }],
    },
    {
      id: 32, name: 'Board Standard', parent_id: 30, stock_quantity: 5, selling_price_usd: 20,
      branch_stock: [{ branch_id: 1, branch_name: 'Phnom Penh', quantity: 5 }],
    },
  ]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))
  assert.deepEqual(groups[0].sellableItems.map((item) => item.id), [32, 31], 'Phnom Penh (32) should sort before Siem Reap (31) even though it costs more')

  // Same name, same branch, same price -> tiebreak falls through to barcode.
  const barcodeProducts = [
    { id: 40, name: 'Cable', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    {
      id: 41, name: 'Cable 2m', parent_id: 40, stock_quantity: 3, selling_price_usd: 5, barcode: 'B200',
      branch_stock: [{ branch_id: 1, branch_name: 'Phnom Penh', quantity: 3 }],
    },
    {
      id: 42, name: 'Cable 2m', parent_id: 40, stock_quantity: 3, selling_price_usd: 5, barcode: 'A100',
      branch_stock: [{ branch_id: 1, branch_name: 'Phnom Penh', quantity: 3 }],
    },
  ]
  const barcodeGroups = buildProductGroups(barcodeProducts, new Map(barcodeProducts.map((product) => [product.id, product])))
  assert.deepEqual(barcodeGroups[0].sellableItems.map((item) => item.id), [42, 41], 'lower barcode (A100, id 42) should sort first once name/branch/price all tie')

  // A product with no branch_stock at all sorts after any branch-assigned
  // product with the same name, rather than colliding with them.
  const unassignedProducts = [
    { id: 50, name: 'Mug', is_group: 1, stock_quantity: 0, selling_price_usd: 0 },
    { id: 51, name: 'Mug Blue', parent_id: 50, stock_quantity: 2, selling_price_usd: 8 },
    {
      id: 52, name: 'Mug Blue', parent_id: 50, stock_quantity: 2, selling_price_usd: 8,
      branch_stock: [{ branch_id: 1, branch_name: 'Phnom Penh', quantity: 2 }],
    },
  ]
  const unassignedGroups = buildProductGroups(unassignedProducts, new Map(unassignedProducts.map((product) => [product.id, product])))
  assert.deepEqual(unassignedGroups[0].sellableItems.map((item) => item.id), [52, 51], 'the branch-assigned item (52) should sort before the branch-less one (51)')
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
    { id: 1, name: '\u1780\u17D2\u179A\u17C1\u1798\u179B\u17B6\u1794\u1798\u17BB\u1781', stock_quantity: 1, selling_price_usd: 5 },
    { id: 2, name: 'Alpha', stock_quantity: 1, selling_price_usd: 6 },
    { id: 3, name: '\u179F\u17B6\u1794\u17CA\u17BC', stock_quantity: 1, selling_price_usd: 7 },
  ]
  const sections = buildProductGroupSections(products, {
    productsById: new Map(products.map((product) => [product.id, product])),
  })

  assert.equal(getNameInitialSection('\u1780\u17D2\u179A\u17C1\u1798\u179B\u17B6\u1794\u1798\u17BB\u1781'), '\u1780')
  assert.deepEqual(sections.map((section) => section.label), ['A', '\u1780', '\u179F'])
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

await runTest('buildProductGroups unions distinct branch names across a group\'s items', () => {
  const products = [
    {
      id: 40,
      name: 'Rose Serum 30ml',
      stock_quantity: 4,
      selling_price_usd: 22,
      branch_stock: [{ branch_id: 1, branch_name: 'Riverside', quantity: 2 }, { branch_id: 2, branch_name: 'Downtown', quantity: 2 }],
    },
    {
      id: 41,
      name: 'Rose Serum 30ml',
      stock_quantity: 3,
      selling_price_usd: 22,
      branch_stock: [{ branch_id: 2, branch_name: 'Downtown', quantity: 3 }],
    },
  ]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))

  assert.equal(groups.length, 1)
  // Downtown appears on both items but should only be counted once; sorted
  // alphabetically so the header renders deterministically.
  assert.deepEqual(groups[0].branchNames, ['Downtown', 'Riverside'])
})

await runTest('buildProductGroups returns an empty branchNames array for products with no branch_stock', () => {
  const products = [{ id: 42, name: 'No Branch Data', stock_quantity: 1, selling_price_usd: 10 }]
  const groups = buildProductGroups(products, new Map(products.map((product) => [product.id, product])))
  assert.deepEqual(groups[0].branchNames, [])
})

await runTest('Products can hide all-zero multi-branch child rows without hiding standalone zero products', () => {
  const products = [
    { id: 1, name: 'Same Name', barcode: '111', cost_price_usd: 1, stock_quantity: 0, branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 0 }, { branch_id: 2, branch_name: 'Shop', quantity: 0 }] },
    { id: 2, name: 'Same Name', barcode: '222', cost_price_usd: 2, stock_quantity: 3, branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 2 }, { branch_id: 2, branch_name: 'Shop', quantity: 1 }] },
    { id: 3, name: 'Standalone Zero', barcode: '333', cost_price_usd: 3, stock_quantity: 0, branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 0 }, { branch_id: 2, branch_name: 'Shop', quantity: 0 }] },
  ]
  const sections = hideZeroStockGroupedChildRows(buildProductCategorySections(products, { productsById: new Map(products.map((product) => [product.id, product])) }))
  const visibleIds = sections.flatMap((section) => section.ids)
  assert.deepEqual(visibleIds.sort((a, b) => a - b), [2, 3])
  const sameName = sections.flatMap((section) => section.groups).find((group) => group.name === 'Same Name')
  assert.equal(sameName?.rows.length, 1)
})

if (failed > 0) {
  process.exitCode = 1
}
