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

const PRIMARY_QUALITY = 0.94
const QUALITY_FALLBACK_COUNT = 9
const MIN_DIMENSION_FLOOR = 320

{
  // Large sources now walk dimensions all the way to the floor at high
  // quality before sacrificing encoder quality. This is both more robust
  // (no early stop while still over budget) and more visually conservative.
  const plan = buildCompressionPlan(2560)
  const primary = plan.filter((step) => step.quality === PRIMARY_QUALITY)
  assert.equal(primary[0].maxDimension, 2560, 'first attempt uses the requested max dimension')
  assert.equal(primary[0].quality, PRIMARY_QUALITY, 'first attempt uses high quality')
  assert.equal(primary.at(-1)?.maxDimension, MIN_DIMENSION_FLOOR, 'dimension ladder must reach the floor')
  assert.equal(plan.length, primary.length + QUALITY_FALLBACK_COUNT, 'quality fallback runs only after the full dimension ladder')
}

{
  const plan = buildCompressionPlan(200)
  const dimensions = new Set(plan.map((step) => step.maxDimension))
  assert.deepEqual([...dimensions], [MIN_DIMENSION_FLOOR], 'a starting dimension under the floor is clamped up to the floor, once')
  assert.equal(plan.length, 1 + QUALITY_FALLBACK_COUNT, 'the floor gets one high-quality attempt plus the fallback quality ladder')
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
  runCase('the stored-image budget preserves quality while staying below the 1MB fast-path ceiling', () => {
    assert.equal(DEFAULT_COMPRESS_OPTIONS.maxBytes, 900 * KB, 'hard ceiling must stay safely below 1MB')
    assert.equal(DEFAULT_COMPRESS_OPTIONS.targetBytes, 820 * KB, 'quality target should stay close to the ceiling')
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

// ---------------------------------------------------------------------------
// Stepped downscaling -- the fix for "blurred pixels".
//
// A single drawImage() from 4000px straight to 1600px makes the browser
// resample a 2.5x reduction in one pass: roughly one source pixel is read per
// destination pixel and the rest are discarded, so fine detail aliases into
// mush. That is why a large photo came out soft while a zip of the same file
// stays crisp -- zip is lossless and never resamples at all.
//
// Halving repeatedly is the standard remedy: each 2:1 step averages exactly
// four source pixels into one, which is what the smoothing filter handles
// well, and errors do not compound the way one big jump's do.
//
// Asserted against the source because the real function needs a DOM canvas.
// What matters is the shape of the algorithm, and that is readable here.
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(new URL('../src/utils/imageCompression.ts', import.meta.url), 'utf8')

  assert.match(src, /function drawDownscaled\(/, 'the stepped downscaler must exist')
  assert.match(
    src,
    /drawDownscaled\(ctx, source as CanvasImageSource, width, height, target\.width, target\.height\)/,
    'the resize path must go through it, not call drawImage directly',
  )

  const body = src.slice(src.indexOf('function drawDownscaled('), src.indexOf('export const DEFAULT_COMPRESS_OPTIONS'))

  assert.match(
    body,
    /ctx\.imageSmoothingQuality = 'high'/,
    "smoothing quality must be set explicitly -- browsers default it to 'low' in several cases, which is the cheap sampling being avoided",
  )
  assert.match(
    body,
    /while \(currentWidth \/ 2 > targetWidth && currentHeight \/ 2 > targetHeight\)/,
    'it must halve only while a full halving still overshoots the target',
  )
  assert.match(
    body,
    /if \(targetWidth >= sourceWidth \|\| targetHeight >= sourceHeight \|\| sourceWidth \/ targetWidth < 2\)/,
    'an upscale or a sub-2x reduction must take the plain single draw -- halving toward a LARGER size would be wrong',
  )
  assert.match(
    body,
    /scratch\.width = 0; scratch\.height = 0/,
    'each scratch canvas must be freed immediately -- iOS Safari enforces an aggregate canvas-memory budget',
  )

  // Model the loop to prove the step sequence lands on the target exactly.
  const stepsFor = (sourceW: number, sourceH: number, targetW: number, targetH: number): number[] => {
    if (targetW >= sourceW || targetH >= sourceH || sourceW / targetW < 2) return [targetW]
    const out: number[] = []
    let w = sourceW
    let h = sourceH
    while (w / 2 > targetW && h / 2 > targetH) {
      w = Math.max(1, Math.floor(w / 2))
      h = Math.max(1, Math.floor(h / 2))
      out.push(w)
    }
    out.push(targetW)
    return out
  }

  assert.deepEqual(stepsFor(4000, 3000, 1000, 750), [2000, 1000], 'a 4x reduction halves once, then lands exactly')
  assert.deepEqual(stepsFor(4000, 3000, 500, 375), [2000, 1000, 500], 'an 8x reduction halves twice, then lands')
  assert.deepEqual(stepsFor(2000, 1500, 1600, 1200), [1600], 'a sub-2x reduction is a single draw, no halving')
  assert.deepEqual(stepsFor(800, 600, 1600, 1200), [1600], 'an upscale never halves')
  assert.equal(stepsFor(4000, 3000, 1000, 750).at(-1), 1000, 'the last step is always the exact target')

  console.log('PASS stepped downscaling halves toward the target instead of one aliasing jump')
}
