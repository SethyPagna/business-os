import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import type { Shift } from '../src/api/shiftTransport.ts'
import {
  shiftCountedPairText,
  shiftFigureRows,
  shiftFiguresOf,
  shiftRegisteredCash,
  type ShiftFiguresShape,
} from '../src/components/shifts/shiftReportModel.ts'

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
  assert.match(gate, /const endBlocker = closingCountInvalid\(countedUsd\).*\? 'invalid'/)
  assert.doesNotMatch(gate, /const endBlocker = shiftCountPairBlocker\(countedUsd, countedKhr\)/)
  assert.match(gate, /shiftCountedPairText\(closed\.closing_counted_usd, closed\.closing_counted_khr, fmtUSD, fmtKHR\)/)
  assert.doesNotMatch(gate, /value: money\(closed\.closing_counted_usd/)
})
