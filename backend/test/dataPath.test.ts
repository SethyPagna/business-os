'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  ensureDataRootLayout,
  relocateDataRoot,
  summarizeDataRoot,
} = require('../src/dataPath')

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

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

runTest('summarizeDataRoot reports runtime artifacts and uploads', () => {
  const root = makeTempRoot('bos-data-path-')
  ensureDataRootLayout(root)
  const uploadPath = path.join(root, 'uploads', 'demo.png')
  const backupPath = path.join(root, 'backups', 'manifest.json')
  fs.writeFileSync(uploadPath, 'image-data')
  fs.writeFileSync(backupPath, '{"format":"business-os-backup-v2"}')

  const summary = summarizeDataRoot(root)

  assert.equal(summary.uploadCount, 1)
  assert.equal(summary.backupCount, 1)
  assert.equal(summary.totalFileCount >= 2, true)
  assert.equal(summary.hasData, true)
})

runTest('relocateDataRoot copies files into an empty target', () => {
  const source = makeTempRoot('bos-data-source-')
  const target = makeTempRoot('bos-data-target-')
  ensureDataRootLayout(source)
  fs.writeFileSync(path.join(source, 'uploads', 'logo.png'), 'logo-data')
  fs.writeFileSync(path.join(source, 'backups', 'manifest.json'), '{"format":"business-os-backup-v2"}')

  const result = relocateDataRoot({ sourceRoot: source, targetRoot: path.join(target, 'business-os-data') })

  assert.equal(result.skipped, false)
  assert.equal(result.copyStats.copiedFileCount >= 2, true)
  assert.equal(fs.existsSync(path.join(target, 'business-os-data', 'uploads', 'logo.png')), true)
  assert.equal(fs.existsSync(path.join(target, 'business-os-data', 'backups', 'manifest.json')), true)
})

runTest('relocateDataRoot archives non-empty targets and rejects nested paths', () => {
  const source = makeTempRoot('bos-data-source-')
  const target = makeTempRoot('bos-data-target-')
  ensureDataRootLayout(source)
  ensureDataRootLayout(target)
  fs.writeFileSync(path.join(source, 'uploads', 'source.txt'), 'source-data')
  fs.writeFileSync(path.join(target, 'uploads', 'target.txt'), 'target-data')

  const result = relocateDataRoot({ sourceRoot: source, targetRoot: target })
  assert.equal(result.skipped, false)
  assert.equal(typeof result.archivedTargetPath, 'string')
  assert.equal(fs.existsSync(result.archivedTargetPath), true)
  assert.equal(fs.existsSync(path.join(result.archivedTargetPath, 'uploads', 'target.txt')), true)
  assert.equal(fs.readFileSync(path.join(target, 'uploads', 'source.txt'), 'utf8'), 'source-data')

  const nestedTarget = path.join(source, 'nested', 'business-os-data')
  assert.throws(
    () => relocateDataRoot({ sourceRoot: source, targetRoot: nestedTarget }),
    /outside the current Business OS data path/i,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
