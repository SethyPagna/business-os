import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { statsPresetRange, activeStatsPreset, STATS_PRESETS, type StatsPresetKey } from '../src/components/shared/statsStripPresets.ts'

const cases: Array<[StatsPresetKey, string, string, string]> = [
  ['last_month', '2026-01-03', '2025-12-01', '2025-12-31'],
  ['last_month', '2024-03-31', '2024-02-01', '2024-02-29'],
  ['last_month', '2025-03-01', '2025-02-01', '2025-02-28'],
  ['quarter', '2026-10-01', '2026-10-01', '2026-10-01'],
  ['quarter', '2026-06-30', '2026-04-01', '2026-06-30'],
  ['last_quarter', '2026-01-03', '2025-10-01', '2025-12-31'],
  ['last_quarter', '2024-04-01', '2024-01-01', '2024-03-31'],
  ['last_quarter', '2026-07-01', '2026-04-01', '2026-06-30'],
  ['6m', '2026-10-01', '2026-04-02', '2026-10-01'],
  ['6m', '2024-08-31', '2024-03-01', '2024-08-31'],
  ['6m', '2025-08-31', '2025-03-01', '2025-08-31'],
  ['6m', '2026-03-31', '2025-10-01', '2026-03-31'],
  ['6m', '2026-01-15', '2025-07-16', '2026-01-15'],
  ['half_year', '2026-06-30', '2026-01-01', '2026-06-30'],
  ['half_year', '2026-07-01', '2026-07-01', '2026-07-01'],
  ['last_half_year', '2026-01-03', '2025-07-01', '2025-12-31'],
  ['last_half_year', '2026-07-01', '2026-01-01', '2026-06-30'],
  ['last_half_year', '2024-02-29', '2023-07-01', '2023-12-31'],
  ['last_year', '2026-01-01', '2025-01-01', '2025-12-31'],
  ['last_year', '2025-06-15', '2024-01-01', '2024-12-31'],
]

for (const [preset, date, startDate, endDate] of cases) {
  const [year, month, day] = date.split('-').map(Number)
  assert.deepEqual(statsPresetRange(preset, new Date(year, month - 1, day, 12)), {
    startDate, endDate, startTime: '00:00', endTime: '23:59',
  }, `${preset} at ${date} uses inclusive Cambodia calendar endpoints`)
}

const existingIds = ['all', 'today', 'yesterday', '7d', '30d', 'week', 'month', 'year']
const addedIds = ['last_month', 'quarter', 'last_quarter', '6m', 'half_year', 'last_half_year', 'last_year']
assert.deepEqual(STATS_PRESETS.map(({ id }) => id), [...existingIds, ...addedIds], 'existing preset order remains stable and every extension appears once')
assert.equal(new Set(STATS_PRESETS.map(({ key }) => key)).size, STATS_PRESETS.length)

const now = new Date(2026, 7, 26, 12)
for (const { id } of STATS_PRESETS) {
  const range = statsPresetRange(id, now)
  const firstMatching = STATS_PRESETS.find(({ id: candidate }) => {
    const other = statsPresetRange(candidate, now)
    return other.startDate === range.startDate && other.endDate === range.endDate
  })
  assert.equal(activeStatsPreset(range, now), firstMatching?.id, `${id} follows the visible order for overlapping calendar periods`)
  if (id !== 'all') assert.equal(activeStatsPreset({ ...range, startTime: '08:30' }, now), null)
}
assert.notDeepEqual(statsPresetRange('6m', now), statsPresetRange('last_half_year', now), 'rolling six months differs from the previous calendar semester')
assert.equal(activeStatsPreset(statsPresetRange('half_year', new Date(2026, 0, 3)), new Date(2026, 0, 3)), 'month', 'legacy collision priority is preserved')

for (const lang of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))
  for (const { id, key, fallback } of STATS_PRESETS) {
    assert.ok(typeof pack[key] === 'string' && pack[key].trim(), `${lang} defines ${key}`)
    if (lang === 'en' && addedIds.includes(id)) assert.equal(pack[key], fallback)
    if (lang === 'km') assert.match(pack[key], /[\u1780-\u17ff]/)
  }
}

const RealDate = globalThis.Date
const FixedDate = class extends RealDate {
  constructor(...args: Array<string | number | Date>) {
    if (args.length === 0) super('2026-12-31T17:30:00Z')
    else if (args.length === 1) super(args[0])
    else super(Number(args[0]), Number(args[1]), Number(args[2] ?? 1), Number(args[3] ?? 0), Number(args[4] ?? 0), Number(args[5] ?? 0), Number(args[6] ?? 0))
  }
}
globalThis.Date = FixedDate as DateConstructor
try {
  assert.deepEqual(statsPresetRange('last_year'), {
    startDate: '2026-01-01', endDate: '2026-12-31', startTime: '00:00', endTime: '23:59',
  }, 'real calls see 1 January in Cambodia while UTC still sees 31 December')
  assert.equal(statsPresetRange('last_month').endDate, '2026-12-31')
} finally {
  globalThis.Date = RealDate
}

console.log(`PASS date presets: ${cases.length} boundary cases, ${STATS_PRESETS.length} selections, EN/KM and Cambodia rollover`)
