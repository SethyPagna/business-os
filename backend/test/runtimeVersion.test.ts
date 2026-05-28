'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readFrontendBuildInfoFromRoot } = require('../src/runtimeVersion')

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

if (failed > 0) {
  process.exitCode = 1
}
