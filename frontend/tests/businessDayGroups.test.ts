// N14: the Stock-in Sessions list groups by BUSINESS day (Asia/Phnom_Penh) so
// the date lives once on a divider row and each session shows only its time.
//
// The discriminating fixture is the whole point of this file: three receipts
// that a device-calendar day key and a business day key sort into DIFFERENT
// groups. A grouping built on getFullYear/getMonth/getDate (which is what
// recordFilters.ts's buildTimeActionSections does) puts 16:30Z and 22:00Z on
// the same day; in Phnom Penh (UTC+7, no DST) they are 23:30 on one day and
// 05:00 on the next. Any implementation that agrees with the UTC/device key on
// this fixture is the wrong implementation, and the control below asserts the
// two answers really do differ rather than trusting that they must.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupByBusinessDay } from '../src/utils/businessDayGroups.ts'
import { fmtClock24, fmtDate } from '../src/utils/formatters.ts'

type Receipt = { id: number; created_at: string }

const receipts: Receipt[] = [
  { id: 1, created_at: '2026-09-02T09:00:00Z' }, // 16:00 Sep 2 Phnom Penh
  { id: 2, created_at: '2026-09-02T16:30:00Z' }, // 23:30 Sep 2 Phnom Penh
  { id: 3, created_at: '2026-09-02T22:00:00Z' }, // 05:00 Sep 3 Phnom Penh
]

// ---- control: the device/UTC-calendar answer this must NOT reproduce -------
const utcDayGroups = new Map<string, number[]>()
for (const row of receipts) {
  const at = new Date(row.created_at)
  const key = `${at.getUTCFullYear()}-${at.getUTCMonth() + 1}-${at.getUTCDate()}`
  utcDayGroups.set(key, [...(utcDayGroups.get(key) || []), row.id])
}
assert.equal(utcDayGroups.size, 1, 'control: a UTC/device-calendar day key puts all three receipts on one day')

// ---- the business-day answer ----------------------------------------------
const groups = groupByBusinessDay(receipts, (row) => row.created_at)
assert.equal(groups.length, 2, 'a receipt after 17:00 UTC belongs to the NEXT Phnom Penh business day')
assert.deepEqual(groups[0].rows.map((row) => row.id), [1, 2], 'both same-day receipts stay together, in arrival order')
assert.deepEqual(groups[1].rows.map((row) => row.id), [3], 'the 05:00 receipt opens its own business day')
assert.equal(groups[0].key, fmtDate('2026-09-02T09:00:00Z'), 'the day header is the shared fmtDate rendering, not a private format')
assert.notEqual(groups[0].key, groups[1].key, 'two business days must not collapse onto one header')

// The header carries the date, so the row need only carry the wall clock -- and
// that clock is business time too, not the device's.
assert.equal(fmtClock24('2026-09-02T22:00:00Z'), '05:00')
assert.equal(fmtClock24('2026-09-02T16:30:00Z'), '23:30')

// ---- order and stability ---------------------------------------------------
assert.deepEqual(groupByBusinessDay([], (row: Receipt) => row.created_at), [], 'an empty page produces no headers')
const interleaved = groupByBusinessDay(
  [receipts[2], receipts[0], receipts[2]],
  (row) => row.created_at,
)
assert.deepEqual(interleaved.map((group) => group.rows.length), [2, 1],
  'a day seen again later folds back into its existing group rather than opening a duplicate header')

// ---- the surfaces that must be on this mechanism ---------------------------
const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const sessions = read('components/products/StockInSessionsSection.tsx')
assert.match(sessions, /groupByBusinessDay/, 'the Stock-in Sessions list must group by business day')
assert.match(sessions, /dense-day-row/, 'the desktop session table needs the shared day divider row')
assert.match(sessions, /fmtClock24\(session\.createdAt\)/, 'the session date column shows the time only')
// `>{fmtDateTime24(...)}` is the RENDERED form; `title={fmtDateTime24(...)}`
// is the hover reveal, which must survive (truncated-text-reveal rule).
assert.doesNotMatch(sessions, />\{fmtDateTime24\(session\.createdAt\)\}/,
  'no session row may still print the full date+time now that a day header carries the date')
assert.match(sessions, /title=\{fmtDateTime24\(session\.createdAt\)\}/,
  'the full stamp must stay revealable on hover on both the desktop row and the mobile card')
assert.match(sessions, /\{group\.key\} · \{group\.rows\.length\}/,
  'both the desktop day row and the mobile day divider label the day and its size')

console.log('PASS business-day grouping splits a Phnom Penh day where a device-calendar key would not, and the Stock-in Sessions list uses it')
