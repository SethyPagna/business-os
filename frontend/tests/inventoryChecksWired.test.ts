import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'
import { canonicalProductsQuery, loadWired, wiredListParams, wiredResult, type WiredDeps, type WiredList, type WiredRaw } from '../src/components/inventory/inventoryWired.ts'
import { checkDaysOf, dayChipsOf } from '../src/components/inventory/inventoryCheckDays.ts'
import { productsWireParams, sessionScopeParams } from '../src/components/inventory/inventoryCheckProductsRequest.ts'

// INV-B S4b: the mounted Inventory Check page against fixture servers that follow the S4a contract (GET /api/inventory-checks/list and /overlay, 404 while ic_wired is off).
//   - a viewer who may not see stock reads no stock from the shared Products store (the store is not used for them; the server cuts stock from its own answer)
//   - a sync event naming a row on screen shows "changed elsewhere, tap to refresh" and reads NOTHING; the tap reads that one id (rows + overlay) and the hint goes
//   - an answer that arrives after the authority or the data epoch changed is dropped (the epoch case reads again and draws the second answer only)
//   - typed text is ranked by the device search index and the page reads the ranked ids; the sole-branch open is one list request
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
const lists: URLSearchParams[] = []
const sessionsOpened: string[] = []
const overlays: URLSearchParams[] = []
const held = new Map<string, unknown>()
let authorityCurrent = true
let epoch = 'epoch-a'
let ranked: { hits: Array<{ id: number; tier: number }>; total: number } | null = null
const CANONICAL = 'page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots'
const listBody = (items: Row[], extra: Row = {}) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1, wired: true, projected: false, summary: { ok: 0, issue: 0, not_checked: items.length, total: items.length }, ...extra })

