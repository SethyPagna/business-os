import assert from 'node:assert/strict'
import { buildBatchPreview, getVisibleProductBatches } from '../src/utils/productBatches.ts'

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

// The list-badge fallback: when the full `batches` array is not loaded (the
// list reads ship a scalar `batch_count` instead), the preview reports that
// count so the badge shows "N batches" instead of the 0 an empty array gave.
{
  const listRow = { batch_count: 5 } // no `batches` array, as a list row has
  const listPreview = buildBatchPreview(listRow, 'all', { limit: 3 })
  assert.equal(listPreview.totalCount, 5, 'batch_count is used when the batches array is absent -- this is the "Inventory shows 0" fix')
  assert.equal(listPreview.items.length, 0, 'no full rows are invented from a scalar count')
  assert.equal(listPreview.extraCount, 2, 'extraCount reflects the scalar total past the limit')
}
{
  // A real loaded array always wins over the scalar -- the scalar never
  // overrides per-branch detail the detail view fetched.
  const detailRow = { batch_count: 99, batches: [{ id: 1, quantity: 4, branch_stock: [{ branch_id: 1, quantity: 4 }] }] }
  assert.equal(buildBatchPreview(detailRow, 'all').totalCount, 1, 'a loaded batches array wins over the scalar batch_count')
}

console.log('PASS product batch helpers filter branch stock and preview limits')
