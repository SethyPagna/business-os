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
  assert.equal(result.length, 1, 'one card for the name group')
  // The PRICE is what matters here, and it is still the highest of the three:
  // the storefront must never advertise below what some variant charges.
  assert.equal(result[0].selling_price_usd, 22)
  // The representative id is now the canonical (lowest) row rather than
  // whichever row happened to be dearest. These three share a name and have
  // no barcode and no cost, so under the identity rule they are ONE product,
  // and mergeSameDetailRows collapses them before this function sees them --
  // carrying the highest price forward via resolveMergedPricing. Previously
  // they stayed three rows and this picked the dearest one; same price on
  // screen, but the id now identifies a real product rather than a duplicate.
  assert.equal(result[0].id, 1)
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

await runTest('merged branch-duplicate rows combine server stock statuses (most available wins, per branch too)', () => {
  // Server-shaped rows (post-leak-fix payload: statuses, no quantities).
  // Row 1 is out everywhere except branch 1; row 2 carries branch 2. The
  // one merged card must not inherit only the lead row's availability.
  const products = [
    {
      id: 1, name: 'Rose Serum 30ml', selling_price_usd: 18, barcode: 'A',
      stock_status: 'out_of_stock',
      branch_availability: [{ branch_id: 1, status: 'low_stock' }, { branch_id: 2, status: 'out_of_stock' }],
    },
    {
      id: 2, name: 'Rose Serum 30ml', selling_price_usd: 18, barcode: 'A',
      stock_status: 'in_stock',
      branch_availability: [{ branch_id: 1, status: 'out_of_stock' }, { branch_id: 2, status: 'in_stock' }],
    },
  ]
  const result = mergePortalCatalogProducts(products)
  assert.equal(result.length, 1)
  assert.equal(result[0].stock_status, 'in_stock')
  const byBranch = new Map((result[0].branch_availability || []).map((entry: { branch_id?: unknown; status?: string }) => [String(entry.branch_id), entry.status]))
  assert.equal(byBranch.get('1'), 'low_stock')
  assert.equal(byBranch.get('2'), 'in_stock')
})

if (failed > 0) {
  process.exitCode = 1
}
