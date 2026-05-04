'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  DRIVE_SYNC_DEFAULT_RETENTION_DAYS,
  resolveDriveSyncVersionState,
  selectExpiredDriveSyncVersions,
} = require('../src/services/googleDriveSync/versioning')

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

runTest('drive sync starts with datasync-1 when no active version exists', () => {
  const state = resolveDriveSyncVersionState({
    now: '2026-05-02T08:00:00.000Z',
  })
  assert.equal(state.versionNumber, 1)
  assert.equal(state.versionName, 'datasync-1')
  assert.equal(state.startedAt, '2026-05-02T08:00:00.000Z')
  assert.equal(state.rotated, true)
})

runTest('drive sync keeps the current folder for less than twenty four hours', () => {
  const state = resolveDriveSyncVersionState({
    currentVersionNumber: '7',
    currentVersionStartedAt: '2026-05-02T08:00:00.000Z',
    now: '2026-05-03T07:59:59.000Z',
  })
  assert.equal(state.versionNumber, 7)
  assert.equal(state.versionName, 'datasync-7')
  assert.equal(state.startedAt, '2026-05-02T08:00:00.000Z')
  assert.equal(state.rotated, false)
})

runTest('drive sync rotates to the next folder after twenty four hours', () => {
  const state = resolveDriveSyncVersionState({
    currentVersionNumber: '7',
    currentVersionStartedAt: '2026-05-02T08:00:00.000Z',
    now: '2026-05-03T08:00:00.000Z',
  })
  assert.equal(state.versionNumber, 8)
  assert.equal(state.versionName, 'datasync-8')
  assert.equal(state.startedAt, '2026-05-03T08:00:00.000Z')
  assert.equal(state.rotated, true)
})

runTest('drive sync falls back cleanly from invalid stored version state', () => {
  const state = resolveDriveSyncVersionState({
    currentVersionNumber: 'not-a-number',
    currentVersionStartedAt: 'bad-date',
    now: '2026-05-02T08:00:00.000Z',
  })
  assert.equal(state.versionNumber, 1)
  assert.equal(state.versionName, 'datasync-1')
  assert.equal(state.rotated, true)
})

runTest('drive sync retention deletes versions older than seven days by default', () => {
  const now = new Date('2026-05-10T00:00:00.000Z')
  const versions = Array.from({ length: 33 }, (_, index) => ({
    id: `id-${index + 1}`,
    name: `datasync-${index + 1}`,
    modifiedTime: new Date(now.getTime() - index * 24 * 60 * 60 * 1000).toISOString(),
  }))
  const expired = selectExpiredDriveSyncVersions(versions, undefined, now)
  assert.equal(DRIVE_SYNC_DEFAULT_RETENTION_DAYS, 7)
  assert.deepEqual(expired.map((entry) => entry.name), versions.slice(8).map((entry) => entry.name).reverse())
})

runTest('drive sync interval defaults to one hour and allows up to twenty four hours', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/googleDriveSync/index.js'), 'utf8')
  assert.match(source, /DRIVE_SYNC_DEFAULT_INTERVAL_SECONDS\s*=\s*60\s*\*\s*60/)
  assert.match(source, /DRIVE_SYNC_MAX_INTERVAL_SECONDS\s*=\s*24\s*\*\s*60\s*\*\s*60/)
  assert.match(source, /Math\.max\(DRIVE_SYNC_MIN_INTERVAL_SECONDS,\s*config\.syncIntervalSeconds\)/)
})

runTest('drive sync uses resumable streaming uploads instead of whole-file buffers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/googleDriveSync/index.js'), 'utf8')
  assert.match(source, /DRIVE_RESUMABLE_THRESHOLD_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/)
  assert.match(source, /DRIVE_RESUMABLE_CHUNK_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/)
  assert.match(source, /uploadType=resumable/)
  assert.match(source, /fs\.createReadStream\(file\.absolutePath/)
  assert.match(source, /upload_session_url/)
  assert.match(source, /upload_offset/)
  assert.match(source, /content_sha256/)
  assert.doesNotMatch(source, /fs\.readFileSync\(file\.absolutePath\)/)
  assert.doesNotMatch(source, /Buffer\.concat/)
})

if (failed > 0) {
  process.exitCode = 1
}
