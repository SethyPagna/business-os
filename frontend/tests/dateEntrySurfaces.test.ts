// Source-shape lock: every date a member of staff TYPES goes through the one
// shared field, and no surface quietly falls back to a native picker.
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". A rule that has to hold on ~15 surfaces is exactly the kind
// that decays one modal at a time, so it is pinned here rather than trusted
// to review.
//
// Run: node tests/dateEntrySurfaces.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '..', 'src')

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

const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), 'utf8')

// Every surface that renders a date the operator types, and what it is.
const SURFACES: Array<{ file: string; what: string }> = [
  { file: 'components/shared/DateTimeRangePicker.tsx', what: 'the Start -> End range row on every data page (Sales, Returns, Inventory, Branches, Expenses, Contacts, Dashboard, Audit log, Stock changes, reports)' },
  { file: 'components/inventory/ReceiveBatchModal.tsx', what: 'batch received date, expiry, credit due' },
  { file: 'components/inventory/ManageBatchesModal.tsx', what: 'batch date (the lot code) and expiry' },
  { file: 'components/inventory/FastStockInModal.tsx', what: 'fast stock-in received date, expiry, credit due' },
  { file: 'components/inventory/InventoryStockModals.tsx', what: 'the add / remove / set stock dialog received date' },
  { file: 'components/products/forms/BranchStockAdjuster.tsx', what: 'per-branch add-stock received date' },
  { file: 'components/products/forms/BulkAddStockModal.tsx', what: 'bulk add-stock received date' },
  { file: 'components/products/forms/ProductForm.tsx', what: 'product expiry date' },
  { file: 'components/products/StockInSessionsSection.tsx', what: 'stock-in session received date and credit due date' },
  { file: 'components/products/CreatedDateFilterOptions.tsx', what: 'the Products "Created" from/to range' },
  { file: 'components/fees/FeeForm.tsx', what: 'the Expenses record date' },
  { file: 'components/sales/ExportModal.tsx', what: 'the sales export custom range' },
  { file: 'components/promotions/PromotionsPage.tsx', what: 'promotion and discount start/end' },
  { file: 'components/catalog/ManagePromotionsModal.tsx', what: 'storefront promo show-from / show-until' },
  { file: 'components/custom-tables/CustomTables.tsx', what: "the custom-table row editor's date columns" },
]

for (const surface of SURFACES) {
  runTest(`${surface.file} enters dates through DateEntryInput (${surface.what})`, () => {
    const source = read(surface.file)
    assert.ok(
      /import\s+DateEntryInput\s+from\s+'[^']*DateEntryInput(\.tsx)?'/.test(source),
      `${surface.file} must import the shared DateEntryInput`,
    )
    assert.ok(source.includes('<DateEntryInput'), `${surface.file} must render <DateEntryInput`)
  })
}

// Surfaces that type a date AND a 24-hour time. Until Sep 6 2026 these three
// shift fields were the app's last native <input type="datetime-local">: the
// amend opened-at/closed-at and the historical close time a cashier cannot
// skip. The native control is wrong here for both halves at once -- it
// rejects the keypad run staff type, and it renders the DATE part in the
// device locale, so a phone set to en-US swaps day and month on a drawer
// close that is then written to the shift ledger as fact.
const DATE_TIME_SURFACES: Array<{ file: string; what: string }> = [
  { file: 'components/shifts/ShiftHistoryModal.tsx', what: 'shift amend opened-at and closed-at, and the required historical close date+time' },
]

for (const surface of DATE_TIME_SURFACES) {
  runTest(`${surface.file} enters date+time through DateTimeEntryInput (${surface.what})`, () => {
    const source = read(surface.file)
    assert.ok(
      /import \{[^}]*\bDateTimeEntryInput\b[^}]*\} from '[^']*DateEntryInput(\.tsx)?'/.test(source),
      `${surface.file} must import the shared DateTimeEntryInput`,
    )
    assert.ok(source.includes('<DateTimeEntryInput'), `${surface.file} must render <DateTimeEntryInput`)
  })
}

