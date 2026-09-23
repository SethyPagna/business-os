import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { transformSync } from 'esbuild'
import type { Shift } from '../src/api/shiftTransport.ts'
import {
  shiftCountedPairText,
  shiftComparisonRows,
  shiftFigureRows,
  shiftFiguresOf,
  shiftRegisteredCash,
  type ShiftFiguresShape,
} from '../src/components/shifts/shiftReportModel.ts'

test('mounted Shift selection pages beyond200 and revokes old detail before date/page effects', async () => {
  const require = createRequire(import.meta.url)
  const slots: any[] = []
  let cursor = 0
  let writes = 0
  let pending: Array<() => void> = []
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next: any) => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { fn, deps }; return slots[i].fn },
    useMemo(fn: any) { return fn() },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const frameSource = fs.readFileSync(new URL('../src/components/sales/reports/ReportFrame.tsx', import.meta.url), 'utf8')
  const hookBody = frameSource.slice(frameSource.indexOf('export function useReportData')).replace('export function', 'function')
  const useReportData = new Function('useState', 'useRef', 'useCallback', 'useEffect', `${stripTypeScriptTypes(hookBody)}; return useReportData`)(hooks.useState, hooks.useRef, hooks.useCallback, hooks.useEffect)
  const Frame = 'ReportFrame', Pager = 'Pager', Summary = 'Summary'
  const listCalls: any[] = [], detailCalls: number[] = [], exports: any[] = []
  let lateResolve: (value: any) => void = () => {}
  let holdDetail = false
  let user: any = { id: 1, role_code: 'admin' }
  const shift = (id: number) => ({ id, shift_code: `S-${id}`, business_date: '2020-01-01', opening_float_usd: id, opening_float_khr: null, closing_counted_usd: null, closing_counted_khr: null })
  const mod: any = { exports: {} }
  const reportSource = fs.readFileSync(new URL('../src/components/sales/reports/ShiftReport.tsx', import.meta.url), 'utf8')
  new Function('require', 'module', 'exports', transformSync(reportSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    if (id.includes('ReportFrame')) return { __esModule: true, default: Frame, useReportData }
    if (id.includes('PaginationControls')) return { __esModule: true, default: Pager, DEFAULT_PAGE_SIZE: 20 }
    if (id.includes('AppContext')) return { useApp: () => ({ user }) }
    if (id.includes('permissions')) return { isAdminControlUser: (u: any) => u.role_code === 'admin' }
    // The search pause is not under test here (shiftReportSearch.test.ts
    // drives it); these scenarios never type, so the value passes through.
    if (id.includes('useDebouncedValue')) return { useDebouncedValue: (value: unknown) => value }
    if (id.includes('formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('shiftTransport')) return {
      listShifts: async (input: any) => { listCalls.push(input); return { shifts: [shift(input.page === 1 ? 1 : 250)], page: input.page, total: 275, page_size: 20 } },
      fetchShiftHistory: async (id: number) => { detailCalls.push(id); return holdDetail ? new Promise((resolve) => { lateResolve = resolve }) : { shift: shift(id) } },
    }
    if (id.includes('shiftReportModel')) return require('../src/components/shifts/shiftReportModel.ts')
    if (id.includes('ShiftSummary')) return { __esModule: true, default: Summary }
    if (id.includes('reportModel')) return { reportFileName: (name: string) => name }
    if (id.includes('reportTypes')) return { exportMenuItems: (_t: any, _can: any, csv: any) => [{ onClick: csv }] }
    if (id.includes('/csv')) return { downloadCSV: (...args: any[]) => exports.push(args) }
    if (id.includes('ShiftGate')) return { SHIFT_STATE_CHANGED_EVENT: 'shift:test' }
    if (id.includes('/kit')) return { OverflowMenu: 'Menu', Skeleton: 'Skeleton', EmptyState: 'Empty' }
    return { default: id }
  }, mod, mod.exports)
  const oldWindow = globalThis.window
  globalThis.window = new EventTarget() as any
  const props: any = { filters: { startDate: '', endDate: '', branchId: '' }, tr: (key: string) => key, view: { labelKey: 'shift', fallback: 'Shift' }, canExport: () => true }
  const render = () => { cursor = 0; return mod.exports.default(props) }
  const settle = async () => { for (let i = 0; i < 6; i++) { render(); const jobs = pending; pending = []; jobs.forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)) } return render() }
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  try {
    let tree = await settle()
    assert.equal(nodes(tree).find((n) => n.type === Summary).props.shift.id, 1)
    nodes(tree).find((n) => n.type === Pager).props.onPageChange(13)
    tree = render()
    assert.ok(!nodes(tree).some((n) => n.type === Summary), 'previous detail vanishes in first page-change render')
    tree = await settle()
    assert.equal(listCalls.at(-1).page, 13)
    assert.equal(nodes(tree).find((n) => n.type === Summary).props.shift.id, 250)
    nodes(tree).find((n) => n.type === 'Menu').props.items[0].onClick()
    assert.equal(exports.at(-1)[0], 'shift-S-250', 'older selected shift is exported, not the first page')
    assert.equal(exports.at(-1)[1][0].USD, 250, 'export retains full selected shift registration')
    holdDetail = true
    nodes(tree).find((n) => n.type === Pager).props.onPageChange(2)
    await settle()
    props.filters = { ...props.filters, startDate: '2021-01-01', endDate: '2021-01-01' }
    tree = render()
    lateResolve({ shift: shift(999) })
    holdDetail = false
    tree = await settle()
    assert.equal(listCalls.at(-1).page, 1, 'range change resets page')
    assert.equal(listCalls.at(-1).from, '2021-01-01')
    assert.notEqual(nodes(tree).find((n) => n.type === Summary)?.props.shift.id, 999, 'late previous page cannot replace current detail')
    user = { id: 2, role_code: 'staff' }
    tree = render()
    assert.ok(!nodes(tree).some((n) => n.type === Summary), 'actor change synchronously revokes previous selected detail')
    assert.ok(writes > 0 && detailCalls.includes(250))
  } finally { slots.forEach((slot) => slot?.cleanup?.()); globalThis.window = oldWindow }
})

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
  assert.match(report, /from: filters.startDate, to: filters.endDate/, 'server filters records before applying its limit')
  assert.match(report, /JSON.stringify\(\[branchId, filters.startDate, filters.endDate,/, 'range changes invalidate list, selection and detail scope')
  // S1: a pick is scoped to the dates/branch/actor (depsKey), not to the
  // search page, so searching for the next shift keeps the one on screen;
  // shiftReportSearch.test.ts drives that behaviour and its negative control.
  assert.match(report, /const pickedId = selection\.scope === depsKey \? selection\.id : null/, 'old selection is discarded outside its date, branch and actor scope')
  assert.match(report, /const pageScope = JSON\.stringify\(\[depsKey, query\]\)/, 'a new search restarts paging')
  assert.match(report, /`\$\{listKey\}:\$\{selectedId \?\? ''\}`/, 'detail invalidation includes the same date and page scope')
  assert.match(report, /from: filters.startDate, to: filters.endDate, page, pageSize/)
  assert.match(report, /totalItems=\{listing.data.total \?\? shifts.length\}/)
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
