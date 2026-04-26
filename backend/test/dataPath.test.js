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

runTest('summarizeDataRoot reports database and uploads', () => {
  const root = makeTempRoot('bos-data-path-')
  ensureDataRootLayout(root)
  const dbPath = path.join(root, 'db', 'business.db')
  const uploadPath = path.join(root, 'uploads', 'demo.png')
  fs.writeFileSync(dbPath, 'database')
  fs.writeFileSync(uploadPath, 'image-data')

  const summary = summarizeDataRoot(root)

  assert.equal(summary.dbExists, true)
  assert.equal(summary.uploadCount, 1)
  assert.equal(summary.totalFileCount >= 2, true)
  assert.equal(summary.hasData, true)
})

runTest('relocateDataRoot copies files into an empty target', () => {
  const source = makeTempRoot('bos-data-source-')
  const target = makeTempRoot('bos-data-target-')
  ensureDataRootLayout(source)
  fs.writeFileSync(path.join(source, 'db', 'business.db'), 'source-db')
  fs.writeFileSync(path.join(source, 'uploads', 'logo.png'), 'logo-data')

  const result = relocateDataRoot({ sourceRoot: source, targetRoot: path.join(target, 'business-os-data') })

  assert.equal(result.skipped, false)
  assert.equal(result.copyStats.copiedFileCount >= 2, true)
  assert.equal(fs.existsSync(path.join(target, 'business-os-data', 'db', 'business.db')), true)
  assert.equal(fs.existsSync(path.join(target, 'business-os-data', 'uploads', 'logo.png')), true)
})

runTest('relocateDataRoot archives non-empty targets and rejects nested paths', () => {
  const source = makeTempRoot('bos-data-source-')
  const target = makeTempRoot('bos-data-target-')
  ensureDataRootLayout(source)
  ensureDataRootLayout(target)
  fs.writeFileSync(path.join(source, 'db', 'business.db'), 'source-db')
  fs.writeFileSync(path.join(target, 'db', 'business.db'), 'target-db')

  const result = relocateDataRoot({ sourceRoot: source, targetRoot: target })
  assert.equal(result.skipped, false)
  assert.equal(typeof result.archivedTargetPath, 'string')
  assert.equal(fs.existsSync(result.archivedTargetPath), true)
  assert.equal(fs.existsSync(path.join(result.archivedTargetPath, 'db', 'business.db')), true)
  assert.equal(fs.readFileSync(path.join(target, 'db', 'business.db'), 'utf8'), 'source-db')

  const nestedTarget = path.join(source, 'nested', 'business-os-data')
  assert.throws(
    () => relocateDataRoot({ sourceRoot: source, targetRoot: nestedTarget }),
    /outside the current Business OS data path/i,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
