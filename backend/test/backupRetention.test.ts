'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  planBackupPackageRetention,
  pruneLocalBackupVersions,
} = require('../src/services/backupPackages.ts')

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('backup retention planner keeps newest packages by mtime then package id', () => {
  const plan = planBackupPackageRetention([
    { packageId: 'datasync-old', mtimeMs: 100 },
    { packageId: 'datasync-new-b', mtimeMs: 300 },
    { packageId: 'datasync-new-a', mtimeMs: 300 },
    { packageId: 'datasync-mid', mtimeMs: 200 },
  ], { keepLatest: 2 })

  assert.deepEqual(plan.keep.map((entry) => entry.packageId), ['datasync-new-b', 'datasync-new-a'])
  assert.deepEqual(plan.remove.map((entry) => entry.packageId), ['datasync-mid', 'datasync-old'])
})

runTest('local backup pruning deletes only old datasync folders', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-backup-retention-'))
  try {
    const names = ['datasync-1', 'datasync-2', 'datasync-3', 'not-a-backup']
    names.forEach((name, index) => {
      const folder = path.join(tempRoot, name)
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'manifest.json'), `${name}\n`, 'utf8')
      const mtime = new Date(Date.UTC(2026, 4, 10, 0, index, 0))
      fs.utimesSync(folder, mtime, mtime)
    })

    const result = await pruneLocalBackupVersions({ rootDir: tempRoot, keepLatest: 1 })
    assert.deepEqual(result.kept, ['datasync-3'])
    assert.deepEqual(result.removed.map((entry) => entry.packageId), ['datasync-2', 'datasync-1'])
    assert.equal(fs.existsSync(path.join(tempRoot, 'datasync-3')), true)
    assert.equal(fs.existsSync(path.join(tempRoot, 'datasync-2')), false)
    assert.equal(fs.existsSync(path.join(tempRoot, 'datasync-1')), false)
    assert.equal(fs.existsSync(path.join(tempRoot, 'not-a-backup')), true)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

runTest('docker release backup pruning keeps newest timestamped packages', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-docker-release-retention-'))
  const backupRoot = path.join(tempRoot, 'ops', 'runtime', 'docker-release', 'backups')
  try {
    fs.mkdirSync(backupRoot, { recursive: true })
    const names = ['20260509-010101', '20260509010202', '20260509-010303', 'datasync-keep-too', 'not-a-backup']
    names.forEach((name, index) => {
      const folder = path.join(backupRoot, name)
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'manifest.json'), `${name}\n`, 'utf8')
      const mtime = new Date(Date.UTC(2026, 4, 10, 1, index, 0))
      fs.utimesSync(folder, mtime, mtime)
    })

    const result = await pruneLocalBackupVersions({ rootDir: backupRoot, keepLatest: 2 })
    assert.deepEqual(result.kept, ['datasync-keep-too', '20260509-010303'])
    assert.deepEqual(result.removed.map((entry) => entry.packageId), ['20260509010202', '20260509-010101'])
    assert.equal(fs.existsSync(path.join(backupRoot, 'datasync-keep-too')), true)
    assert.equal(fs.existsSync(path.join(backupRoot, '20260509-010303')), true)
    assert.equal(fs.existsSync(path.join(backupRoot, '20260509010202')), false)
    assert.equal(fs.existsSync(path.join(backupRoot, '20260509-010101')), false)
    assert.equal(fs.existsSync(path.join(backupRoot, 'not-a-backup')), true)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

process.on('beforeExit', () => {
  if (failed > 0) process.exitCode = 1
})
