// DATE-UI lane (owner rule, 6 Oct 2026): "make the date consistent dd/mm/yyyy.
// everything needs to follow a consistent or at least logical pattern. we
// can't have different logics in the system."
//
// One instant shape (dd/mm/yyyy HH:mm, 24-hour, business time), one date shape
// (dd/mm/yyyy), one clock shape (HH:mm). Every fixture below is picked so the
// UTC day and the business day DISAGREE, so a formatter that reads the stamp in
// UTC or in the device zone fails here rather than agreeing by luck:
//   2026-10-05T18:30:00Z  is  06/10/2026 01:30  in Phnom Penh (UTC+7).

import assert from 'node:assert/strict'
import { fmtClock24, fmtDate, fmtDateOnly, fmtDateTime24, fmtDateTime24OrRaw, fmtTime, parseServerTimestampMs, UNREADABLE_DATE_MARK } from '../src/utils/formatters.ts'
import {
  chartLabelsNeedYear,
  formatChartAxisLabel,
  formatChartTooltipLabel,
  formatHourOfDay,
  monthShortName,
  monthYearLabel,
} from '../src/utils/dateLabels.ts'
import { adjustmentLotCodeAsDisplay, batchDisplayLabel, batchReceivedDateText, formatBatchReceivedDate, lotCodeDisplay } from '../src/utils/batchLabel.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const INSTANT_Z = '2026-10-05T18:30:00Z'
const INSTANT_SPACE = '2026-10-05 18:30:00'

await runTest('an instant is read in business time, not UTC: the UTC day and the business day differ', () => {
  assert.equal(fmtDateTime24(INSTANT_Z), '06/10/2026 01:30')
  assert.equal(fmtDate(INSTANT_Z), '06/10/2026')
  assert.equal(fmtClock24(INSTANT_Z), '01:30')
})

await runTest('a SQLite space-shape stamp (no zone marker) is UTC, never device-local', () => {
  // `new Date('2026-10-05 18:30:00')` is LOCAL time in V8; the formatter must
  // not inherit that, or a Cambodia device shows a stamp 7 hours off.
  assert.equal(fmtDateTime24(INSTANT_SPACE), '06/10/2026 01:30')
  assert.equal(fmtDateTime24('2026-10-05 18:30:00+00:00'), '06/10/2026 01:30')
  assert.equal(fmtDateTime24('2026-10-06 01:30:00+07:00'), '06/10/2026 01:30')
})

await runTest('a slash string is never guessed month-first into an instant', () => {
  // fmtDateTime24('03/04/2026') used to return '04/03/2026 07:00': V8 reads a
  // slash string month-first, and the formatter then printed it day-first with an
  // invented clock -- a plausible stamp for the other day. 12/25 cannot be a
  // day-first date at all, and used to come out as 25/12/2026.
  for (const slash of ['03/04/2026', '12/25/2026', '25/12/2026']) {
    assert.equal(fmtDateTime24(slash), '—', slash)
    assert.equal(fmtDate(slash), '—', slash)
    assert.equal(fmtClock24(slash), '—', slash)
    assert.ok(Number.isNaN(parseServerTimestampMs(slash)), slash)
  }
  assert.equal(fmtDateTime24OrRaw('03/04/2026'), '03/04/2026', 'the OrRaw form keeps the stored text visible')
  assert.equal(fmtDateTime24OrRaw('', { empty: '--' }), '--')
  assert.equal(fmtDateTime24OrRaw(null), '—')
  assert.equal(fmtDateTime24OrRaw(INSTANT_Z), '06/10/2026 01:30')
  // Real stamps are untouched: date-only, offsets and T/space shapes.
  assert.equal(fmtDate('2026-10-05'), '05/10/2026')
  assert.equal(fmtDateTime24('2026-10-05T18:30:00.000+00:00'), '06/10/2026 01:30')
})

