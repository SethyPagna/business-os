import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

// INV-B S1 (Inventory replan rev. 2, 4 Nov 2026): how the Inventory Check page opens, pinned for every server it can meet.
//
// ic_wired OFF (today): the list request goes out with NO branchId; when the answer lists exactly ONE branch the page selects it and remounts, and the remount sends the same
// request again with branchId -- a sequential waterfall, both at full cost (about 2.5M rows each on the live list). Pinned for ic_simple OFF and ON; a shop with two branches
// has no waterfall. A tab that has not yet seen the switch asks GET /list first, gets a 404 and carries on exactly as above (one probe per tab, then remembered).
//
// ic_wired ON (INV-B S4b): ONE list request. The sole branch is read from the rows' branch_stock, the overlay (the users' counts) is the only other request, and the remount that
// follows takes the open request's answer with it instead of asking again. EXPECTED_REQUESTS_ONE_BRANCH was 2 before S4b and is 1 now.
const EXPECTED_REQUESTS_ONE_BRANCH = 1
const EXPECTED_REQUESTS_ONE_BRANCH_OFF = 2

const COUNT_FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const entries: string[] = []
let entryIndex = 0
const applyLocation = (url: string) => {
  const next = new URL(url, 'https://admin.example.test/')
  Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash })
}
const open = (hash: string) => { entries.splice(0, entries.length, `https://admin.example.test/inventory#${hash}`); entryIndex = 0; applyLocation(entries[0]) }
window.history.pushState = (_state, _unused, url) => { entries.splice(entryIndex + 1); entries.push(new URL(String(url), 'https://admin.example.test/').href); entryIndex += 1; applyLocation(entries[entryIndex]) }
window.history.replaceState = (_state, _unused, url) => { entries[entryIndex] = new URL(String(url), 'https://admin.example.test/').href; applyLocation(entries[entryIndex]) }

type Call = { query: URLSearchParams; overlapped: boolean; answersBefore: number }
const calls: Call[] = []
let inFlight = 0
let answered = 0
let branches: Array<{ id: number; name: string }> = []
let simple = false
let wiredOn = false
const listCalls: Call[] = []
const overlayCalls: Array<{ query: URLSearchParams; listsAnswered: number }> = []
let listsAnswered = 0
const probes: string[] = []
const heldByProducts = new Map<string, unknown>()
const answer = (query: URLSearchParams) => {
  const base = { items: [{ id: 12, name: 'Sequence product', quantity: 8, unit: 'pcs' }], total: 45, page: Number(query.get('page') ?? 1), pageSize: 20, branches }
  const facets = { brands: ['Test brand'], categories: ['Test category'] }
  const limited = { brands: false, categories: false, reasons: false }
  if (!simple) return { ...base, facets: { ...facets, reasons: [] }, facetsLimited: limited, stats: { total_products: 45 }, issues: [] }
  return { ...base, simple: true, summary: { not_checked: 40, in_check: 2, ok: 2, issue: 1, total: 45 }, facets, facetsLimited: limited }
}
const wiredList = (query: URLSearchParams) => ({
  items: [{ id: 12, name: 'Sequence product', unit: 'pcs', stock_quantity: 8 * branches.length, branch_stock: branches.map(branch => ({ branch_id: branch.id, branch_name: branch.name, quantity: 8 })) }],
  total: 45, page: Number(query.get('page') ?? 1), pageSize: 20, totalPages: 3, wired: true, projected: false, summary: { ok: 2, issue: 1, not_checked: 42, total: 45 },
})
const app = {
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...COUNT_FIELDS } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, notify: () => {},
  settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  navigateTo: (page: string, anchor?: string) => {
    window.history.pushState(null, '', `/inventory#${anchor || ''}`)
    window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } }))
  },
}
const doubles = {
  'api/productReadTransport.ts': {
    peekProductSearch: (query: string) => heldByProducts.get(query) ?? null,
    primeProductSearch: (query: string, payload: unknown) => { heldByProducts.set(query, payload) },
    getProductFilters: async () => ({ brands: [], categories: [] }),
  },
  'utils/dirtyWork.ts': dirtyWork,
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }),
    captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => true,
    isActorWriteIdentityCurrent: () => true,
  },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    // An answer takes a real moment, so a second request sent without waiting for it would show up as overlapping.
    readInventoryCheckProducts: async (params: QueryParams) => {
      const url = appendQuery('/api/inventory-checks/products', buildQueryString(params))
      const query = new URL(url, 'https://admin.example.test').searchParams
      calls.push({ query, overlapped: inFlight > 0, answersBefore: answered })
      inFlight += 1
      await new Promise(resolve => setTimeout(resolve, 15))
      inFlight -= 1
      answered += 1
      return answer(query)
    },
    readInventoryCheckList: async (params: QueryParams) => {
      const url = appendQuery('/api/inventory-checks/list', buildQueryString(params))
      const query = new URL(url, 'https://admin.example.test').searchParams
      if (!wiredOn) { probes.push(url); throw Object.assign(new Error('Not found'), { status: 404, code: 'not_found' }) }
      listCalls.push({ query, overlapped: inFlight > 0, answersBefore: answered })
      inFlight += 1
      await new Promise(resolve => setTimeout(resolve, 15))
      inFlight -= 1
      answered += 1; listsAnswered += 1
      return wiredList(query)
    },
    readInventoryCheckOverlay: async (params: { branchId: number | string; ids: Array<number | string>; lots?: boolean }) => {
      const query = new URL(appendQuery('/api/inventory-checks/overlay', buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}) })), 'https://admin.example.test').searchParams
      overlayCalls.push({ query, listsAnswered })
      await new Promise(resolve => setTimeout(resolve, 5))
      return { wired: true, branchId: Number(params.branchId), items: params.ids.map(id => ({ product_id: Number(id), last_change_at: null })) }
    },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: null, items: [] }),
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}

