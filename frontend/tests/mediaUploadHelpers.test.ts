import assert from 'node:assert/strict'
import { buildCacheBustedMediaPath, createInitialUploadState, reduceUploadState } from '../src/utils/mediaUpload.ts'
import { logicalAssetDisplayName, logicalAssetDownloadPath, logicalAssetKey } from '../src/components/files/libraryLogicalRows.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('cache busted media path appends upload version without duplicating query separators', () => {
  assert.equal(buildCacheBustedMediaPath('/uploads/logo.png', 'abc'), '/uploads/logo.png?v=abc')
  assert.equal(buildCacheBustedMediaPath('/uploads/logo.png?old=1', 'abc'), '/uploads/logo.png?old=1&v=abc')
})

await runTest('upload reducer tracks per-field progress and cancellation', () => {
  const initial = { logo: createInitialUploadState() }
  const started = reduceUploadState(initial, { type: 'start', key: 'logo', previewUrl: 'blob:logo' })
  const progressed = reduceUploadState(started, { type: 'progress', key: 'logo', progress: 55 })
  const cancelled = reduceUploadState(progressed, { type: 'cancel', key: 'logo' })

  assert.equal(progressed.logo?.status, 'uploading')
  assert.equal(progressed.logo?.progress, 55)
  assert.equal(cancelled.logo?.status, 'cancelled')
})

await runTest('logical Library rows select and download one shared object under each product name', () => {
  const shared = { id: 7, logical_id: '7:product:22', logical_name: 'Soft Rose_1.webp', original_name: 'upload.webp', referenceProduct: { id: 22, name: 'Soft Rose' } }
  assert.equal(logicalAssetKey(shared), '7:product:22')
  assert.equal(logicalAssetDisplayName(shared), 'Soft Rose_1.webp')
  assert.equal(logicalAssetDownloadPath(shared), '/api/files/7/download?name=Soft%20Rose_1.webp')

  const physical = { id: 7, original_name: 'upload.webp' }
  assert.equal(logicalAssetKey(physical), '7:asset')
  assert.equal(logicalAssetDisplayName(physical), 'upload.webp')
})

if (failed > 0) {
  process.exitCode = 1
}
