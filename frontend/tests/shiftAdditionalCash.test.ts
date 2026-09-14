// The shift's "additional" field: ONE wording on every surface, and asked for
// BEFORE the closing count.
//
// The register holds change money. The opening count is the change float, the
// closing count is what is left of it, and "additional" is the extra change
// put into the drawer mid-shift when that float ran out -- in the owner's own
// example, opening 10k all used -> closing 0, another 10k added and used ->
// closing 0, additional 10k. It is neither sales cash nor a second closing
// count, and (like the whole registration) it is report-only.
//
// Two defects this locks:
//   1. one field, three names -- the form said "Additional cash added" with
//      "USD added" / "KHR added" inputs while the report row said "Additional
//      cash", so nothing on screen said what the figure is for;
//   2. every surface listed it AFTER the closing count, which is not the order
//      the drawer moves in or the order the cashier knows the figures.
//
// Run: node tests/shiftAdditionalCash.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import type { Shift } from '../src/api/shiftTransport.ts'
import { shiftRegisteredRows, type ShiftFiguresShape } from '../src/components/shifts/shiftReportModel.ts'

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const enText = read('../src/lang/en.json')
const kmText = read('../src/lang/km.json')
const en = JSON.parse(enText) as Record<string, string>
const km = JSON.parse(kmText) as Record<string, string>

const figuresWith = (additional?: { usd: number; khr: number }): ShiftFiguresShape => ({
  opening: { usd: 10, khr: 40000 },
  ...(additional ? { additional_cash: additional } : {}),
  closing: { usd: 0, khr: 0 },
  sales_usd: 0,
  cogs_usd: 0,
  profit_usd: 0,
  delivery_fee_usd: 0,
  credit_usd: 0,
  refunds_usd: 0,
  delivery_cost: { usd: 0, khr: 0 },
  other_expenses: { usd: 0, khr: 0 },
})
const shiftWith = (figures: ShiftFiguresShape): Shift => ({ shift_code: 'S-1', figures } as unknown as Shift)

// ---- order ----------------------------------------------------------------

test('registration rows run opening -> additional -> closing', () => {
  // The owner's own case: the float was spent to zero, 10,000៛ more change
  // went in and was spent too, so the CLOSING count is the smallest number of
  // the three. An implementation that appends the additional last would order
  // these rows identically by value -- only the keys discriminate.
  const rows = shiftRegisteredRows(shiftWith(figuresWith({ usd: 0, khr: 10000 })))
  assert.deepEqual(rows.map((row) => row.key), [
    'shift_registered_open', 'shift_recon_additional_cash', 'shift_registered_end',
  ])
  assert.equal(rows[1].khr, 10000, 'the middle row carries the additional, not the closing count')
  assert.equal(rows[2].khr, 0, 'the closing count stays last even when it is zero')
  assert.equal(rows[1].added, true, 'only the additional row is rendered as an inflow (+)')
  assert.equal(rows[0].added, undefined)
})

test('a shift that never needed more change prints only open and end', () => {
  for (const figures of [figuresWith(), figuresWith({ usd: 0, khr: 0 })]) {
    assert.deepEqual(shiftRegisteredRows(shiftWith(figures)).map((row) => row.key), [
      'shift_registered_open', 'shift_registered_end',
    ])
  }
})

test('the figures block and the Reports export share that one order', () => {
  for (const rel of ['../src/components/shifts/ShiftReportFigures.tsx', '../src/components/sales/reports/ShiftReport.tsx']) {
    const source = read(rel)
    assert.match(source, /shiftRegisteredRows\(shift\)/, `${rel} reads the shared row order`)
    assert.doesNotMatch(source, /shift_registered_end[\s\S]*shift_recon_additional_cash/, `${rel} must not hand-order the additional after END again`)
  }
})

