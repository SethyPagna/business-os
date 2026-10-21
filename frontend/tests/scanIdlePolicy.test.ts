// Scanner S1b (6.0.935): how long a camera may run without a read.
//
// Before: a scanner left open decoded at full speed for as long as the page
// stayed open. Now: full speed for the first 15 s, twice a second until 60 s,
// then the camera is released into the existing "Camera paused" state.
//
// The clock here is a fake one the test advances by hand, so the 15 s and 60 s
// edges are exact (one millisecond before, and on, the boundary).
import assert from 'node:assert/strict'
import {
  SCAN_FULL_SPEED_MS,
  SCAN_PAUSE_AFTER_MS,
  SCAN_SLOW_INTERVAL_MS,
  createScanIdlePolicy,
  scanIntervalMs,
  type IdleTimers,
} from '../src/components/products/scanning/scanIdlePolicy.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function fakeClock() {
  let now = 0
  let nextHandle = 1
  const pending = new Map<number, { at: number; callback: () => void }>()
  const timers: IdleTimers = {
    setTimeout(callback, delayMs) {
      const handle = nextHandle++
      pending.set(handle, { at: now + delayMs, callback })
      return handle
    },
    clearTimeout(handle) { pending.delete(handle as number) },
  }
  return {
    timers,
    pendingCount: () => pending.size,
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        pending.delete(due[0])
        now = due[1].at
        due[1].callback()
      }
      now = target
    },
  }
}

runTest('the policy is 15 s of full speed, 2 Hz after that, and a pause at 60 s', () => {
  assert.equal(SCAN_FULL_SPEED_MS, 15_000)
  assert.equal(SCAN_SLOW_INTERVAL_MS, 500)
  assert.equal(SCAN_PAUSE_AFTER_MS, 60_000)
})

runTest('full speed until 15 s, then slow: the edge is exact', () => {
  const clock = fakeClock()
  const policy = createScanIdlePolicy(() => {}, clock.timers)
  policy.start()
  assert.equal(policy.pace(), 'full')
  clock.advance(14_999)
  assert.equal(policy.pace(), 'full', 'one millisecond before 15 s is still full speed')
  clock.advance(1)
  assert.equal(policy.pace(), 'slow', 'at 15 s the pace drops')
  clock.advance(44_000)
  assert.equal(policy.pace(), 'slow', 'and stays there until the pause')
})

runTest('the camera is paused once, at 60 s and not a millisecond earlier', () => {
  const clock = fakeClock()
  let paused = 0
  const policy = createScanIdlePolicy(() => { paused += 1 }, clock.timers)
  policy.start()
  clock.advance(59_999)
  assert.equal(paused, 0)
  clock.advance(1)
  assert.equal(paused, 1, 'paused at 60 s')
  clock.advance(120_000)
  assert.equal(paused, 1, 'and only once')
  assert.equal(clock.pendingCount(), 0, 'no timer is left running behind a paused camera')
})

runTest('stopping the policy cancels both timers, so a finished scan is never paused afterwards', () => {
  const clock = fakeClock()
  let paused = 0
  const policy = createScanIdlePolicy(() => { paused += 1 }, clock.timers)
  policy.start()
  clock.advance(10_000)
  policy.stop()
  assert.equal(clock.pendingCount(), 0)
  clock.advance(120_000)
  assert.equal(paused, 0)
  assert.equal(policy.pace(), 'full', 'a stopped policy reads as fresh')
})

runTest('starting again (Start camera after a pause) begins a fresh clock at full speed', () => {
  const clock = fakeClock()
  let paused = 0
  const policy = createScanIdlePolicy(() => { paused += 1 }, clock.timers)
  policy.start()
  clock.advance(20_000)
  assert.equal(policy.pace(), 'slow')
  policy.start()
  assert.equal(policy.pace(), 'full', 'a restart is full speed again')
  assert.equal(clock.pendingCount(), 2, 'the first run left no timers behind')
  clock.advance(59_999)
  assert.equal(paused, 0, 'the 60 s count began again at the restart, not at the first start')
  clock.advance(1)
  assert.equal(paused, 1)
})

runTest('the gap between decoded frames: full speed keeps its own cadence, slow never goes under 2 Hz', () => {
  assert.equal(scanIntervalMs('full', 0), 0, 'no native detector: as fast as the worker answers')
  assert.equal(scanIntervalMs('full', 120), 120, 'native cadence at full speed')
  assert.equal(scanIntervalMs('slow', 0), 500)
  assert.equal(scanIntervalMs('slow', 120), 500, 'slow is 2 Hz even when the full-speed cadence is faster')
  assert.equal(scanIntervalMs('slow', 800), 800, 'and never faster than a cadence that is already slower')
})

if (failed > 0) process.exitCode = 1
