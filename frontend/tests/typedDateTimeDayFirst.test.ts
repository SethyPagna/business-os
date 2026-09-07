// N31 -- the last typed date fields whose ORDER belonged to the viewer's device.
//
// Owner, Sep 6 2026: "i asked to change already dd/mm/yyyy. this is the rule
// moving forward." DateEntryInput's own header states the mechanism that rule
// needs -- "every staff-typed date in the admin app renders THIS instead" of a
// native picker -- and DateTimeRangePicker records why: a native field takes
// its field ORDER and its clock from the browser locale, so the same shift row
// reads 09/03/2026 3:30 PM on an en-US laptop and 03/09/2026 15:30 on a Khmer
// one. Nothing on screen says which you are looking at, and for every day <= 12
// both readings are real dates.
//
// Three <input type="datetime-local"> fields on the shift surface (open time,
// close time, and the amend form's opened/closed pair) were still native. This
// file pins the two halves of closing them:
//
//   1. the KERNEL -- one shared reading of a typed date+time, day-first and
//      24-hour, exercised on data where the two orders disagree;
//   2. the SWEEP  -- no admin surface may reintroduce a native date/time
//      field, because a new one would look correct on the author's machine.
//
// Each sweep carries a positive control: a detector that reports "clean" on
// every input is indistinguishable from a broken one, so the same matcher is
// run against a string that MUST trip it and a string that must not.
//
// Run: node tests/typedDateTimeDayFirst.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeTimeEntry, splitLocalDateTime, joinLocalDateTime } from '../src/utils/dateEntry.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, '..', 'src')

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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// The kernel: one reading, day-first, 24-hour
// ---------------------------------------------------------------------------

await runTest('a typed date+time is composed day-first', () => {
  // 03/09/2026 is the discriminating input: month-first reads it as 9 March,
  // day-first as 3 September, and BOTH are real dates -- so only the answer
  // separates the two implementations. The date half is already pinned by
  // dateEntry.normalizeDateEntry; what is pinned here is that the composed
  // datetime keeps that reading rather than re-parsing the string.
  assert.equal(joinLocalDateTime('2026-09-03', '14:30'), '2026-09-03T14:30')
  // A day past the 12th can only be read one way, so it catches a composer
  // that happens to look right on ambiguous dates.
  assert.equal(joinLocalDateTime('2026-12-25', '08:05'), '2026-12-25T08:05')
})

await runTest('an incomplete datetime is refused rather than half-stored', () => {
  // The shift routes demand a full date AND time (api/shiftTransport.ts's
  // shiftLocalDateTimeToIso throws without one). Defaulting a missing time to
  // midnight would write a shift boundary the operator never chose, silently;
  // '' keeps the existing loud "date and time is required".
  assert.equal(joinLocalDateTime('2026-09-03', ''), '')
  assert.equal(joinLocalDateTime('', '14:30'), '')
  assert.equal(joinLocalDateTime('', ''), '')
})

await runTest('splitLocalDateTime round-trips the stored shape', () => {
  // 'YYYY-MM-DDTHH:mm' is the exact shape shiftLocalDateTimeToIso validates.
  assert.deepEqual(splitLocalDateTime('2026-09-03T14:30'), { date: '2026-09-03', time: '14:30' })
  assert.deepEqual(splitLocalDateTime(''), { date: '', time: '' })
  // Seconds arrive from some server rows; the field shows HH:mm.
  assert.deepEqual(splitLocalDateTime('2026-12-25T08:05:00'), { date: '2026-12-25', time: '08:05' })
  assert.deepEqual(splitLocalDateTime('nonsense'), { date: '', time: '' })
  const roundTrip = splitLocalDateTime('2026-09-03T14:30')
  assert.equal(joinLocalDateTime(roundTrip.date, roundTrip.time), '2026-09-03T14:30')
})

