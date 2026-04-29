import assert from 'node:assert/strict'
import {
  DRIVE_SYNC_STATUS_COOLDOWN_MS,
  LIVE_SERVER_SENSITIVE_MIRROR_TABLES,
  NOTIFICATION_SUMMARY_MISSING_TTL_MS,
  isCooldownActive,
  maxStoredNumber,
  shouldPersistLocalMirror,
} from '../src/api/storagePolicy.mjs'

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

await runTest('live-server mirror policy blocks sensitive tables but keeps non-sensitive tables', () => {
  assert.equal(LIVE_SERVER_SENSITIVE_MIRROR_TABLES.has('products'), true)
  assert.equal(shouldPersistLocalMirror('products', 'https://sync.example.com'), false)
  assert.equal(shouldPersistLocalMirror('settings', 'https://sync.example.com'), true)
  assert.equal(shouldPersistLocalMirror('products', ''), true)
})

await runTest('maxStoredNumber and cooldown helpers prefer the strongest stored value', () => {
  const now = Date.now()
  const strongest = maxStoredNumber([0, now + NOTIFICATION_SUMMARY_MISSING_TTL_MS, now + DRIVE_SYNC_STATUS_COOLDOWN_MS])
  assert.equal(strongest >= now + DRIVE_SYNC_STATUS_COOLDOWN_MS, true)
  assert.equal(isCooldownActive(strongest, now), true)
  assert.equal(isCooldownActive(now - 1000, now), false)
})

if (failed > 0) {
  process.exitCode = 1
}
