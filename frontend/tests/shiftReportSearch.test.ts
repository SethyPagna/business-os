// S1 (owner, 23 Sep 2026): "also make sure when entering shift, i can search
// the cashier, or id."
//
// Reports -> Shift picked its shift from a click-only AppSelect over the one
// page it had loaded: no typing, and a shift on another page could not be
// found at all. The picker is now the shared "type or select" field
// (SuggestionTextInput) and the search goes to the SERVER (listShifts q), so
// every page is searched. This mounts the REAL ShiftReport (with the real
// useReportData body and the real date formatter) against a fake Worker that
// applies the documented contract -- case-insensitive substring of cashier or
// shift ID, before paging -- and pins:
//   - the picker is searchable, sends the search, and lists what the server
//     matched (no second client-side filter, no 50-row cut);
//   - a new search restarts at page 1 and the pager then pages the search;
//   - a picked shift stays on screen while the next search runs;
//   - no match is said plainly, with a way back;
//   - typing never disables the field, stale options are not offered while the
//     250 ms pause runs, and nothing past the Worker's 80 characters is sent.
// Two mutants of the real source prove the assertions discriminate.
//
// Run: node tests/shiftReportSearch.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const REPORT = read('components/sales/reports/ShiftReport.tsx')

type Row = { id: number; shift_code: string; user_name: string; business_date: string }
const ROWS: Row[] = [
  { id: 31, shift_code: 'S-20260922-1400-dara', user_name: 'Dara', business_date: '2026-09-22' },
  { id: 30, shift_code: 'S-20260922-0807-sokha', user_name: 'Sokha', business_date: '2026-09-22' },
  { id: 21, shift_code: 'S-20260915-0800-dara', user_name: 'Dara', business_date: '2026-09-15' },
  { id: 12, shift_code: 'S-20260910-0801-sokha', user_name: 'Sokha', business_date: '2026-09-10' },
  { id: 5, shift_code: 'S-20260901-0805-a1b2c3', user_name: 'Sokha', business_date: '2026-09-01' },
]
const PAGE_SIZE = 2

function mount(source = REPORT) {
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
  // The 250 ms pause, under the test's control: while `hold` is set the hook
  // keeps returning the last value it let through, exactly as the real one
  // does until its timer fires.
  const debounce = { hold: false, settled: undefined as unknown, delays: [] as number[] }
  const listCalls: any[] = [], detailCalls: number[] = []
  const serve = (input: any) => {
    const q = String(input.q ?? '').trim().toLowerCase()
    const matched = q ? ROWS.filter((row) => row.user_name.toLowerCase().includes(q) || row.shift_code.toLowerCase().includes(q)) : ROWS
    const page = input.page ?? 1
    return { shifts: matched.slice((page - 1) * input.pageSize, page * input.pageSize), page, total: matched.length, page_size: input.pageSize, scope: 'all' }
  }
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    if (id.includes('ReportFrame')) return { __esModule: true, default: 'ReportFrame', useReportData }
    if (id.includes('PaginationControls')) return { __esModule: true, default: 'Pager', DEFAULT_PAGE_SIZE: PAGE_SIZE }
    if (id.includes('SuggestionTextInput')) return { __esModule: true, default: 'Picker' }
    if (id.includes('AppSelect')) return { __esModule: true, default: 'AppSelect' }
    if (id.includes('useDebouncedValue')) return { useDebouncedValue: (value: unknown, delay: number) => {
      debounce.delays.push(delay)
      if (!debounce.hold || debounce.settled === undefined) debounce.settled = value
      return debounce.settled
    } }
    if (id.includes('formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('AppContext')) return { useApp: () => ({ user: { id: 1, role_code: 'admin' } }) }
    if (id.includes('permissions')) return { isAdminControlUser: (u: any) => u.role_code === 'admin' }
    if (id.includes('shiftTransport')) return {
      SHIFT_SEARCH_MAX_LENGTH: 80,
      SHIFT_SEARCH_DEBOUNCE_MS: 250,
      listShifts: async (input: any) => { listCalls.push(input); return serve(input) },
      fetchShiftHistory: async (shiftId: number) => { detailCalls.push(shiftId); return { shift: { ...ROWS.find((row) => row.id === shiftId)!, opening_float_usd: null, opening_float_khr: null, closing_counted_usd: null, closing_counted_khr: null } } },
    }
    if (id.includes('shiftReportModel')) return require('../src/components/shifts/shiftReportModel.ts')
    if (id.includes('ShiftSummary')) return { __esModule: true, default: 'Summary' }
    if (id.includes('reportModel')) return { reportFileName: (name: string) => name }
    if (id.includes('reportTypes')) return { exportMenuItems: () => [] }
    if (id.includes('/csv')) return { downloadCSV: () => {} }
    if (id.includes('ShiftGate')) return { SHIFT_STATE_CHANGED_EVENT: 'shift:test' }
    if (id.includes('/kit')) return { Button: 'Button', OverflowMenu: 'Menu', Skeleton: 'Skeleton', EmptyState: 'Empty' }
    return { __esModule: true, default: id }
  }, mod, mod.exports)
  const props: any = { filters: { startDate: '', endDate: '', branchId: '' }, tr: (key: string) => key, view: { labelKey: 'shift', fallback: 'Shift' }, canExport: () => true }
  const render = () => { cursor = 0; return mod.exports.default(props) }
  const settle = async () => { for (let i = 0; i < 8; i++) { render(); const jobs = pending; pending = []; jobs.forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)) } return render() }
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  const find = (tree: any, type: string) => nodes(tree).find((node) => node.type === type)
  const picker = (tree: any) => {
    const found = find(tree, 'Picker')
    assert.ok(found, 'the Shift report renders the shared search-and-select field')
    return found
  }
  const cleanup = () => slots.forEach((slot) => slot?.cleanup?.())
  return { props, render, settle, find, picker, listCalls, detailCalls, debounce, cleanup }
}

