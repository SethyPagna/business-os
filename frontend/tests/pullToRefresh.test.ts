import assert from 'node:assert/strict'
import {
  canStartPull,
  computeIndicatorDistance,
  isAtScrollTop,
  shouldTriggerRefresh,
  PULL_TO_REFRESH_CONSTANTS,
} from '../src/utils/pullToRefresh.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const { REFRESH_TRIGGER_DISTANCE_PX, MAX_INDICATOR_DISTANCE_PX } = PULL_TO_REFRESH_CONSTANTS

runTest('isAtScrollTop is true at exactly 0 and within the sub-pixel tolerance', () => {
  assert.equal(isAtScrollTop(0), true)
  assert.equal(isAtScrollTop(0.4), true)
  assert.equal(isAtScrollTop(2), true)
})

runTest('isAtScrollTop is false once meaningfully scrolled down', () => {
  assert.equal(isAtScrollTop(3), false)
  assert.equal(isAtScrollTop(120), false)
})

runTest('canStartPull requires being at the top', () => {
  assert.equal(canStartPull(0, 50), true)
  assert.equal(canStartPull(200, 50), false, 'a page scrolled down should never start a pull, even with a large downward delta')
})

runTest('canStartPull tolerates small noise but not a real upward reversal', () => {
  assert.equal(canStartPull(0, -1), true, 'tiny jitter around the start point should not cancel the gesture')
  assert.equal(canStartPull(0, -20), false, 'a real upward reversal should cancel the gesture')
})

runTest('computeIndicatorDistance is 0 below the start threshold', () => {
  assert.equal(computeIndicatorDistance(0), 0)
  assert.equal(computeIndicatorDistance(2), 0)
})

runTest('computeIndicatorDistance grows monotonically with raw finger distance', () => {
  const near = computeIndicatorDistance(20)
  const far = computeIndicatorDistance(80)
  assert.ok(far > near, 'a longer drag should produce a larger indicator distance')
  assert.ok(near >= 0)
})

runTest('computeIndicatorDistance is damped, not 1:1 with the raw finger distance', () => {
  const rawDelta = 100
  const distance = computeIndicatorDistance(rawDelta)
  assert.ok(distance < rawDelta, 'rubber-band damping should always move the indicator less far than the raw finger travel')
})

runTest('computeIndicatorDistance is clamped to MAX_INDICATOR_DISTANCE_PX regardless of how far the finger drags', () => {
  const distance = computeIndicatorDistance(10_000)
  assert.equal(distance, MAX_INDICATOR_DISTANCE_PX)
})

runTest('shouldTriggerRefresh is false below the trigger distance and true at/above it', () => {
  assert.equal(shouldTriggerRefresh(REFRESH_TRIGGER_DISTANCE_PX - 1), false)
  assert.equal(shouldTriggerRefresh(REFRESH_TRIGGER_DISTANCE_PX), true)
  assert.equal(shouldTriggerRefresh(REFRESH_TRIGGER_DISTANCE_PX + 10), true)
})

runTest('the trigger distance is reachable within the max indicator distance (a real gesture can actually fire a refresh)', () => {
  assert.ok(REFRESH_TRIGGER_DISTANCE_PX <= MAX_INDICATOR_DISTANCE_PX, 'if the trigger threshold exceeded the clamp ceiling, no gesture could ever trigger a refresh')
})

if (failed > 0) {
  process.exitCode = 1
}
