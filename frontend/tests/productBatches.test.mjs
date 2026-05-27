import assert from 'node:assert/strict'
import { buildBatchPreview, getVisibleProductBatches } from '../src/utils/productBatches.mjs'

const product = {
  batches: [
    {
      id: 1,
      lot_code: 'A',
      quantity: 10,
      branch_stock: [
        { branch_id: 1, quantity: 4 },
        { branch_id: 2, quantity: 0 },
      ],
    },
    {
      id: 2,
      lot_code: 'B',
      quantity: 0,
      branch_stock: [
        { branch_id: 1, quantity: 3 },
        { branch_id: 2, quantity: 5 },
      ],
    },
    {
      id: 3,
      lot_code: 'C',
      quantity: 2,
      branch_stock: [],
    },
  ],
}

assert.deepEqual(getVisibleProductBatches(product).map((batch) => [batch.id, batch.quantity]), [
  [1, 10],
  [3, 2],
])

assert.deepEqual(getVisibleProductBatches(product, '1').map((batch) => [batch.id, batch.quantity]), [
  [1, 4],
  [2, 3],
])

assert.deepEqual(getVisibleProductBatches(product, 2).map((batch) => [batch.id, batch.quantity]), [
  [2, 5],
])

assert.deepEqual(getVisibleProductBatches({ batches: 'bad' }), [])

const preview = buildBatchPreview(product, 'all', { limit: 1 })
assert.equal(preview.items.length, 1)
assert.equal(preview.extraCount, 1)
assert.equal(preview.totalCount, 2)

console.log('PASS product batch helpers filter branch stock and preview limits')
