// The Yesterday quick range (owner's old-POS reference screenshots, Sep 5
// 2026: TODAY · YESTERDAY · LAST 7 DAYS · LAST 30 DAYS). Pins the pure
// helper's math, its place in the highlight order, and that the shared
// date/time picker, the Reports hub and both language packs carry it -- a
// preset that exists in the helper but on no surface, or in one pack only,
// is the usual way this kind of addition ships half-done.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeStatsPreset, statsPresetRange } from '../src/components/shared/statsStripPresets.ts'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')

// Single full business day before "now", including across month and year edges.
for (const [label, now, expected] of [
  ['ordinary', new Date(2026, 8, 5), '2026-09-04'],
  ['month start', new Date(2026, 8, 1), '2026-08-31'],
  ['year start', new Date(2026, 0, 1), '2025-12-31'],
  ['leap day', new Date(2028, 2, 1), '2028-02-29'],
] as const) {
  const range = statsPresetRange('yesterday', now)
  assert.equal(range.startDate, expected, `${label}: yesterday starts on the previous calendar day`)
  assert.equal(range.endDate, expected, `${label}: yesterday is exactly one day`)
  assert.equal(range.startTime, '00:00')
  assert.equal(range.endTime, '23:59')
}

// Round-trips through the highlight resolver and never collides with Today.
const now = new Date(2026, 8, 5)
assert.equal(activeStatsPreset(statsPresetRange('yesterday', now), now), 'yesterday')
assert.notDeepEqual(statsPresetRange('yesterday', now), statsPresetRange('today', now))

// Both language packs carry the label, and the shared picker and the hub's
// preset row both offer the chip right after Today (the reference order).
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
assert.equal(en.yesterday, 'Yesterday')
assert.ok(km.yesterday && km.yesterday.trim(), 'km.json carries yesterday')
const picker = read('src/components/shared/DateTimeRangePicker.tsx')
assert.match(picker, /\{ id: 'today'[^\n]*\n\s*\{ id: 'yesterday', label: quickRangeLabel\('yesterday', 'Yesterday'\) \}/, 'the picker offers Yesterday directly after Today')
const hub = read('src/components/sales/ReportsHub.tsx')
assert.match(hub, /\{ id: 'today'[^\n]*\n\s*\{ id: 'yesterday', label: trh\('yesterday', 'Yesterday'\) \}/, 'the hub offers Yesterday directly after Today')

console.log('PASS report yesterday preset')
