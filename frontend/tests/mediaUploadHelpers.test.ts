import assert from 'node:assert/strict'
import { buildCacheBustedMediaPath, createInitialUploadState, reduceUploadState } from '../src/utils/mediaUpload.ts'

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

if (failed > 0) {
  process.exitCode = 1
}
