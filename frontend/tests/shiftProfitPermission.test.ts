// Owner A71 + Q4 (A78): shift profit follows the View product costs grant, and employees see nothing new of shift results.
// ONE helper, shiftFiguresForViewer(shift, user), replaces the isAdminControlUser strips on every shift screen. The user-shape table is the
// Worker's own (cloudflare/scripts/fixtures/shift-profit-permission-cases.json, read by test-shift-profit-permission-pure.cjs), so the screen
// and the Worker cannot disagree on a row.
// Run: node tests/shiftProfitPermission.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Shift } from '../src/api/shiftTransport.ts'
import {
  shiftFigureRows, shiftFiguresForViewer, shiftFiguresWithoutCosts, shiftFiguresOf, shiftComparisonRows, shiftCloseDriftRows,
} from '../src/components/shifts/shiftReportModel.ts'

const cases = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'shift-profit-permission-cases.json'), 'utf8'))
const COST_KEYS = ['cogs_usd', 'profit_usd', 'profit_without_not_paid_usd', 'cost_missing_snapshot_lines', 'removal_loss_usd', 'revenue_after_losses_usd', 'profit_after_losses_usd', 'removal_loss_unvalued_rows']

const pair = { usd: 0, khr: 0 }
const full = {
  id: 1, shift_code: 'S-1', opening_float_usd: 10, opening_float_khr: 0, additional_cash_usd: 0, additional_cash_khr: 0, closing_counted_usd: 120, closing_counted_khr: 0,
  closed_at: '2026-11-20T10:00:00.000Z', reconciliation_source: 'stored',
  reconciliation: {
    opening: { usd: 10, khr: 0 }, additional_cash: pair, cash_sales: { usd: 100, khr: 0 }, refunds: pair, expenses: pair, courier: pair,
    expected: { usd: 110, khr: 0 }, counted: { usd: 120, khr: 0 }, difference: { usd: 10, khr: 0 }, needs_review: false, review_codes: [],
  },
  close_drift: { components: [{ key: 'cash_sales', stored: { usd: 100, khr: 0 }, current: { usd: 90, khr: 0 } }], sales: [], sales_total: 0, sales_unavailable: false },
  figures: {
    opening: { usd: 10, khr: 0 }, additional_cash: pair, closing: { usd: 120, khr: 0 }, sales_usd: 100, cogs_usd: 60, profit_usd: 40, sales_without_not_paid_usd: 95,
    profit_without_not_paid_usd: 37, cost_missing_snapshot_lines: 2, delivery_fee_usd: 3, credit_usd: 5, refunds_usd: 1, delivery_cost: pair, other_expenses: pair,
    removal_loss_usd: 4, revenue_after_losses_usd: 96, profit_after_losses_usd: 36, removal_loss_unvalued_rows: 1,
  },
} as unknown as Shift
const serialized = (value: unknown) => JSON.stringify(value)
const userOf = (row: any) => ({ role_code: row.role_code, role_permissions: row.role_permissions, permissions: row.permissions })

assert.ok(cases.users.length >= 8)
for (const row of cases.users) {
  const seen = shiftFiguresForViewer(full, userOf(row)) as any
  // Business results block.
  assert.equal(seen.figures != null, row.figures, `${row.name}: Business results block`)
  // Cost keys: only with the block AND the grant, absent (not zero) otherwise.
  for (const key of COST_KEYS) assert.equal(seen.figures != null && Object.hasOwn(seen.figures, key), row.figures && row.grant, `${row.name}: ${key}`)
  // The cash comparison and what changed after close: administrator only.
  assert.equal(seen.reconciliation != null, row.drawer, `${row.name}: cash breakdown`)
  assert.equal(seen.close_drift != null, row.drawer, `${row.name}: changed after close`)
  // The three rows every surface prints (card, detail, print and CSV) come from this one view.
  const rowKeys = shiftFigureRows(shiftFiguresOf(seen)).map((r) => r.key)
  for (const key of ['cogs', 'profit', 'profit_paid_only', 'rpt_removal_loss', 'rpt_profit_after_losses']) assert.equal(rowKeys.includes(key), row.figures && row.grant, `${row.name}: row ${key}`)
  assert.equal(rowKeys.includes('sales'), row.figures, `${row.name}: sales row follows the block`)
  assert.equal(shiftComparisonRows(seen).length > 0, row.drawer, `${row.name}: export comparison rows`)
  assert.equal(shiftCloseDriftRows(seen).length > 0, row.drawer, `${row.name}: export drift rows`)
  if (!row.figures) assert.doesNotMatch(serialized(seen), /cogs|profit|removal_loss|revenue_after_losses/, `${row.name}: no cost key anywhere in what the screen holds`)
  // The registered counts stay: they are the person's own drawer.
  assert.equal(seen.opening_float_usd, 10, `${row.name}: own counts stay`)
  assert.equal(seen.closing_counted_usd, 120)
}

// The input is never mutated, and a viewer who may see everything gets the same object back.
{
  const before = serialized(full)
  shiftFiguresForViewer(full, { role_code: 'employee', role_permissions: '{"pos":true}' })
  assert.equal(serialized(full), before, 'input untouched')
  assert.equal(shiftFiguresForViewer(full, { role_code: 'admin' }), full, 'administrator: the received shift itself')
  assert.equal(shiftFiguresForViewer(null, { role_code: 'admin' }), null)
}

// A block that reaches a grant holder without the administrator role (an older cached answer, a future Worker) never shows a drawer it was not
// meant to carry, and the cost keys still follow the grant: strip by grant, not by luck of what the Worker sent.
{
  const seen = shiftFiguresWithoutCosts((full as any).figures) as any
  for (const key of COST_KEYS) assert.equal(Object.hasOwn(seen, key), false, `${key} absent, not zero`)
  assert.equal(seen.sales_usd, 100, 'revenue stays')
  assert.equal(Object.hasOwn((full as any).figures, 'profit_usd'), true, 'input untouched')
  const model = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'components', 'shifts', 'shiftReportModel.ts'), 'utf8')
  assert.match(model, /if \(!figures \|\| holdsCostViewGrant\(user\)\) return shift\s+return \{ \.\.\.shift, figures: shiftFiguresWithoutCosts\(figures\) \}/, 'the cost keys follow the grant, not the role')
}

// No surface strips by role on its own any more: they all go through the helper.
const src = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', rel), 'utf8')
for (const rel of ['components/shifts/ShiftSummary.tsx', 'components/pos/ShiftGate.tsx', 'components/sales/reports/ShiftReport.tsx']) {
  const text = src(rel)
  assert.match(text, /shiftFiguresForViewer\(/, `${rel} uses the helper`)
  assert.doesNotMatch(text, /reconciliation: null, figures: null/, `${rel} has no role strip of its own`)
}

console.log('shiftProfitPermission: all checks passed')
