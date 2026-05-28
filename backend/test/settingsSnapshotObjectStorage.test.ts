'use strict'

const assert = require('node:assert/strict')

let failed = 0

function runTest(name, fn) {
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
      if (failed > 0) process.exitCode = 1
    })
}

function withObjectStoreStub(stubbedExports, callback) {
  const objectStorePath = require.resolve('../src/objectStore')
  const settingsSnapshotPath = require.resolve('../src/settingsSnapshot')
  const uploadCleanupPath = require.resolve('../src/uploadReferenceCleanup')
  const objectStore = require(objectStorePath)
  const originals = {}

  Object.entries(stubbedExports).forEach(([key, value]) => {
    originals[key] = objectStore[key]
    objectStore[key] = value
  })

  delete require.cache[settingsSnapshotPath]
  delete require.cache[uploadCleanupPath]

  const restore = () => {
    Object.entries(originals).forEach(([key, value]) => {
      objectStore[key] = value
    })
    delete require.cache[settingsSnapshotPath]
    delete require.cache[uploadCleanupPath]
  }

  return Promise.resolve()
    .then(callback)
    .finally(restore)
}

function createFakeCleanupDb() {
  const state = {
    settings: [
      { key: 'customer_portal_logo_image', value: '/uploads/missing.png' },
      { key: 'ui_app_favicon_image', value: '/uploads/keep.png' },
    ],
    productImages: [],
    products: [],
    users: [],
    fileAssets: [
      { id: 1, public_path: '/uploads/missing.png' },
      { id: 2, public_path: '/uploads/keep.png' },
    ],
    submissions: [],
  }

  return {
    state,
    prepare(sql) {
      const query = String(sql || '').replace(/\s+/g, ' ').trim()
      if (query === 'SELECT key, value FROM settings') {
        return { all: () => state.settings.map((row) => ({ ...row })) }
      }
      if (query.startsWith('UPDATE settings SET value = ?')) {
        return {
          run: (value, key) => {
            const row = state.settings.find((entry) => entry.key === key)
            if (row) row.value = value
          },
        }
      }
      if (query === 'SELECT id, image_path FROM product_images') {
        return { all: () => [] }
      }
      if (query.startsWith('DELETE FROM product_images WHERE id = ?')) {
        return { run: () => {} }
      }
      if (query.startsWith('UPDATE product_images SET image_path = ? WHERE id = ?')) {
        return { run: () => {} }
      }
      if (query.startsWith('SELECT image_path FROM product_images WHERE product_id = ?')) {
        return { get: () => undefined }
      }
      if (query === 'SELECT id, image_path FROM products') {
        return { all: () => [] }
      }
      if (query.startsWith('UPDATE products SET image_path = ?')) {
        return { run: () => {} }
      }
      if (query.startsWith('SELECT id, avatar_path FROM users WHERE avatar_path IS NOT NULL')) {
        return { all: () => [] }
      }
      if (query.startsWith('UPDATE users SET avatar_path = ?')) {
        return { run: () => {} }
      }
      if (query === 'SELECT id, public_path FROM file_assets') {
        return { all: () => state.fileAssets.map((row) => ({ ...row })) }
      }
      if (query.startsWith('DELETE FROM file_assets WHERE id = ?')) {
        return {
          run: (id) => {
            state.fileAssets = state.fileAssets.filter((row) => row.id !== id)
          },
        }
      }
      if (query.startsWith('UPDATE file_assets SET public_path = ?')) {
        return {
          run: (publicPath, id) => {
            const row = state.fileAssets.find((entry) => entry.id === id)
            if (row) row.public_path = publicPath
          },
        }
      }
      if (query.startsWith('SELECT id, screenshots_json FROM customer_share_submissions WHERE screenshots_json IS NOT NULL')) {
        return { all: () => [] }
      }
      if (query.startsWith('UPDATE customer_share_submissions SET screenshots_json = ?')) {
        return { run: () => {} }
      }
      throw new Error(`Unhandled fake DB query: ${query}`)
    },
  }
}

runTest('async settings snapshot drops missing object-storage upload paths', async () => {
  await withObjectStoreStub({
    isObjectStorageEnabled: () => true,
    objectExists: async (key) => key === 'uploads/keep.png',
  }, async () => {
    const { sanitizeSettingsSnapshotAsync } = require('../src/settingsSnapshot')
    const snapshot = await sanitizeSettingsSnapshotAsync({
      business_name: 'Leang Cosmetics',
      customer_portal_logo_image: '/uploads/missing.png',
      ui_app_favicon_image: '/uploads/keep.png?cache=1',
    })

    assert.equal(snapshot.business_name, 'Leang Cosmetics')
    assert.equal(snapshot.customer_portal_logo_image, '')
    assert.equal(snapshot.ui_app_favicon_image, '/uploads/keep.png')
  })
})

runTest('async upload reference repair clears missing object-storage settings and assets', async () => {
  await withObjectStoreStub({
    isObjectStorageEnabled: () => true,
    objectExists: async (key) => key === 'uploads/keep.png',
  }, async () => {
    const db = createFakeCleanupDb()
    const { repairMissingUploadReferencesAsync } = require('../src/uploadReferenceCleanup')
    const summary = await repairMissingUploadReferencesAsync(db)

    assert.equal(summary.settings, 1)
    assert.equal(summary.fileAssets, 1)
    assert.deepEqual(db.state.settings, [
      { key: 'customer_portal_logo_image', value: '' },
      { key: 'ui_app_favicon_image', value: '/uploads/keep.png' },
    ])
    assert.deepEqual(db.state.fileAssets, [
      { id: 2, public_path: '/uploads/keep.png' },
    ])
  })
})
