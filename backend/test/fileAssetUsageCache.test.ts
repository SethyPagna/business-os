'use strict'

const assert = require('node:assert/strict')
const databaseModule = require('../src/database.ts')
const {
  __resetFileUsageReferenceCaches,
  buildUploadReferenceUsageMap,
  collectUsagesByPublicPath,
  listFileAssets,
} = require('../src/fileAssets.ts')

let failed = 0
const pendingTests = new Set()

function runTest(name, fn) {
  pendingTests.add(name)
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    })
    .finally(() => {
      pendingTests.delete(name)
      if (pendingTests.size === 0 && failed > 0) {
        process.exitCode = 1
      }
    })
}

runTest('buildUploadReferenceUsageMap indexes repeated upload paths by source row', () => {
  const usageMap = buildUploadReferenceUsageMap(
    [
      { key: 'catalog.logo', value: '{"logo":"/uploads/a.png"}' },
      { key: 'portal.hero', value: '{"gallery":["/uploads/a.png","/uploads/b.png"]}' },
    ],
    {
      valueSelector: (row) => row.value,
      buildUsage: (row) => ({ type: 'settings', label: row.key }),
    },
  )

  assert.deepEqual(usageMap.get('/uploads/a.png'), [
    { type: 'settings', label: 'catalog.logo' },
    { type: 'settings', label: 'portal.hero' },
  ])
  assert.deepEqual(usageMap.get('/uploads/b.png'), [
    { type: 'settings', label: 'portal.hero' },
  ])
})

runTest('collectUsagesByPublicPath reuses cached settings and submission references for list views', () => {
  const originalDb = databaseModule.db
  const queryCounts = {
    settings: 0,
    submissions: 0,
    products: 0,
    productImages: 0,
    users: 0,
  }

  databaseModule.db = {
    prepare(sql) {
      const normalizedSql = String(sql || '')
      return {
        all(...args) {
          if (normalizedSql.includes('FROM settings')) {
            queryCounts.settings += 1
            return [{ key: 'catalog.logo', value: '{"logo":"/uploads/a.png"}' }]
          }
          if (normalizedSql.includes('FROM customer_share_submissions')) {
            queryCounts.submissions += 1
            return [{ id: 7, screenshots_json: '["/uploads/a.png"]' }]
          }
          if (normalizedSql.includes('FROM product_images pi')) {
            queryCounts.productImages += 1
            return []
          }
          if (normalizedSql.includes('FROM users')) {
            queryCounts.users += 1
            return []
          }
          if (normalizedSql.includes('FROM products')) {
            queryCounts.products += 1
            return []
          }
          throw new Error(`Unexpected SQL in test double: ${normalizedSql}`)
        },
      }
    },
  }

  try {
    __resetFileUsageReferenceCaches()
    const first = collectUsagesByPublicPath(['/uploads/a.png'], { useCache: true })
    const second = collectUsagesByPublicPath(['/uploads/a.png'], { useCache: true })

    assert.equal(queryCounts.settings, 1)
    assert.equal(queryCounts.submissions, 1)
    assert.deepEqual(first.get('/uploads/a.png'), [
      { type: 'settings', label: 'catalog.logo' },
      { type: 'submission', label: 'Submission #7' },
    ])
    assert.deepEqual(second.get('/uploads/a.png'), [
      { type: 'settings', label: 'catalog.logo' },
      { type: 'submission', label: 'Submission #7' },
    ])

    collectUsagesByPublicPath(['/uploads/a.png'], { useCache: false })
    assert.equal(queryCounts.settings, 2)
    assert.equal(queryCounts.submissions, 2)
  } finally {
    databaseModule.db = originalDb
    __resetFileUsageReferenceCaches()
  }
})

runTest('listFileAssets reuses short-lived page payload cache for repeated list views', async () => {
  const originalDb = databaseModule.db
  const queryCounts = {
    assets: 0,
    settings: 0,
    submissions: 0,
    products: 0,
    productImages: 0,
    users: 0,
  }

  databaseModule.db = {
    prepare(sql) {
      const normalizedSql = String(sql || '')
      return {
        all() {
          if (normalizedSql.includes('COUNT(*) OVER()') && normalizedSql.includes('FROM file_assets')) {
            queryCounts.assets += 1
            return [{
              id: 1,
              original_name: 'a.png',
              stored_name: 'a.png',
              public_path: '/uploads/a.png',
              mime_type: 'image/png',
              media_type: 'image',
              byte_size: 100,
              total_count: 1,
            }]
          }
          if (normalizedSql.includes('FROM settings')) {
            queryCounts.settings += 1
            return []
          }
          if (normalizedSql.includes('FROM customer_share_submissions')) {
            queryCounts.submissions += 1
            return []
          }
          if (normalizedSql.includes('FROM product_images pi')) {
            queryCounts.productImages += 1
            return []
          }
          if (normalizedSql.includes('FROM users')) {
            queryCounts.users += 1
            return []
          }
          if (normalizedSql.includes('FROM products')) {
            queryCounts.products += 1
            return [{ id: 9, name: 'Product A', image_path: '/uploads/a.png' }]
          }
          throw new Error(`Unexpected SQL in test double: ${normalizedSql}`)
        },
        get() {
          throw new Error(`Unexpected get SQL in test double: ${normalizedSql}`)
        },
        run() {
          return { changes: 0 }
        },
      }
    },
  }

  try {
    __resetFileUsageReferenceCaches()
    const first = await listFileAssets({ mediaType: 'all', page: 1, pageSize: 24, offset: 0 })
    const second = await listFileAssets({ mediaType: 'all', page: 1, pageSize: 24, offset: 0 })

    assert.equal(queryCounts.assets, 1)
    assert.equal(queryCounts.products, 1)
    assert.equal(first.total, 1)
    assert.equal(second.total, 1)
    assert.deepEqual(first.items[0].usages, [{ type: 'product', label: 'Product A' }])
    second.items[0].usages.push({ type: 'mutated', label: 'Should not leak' })
    const third = await listFileAssets({ mediaType: 'all', page: 1, pageSize: 24, offset: 0 })
    assert.deepEqual(third.items[0].usages, [{ type: 'product', label: 'Product A' }])
  } finally {
    databaseModule.db = originalDb
    __resetFileUsageReferenceCaches()
  }
})
