'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

runTest('inventory transfer route has idempotency lookup before stock mutation', () => {
  const source = readSource('src/routes/inventory.js')
  assert.match(source, /normalizeClientRequestId/, 'transfer must normalize client_request_id')
  assert.match(source, /findTransferByClientRequestId/, 'transfer must be able to return a previous transfer')
  assert.match(source, /idempotent:\s*true/, 'repeat transfer requests must be reported as idempotent')
  assert.match(source, /client_request_id/, 'stock_transfers must store client_request_id')
})

runTest('settings conflicts return settings-specific structured payload with current snapshot', () => {
  const settingsSource = readSource('src/routes/settings.js')
  const conflictSource = readSource('src/conflictControl.js')
  assert.match(settingsSource, /settings_conflict/, 'settings route must emit settings_conflict')
  assert.match(settingsSource, /currentSettings/, 'settings conflict must include current server settings')
  assert.match(settingsSource, /attempted/, 'settings conflict must include attempted local changes')
  assert.match(conflictSource, /settings_conflict/, 'shared conflict helper must understand settings_conflict')
})

runTest('file upload route compresses images immediately and only defers video optimization', () => {
  const routeSource = readSource('src/routes/files.js')
  const assetSource = readSource('src/fileAssets.js')
  assert.match(routeSource, /validateUploadedFile,\s*compressUpload/, 'upload route must run synchronous image compression middleware')
  assert.match(routeSource, /enqueueMediaOptimization/, 'upload route must enqueue optimization')
  assert.match(routeSource, /processing_status/, 'upload response must expose processing status')
  assert.match(routeSource, /cache_version/, 'upload response must expose cache busting version')
  assert.match(assetSource, /deferOptimization/, 'asset registration must support deferred optimization')
  assert.match(routeSource, /const shouldDeferOptimization = mediaType === 'video'/, 'video uploads alone should stay deferred')
})

runTest('movement route keeps pagination metadata and safe created_at fallback', () => {
  const source = readSource('src/routes/inventory.js')
  assert.match(source, /pageSize/, 'movement route must accept pageSize')
  assert.match(source, /totalPages/, 'movement route must return totalPages')
  assert.match(source, /COALESCE\(NULLIF\(im\.created_at::text,\s*''\)/, 'movement rows must fallback created_at safely')
})

if (failed > 0) {
  process.exitCode = 1
}