async function withWindow<T>(run: () => Promise<T>): Promise<T> {
  const previous = globalThis.window
  globalThis.window = new EventTarget() as any
  try { return await run() } finally { globalThis.window = previous }
}

const optionIds = (tree: any, view: ReturnType<typeof mount>) => view.picker(tree).props.options.map((option: any) => option.payload)

async function searchesTheServer(source = REPORT) {
  await withWindow(async () => {
    const view = mount(source)
    try {
      let tree = await view.settle()
      assert.equal(view.find(tree, 'AppSelect'), undefined, 'the click-only select is gone')
      const field = view.picker(tree)
      assert.equal(field.props.filter, 'none', 'the rows are what the SERVER matched; a second client filter would drop shift-ID hits')
      assert.equal(field.props.limit, 0, 'every row of the page is offered, not the first 50')
      assert.equal(field.props.options[0].value, '22/09/2026 · Dara', 'rows read day-first with the cashier')
      assert.equal(field.props.options[0].meta, 'S-20260922-1400-dara', 'the shift ID is on the row')
      assert.ok(!view.listCalls.at(-1).q, 'no search sends no q')

      field.props.onChange('  sokha ')
      tree = await view.settle()
      assert.equal(view.listCalls.at(-1).q, 'sokha', 'the cashier search is sent to the server, trimmed')
      assert.deepEqual(optionIds(tree, view), [30, 12], 'the picker lists the server matches (first page)')

      view.picker(tree).props.onChange('A1B2C3')
      tree = await view.settle()
      assert.equal(view.listCalls.at(-1).q, 'A1B2C3', 'a shift ID is searched too')
      assert.deepEqual(optionIds(tree, view), [5])
      assert.ok(view.debounce.delays.length > 0 && view.debounce.delays.every((ms) => ms === 250), 'the search waits the shared 250 ms pause')
    } finally { view.cleanup() }
  })
}

test('the Shift picker is a search box that searches the server by cashier or ID', async () => { await searchesTheServer() })

test('negative control: a picker that does not send the search fails the test above', async () => {
  const mutant = REPORT.replace('page, pageSize, q: query }', 'page, pageSize }')
  assert.notEqual(mutant, REPORT, 'the mutant must actually drop q from the list read')
  await assert.rejects(() => searchesTheServer(mutant), /the cashier search is sent to the server/)
})

test('a new search restarts at page 1 and the pager then pages the search', async () => {
  await withWindow(async () => {
    const view = mount()
    try {
      let tree = await view.settle()
      assert.equal(view.find(tree, 'Pager').props.totalItems, 5)
      view.find(tree, 'Pager').props.onPageChange(3)
      tree = await view.settle()
      assert.equal(view.listCalls.at(-1).page, 3)

      view.picker(tree).props.onChange('sokha')
      tree = await view.settle()
      assert.deepEqual([view.listCalls.at(-1).page, view.listCalls.at(-1).q], [1, 'sokha'], 'a new search starts at page 1')
      assert.equal(view.find(tree, 'Pager').props.totalItems, 3, 'the pager counts the search, not every shift')

      view.find(tree, 'Pager').props.onPageChange(2)
      tree = await view.settle()
      assert.deepEqual([view.listCalls.at(-1).page, view.listCalls.at(-1).q], [2, 'sokha'], 'paging keeps the search')
      assert.deepEqual(optionIds(tree, view), [5])
    } finally { view.cleanup() }
  })
})

