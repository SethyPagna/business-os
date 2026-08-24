import assert from 'node:assert/strict'
import { buildCompressionPlan } from '../src/utils/imageCompression.ts'

// buildCompressionPlan -- pure, DOM-free, so directly testable in Node.
// This is the ladder compressImageFile walks (dimension round x quality
// step) until a result lands at/under targetBytes/maxBytes.

const QUALITY_STEPS_COUNT = 5 // [0.92, 0.8, 0.68, 0.55, 0.42]
const MIN_DIMENSION_FLOOR = 480

{
  // A large source gets 3 dimension rounds (2560 -> 1920 -> 1440), each
  // with the full quality ladder, since none of those rounds hit the
  // floor -- so the plan should have 3 * 5 = 15 steps.
  const plan = buildCompressionPlan(2560)
  assert.equal(plan.length, 3 * QUALITY_STEPS_COUNT, 'three dimension rounds x five quality steps for a large starting dimension')
  assert.deepEqual(
    plan.slice(0, QUALITY_STEPS_COUNT).map((step) => step.maxDimension),
    Array(QUALITY_STEPS_COUNT).fill(2560),
    'first round keeps the caller-provided starting dimension across every quality step',
  )
  assert.equal(plan[0].quality, 0.92, 'first attempt uses the highest quality step')
  assert.ok(plan[QUALITY_STEPS_COUNT].maxDimension < 2560, 'second round shrinks the dimension from the first round')
}

{
  // A source that starts already at/under the floor should get exactly one
  // round (the floor itself) -- there's nowhere smaller to step down to,
  // so the plan should stop instead of repeating the same dimension.
  const plan = buildCompressionPlan(400)
  const dimensions = new Set(plan.map((step) => step.maxDimension))
  assert.deepEqual([...dimensions], [MIN_DIMENSION_FLOOR], 'a starting dimension under the floor is clamped up to the floor, once')
  assert.equal(plan.length, QUALITY_STEPS_COUNT, 'only the quality ladder runs once nothing more can be shrunk dimension-wise')
}

{
  // Every dimension round after the first should be smaller than the one
  // before it (25% shrink factor), and never below the floor.
  const plan = buildCompressionPlan(3000)
  const dimensions = [...new Set(plan.map((step) => step.maxDimension))]
  for (let index = 1; index < dimensions.length; index += 1) {
    assert.ok(dimensions[index] < dimensions[index - 1], 'each dimension round is smaller than the previous round')
  }
  assert.ok(dimensions[dimensions.length - 1] >= MIN_DIMENSION_FLOOR, 'no round ever goes below the minimum dimension floor')
}

console.log('PASS imageCompression buildCompressionPlan ladder')
