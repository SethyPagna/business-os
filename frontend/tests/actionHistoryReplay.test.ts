import assert from 'node:assert/strict'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'

// Locks the K1 double-apply guard (resolveReplayAction): when the Worker has
// already replayed a reversal server-side (applied:true), the mutating closure
// must be skipped in favor of the refresh-only callback, so the client never
// writes the same reversal a second time (which under optimistic concurrency
// would also conflict). In every other case the original closure runs, exactly
// as before server appliers existed.

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const refresh = () => 'refreshed'
const action = () => 'mutated'

await runTest('server applied + a refresh callback -> the refresh runs, not the mutating closure', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh, action })
  assert.strictEqual(chosen, refresh)
  assert.strictEqual(chosen?.(), 'refreshed')
})

await runTest('server applied but NO refresh callback -> falls back to the closure (never a no-op)', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh: undefined, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply -> the closure runs even when a refresh callback exists (client-replay path unchanged)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply and there is no closure -> undefined (nothing to run)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh: undefined, action: undefined })
  assert.strictEqual(chosen, undefined)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll resolveReplayAction checks passed.')
