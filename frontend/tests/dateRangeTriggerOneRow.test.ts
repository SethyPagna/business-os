import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The current contract supersedes the earlier inline date+time trigger:
// dates alone stay on one line; editable times remain inside the panel.
// The native responsive test covers actual rendered values and time edits.

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

const source = readFrontend('src/components/shared/DateTimeRangePicker.tsx')
const start = source.indexOf('const triggerEndpoint = (date: string) => (')
assert.notEqual(start, -1, 'triggerEndpoint helper must exist')
const end = source.indexOf('\n  )', start)
const triggerEndpointBody = source.slice(start, end)

runTest('the trigger endpoint is an inline row, not a stacked grid/flex-col', () => {
  assert.doesNotMatch(triggerEndpointBody, /\bgrid\b/, 'must not use `grid` (which stacked date above time)')
  assert.doesNotMatch(triggerEndpointBody, /flex-col/, 'must not use `flex-col`')
  assert.doesNotMatch(triggerEndpointBody, /\bmt-0\.5\b|\bmt-1\b|\bmt-2\b/, 'must not add vertical margin between the date and time spans (that produced the second row)')
  assert.match(triggerEndpointBody, /inline-flex/, 'must lay the date out as an inline row')
})

runTest('the trigger endpoint stays on one line (whitespace-nowrap, tabular-nums)', () => {
  assert.match(triggerEndpointBody, /whitespace-nowrap/, 'must prevent the date text from wrapping')
  assert.match(triggerEndpointBody, /tabular-nums/, 'digits must keep tabular widths so the trigger does not jitter')
})

runTest('the closed trigger shows dates only while the panel retains time editing', () => {
  assert.match(triggerEndpointBody, /<span>\{date\}<\/span>/)
  assert.doesNotMatch(triggerEndpointBody, /\btime\b|showTimes|startTime|endTime/)
  assert.match(source, /value=\{startTimeText\}/)
  assert.match(source, /value=\{endTimeText\}/)
  assert.match(source, /commitTime\('start', event\.target\.value\)/)
  assert.match(source, /commitTime\('end', event\.target\.value\)/)
})

runTest('Start -> End trigger row keeps both endpoints on one row (grid-cols, not grid-rows)', () => {
  const markerIndex = source.indexOf('data-date-range-trigger-values')
  const triggerRow = source.slice(Math.max(0, markerIndex - 400), markerIndex)
  assert.match(triggerRow, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/, 'Start / arrow / End must lay out as three columns on one row')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
