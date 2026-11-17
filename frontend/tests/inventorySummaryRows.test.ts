import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'
import { canonicalProductsQuery, loadWired, wiredListParams, wiredResult, type WiredDeps, type WiredList, type WiredRaw } from '../src/components/inventory/inventoryWired.ts'
import { checkDaysOf, dayChipsOf } from '../src/components/inventory/inventoryCheckDays.ts'
import { productsWireParams, sessionScopeParams } from '../src/components/inventory/inventoryCheckProductsRequest.ts'

// Inventory status counts are true on every path: the figures on the cards come from ONE whole answer (the overlay's, or a list that named the branch), never from a mix, and when no answer carries them the page shows none, never 0.
// The fixture server follows the Worker: /list carries a summary only when the request names a branch (the sole-branch open leaves it out), /overlay always carries one, built by the Worker's own rule
// (rows of the unfiltered list: total = rows, not_checked = total - ok - issue).
const FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts', 'api/dataEpoch.ts', 'api/productSearchIndex.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const entries: string[] = []
let entryIndex = 0
const applyLocation = (url: string) => { const next = new URL(url, 'https://admin.example.test/'); Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) }
const open = (hash: string) => { entries.splice(0, entries.length, `https://admin.example.test/inventory#${hash}`); entryIndex = 0; applyLocation(entries[0]) }
window.history.pushState = (_state, _unused, url) => { entries.splice(entryIndex + 1); entries.push(new URL(String(url), 'https://admin.example.test/').href); entryIndex += 1; applyLocation(entries[entryIndex]) }
window.history.replaceState = (_state, _unused, url) => { entries[entryIndex] = new URL(String(url), 'https://admin.example.test/').href; applyLocation(entries[entryIndex]) }

type Row = Record<string, unknown>
const branch = { id: 1, name: 'Only branch' }
const productRow = (id: number, name: string, quantity: number | undefined): Row => ({ id, name, unit: 'pcs', ...(quantity === undefined ? {} : { stock_quantity: quantity }), branch_stock: [{ branch_id: 1, branch_name: branch.name, ...(quantity === undefined ? {} : { quantity }) }] })
let listAnswer: (query: URLSearchParams) => Row | Promise<Row> = () => ({})
let overlayEntries = new Map<number, Row>()
let overlaySummary: () => Row | undefined = () => undefined
const lists: URLSearchParams[] = []
const overlays: URLSearchParams[] = []
const held = new Map<string, unknown>()
let authorityCurrent = true
let epoch = 'epoch-a'
let ranked: { hits: Array<{ id: number; tier: number }>; total: number } | null = null
const CANONICAL = 'page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots'
const listBody = (items: Row[], extra: Row = {}) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1, wired: true, projected: false, ...extra })

