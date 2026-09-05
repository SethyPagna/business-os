import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { statsPresetRange } from '../src/components/shared/statsStripPresets.ts'

const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const hub = read('components/sales/ReportsHub.tsx')
const picker = read('components/shared/DateTimeRangePicker.tsx')
const css = read('components/sales/reports/reports-surface.css')
const overview = read('components/sales/reports/OverviewReport.tsx')

// Throw on failure so this suite can also be statically imported by reportsHub.test.ts.
assert.match(hub, /reports-mobile-primary[\s\S]*?\{viewPicker\}\{rangePicker\}/)
assert.match(css, /\.reports-mobile-primary\s*\{[^}]*flex-wrap:\s*wrap/)
assert.match(hub, /showCalendarIcon=\{!compact\}/)
assert.match(picker, /showCalendarIcon = true/)
assert.match(picker, /\{showCalendarIcon && <CalendarDays/)
assert.match(picker, /placeholder="HH:MM"/)
assert.doesNotMatch(picker, /^\s*<input\s+type="time"/m)
const ids = (source: string) => [...source.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])
const mobile = hub.slice(hub.indexOf('const mobilePresets:'), hub.indexOf('const selectedMobilePreset'))
const shared = picker.slice(picker.indexOf('const quickRanges:'), picker.indexOf('const applyQuickRange'))
assert.deepEqual(ids(mobile), ['all', 'today', '7d', '30d', 'month'])
assert.deepEqual(ids(mobile), ids(shared))
const helperSource = hub.slice(hub.indexOf('export function mobilePresetRange'), hub.indexOf('export function activeMobilePreset'))
const helper = new Function('statsPresetRange', `${stripTypeScriptTypes(helperSource.replace('export ', ''))}; return mobilePresetRange`)(statsPresetRange)
for (const now of [new Date(2026, 0, 1), new Date(2026, 8, 5), new Date(2026, 3, 30)]) {
  for (const preset of ['all', 'today', '7d', '30d', 'month'] as const) {
    assert.deepEqual(helper(preset, now), statsPresetRange(preset, now), `${preset} must have identical clock/date semantics`)
  }
}
assert.match(css, /@media \(min-width: 1024px\)[\s\S]*?\[data-reports-hub\][\s\S]*?--ui-size-body: 14px/)
assert.match(css, /\[data-reports-hub\] \.reports-overview-statement\s*\{[^}]*max-width: 48rem/)
assert.match(overview, /className="reports-overview-statement"/)
assert.match(hub, /showTime=\{supportsTime\}/)
console.log('PASS report responsive layout, preset parity and unchanged 24-hour capability contracts')
