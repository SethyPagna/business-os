'use strict'

const assert = require('assert')

const returnsRoute = require('../src/routes/returns.ts')

const {
  RETURNS_LIST_CACHE_TTL_MS,
  buildReturnsListCacheKey,
  invalidateReturnsListCache,
  readCachedReturnsList,
  returnsListCache,
  setCachedReturnsList,
} = returnsRoute._test

function runTest(name, fn) {
  try {
    invalidateReturnsListCache()
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  } finally {
    invalidateReturnsListCache()
  }
}

runTest('returns list cache key separates filters that change row content', () => {
  const baseKey = buildReturnsListCacheKey({ scope: 'customer', limit: 50 })
  const supplierKey = buildReturnsListCacheKey({ scope: 'supplier', limit: 50 })
  const searchKey = buildReturnsListCacheKey({ scope: 'customer', search: 'mask', limit: 50 })
  const includeItemsKey = buildReturnsListCacheKey({ scope: 'customer', includeItems: true, limit: 50 })

  assert.notEqual(baseKey, supplierKey)
  assert.notEqual(baseKey, searchKey)
  assert.notEqual(baseKey, includeItemsKey)
})

runTest('returns list cache returns cloned rows and nested item arrays', () => {
  const key = buildReturnsListCacheKey({ scope: 'customer', limit: 50 })
  const rows = [{
    id: 1,
    return_number: 'RET-1',
    items: [{ id: 10, product_name: 'Mask' }],
  }]

  setCachedReturnsList(key, rows, 1000)
  const first = readCachedReturnsList(key, 1100)
  first[0].return_number = 'mutated'
  first[0].items[0].product_name = 'Changed'

  const second = readCachedReturnsList(key, 1200)
  assert.equal(second[0].return_number, 'RET-1')
  assert.equal(second[0].items[0].product_name, 'Mask')
})

runTest('returns list cache expires stale entries and can be invalidated', () => {
  const key = buildReturnsListCacheKey({ scope: 'customer', limit: 50 })
  setCachedReturnsList(key, [{ id: 1 }], 2000)

  assert.equal(readCachedReturnsList(key, 2000 + RETURNS_LIST_CACHE_TTL_MS - 1).length, 1)
  assert.equal(readCachedReturnsList(key, 2000 + RETURNS_LIST_CACHE_TTL_MS + 1), null)
  assert.equal(returnsListCache.has(key), false)

  setCachedReturnsList(key, [{ id: 2 }], 5000)
  assert.equal(returnsListCache.has(key), true)
  invalidateReturnsListCache()
  assert.equal(returnsListCache.size, 0)
})

if (process.exitCode) process.exit(process.exitCode)
