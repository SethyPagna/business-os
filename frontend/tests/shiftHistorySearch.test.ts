// S1 (owner, 23 Sep 2026): "also make sure when entering shift, i can search
// the cashier, or id."
//
// The Shifts popup (ShiftHistoryModal, opened through ShiftHistoryPanel from
// POS, Users, Fees, Returns, Sales, the current-shift card, the profile popup
// and the Shift report) listed shifts page by page with no way to look one up.
// It now has the shared search box pinned above the list, and the search goes
// to the SERVER (listShifts q: cashier name or shift ID) after the shared
// 250 ms pause, so every page is searched. This mounts the REAL popup against a
// fake list read that applies the documented contract -- case-insensitive
// substring of cashier or shift ID, before paging -- and pins:
//   - the box is the shared SearchInput, first in the list column and sticky
//     there, and stops at the Worker's 80 characters;
//   - the search is sent trimmed, by cashier and by shift ID;
//   - a new search restarts at page 1 and the pager then pages the search;
//   - while the pause runs nothing is sent and no stale row is offered;
//   - no match is said plainly; an empty history keeps its own wording;
//   - closing the popup drops the search.
// Three mutants of the real source prove the assertions discriminate.
//
// Run: node tests/shiftHistorySearch.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const MODAL = read('components/shifts/ShiftHistoryModal.tsx')

const storage = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, String(v)), removeItem: (k: string) => values.delete(k) } }
const previousWindow = globalThis.window
globalThis.window = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() }) as any
after(() => { globalThis.window = previousWindow })
// The real helpers the popup renders with (row order, count rules, the shared
// search constants); only the two reads are replaced below.
const transport = await import('../src/api/shiftTransport.ts')

type Row = { id: number; shift_code: string; user_name: string; business_date: string; opened_at: string }
const ROWS: Row[] = [
  { id: 31, shift_code: 'S-20260922-1400-dara', user_name: 'Dara', business_date: '2026-09-22', opened_at: '2026-09-22T07:00:00.000Z' },
  { id: 30, shift_code: 'S-20260922-0807-sokha', user_name: 'Sokha', business_date: '2026-09-22', opened_at: '2026-09-22T01:07:00.000Z' },
  { id: 21, shift_code: 'S-20260915-0800-dara', user_name: 'Dara', business_date: '2026-09-15', opened_at: '2026-09-15T01:00:00.000Z' },
  { id: 12, shift_code: 'S-20260910-0801-sokha', user_name: 'Sokha', business_date: '2026-09-10', opened_at: '2026-09-10T01:01:00.000Z' },
  // The older ID form, which the search must still find.
  { id: 5, shift_code: 'S-20260901-0805-a1b2c3', user_name: 'Sokha', business_date: '2026-09-01', opened_at: '2026-09-01T01:05:00.000Z' },
]
const PAGE_SIZE = 2
const closed = (row: Row) => ({ ...row, closed_at: `${row.business_date}T12:00:00.000Z`, cancelled_at: null, revision: 1, capabilities: {} })