async function keepsThePick(source = REPORT) {
  await withWindow(async () => {
    const view = mount(source)
    try {
      let tree = await view.settle()
      assert.equal(view.find(tree, 'Summary').props.shift.id, 31, 'before any pick the newest shift shows')
      view.picker(tree).props.onChange('sokha')
      tree = await view.settle()
      view.find(tree, 'Pager').props.onPageChange(2)
      tree = await view.settle()
      const older = view.picker(tree).props.options.find((option: any) => option.payload === 5)
      view.picker(tree).props.onChange(older.value, older)
      tree = await view.settle()
      assert.equal(view.find(tree, 'Summary').props.shift.id, 5, 'the picked shift is the report')
      assert.equal(view.picker(tree).props.value, 'sokha', 'picking leaves the search as typed')
      assert.equal(view.picker(tree).props.options.find((option: any) => option.payload === 5).selected, true, 'the picked row is marked')
      const detailReads = view.detailCalls.length

      view.picker(tree).props.onChange('dara')
      tree = await view.settle()
      assert.deepEqual(optionIds(tree, view), [31, 21])
      assert.equal(view.find(tree, 'Summary').props.shift.id, 5, 'searching for the next shift keeps the picked one on screen')
      view.picker(tree).props.onChange('')
      tree = await view.settle()
      assert.equal(view.find(tree, 'Summary').props.shift.id, 5, 'clearing the search keeps it too')
      assert.equal(view.detailCalls.length, detailReads, 'the picked shift is not re-read on every keystroke')

      view.props.filters = { ...view.props.filters, startDate: '2026-09-01', endDate: '2026-09-30' }
      tree = await view.settle()
      assert.equal(view.find(tree, 'Summary').props.shift.id, 31, 'new dates drop the pick: it may not be in the new range')
    } finally { view.cleanup() }
  })
}

test('a picked shift stays on screen while the next search runs', async () => { await keepsThePick() })

test('negative control: a pick scoped to the search is lost by the next search', async () => {
  const mutant = REPORT.replace('const pickedId = selection.scope === depsKey', 'const pickedId = selection.scope === listKey')
  assert.notEqual(mutant, REPORT, 'the mutant must actually rescope the pick')
  await assert.rejects(() => keepsThePick(mutant), /searching for the next shift keeps the picked one on screen/)
})

test('a search with no match says so in the list and in the report, with a way back', async () => {
  await withWindow(async () => {
    const view = mount()
    try {
      let tree = await view.settle()
      view.picker(tree).props.onChange('nobody')
      tree = await view.settle()
      assert.deepEqual(optionIds(tree, view), [])
      assert.equal(view.picker(tree).props.emptyHint, 'shift_search_no_match', 'the open list says nothing matched')
      assert.equal(view.find(tree, 'Summary'), undefined)
      const empty = view.find(tree, 'Empty')
      assert.equal(empty.props.title, 'shift_search_no_match', 'the report says the search matched nothing, not that no shift is open')
      assert.equal(empty.props.action.type, 'Button')
      empty.props.action.props.onClick()
      tree = await view.settle()
      assert.ok(!view.listCalls.at(-1).q, 'Clear search reads the unsearched list again')
      assert.equal(view.find(tree, 'Summary').props.shift.id, 31)
    } finally { view.cleanup() }
  })
})

test('typing never disables the field, offers no stale rows, and stops at the Worker limit', async () => {
  await withWindow(async () => {
    const view = mount()
    try {
      let tree = await view.settle()
      const calls = view.listCalls.length
      view.debounce.hold = true
      view.picker(tree).props.onChange('dar')
      tree = view.render()
      let field = view.picker(tree)
      assert.equal(field.props.disabled, undefined, 'the field keeps the keyboard while the search waits')
      assert.equal(field.props.loading, true, 'the list shows it is searching')
      assert.deepEqual(field.props.options, [], 'rows for the previous search are not offered as matches for "dar"')
      tree = await view.settle()
      assert.equal(view.listCalls.length, calls, 'nothing is sent before the pause ends')

      view.debounce.hold = false
      tree = view.render()
      tree = view.render()
      field = view.picker(tree)
      assert.equal(field.props.disabled, undefined, 'the field stays usable while the page loads')
      tree = await view.settle()
      assert.equal(view.listCalls.at(-1).q, 'dar')

      view.picker(tree).props.onChange('x'.repeat(100))
      tree = await view.settle()
      assert.equal(view.picker(tree).props.value.length, 80, 'the box stops at 80 characters')
      assert.equal(view.listCalls.at(-1).q.length, 80, 'the Worker never receives a search it would refuse')
    } finally { view.cleanup() }
  })
})

test('the picker is wired to the shared constants, both packs, and sits outside the clipping rail', () => {
  assert.match(REPORT, /useDebouncedValue\(search, SHIFT_SEARCH_DEBOUNCE_MS\)/)
  assert.match(REPORT, /text\.slice\(0, SHIFT_SEARCH_MAX_LENGTH\)/)
  assert.doesNotMatch(REPORT, /AppSelect/, 'no click-only select remains')
  // The secondary rail is overflow-x:auto, which also clips vertically; the
  // search field's floating list must not live inside it.
  const rail = REPORT.slice(REPORT.indexOf('secondaryActions={'), REPORT.indexOf('menuAction={'))
  assert.doesNotMatch(rail, /SuggestionTextInput/, 'the search field is not on the clipping secondary rail')
  const en = JSON.parse(read('lang/en.json')), km = JSON.parse(read('lang/km.json'))
  for (const key of ['shift_search_placeholder', 'shift_search_no_match']) {
    assert.ok(en[key] && km[key], `${key} is in both packs`)
    assert.notEqual(km[key], en[key], `${key} is translated, not English in km.json`)
    assert.match(km[key], /[ក-៿]/, `${key} is Khmer`)
  }
})
