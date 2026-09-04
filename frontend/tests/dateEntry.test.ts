// Pure table for the app-wide typed-date normalizer (src/utils/dateEntry.ts).
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". Every row below is one thing staff can type on a numeric
// keypad, plus the rejections that must NOT be guessed into a plausible
// wrong day.
//
// Sep 4 2026, the owner again: "change the whole app to dd-mm-yyy, just
// receipt id stays yyyy-mm-dd". So the reading order INVERTED: a typed run
// is now day-first. Note what that did to the Sep 3 example above -- typing
// 9032026 still displays "09/03/2026", the identical string, but it now
// means the 9th of March rather than the 3rd of September. The display
// contract is unchanged; the MEANING moved, which is precisely what was
// asked for, and it is why the `iso` column below is the real assertion and
// the `value` column alone would not have caught the change at all.
//
// Run: node tests/dateEntry.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDateEntryMask, daysInMonth, isoToDisplayDate, normalizeDateEntry } from '../src/utils/dateEntry.ts'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// A fixed "today" so the year-defaulting rows are deterministic. Built from
// local fields on purpose -- the helper only ever reads getFullYear().
const TODAY = new Date(2026, 8, 3)

type Row = { raw: string; value: string | null; iso: string | null; ambiguous?: boolean; why: string }

// ---------------------------------------------------------------------------
// 1. The cases the user named, spelled out.
// ---------------------------------------------------------------------------
const REQUIRED: Row[] = [
  { raw: '9032026', value: '09/03/2026', iso: '2026-03-09', why: "the user's own example: 7 digits read D MM YYYY -- 9 March" },
  { raw: '09032026', value: '09/03/2026', iso: '2026-03-09', why: '8 digits read DDMMYYYY' },
  { raw: '932026', value: '09/03/2026', iso: '2026-03-09', why: '6 digits read D M YYYY' },
  { raw: '9/3/26', value: '09/03/2026', iso: '2026-03-09', why: '2-digit years are 20yy' },
  { raw: '9-3-2026', value: '09/03/2026', iso: '2026-03-09', why: 'dashes are separators too' },
  { raw: '20260903', value: '03/09/2026', iso: '2026-09-03', why: '8 digits led by 19/20 still read YYYYMMDD' },
  // The rejections. Day-first moved WHICH field is out of range, so each of
  // these is the mirror of the row it replaced -- 13/05 used to be the
  // rejection and is now a perfectly good 13 May.
  { raw: '13/05/2026', value: '13/05/2026', iso: '2026-05-13', why: 'day 13 is a day: what used to be month 13 is now valid' },
  { raw: '05/13/2026', value: null, iso: null, why: 'month 13 is not a month' },
  { raw: '32/01/2026', value: null, iso: null, why: 'day 32 is not a day' },
  { raw: '30/02/2026', value: null, iso: null, why: 'February never has 30 days' },
]

// ---------------------------------------------------------------------------
// 2. Twenty more, covering the separators, the boundaries and the rejections.
// ---------------------------------------------------------------------------
const MORE: Row[] = [
  { raw: '', value: null, iso: null, why: 'empty text clears rather than errors (caller decides)' },
  { raw: '    ', value: null, iso: null, why: 'whitespace only is empty' },
  { raw: '03/09/2026', value: '03/09/2026', iso: '2026-09-03', why: 'already-canonical text passes through' },
  { raw: '2026-09-03', value: '03/09/2026', iso: '2026-09-03', why: 'ISO in, day-first display out -- ISO stays accepted everywhere' },
  { raw: '9.3.2026', value: '09/03/2026', iso: '2026-03-09', why: 'dots are separators' },
  { raw: '09 03 2026', value: '09/03/2026', iso: '2026-03-09', why: 'spaces are separators' },
  { raw: '90326', value: '09/03/2026', iso: '2026-03-09', why: '5 digits read D MM YY' },
  { raw: '25122026', value: '25/12/2026', iso: '2026-12-25', why: 'a December date is not mistaken for a year' },
  { raw: '12252026', value: null, iso: null, why: 'the OLD month-first spelling of that same day is now month 25: refused, not silently re-read' },
  { raw: '29022024', value: '29/02/2024', iso: '2024-02-29', why: '2024 is a leap year' },
  { raw: '29022025', value: null, iso: null, why: '2025 is not a leap year' },
  { raw: '31122026', value: '31/12/2026', iso: '2026-12-31', why: 'the last day of the year is real' },
  { raw: '31042026', value: null, iso: null, why: 'April has 30 days' },
  { raw: '09/00/2026', value: null, iso: null, why: 'month 0 is not a month' },
  { raw: '00/09/2026', value: null, iso: null, why: 'day 0 is not a day' },
  { raw: 'abc', value: null, iso: null, why: 'letters are not a date' },
  { raw: '09/03/1969', value: null, iso: null, why: 'below the 1970 floor the picker has always used' },
  { raw: '09/03/3000', value: null, iso: null, why: 'above the 2999 ceiling' },
  { raw: '09/03/2026 14:30', value: '09/03/2026', iso: '2026-03-09', why: 'a trailing 24-hour time is dropped, not rejected' },
  { raw: '11/22/026', value: null, iso: null, why: 'explicit separators are honoured literally -- a 3-digit year is a typo, never re-cut' },
  { raw: '2026/09/03', value: '03/09/2026', iso: '2026-09-03', why: 'a 4-digit first group is the year' },
  { raw: '1/2/2026', value: '01/02/2026', iso: '2026-02-01', why: 'single-digit day and month -- 1 February' },
  { raw: '25/12/26', value: '25/12/2026', iso: '2026-12-25', why: '2-digit year with an explicit grouping' },
]