async function openPage(shopBranches: Array<{ id: number; name: string }>, icSimple: boolean, wired = false) {
  calls.length = 0; listCalls.length = 0; overlayCalls.length = 0; probes.length = 0; heldByProducts.clear()
  inFlight = 0; answered = 0; listsAnswered = 0
  branches = shopBranches; simple = icSimple; wiredOn = wired
  open('hub:inventory:products')
  const surface = await harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
  return surface
}

try {
  // ---- ic_wired ON, one branch: ONE list request, then the overlay; the remount takes the answer along ----
  const wired = await openPage([{ id: 1, name: 'Only branch' }], true, true)
  assert.ok(wired.text().includes('Sequence product'), 'ic_wired ON, one branch: the list is drawn')
  assert.ok(!wired.text().includes('unavailable'), 'ic_wired ON, one branch: no load error')
  assert.equal(listCalls.length, EXPECTED_REQUESTS_ONE_BRANCH, 'ic_wired ON, one branch: list requests on open (S4b: 1; the waterfall was 2)')
  assert.equal(calls.length, 0, 'ic_wired ON: the older list is not asked at all')
  assert.equal(listCalls[0].query.has('branchId'), false, 'ic_wired ON, one branch: the open request names no branch')
  assert.equal(listCalls[0].query.get('page'), '1'); assert.equal(listCalls[0].query.get('pageSize'), '20')
  assert.equal(listCalls[0].query.has('sessionId'), false, 'ic_wired ON: the older list keys do not go to /list')
  assert.equal(overlayCalls.length, 1, 'ic_wired ON, one branch: one overlay request')
  assert.equal(overlayCalls[0].query.get('branchId'), '1', 'the overlay carries the sole branch, taken from the branch_stock of the rows')
  assert.equal(overlayCalls[0].query.get('ids'), '12', 'and only the ids on screen')
  assert.equal(overlayCalls[0].listsAnswered, 1, 'it starts after the list answered (it needs the ids)')
  assert.equal(probes.length, 0)
  await wired.unmount()

  // ---- ic_wired ON, Products already holds the rows: 0 list requests ----
  const canonical = 'page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots'
  const heldRows = { items: [{ id: 12, name: 'Sequence product', unit: 'pcs', stock_quantity: 8, branch_stock: [{ branch_id: 1, branch_name: 'Only branch', quantity: 8 }] }], total: 45, page: 1, pageSize: 20, totalPages: 3 }
  calls.length = 0; listCalls.length = 0; overlayCalls.length = 0; heldByProducts.clear(); heldByProducts.set(canonical, heldRows)
  branches = [{ id: 1, name: 'Only branch' }]; wiredOn = true; listsAnswered = 0; inFlight = 0; answered = 0
  open('hub:inventory:products')
  const held = await harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
  assert.ok(held.text().includes('Sequence product'), 'Products holds the rows: they are drawn')
  assert.equal(listCalls.length, 0, 'Products holds the rows: 0 list requests')
  assert.equal(overlayCalls.length, 1, 'Products holds the rows: the overlay is the one request')
  assert.equal(overlayCalls[0].query.get('branchId'), '1')
  await held.unmount()

  // ---- ic_wired ON, two branches: one list request, no overlay until a branch is chosen ----
  const wiredTwo = await openPage([{ id: 1, name: 'Branch one' }, { id: 2, name: 'Branch two' }], true, true)
  assert.ok(wiredTwo.text().includes('Sequence product'), 'ic_wired ON, two branches: the list is drawn')
  assert.equal(listCalls.length, 1, 'ic_wired ON, two branches: one list request'); assert.equal(overlayCalls.length, 0, 'counts are per branch: no overlay for all branches')
  await wiredTwo.unmount()

  // ---- ic_wired OFF: today's behaviour, exactly ----
  let probed = 0
  for (const icSimple of [false, true]) {
    const server = icSimple ? 'ic_simple ON' : 'ic_simple OFF'

    // ---- one branch: the waterfall (today: 2, one after the other) ----
    const one = await openPage([{ id: 1, name: 'Only branch' }], icSimple)
    probed += probes.length
    assert.ok(one.text().includes('Sequence product'), `${server}, one branch: the list is drawn`)
    assert.ok(!one.text().includes('unavailable'), `${server}, one branch: no load error`)
    assert.equal(calls.length, EXPECTED_REQUESTS_ONE_BRANCH_OFF, `${server}, one branch: list requests on open (the waterfall is 2)`)
    assert.equal(listCalls.length, 0); assert.equal(overlayCalls.length, 0, 'ic_wired OFF: no wired answer is ever used')
    assert.equal(calls[0].query.has('branchId'), false, `${server}, one branch: the first request names no branch`)
    for (const call of calls) {
      assert.equal(call.query.get('page'), '1'); assert.equal(call.query.get('pageSize'), '20')
      assert.equal(call.query.get('sortBy'), 'name'); assert.equal(call.query.get('sortDirection'), 'asc')
      assert.equal(call.query.has('summary'), false, `${server}: the first page asks for its summary`)
      assert.deepEqual([...call.query.keys()].sort(), ['page', 'pageSize', 'sortBy', 'sortDirection', ...(call.query.has('branchId') ? ['branchId'] : [])].sort(), `${server}: the request carries exactly today keys`)
    }
    assert.equal(calls[1].query.get('branchId'), '1', `${server}, one branch: the second request carries the sole branch`)
    assert.equal(calls[1].answersBefore, 1, `${server}, one branch: the second request starts only after the first was answered (sequential)`)
    assert.deepEqual(calls.map(call => call.overlapped), [false, false], `${server}, one branch: the two requests never overlap`)
    await one.unmount()

    // ---- control: two branches, no waterfall ----
    const two = await openPage([{ id: 1, name: 'Branch one' }, { id: 2, name: 'Branch two' }], icSimple)
    probed += probes.length
    assert.ok(two.text().includes('Sequence product'), `${server}, two branches: the list is drawn`)
    assert.equal(calls.length, 1, `${server}, two branches: one request (positive control: only a single-branch shop waterfalls)`)
    assert.equal(calls[0].query.has('branchId'), false, `${server}, two branches: the open request names no branch`)
    await two.unmount()
  }
  assert.equal(probed, 1, 'ic_wired OFF: the tab asks /list once, gets a 404 and remembers it')
  console.log('inventoryChecksOpenSequence passed: ic_wired ON opens with 1 list request (0 when Products holds the rows); OFF keeps the 2-request waterfall; two branches send 1')
} finally {
  await harness.close()
}
