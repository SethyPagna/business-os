import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { statsPresetRange } from '../src/components/shared/statsStripPresets.ts'

const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const hub = read('components/sales/ReportsHub.tsx')
const picker = read('components/shared/DateTimeRangePicker.tsx')
const css = read('components/sales/reports/reports-surface.css')
const overview = read('components/sales/reports/OverviewReport.tsx')
const sheet = read('components/sales/reports/ReceiptSheet.tsx')

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
assert.deepEqual(ids(mobile), ['all', 'today', 'yesterday', '7d', '30d', 'month'])
assert.deepEqual(ids(mobile), ids(shared))
const helperSource = hub.slice(hub.indexOf('export function mobilePresetRange'), hub.indexOf('export function activeMobilePreset'))
const helper = new Function('statsPresetRange', `${stripTypeScriptTypes(helperSource.replace('export ', ''))}; return mobilePresetRange`)(statsPresetRange)
for (const now of [new Date(2026, 0, 1), new Date(2026, 8, 5), new Date(2026, 3, 30)]) {
  for (const preset of ['all', 'today', 'yesterday', '7d', '30d', 'month'] as const) {
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

// --- O9 (owner, Sep 6): more side margin on large screens, label/value
// adjacent -----------------------------------------------------------------
//
// The 1024 clamp above saturates at 48px from 1600px, which read as almost
// no margin on a >=1280 monitor. These two tiers only ADD gutter/width-cap
// rules at wider breakpoints -- they must never come before the 768/1024
// blocks (that would let a wide-screen rule lose to a narrower one at equal
// specificity) and must never touch the tablet gutter (61237948) or the
// rounding fix (c999e909) already on this line.
assert.match(css, /@media \(min-width: 1280px\)\s*\{\s*\[data-reports-hub\]\s*\{\s*padding-inline: clamp\(40px, 4vw, 64px\);/, '1280px gets its own, larger gutter')
assert.match(css, /@media \(min-width: 1536px\)\s*\{\s*\[data-reports-hub\]\s*\{[^}]*max-width: 96rem;[^}]*margin-inline: auto;[^}]*padding-inline: clamp\(56px, 4vw, 80px\);/, '1536px+ caps the reading width and centers it, so 1920/4K keeps growing margin instead of a saturated 48px')
// REPAIR (verifier, Sep 6): `margin-inline: auto` on a flex item does not
// stretch it (CSS Flexbox 9.6) -- without an explicit `width: 100%` the hub
// shrinks to fit-content and `max-width: 96rem` never binds, so the whole
// surface floats mid-screen at >=1536px instead of centering at its cap.
// This assertion must fail against the un-repaired declaration list (it did,
// before `width: 100%` was added) so it actually guards the stretch
// contract instead of freezing the flex-collapse defect.
assert.match(css, /@media \(min-width: 1536px\)\s*\{\s*\[data-reports-hub\]\s*\{[^}]*width: 100%;[^}]*max-width: 96rem;[^}]*margin-inline: auto;[^}]*padding-inline: clamp\(56px, 4vw, 80px\);/, '1536px+ hub is given an explicit width so the auto margins can stretch-then-center it against the max-width cap, instead of shrinking to fit-content')
const gutterOrder = ['@media (min-width: 768px)', '@media (min-width: 1024px)', '@media (min-width: 1280px)', '@media (min-width: 1536px)']
for (let i = 1; i < gutterOrder.length; i += 1) {
  assert.ok(css.indexOf(gutterOrder[i - 1]) < css.indexOf(gutterOrder[i]), `${gutterOrder[i - 1]} must precede ${gutterOrder[i]} so wider screens win the cascade`)
}
// The 1024 desktop tier gains its own, larger gutter (O9 names >=1024): 3.5vw
// with a 28px floor, handing over to the 1280 tier without a step down. The
// old declaration must be gone as a declaration (a comment may still cite it).
assert.match(css, /@media \(min-width: 1024px\)\s*\{\s*\[data-reports-hub\]\s*\{[^}]*padding-inline: clamp\(28px, 3\.5vw, 56px\);/, '1024px gets a larger gutter than the tablet tier')
assert.doesNotMatch(css, /padding-inline: clamp\(20px, 3vw, 48px\);/, 'the old 1024 gutter declaration is gone')
assert.match(css, /@media \(min-width: 768px\)\s*\{\s*\[data-reports-hub\]\s*\{\s*padding-inline: clamp\(12px, 2vw, 24px\);/, 'tablet gutter (61237948) is unchanged')

// The excel-style income statement must hug its own columns like every other
// report table (ReportTable already asks DenseTable for `fit`); without it,
// the Line/Amount columns stretch across the whole (34rem, or uncapped on
// tablet) statement box and land far apart.
assert.match(overview, /<DenseTable fit>/, 'the Overview statement table hugs its columns')
// A hugged table is only as narrow as its widest cell. The statement's data
// note ("no courier cost recorded on 11,834 deliveries") used to sit inline in
// the label span, so under `fit` (min-w-max) it became the Line column's
// max-content and pushed the Amount column out of the 34rem statement box
// into the table's own horizontal scroller -- every value hidden (seen live
// on All time at 1280). The note is its own capped, wrapping block under the
// label instead: a block's max-width also caps its max-content contribution.
assert.doesNotMatch(overview, /<span className="[^"]*">\(\{note\}\)<\/span>/, 'the statement note is not an inline span inside the label cell')
assert.match(overview, /<div className="max-w-\[\d+rem\] whitespace-normal[^"]*">\(\{note\}\)<\/div>/, 'the statement note is a capped, wrapping block under its label')

// The receipt style's "segment" (one block = one till-receipt-like ledger)
// renders every label/value pair through ONE grid per block instead of a
// `justify-between` flex row per line -- `justify-between` hands each line
// all the box's free space, so the label and its value land at opposite
// edges of whatever box the block sits in (300-450px apart at >=1024 on the
// desktop card grid or the centered statement box). A max-content grid
// column keeps the value immediately after the widest label in the block on
// every width, and the value's own track means it can never wrap into the
// label column.
assert.match(sheet, /grid grid-cols-\[minmax\(0,max-content\)_max-content\][^"]*gap-x-\[var\(--ui-receipt-gap,0\.75rem\)\]/, 'segment rows render through the shared label/value grid')
assert.doesNotMatch(sheet, /flex items-baseline justify-between gap-\[var\(--ui-receipt-gap/, 'line rows no longer stretch label/value apart with justify-between')
// A line's note must not live inside the value cell: there it becomes the
// value track's max-content and one long note ("not available -- no courier
// cost recorded on 253 deliveries") squeezes every other label in the block
// to an ellipsis (verifier measurement, Sep 6: 313px -> 86px label track).
// It gets a spanning row that contributes nothing to track sizing instead.
assert.doesNotMatch(sheet, /\{line\.value\}\s*\{line\.note != null \? <span className="ml-1/, 'the note is no longer appended inside the value cell')
assert.match(sheet, /<span className="col-span-2 w-0 min-w-full whitespace-normal[^"]*">\{line\.note\}<\/span>/, 'the note is its own spanning row that cannot size the value track')
// The rule-over-totals divider must still be able to span both columns (a
// border on just the label or value cell would show a broken half-line).
assert.match(sheet, /col-span-2[^"]*border-t border-\[var\(--ui-ink-3\)\]/, 'the total divider spans both grid columns')

// Print/PDF is a standalone document with its own inline CSS (exportOptions
// builds it via window.open + document.write) and never loads this file --
// it must stay that way, one column, untouched by the gutter/grid changes.
assert.ok(!/@media print/.test(css), 'reports-surface.css still owns no print rules; the print path is the isolated exportOptions document')

console.log('PASS report responsive layout, preset parity, unchanged 24-hour capability contracts and O9 wide-screen gutter/label-value adjacency')
