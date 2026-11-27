// R40 review S4: a return or exchange the Worker refused for want of an open shift (409 shift_required_for_cash) is a definite no, answered after the
// receipt lookup and before any write. The saved request is released, so the cashier can switch the tender or open the shift; a real unknown
// outcome (no Worker answer) still keeps it behind the "unknown outcome" panel.
// Mutants killed (each turns one assertion red):
//   the release never runs                                  -> "a shift refusal releases the saved request"
//   every error releases (a lost network too)               -> "a lost network keeps the saved request"
//   a quote refusal releases through this path              -> "another coded refusal keeps its own path"
//   a failed clear still reports released                   -> "a clear that fails keeps the request"
//   the release runs with no saved request                  -> "no saved request: nothing to release"
//   the modal notifies before it releases / never calls it  -> "the modal wires the release"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseRefusedReturnRequest } from '../src/components/returns/helpers/returnCashShiftRefusal.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const refusal = (extra: Record<string, unknown> = {}) => Object.assign(new Error('Open a shift to give cash back.'), { status: 409, code: 'shift_required_for_cash', shift_state: 'none', direction: 'out', ...extra })
const attempted = { pending: { version: 1 } as never, recovery: undefined }

await runTest('a shift refusal releases the saved request', async () => {
  const cleared: unknown[] = []
  const released = await releaseRefusedReturnRequest(refusal(), attempted, async (pending, recovery) => { cleared.push([pending, recovery]) })
  assert.equal(released, true)
  assert.deepEqual(cleared, [[attempted.pending, attempted.recovery]], 'the same saved request, cleared once')
})
await runTest('a lost network keeps the saved request', async () => {
  let calls = 0
  const lost = Object.assign(new Error('Failed to fetch'), { outcome: 'unknown' })
  assert.equal(await releaseRefusedReturnRequest(lost, attempted, async () => { calls += 1 }), false)
  assert.equal(await releaseRefusedReturnRequest(Object.assign(new Error('timeout'), { code: 'loader_timeout' }), attempted, async () => { calls += 1 }), false)
  assert.equal(calls, 0)
})
await runTest('another coded refusal keeps its own path', async () => {
  let calls = 0
  for (const code of ['customer_return_quote_stale', 'return_v1_pending', 'idempotency_conflict', 'permission_denied']) {
    assert.equal(await releaseRefusedReturnRequest(Object.assign(new Error('x'), { status: 409, code }), attempted, async () => { calls += 1 }), false, code)
  }
  assert.equal(calls, 0)
})
await runTest('a clear that fails keeps the request', async () => {
  assert.equal(await releaseRefusedReturnRequest(refusal(), attempted, async () => { throw new Error('storage') }), false)
})
await runTest('no saved request: nothing to release', async () => {
  let calls = 0
  assert.equal(await releaseRefusedReturnRequest(refusal(), null, async () => { calls += 1 }), false)
  assert.equal(calls, 0)
})
await runTest('a refusal that is not an object keeps the request', async () => {
  assert.equal(await releaseRefusedReturnRequest(null, attempted, async () => {}), false)
  assert.equal(await releaseRefusedReturnRequest('shift_required_for_cash', attempted, async () => {}), false)
})

await runTest('the modal wires the release: clear first, drop the panel, then show the pack text', () => {
  const modal = readFileSync(path.join(here, '..', 'src', 'components', 'returns', 'NewReturnModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const start = modal.indexOf('const submitNetReturn = async')
  const body = modal.slice(start, modal.indexOf('\n  if (sessionStale ||', start))
  assert.match(body, /attempted = \{ pending, recovery \}/, 'the request about to be sent is remembered for the catch')
  const catchAt = body.indexOf('} catch (error) {')
  const catchBody = body.slice(catchAt)
  const release = catchBody.indexOf('releaseRefusedReturnRequest(error, attempted')
  assert.ok(release > 0, 'the catch asks for the release')
  assert.match(catchBody, /if \(await releaseRefusedReturnRequest\(error, attempted, async \(saved, recovery\) => \{ await \(await loadReturnsTransport\(\)\)\.clearPendingReturnCreateV1\(user\?\.id, saved, recovery\) \}\)\) \{ if \(!current\(\)\) return; setPendingV1\(null\); setReviewedPendingBody\(null\) \}/)
  assert.ok(release < catchBody.indexOf('notify(saleSubmitRefusalText'), 'the release comes before the message')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
