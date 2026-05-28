'use strict'

const assert = require('node:assert/strict')
const databaseModule = require('../src/database')
const {
  __resetFileUsageReferenceCaches,
  buildUploadReferenceUsageMap,
  collectUsagesByPublicPath,
} = require('../src/fileAssets')

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
