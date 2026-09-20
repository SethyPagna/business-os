import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import type { Shift } from '../src/api/shiftTransport.ts'
import {
  shiftCountedPairText,
  shiftComparisonRows,
  shiftFigureRows,
  shiftFiguresOf,
  shiftRegisteredCash,
  type ShiftFiguresShape,
} from '../src/components/shifts/shiftReportModel.ts'

test('comparison export preserves the authorized server numbers and nulls, including refunds', () => {
  assert.deepEqual(shiftComparisonRows({ reconciliation: null }), [])
  const reconciliation = {
    opening: { usd: 50, khr: null }, additional_cash: { usd: 5, khr: 0 },
    cash_sales: { usd: 40, khr: 8000 }, refunds: { usd: 6, khr: 2000 },
    expenses: { usd: 4, khr: 1000 }, courier: { usd: 3, khr: 500 },
    expected: { usd: 82, khr: null }, counted: { usd: 70, khr: null },
    difference: { usd: -12, khr: null }, needs_review: false, review_codes: [],
  }
  const rows = shiftComparisonRows({ reconciliation })
  assert.equal(rows.find((row) => row.key === 'refunds')?.usd, -6)
  assert.equal(rows.find((row) => row.key === 'fees')?.usd, -4)
  assert.equal(rows.find((row) => row.key === 'shift_recon_expected')?.usd, 82)
  assert.deepEqual(rows.at(-1), { key: 'shift_difference', usd: -12, khr: null })
  assert.equal(reconciliation.refunds.usd, 6, 'presentation never mutates the server accounting payload')
})