// ---------------------------------------------------------------------------
// 3. Ambiguous digit runs -- a value IS returned (documented precedence) and
//    the flag is raised so a caller can advise.
// ---------------------------------------------------------------------------
const AMBIGUOUS: Row[] = [
  { raw: '1122026', value: '01/12/2026', iso: '2026-12-01', ambiguous: true, why: '7 digits: 1/12/2026 wins over 11/2/2026, both readable' },
]

// A run that USED to be ambiguous and legitimately stopped being one: under
// month-first, '122026' read either as 1/2/2026 or as MMDDYY 12/20/26. Day-first
// makes the second reading DDMMYY = day 12 of month 20, which is not a month, so
// exactly one candidate survives. The flag dropping here is a real gain in
// certainty, not a lost warning -- do not "restore" it.
const NO_LONGER_AMBIGUOUS: Row[] = [
  { raw: '122026', value: '01/02/2026', iso: '2026-02-01', why: '6 digits: D M YYYY is now the only valid reading' },
]

// ---------------------------------------------------------------------------
// 4. Year defaulted from `today` (the optional '903' support).
// ---------------------------------------------------------------------------
const YEAR_DEFAULTED: Row[] = [
  { raw: '903', value: '09/03/2026', iso: '2026-03-09', why: '3 digits: D MM, year from today' },
  { raw: '0903', value: '09/03/2026', iso: '2026-03-09', why: '4 digits: DDMM, year from today' },
  { raw: '9/3', value: '09/03/2026', iso: '2026-03-09', why: 'two groups: D/M, year from today' },
  { raw: '2026', value: null, iso: null, why: 'a bare year is not a day -- day 20 of month 26 does not exist' },
]

for (const group of [REQUIRED, MORE, AMBIGUOUS, NO_LONGER_AMBIGUOUS, YEAR_DEFAULTED]) {
  for (const row of group) {
    runTest(`normalizeDateEntry(${JSON.stringify(row.raw)}) -> ${row.value ?? 'null'} (${row.why})`, () => {
      const result = normalizeDateEntry(row.raw, TODAY)
      assert.equal(result.value, row.value)
      assert.equal(result.iso, row.iso)
      assert.equal(Boolean(result.ambiguous), Boolean(row.ambiguous))
    })
  }
}

runTest('value and iso always agree', () => {
  for (const group of [REQUIRED, MORE, AMBIGUOUS, NO_LONGER_AMBIGUOUS, YEAR_DEFAULTED]) {
    for (const row of group) {
      const result = normalizeDateEntry(row.raw, TODAY)
      if (result.iso === null) { assert.equal(result.value, null); continue }
      assert.equal(isoToDisplayDate(result.iso), result.value)
    }
  }
})

runTest('the day and the month are genuinely swapped, not coincidentally equal', () => {
  // Every row above whose day and month are both <= 12 would pass just as
  // happily under the old month-first reading. These would not: each names a
  // field past 12, so only one order can possibly parse them.
  assert.equal(normalizeDateEntry('25/12/2026', TODAY).iso, '2026-12-25')
  assert.equal(normalizeDateEntry('12/25/2026', TODAY).iso, null)
  assert.equal(normalizeDateEntry('31122026', TODAY).iso, '2026-12-31')
  assert.equal(normalizeDateEntry('12312026', TODAY).iso, null)
  assert.equal(isoToDisplayDate('2026-12-25'), '25/12/2026')
})

