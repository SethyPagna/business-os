import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCompressionPlan, DEFAULT_COMPRESS_OPTIONS } from '../src/utils/imageCompression.ts'

// Matches the bare-block style used above: run the body, print one PASS line.
function runCase(name: string, fn: () => void): void {
  fn()
  console.log('PASS', name)
}

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

// ---------------------------------------------------------------------------
// The size band, and the selection rule that used to defeat it
// ---------------------------------------------------------------------------
// Stored images were landing far below their budget (~70KB against a much
// larger cap) and the cause was NOT the numbers -- it was the selection rule.
// The encode loop kept whichever blob was SMALLEST and stopped at the soft
// target, while the plan only ever steps DOWN in quality and dimension. So it
// walked past perfectly good results to ship the most degraded one.
//
// Because the plan is monotonically decreasing, the FIRST attempt at or under
// the ceiling is by construction the LARGEST that fits. These assertions pin
// both the band and the descending-plan property the selection depends on.
{
  const KB = 1024
  runCase('the stored-image budget is the agreed 300-350KB band', () => {
    assert.equal(DEFAULT_COMPRESS_OPTIONS.maxBytes, 350 * KB, 'hard ceiling must be 350KB')
    assert.equal(DEFAULT_COMPRESS_OPTIONS.targetBytes, 300 * KB, 'floor must be 300KB')
    assert.ok(
      DEFAULT_COMPRESS_OPTIONS.targetBytes < DEFAULT_COMPRESS_OPTIONS.maxBytes,
      'the floor must sit below the ceiling or the band is meaningless',
    )
  })

  runCase('the compression plan is monotonically non-increasing, which is what makes "first under the cap" optimal', () => {
    const plan = buildCompressionPlan(2560)
    assert.ok(plan.length > 1, 'plan should have several steps')
    for (let i = 1; i < plan.length; i += 1) {
      const prev = plan[i - 1]
      const step = plan[i]
      const shrank = step.maxDimension < prev.maxDimension
      const sameDimLowerQuality = step.maxDimension === prev.maxDimension && step.quality < prev.quality
      assert.ok(
        shrank || sameDimLowerQuality,
        `step ${i} must be no larger than the one before it (got ${JSON.stringify(step)} after ${JSON.stringify(prev)})`,
      )
    }
  })

  runCase('the encode loop takes the FIRST result under the ceiling, not the smallest overall', () => {
    // Source-level, because the loop needs a real Canvas. The two mistakes
    // this pins are exactly the ones that shipped.
    const src = fs.readFileSync(new URL('../src/utils/imageCompression.ts', import.meta.url), 'utf8')
    const loop = src.slice(src.indexOf('const blob = await canvasToBlob'))
    assert.ok(
      /if \(blob\.size <= opts\.maxBytes\) \{[\s\S]{0,200}?break/.test(loop),
      'the loop must stop at the first attempt that fits under the ceiling',
    )
    assert.ok(
      !/if \(blob\.size <= opts\.targetBytes\) break/.test(loop),
      'stopping at the soft target is what biased results to the bottom of the budget',
    )
  })

  runCase('the Library page no longer carries a second, tighter budget', () => {
    const src = fs.readFileSync(new URL('../src/api/fileTransport.ts', import.meta.url), 'utf8')
    const match = src.match(/export const LIBRARY_IMAGE_COMPRESS_OPTIONS[\s\S]*?\}/)
    assert.ok(match, 'LIBRARY_IMAGE_COMPRESS_OPTIONS should still exist as an explicit call-site choice')
    assert.ok(
      !/maxBytes|targetBytes|maxDimension/.test(match[0]),
      'the library must use the one shared budget -- a second definition is how objects ended up at ~70KB',
    )
  })
}
