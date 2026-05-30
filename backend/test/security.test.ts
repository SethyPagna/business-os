'use strict'

const assert = require('node:assert/strict')

const {
  checkAbuseLock,
  checkRateLimit,
  clearAbuseFailure,
  decryptSecret,
  encryptSecret,
  recordAbuseFailure,
  resetRateLimit,
  safeCompare,
} = require('../src/security.ts')

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

runTest('secret helpers preserve plaintext fallback without encryption key', () => {
  assert.equal(encryptSecret('plain-secret'), 'plain-secret')
  assert.equal(decryptSecret('plain-secret'), 'plain-secret')
  assert.equal(decryptSecret('enc:v1:bad'), '')
  assert.equal(encryptSecret(''), '')
})

runTest('rate limit blocks only after the configured attempt budget', () => {
  const bucket = `security-test-${Date.now()}`
  const identity = 'user-1'
  resetRateLimit(bucket, identity)

  assert.deepEqual(checkRateLimit(bucket, identity, 2, 60_000), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(checkRateLimit(bucket, identity, 2, 60_000), { allowed: true, retryAfterSeconds: 0 })

  const blocked = checkRateLimit(bucket, identity, 2, 60_000)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds >= 1, true)

  resetRateLimit(bucket, identity)
  assert.deepEqual(checkRateLimit(bucket, identity, 2, 60_000), { allowed: true, retryAfterSeconds: 0 })
})

runTest('safe compare rejects different values and accepts matching values', () => {
  assert.equal(safeCompare('same-token', 'same-token'), true)
  assert.equal(safeCompare('same-token', 'other-token'), false)
  assert.equal(safeCompare('short', 'longer'), false)
})

runTest('abuse lock tracks threshold failures and can be cleared', () => {
  const bucket = `abuse-test-${Date.now()}`
  const identity = 'user-2'
  clearAbuseFailure(bucket, identity)

  assert.deepEqual(checkAbuseLock(bucket, identity, 60_000), { locked: false, retryAfterSeconds: 0 })

  const first = recordAbuseFailure(bucket, identity, { threshold: 2, windowMs: 60_000, lockMs: 60_000 })
  assert.equal(first.locked, false)
  assert.equal(first.attempts, 1)

  const second = recordAbuseFailure(bucket, identity, { threshold: 2, windowMs: 60_000, lockMs: 60_000 })
  assert.equal(second.locked, true)
  assert.equal(second.attempts, 2)
  assert.equal(second.retryAfterSeconds >= 1, true)

  const locked = checkAbuseLock(bucket, identity, 60_000)
  assert.equal(locked.locked, true)

  clearAbuseFailure(bucket, identity)
  assert.deepEqual(checkAbuseLock(bucket, identity, 60_000), { locked: false, retryAfterSeconds: 0 })
})

if (failed > 0) {
  process.exitCode = 1
}