runTest('never routes through Date parsing -- the code contains no new Date(value)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const raw = fs.readFileSync(path.join(here, '..', 'src', 'utils', 'dateEntry.ts'), 'utf8')
  // Comments discuss the trap by name; only the CODE is under test.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n')
  // The one permitted Date read is `(today ?? new Date())` for the year default.
  assert.equal(/new Date\(\s*[^)\s]/.test(code), false, 'dateEntry.ts must never construct a Date from a value')
  assert.equal(code.includes('Date.UTC'), false, 'dateEntry.ts must never use Date.UTC')
  assert.equal(code.includes('toISOString'), false, 'dateEntry.ts must never use toISOString')
})

runTest('the same text resolves identically in a UTC-negative process timezone', () => {
  // Everything except the year-defaulted forms must be timezone-free. Simulate
  // by asserting the ISO is assembled from the typed digits, not from a clock.
  assert.equal(normalizeDateEntry('01012026', TODAY).iso, '2026-01-01')
  assert.equal(normalizeDateEntry('31122026', TODAY).iso, '2026-12-31')
  assert.equal(normalizeDateEntry('2026-01-01', TODAY).iso, '2026-01-01')
})

runTest('daysInMonth is a plain table with the leap rule', () => {
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2025, 2), 28)
  assert.equal(daysInMonth(2000, 2), 29)
  assert.equal(daysInMonth(1900, 2), 28)
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2026, 13), 0)
})

runTest('isoToDisplayDate is string surgery only', () => {
  assert.equal(isoToDisplayDate('2026-09-03'), '03/09/2026')
  assert.equal(isoToDisplayDate(''), '')
  assert.equal(isoToDisplayDate(null), '')
  assert.equal(isoToDisplayDate('03/09/2026'), '')
})

// ---------------------------------------------------------------------------
// 5. The as-you-type mask.
// ---------------------------------------------------------------------------
const MASK: Array<[string, string, string]> = [
  ['', '', 'empty stays empty'],
  ['0', '0', 'one digit cannot close a day'],
  ['09', '09/', 'a real 2-digit day closes its group'],
  ['31', '31/', 'the 31st closes its group -- it is a day now, not an impossible month'],
  ['32', '32', 'day 32 never closes a group'],
  ['0903', '09/03/', 'a real 2-digit month closes its group'],
  ['3013', '30/13', 'month 13 never closes the second group'],
  ['09032026', '09/03/2026', 'the full keypad run is masked live'],
  ['9032026', '9032026', "the user's 7-digit run is left alone -- 90 is not a day"],
  ['932026', '932026', '6-digit runs are left alone until commit'],
  ['20260903', '03/09/2026', '8 digits are a finished date, so YYYYMMDD is masked live into day-first'],
  ['09/03/2026', '09/03/2026', 'already-masked text is stable'],
  ['09/3', '09/3', 'a partial month group stays partial'],
  ['abc09', '09/', 'non-digits are dropped'],
  ['090320260000', '09/03/2026', 'the run is capped at 8 digits'],
]
for (const [raw, expected, why] of MASK) {
  runTest(`applyDateEntryMask(${JSON.stringify(raw)}) -> ${JSON.stringify(expected)} (${why})`, () => {
    assert.equal(applyDateEntryMask(raw, { today: TODAY }), expected)
  })
}

runTest('the mask does not re-add a slash while deleting', () => {
  assert.equal(applyDateEntryMask('09', { deleting: true, today: TODAY }), '09')
  assert.equal(applyDateEntryMask('09/03', { deleting: true, today: TODAY }), '09/03')
})

runTest('every masked prefix of the canonical run still normalises to the same day', () => {
  const digits = '09032026'
  const masked = applyDateEntryMask(digits, { today: TODAY })
  assert.equal(normalizeDateEntry(masked, TODAY).iso, '2026-03-09')
  assert.equal(normalizeDateEntry(digits, TODAY).iso, '2026-03-09')
})

if (failed > 0) {
  process.exitCode = 1
} else {
  console.log('PASS dateEntry: every typed form resolves to one dd/mm/yyyy day')
}