const app = (permissions: Record<string, boolean>) => ({
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...permissions } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, notify: () => {},
  settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  navigateTo: (page: string, anchor?: string) => {
    window.history.pushState(null, '', `/inventory#${anchor || ''}`)
    window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } }))
  },
})
const doubles = {
  'utils/dirtyWork.ts': dirtyWork,
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }),
    captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => authorityCurrent,
    isActorWriteIdentityCurrent: () => true,
  },
  'api/dataEpoch.ts': { currentDataEpoch: () => epoch },
  'api/productSearchIndex.ts': { searchProductIndex: () => ranked },
  'api/productReadTransport.ts': {
    peekProductSearch: (query: string) => held.get(query) ?? null,
    primeProductSearch: (query: string, payload: unknown) => { held.set(query, payload) },
    getProductFilters: async () => ({ brands: [], categories: [] }),
  },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckList: async (params: QueryParams) => {
      const query = new URL(appendQuery('/api/inventory-checks/list', buildQueryString(params)), 'https://admin.example.test').searchParams
      lists.push(query)
      return listAnswer(query)
    },
    readInventoryCheckOverlay: async (params: { branchId: number | string; ids: Array<number | string>; lots?: boolean; summary?: boolean }) => {
      overlays.push(new URL(appendQuery('/api/inventory-checks/overlay', buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}), ...(params.summary === false ? { summary: 0 } : {}) })), 'https://admin.example.test').searchParams)
      return { wired: true, branchId: Number(params.branchId), items: params.ids.map(id => overlayEntries.get(Number(id)) ?? { product_id: Number(id), last_change_at: null }), ...(overlaySummary() && params.summary !== false ? { summary: overlaySummary() } : {}) }
    },
    readInventoryCheckProducts: async () => { throw new Error('the older list must not be asked while ic_wired is on') },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: null, items: [] }),
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
async function mount(permissions: Record<string, boolean> = FIELDS) {
  lists.length = 0; overlays.length = 0; held.clear(); authorityCurrent = true; epoch = 'epoch-a'; ranked = null; overlayEntries = new Map()
  open('hub:inventory:products')
  return harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(permissions), doubles, props: {} })
}
const sync = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('sync:update', { detail }))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ---- the Worker's rule, written out (cloudflare/src/lib/inventoryCheckList.ts readCheckSummary): the unit is the product row, total = the rows of the unfiltered list, Not checked = total - ok - issue ----
type World = { rows: Array<{ id: number; name: string }>; ok: number[]; issue: number[]; days?: Array<{ day: string; count: number }> }
const rowsOf = (): World['rows'] => ['Aloe Gel', 'Beauty Balm', 'Camellia Oil'].flatMap((name, family) => [0, 1, 2].map(index => ({ id: 100 + family * 10 + index, name })))
const world = (ok: number[], issue: number[] = [], days: World['days'] = []): World => ({ rows: rowsOf(), ok, issue, days })
const workerSummary = (w: World) => ({ ok: w.ok.length, issue: w.issue.length, not_checked: w.rows.length - w.ok.length - w.issue.length, total: w.rows.length, days: w.days ?? [] })
const F3 = world([100, 101, 110, 120])
assert.equal(workerSummary(F3).not_checked, 5, 'the fixture itself: 3 names x 3 rows with 4 rows checked leaves 5 (3 families - 4 would clamp to 0)')
const rowsFor = (w: World) => w.rows.map(row => productRow(row.id, row.name, 3))
/** What the Worker's /list answers: a summary only when the request names a branch and does not skip it. */
const workerList = (w: World) => (query: URLSearchParams) => listBody(rowsFor(w).slice(0, 20), { total: w.rows.length, ...(query.has('branchId') && query.get('summary') !== '0' ? { summary: workerSummary(w) } : {}) })
const chipNumber = (surface: { text: () => string }, label: string) => { const found = new RegExp(`${label}\\s*(\\d+)`).exec(surface.text()); return found ? Number(found[1]) : null }

