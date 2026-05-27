import assert from 'node:assert/strict'
import {
  buildJumpTargetIdsByLetter,
  buildParentProductIdSet,
  buildProductIdMap,
  buildProductPaginationState,
  buildSelectedProducts,
  buildSelectedVisibleIds,
  buildVisibleProductIds,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  normalizePositiveProductIds,
} from '../src/components/products/helpers/productSelectionHelpers.mjs'

const products = [
  { id: 1, name: 'A' },
  { id: '2', name: 'B' },
  { id: null, name: 'No id' },
  { id: 'bad', name: 'Bad id' },
]

assert.deepEqual(buildVisibleProductIds(products), [1, 2, 0])
assert.deepEqual(normalizePositiveProductIds([1, '2', 0, null, 'bad', -1, 3.5]), [1, 2, 3.5])
assert.deepEqual(
  normalizePositiveProductIds([{ restoredId: '8' }, { restoredId: 0 }, { restoredId: 'bad' }, { restoredId: 9 }], (entry) => entry.restoredId),
  [8, 9],
)
assert.deepEqual(buildSelectedVisibleIds(new Set([1, 2, 3]), [2, 4]), [2])
assert.deepEqual(buildSelectedProducts(products, new Set([2])).map((product) => product.name), ['B'])

const productIdMap = buildProductIdMap(products)
assert.equal(productIdMap.get(1).name, 'A')
assert.equal(productIdMap.get(2).name, 'B')
assert.equal(productIdMap.has(0), false, 'product id map ignores missing ids')
assert.deepEqual([...buildParentProductIdSet([
  { id: 1, parent_id: null },
  { id: 2, parent_id: '1' },
  { id: 3, parent_id: 1 },
  { id: 4, parent_id: 'bad' },
])], [1], 'parent product id set keeps unique valid parent ids')

assert.deepEqual(
  buildProductPaginationState({ page: 3, total: 125, pageSize: 50, fallbackPageSize: 20 }),
  {
    safePage: 3,
    safePageSize: 50,
    totalPages: 3,
    start: 101,
    end: 125,
    summaryLabel: '101-125 / 125',
  },
)
assert.equal(buildProductPaginationState({ page: 99, total: 0, pageSize: 0 }).summaryLabel, '0 / 0')
assert.equal(buildProductPaginationState({ page: 99, total: 10, pageSize: 20 }).safePage, 1)

const jumpTargets = buildJumpTargetIdsByLetter([
  { id: 'a', label: 'A', groups: [{ anchorId: 10 }] },
  { id: 'b', label: 'B', groups: [{ leadProduct: { id: 20 } }] },
  { id: 'c', label: 'C', groups: [{ items: [{ id: 30 }] }] },
  { id: 'd', label: 'D', groups: [] },
], new Set(['b']))
assert.equal(jumpTargets.get('A'), 10)
assert.equal(jumpTargets.has('B'), false)
assert.equal(jumpTargets.get('C'), 30)
assert.equal(jumpTargets.has('D'), false)

assert.equal(isSelectionScopeFullySelected([1, 2], new Set([1, 2, 3])), true)
assert.equal(isSelectionScopeFullySelected([], new Set([1])), false)
assert.equal(isSelectionScopePartiallySelected([1, 2], new Set([1])), true)
assert.equal(isSelectionScopePartiallySelected([1, 2], new Set([1, 2])), false)

console.log('productSelectionHelpers tests passed')
