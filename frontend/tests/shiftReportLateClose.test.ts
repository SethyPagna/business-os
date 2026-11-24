// The Reports shift report for a shift that was closed late (owner A69, A73; board item shiftf1, slice R).
//
// The REAL ShiftReport is mounted (real useReportData body, real formatters, the real shared shift model) against a fake
// history response, and the three promises are read off what it hands to the picker, the card, the CSV and the print:
//   1. a "Closed late" row -- the reason, who closed it and when -- in the CSV and in the print, read from the
//      closed_late entry of the history response the report already holds (no second fetch);
//   2. "Not counted (closed late)" where the closing count is empty because the shift was closed late; a same-day
//      close with no count keeps the plain dash;
//   3. the picker rows are the one shift header row (date . ID . cashier . branch) with the Closed late tag, and the
//      print subtitle reads date . ID . cashier . branch.
// Four mutants of the real source prove each assertion discriminates (see the bottom of the file).
//
// Run: node tests/shiftReportLateClose.test.ts
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
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'ts', format: 'cjs' }).code)((id: string) => require(id), mod, mod.exports)
  return mod.exports
}

const CODE = 'S-20261122-0807-Dara'
const baseShift = (patch: Record<string, unknown> = {}) => ({
  id: 31, shift_code: CODE, user_name: 'Dara', branch_name: 'LC Store', business_date: '2026-11-22',
  opened_at: '2026-11-22T01:07:00.000Z', closed_at: '2026-11-22T16:59:59.000Z',
  opening_float_usd: 10, opening_float_khr: 10000, additional_cash_usd: 0, additional_cash_khr: 0,
  closing_counted_usd: null, closing_counted_khr: null, ...patch,
})
const CLOSED_AT = '2026-11-23T03:30:00.000Z'
const lateRow = {
  id: 7, shift_session_id: 31, actor_user_id: 9, actor_name: 'sokha', reason: 'Late close: Forgot to close', before_json: '{}',
  after_json: JSON.stringify({ revision: 1, time_review: [{ code: 'closed_late', by: 'sokha', reason: 'Forgot to close' }] }), created_at: CLOSED_AT,
}

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

const lateHistory = (shiftPatch: Record<string, unknown> = {}) => ({ shift: baseShift(shiftPatch), amendments: [lateRow] })

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

const closedLateLine = (rows: any[]) => rows.find((row) => row.Section === 'shift_closed_late')?.Line as string | undefined
const endLine = (rows: any[]) => rows.find((row) => row.Line.startsWith('shift_registered_end'))?.Line as string

// 1. The Closed late row.
async function closedLateRow(source = REPORT) {
  const got = await run(lateHistory(), source)
  assert.ok(got.csv, 'the export menu ran the CSV export')
  const csvLine = closedLateLine(got.csv.rows)
  assert.ok(csvLine, 'the CSV has a Closed late row')
  assert.ok(got.print, 'the export menu ran the print export')
  const printLine = closedLateLine(got.print.rows)
  assert.ok(printLine, 'the print has a Closed late row')
  for (const line of [csvLine, printLine]) {
    assert.ok(line!.includes('Forgot to close'), 'the reason is on the row')
    assert.ok(line!.includes('sokha'), 'who closed it is on the row')
    assert.ok(line!.includes(formatters.fmtDateTime24(CLOSED_AT)), 'and when')
  }
  assert.equal(got.summary.props.closedLate, true, 'the card carries the Closed late tag')
  assert.deepEqual(got.view.fetches.filter((name: string) => name === 'history').length > 0 && got.view.fetches.every((name: string) => name === 'list' || name === 'history'), true, 'no fetch beyond the list and the history the report already made')
}

test('a shift closed late has a Closed late row in the CSV and in the print: reason, who, when', async () => { await closedLateRow() })

test('a shift closed on time has no Closed late row and no tag', async () => {
  const got = await run({ shift: baseShift({ closing_counted_usd: 120 }), amendments: [{ ...lateRow, after_json: JSON.stringify({ revision: 1, time_review: [] }) }] })
  assert.equal(closedLateLine(got.csv.rows), undefined)
  assert.equal(closedLateLine(got.print.rows), undefined)
  assert.equal(got.summary.props.closedLate, false)
})

test('the reason is in the print', async () => {
  const got = await run(lateHistory())
  assert.ok(String(closedLateLine(got.print.rows)).includes('Forgot to close'), 'the print row names the reason')
})

// 2. Not counted (closed late).
async function notCounted(modelSource = MODEL) {
  const late = await run(lateHistory(), REPORT, modelSource)
  for (const rows of [late.csv.rows, late.print.rows]) assert.ok(endLine(rows).includes('shift_late_not_counted'), 'a late close with no count says Not counted (closed late)')
  const sameDay = await run({ shift: baseShift(), amendments: [] }, REPORT, modelSource)
  for (const rows of [sameDay.csv.rows, sameDay.print.rows]) {
    assert.equal(endLine(rows), 'shift_registered_end', 'a same-day close with no count keeps today\'s plain line')
    assert.ok(!JSON.stringify(rows).includes('shift_late_not_counted'), 'and never says closed late')
  }
  assert.ok(!sameDay.summary.props.closedLate, 'the card is not told it was late')
  const counted = await run(lateHistory({ closing_counted_usd: 120, closing_counted_khr: 50000 }), REPORT, modelSource)
  assert.ok(!JSON.stringify(counted.csv.rows).includes('shift_late_not_counted'), 'a late close that was counted shows its count')
}

