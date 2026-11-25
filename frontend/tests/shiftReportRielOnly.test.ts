// The Reports shift report on a RIEL-ONLY shift (owner A72 + Q3, A78): riel first, a dollar cell only when the SHIFT has a dollar figure.
//
// shiftReportLateClose opens every shift with $10, so it is always a dollar shift, and shiftRielFirst tests the model helpers directly, not the
// rows the real report builds. This test mounts the REAL ShiftReport (real useReportData body, real formatters, the real shared shift model)
// against a fake history response, runs the CSV and the print export, and reads the columns they receive:
//   * counts only (no reconciliation, no business results): no USD column in the print headers or the CSV keys;
//   * business results present: the USD column stays (business results are dollars) and every PAIR row has a blank USD cell;
//   * a $5 closing count: the pair rows carry dollar cells, riel first (KHR key before USD).
// Mutants of the real source (bottom of the file): `const showUsd = true` in ShiftReport.tsx turns each of the first two red.
//
// Run: node tests/shiftReportRielOnly.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const REPORT = read('components/sales/reports/ShiftReport.tsx')
const MODEL = read('components/shifts/shiftReportModel.ts')
const formatters = require('../src/utils/formatters.ts')

function loadModel(source: string): Record<string, unknown> {
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)((id: string) => require(id.startsWith('../../utils/') ? id.replace('../../utils/', '../src/utils/') : id), mod, mod.exports)
  return mod.exports
}

const CODE = 'S-20261122-0807-Dara'
const baseShift = (patch: Record<string, unknown> = {}) => ({
  id: 31, shift_code: CODE, user_name: 'Dara', branch_name: 'LC Store', business_date: '2026-11-22',
  opened_at: '2026-11-22T01:07:00.000Z', closed_at: '2026-11-22T16:59:59.000Z',
  opening_float_usd: 10, opening_float_khr: 10000, additional_cash_usd: 0, additional_cash_khr: 0,
  closing_counted_usd: null, closing_counted_khr: null, ...patch,
})

