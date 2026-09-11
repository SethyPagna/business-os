import assert from 'node:assert/strict'
import {
  mergeSaleProductSearchCandidates,
  normalizeSaleProductSearchPage,
  saleProductSearchHasMore,
} from '../src/components/sales/saleProductSearch.ts'

const first = normalizeSaleProductSearchPage<{ id: number }>({
  items: [{ id: 1 }, { id: 2 }],
  page: 1,
  pageSize: 2,
  total: 5,
  totalPages: 3,
}, 1, 2)
assert.deepEqual(first, {
  items: [{ id: 1 }, { id: 2 }],
  page: 1,
  pageSize: 2,
  total: 5,
  totalPages: 3,
})
assert.equal(saleProductSearchHasMore(first), true)

assert.deepEqual(
  mergeSaleProductSearchCandidates([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]),
  [{ id: 1 }, { id: 2 }, { id: 3 }],
  'expanded siblings repeated across family pages are de-duplicated by product id',
)

const offline = normalizeSaleProductSearchPage<{ id: number }>([{ id: 7 }, { id: 8 }], 4)
assert.equal(offline.page, 1)
assert.equal(offline.total, 2)
assert.equal(offline.totalPages, 1)
assert.equal(saleProductSearchHasMore(offline), false)

const malformed = normalizeSaleProductSearchPage({ items: 'bad', page: -3, pageSize: 0, total: -1, totalPages: 0 }, 2)
assert.deepEqual(malformed.items, [])
assert.equal(malformed.page, 1)
assert.equal(malformed.pageSize, 8)
assert.equal(malformed.total, 0)
assert.equal(malformed.totalPages, 1)

console.log('PASS sale detail product search pagination')