const app = (permissions: Record<string, boolean>) => ({
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...permissions } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, notify: () => {}, getPermissionTier: () => 'none', can: () => false, fmtUSD: (value: unknown) => '$' + Number(value).toFixed(2), fmtKHR: (value: unknown) => Number(value).toFixed(0),
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
    readInventoryCheckOverlay: async (params: { branchId: number | string; ids: Array<number | string>; lots?: boolean }) => {
      overlays.push(new URL(appendQuery('/api/inventory-checks/overlay', buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}) })), 'https://admin.example.test').searchParams)
      return { wired: true, branchId: Number(params.branchId), items: params.ids.map(id => overlayEntries.get(Number(id)) ?? { product_id: Number(id), last_change_at: null }) }
    },
    readInventoryCheckProducts: async () => { throw new Error('the older list must not be asked while ic_wired is on') },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async (id: unknown) => { sessionsOpened.push(String(id)); return { item: null, items: [] } },
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
async function mount(permissions: Record<string, boolean> = FIELDS, overlay: Row[] = []) {
  lists.length = 0; overlays.length = 0; held.clear(); authorityCurrent = true; epoch = 'epoch-a'; ranked = null; overlayEntries = new Map(overlay.map(entry => [Number(entry.product_id), entry]))
  open('hub:inventory:products')
  return harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(permissions), doubles, props: {} })
}
const sync = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('sync:update', { detail }))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ---- pure: the date chips (owner, 17 Nov). The server sends summary.days = [{ day: 'YYYY-MM-DD', count }] with the status counts, and accepts checkedOn=YYYY-MM-DD. ----
{
  assert.equal(wiredListParams({ checkedOn: '2026-11-12', page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc' }).checkedOn, '2026-11-12', 'checkedOn is on the wire')
  assert.equal(Object.hasOwn(wiredListParams({ checkedOn: '', page: 1 }), 'checkedOn'), false, 'an empty date is not sent')
  assert.equal(canonicalProductsQuery(wiredListParams({ checkedOn: '2026-11-12', page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc' })), null, 'a dated read is never Products\' own answer')
  const rawOf = (summary: Record<string, unknown> | undefined): WiredRaw => ({ list: { items: [{ id: 1, name: 'A' }], total: 1, page: 1, pageSize: 20 } as never, overlay: new Map(), lots: new Map(), branches: [{ id: 1, name: 'B' }], branchId: 1, extras: { summary: summary as never } })
  const days = [{ day: '2026-11-12', count: 2 }, { day: '2026-11-10', count: 1 }]
  const first = wiredResult(rawOf({ ok: 2, issue: 1, not_checked: 4, total: 7, days }))
  const daysOfSummary = (result: ReturnType<typeof wiredResult>) => (result.summary as { days?: unknown } | undefined)?.days
  assert.deepEqual(daysOfSummary(first), days, 'the days ride the summary')
  assert.deepEqual(daysOfSummary(wiredResult(rawOf(undefined), first)), days, 'a page step brings no summary: the last days stay')
  assert.equal(daysOfSummary(wiredResult(rawOf({ ok: 2, issue: 1, not_checked: 4, total: 7 }), first)), undefined, 'a fresh summary without days does NOT keep the old chips')
  // The Worker's too-many-products answer (docs/contracts/inventory-check-requests-20261117.md section 4): { "tooLarge": true } and NOTHING else.
  const tooLarge = wiredResult(rawOf({ tooLarge: true }), first)
  assert.deepEqual(tooLarge.summary, { tooLarge: true }, 'tooLarge replaces the whole summary: no stale counts (not even a false 0) and no stale days')
  assert.deepEqual(checkDaysOf(tooLarge.summary), [], 'and no chips')
  assert.deepEqual(wiredResult(rawOf(undefined), tooLarge).summary, { tooLarge: true }, 'a page step (no summary) keeps the flag, and so keeps the rail hidden')
  const normal = wiredResult(rawOf({ ok: 1, issue: 0, not_checked: 2, total: 3, days }), tooLarge)
  assert.deepEqual([normal.summary && 'tooLarge' in normal.summary, daysOfSummary(normal)], [false, days], 'a later fresh summary brings the counts and the days back')
  assert.deepEqual(wiredResult(rawOf(undefined), first).summary?.tooLarge, undefined, 'contrast: a page step after a normal summary is not too large')
  // checkedOn belongs to the wired list (and its overlay) alone: neither older list, nor a session, ever hears of it
  assert.deepEqual(sessionScopeParams({ checkedOn: '2026-11-12', branchId: '1', query: '', brand: 'Acme', checkState: 'issue', sessionId: undefined }), { branchId: '1', brand: 'Acme', checkState: 'issue' }, 'the scope of a new count session keeps the filters but never the date chip (it answers checkedOn with a 400), and drops empty ones')
  for (const server of ['unknown', 'simple', 'old'] as const) assert.equal(Object.hasOwn(productsWireParams({ checkedOn: '2026-11-12', page: 1, pageSize: 20, branchId: 1 }, server, false), 'checkedOn'), false, `the ${server} products list is never sent checkedOn`)
  // the chip list: newest first, malformed or empty entries dropped, the chosen day kept on the rail
  assert.deepEqual(checkDaysOf({ days: [{ day: '2026-11-10', count: 1 }, { day: '2026-11-12', count: 2 }, { day: '2026-11-12', count: 9 }, { day: 'garbage', count: 1 }, { day: '2026-11-11', count: 0 }, { day: '2026-11-09', count: 1.5 }, null] }), [{ day: '2026-11-12', count: 2 }, { day: '2026-11-10', count: 1 }], 'sorted newest first; a repeat, a bad date and a zero or fractional count are dropped')
  assert.deepEqual(checkDaysOf({ days: 'nope' }), []); assert.deepEqual(checkDaysOf(undefined), []); assert.deepEqual(checkDaysOf({}), [])
  assert.deepEqual(dayChipsOf([{ day: '2026-11-12', count: 2 }], '2026-11-05'), [{ day: '2026-11-12', count: 2 }, { day: '2026-11-05' }], 'a chosen day the summary no longer lists stays on the rail, without a count')
  assert.deepEqual(dayChipsOf([{ day: '2026-11-12', count: 2 }], ''), [{ day: '2026-11-12', count: 2 }])
  assert.deepEqual(dayChipsOf([{ day: '2026-11-12', count: 2 }], 'not a day'), [{ day: '2026-11-12', count: 2 }], 'a malformed chosen day adds nothing')
  // a sole branch is left out of the query EXCEPT for a dated read (the date is per branch, as a status is)
  const wire: string[] = []
  const deps: WiredDeps = { readList: async (params: QueryParams) => { wire.push(buildQueryString(params)); return { items: [{ id: 1, name: 'A', branch_stock: [{ branch_id: 1, branch_name: 'B', quantity: 1 }] }], total: 1, page: 1, pageSize: 20, wired: true, projected: false } as WiredList }, readOverlay: async () => ({ items: [] }), peek: () => null, prime: () => {}, rank: () => null }
  const access = { stock: true, barcode: true, received: false }
  const known = { branches: [{ id: 1, name: 'B' }] }
  await loadWired({ params: { page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc', branchId: 1 }, known, skipSummary: false, access, deps })
  await loadWired({ params: { page: 1, pageSize: 20, sortBy: 'name', sortDirection: 'asc', branchId: 1, checkedOn: '2026-11-12' }, known, skipSummary: false, access, deps })
  assert.equal(wire[0].includes('branchId'), false, 'sole branch, no restriction: the branch is left out (the same read as Products)')
  assert.ok(wire[1].includes('branchId=1') && wire[1].includes('checkedOn=2026-11-12'), 'sole branch, dated read: the branch is named')
}

try {
  // ---- blind count: the shared store holds Products' rows WITH stock; this viewer's page must not read it ----
  listAnswer = () => listBody([productRow(12, 'Blind product', undefined)])
  held.set(CANONICAL, listBody([productRow(12, 'Held product', 7777)]))
  lists.length = 0
  {
    lists.length = 0; overlays.length = 0; authorityCurrent = true; epoch = 'epoch-a'; ranked = null
    open('hub:inventory:products')
    const surface = await harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app({ ...FIELDS, inventory_check_show_stock: false }), doubles, props: {} })
    assert.equal(lists.length, 1, 'a viewer without the stock field asks the server (it cuts stock from its own answer)')
    assert.ok(surface.text().includes('Blind product'), 'the server\'s rows are drawn')
    assert.ok(!surface.text().includes('Held product') && !surface.text().includes('7777'), 'nothing of the shared store reaches this page: no row and no stock figure from it')
    await surface.unmount()
  }

  // ---- a sync event names a row on screen: a hint, no read; the tap reads that id only ----
  listAnswer = query => query.get('ids') ? listBody([productRow(12, 'Sequence product', 5)]) : listBody([productRow(12, 'Sequence product', 8), productRow(13, 'Second product', 3)])
  {
    const surface = await mount()
    assert.ok(surface.text().includes('Sequence product'))
    assert.equal(lists.length, 1); assert.equal(overlays.length, 1)
    const hintNode = () => surface.findAll(node => node.getAttribute('data-inventory-check-changed-elsewhere') !== null)
    assert.equal(hintNode().length, 0, 'no hint while nothing changed')
    sync({ channel: 'products', payload: { id: 99, action: 'update' } })
    await surface.settle()
    assert.equal(hintNode().length, 0, 'a product that is not on screen says nothing')
    sync({ channel: 'sales', payload: { id: 12 } })
    await surface.settle()
    assert.equal(hintNode().length, 0, 'only products and inventory events count')
    sync({ channel: 'products', payload: { id: 12, action: 'update' } })
    await surface.settle()
    assert.equal(hintNode().length, 1, 'a products event naming a visible id shows the hint')
    assert.ok(surface.text().includes('inventory_check_changed_elsewhere') || surface.text().includes('Changed on another device'), 'with its words')
    assert.equal(lists.length, 1, 'and reads nothing: no automatic re-read'); assert.equal(overlays.length, 1)
    await wait(50)
    assert.equal(lists.length, 1, 'not later either')
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.textContent.includes('refresh'), 'the refresh tap'))
    await surface.waitFor(() => lists.length === 2, 'the by-id read')
    assert.equal(lists[1].get('ids'), '12', 'the tap reads the changed id only'); assert.equal(lists[1].get('branchId'), '1')
    await surface.waitFor(() => overlays.length === 2, 'its overlay')
    assert.equal(overlays[1].get('ids'), '12')
    await surface.waitFor(() => hintNode().length === 0, 'the hint clears')
    assert.ok(surface.text().includes('Second product'), 'the other rows stay')
    await surface.unmount()
  }

  // ---- search: the device index ranks, the page reads the ids ----
  {
    listAnswer = query => query.get('ids') ? listBody((query.get('ids') ?? '').split(',').map(id => productRow(Number(id), `Hit ${id}`, 2)).reverse()) : listBody([productRow(12, 'Sequence product', 8)])
    const surface = await mount()
    ranked = { hits: [{ id: 31, tier: 1 }, { id: 30, tier: 2 }], total: 2 }
    await surface.type(surface.find(node => node.getAttribute('id') === 'inventory-check-search', 'the search box'), 'soap')
    await surface.waitFor(() => lists.length === 2, 'the ranked read')
    assert.equal(lists[1].get('ids'), '31,30', 'the ranked ids are read by id'); assert.equal(lists[1].has('query'), false, 'no text goes to the server')
    await surface.waitFor(() => surface.text().includes('Hit 31'), 'the ranked rows are drawn')
    assert.ok(surface.text().indexOf('Hit 31') < surface.text().indexOf('Hit 30'), 'in the index\'s order, whatever order the server answered in')
    await surface.unmount()
  }

  // ---- late answers: dropped after an authority or a data epoch change ----
  {
    let calls = 0
    listAnswer = async () => { calls += 1; const first = calls === 1; await wait(first ? 80 : 5); return listBody([productRow(12, first ? 'Stale product' : 'Fresh product', 8)]) }
    lists.length = 0; overlays.length = 0; held.clear(); authorityCurrent = true; epoch = 'epoch-a'; ranked = null
    open('hub:inventory:products')
    const mounting = harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(FIELDS), doubles, props: {} })
    await wait(30)
    epoch = 'epoch-b'
    const surface = await mounting
    await surface.waitFor(() => surface.text().includes('Fresh product'), 'the second answer')
    assert.ok(!surface.text().includes('Stale product'), 'the answer that arrived after the data epoch changed was dropped')
    assert.equal(lists.length, 2, 'and the page read again')
    await surface.unmount()

    calls = 0
    lists.length = 0; overlays.length = 0; held.clear(); authorityCurrent = true; epoch = 'epoch-a'
    open('hub:inventory:products')
    const mountingB = harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(FIELDS), doubles, props: {} })
    await wait(30)
    authorityCurrent = false
    const surfaceB = await mountingB
    await wait(150)
    assert.ok(!surfaceB.text().includes('Stale product'), 'an answer that arrived after the authority changed is not drawn')
    assert.equal(overlays.length, 0, 'it is dropped before any overlay is asked for it')
    await surfaceB.unmount()
  }
  // ---- date chips on the page: the rail comes with the summary, a tap sends checkedOn (and the branch), All sends none, no days means no rail ----
  {
    const days = [{ day: '2026-11-10', count: 1 }, { day: '2026-11-12', count: 3 }]
    listAnswer = () => listBody([productRow(12, 'Sequence product', 8)], { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } })
    const surface = await mount()
    const chips = () => surface.findAll(node => node.getAttribute('data-day-chip') !== null)
    assert.deepEqual(chips().map(node => node.getAttribute('data-day-chip')), ['', '2026-11-12', '2026-11-10'], 'All, then newest first whatever order the server sent')
    assert.deepEqual(chips().map(node => node.textContent), ['All', '12/11/20263', '10/11/20261'], 'dd/mm/yyyy and the count')
    await surface.click(chips()[1])
    await surface.waitFor(() => lists.length === 2, 'the dated read')
    assert.equal(lists[1].get('checkedOn'), '2026-11-12'); assert.equal(lists[1].get('branchId'), '1')
    await surface.waitFor(() => chips().find(node => node.getAttribute('data-day-chip') === '2026-11-12')?.getAttribute('aria-pressed') === 'true', 'the chip is pressed')
    assert.equal(chips().length, 3, 'the rail keeps every date')
    await surface.click(chips()[0])
    await surface.waitFor(() => chips()[0].getAttribute('aria-pressed') === 'true', 'All is pressed again')
    assert.ok(lists.every((query, index) => index === 1 ? query.get('checkedOn') === '2026-11-12' : !query.has('checkedOn')), 'every other read carries no date')
    await surface.unmount()
    listAnswer = () => listBody([productRow(12, 'Sequence product', 8)], { summary: { tooLarge: true } })
    const large = await mount()
    assert.equal(large.findAll(node => node.getAttribute('data-day-chip') !== null).length, 0, 'tooLarge (the Worker answer { tooLarge: true }): no chips')
    assert.equal(large.findAll(node => node.getAttribute('data-inventory-check-status-rail') !== null).length, 0, 'and no status chips with counts that do not exist')
    await large.unmount()
    listAnswer = () => listBody([productRow(12, 'Sequence product', 8)])
    const none = await mount()
    assert.equal(none.findAll(node => node.getAttribute('data-day-chip') !== null).length, 0, 'no days: no chips')
    await none.unmount()
  }
  // ---- too many products: an answer that says so clears the chips and counts the page already holds; a page step that brings no summary keeps them ----
  {
    const days = [{ day: '2026-11-10', count: 1 }, { day: '2026-11-12', count: 3 }]
    const rows = (name: string) => [productRow(12, name, 8)]
    listAnswer = () => listBody(rows('Sequence product'), { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } })
    const surface = await mount()
    const chips = () => surface.findAll(node => node.getAttribute('data-day-chip') !== null)
    const statusRail = () => surface.findAll(node => node.getAttribute('data-inventory-check-status-rail') !== null)
    assert.equal(chips().length, 3, 'control: the rail is drawn from the first summary')
    assert.ok(statusRail().length === 1 && statusRail()[0].textContent.includes('5'), 'control: the status chips carry their counts')
    listAnswer = () => listBody(rows('Sequence product'), { summary: { tooLarge: true } })
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.textContent.startsWith('Not checked'), 'Not checked chip'))
    await surface.waitFor(() => lists.length === 2, 'the read that says too many')
    await surface.waitFor(() => chips().length === 0, 'the date rail is gone')
    assert.equal(statusRail().length, 0, 'the status chips (with their old counts) are gone too')
    assert.ok(!/Checked OK\s*3|Issues\s*1/.test(surface.text()), 'no count of the earlier answer is left on screen')
    await surface.unmount()

    // A page step asks for no summary and the server sends none: the days stay exactly as they are (the contract's "missing summary" case).
    const pages = (query: URLSearchParams) => listBody(rows(query.get('page') === '2' ? 'Page two product' : 'Page one product'), { total: 45, totalPages: 3, page: Number(query.get('page') || 1), ...(query.get('summary') === '0' ? { summary: undefined } : { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } }) })
    listAnswer = pages
    const stepper = await mount()
    const stepChips = () => stepper.findAll(node => node.getAttribute('data-day-chip') !== null)
    assert.equal(stepChips().length, 3, 'control: chips on page 1')
    await stepper.click(stepper.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'next', 'next page'))
    await stepper.waitFor(() => stepper.text().includes('Page two product'), 'page 2 is drawn')
    assert.equal(lists[1].get('summary'), '0', 'the page step asked for no summary')
    assert.deepEqual(stepChips().map(node => node.getAttribute('data-day-chip')), ['', '2026-11-12', '2026-11-10'], 'and the chips stay')
    await stepper.unmount()
  }

  // ---- a refused date: the server will not filter by checkedOn (400 naming it) or cannot (503 too many products); the page drops the date and lists every date, exactly as for a refused status ----
  {
    const days = [{ day: '2026-11-10', count: 1 }, { day: '2026-11-12', count: 3 }]
    for (const refusal of [{ code: 'inventory_check_invalid_query', parameter: 'checkedOn', status: 400 }, { code: 'inventory_check_filter_too_large', status: 503 }]) {
      listAnswer = query => {
        if (query.get('checkedOn')) throw Object.assign(new Error('refused'), refusal)
        return listBody([productRow(12, 'Sequence product', 8)], { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } })
      }
      const surface = await mount()
      const chips = () => surface.findAll(node => node.getAttribute('data-day-chip') !== null)
      await surface.click(chips()[1])
      await surface.waitFor(() => lists.length >= 2, 'the dated read')
      assert.equal(lists[1].get('checkedOn'), '2026-11-12')
      // The list of every date comes back (from Products' held answer or a new read: either way it carries no date).
      await surface.waitFor(() => chips()[0]?.getAttribute('aria-pressed') === 'true', `All is the chosen chip again after ${refusal.code}`)
      assert.ok(lists.slice(2).every(query => !query.has('checkedOn')), 'no read after the refusal carries the date')
      assert.ok(!surface.text().includes('Could not load Inventory'), `${refusal.code}: no "unavailable" with the date still set`)
      assert.ok(surface.text().includes('Sequence product'), 'the list is drawn')
      assert.equal(chips().length, 3, 'the rail is still there')
      await surface.unmount()
    }
    // contrast: a refusal that is NOT about the date (another parameter) is not swallowed by this recovery
    listAnswer = query => {
      if (query.get('checkedOn')) throw Object.assign(new Error('refused'), { code: 'inventory_check_invalid_query', parameter: 'branchId', status: 400 })
      return listBody([productRow(12, 'Sequence product', 8)], { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } })
    }
    const other = await mount()
    await other.click(other.findAll(node => node.getAttribute('data-day-chip') !== null)[1])
    await other.waitFor(() => other.text().includes('Could not load Inventory'), 'a refusal naming another parameter still shows the load error')
    assert.equal(lists.filter(query => !query.get('checkedOn')).length, 1, 'and does not retry without the date')
    await other.unmount()
  }

  // ---- "Not checked" and a date exclude each other: a product that was never counted has no date, so the two together would always list nothing ----
  {
    const days = [{ day: '2026-11-10', count: 1 }, { day: '2026-11-12', count: 3 }]
    listAnswer = () => listBody([productRow(12, 'Sequence product', 8)], { summary: { ok: 3, issue: 1, not_checked: 5, total: 9, days } })
    const surface = await mount()
    const dayChip = (day: string) => surface.find(node => node.getAttribute('data-day-chip') === day, `day chip ${day}`)
    const statusChip = () => surface.find(node => node.tagName === 'BUTTON' && node.textContent.startsWith('Not checked'), 'Not checked chip')
    const last = () => lists[lists.length - 1]
    await surface.click(dayChip('2026-11-12'))
    await surface.waitFor(() => lists.length === 2, 'the dated read')
    assert.equal(last().get('checkedOn'), '2026-11-12'); assert.equal(last().has('checkState'), false)
    // Not checked while a date is chosen: the date goes (the read has the status and no date), and All on the rail is pressed again.
    await surface.click(statusChip())
    await surface.waitFor(() => lists.length === 3, 'the Not checked read')
    assert.equal(last().get('checkState'), 'not_checked', 'the status is asked for'); assert.equal(last().has('checkedOn'), false, 'and the date is gone')
    await surface.waitFor(() => dayChip('').getAttribute('aria-pressed') === 'true', 'All is the chosen date chip')
    assert.equal(statusChip().getAttribute('aria-pressed'), 'true', 'Not checked is pressed')
    // A date while Not checked is chosen: the status goes (the read has the date and no status), and Not checked is no longer pressed.
    await surface.click(dayChip('2026-11-10'))
    await surface.waitFor(() => lists.length === 4, 'the second dated read')
    assert.equal(last().get('checkedOn'), '2026-11-10', 'the date is asked for'); assert.equal(last().has('checkState'), false, 'and the status is gone')
    await surface.waitFor(() => statusChip().getAttribute('aria-pressed') === 'false', 'Not checked is not pressed')
    assert.equal(dayChip('2026-11-10').getAttribute('aria-pressed'), 'true')
    // Another status keeps a chosen date (only Not checked, which has no date, excludes it).
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.textContent.startsWith('Checked OK'), 'Checked OK chip'))
    await surface.waitFor(() => lists.length === 5, 'the Checked OK read')
    assert.deepEqual([last().get('checkState'), last().get('checkedOn')], ['ok', '2026-11-10'], 'Checked OK on a date is a real question and keeps both')
    await surface.unmount()
  }
  // ---- C2 review, finding 9: "Open request" opens the session that holds the waiting request. A count submitted on 12 Nov and still waiting, then observed again on 13 Nov in another session: the
  // overlay's latest count is the 13 Nov session (which has no approval), and its pending mark names the 12 Nov one. ----
  {
    listAnswer = () => listBody([productRow(12, 'Waiting product', 8)], { capabilities: { fixStock: true } })
    const waiting = { product_id: 12, last_change_at: null, pending: true, check: { state: 'ok', counted_quantity: 9, seen_quantity: 8, note: null, at: '2026-11-13T01:00:00.000Z', session_id: 'session-13-nov', revision: 1 } }
    const openFrom = async (entry: Row) => {
      const surface = await mount(FIELDS, [entry])
      await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Waiting product', 'product button'))
      sessionsOpened.length = 0
      await surface.click(surface.find(node => node.getAttribute('data-check-open-request') !== null, 'Open request chip'))
      const opened = [...sessionsOpened]; await surface.unmount(); return opened
    }
    assert.deepEqual(await openFrom({ ...waiting, pending_session_id: 'session-12-nov' }), ['session-12-nov'], 'the session that holds the request, not the latest count')
    assert.deepEqual(await openFrom(waiting), ['session-13-nov'], 'the control: a server that names no pending session falls back to the latest count, as before')
  }
  console.log('inventoryChecksWired passed: blind store, changed-elsewhere hint, by-id refresh, ranked search, late answers, date chips, too many products, refused date')
} finally {
  await harness.close()
}