function mount(source = MODAL, rows: Row[] = ROWS) {
  const slots: any[] = []
  let cursor = 0
  let dirty = false
  let pending: Array<() => void> = []
  const hooks = {
    useState(initial: any) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next: any) => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true } }]
    },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { fn, deps }; return slots[i].fn },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  // The 250 ms pause, under the test's control: while `hold` is set the hook
  // keeps returning the last value it let through, exactly as the real one
  // does until its timer fires.
  const debounce = { hold: false, settled: undefined as unknown, delays: [] as number[] }
  const listCalls: any[] = []
  const serve = (input: any) => {
    const q = String(input.q ?? '').trim().toLowerCase()
    const matched = (q ? rows.filter((row) => row.user_name.toLowerCase().includes(q) || row.shift_code.toLowerCase().includes(q)) : rows).map(closed)
    const page = input.page ?? 1
    return { shifts: matched.slice((page - 1) * input.pageSize, page * input.pageSize), page, total: matched.length, page_size: input.pageSize, scope: 'all' }
  }
  const jsx = (type: any, props: any) => ({ type, props })
  // One stable context value, as the real provider gives: `t` is a load
  // dependency, so a fresh function per render would restart every read.
  const app = { t: (key: string) => key, user: { id: 7, role_code: 'admin' }, notify: () => {} }
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (id.includes('AppContext')) return { useApp: () => app }
    if (id.includes('useDebouncedValue')) return { useDebouncedValue: (value: unknown, delay: number) => {
      debounce.delays.push(delay)
      if (!debounce.hold || debounce.settled === undefined) debounce.settled = value
      return debounce.settled
    } }
    if (id.includes('formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('shared/Modal')) return { __esModule: true, default: 'Modal' }
    if (id.includes('PaginationControls')) return { __esModule: true, default: 'Pager', DEFAULT_PAGE_SIZE: PAGE_SIZE }
    if (id.includes('SearchInput')) return { __esModule: true, default: 'SearchInput' }
    if (id.includes('DateEntryInput')) return { DateTimeEntryInput: 'DateTimeEntryInput' }
    if (id.includes('ShiftGate')) return { SHIFT_BRANCH_CHANGED_EVENT: 'shift-branch', SHIFT_STATE_CHANGED_EVENT: 'shift-state' }
    if (id.includes('ShiftSummary')) return { __esModule: true, default: 'Summary' }
    if (id.includes('ShiftCountFields')) return { __esModule: true, default: 'CountPair', ShiftSubmitRow: 'SubmitRow', shiftCountBlockerKey: (key: string) => key }
    if (id.includes('shiftTransport')) return {
      ...transport,
      listShifts: async (input: any) => { listCalls.push(input); return serve(input) },
      fetchShiftHistory: async (shiftId: number) => { const row = closed(rows.find((entry) => entry.id === shiftId)!); return { shift: row, segments: [row], amendments: [] } },
      pendingShiftMutation: () => null,
    }
    return { __esModule: true, default: id }
  }, mod, mod.exports)
  const props = { branchId: 1 }
  let tree: any
  // React restarts a render that set state before committing it, then runs
  // the committed render's effects; repeat until nothing changes.
  const commit = () => {
    for (let n = 0; n < 30; n++) {
      cursor = 0; dirty = false; pending = []
      tree = mod.exports.default(props)
      if (dirty) continue
      const jobs = pending; pending = []
      jobs.forEach((job) => job())
      if (!dirty) return tree
    }
    throw new Error('render did not stabilize')
  }
  const settle = async () => { for (let n = 0; n < 8; n++) { commit(); await new Promise((resolve) => setImmediate(resolve)) } return commit() }
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  const find = (current: any, type: string) => nodes(current).find((node) => node.type === type)
  const box = (current: any) => {
    const found = find(current, 'SearchInput')
    assert.ok(found, 'the Shifts popup renders the shared search box')
    return found
  }
  const open = async () => {
    const launcher = nodes(commit()).find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')
    assert.ok(launcher, 'the popup has its launcher')
    launcher.props.onClick()
    return settle()
  }
  const rowIds = (current: any) => nodes(current).filter((node) => node.type === 'Summary').map((node) => node.props.shift.id)
  const status = (current: any) => nodes(current).find((node) => node.type === 'p' && node.props.role === 'status')?.props.children
  const emptyText = (current: any) => nodes(current).find((node) => node.type === 'p' && /border-dashed/.test(node.props.className || ''))?.props.children
  const cleanup = () => slots.forEach((slot) => slot?.cleanup?.())
  return { open, settle, find, box, rowIds, status, emptyText, listCalls, debounce, cleanup }
}