function mount(history: { shift: Record<string, unknown>; amendments: unknown[] }, source = REPORT, modelSource = MODEL) {
  const slots: any[] = []
  let cursor = 0
  let pending: Array<() => void> = []
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { fn, deps }; return slots[i].fn },
    useMemo(fn: any) { return fn() },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const frameSource = read('components/sales/reports/ReportFrame.tsx')
  const hookBody = frameSource.slice(frameSource.indexOf('export function useReportData')).replace('export function', 'function')
  const useReportData = new Function('useState', 'useRef', 'useCallback', 'useEffect', `${stripTypeScriptTypes(hookBody)}; return useReportData`)(hooks.useState, hooks.useRef, hooks.useCallback, hooks.useEffect)
  const csv: Array<{ file: string; rows: any[] }> = []
  const prints: any[] = []
  const exportActions: { csv?: () => void; print?: () => void } = {}
  const fetches: string[] = []
  const model = loadModel(modelSource)
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: 'Fragment' }
    if (id.includes('ReportFrame')) return { __esModule: true, default: 'ReportFrame', useReportData }
    if (id.includes('PaginationControls')) return { __esModule: true, default: 'Pager', DEFAULT_PAGE_SIZE: 10 }
    if (id.includes('SuggestionTextInput')) return { __esModule: true, default: 'Picker' }
    if (id.includes('useDebouncedValue')) return { useDebouncedValue: (value: unknown) => value }
    if (id.includes('formatters')) return formatters
    if (id.includes('AppContext')) return { useApp: () => ({ user: { id: 1, role_code: 'admin' } }) }
    if (id.includes('permissions')) return { isAdminControlUser: (u: any) => u.role_code === 'admin' }
    if (id.includes('shiftTransport')) return {
      SHIFT_SEARCH_MAX_LENGTH: 80,
      SHIFT_SEARCH_DEBOUNCE_MS: 250,
      listShifts: async () => { fetches.push('list'); return { shifts: [history.shift], page: 1, total: 1, page_size: 10, scope: 'all' } },
      fetchShiftHistory: async () => { fetches.push('history'); return history },
    }
    if (id.includes('shiftReportModel')) return model
    if (id.includes('ShiftSummary')) return { __esModule: true, default: 'Summary' }
    if (id.includes('ShiftHeaderRow')) return { __esModule: true, default: 'HeaderRow' }
    if (id.includes('ShiftHistoryPanel')) return { __esModule: true, default: 'HistoryPanel' }
    if (id.includes('reportModel')) return { reportFileName: (name: string) => name, reportQueryParams: require('../src/components/sales/reports/reportModel.ts').reportQueryParams }
    if (id.includes('reportTypes')) return { exportMenuItems: (_tr: unknown, _can: unknown, onCsv: () => void, onPrint: () => void) => { exportActions.csv = onCsv; exportActions.print = onPrint; return [] } }
    if (id.includes('/csv')) return { downloadCSV: (file: string, rows: any[]) => { csv.push({ file, rows }) } }
    if (id.includes('exportOptions')) return { openPrintExport: (input: any) => { prints.push(input) } }
    if (id.includes('ShiftGate')) return { SHIFT_STATE_CHANGED_EVENT: 'shift:test' }
    if (id.includes('/kit')) return { Button: 'Button', OverflowMenu: 'Menu', Skeleton: 'Skeleton', EmptyState: 'Empty' }
    return { __esModule: true, default: id }
  }, mod, mod.exports)
  const props: any = { filters: { startDate: '', endDate: '', branchId: '' }, tr: (key: string) => key, view: { labelKey: 'shift', fallback: 'Shift' }, canExport: () => true }
  const render = () => { cursor = 0; return mod.exports.default(props) }
  const settle = async () => { for (let i = 0; i < 8; i++) { render(); const jobs = pending; pending = []; jobs.forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)) } return render() }
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  const find = (tree: any, type: string) => nodes(tree).find((node) => node.type === type)
  const cleanup = () => slots.forEach((slot) => slot?.cleanup?.())
  return { settle, find, nodes, csv, prints, exportActions, fetches, cleanup }
}

async function withWindow<T>(run: () => Promise<T>): Promise<T> {
  const previous = globalThis.window
  globalThis.window = new EventTarget() as any
  try { return await run() } finally { globalThis.window = previous }
}

/** Mounts, settles and runs both exports; returns what the screen, the CSV and the print received. */
async function run(history: { shift: Record<string, unknown>; amendments: unknown[] }, source = REPORT, modelSource = MODEL) {
  return withWindow(async () => {
    const view = mount(history, source, modelSource)
    try {
      const tree = await view.settle()
      view.exportActions.csv?.()
      view.exportActions.print?.()
      const picker = view.find(tree, 'Picker')
      const summary = view.find(tree, 'Summary')
      return { tree, view, picker, summary, csv: view.csv[0], print: view.prints[0] }
    } finally { view.cleanup() }
  })
}

const Z = { usd: 0, khr: 0 }
const RECON = {
  opening: { usd: 0, khr: 100000 }, additional_cash: Z, cash_sales: { usd: 0, khr: 160000 }, refunds: Z, expenses: Z, courier: Z,
  expected: { usd: 0, khr: 260000 }, counted: { usd: 0, khr: 240000 }, difference: { usd: 0, khr: -20000 }, needs_review: false, review_codes: [],
}
const FIGURES = {
  opening: { usd: 0, khr: 100000 }, additional_cash: Z, closing: { usd: 0, khr: 240000 }, sales_usd: 40, cogs_usd: 20, profit_usd: 20,
  sales_without_not_paid_usd: 40, profit_without_not_paid_usd: 20, cost_missing_snapshot_lines: 0, delivery_fee_usd: 2, credit_usd: 0, refunds_usd: 0,
  delivery_cost: Z, other_expenses: Z, removal_loss_usd: 0, revenue_after_losses_usd: 40, profit_after_losses_usd: 20, removal_loss_unvalued_rows: 0,
}
const RIEL = { opening_float_usd: 0, opening_float_khr: 100000, closing_counted_usd: 0, closing_counted_khr: 240000, closed_at: '2026-11-22T10:00:00.000Z' }
const rielHistory = (patch: Record<string, unknown> = {}) => ({ shift: baseShift({ ...RIEL, ...patch }), amendments: [] })
const withResults = { reconciliation: RECON, reconciliation_source: 'stored', figures: FIGURES }