test('Reports uses authorized selection/detail and shared comparison rows rather than current-shift polling', () => {
  const report = fs.readFileSync(new URL('../src/components/sales/reports/ShiftReport.tsx', import.meta.url), 'utf8')
  const breakdown = fs.readFileSync(new URL('../src/components/shifts/ShiftCashBreakdown.tsx', import.meta.url), 'utf8')
  assert.match(report, /listShifts\(/)
  assert.match(report, /fetchShiftHistory\(selectedId!/)
  assert.doesNotMatch(report, /fetchCurrentShift/)
  assert.match(report, /shiftComparisonRows\(shift\)/)
  assert.match(breakdown, /shiftComparisonRows\(\{ reconciliation \}\)/)
  assert.match(report, /isAdminControlUser\(user\)/, 'cached admin response is gated after permission revocation')
})

const figures: ShiftFiguresShape = {
  opening: { usd: 10, khr: 40000 },
  closing: { usd: null, khr: 81000 },
  sales_usd: 100,
  cogs_usd: 40,
  profit_usd: 58,
  delivery_fee_usd: 3,
  credit_usd: 12,
  refunds_usd: 5,
  delivery_cost: { usd: 2, khr: 0 },
  other_expenses: { usd: 1, khr: 4000 },
}

const shift = {
  shift_code: 'S-1',
  opening_float_usd: 999,
  opening_float_khr: 999,
  closing_counted_usd: 999,
  closing_counted_khr: 999,
  figures,
} as unknown as Shift

test('registered OPEN and END prefer the report payload and preserve unknown counts', () => {
  assert.deepEqual(shiftRegisteredCash(shift), {
    open: { usd: 10, khr: 40000 },
    end: { usd: null, khr: 81000 },
  })
  assert.equal(shiftCountedPairText(null, null, String, String), '—')
  assert.equal(shiftCountedPairText(null, 81000, String, String), '— · 81000')
})

test('business rows exclude drawer counts and keep Credit positive once', () => {
  const rows = shiftFigureRows(shiftFiguresOf(shift))
  assert.deepEqual(rows.map((row) => row.key), [
    'sales', 'cogs', 'profit', 'delivery_fees', 'delivery_actual_cost',
    'shift_other_expenses', 'refunds', 'credit_awaiting_payment',
  ])
  assert.equal(rows.find((row) => row.key === 'credit_awaiting_payment')?.usd, 12)
  assert.equal(rows.filter((row) => row.key === 'credit_awaiting_payment').length, 1)
  assert.equal(rows.find((row) => row.key === 'profit')?.tone, 'positive')
  assert.ok(rows.every((row) => row.usd !== 999), 'registered drawer counts never enter business rows')
})

test('removal losses are three rows directly below unpaid, omitted when the Worker sent none', () => {
  // Owner, Sep 14 2026: "also add one row below unpaid in reports as well."
  const rows = shiftFigureRows({ ...figures, removal_loss_usd: 30, revenue_after_losses_usd: 70, profit_after_losses_usd: -2 })
  assert.deepEqual(rows.map((row) => row.key), [
    'sales', 'cogs', 'profit', 'delivery_fees', 'delivery_actual_cost',
    'shift_other_expenses', 'refunds', 'credit_awaiting_payment',
    'rpt_removal_loss', 'rpt_revenue_after_losses', 'rpt_profit_after_losses',
  ])
  // The canonical figures above stay exactly what they were.
  assert.equal(rows.find((row) => row.key === 'sales')?.usd, 100)
  assert.equal(rows.find((row) => row.key === 'profit')?.usd, 58)
  assert.equal(rows.find((row) => row.key === 'rpt_removal_loss')?.usd, 30)
  assert.equal(rows.find((row) => row.key === 'rpt_revenue_after_losses')?.usd, 70)
  // Unclamped: a shift that destroyed more than it earned must be visible.
  assert.equal(rows.find((row) => row.key === 'rpt_profit_after_losses')?.usd, -2)
  assert.equal(rows.find((row) => row.key === 'rpt_profit_after_losses')?.tone, 'negative')

  // Absence is the contract -- no keys means no rows, not three $0.00 rows.
  assert.equal(shiftFigureRows(figures).filter((row) => row.key.startsWith('rpt_')).length, 0)
})

test('the removal-loss row carries unvaluedCount only when the Worker reports unpriced rows', () => {
  // p5/losses (Sep 15 2026, owner: "i see the report says row removed has 1
  // no cost price. this is impossible find issue and fix"). The row's
  // unvaluedCount must be PRESENT (and equal to the reported count) when
  // removal_loss_unvalued_rows > 0, and ABSENT (not 0, not undefined-but-
  // truthy) when it is 0 or omitted -- a naive `unvaluedCount:
  // figures.removal_loss_unvalued_rows` would instead set the key to 0 and
  // ShiftReportFigures.tsx's `row.unvaluedCount ? ... : null` would still
  // correctly hide it, but a naive `??` default of some non-zero sentinel
  // would not, so this pins the actual reported number end to end.
  const withUnvalued = shiftFigureRows({
    ...figures, removal_loss_usd: 30, revenue_after_losses_usd: 70,
    profit_after_losses_usd: -2, removal_loss_unvalued_rows: 1,
  })
  assert.equal(withUnvalued.find((row) => row.key === 'rpt_removal_loss')?.unvaluedCount, 1)

  const zeroUnvalued = shiftFigureRows({
    ...figures, removal_loss_usd: 30, revenue_after_losses_usd: 70,
    profit_after_losses_usd: -2, removal_loss_unvalued_rows: 0,
  })
  assert.equal(zeroUnvalued.find((row) => row.key === 'rpt_removal_loss')?.unvaluedCount, undefined)

  const noFieldSent = shiftFigureRows({ ...figures, removal_loss_usd: 30, revenue_after_losses_usd: 70, profit_after_losses_usd: -2 })
  assert.equal(noFieldSent.find((row) => row.key === 'rpt_removal_loss')?.unvaluedCount, undefined)
})

test('negative stale Credit is floored without changing any other figure', () => {
  const rows = shiftFigureRows({ ...figures, credit_usd: -4 })
  assert.equal(rows.find((row) => row.key === 'credit_awaiting_payment')?.usd, 0)
  assert.equal(rows.find((row) => row.key === 'profit')?.usd, 58)
})

test('Shift is a selectable report with its own CSV and print actions', () => {
  const hub = fs.readFileSync(new URL('../src/components/sales/ReportsHub.tsx', import.meta.url), 'utf8')
  const model = fs.readFileSync(new URL('../src/components/sales/reports/reportModel.ts', import.meta.url), 'utf8')
  const report = fs.readFileSync(new URL('../src/components/sales/reports/ShiftReport.tsx', import.meta.url), 'utf8')
  assert.match(model, /id: 'shift'.*labelKey: 'shift_report'/)
  assert.match(hub, /view\.id === 'shift' \? <ShiftReport/)
  assert.doesNotMatch(hub, /CurrentShiftSummary|ShiftHistoryPanel/, 'shift blocks are not mounted below every report')
  assert.match(report, /downloadCSV\(/)
  assert.match(report, /openPrintExport\(/)
  assert.match(report, /ShiftHistoryPanel/)
})

test('blank closing counts do not disable the history close action', () => {
  const modal = fs.readFileSync(new URL('../src/components/shifts/ShiftHistoryModal.tsx', import.meta.url), 'utf8')
  assert.match(modal, /shiftClosingCounts\(close\.closingUsd, close\.closingKhr\)/)
  assert.doesNotMatch(modal, /shiftCountPairBlocker\(close\.closingUsd, close\.closingKhr\)/)
  assert.match(modal, /const closeReason = !close\.closedAt/)
})

test('blank closing counts do not disable POS close or print an invented zero drawer', () => {
  const gate = fs.readFileSync(new URL('../src/components/pos/ShiftGate.tsx', import.meta.url), 'utf8')
  assert.match(gate, /shiftClosingCounts\(countedUsd, countedKhr\)/)
  assert.match(gate, /const endBlocker = closingCountInvalid\(countedUsd\)/)
  assert.doesNotMatch(gate, /const endBlocker = shiftCountPairBlocker\(countedUsd, countedKhr\)/)
  assert.match(gate, /shiftCountedPairText\(closed\.closing_counted_usd, closed\.closing_counted_khr, fmtUSD, fmtKHR\)/)
  assert.doesNotMatch(gate, /value: money\(closed\.closing_counted_usd/)
})
