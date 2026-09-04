// S4-33 -- the app-wide move to day-first dates, and the line it must not cross.
//
// User, Sep 4 2026: "Option 3, change the whole app to dd-mm-yyy, just receipt
// id stays yyyy-mm-dd."
//
// This file exists for the SECOND half of that sentence as much as the first.
// Two different things in this codebase look like dates:
//
//   DISPLAY dates -- rendered for a person, and now day-first.
//   IDENTIFIERS   -- sorted, matched, stored, or parsed back. They only look
//                    like dates. Reformatting one corrupts data or breaks
//                    ordering, silently and in production.
//
// Every assertion below is paired on purpose: the display half pins the new
// order so it cannot drift back, and the identifier half pins the OLD shapes
// so a later session "finishing the job" cannot quietly convert them too.
// Deleting an identifier assertion here is the failure mode this file guards.

import assert from 'node:assert/strict'
import { fmtDate, fmtDateOnly, fmtDateTime24, fmtClock24 } from '../src/utils/formatters.ts'
import { normalizeDateEntry, isoToDisplayDate, applyDateEntryMask } from '../src/utils/dateEntry.ts'
import { formatBatchReceivedDate, lotCodeAsDate, lotCodeToIsoDate, batchDisplayLabel } from '../src/utils/batchLabel.ts'
import { batchReceivedInstant } from '../src/components/pos/posCore.ts'
import { dateToBatchCode, normalizeToIsoDate, readBatchDateCell } from '../src/utils/batchCode.ts'
import { businessDateTimeId, stockSessionId, isBusinessReceiptNumber } from '../src/utils/timestampId.ts'