test('the search box is the shared field, pinned first in the list column, and stops at 80 characters', async () => {
  const view = mount()
  try {
    const tree = await view.open()
    const field = view.box(tree)
    assert.equal(field.props.id, 'shift-history-search')
    assert.equal(field.props.placeholder, 'shift_search_placeholder', 'the box says it searches the cashier or the ID')
    assert.equal(field.props.ariaLabel, 'shift_search_placeholder', 'and says so to a screen reader too')
    assert.equal(field.props.maxLength, 80, 'the box stops at the Worker limit, so a search it would refuse is never sent')
    // The pinned row must be a DIRECT child of the tall column the popup body
    // scrolls: a sticky element only sticks inside its parent's box, so one
    // nested in a short header row would scroll away with it.
    const column = view.find(tree, 'Modal').props.children
    assert.match(column.props.className, /\bspace-y-3\b/, 'the list column is what the popup body scrolls')
    const [first] = [column.props.children].flat().filter(Boolean)
    assert.ok([first.props.children].flat().includes(field), 'the search row is the first thing in the column, above the list')
    for (const token of ['sticky', 'top-0', 'z-10', 'bg-white', 'dark:bg-gray-800']) {
      assert.ok(first.props.className.split(/\s+/).includes(token), `the search row is pinned and opaque (${token})`)
    }
    assert.ok(!view.listCalls.at(-1).q, 'the unsearched list sends no q')
    assert.deepEqual(view.rowIds(tree), [31, 30])
  } finally { view.cleanup() }
})

async function searchesTheServer(source = MODAL) {
  const view = mount(source)
  try {
    let tree = await view.open()
    view.box(tree).props.onChange('  sokha ')
    tree = await view.settle()
    assert.equal(view.listCalls.at(-1).q, 'sokha', 'the cashier search is sent to the server, trimmed')
    assert.deepEqual(view.rowIds(tree), [30, 12], 'the list shows the server matches (first page)')
    assert.equal(view.box(tree).props.value, '  sokha ', 'the box keeps what was typed')

    view.box(tree).props.onChange('A1B2C3')
    tree = await view.settle()
    assert.equal(view.listCalls.at(-1).q, 'A1B2C3', 'a shift ID is searched too')
    assert.deepEqual(view.rowIds(tree), [5])
    assert.ok(view.debounce.delays.length > 0 && view.debounce.delays.every((ms) => ms === 250), 'the search waits the shared 250 ms pause')
  } finally { view.cleanup() }
}

test('the popup searches the server by cashier or ID', async () => { await searchesTheServer() })

test('negative control: a popup that does not send the search fails the test above', async () => {
  const mutant = MODAL.replace('page, pageSize, q: query }', 'page, pageSize }')
  assert.notEqual(mutant, MODAL, 'the mutant must actually drop q from the list read')
  await assert.rejects(() => searchesTheServer(mutant), /the cashier search is sent to the server/)
})

async function pagesTheSearch(source = MODAL) {
  const view = mount(source)
  try {
    let tree = await view.open()
    assert.equal(view.find(tree, 'Pager').props.totalItems, 5)
    view.find(tree, 'Pager').props.onPageChange(3)
    tree = await view.settle()
    assert.equal(view.listCalls.at(-1).page, 3)

    view.box(tree).props.onChange('sokha')
    tree = await view.settle()
    assert.deepEqual([view.listCalls.at(-1).page, view.listCalls.at(-1).q], [1, 'sokha'], 'a new search starts at page 1')
    assert.equal(view.find(tree, 'Pager').props.page, 1)
    assert.equal(view.find(tree, 'Pager').props.totalItems, 3, 'the pager counts the search, not every shift')

    view.find(tree, 'Pager').props.onPageChange(2)
    tree = await view.settle()
    assert.deepEqual([view.listCalls.at(-1).page, view.listCalls.at(-1).q], [2, 'sokha'], 'paging keeps the search')
    assert.deepEqual(view.rowIds(tree), [5])
  } finally { view.cleanup() }
}

test('a new search restarts at page 1 and the pager then pages the search', async () => { await pagesTheSearch() })

test('negative control: a page kept across searches fails the test above', async () => {
  const mutant = MODAL.replace('const pageScope = JSON.stringify([actorScope, query])', 'const pageScope = actorScope')
  assert.notEqual(mutant, MODAL, 'the mutant must actually drop the search from the page scope')
  await assert.rejects(() => pagesTheSearch(mutant), /a new search starts at page 1/)
})