await runTest('fmtTime is the same shape as fmtDateTime24 -- no second instant format with a comma', () => {
  for (const sample of [INSTANT_Z, INSTANT_SPACE, '2026-09-02T01:59:00.000Z', '', null, undefined, 'not a date']) {
    assert.equal(fmtTime(sample), fmtDateTime24(sample), `fmtTime and fmtDateTime24 must agree on ${String(sample)}`)
  }
  assert.doesNotMatch(fmtTime(INSTANT_Z), /,/)
})

await runTest('midnight renders 00:00, never the 24:00 some engines print', () => {
  assert.equal(fmtDateTime24('2026-10-05T17:00:00Z'), '06/10/2026 00:00')
  assert.equal(fmtClock24('2026-10-05T17:00:00Z'), '00:00')
})

await runTest('seconds are the SAME shape plus :ss, only when asked for', () => {
  assert.equal(fmtDateTime24('2026-10-05T18:30:45Z'), '06/10/2026 01:30')
  assert.equal(fmtDateTime24('2026-10-05T18:30:45Z', { seconds: true }), '06/10/2026 01:30:45')
  assert.equal(fmtDateTime24('2026-10-05T17:00:05Z', { seconds: true }), '06/10/2026 00:00:05')
  assert.equal(fmtDateTime24('', { seconds: true }), '—')
})

await runTest('fmtDateOnly reads a stored date literally and marks a value it cannot read', () => {
  assert.equal(fmtDateOnly('2026-10-06'), '06/10/2026')
  assert.equal(fmtDateOnly('2026-10-06 01:30:00'), '06/10/2026')
  assert.equal(fmtDateOnly(''), '—')
  assert.equal(fmtDateOnly(null), '—')
  assert.equal(fmtDateOnly(undefined), '—')
  // The month-first leftover that used to pass straight through as if it were
  // the day-first date it resembles. It must still be SHOWN (hiding a stored
  // value is its own lie) but cannot look like a date a reader would act on.
  const shown = fmtDateOnly('03/04/2026')
  assert.equal(shown, `${UNREADABLE_DATE_MARK} 03/04/2026`)
  assert.doesNotMatch(shown, /^\d{2}\/\d{2}\/\d{4}$/)
  assert.ok(shown.includes('03/04/2026'), 'the stored text is still visible')
  assert.equal(fmtDateOnly('2029'), `${UNREADABLE_DATE_MARK} 2029`, 'a year-only expiry is flagged, not shown as a date')
})

await runTest('batchReceivedDateText: date-only literal, timestamp in business time, slash value flagged', () => {
  assert.equal(batchReceivedDateText('2026-10-06'), '06/10/2026')
  assert.equal(batchReceivedDateText('2026-10-05 18:30:00'), '06/10/2026', 'a default-batch datetime is the business day, not the UTC day')
  assert.equal(batchReceivedDateText('03/04/2026'), `${UNREADABLE_DATE_MARK} 03/04/2026`)
  // formatBatchReceivedDate used to hand '03/04/2026' to Date, which V8 reads month-first: it came out as '04/03/2026', a real-looking day-first date for the OTHER day.
  assert.equal(formatBatchReceivedDate('03/04/2026'), null)
  assert.equal(formatBatchReceivedDate('2026-09-24 18:30:00'), '25/09/2026')
  assert.equal(batchReceivedDateText(''), '—')
  assert.equal(batchReceivedDateText(null), '—')
})

await runTest('chart axis: days are dd/mm (dd/mm/yy across years), never month-first', () => {
  // 03 and 10 are both <= 12 in the wrong order too, so use a day past the 12th.
  assert.equal(formatChartAxisLabel('2026-10-25'), '25/10')
  assert.equal(formatChartAxisLabel('2026-10-25', true), '25/10/26')
  assert.equal(formatChartAxisLabel('2026'), '2026')
  assert.deepEqual([chartLabelsNeedYear(['2026-12-30', '2027-01-02']), chartLabelsNeedYear(['2026-01-01', '2026-02-01'])], [true, false])
})