let failures = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  FAIL - ${name}`)
    console.error(`    ${(error as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// DISPLAY -- day first
// ---------------------------------------------------------------------------

await runTest('the shared formatters render day first', () => {
  // 2026-09-02T01:59Z is 08:59 on 2 September in Phnom Penh (UTC+7).
  // Day 02 and month 09 are BOTH <= 12, so a transposed formatter would still
  // produce a plausible string -- which is exactly why this instant is used.
  assert.equal(fmtDateTime24('2026-09-02T01:59:00.000Z'), '02/09/2026 08:59')
  assert.equal(fmtDate('2026-09-02T01:59:00.000Z'), '02/09/2026')
  assert.equal(fmtDateOnly('2026-09-02'), '02/09/2026')
  // Time-only is unaffected by the order change and stays 24-hour.
  assert.equal(fmtClock24('2026-09-02T01:59:00.000Z'), '08:59')
})

await runTest('a day past the 12th proves the order rather than assuming it', () => {
  // 25 December can only be read one way, so this catches a formatter that
  // happens to look right on ambiguous dates but is actually still month-first.
  assert.equal(fmtDateOnly('2026-12-25'), '25/12/2026')
  assert.equal(fmtDate('2026-12-25T05:00:00.000Z'), '25/12/2026')
  assert.equal(isoToDisplayDate('2026-12-25'), '25/12/2026')
})

await runTest('typed date entry reads day first and still accepts ISO', () => {
  const today = new Date(2026, 8, 4)
  // The user's own keypad example. The DIGITS are unchanged and so is the
  // displayed string -- only the meaning moved, from 3 Sept to 9 March. There
  // is no signal in the input that reveals this, which is why it is pinned.
  assert.deepEqual(normalizeDateEntry('9032026', today), { value: '09/03/2026', iso: '2026-03-09' })
  assert.deepEqual(normalizeDateEntry('09/03/2026', today), { value: '09/03/2026', iso: '2026-03-09' })
  // Unambiguous day-first input.
  assert.deepEqual(normalizeDateEntry('25/12/2026', today), { value: '25/12/2026', iso: '2026-12-25' })
  assert.deepEqual(normalizeDateEntry('25122026', today), { value: '25/12/2026', iso: '2026-12-25' })
  // ISO stays accepted everywhere it already was -- it is what D1 speaks and
  // the one form neither reading can get wrong.
  assert.deepEqual(normalizeDateEntry('2026-03-09', today), { value: '09/03/2026', iso: '2026-03-09' })
  assert.deepEqual(normalizeDateEntry('20260904', today), { value: '04/09/2026', iso: '2026-09-04' })
  // Nonsense is still refused rather than guessed into a plausible date.
  assert.deepEqual(normalizeDateEntry('13/13/2026', today), { value: null, iso: null })
  assert.deepEqual(normalizeDateEntry('29/02/2026', today), { value: null, iso: null }, 'Feb 30/29 in a common year is not a real day')
  assert.deepEqual(normalizeDateEntry('29/02/2024', today), { value: '29/02/2024', iso: '2024-02-29' }, 'leap day is real')
})

await runTest('the as-you-type mask groups day first', () => {
  const today = new Date(2026, 8, 4)
  assert.equal(applyDateEntryMask('25', { today }), '25/')
  assert.equal(applyDateEntryMask('2512', { today }), '25/12/')
  assert.equal(applyDateEntryMask('25122026', { today }), '25/12/2026')
  // 32 is not a possible day, so the mask leaves it alone rather than
  // inventing a grouping and fighting the typist.
  assert.equal(applyDateEntryMask('32', { today }), '32')
})

await runTest('a batch reads back as a day-first date', () => {
  assert.equal(formatBatchReceivedDate('2026-12-25 03:00:00'), '25/12/2026')
  // An MMDDYYYY lot code decodes to a day-first DISPLAY string. The stored
  // code itself is asserted unchanged further down.
  assert.equal(lotCodeAsDate('12252026'), '25/12/2026')
  assert.equal(batchDisplayLabel({ id: 1, lot_code: '12252026' }), '25/12/2026')
})

// ---------------------------------------------------------------------------
// IDENTIFIERS -- unchanged, and deliberately so
// ---------------------------------------------------------------------------

await runTest('IDENTIFIER: batch/lot codes stay MMDDYYYY', () => {
  // dateToBatchCode's output is stored as lot_code/batch_key AND recomputed
  // to match existing lots. Re-cutting it day-first would stop today's code
  // matching the identical date's code stored yesterday, silently splitting
  // every lot in production in two.
  assert.equal(dateToBatchCode('2026-12-25'), '12252026', 'month first, then day, then year')
  assert.equal(dateToBatchCode('2026-08-24'), '08242026')
  // Round-trip: the code a date produces must be the code the display layer
  // decodes back to that same date.
  assert.equal(lotCodeAsDate(dateToBatchCode('2026-12-25') as string), '25/12/2026')
})

await runTest('IDENTIFIER: stock session ids stay S-YYYYMMDD-HHMM', () => {
  // Sortable by construction -- the whole reason the shape is year-first.
  assert.match(stockSessionId('2026-12-25 03:04:05'), /^S-\d{8}-\d{4}$/)
  assert.equal(stockSessionId('2026-12-25 03:04:05'), 'S-20261225-1004', 'UTC+7 wall clock, year first')
  // Two sessions an hour apart must still sort in chronological order as
  // plain strings; a day-first id would not.
  const earlier = stockSessionId('2026-12-25 03:04:05')
  const later = stockSessionId('2026-12-25 04:04:05')
  assert.ok(earlier < later, `${earlier} must sort before ${later}`)
  const nextMonth = stockSessionId('2027-01-02 03:04:05')
  assert.ok(later < nextMonth, `${later} must sort before ${nextMonth}`)
})

await runTest('IDENTIFIER: receipt numbers stay YYYYMMDD-HHMMSS', () => {
  assert.match(businessDateTimeId(new Date('2026-12-25T03:04:05.000Z')), /^\d{8}-\d{6}$/)
  assert.equal(businessDateTimeId(new Date('2026-12-25T03:04:05.000Z')), '20261225-100405')
  // The guard the offline queue uses to tell a real business id from a
  // foreign one. It must keep accepting the year-first shape and its
  // RET-/SRET- variants.
  assert.ok(isBusinessReceiptNumber('20261225-100405'))
  assert.ok(isBusinessReceiptNumber('RET-20261225-100405'))
  assert.ok(isBusinessReceiptNumber('SRET-20261225-100405'))
  assert.equal(isBusinessReceiptNumber('25/12/2026'), false, 'a displayed date is not a receipt number')
  // NOTE: the guard is shape-only (8 digits, dash, 6 digits) and cannot tell
  // a year-first id from a day-first one -- '25122026-100405' passes it too.
  // So the real protection is the MINTER's order, asserted above, plus the
  // sort below. Do not "strengthen" this into a false claim that the regex
  // rejects day-first ids; it does not, and never did.
  assert.ok(isBusinessReceiptNumber('25122026-100405'), 'documenting what the shape guard really allows')
  // Minted ids must sort chronologically as plain strings -- that is what
  // year-first buys, and what converting the minter would silently destroy.
  const dec = businessDateTimeId(new Date('2026-12-25T03:04:05.000Z'))
  const jan = businessDateTimeId(new Date('2027-01-02T03:04:05.000Z'))
  assert.ok(dec < jan, `${dec} must sort before ${jan}`)
})

await runTest('IDENTIFIER: lot ORDERING is decoded from the code, never from the display string', () => {
  // The regression this lane actually caused and fixed: batchReceivedInstant
  // built its sort key by splitting lotCodeAsDate()'s DISPLAY output on '/'
  // and reading [mm, dd, yyyy] positionally. Going day-first made '08242026'
  // decode as month 24 -> December 2027, which would have silently reordered
  // the POS lot picker. Ordering now comes from lotCodeToIsoDate.
  assert.equal(lotCodeToIsoDate('08242026'), '2026-08-24')
  assert.equal(lotCodeToIsoDate('12252026'), '2026-12-25')
  assert.equal(lotCodeToIsoDate('ADJ09/02/2026'), null, 'a custom code has no instant')
  assert.equal(lotCodeToIsoDate('99999999'), null, 'month 99 is not a date')
  // Earlier code sorts before later code, whichever way dates are displayed.
  assert.ok(batchReceivedInstant({ lot_code: '08242026', received_at: null })! < batchReceivedInstant({ lot_code: '09012026', received_at: null })!)
  assert.equal(batchReceivedInstant({ lot_code: '08242026', received_at: null }), Date.UTC(2026, 7, 24))
  // And the ISO decode must agree with the display decode about WHICH day it
  // is -- the two halves cannot drift apart.
  const iso = lotCodeToIsoDate('08242026') as string
  const [y, m, d] = iso.split('-')
  assert.equal(lotCodeAsDate('08242026'), `${d}/${m}/${y}`)
})

await runTest("IDENTIFIER: migration 0108's ADJ lot codes render verbatim", () => {
  // 0108 wrote literal 'ADJ' + mm/dd/yyyy strings into lot_code. They are
  // stored DATA, not a format this code produces, so they must keep printing
  // exactly as stored -- lotCodeAsDate must refuse them (not a pure 8-digit
  // code) and batchDisplayLabel must pass them straight through.
  assert.equal(lotCodeAsDate('ADJ09/02/2026'), null)
  assert.equal(batchDisplayLabel({ id: 7, lot_code: 'ADJ09/02/2026' }), 'ADJ09/02/2026')
})

// ---------------------------------------------------------------------------
// The CSV header decides the reading order -- the asymmetry, pinned
// ---------------------------------------------------------------------------

await runTest('the same cell reads two different ways under two headers', () => {
  // This is the guard against a later session "helpfully" flipping the
  // importer to match the display convention. 03/09/2026 is the dangerous
  // shape: both fields <= 12, so a wrong reading produces a real date and
  // nothing looks broken.
  assert.equal(
    normalizeToIsoDate('03/09/2026', 'month-first'), '2026-03-09',
    'batch(mm/dd/yyyy) is March 9 -- every sheet the shop already has keeps this meaning',
  )
  assert.equal(
    normalizeToIsoDate('03/09/2026', 'day-first'), '2026-09-03',
    'batch(dd/mm/yyyy) is September 3',
  )
  // Month-first is the default, so no existing caller changed meaning.
  assert.equal(normalizeToIsoDate('03/09/2026'), '2026-03-09')
  // ISO is read identically under both orders.
  assert.equal(normalizeToIsoDate('2026-09-03', 'month-first'), '2026-09-03')
  assert.equal(normalizeToIsoDate('2026-09-03', 'day-first'), '2026-09-03')
})

await runTest('readBatchDateCell picks the order from the header it finds', () => {
  assert.deepEqual(
    readBatchDateCell({ 'batch(dd/mm/yyyy)': '03/09/2026' }),
    { raw: '03/09/2026', order: 'day-first' },
  )
  assert.deepEqual(
    readBatchDateCell({ 'batch(mm/dd/yyyy)': '03/09/2026' }),
    { raw: '03/09/2026', order: 'month-first' },
  )
  // Bare fallback headers name no format, so they keep the only meaning they
  // have ever had. An ambiguous header changing meaning is the same defect in
  // a smaller box.
  for (const header of ['batch', 'date', 'received_date']) {
    assert.deepEqual(
      readBatchDateCell({ [header]: '03/09/2026' }),
      { raw: '03/09/2026', order: 'month-first' },
      `bare '${header}' stays month-first`,
    )
  }
  // No date column at all -- callers default this to today.
  assert.deepEqual(readBatchDateCell({ name: 'Iced Coffee' }), { raw: '', order: 'month-first' })
  // End to end: the two headers must land in DIFFERENT lots.
  const dayFirst = readBatchDateCell({ 'batch(dd/mm/yyyy)': '03/09/2026' })
  const monthFirst = readBatchDateCell({ 'batch(mm/dd/yyyy)': '03/09/2026' })
  assert.equal(dateToBatchCode(normalizeToIsoDate(dayFirst.raw, dayFirst.order)), '09032026')
  assert.equal(dateToBatchCode(normalizeToIsoDate(monthFirst.raw, monthFirst.order)), '03092026')
})

// ---------------------------------------------------------------------------
// The two batchCode copies are hand-synced mirrors
// ---------------------------------------------------------------------------

await runTest('the frontend and Worker batchCode copies have identical bodies', async () => {
  const fs = await import('node:fs')
  // Marker carries no newline on purpose: these files are CRLF, and a marker
  // spanning a line break silently matches nothing.
  const marker = ' * Which way round a slash'
  // Compare with line endings normalised, so a checkout's CRLF/LF setting
  // cannot make two identical bodies look different.
  const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const worker = read('../../cloudflare/src/lib/batchCode.ts')
  const mirror = read('../src/utils/batchCode.ts')
  assert.ok(worker.includes(marker), 'Worker copy still carries the shared body marker')
  assert.ok(mirror.includes(marker), 'frontend copy still carries the shared body marker')
  assert.equal(
    mirror.slice(mirror.indexOf(marker)),
    worker.slice(worker.indexOf(marker)),
    'the mirrors have drifted -- change one, change the other in the same commit',
  )
  // The mirror must really carry the shared API, not just match by both
  // being truncated the same way.
  for (const symbol of ['readBatchDateCell', 'normalizeToIsoDate', 'dateToBatchCode']) {
    assert.ok(mirror.includes(`export function ${symbol}`), `mirror exports ${symbol}`)
  }
})

if (failures) {
  console.error(`\ndateFormatDayFirst: ${failures} failure(s)`)
  process.exit(1)
}
console.log('\ndateFormatDayFirst: all checks passed')
