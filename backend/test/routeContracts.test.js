'use strict'

const assert = require('node:assert/strict')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function getRoutePaths(router) {
  return (router.stack || [])
    .map((layer) => layer?.route?.path)
    .filter(Boolean)
}

runTest('product router registers required paged search routes', () => {
  const router = require('../src/routes/products')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/search'), 'missing /api/products/search')
  assert.ok(paths.includes('/filters'), 'missing /api/products/filters')
  assert.ok(paths.indexOf('/search') < paths.indexOf('/'), '/search must be registered before root route')
})

runTest('inventory router registers required paged product search route', () => {
  const router = require('../src/routes/inventory')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/products/search'), 'missing /api/inventory/products/search')
})

runTest('portal router registers required public catalog search route', () => {
  const router = require('../src/routes/portal')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/catalog/products/search'), 'missing /api/portal/catalog/products/search')
  assert.ok(paths.indexOf('/catalog/products/search') > paths.indexOf('/catalog/products'), 'public search route should be explicit and registered')
})

runTest('auth router registers Google OAuth start and completion routes', () => {
  const router = require('../src/routes/auth')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/oauth/start'), 'missing /api/auth/oauth/start')
  assert.ok(paths.includes('/oauth/complete'), 'missing /api/auth/oauth/complete')
})

runTest('system router registers Google Drive sync connect and disconnect routes', () => {
  const router = require('../src/routes/system')
  const paths = getRoutePaths(router)
  assert.ok(paths.includes('/drive-sync/status'), 'missing /api/system/drive-sync/status')
  assert.ok(paths.includes('/drive-sync/oauth/start'), 'missing /api/system/drive-sync/oauth/start')
  assert.ok(paths.includes('/drive-sync/oauth/callback'), 'missing /api/system/drive-sync/oauth/callback')
  assert.ok(paths.includes('/drive-sync/disconnect'), 'missing /api/system/drive-sync/disconnect')
  assert.ok(paths.includes('/drive-sync/forget-credentials'), 'missing /api/system/drive-sync/forget-credentials')
  assert.ok(paths.includes('/drive-sync/sync-now'), 'missing /api/system/drive-sync/sync-now')
})

if (failed > 0) {
  process.exitCode = 1
}