const isPairRow = (row: any) => row.Section !== 'shift_report_figures' || typeof row.KHR === 'number'
const usdCell = (row: any) => row.USD === undefined || row.USD === '' ? '' : row.USD

async function countsOnly(source = REPORT) {
  const got = await run(rielHistory(), source)
  assert.ok(got.csv && got.print, 'the export menu ran the CSV and the print export')
  assert.deepEqual(got.print.headers, ['Section', 'Line', 'KHR'], 'counts only, print: no USD column')
  assert.deepEqual(Object.keys(got.csv.rows[0]), ['Section', 'Line', 'KHR'], 'counts only, CSV: no USD key')
  assert.ok(got.csv.rows.length >= 3, 'the three registered rows are there')
}

async function withBusinessResults(source = REPORT) {
  const got = await run(rielHistory(withResults), source)
  assert.deepEqual(got.print.headers, ['Section', 'Line', 'KHR', 'USD'], 'with business results, print: the USD column stays')
  assert.deepEqual(Object.keys(got.csv.rows[0]), ['Section', 'Line', 'KHR', 'USD'], 'with business results, CSV: the USD key stays')
  const pairRows = got.csv.rows.filter(isPairRow)
  assert.ok(pairRows.length >= 6, 'registered and breakdown pair rows are there')
  assert.deepEqual(pairRows.filter((row: any) => usdCell(row) !== '').map((row: any) => row.Line), [], 'riel-only shift: every pair row has a blank USD cell')
  const business = got.csv.rows.filter((row: any) => row.Section === 'shift_report_figures' && typeof row.USD === 'number')
  assert.ok(business.length >= 4, 'the business results keep their dollar cells')
}

test('a riel-only shift with counts only has no USD column in the print or the CSV', async () => { await countsOnly() })

test('a riel-only shift with business results keeps the USD column, and every pair row has a blank dollar cell', async () => { await withBusinessResults() })

test('a $5 closing count makes the pair rows carry dollar cells, riel first', async () => {
  const got = await run(rielHistory({ closing_counted_usd: 5 }))
  assert.deepEqual(got.print.headers, ['Section', 'Line', 'KHR', 'USD'], 'a dollar shift: the USD column is there')
  assert.deepEqual(Object.keys(got.csv.rows[0]), ['Section', 'Line', 'KHR', 'USD'], 'riel first: KHR before USD')
  const registered = got.csv.rows.filter((row: any) => row.Section === 'shift_registered_cash')
  assert.deepEqual(registered.map((row: any) => row.USD), [0, 0, 5], 'opening, cash used and closing carry their dollar halves: 0, 0, 5')
  assert.deepEqual(registered.map((row: any) => row.KHR), [100000, 0, 240000], 'and their riel halves')
})

// Mutants of the real source: each must turn its own test red.
const mutate = (source: string, from: string, to: string) => {
  assert.ok(source.includes(from), `the mutant target exists: ${from.slice(0, 50)}`)
  return source.replace(from, to)
}
const alwaysDollars = () => mutate(REPORT, 'const showUsd = shiftHasUsd(shift)', 'const showUsd = true')

test('mutant: const showUsd = true in the report rows fails the counts-only test', async () => {
  await assert.rejects(() => countsOnly(alwaysDollars()), /counts only, (print|CSV): no USD/)
})

test('mutant: const showUsd = true in the report rows fails the blank-dollar-cell test', async () => {
  await assert.rejects(() => withBusinessResults(alwaysDollars()), /every pair row has a blank USD cell/)
})
