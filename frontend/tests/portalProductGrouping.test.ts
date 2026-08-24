import assert from 'node:assert/strict'
import { collapsePortalProductGroups, mergePortalCatalogProducts } from '../src/components/catalog/portalProductGrouping.ts'

// The public portal is a display-only surface (no cart/checkout, and price
// is frequently hidden entirely) -- unlike Products/Inventory/POS, it
// should never show a customer the same product name as several
// almost-identical cards (one per branch/price/barcode variant). See the
// comment above collapsePortalProductGroups in PublicCatalogPage.tsx.

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

await runTest('collapsePortalProductGroups reduces same-name variants to a single card', () => {
  const products = [
    { id: 1, name: 'Rose Serum 30ml', selling_price_usd: 18, barcode: 'A' },
    { id: 2, name: 'Rose Serum 30ml', selling_price_usd: 22, barcode: 'B' },
    { id: 3, name: 'Rose Serum 30ml', selling_price_usd: 15, barcode: 'C' },
  ]
  const result = collapsePortalProductGroups(products)
  assert.equal(result.length, 1)
})

await runTest('collapsePortalProductGroups keeps the highest-priced variant to represent the group', () => {
  const products = [
    { id: 1, name: 'Rose Serum 30ml', selling_price_usd: 18 },
    { id: 2, name: 'Rose Serum 30ml', selling_price_usd: 22 },
    { id: 3, name: 'Rose Serum 30ml', selling_price_usd: 15 },
  ]
  const result = collapsePortalProductGroups(products)
  assert.equal(result[0].id, 2)
  assert.equal(result[0].selling_price_usd, 22)
})

await runTest('collapsePortalProductGroups leaves distinct product names alone', () => {
  const products = [
    { id: 1, name: 'Rose Serum 30ml', selling_price_usd: 18 },
    { id: 2, name: 'Vitamin C Toner', selling_price_usd: 12 },
  ]
  const result = collapsePortalProductGroups(products)
  assert.equal(result.length, 2)
})

await runTest('collapsePortalProductGroups is a no-op for a group with only one item', () => {
  const products = [{ id: 1, name: 'Solo Item', selling_price_usd: 9 }]
  const result = collapsePortalProductGroups(products)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 1)
})

await runTest('mergePortalCatalogProducts merges branch-duplicate rows first, then collapses the name group', () => {
  // Two rows that are the SAME product split across branches (a storage
  // concern, always merged) plus a genuinely different-priced variant of
  // the same product name (a real variant, collapsed to the highest price
  // by the group step). End result should be exactly one card.
  const products = [
    { id: 1, name: 'Rose Serum 30ml', selling_price_usd: 18, barcode: 'A', branch_stock: [{ branch_id: 1, quantity: 3 }] },
    { id: 2, name: 'Rose Serum 30ml', selling_price_usd: 18, barcode: 'A', branch_stock: [{ branch_id: 2, quantity: 4 }] },
    { id: 3, name: 'Rose Serum 30ml', selling_price_usd: 25, barcode: 'B' },
  ]
  const result = mergePortalCatalogProducts(products)
  assert.equal(result.length, 1)
  assert.equal(result[0].selling_price_usd, 25)
})

await runTest('mergePortalCatalogProducts handles an empty/missing product list', () => {
  assert.deepEqual(mergePortalCatalogProducts(undefined), [])
  assert.deepEqual(mergePortalCatalogProducts([]), [])
})

if (failed > 0) {
  process.exitCode = 1
}