await runTest('chart axis: month ticks are translated through date_month_N, with an English fallback that is never a raw key', () => {
  const km: Record<string, string> = { date_month_9: 'កញ្ញា', date_month_10: 'តុលា' }
  const tKm = (key: string) => km[key] ?? key
  assert.equal(formatChartAxisLabel('2026-09', false, tKm), 'កញ្ញា')
  assert.equal(formatChartAxisLabel('2026-10', true, tKm), 'តុលា 2026')
  // No translator, or a pack that returns the key for a miss: English, not "date_month_3".
  assert.equal(formatChartAxisLabel('2026-03'), 'Mar')
  assert.equal(formatChartAxisLabel('2026-03', false, tKm), 'Mar')
  assert.equal(monthShortName(3, tKm), 'Mar')
  assert.equal(monthShortName(13), '13', 'an impossible month stays visible')
  assert.equal(monthYearLabel(2026, 9, tKm), 'កញ្ញា 2026')
})

await runTest('chart tooltip heading: full dd/mm/yyyy for a day, translated month + year for a month', () => {
  const km: Record<string, string> = { date_month_9: 'កញ្ញា' }
  const tKm = (key: string) => km[key] ?? key
  assert.equal(formatChartTooltipLabel('2026-10-25'), '25/10/2026')
  assert.equal(formatChartTooltipLabel('2026-09', tKm), 'កញ្ញា 2026')
  assert.equal(formatChartTooltipLabel('2026'), '2026')
})

await runTest('the busy-hours label is the 24-hour clock', () => {
  assert.equal(formatHourOfDay(0), '00:00')
  assert.equal(formatHourOfDay(9), '09:00')
  assert.equal(formatHourOfDay(12), '12:00')
  assert.equal(formatHourOfDay(14), '14:00')
  assert.equal(formatHourOfDay('23'), '23:00')
  assert.equal(formatHourOfDay(24), '00:00')
  for (let hour = 0; hour < 24; hour += 1) assert.doesNotMatch(formatHourOfDay(hour), /AM|PM/i)
})

await runTest("migration 0108's month-first ADJ lot code DISPLAYS day-first; the stored code is untouched", () => {
  // ADJ09/02/2026 was written by strftime('%m/%d/%Y') -- 2 September.
  assert.equal(adjustmentLotCodeAsDisplay('ADJ09/02/2026'), 'ADJ 02/09/2026')
  assert.equal(lotCodeDisplay('ADJ09/02/2026'), 'ADJ 02/09/2026')
  assert.equal(batchDisplayLabel({ id: 7, lot_code: 'ADJ09/02/2026' }), 'ADJ 02/09/2026')
  // A day past the 12th proves the stored order rather than assuming it.
  assert.equal(lotCodeDisplay('ADJ12/25/2026'), 'ADJ 25/12/2026')
  // Not a month-first date (first group 25, or an impossible day): not 0108's output, shown as stored.
  assert.equal(lotCodeDisplay('ADJ25/12/2026'), 'ADJ25/12/2026')
  assert.equal(lotCodeDisplay('ADJ02/31/2026'), 'ADJ02/31/2026')
  // The other lot-code readings are unchanged.
  assert.equal(lotCodeDisplay('08242026'), '24/08/2026')
  assert.equal(lotCodeDisplay('L-0904'), 'L-0904')
  assert.equal(lotCodeDisplay(null), '')
  // A valid received date still outranks the synthetic code.
  assert.equal(batchDisplayLabel({ id: 7, lot_code: 'ADJ09/02/2026', received_at: '2026-09-02' }), '02/09/2026')
  // And the input string was not mutated into something else: the function is display-only.
  const stored = 'ADJ09/02/2026'
  lotCodeDisplay(stored)
  assert.equal(stored, 'ADJ09/02/2026')
})

if (failed > 0) process.exitCode = 1
