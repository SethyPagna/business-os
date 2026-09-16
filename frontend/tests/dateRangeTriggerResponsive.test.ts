import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P9 (Sep 16 2026), owner verbatim on the live app / small screens: "the date
// start and date end are not responsive in the button row. too small and out
// of bounds." The trigger's date+time text used a viewport-relative
// `clamp(9px, 2.6vw, 14px)` font floor -- unreadable, AND blind to the fact
// that a host control row (StatsRangeRow: Stats chip + picker + action
// buttons, shared by Sales/Returns/Inventory/Branches/Dashboard) could squeeze
// the trigger's own box far narrower than the viewport, so the text spilled
// past the box edge instead of shrinking with it.
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the project's existing style (see
// dateRangeTriggerOneRow.test.ts).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

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

const pickerSource = readFrontend('src/components/shared/DateTimeRangePicker.tsx')
const rowSource = readFrontend('src/components/shared/StatsRangeRow.tsx')

const start = pickerSource.indexOf('const triggerEndpoint = (date: string, time: string) => (')
assert.notEqual(start, -1, 'triggerEndpoint helper must exist')
const end = pickerSource.indexOf('\n  )', start)
const triggerEndpointBody = pickerSource.slice(start, end)

runTest('the trigger endpoint font never clamps below 11px', () => {
  const clamps = triggerEndpointBody.match(/clamp\((\d+)px/g) || []
  assert.ok(clamps.length > 0, 'expected at least one clamp() floor in the trigger endpoint')
  for (const clamp of clamps) {
    const floor = Number(clamp.match(/\d+/)?.[0])
    assert.ok(floor >= 11, `clamp floor ${floor}px is below the 11px legibility floor`)
  }
  // The compact (icon-row) variant is a bare fixed size, not a clamp -- it
  // must also never drop below 11px.
  assert.doesNotMatch(triggerEndpointBody, /text-\[(?:[0-9]|10)px\]/, 'a bare fixed size below 11px would also violate the floor')
})

runTest('the trigger endpoint has an overflow guard so text can never paint outside its box', () => {
  assert.match(triggerEndpointBody, /overflow-hidden/, 'triggerEndpoint span must guard against overflow')
})

runTest('the trigger button itself has an overflow guard', () => {
  const buttonClassStart = pickerSource.indexOf('className={`min-h-10 min-w-0 max-w-full')
  assert.notEqual(buttonClassStart, -1, 'trigger button className must exist')
  const buttonClassEnd = pickerSource.indexOf('\n', buttonClassStart)
  const buttonClass = pickerSource.slice(buttonClassStart, buttonClassEnd)
  assert.match(buttonClass, /overflow-hidden/, 'trigger button must guard against overflow')
})

runTest('no sm:min-w-[15rem]-style min-width is applied below the sm breakpoint', () => {
  assert.doesNotMatch(pickerSource, /(?<!sm:)min-w-\[1[0-9]rem\]/, 'a bare (non-sm:) min-width in rem would force overflow on narrow phones')
})

runTest('StatsRangeRow lets its action buttons wrap under the picker instead of shrinking the dates', () => {
  const rowStart = rowSource.indexOf('data-stats-range-controls')
  const rowContext = rowSource.slice(Math.max(0, rowStart - 400), rowStart)
  assert.match(rowContext, /flex-wrap/, 'the control row must allow wrapping (not flex-nowrap) so actions can move to their own line')
  assert.doesNotMatch(rowContext, /flex-nowrap/, 'flex-nowrap would force the picker to shrink instead of letting actions wrap')
})

runTest('StatsRangeRow gives the picker a real minimum width so it is never squeezed unreadably narrow', () => {
  assert.match(rowSource, /className="min-w-\[\d/, 'the picker wrapper must carry a concrete min-width floor')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