await runTest('the shared time reader is 24-hour and takes keypad runs', () => {
  // Same loose forms DateTimeRangePicker's row has always accepted -- this is
  // that function, moved rather than reimplemented, so the range row and the
  // shift fields cannot drift into two different clocks.
  assert.equal(normalizeTimeEntry('14:30').value, '14:30')
  assert.equal(normalizeTimeEntry('1430').value, '14:30')
  assert.equal(normalizeTimeEntry('930').value, '09:30')
  assert.equal(normalizeTimeEntry('9').value, '09:00')
  assert.equal(normalizeTimeEntry('9:5').value, '09:05')
  assert.equal(normalizeTimeEntry('23:59').value, '23:59')
  assert.equal(normalizeTimeEntry('00:00').value, '00:00')
  // The deployed shared parser also returns minutes. Empty and unreadable
  // both publish no value; the field keeps the raw text to distinguish them.
  assert.equal(normalizeTimeEntry('').value, null)
  assert.equal(normalizeTimeEntry('24:00').value, null)
  assert.equal(normalizeTimeEntry('12:60').value, null)
  assert.equal(normalizeTimeEntry('2:30pm').value, null)
})

await runTest('14:30 is never rendered back as a 12-hour time', () => {
  // The defect a native field carries: en-US renders 14:30 as "02:30 PM", and
  // an operator reading that beside a 24-hour sales row has no way to tell the
  // two apart at 02:30. The kernel has no am/pm branch at all.
  assert.equal(normalizeTimeEntry('14:30').value, '14:30')
  assert.notEqual(normalizeTimeEntry('14:30').value, '02:30')
})

// ---------------------------------------------------------------------------
// The sweep: no native date/time field may come back
// ---------------------------------------------------------------------------

const NATIVE_FIELD = /type=(?:"|'|\{")(?:date|time|datetime-local|month|week)(?:"|'|"\})/

/**
 * Blank out comments while KEEPING line numbers, so an offender's line still
 * points at the right place. The comments in these files argue at length about
 * native date fields -- including quoting the very markup they warn against --
 * so a sweep that only skipped lines beginning with `//` would report the
 * warnings as violations (it did, on DateTimeRangePicker's JSX block comment,
 * whose second line starts with the word "fields").
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, lead: string) => lead + ' ')
}

function nativeFieldLines(source: string): number[] {
  const lines = stripComments(source.replace(/\r\n/g, '\n')).split('\n')
  const hits: number[] = []
  lines.forEach((line, index) => { if (NATIVE_FIELD.test(line)) hits.push(index + 1) })
  return hits
}

await runTest('the native-field detector reports both a hit and a miss', () => {
  // Positive control. Without this, a detector that silently stopped matching
  // -- or one that swallowed real code along with the comments -- would report
  // every file clean and the sweep below would pass forever.
  assert.deepEqual(nativeFieldLines('<input className="input" type="datetime-local" value={x} />'), [1])
  assert.deepEqual(nativeFieldLines('<input type="date" />'), [1])
  assert.deepEqual(nativeFieldLines('const a = 1\n<input type="time" />'), [2], 'the reported line number survives comment blanking')
  // Negative controls: an ordinary field, and the two comment shapes these
  // files actually use to quote the markup they warn about.
  assert.deepEqual(nativeFieldLines('<input type="text" inputMode="numeric" />'), [])
  assert.deepEqual(nativeFieldLines('// <input type="date"> forces a picker'), [])
  assert.deepEqual(nativeFieldLines('{/* NOT\n   <input type="time">, which renders 12-hour AM/PM */}'), [])
})

await runTest('no admin surface renders a native date or time field', () => {
  const offenders: string[] = []
  for (const file of walk(srcDir)) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/')
    for (const line of nativeFieldLines(fs.readFileSync(file, 'utf8'))) offenders.push(`${rel}:${line}`)
  }
  assert.deepEqual(
    offenders, [],
    'a native date/time field takes its order and clock from the viewer\'s locale -- '
    + 'use DateEntryInput (date) or DateTimeEntryInput (date+time) instead',
  )
})

await runTest('the shift surface types its date+time through the shared field', () => {
  // The three fields this lane closed. Naming the file rather than counting
  // occurrences means a fourth one added later is caught by the sweep above,
  // and this one keeps proving the replacement is actually wired in.
  const modal = fs.readFileSync(path.join(srcDir, 'components', 'shifts', 'ShiftHistoryModal.tsx'), 'utf8')
  assert.ok(modal.includes('DateTimeEntryInput'), 'ShiftHistoryModal renders the shared date+time field')
  const uses = modal.split('<DateTimeEntryInput').length - 1
  assert.equal(uses, 3, `expected the opened/closed amend pair and the close-time field, found ${uses}`)
})

