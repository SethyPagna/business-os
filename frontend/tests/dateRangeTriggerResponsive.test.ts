import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

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
const reportsCss = readFrontend('src/components/sales/reports/reports-surface.css')

const start = pickerSource.indexOf('const triggerEndpoint = (date: string) => (')
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

const require = createRequire(import.meta.url)
const rowModule = { exports: {} as { default?: (props: Record<string, unknown>) => any } }
const rowCode = transformSync(rowSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', rowCode)((id: string) => {
  if (id.includes('DateTimeRangePicker')) return () => null
  if (id.includes('statsStripPresets')) return require('../src/components/shared/statsStripPresets.ts')
  return require(id)
}, rowModule, rowModule.exports)
const renderRow = (layout?: 'wrap' | 'scroll') => rowModule.exports.default!({
  range: { startDate: '', endDate: '', startTime: '', endTime: '' }, onRangeChange() {},
  t: (key: string) => key, actions: 'Action', ...(layout ? { layout } : {}),
})

runTest('StatsRangeRow default action row wraps and retains a readable picker floor', () => {
  const row = renderRow(), controls = row.props.children[0], picker = controls.props.children[1]
  assert.match(controls.props.className, /(?:^| )flex-wrap(?: |$)/)
  assert.doesNotMatch(controls.props.className, /flex-nowrap/)
  assert.match(picker.props.className, /min-w-\[10\.5rem\]/)
  assert.match(picker.props.className, /flex-1/)
  assert.equal(controls.props.children[2], null, 'default presets stay below the action row')
  assert.ok(row.props.children[1], 'default presets remain available')
})

runTest('StatsRangeRow opt-in scroll rail keeps picker and presets on one local row', () => {
  const row = renderRow('scroll'), controls = row.props.children[0], picker = controls.props.children[1]
  assert.match(controls.props.className, /flex-nowrap/)
  assert.match(controls.props.className, /overflow-x-auto/)
  assert.match(picker.props.className, /min-w-\[14rem\]/)
  assert.match(picker.props.className, /shrink-0/)
  assert.ok(controls.props.children[2], 'scroll presets share the picker rail')
  assert.equal(row.props.children[1], null, 'scroll presets are not duplicated below')
})

// P9 follow-up (Sep 16 2026): the Reports compact/mobile control row had its
// own CSS override on top of the shared component -- `.reports-mobile-range
// > span { white-space: normal; overflow-wrap: anywhere; overflow: visible }`
// let `dd/mm/yyyy HH:MM` break mid-string and paint outside the trigger,
// which is the exact "too small and out of bounds" report AND a violation of
// the one-row-per-endpoint rule (Sep 15). That block is now removed rather
// than layered over; Reports relies on the shared component's own
// `whitespace-nowrap` + `overflow-hidden`, and stacks Start above End as two
// full-width lines below 400px instead of letting either endpoint wrap.
runTest('the Reports mobile range CSS no longer forces the endpoint text to wrap/break mid-string', () => {
  assert.doesNotMatch(reportsCss, /overflow-wrap:\s*anywhere/, 'no rule may let dd/mm/yyyy or HH:MM break mid-string')
  assert.doesNotMatch(reportsCss, /\.reports-mobile-range\s*>\s*span\s*\{[^}]*white-space:\s*normal/s, 'no rule may force the range endpoint span to wrap')
})

runTest('the Reports mobile range picker takes the full row width instead of a shared/shrinkable basis', () => {
  assert.doesNotMatch(reportsCss, /flex:\s*1\s+1\s+10rem/, 'the old shared 10rem basis must be gone')
  assert.match(reportsCss, /\.reports-mobile-primary\s*>\s*\*\s*\{[^}]*flex:\s*1\s+1\s+100%/s, 'the picker (the only child of .reports-mobile-primary) must claim the full row width')
})

runTest('the Reports mobile trigger uses the shared one-row endpoint track', () => {
  assert.match(reportsCss, /\.reports-mobile-range\s*\{[^}]*display:\s*flex/)
  assert.doesNotMatch(reportsCss, /\.reports-mobile-range \[data-date-range-trigger-values\]/)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