test('the POS close form asks for the additional before the counted drawer', () => {
  const gate = read('../src/components/pos/ShiftGate.tsx')
  const additional = gate.indexOf("label={t('shift_additional_cash')}")
  const counted = gate.indexOf("label={t('shift_counted_cash')}")
  assert.ok(additional > 0 && counted > additional, 'the additional pair renders before the closing count')
  // The first field of the form is the one that takes the focus, so the
  // cashier is not typed into a field the form already scrolled past.
  assert.match(gate.slice(gate.lastIndexOf('<ShiftCountPair', additional), additional), /autoFocus/)
  assert.doesNotMatch(gate.slice(gate.lastIndexOf('<ShiftCountPair', counted), counted), /autoFocus/)
  // ... and the post-close summary chain reads in the same direction.
  const openedWith = gate.indexOf("t('shift_opened_with')")
  const additionalFact = gate.indexOf("t('shift_recon_additional_cash')")
  const countedFact = gate.indexOf("t('shift_counted_close')")
  assert.ok(openedWith > 0 && openedWith < additionalFact && additionalFact < countedFact,
    'the summary strip runs Opened with -> Additional change used -> Counted at close')
})

test('the Shifts popup amend and historic-close forms use the same order', () => {
  const modal = read('../src/components/shifts/ShiftHistoryModal.tsx')
  for (const draft of ['edit', 'close']) {
    const additional = modal.indexOf(`usd={${draft}.additionalUsd}`)
    const counted = modal.indexOf(`usd={${draft}.closingUsd}`)
    assert.ok(additional > 0 && counted > additional, `the ${draft} form asks for the additional first`)
  }
})

// ---- wording --------------------------------------------------------------

test('the form label, the report row and the breakdown say one thing, in both packs', () => {
  for (const [lang, pack] of [['en', en], ['km', km]] as const) {
    assert.equal(pack.shift_additional_cash, pack.shift_recon_additional_cash,
      `${lang}: the close form and the report/breakdown row must not say different things`)
  }
  assert.equal(en.shift_additional_cash, 'Additional change used')
  assert.equal(km.shift_additional_cash, 'ប្រាក់អាប់បន្ថែមដែលបានប្រើ')
  // The Khmer reuses the packs' own word for change money rather than minting
  // a rival one, and repeats the label's verb on the two inputs.
  assert.equal(km.change, 'ប្រាក់អាប់')
  assert.ok(km.shift_additional_cash.includes(km.change))
  for (const key of ['shift_additional_usd', 'shift_additional_khr']) {
    assert.ok(km[key].includes('បានប្រើ'), `km ${key} says used, like its label`)
  }
  assert.match(en.shift_additional_usd, /USD/)
  assert.match(en.shift_additional_khr, /KHR/)
})

test('the hint carries the owner\'s example and the report-only rule', () => {
  for (const hint of [en.shift_additional_cash_hint, km.shift_additional_cash_hint]) {
    assert.ok(hint.includes('10,000'), 'the hint shows the opening-spent-then-topped-up example')
    assert.ok(/0/.test(hint), 'and the closing 0 that goes with it')
  }
  assert.match(en.shift_additional_cash_hint, /Report only/)
  assert.match(en.shift_additional_cash_hint, /never changes sales/)
  assert.ok(km.shift_additional_cash_hint.includes('សម្រាប់របាយការណ៍តែប៉ុណ្ណោះ'))
  // The difference formula names the same term as the field it sums.
  assert.match(en.shift_difference_hint, /additional change used/)
  assert.ok(km.shift_difference_hint.includes(km.shift_additional_cash))
})

test('the retired "added" wording is gone from both packs and both fallbacks', () => {
  for (const retired of ['Additional cash added', 'USD added', 'KHR added', 'Additional cash']) {
    assert.ok(!enText.includes(retired), `en.json still contains the retired "${retired}"`)
  }
  for (const retired of ['សាច់ប្រាក់បន្ថែមចូលថត', 'បន្ថែម USD', 'បន្ថែម KHR', 'សាច់ប្រាក់បន្ថែម']) {
    assert.ok(!kmText.includes(retired), `km.json still contains the retired "${retired}"`)
  }
  // Inline English fallbacks shadow the pack when a key is missing, so they
  // are a surface of their own.
  for (const rel of [
    '../src/components/pos/ShiftGate.tsx',
    '../src/components/shifts/ShiftHistoryModal.tsx',
    '../src/components/shifts/ShiftReportFigures.tsx',
    '../src/components/shifts/ShiftCashBreakdown.tsx',
    '../src/components/shifts/shiftReportModel.ts',
    '../src/components/sales/reports/ShiftReport.tsx',
  ]) {
    assert.doesNotMatch(read(rel), /Additional cash|cash added/i, `${rel} still carries the retired wording`)
  }
})
