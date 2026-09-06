// N38. THE IN-APP SHIFT REPORT: registered cash open vs end, then the money.
//
// Owner, Sep 6 2026: "for reports of shift, you didn't mention the registered
// cash dollar and khr in open vs end. it should", and "no need detailed
// breakdown of refunds etc... only show expenses like delivery and other
// expenses just for visual without making it a necessity to match the
// expected... just the COGS, profit, sales, expenses, delivery etc."
//
// What this pins, and why each one is not obvious:
//
//   1. THE REGISTRATION IS FOUR NUMBERS, NOT TWO. Open and end, USD and KHR,
//      each independently present. At 01f0c93c the summary printed the closing
//      pair as a single "—" the moment EITHER currency was null, so a cashier
//      who counted $61.25 and left the riel blank saw nothing at all -- their
//      own number, thrown away on screen. shiftCountedPairText is the one rule
//      now, and the three surfaces that print a counted drawer all call it.
//   2. THE MONEY BLOCK IS A FIXED, SHORT LIST. Sales, COGS, profit, delivery
//      fees, delivery cost, other expenses, ONE refunds line, and credit last
//      as a note. No per-return breakdown exists, and credit is floored at
//      zero and subtracted from nothing.
//   3. THE DIFFERENCE IS INFORMATION, NOT A VERDICT. The drawer difference
//      used to be painted red / amber / green -- a pass/fail grade on a number
//      that gates nothing. It is now neutral, with a hint that says so.
//   4. BOTH PACKS carry every new key, in real Khmer.
//
// The row model lives in src/utils/shiftReportModel.ts precisely so this test
// can EXECUTE it rather than pattern-match JSX; the component checks below are
// only about which surface consumes it.
//
// Run: node tests/shiftReport.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  shiftCountText,
  shiftCountedPairText,
  shiftFigureRows,
  shiftRegisteredCash,
} from '../src/utils/shiftReportModel.ts'
import type { Shift, ShiftFigures } from '../src/api/shiftTransport.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')
const summary = read('src/components/shifts/ShiftSummary.tsx')
const breakdown = read('src/components/shifts/ShiftCashBreakdown.tsx')
const report = read('src/components/shifts/ShiftReportFigures.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

let checks = 0
const ok = (cond: unknown, label: string) => {
  assert.ok(cond, label)
  checks += 1
  console.log(`  ok - ${label}`)
}

const usd = (value: unknown) => `$${Number(value).toFixed(2)}`
const khr = (value: unknown) => `${Number(value).toLocaleString('en-US')}៛`

const FIGURES: ShiftFigures = {
  opening: { usd: 50, khr: 100_000 },
  closing: { usd: 61.25, khr: null },
  sales_usd: 312.5,
  cogs_usd: 190.25,
  profit_usd: 122.25,
  delivery_fee_usd: 14,
  credit_usd: 47.5,
  refunds_usd: 8.75,
  delivery_cost: { usd: 8, khr: 16_000 },
  other_expenses: { usd: 4, khr: 20_000 },
}
const SHIFT = {
  opening_float_usd: 50,
  opening_float_khr: 100_000,
  closing_counted_usd: 61.25,
  closing_counted_khr: null,
} as unknown as Shift

// ---- 1. A half-counted drawer keeps the half that was counted -------------
// EXECUTED, and discriminating by value: the old rule collapsed this whole
// pair to '—' the moment one currency was null.
assert.equal(shiftCountedPairText(61.25, null, usd, khr), '$61.25 · —')
assert.equal(shiftCountedPairText(null, 150_000, usd, khr), '— · 150,000៛')
assert.equal(shiftCountedPairText(61.25, 150_000, usd, khr), '$61.25 · 150,000៛')
assert.equal(shiftCountedPairText(null, null, usd, khr), '—')
assert.equal(shiftCountedPairText(0, null, usd, khr), '$0.00 · —')
// THE DISCRIMINATOR, named and excluded by value: this is what ShiftSummary
// and ShiftCashBreakdown computed at 01f0c93c.
const legacyPair = (u: number | null, k: number | null) => u == null || k == null ? '—' : `${usd(u)} · ${khr(k)}`
assert.equal(legacyPair(61.25, null), '—')
assert.notEqual(shiftCountedPairText(61.25, null, usd, khr), legacyPair(61.25, null),
  'the counted dollars are still being thrown away because the riel side was blank')
assert.equal(shiftCountedPairText(61.25, 150_000, usd, khr), legacyPair(61.25, 150_000),
  'a fully counted drawer must read exactly as it always did')
ok(true, 'a drawer counted in one currency prints that currency; only a wholly uncounted drawer is one dash')
assert.equal(shiftCountText(null, usd), '—')
assert.equal(shiftCountText(0, usd), '$0.00',
  'a counted zero is a counted zero -- "the till held nothing" is not "nobody counted the till"')
checks += 1
console.log('  ok - a counted zero is never mistaken for an uncounted drawer')

// ---- 2. Registered cash: four numbers, open vs end ------------------------
{
  const fromRow = shiftRegisteredCash(SHIFT)
  assert.deepEqual(fromRow.open, { usd: 50, khr: 100_000 })
  assert.deepEqual(fromRow.end, { usd: 61.25, khr: null })
  ok(true, 'the registration reads off the shift row, so it renders without the server pricing the shift')

  const priced = shiftRegisteredCash({ ...SHIFT, figures: { ...FIGURES, opening: { usd: 7, khr: 8 } } } as Shift)
  assert.deepEqual(priced.open, { usd: 7, khr: 8 }, "the server's report copy wins when it is present")
  checks += 1
  console.log("  ok - the server's figures win over the row when both are present")
}

// ---- 3. The money block ---------------------------------------------------
{
  const rows = shiftFigureRows(FIGURES)
  assert.deepEqual(rows.map((row) => row.key), [
    'sales', 'cogs', 'profit', 'delivery_fees', 'delivery_actual_cost',
    'shift_other_expenses', 'refunds', 'credit_awaiting_payment',
  ], 'sold, cost, made, then what went out, then the notes')
  ok(true, 'the money block is sales, COGS, profit, delivery fees, delivery cost, other expenses, refunds and credit')

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
  assert.equal(byKey.sales.usd, 312.5)
  assert.equal(byKey.cogs.usd, 190.25)
  assert.equal(byKey.profit.usd, 122.25)
  assert.equal(byKey.delivery_fees.usd, 14)
  assert.deepEqual({ usd: byKey.delivery_actual_cost.usd, khr: byKey.delivery_actual_cost.khr }, { usd: 8, khr: 16_000 })
  assert.deepEqual({ usd: byKey.shift_other_expenses.usd, khr: byKey.shift_other_expenses.khr }, { usd: 4, khr: 20_000 })
  ok(true, 'the expense split prints both currencies; the kernel figures stay on their dollar basis')

  // ONE refunds line. A per-return breakdown was explicitly not wanted.
  assert.equal(rows.filter((row) => row.key === 'refunds').length, 1)
  assert.equal(byKey.refunds.usd, 8.75)
  ok(true, 'refunds are one total line, with no per-return breakdown')

  // Credit: last, positive, never subtracted.
  assert.equal(rows[rows.length - 1].key, 'credit_awaiting_payment')
  assert.equal(byKey.credit_awaiting_payment.usd, 47.5)
  assert.equal(byKey.credit_awaiting_payment.hintKey, 'shift_credit_hint')
  const negative = shiftFigureRows({ ...FIGURES, credit_usd: -12 })
  assert.equal(negative.find((row) => row.key === 'credit_awaiting_payment')?.usd, 0,
    'a negative amount owed is a data defect, never printed as negative money')
  assert.equal(negative.find((row) => row.key === 'profit')?.usd, FIGURES.profit_usd,
    'credit moves nothing else -- it is already inside sales and profit')
  ok(true, 'credit is a positive note, floored at zero, subtracted from nothing')

  assert.deepEqual(shiftFigureRows(null), [], 'a caller the server did not price for gets no money block')
  assert.deepEqual(shiftFigureRows(undefined), [])
  checks += 1
  console.log('  ok - no figures means no money block, not zeroes')
}

// ---- 4. The surfaces consume the shared model -----------------------------
ok(/from '\.\.\/\.\.\/utils\/shiftReportModel\.ts'/.test(report)
  && /shiftRegisteredCash\(shift\)/.test(report) && /shiftFigureRows\(shift\.figures\)/.test(report),
  'the report block renders the shared model rather than ordering rows of its own')
ok(/<ShiftReportFigures shift=\{shift\} \/>/.test(summary),
  'the shift summary detail renders the report block')
ok(/shiftCountedPairText\(shift\.closing_counted_usd, shift\.closing_counted_khr/.test(summary),
  'the summary header prints the counted drawer through the shared rule')
ok(/shiftCountedPairText\(usd, khr, fmtUSD, fmtKHR\)/.test(breakdown),
  'the cash breakdown prints the counted drawer through the same rule')

// ---- 5. The difference is informational, not a verdict --------------------
{
  // The row only -- the review warning below the list keeps its amber, which
  // is a stated data problem rather than a grade on the cashier.
  const differenceRow = breakdown.slice(breakdown.indexOf("t('shift_difference')"), breakdown.indexOf('</dl>'))
  ok(!/text-(red|green|amber)-/.test(differenceRow),
    'the drawer difference is no longer painted as pass/fail')
  ok(/shift_difference_informational/.test(breakdown),
    'the difference carries a hint saying it is for the record only')
  // The information itself must survive the downgrade.
  ok(/signed\(reconciliation\.difference\.usd, fmtUSD\)/.test(breakdown),
    'the signed difference is still shown for both currencies')
}

// ---- 6. Both packs --------------------------------------------------------
for (const key of [
  'shift_registered_cash', 'shift_registered_cash_hint', 'shift_registered_open', 'shift_registered_end',
  'shift_report_figures', 'shift_other_expenses', 'shift_credit_hint', 'shift_difference_informational',
]) {
  ok(typeof en[key] === 'string' && en[key].length > 0, `en.json carries ${key}`)
  ok(typeof km[key] === 'string' && /[ក-៿]/.test(km[key]), `km.json carries ${key} in Khmer`)
}
// The credit line reuses the existing pack key rather than minting a rival.
ok(typeof en.credit_awaiting_payment === 'string' && typeof km.credit_awaiting_payment === 'string',
  'the credit note reuses the existing credit key')

console.log(`\nshiftReport: all ${checks} checks passed`)