test('Not counted (closed late) replaces an empty closing count only on a late close', async () => { await notCounted() })

test('the card and the registered block read the same rule', () => {
  const model = loadModel(MODEL) as any
  const shift = baseShift() as any
  assert.equal(model.shiftNotCounted(shift, true), true)
  assert.equal(model.shiftNotCounted(shift, false), false)
  assert.equal(model.shiftNotCounted({ ...shift, closing_counted_khr: 0 }, true), false, 'a counted zero is a count')
  assert.equal(model.shiftNotCounted({ ...shift, closed_at: null }, true), false, 'an open shift is not "closed late"')
})

// 3. The picker rows and the print subtitle.
async function pickerRows(source = REPORT) {
  const got = await run(lateHistory(), source)
  const option = got.picker.props.options[0]
  assert.equal(option.node?.type, 'HeaderRow', 'the picker row is the one shift header row')
  assert.equal(option.node.props.shift.shift_code, CODE, 'built from the shift itself: date, ID, cashier, branch')
  assert.ok(got.view.nodes(option.node).some((node: any) => node.props?.children === 'shift_closed_late'), 'and carries the Closed late tag')
  assert.equal(option.value, '22/11/2026 · Dara', 'the value that lands in the field is unchanged')
  assert.equal(option.meta, CODE)
  assert.equal(got.print.subtitle, `22/11/2026 · ${CODE} · Dara · LC Store`, 'the print subtitle is date · ID · cashier · branch')
}

test('the Reports picker rows are the shift header row with the Closed late tag; the print subtitle is date · ID · cashier · branch', async () => { await pickerRows() })

test('a shift not closed late has no tag in its picker row', async () => {
  const got = await run({ shift: baseShift(), amendments: [] })
  assert.ok(!got.view.nodes(got.picker.props.options[0].node).some((node: any) => node.props?.children === 'shift_closed_late'))
})

// Mutants of the real source: each must turn its own test red.
const mutate = (source: string, from: string, to: string) => {
  assert.ok(source.includes(from), `the mutant target exists: ${from.slice(0, 50)}`)
  return source.replace(from, to)
}

test('mutant: the Closed late row left out of the CSV fails the row test', async () => {
  const mutant = mutate(REPORT, "filters, 'csv'), rows)", "filters, 'csv'), rows.filter((row) => row.Section !== tr('shift_closed_late', 'Closed late')))")
  await assert.rejects(() => closedLateRow(mutant), /the CSV has a Closed late row/)
})

test('mutant: the reason dropped from the print fails the print test', async () => {
  const mutant = mutate(REPORT, "[found.reason, found.by,", "[found.by,")
  await assert.rejects(() => run(lateHistory(), mutant).then((got) => assert.ok(String(closedLateLine(got.print.rows)).includes('Forgot to close'), 'the print row names the reason')), /the print row names the reason/)
})

test('mutant: Not counted shown on a same-day close with no count fails the not-counted test', async () => {
  const mutant = mutate(MODEL, 'return closedLate && !!shift.closed_at', 'return !!shift.closed_at')
  await assert.rejects(() => notCounted(mutant), /same-day close/)
})

test('mutant: a picker row built without ShiftHeaderRow fails the picker test', async () => {
  const mutant = mutate(mutate(REPORT, '<ShiftHeaderRow shift={row}>', '<span>'), '</ShiftHeaderRow>', '</span>')
  await assert.rejects(() => pickerRows(mutant), /the picker row is the one shift header row/)
})

// F1 (shiftf3): the administrator's later time edit carries the closed_late entry forward; "when" is the late close itself.
test('the Closed late "when" is the late close, not a later administrator time edit', () => {
  const model = loadModel(MODEL) as any
  const entry = { code: 'closed_late', by: 'sokha', reason: 'Forgot' }
  const closeRow = { ...lateRow, id: 7, created_at: '2026-11-23T03:30:00.000Z', after_json: JSON.stringify({ time_review: [entry] }) }
  const editRow = { ...lateRow, id: 9, created_at: '2026-11-25T08:00:00.000Z', after_json: JSON.stringify({ time_review: [entry] }) }
  assert.deepEqual(model.lateCloseReview([closeRow, editRow]), { by: 'sokha', reason: 'Forgot', at: '2026-11-23T03:30:00.000Z' })
  assert.deepEqual(model.lateCloseReview([editRow, closeRow]), { by: 'sokha', reason: 'Forgot', at: '2026-11-23T03:30:00.000Z' }, 'row order does not matter')
  assert.equal(model.lateCloseReview([closeRow])?.at, '2026-11-23T03:30:00.000Z', 'the close row alone')
  const own = { ...entry, at: '2026-11-23T03:31:00.000Z' }
  assert.equal(model.lateCloseReview([{ ...closeRow, after_json: JSON.stringify({ time_review: [own] }) }, editRow])?.at, '2026-11-23T03:31:00.000Z', 'an entry that carries its own time wins')
  const cleared = { ...editRow, id: 11, after_json: JSON.stringify({ time_review: [] }) }
  assert.equal(model.lateCloseReview([closeRow, editRow, cleared]), null, 'a newest row without the entry is no standing review')
})