test('while the pause runs nothing is sent and no stale row is offered', async () => {
  const view = mount()
  try {
    let tree = await view.open()
    const calls = view.listCalls.length
    view.debounce.hold = true
    view.box(tree).props.onChange('dar')
    tree = await view.settle()
    assert.equal(view.box(tree).props.value, 'dar', 'the box shows the typing at once')
    assert.equal(view.listCalls.length, calls, 'nothing is sent before the pause ends')
    assert.deepEqual(view.rowIds(tree), [], 'rows for the previous search are not offered as matches for "dar"')
    assert.equal(view.status(tree), 'searching', 'the list says it is searching')
    assert.equal(view.find(tree, 'Pager'), undefined, 'the pager of the previous search is not offered either')

    view.debounce.hold = false
    tree = await view.settle()
    assert.equal(view.listCalls.at(-1).q, 'dar')
    assert.equal(view.listCalls.length, calls + 1, 'one read for the whole word')
    assert.deepEqual(view.rowIds(tree), [31, 21])
    assert.equal(view.status(tree), undefined)
  } finally { view.cleanup() }
})

test('no match is said plainly, and an empty history keeps its own wording', async () => {
  const view = mount()
  try {
    let tree = await view.open()
    view.box(tree).props.onChange('nobody')
    tree = await view.settle()
    assert.deepEqual(view.rowIds(tree), [])
    assert.equal(view.emptyText(tree), 'shift_search_no_match', 'the popup says the search matched nothing, not that no shift was ever recorded')
    view.box(tree).props.onChange('')
    tree = await view.settle()
    assert.ok(!view.listCalls.at(-1).q, 'clearing the box reads the unsearched list again')
    assert.deepEqual(view.rowIds(tree), [31, 30])
  } finally { view.cleanup() }
  const empty = mount(MODAL, [])
  try {
    const tree = await empty.open()
    assert.equal(empty.emptyText(tree), 'shift_history_empty', 'with no search, an empty history still says no shift is recorded')
  } finally { empty.cleanup() }
})

async function closingDropsTheSearch(source = MODAL) {
  const view = mount(source)
  try {
    let tree = await view.open()
    view.box(tree).props.onChange('dara')
    tree = await view.settle()
    assert.equal(view.listCalls.at(-1).q, 'dara')
    view.find(tree, 'Modal').props.onClose()
    tree = await view.settle()
    assert.equal(view.find(tree, 'Modal'), undefined, 'the popup closed')
    tree = await view.open()
    assert.equal(view.box(tree).props.value, '', 'closing the popup drops the search')
    assert.ok(!view.listCalls.at(-1).q, 'the next opening reads every shift')
    assert.deepEqual(view.rowIds(tree), [31, 30])
  } finally { view.cleanup() }
}

test('closing the popup drops the search', async () => { await closingDropsTheSearch() })

test('negative control: a search left behind on close fails the test above', async () => {
  const mutant = MODAL.replace("    setSearch('')\n", '')
  assert.notEqual(mutant, MODAL, 'the mutant must actually keep the search on close')
  await assert.rejects(() => closingDropsTheSearch(mutant), /closing the popup drops the search/)
})

test('the popup is wired to the shared field, the shared pause, and both packs', () => {
  assert.match(MODAL, /import SearchInput from '\.\.\/shared\/SearchInput\.tsx'/, 'the shared search box, not a second one')
  assert.match(MODAL, /useDebouncedValue\(search, SHIFT_SEARCH_DEBOUNCE_MS\)/, 'the same pause as the Reports shift picker')
  const en = JSON.parse(read('lang/en.json')), km = JSON.parse(read('lang/km.json'))
  for (const key of ['shift_search_placeholder', 'shift_search_no_match', 'searching']) {
    assert.ok(MODAL.includes(`t('${key}')`), `the popup uses ${key}`)
    assert.ok(en[key] && km[key], `${key} is in both packs`)
    assert.match(km[key], /[ក-៿]/, `${key} is Khmer in km.json`)
  }
})
