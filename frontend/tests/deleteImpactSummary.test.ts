import assert from 'node:assert/strict'
import { summarizeDeleteImpact } from '../src/utils/deleteImpactSummary.ts'

// Single product, no stock, no image, no batches -- baseline empty case.
assert.deepEqual(summarizeDeleteImpact([{ id: 1, name: 'Empty Product' }]), {
  productCount: 1,
  productNames: ['Empty Product'],
  totalStockUnits: 0,
  branchesWithStock: 0,
  productsWithImages: 0,
  productsWithBatches: 0,
})

// A product with stock at two branches, an image, and batches.
const richProduct = {
  id: 2,
  name: 'Rich Product',
  branch_stock: [
    { branch_id: 1, branch_name: 'Main', quantity: 5 },
    { branch_id: 2, branch_name: 'Warehouse', quantity: 3 },
    { branch_id: 3, branch_name: 'Empty Branch', quantity: 0 },
  ],
  image_gallery: ['img1.jpg'],
  batches: [
    { id: 10, lot_code: 'A', quantity: 4, branch_stock: [] },
  ],
}

const richSummary = summarizeDeleteImpact([richProduct])
assert.equal(richSummary.totalStockUnits, 8)
assert.equal(richSummary.branchesWithStock, 2, 'zero-quantity branch entry should not count')
assert.equal(richSummary.productsWithImages, 1)
assert.equal(richSummary.productsWithBatches, 1)

// A product whose only image comes from the legacy single image_path field
// (no image_gallery) should still count as having an image.
const legacyImageProduct = { id: 3, name: 'Legacy Image', image_path: 'legacy.jpg' }
assert.equal(summarizeDeleteImpact([legacyImageProduct]).productsWithImages, 1)

// Bulk case: two products, stock summed across both, branch counted once
// even though both products stock the same branch.
const bulkA = {
  id: 4,
  name: 'Bulk A',
  branch_stock: [{ branch_id: 1, quantity: 2 }],
}
const bulkB = {
  id: 5,
  name: 'Bulk B',
  branch_stock: [{ branch_id: 1, quantity: 7 }, { branch_id: 2, quantity: 1 }],
}
const bulkSummary = summarizeDeleteImpact([bulkA, bulkB])
assert.equal(bulkSummary.productCount, 2)
assert.deepEqual(bulkSummary.productNames, ['Bulk A', 'Bulk B'])
assert.equal(bulkSummary.totalStockUnits, 10)
assert.equal(bulkSummary.branchesWithStock, 2)

// Malformed/missing branch_stock and empty input handled without throwing.
assert.equal(summarizeDeleteImpact([{ id: 6, name: 'Bad', branch_stock: 'nope' }]).totalStockUnits, 0)
assert.deepEqual(summarizeDeleteImpact([]), {
  productCount: 0,
  productNames: [],
  totalStockUnits: 0,
  branchesWithStock: 0,
  productsWithImages: 0,
  productsWithBatches: 0,
})
assert.deepEqual(summarizeDeleteImpact(undefined as unknown as []), {
  productCount: 0,
  productNames: [],
  totalStockUnits: 0,
  branchesWithStock: 0,
  productsWithImages: 0,
  productsWithBatches: 0,
})

console.log('PASS deleteImpactSummary summarizes stock/images/batches for the delete confirm modal')
