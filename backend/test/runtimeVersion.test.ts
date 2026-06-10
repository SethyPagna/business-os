'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readFrontendBuildInfoFromRoot } = require('../src/runtimeVersion.ts')

let failed = 0
const runtimeStateSource = fs.readFileSync(path.join(__dirname, '..', 'src/runtimeState/index.ts'), 'utf8')

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

runTest('runtime version reads served frontend build metadata from source dist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-runtime-version-'))
  const dist = path.join(root, 'frontend', 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(path.join(dist, 'business-os-build.json'), JSON.stringify({
    revision: 'front-rev',
    hash: 'front-hash',
    builtAt: '2026-05-02T00:00:00.000Z',
  }))

  assert.deepEqual(readFrontendBuildInfoFromRoot(root), {
    revision: 'front-rev',
    hash: 'front-hash',
    builtAt: '2026-05-02T00:00:00.000Z',
  })
})

runTest('runtime version returns empty frontend metadata when dist manifest is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-runtime-version-empty-'))
  assert.deepEqual(readFrontendBuildInfoFromRoot(root), {
    revision: '',
    hash: '',
    builtAt: '',
  })
})

runTest('runtime descriptor memoizes runtime-state reads for bootstrap bursts', () => {
  assert.match(runtimeStateSource, /const RUNTIME_STATE_MEMO_MS = Math\.max\(1000/)
  assert.match(runtimeStateSource, /let runtimeStateMemo = \{ state: null, expiresAt: 0 \}/)
  assert.match(runtimeStateSource, /function cloneRuntimeState\(state\)/)
  assert.match(runtimeStateSource, /runtimeStateMemo\.state && runtimeStateMemo\.expiresAt > now/)
  assert.match(runtimeStateSource, /const DATA_ROOT_KEY = crypto\.createHash\('sha256'\)\.update\(DATA_ROOT\)/)
  assert.match(runtimeStateSource, /dataRootKey: DATA_ROOT_KEY/)
})

if (failed > 0) {
  process.exitCode = 1
}
