// Owner report (admin, phone, Sep 16 2026): "Failed to load tagged stock"
// (stock_tagged_load_failed) shows for every failure of the Products page's
// tagged-stock read, with no way to tell a permission problem from a server
// failure from a dropped connection -- Products.tsx's catch-all discarded
// the actual error entirely. See cloudflare/scripts/test-stock-condition-
// tag-pure.cjs's "GET /tagged-lots survives the exact frontend request
// shape against an empty table" check: the route itself does NOT throw for
// 0/1/150 ids against an empty damaged_stock_lots table, so the fix here is
// the toast finally carrying whatever the real failure actually was.
//
// Run: node tests/taggedLotsLoadFailure.test.ts
import assert from 'node:assert/strict'
import { describeTaggedLotsLoadFailure } from '../src/utils/taggedLotsLoadFailure.ts'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// A stand-in for Products.tsx's real `tr`: returns the English fallback, the
// same shape describeTaggedLotsLoadFailure actually receives at the callsite.
const tr = (_key: string, fallbackEn = _key): string => fallbackEn

function apiError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

runTest('a 403 names the permission problem, not the generic status code', () => {
  const message = describeTaggedLotsLoadFailure(apiError(403, 'Forbidden'), tr)
  assert.match(message, /Failed to load tagged stock/)
  assert.match(message, /You no longer have permission for this action\./)
  assert.doesNotMatch(message, /HTTP 403/, 'the permission-specific copy replaces the bare status code, not append to it')
})

runTest('a 5xx carries the status and the server\'s own message', () => {
  const message = describeTaggedLotsLoadFailure(apiError(500, 'D1_ERROR: too many SQL variables'), tr)
  assert.match(message, /Failed to load tagged stock \(HTTP 500: D1_ERROR: too many SQL variables\)/)
})

runTest('a status with no server message still names the status', () => {
  const message = describeTaggedLotsLoadFailure(apiError(502, ''), tr)
  assert.equal(message, 'Failed to load tagged stock (HTTP 502)')
})

runTest('a dropped connection (no status at all) falls back to the error message', () => {
  const message = describeTaggedLotsLoadFailure(new TypeError('Failed to fetch'), tr)
  assert.equal(message, 'Failed to load tagged stock: Failed to fetch')
})

runTest('a non-Error, non-status rejection still names the base failure', () => {
  assert.equal(describeTaggedLotsLoadFailure('boom', tr), 'Failed to load tagged stock')
  assert.equal(describeTaggedLotsLoadFailure(null, tr), 'Failed to load tagged stock')
  assert.equal(describeTaggedLotsLoadFailure(undefined, tr), 'Failed to load tagged stock')
})

runTest('status 0 (never a real HTTP status) is treated as no status, not "HTTP 0"', () => {
  const message = describeTaggedLotsLoadFailure(apiError(0, 'aborted'), tr)
  assert.doesNotMatch(message, /HTTP 0/)
  assert.equal(message, 'Failed to load tagged stock: aborted')
})

if (failed > 0) process.exitCode = 1