// The allow-list is EMPTY on purpose. Every date field in the admin app is
// typed by staff on a numeric keypad, and <input type="date"> is exactly what
// makes '9032026' impossible: it hands entry to the browser's own segmented
// widget, which accepts neither a bare digit run nor a paste of dd/mm/yyyy,
// and it renders in the DEVICE locale against the app's settled convention.
// (That convention became day-first on Sep 4 2026; the native control was
// already wrong when it was month-first, and letting the device pick the
// order is the same defect either way -- a wrong locale swaps day and month
// without failing.) There is no surface where the
// native control buys something the shared field does not. If one ever turns
// up, add it here WITH the reason -- do not weaken the sweep.
//
// Sep 6 2026: the sweep now covers EVERY native temporal control, not just
// type="date". It was written against that one string, and three
// <input type="datetime-local"> fields sat in ShiftHistoryModal.tsx
// underneath it the whole time -- the sweep reported green because the
// string it looked for was never the one that was there. That is a hole in
// the instrument rather than a missing rule: 'datetime-local' rejects
// '9032026' for exactly the same reason 'date' does, and 'time' renders
// 12-hour AM/PM under the pinned en-US locale (the reason
// DateTimeRangePicker dropped it too).
//
// Sep 7 2026: and it now reads the JSX EXPRESSION form as well. A quoted
// literal directly after `type=` was still the only shape the pattern could
// see, so a picker chosen at RENDER time -- the custom-table row editor's
// `type={... column.type === 'date' ? 'date' : 'text'}` -- was invisible to
// the one check whose whole job is to notice. Same hole, one level down: the
// rule was right, the instrument only looked at one spelling of it. A banned
// literal anywhere inside `type={...}` on the line now counts. A bare
// identifier (`type={dateKind}`) still does not: what it resolves to is not
// on the line, and flagging it would be guesswork rather than evidence.
const NATIVE_TEMPORAL_TYPES = ['date', 'datetime-local', 'time', 'month', 'week']

/** Matches `type="date"` AND a banned literal inside `type={...}`. */
function nativeTemporalPattern(): RegExp {
  const types = NATIVE_TEMPORAL_TYPES.join('|')
  return new RegExp(`type=(?:(["'])(?:${types})\\1|\\{[^}]*(["'])(?:${types})\\2[^}]*\\})`)
}

const NATIVE_DATE_ALLOW_LIST: string[] = []

/**
 * Blanks every block comment (a JSX `{/* … *\/}` included) so prose ABOUT a
 * banned control cannot be read as a use of it, while every surviving line
 * keeps its original number for the offender report. DateTimeRangePicker.tsx
 * explains why it dropped <input type="time"> on a continuation line that
 * starts with neither // nor *, and that explanation is the opposite of a
 * violation.
 */
function withoutBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); continue }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

