import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

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
const overlays: URLSearchParams[] = []
const held = new Map<string, unknown>()
let authorityCurrent = true
let epoch = 'epoch-a'
let ranked: { hits: Array<{ id: number; tier: number }>; total: number } | null = null
const CANONICAL = 'page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots'
const listBody = (items: Row[], extra: Row = {}) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1, wired: true, projected: false, summary: { ok: 0, issue: 0, not_checked: items.length, total: items.length }, ...extra })

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
    readInventoryCheckOverlay: async (params: { branchId: number | string; ids: Array<number | string>; lots?: boolean }) => {
      overlays.push(new URL(appendQuery('/api/inventory-checks/overlay', buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}) })), 'https://admin.example.test').searchParams)
      return { wired: true, branchId: Number(params.branchId), items: params.ids.map(id => overlayEntries.get(Number(id)) ?? { product_id: Number(id), last_change_at: null }) }
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
  console.log('inventoryChecksWired passed: blind store, changed-elsewhere hint, by-id refresh, ranked search, late answers')
} finally {
  await harness.close()
}
