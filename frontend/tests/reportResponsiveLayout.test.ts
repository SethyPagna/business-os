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
assert.match(hub, /showCalendarIcon=\{false\}/)
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
assert.match(css, /@media \(min-width: 768px\)\s*\{\s*\[data-reports-hub\]\s*\{\s*padding-inline: clamp\(12px, 2vw, 24px\);/)
assert.ok(css.indexOf('@media (min-width: 768px)') < css.indexOf('@media (min-width: 1024px)'), 'desktop gutter overrides tablet gutter; phones remain unchanged')
assert.match(css, /\[data-reports-hub\] \.reports-overview-statement\s*\{[^}]*max-width: 34rem/)
assert.match(overview, /className="reports-overview-statement"/)
assert.match(hub, /showTime=\{supportsTime\}/)
assert.match(hub, /showTime=\{supportsTime\}\s+continuous/)
assert.equal((hub.match(/\{presetControls\}/g) || []).length, 2, 'both viewport branches offer the same presets')
assert.match(css, /\.reports-desktop-primary\s*\{[^}]*flex-direction: row/)
const applySource = picker.slice(picker.indexOf('const apply ='), picker.indexOf('// Day clicks alternate'))
const makeApply = new Function('value', 'continuous', 'setRangeInvalid', 'onChange', `${stripTypeScriptTypes(applySource)}; return apply`)
const base = { startDate: '2026-09-05', endDate: '2026-09-05', startTime: '23:59', endTime: '23:59' }
let invalid = false
const published: unknown[] = []
const apply = makeApply(base, true, (value: boolean) => { invalid = value }, (value: unknown) => published.push(value))
apply({ endTime: '09:00' })
assert.equal(invalid, true)
assert.equal(published.length, 0, 'reversed same-day edits never reach a render-time query serializer')
apply({ startTime: '09:15', endTime: '23:44' })
assert.equal(invalid, false)
assert.equal(published.length, 1)
apply({ endDate: '2026-09-06', endTime: '09:00' })
assert.equal(published.length, 2, 'overnight continuous endpoints on different dates remain valid')
for (const lang of ['en', 'km']) {
  const pack = JSON.parse(read(`lang/${lang}.json`))
  for (const key of ['start_date', 'end_date', 'start_time', 'end_time']) assert.ok(pack[key], `${lang} validation label ${key}`)
}
console.log('PASS report responsive layout, preset parity and unchanged 24-hour capability contracts')
