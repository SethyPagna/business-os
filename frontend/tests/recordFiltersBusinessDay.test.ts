// DATE-UI lane, sweep D15 / M13: grouped record headers must file a stored UTC
// stamp under its BUSINESS day (Asia/Phnom_Penh), and name the month in the
// viewer's language.
//
// The device is forced to Los Angeles (UTC-7 in October) so a reader that
// leans on the device zone disagrees with the business zone on EVERY fixture:
//   2026-10-05 18:30:00 UTC  =  06/10 01:30 Phnom Penh  =  05/10 11:30 Los Angeles
// and, for the space shape specifically, V8 would read "2026-10-05 18:30:00"
// as LOCAL (Los Angeles) time, a different instant again.
process.env.TZ = 'America/Los_Angeles'

import assert from 'node:assert/strict'
import { getTimeParts } from '../src/utils/recordFilters.ts'
import { buildTimeActionSections } from '../src/utils/groupedRecords.ts'

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('the harness really runs on a device that is not in the business zone', () => {
  // Control: without this, every assertion below could pass on a Cambodia laptop for the wrong reason.
  assert.equal(new Date('2026-10-05T18:30:00Z').getDate(), 5, 'device day is 5 Oct; the business day is 6 Oct')
})

check('a space-shape SQLite stamp is UTC and groups under the business day', () => {
  const parts = getTimeParts('2026-10-05 18:30:00')
  assert.equal(parts.dayKey, '2026-10-06')
  assert.equal(parts.dayLabel, '06/10/2026')
  assert.equal(parts.monthKey, '2026-10')
  assert.equal(parts.yearLabel, '2026')
  assert.equal(parts.day, 6)
  assert.equal(parts.date?.toISOString(), '2026-10-05T18:30:00.000Z', 'the sort instant is the real UTC instant, not a device-local reading')
})

check('the business day rolls over at 17:00Z, not at device midnight', () => {
  assert.equal(getTimeParts('2026-10-05T16:59:59Z').dayKey, '2026-10-05')
  assert.equal(getTimeParts('2026-10-05T17:00:00Z').dayKey, '2026-10-06')
  assert.equal(getTimeParts('2026-10-05 17:00:00').dayKey, '2026-10-06')
})

check('the business MONTH rolls over at the Phnom Penh month end too', () => {
  // 30 Sep 18:00Z is 1 Oct 01:00 in Phnom Penh: a September UTC stamp that is an October sale.
  const parts = getTimeParts('2026-09-30 18:00:00')
  assert.equal(parts.monthKey, '2026-10')
  assert.equal(parts.month, 10)
  assert.equal(parts.dayLabel, '01/10/2026')
})

check('month headings are named through date_month_N: translated when a translator is given, English otherwise', () => {
  const km: Record<string, string> = { date_month_10: 'តុលា' }
  const tKm = (key: string) => km[key] ?? key
  assert.equal(getTimeParts('2026-10-05 18:30:00', tKm).monthLabel, 'តុលា 2026')
  assert.equal(getTimeParts('2026-10-05 18:30:00').monthLabel, 'Oct 2026')
  // The old label was toLocaleString('en-US', { month: 'long' }) -- "October 2026" -- on every screen, both languages.
  assert.doesNotMatch(getTimeParts('2026-10-05 18:30:00', tKm).monthLabel, /October/)
})

check('an unreadable stamp still lands in the Unknown bucket, never a guessed day', () => {
  assert.equal(getTimeParts('not-a-date').dayKey, 'unknown-day')
  assert.equal(getTimeParts('03/04/2026').dayKey, 'unknown-day', 'a slash value is not read as month-first by the engine')
  assert.equal(getTimeParts('').dayKey, 'unknown-day')
  assert.equal(getTimeParts(null).monthKey, 'unknown-month')
})

check('sections split two sales at the business midnight and label the month translated', () => {
  const rows = [
    { id: 1, created_at: '2026-10-05 16:59:59' },
    { id: 2, created_at: '2026-10-05 17:00:00' },
  ]
  const tKm = (key: string) => (key === 'date_month_10' ? 'តុលា' : key)
  const base = { getDate: (row: { created_at: string }) => row.created_at, getItemId: (row: { id: number }) => row.id, groupMode: 'time' as const }
  const days = buildTimeActionSections(rows, { ...base, timeMode: 'day', t: tKm })
  assert.deepEqual(days.map((section) => section.label), ['06/10/2026', '05/10/2026'])
  assert.deepEqual(days.map((section) => section.ids), [[2], [1]])
  const months = buildTimeActionSections(rows, { ...base, timeMode: 'month', t: tKm })
  assert.deepEqual(months.map((section) => section.label), ['តុលា 2026'])
})

if (failed > 0) process.exitCode = 1
