// MERGE-UNBLOCK (1 Oct 2026): "Stopped before finishing" with a Continue that
// re-sent the same refused request. Continue/Retry is now offered only when a
// second try could behave differently: no answer at all (network, timeout,
// unknown outcome) or a server fault (5xx, 408, 429). A definite 4xx refusal
// answers the same way every time, so it is shown with its own reason instead.
//
// Run: node tests/retryableFailure.test.ts
import assert from 'node:assert/strict'
import { isRetryableFailure } from '../src/utils/retryableFailure.ts'

const http = (status: number, message = 'x', extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra })

// Definite refusals: sending the same request again cannot help.
for (const status of [400, 401, 403, 404, 409, 410, 422]) {
  assert.equal(isRetryableFailure(http(status, 'Both products must be active')), false, `${status} is a refusal, not a retry`)
}
assert.equal(isRetryableFailure(http(409, 'Merge refused', { code: 'merge_state_conflict' })), false, 'a coded 409 is a refusal')
// The exact failure the owner hit: a Worker refusal carried through the adapter's localized copy.
assert.equal(isRetryableFailure(Object.assign(new Error('not duplicates'), { code: 'product_merge_not_duplicates', status: 409 })), false)

// Worth trying again.
for (const status of [500, 502, 503, 504, 522, 408, 429]) {
  assert.equal(isRetryableFailure(http(status)), true, `${status} may succeed on a second try`)
}
assert.equal(isRetryableFailure(new TypeError('Failed to fetch')), true, 'a dropped connection')
assert.equal(isRetryableFailure(new Error('Load failed')), true, 'Safari phrasing of the same')
assert.equal(isRetryableFailure(Object.assign(new Error('Request timed out after 30s'), { code: 'request_timeout' })), true)
assert.equal(isRetryableFailure(Object.assign(new Error('unsure'), { outcome: 'unknown' })), true, 'a write whose outcome is unknown')
assert.equal(isRetryableFailure(Object.assign(new Error('weird'), { code: 'write_outcome_unknown' })), true)

// A status always wins over a network-looking message: a 4xx that mentions "network" is still a refusal.
assert.equal(isRetryableFailure(http(403, 'Network access to this branch is not allowed')), false)
// Local refusals with no wire involved (permission or validation in the adapter) cannot be fixed by resending.
assert.equal(isRetryableFailure(new Error('Access Denied')), false)
assert.equal(isRetryableFailure(null), false)
assert.equal(isRetryableFailure('boom'), false)

console.log('PASS retryableFailure: refusals are shown, only network errors and server faults offer Continue')