// ---- pure: every path through loadWired -> wiredResult ----
{
  const access = { stock: true, barcode: true, received: false }
  const params = { page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc', branchId: 1 }
  const known = { branches: [{ id: 1, name: 'Only branch' }] }
  const wires: QueryParams[] = [], skipped: number[] = [], asked_: number[] = []
  const depsOf = (w: World, overlay: () => Row | undefined, held?: WiredList): WiredDeps => ({
    readList: async (wire: QueryParams) => { wires.push(wire); return workerList(w)(new URLSearchParams(buildQueryString(wire))) as unknown as WiredList },
    readOverlay: async (asked: { ids: number[]; summary?: boolean }) => { asked.summary === false ? skipped.push(asked.ids.length) : asked_.push(asked.ids.length); return ({ items: asked.ids.map(id => ({ product_id: id, last_change_at: null })), ...(overlay() && asked.summary !== false ? { summary: overlay() } : {}) }) as never },
    peek: () => held ?? null, prime: () => {}, rank: () => null,
  })
  const figures = (result: ReturnType<typeof wiredResult>) => { const s = result.summary as Record<string, unknown> | undefined; return s && JSON.stringify([s.not_checked, s.ok, s.issue, s.total]) }

  // sole-branch open: the first list names no branch, so it has no summary and the page shows none (not 0); the remount that names the branch takes the overlay's
  const first = await loadWired({ params: { ...params, branchId: undefined as never }, known, skipSummary: false, access, deps: depsOf(F3, () => workerSummary(F3)) })
  assert.equal(Object.hasOwn(wires[0], 'branchId'), false, 'the sole-branch list leaves the branch out')
  assert.equal(first.raw.list.summary, undefined, 'so the Worker sends it no summary')
  assert.equal(wiredResult(first.raw).summary, undefined, 'and the page has no figure to show: unknown, never 0')
  const seeded = await loadWired({ params, known, seed: first.raw.list, skipSummary: false, access, deps: depsOf(F3, () => workerSummary(F3)) })
  assert.equal(seeded.listRequests, 0, 'the seeded remount reads no second list')
  assert.equal(figures(wiredResult(seeded.raw)), '[5,4,0,9]', 'the overlay of the remount brings the whole figures: Not checked 5 of 9 rows')

  // Products-held open: the held answer is Products' payload (no summary); the overlay supplies it
  const heldList = workerList(F3)(new URLSearchParams()) as unknown as WiredList
  const fromStore = await loadWired({ params, known, skipSummary: false, access, deps: depsOf(F3, () => workerSummary(F3), heldList) })
  assert.equal(fromStore.fromStore, true, 'control: the rows came from the held answer')
  assert.equal(figures(wiredResult(fromStore.raw)), '[5,4,0,9]', 'the held path shows the whole figures of the overlay')

  // no made-up 0: an answer that is not whole (an older server's overlay: counts without Not checked and total) leaves the figures unknown
  const partial = () => ({ ok: 4, issue: 0, days: [] })
  const partialOnly = await loadWired({ params, known, seed: first.raw.list, skipSummary: false, access, deps: depsOf(F3, partial) })
  assert.equal(wiredResult(partialOnly.raw).summary, undefined, 'no summary at all rather than Not checked 0 and total 0')
  const heldPartial = await loadWired({ params, known, skipSummary: false, access, deps: depsOf(F3, partial, heldList) })
  assert.equal(wiredResult(heldPartial.raw).summary, undefined, 'the held path too')

  // no mixing: the list named the branch (a whole summary) and the overlay brought a partial one: the whole one stands, key for key
  const withListSummary = (w: World) => ({ ...(workerList(w)(new URLSearchParams('branchId=1')) as object) }) as unknown as WiredList
  const mixed = await loadWired({ params, known, seed: withListSummary(F3), skipSummary: false, access, deps: depsOf(F3, partial) })
  assert.equal(figures(wiredResult(mixed.raw)), '[5,4,0,9]', 'a partial overlay summary never replaces a whole list one')

  // page step: the list and the overlay both skip the summary (the page holds the figures of this scope); every figure stays from that one answer, none from a mix
  const before = wiredResult(seeded.raw)
  const moved = world([100, 101, 110, 120, 102], [111])
  skipped.length = 0
  const step = await loadWired({ params: { ...params, page: 2 }, known, skipSummary: true, access, deps: depsOf(moved, () => workerSummary(moved)) })
  assert.deepEqual(skipped, [9], 'the overlay of a page step asks the Worker for no summary')
  assert.equal(figures(wiredResult(step.raw, before)), '[5,4,0,9]', 'a page step keeps the held whole summary: no figure of the newer answer is mixed into it')
  // a new scope (a filter, Refresh, a branch) asks for the summary and takes the fresh answer whole
  const rescoped = await loadWired({ params: { ...params, page: 1 }, known, skipSummary: false, access, deps: depsOf(moved, () => workerSummary(moved)) })
  assert.equal(figures(wiredResult(rescoped.raw, before)), '[3,5,1,9]', 'a new scope: ok, issue, Not checked and total all come from the fresh answer')
  const noOverlaySummary = await loadWired({ params: { ...params, page: 2 }, known, skipSummary: true, access, deps: depsOf(moved, () => undefined) })
  assert.equal(figures(wiredResult(noOverlaySummary.raw, before)), '[5,4,0,9]', 'an answer with no summary at all keeps the whole summary held, not a piece of it')

  // days and tooLarge ride the answer that carries the figures (the earlier list's stale ones never win)
  const stale = world([100], [], [{ day: '2026-11-10', count: 1 }]), fresh = world([100, 101], [], [{ day: '2026-11-12', count: 2 }])
  const days = await loadWired({ params, known, seed: withListSummary(stale), skipSummary: false, access, deps: depsOf(fresh, () => workerSummary(fresh)) })
  assert.deepEqual((wiredResult(days.raw).summary as { days?: unknown }).days, [{ day: '2026-11-12', count: 2 }], 'the days of the overlay replace those of the list')
  const large = await loadWired({ params, known, seed: withListSummary(stale), skipSummary: false, access, deps: depsOf(fresh, () => ({ tooLarge: true })) })
  assert.deepEqual(wiredResult(large.raw).summary, { tooLarge: true }, 'tooLarge from the overlay clears the counts and days of the list')
  const largeThenStep = await loadWired({ params: { ...params, page: 2 }, known, skipSummary: true, access, deps: depsOf(fresh, () => undefined) })
  assert.deepEqual(wiredResult(largeThenStep.raw, wiredResult(large.raw)).summary, { tooLarge: true }, 'a step that brings no summary keeps the flag')
}

try {
  // ---- mounted: one active branch (the production shape) ----
  {
    listAnswer = workerList(F3)
    overlaySummary = () => workerSummary(F3)
    const surface = await mount()
    await surface.waitFor(() => chipNumber(surface, 'Not checked') !== null, 'the Not checked figure')
    assert.equal(chipNumber(surface, 'Not checked'), 5, 'the Not checked chip says 5 (3 names x 3 rows, 4 rows checked), not 0')
    assert.equal(chipNumber(surface, 'Checked OK'), 4)
    assert.equal(lists.length, 1, 'one list read on open')
    assert.equal(lists[0].has('branchId'), false, 'which names no branch (the list stays the read of Products)')
    assert.equal(overlays.length, 1, 'and one overlay read: the figures add no round trip')
    await surface.unmount()
  }
  // ---- mounted: no answer carries a whole summary: no figure on the chip, never 0 ----
  {
    listAnswer = workerList(F3)
    overlaySummary = () => ({ ok: 4, issue: 0, days: [] })
    const surface = await mount()
    await surface.waitFor(() => overlays.length === 1 && surface.text().includes('Aloe Gel'), 'the page is drawn')
    assert.equal(chipNumber(surface, 'Not checked'), null, 'Not checked shows no number')
    assert.ok(!/Not checked\s*0/.test(surface.text()), 'and in particular not 0')
    await surface.unmount()
  }
  // ---- mounted: a page step keeps the figures of the scope (one answer) and asks the Worker for none; a Refresh takes a whole fresh answer ----
  {
    let step = 0
    listAnswer = query => { const page = Number(query.get('page') || 1); return listBody(rowsFor(F3).slice(0, 3), { total: 45, totalPages: 3, page, ...(query.has('branchId') && query.get('summary') !== '0' ? { summary: workerSummary(F3) } : {}) }) }
    const worlds = [F3, world([100, 101, 110, 120, 102, 103], [111])]
    overlaySummary = () => workerSummary(worlds[Math.min(step, 1)])
    const surface = await mount()
    await surface.waitFor(() => chipNumber(surface, 'Not checked') === 5, 'the first figures')
    step = 1
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'next', 'next page'))
    await surface.waitFor(() => overlays.length === 2, 'the overlay of page 2')
    assert.equal(overlays[1].get('summary'), '0', 'the step asks the overlay for no summary')
    await wait(50)
    assert.deepEqual([chipNumber(surface, 'Not checked'), chipNumber(surface, 'Checked OK'), chipNumber(surface, 'Issues')], [5, 4, 0], 'the cards still show the one answer they held, none of them from a newer one')
    await surface.unmount()
  }
  console.log('inventorySummaryRows passed: sole-branch open, Products-held, no made-up 0, one answer per card set, page step, days and tooLarge')
} finally {
  await harness.close()
}
