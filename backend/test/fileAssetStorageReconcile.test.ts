'use strict'

const assert = require('node:assert/strict')
const {
  findUploadStorageOrphans,
  toUploadPublicPathFromObjectKey,
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

runTest('upload object keys normalize into public upload paths', () => {
  assert.equal(toUploadPublicPathFromObjectKey('uploads/demo.png'), '/uploads/demo.png')
  assert.equal(toUploadPublicPathFromObjectKey('/uploads/demo.png'), '/uploads/demo.png')
  assert.equal(toUploadPublicPathFromObjectKey('other/demo.png'), null)
})

runTest('storage reconcile only flags upload objects that are not tracked', () => {
  const orphanKeys = findUploadStorageOrphans(
    [
      'uploads/in-use.png',
      'uploads/orphan-a.png',
      '/uploads/orphan-b.png',
      'system/doctor/object-store-test.txt',
    ],
    [
      '/uploads/in-use.png',
      '/uploads/kept-in-library.png',
    ],
  )

  assert.deepEqual(orphanKeys, [
    'uploads/orphan-a.png',
    '/uploads/orphan-b.png',
  ])
})