runTest(`no source file renders a native <input type="${NATIVE_TEMPORAL_TYPES.join('|')}">`, () => {
  const native = nativeTemporalPattern()
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (NATIVE_DATE_ALLOW_LIST.includes(relative)) continue
    const source = withoutBlockComments(fs.readFileSync(file, 'utf8'))
    source.split('\n').forEach((line, index) => {
      // Comments explaining why the native control was dropped are fine.
      if (/^\s*(\/\/|\*)/.test(line)) return
      if (native.test(line)) offenders.push(`${relative}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `native temporal inputs found -- route them through DateEntryInput / DateTimeEntryInput:\n  ${offenders.join('\n  ')}`)
})

runTest('the widened sweep can still see a native control (positive control)', () => {
  // A sweep that reports every case the same way is indistinguishable from a
  // broken instrument -- which is exactly how the datetime-local fields
  // survived it. So the pattern is exercised here on known-offending text,
  // in the same file as the sweep it guards.
  //
  // The ternary row is the one that mattered: it is the exact shape of the
  // live offender the pattern used to walk straight past, so it sits in the
  // OFFENDING list rather than in a comment about it. `type={dateKind}` stays
  // innocent to keep the widening honest -- catching every `type={...}` would
  // pass this control while flagging every select and text input in the app.
  const native = nativeTemporalPattern()
  for (const offending of [
    '<input type="date" />',
    "<input type='datetime-local' />",
    '<input className="input" type="datetime-local" required />',
    '<input type="time" />',
    "<input type={column.type === 'date' ? 'date' : 'text'} />",
    '<input type={kind === "month" ? "month" : "text"} />',
  ]) {
    assert.ok(native.test(offending), `the sweep must catch ${offending}`)
  }
  for (const innocent of ['<input type="text" />', '<input type="number" />', '<input type="datetime" />', 'type={dateKind}', "<input type={numeric ? 'number' : 'text'} />"]) {
    assert.ok(!native.test(innocent), `the sweep must not flag ${innocent}`)
  }
  // And the comment blanking keeps its line numbering, so an offender report
  // still points at the right line.
  const blanked = withoutBlockComments('const a = 1\n{/* NOT <input type="time"> */}\n<input type="date" />')
  assert.equal(blanked.split('\n').length, 3, 'blanking a block comment must not lose lines')
  assert.ok(!native.test(blanked.split('\n')[1]), 'prose inside a block comment must not read as a use')
  assert.ok(native.test(blanked.split('\n')[2]), 'real code after a block comment must still be caught')
})

runTest('no surface keeps a free-typed date field outside the shared component', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (relative === 'components/shared/DateEntryInput.tsx' || relative === 'utils/dateEntry.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    source.split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      // A plain <input> carrying a slash-date placeholder is a date field that
      // never learned to normalise -- exactly what FastStockInModal had. BOTH
      // orders are caught: day-first because that is the convention such a
      // field would be imitating, and month-first because a leftover
      // mm/dd/yyyy placeholder is now wrong twice over.
      if (/<input\b/.test(line) && /(dd\/mm\/yyyy|mm\/dd\/yyyy)/i.test(line)) offenders.push(`${relative}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `free-typed date fields found:\n  ${offenders.join('\n  ')}`)
})

runTest('DateEntryInput carries the entry contract the direction asked for', () => {
  const source = read('components/shared/DateEntryInput.tsx')
  assert.ok(source.includes('inputMode="numeric"'), 'the field must open a numeric keypad')
  // The placeholder is the only thing standing between a cashier's muscle
  // memory and a misfiled date, so it must spell the live order out.
  assert.ok(source.includes("placeholder = 'dd/mm/yyyy'"), 'the placeholder must be the literal display format')
  assert.ok(!source.includes('mm/dd/yyyy'), 'no month-first spelling may survive anywhere in the field')
  assert.ok(source.includes('applyDateEntryMask'), 'the as-you-type mask must come from the shared helper')
  assert.ok(source.includes('normalizeDateEntry'), 'commit must go through the shared normalizer')
  assert.ok(source.includes('setSelectionRange'), 'the caret must be restored after masking')
  assert.ok(/event\.key !== 'Enter'/.test(source), 'Enter must be handled explicitly')
  assert.ok(/if \(!settled\) return\s*\r?\n\s*event\.preventDefault\(\)/.test(source), 'Enter must preventDefault ONLY after a successful normalise')
  assert.ok(source.includes('moveToNextField'), 'a committed Enter must move focus to the next field')
  assert.ok(source.includes('InfoHint'), 'an unreadable entry must raise an InfoHint')
  assert.ok(!/onChange\(''\)[^\n]*invalid/.test(source), 'an unreadable entry must never clear the field')
})

runTest('the time and date+time fields reuse the same typed-entry machinery', () => {
  const source = read('components/shared/DateEntryInput.tsx')
  // One masking/caret/Enter implementation, three fields -- not a second
  // hand-rolled copy of the mechanics for the time half.
  assert.ok(source.includes('function MaskedEntryField'), 'the shared mechanics must live in one component')
  assert.equal((source.match(/setSelectionRange/g) || []).length, 1, 'the caret must be parked in exactly one place')
  assert.equal((source.match(/const moveToNextField = /g) || []).length, 1, 'the Enter-advance must be declared exactly once')
  assert.equal((source.match(/moveToNextField\(\)/g) || []).length, 1, 'the Enter-advance must be called from the one shared keydown handler')
  assert.ok(source.includes('export function TimeEntryInput'), 'the 24-hour time field must be exported from the shared module')
  assert.ok(source.includes('export function DateTimeEntryInput'), 'the date+time pair must be exported from the shared module')
  assert.ok(source.includes('applyTimeEntryMask'), 'the time mask must come from the shared helper')
  assert.ok(source.includes('normalizeTimeEntry'), 'the time commit must go through the shared normalizer')
  assert.ok(source.includes('localDateTimePairValue') && source.includes('splitLocalDateTime'), 'the pair must be split/joined by the shared kernel')
  // The half-filled rule: a date with no time publishes '' rather than a
  // guessed midnight, and both halves stay on screen.
  assert.ok(/const combined = localDateTimePairValue\(/.test(source), 'the pair must be published through the one pair rule')
  assert.ok(!/T00:00/.test(source), 'no field may default a missing time to midnight')
})

runTest('an unreadable half withdraws the shift timestamp instead of banking the last good one', () => {
  const source = read('components/shared/DateEntryInput.tsx')
  // A typed field keeps its last COMMITTED value while the operator's
  // unreadable text sits on screen -- that is DateEntryInput's contract and
  // it is right for a filter box. On the shift close it is not: the pair
  // would still hold the previous timestamp, closeReason would stay null,
  // and Save would write a drawer close at a minute printed nowhere on the
  // screen. So the pair listens to BOTH halves' invalid state and withdraws.
  // Two wirings, not the four `onInvalidChange={...}` in the file -- the other
  // two are DateEntryInput's and TimeEntryInput's pass-through to their own
  // caller, which is the range picker's box painting and not this rule.
  assert.equal(
    (source.match(/onInvalidChange=\{\(unreadable\) => apply\(\{/g) || []).length, 2,
    'both halves of the pair must report their unreadable state to it',
  )
  assert.ok(
    /dateUnreadable/.test(source) && /timeUnreadable/.test(source),
    'the pair must track each half\'s unreadable state by name',
  )
  // ...and it must NOT do it by clearing the half, which would wipe the very
  // text the operator has to see to fix.
  assert.ok(
    !/onInvalidChange=\{[^}]*set(Date|Time)\(''\)/.test(source),
    'withdrawing the pair must never clear what the operator typed',
  )
  // The blocker the withdrawal hands the work to already exists on both
  // shift forms; assert it here so the two halves cannot drift apart.
  const modal = read('components/shifts/ShiftHistoryModal.tsx')
  assert.ok(
    /const closeReason = !close\.closedAt \?/.test(modal) && /!edit\.openedAt \?/.test(modal),
    'both shift forms must print a reason when their timestamp is withdrawn',
  )
})

runTest('the shared field is 13px on desktop and >=16px under 768px', () => {
  const css = fs.readFileSync(path.join(SRC, 'styles', 'main.css'), 'utf8')
  const base = /input\.date-entry-input\s*\{[^}]*font-size:[^;]*16px/.exec(css)
  assert.ok(base, 'input.date-entry-input must floor at 16px (the iOS focus-zoom floor)')
  const desktop = /@media \(min-width: 768px\)\s*\{\s*input\.date-entry-input\s*\{[^}]*font-size:[^;]*13px/.exec(css)
  assert.ok(desktop, 'input.date-entry-input must drop to 13px at >=768px')
  // The regression this pins: a BARE '.date-entry-input { font-size }' rule
  // has the same specificity as this file's own '.text-sm { ... !important }'
  // text-scale rules and loses to them on source order, so every adopted
  // field that passes text-sm rendered at 14px on a phone -- under the very
  // floor the rule exists to guarantee (measured live at 375px, Sep 3). The
  // element-qualified selector is what makes that floor real.
  assert.ok(
    !/(^|[^a-zA-Z.])\.date-entry-input\s*\{[^}]*font-size/m.test(css),
    'the font-size rule must stay element-qualified (input.date-entry-input), or .text-sm !important wins',
  )
  assert.ok(
    /\.text-sm\s*\{[^}]*font-size:[^;]*!important/.test(css),
    'the .text-sm !important scale rule this has to outrank must still exist',
  )
})

runTest('the range picker still scopes list and stats through the same onChange', () => {
  const source = read('components/shared/DateTimeRangePicker.tsx')
  // Only the ENTRY changed. The range contract -- one apply() that keeps
  // start <= end and calls the caller's onChange with the whole range -- is
  // what every page uses to scope its list AND its stats together.
  assert.ok(/const apply = \(patch: Partial<DateTimeRange>\) => \{/.test(source), 'apply(patch) must survive')
  assert.ok(source.includes('onChange(next)'), 'apply must still hand the whole range back to the caller')
  assert.ok(/next\.endDate < next\.startDate/.test(source), 'the start<=end swap must survive')
  assert.ok(source.includes('commitManual'), 'the typed endpoints must still commit through commitManual')
  assert.ok(source.includes('<DateEntryInput'), 'the endpoint boxes must use the shared field')
  assert.ok(!source.includes('function parseManualDate'), 'the old local parser must be gone, not left as a second source of truth')
})

runTest('the range picker exposes the exact ordered presets above the date fields', () => {
  const source = read('components/shared/DateTimeRangePicker.tsx')
  const quickRanges = /const quickRanges:[\s\S]*?= \[([\s\S]*?)\n  \]/.exec(source)?.[1] || ''
  const ids = [...quickRanges.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(ids, ['all', 'today', 'yesterday', '7d', '30d', 'month'], 'picker presets must remain exact and ordered')
  for (const label of ['All time', 'Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month']) {
    assert.ok(quickRanges.includes(`'${label}'`), `picker must render the ${label} fallback label`)
  }

  const renderedPresets = source.indexOf('{quickRanges.map((preset) => (')
  const renderedStart = source.indexOf("{renderEndpointBox('start')}")
  const renderedEnd = source.indexOf("{renderEndpointBox('end')}")
  assert.ok(renderedPresets >= 0 && renderedPresets < renderedStart, 'presets must render above the Start field')
  assert.ok(renderedPresets < renderedEnd, 'presets must render above the End field')
})

runTest('the normalizer and the field are both reachable from one place', () => {
  const helper = read('utils/dateEntry.ts')
  for (const exported of ['normalizeDateEntry', 'applyDateEntryMask', 'isoToDisplayDate']) {
    assert.ok(helper.includes(`export function ${exported}`), `dateEntry.ts must export ${exported}`)
  }
  // Nothing may re-implement the parse locally.
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (relative === 'utils/dateEntry.ts' || relative === 'utils/batchCode.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    if (/function parseManualDate\b/.test(source)) offenders.push(relative)
  }
  assert.deepEqual(offenders, [], `a second hand-rolled date parser exists in:\n  ${offenders.join('\n  ')}`)
})

runTest('both language packs carry every date-entry string', () => {
  const flatten = (input: Record<string, unknown>, target: Record<string, string> = {}): Record<string, string> => {
    for (const [key, value] of Object.entries(input)) {
      if (value == null) continue
      if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, target)
      else target[key] = String(value)
    }
    return target
  }
  const en = flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'en.json'), 'utf8')))
  const km = flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'km.json'), 'utf8')))
  for (const key of ['date_entry_invalid', 'date_entry_help', 'date_entry_hint_label', 'date_entry_ambiguous', 'time_entry_invalid', 'time_entry_help', 'time_entry_hint_label']) {
    assert.ok(en[key], `en.json must define ${key}`)
    assert.ok(km[key], `km.json must define ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `km.json's ${key} must actually be Khmer, not the English string copied over`)
  }
})

if (failed > 0) {
  process.exitCode = 1
} else {
  console.log(`PASS dateEntrySurfaces: ${SURFACES.length} date surfaces + ${DATE_TIME_SURFACES.length} date+time surface type through one field, 0 native pickers left`)
}
