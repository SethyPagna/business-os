// Adaptive import-poll cadence: fast for the first few attempts (so a small
// import's "Importing…" spinner clears almost as soon as the work is done),
// then holding at the old steady interval so a large/slow import doesn't hammer
// the server. Guards the ramp shape and the boundaries.
import assert from 'node:assert/strict'
import { importPollDelayMs, IMPORT_POLL_STEPS_MS, IMPORT_POLL_STEADY_MS } from '../src/utils/importPoll.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('the first polls are fast, then it holds at the steady interval', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => importPollDelayMs(n)),
    [...IMPORT_POLL_STEPS_MS],
    'the fast ramp must match the declared steps',
  )
  assert.equal(importPollDelayMs(4), IMPORT_POLL_STEADY_MS, 'past the ramp it holds steady')
  assert.equal(importPollDelayMs(99), IMPORT_POLL_STEADY_MS, 'far out it still holds steady')
})

runTest('the fast ramp is genuinely faster than the old fixed 1.2s interval', () => {
  for (const step of IMPORT_POLL_STEPS_MS) assert.ok(step < IMPORT_POLL_STEADY_MS, `${step} must be below the steady interval`)
  // The first poll gap is well under a second so a sub-second job is caught fast.
  assert.ok(importPollDelayMs(0) <= 400, 'the first gap must be snappy')
})

runTest('it never returns a non-positive or NaN delay for odd input', () => {
  for (const bad of [-1, -100, Number.NaN, undefined as unknown as number, 1.9]) {
    const value = importPollDelayMs(bad)
    assert.ok(Number.isFinite(value) && value > 0, `importPollDelayMs(${String(bad)}) => ${value} must be a positive number`)
  }
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} import-poll test(s) failed`)
} else {
  console.log('\nAll import-poll tests passed')
}