await runTest('the composed field hands its translator to the date half', () => {
  // DateTimeEntryInput takes `t` and uses it for the TIME half's strings, but
  // composed <DateEntryInput> without passing it on -- so the date half fell
  // back to its English literals (DateEntryInput.tsx's date_entry_invalid /
  // date_entry_help / date_entry_hint_label / date_entry_ambiguous) and a
  // Khmer operator amending or closing a shift read "Enter the date as
  // dd/mm/yyyy (day first)." in English inside an otherwise Khmer modal.
  // km.json:5358-5361 already carries all four keys; nothing reached them.
  //
  // verify:i18n cannot see this: the keys exist in both packs and the literals
  // are legitimate fallbacks for the callers that pass no `t` at all. Only the
  // wiring is wrong, so only a wiring assertion catches it.
  // JSX callback props contain `=>`, so a plain `[^>]*` stops before the
  // translator. Read through the whole self-closing tag instead.
  const HAS_T = /<DateEntryInput(?:(?!\/>)[\s\S])*\st=\{t\}/
  // Positive control first: an assertion that cannot report a negative is not
  // an assertion. The first string is the exact shape the bug had.
  assert.doesNotMatch(
    '<DateEntryInput id={id} value={date} onChange={(iso) => setDate(iso)} />', HAS_T,
    'the matcher must fail on a tag written WITHOUT the translator',
  )
  assert.match('<DateEntryInput t={t} id={id} value={date} />', HAS_T, 'the matcher must pass a tag that has it')

  // The newer deployed-lineage field composes DateTimeEntryInput in the same
  // module as DateEntryInput; preserve that single richer implementation.
  const composed = fs.readFileSync(path.join(srcDir, 'components', 'shared', 'DateEntryInput.tsx'), 'utf8')
  assert.match(composed, HAS_T, 'DateTimeEntryInput must pass its `t` down to the DateEntryInput it composes')
})

await runTest('no typed date field is rendered without a translator', () => {
  // The root cause, swept: every <DateEntryInput>/<DateTimeEntryInput> tag in
  // the admin app, because dropping `t` on any one of them silently reverts
  // that field's hints to English. The sweep, not the single assertion above,
  // is what stops the next call site repeating it.
  const TAGS = [/<DateEntryInput(?![A-Za-z])[\s\S]*?\/>/, /<DateTimeEntryInput(?![A-Za-z])[\s\S]*?\/>/]
  const offenders: string[] = []
  let seen = 0
  for (const file of walk(srcDir)) {
    const source = fs.readFileSync(file, 'utf8')
    const searchable = stripComments(source)
    const rel = path.relative(srcDir, file).replace(/\\/g, '/')
    for (const pattern of TAGS) {
      const re = new RegExp(pattern.source, 'g')
      let match: RegExpExecArray | null
      while ((match = re.exec(searchable))) {
        seen += 1
        // `t={...}` in any form -- some call sites hand down a pack-scoped
        // lookup (FastStockInModal's packLookup) rather than the raw `t`.
        if (!/\st=\{/.test(match[0])) offenders.push(`${rel}:${source.slice(0, match.index).split('\n').length}`)
      }
    }
  }
  // Guards the sweep itself: a walk that found nothing would report clean.
  assert.ok(seen >= 30, `expected the app's typed date fields to be found, saw ${seen}`)
  assert.deepEqual(offenders, [], 'every typed date field must be given a translator (`t={...}`)')
})

await runTest('the time reader has exactly one implementation', () => {
  // DateTimeRangePicker owned a private copy. Two copies of a clock is how the
  // range row and the shift row end up disagreeing about what "930" means.
  const picker = fs.readFileSync(path.join(srcDir, 'components', 'shared', 'DateTimeRangePicker.tsx'), 'utf8')
  assert.doesNotMatch(picker, /function normalizeTime\b/, 'the picker must import the shared reader, not keep its own')
  assert.match(picker, /normalizeTimeEntry/, 'the picker uses the shared reader')
})

if (failures) {
  console.error(`\ntypedDateTimeDayFirst: ${failures} failure(s)`)
  process.exit(1)
}
console.log('\ntypedDateTimeDayFirst: all checks passed')
