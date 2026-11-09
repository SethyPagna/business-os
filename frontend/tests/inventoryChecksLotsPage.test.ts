import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

// INV-B S5: the mounted Inventory page with ic_lot_counts: the status choice in one scrolling row, counts typed per received date, and a Set straight from the row
// (confirm with before and after, the row patched from the answer, no page read; a stale figure is shown and nothing is written).
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
const adjusts: Array<Record<string, unknown>> = []
let adjustAnswer: (payload: Record<string, unknown>) => unknown = () => ({})
let listAnswer: (query: URLSearchParams) => Row | Promise<Row> = () => ({})
let overlayEntries = new Map<number, Row>()
const lists: URLSearchParams[] = []
const overlays: URLSearchParams[] = []
const held = new Map<string, unknown>()
let authorityCurrent = true
let epoch = 'epoch-a'
let ranked: { hits: Array<{ id: number; tier: number }>; total: number } | null = null
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
  'api/inventoryWriteTransport.ts': { adjustStock: async (payload: Record<string, unknown>) => { adjusts.push(payload); return adjustAnswer(payload) } },
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

const withLots = (row: Row): Row => ({ ...row, lots: [
  { id: 7, received_at: '2026-10-01', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 9, received_at: '2026-10-09', branches: [{ branch_id: 1, quantity: 3 }] }] })
const capabilities = { fixStock: true, approveCounts: false, lotCounts: true, directSet: true }
const answerOf = (summary = { ok: 2, issue: 1, pending: 1, not_checked: 5, total: 8 }) => listBody([withLots(productRow(12, 'Dated product', 8))], { capabilities, summary })
const exact = (surface: Awaited<ReturnType<typeof mount>>, text: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text)
const inside = (surface: Awaited<ReturnType<typeof mount>>, attribute: string) => surface.find(node => node.getAttribute(attribute) !== null, attribute)
const dateInput = (surface: Awaited<ReturnType<typeof mount>>, batch: number) => surface.find(node => node.getAttribute('data-check-lot-count') !== null && node.parentNode?.getAttribute('data-check-lot') === String(batch), `date ${batch}`)

try {
  // ---- the status choice: one row (the shared chip rail), every status with its count, a tap filters ----
  {
    listAnswer = () => answerOf()
    const surface = await mount()
    const rail = inside(surface, 'data-inventory-check-status-rail')
    const labels = rail.querySelectorAll('button').map(node => node.textContent)
    assert.deepEqual(labels, ['all', 'Not checked5', 'Checked OK2', 'Issues1', 'Waiting for approval1'], 'every status in ONE rail, with how many are in it')
    assert.ok(String(rail.getAttribute('class') ?? '').includes('chip-rail'), 'the shared rail: it scrolls sideways and never wraps')
    const before = lists.length
    await surface.click(surface.button('Issues', rail))
    assert.ok(lists.length > before && lists.at(-1)!.get('checkState') === 'issue', 'a tap on a status asks the list for it')
    await surface.unmount()
  }
  // ---- a row picked: its received dates, a count on each; Set from a date confirms before and after, patches the row, reads no page ----
  {
    listAnswer = () => answerOf(); adjusts.length = 0
    const surface = await mount()
    assert.equal(surface.findAll(node => node.getAttribute('data-check-lot') !== null).length, 0, 'a row not picked is one line')
    await surface.call(inside(surface, 'data-check-select'), 'onChange', [{ target: { checked: true } }])
    assert.deepEqual(surface.findAll(node => node.getAttribute('data-check-lot') !== null).map(node => node.getAttribute('data-check-lot')), ['7', '9'], 'the picked row shows the dates it holds')
    await surface.type(dateInput(surface, 7), '4')
    assert.equal((inside(surface, 'data-check-count') as unknown as { value: string }).value, '4', 'the row count is the sum of its dates')
    const lists0 = lists.length, overlays0 = overlays.length
    adjustAnswer = payload => ({ productId: 12, branchId: 1, batchId: payload.batchId, before: { lotQuantity: 5, branchQuantity: 8 }, after: { lotQuantity: 4, branchQuantity: 7 } })
    await surface.click(inside(surface, 'data-check-action') && surface.find(node => node.getAttribute('data-check-action') === 'set-lot', 'Set button'))
    assert.equal(adjusts.length, 0, 'nothing is written until it is confirmed')
    const review = surface.find(node => node.tagName === 'DL', 'review').textContent
    assert.ok(review.includes('5 → 4'), 'the review shows the stock before and after: ' + review)
    await surface.click(exact(surface, 'Cancel').at(-1)!)
    assert.equal(adjusts.length, 0, 'Cancel writes nothing')
    await surface.click(surface.find(node => node.getAttribute('data-check-action') === 'set-lot', 'Set button'))
    await surface.click(exact(surface, 'Set').at(-1)!)
    assert.equal(adjusts.length, 1)
    assert.deepEqual({ ...adjusts[0], client_request_id: String(adjusts[0].client_request_id).startsWith('inventory_set') }, { type: 'set', setScope: 'lot', productId: 12, branchId: 1, batchId: 7, quantity: 4, expectedLotQuantity: 5, reason: 'Inventory check', client_request_id: true })
    assert.equal(lists.length, lists0, 'a Set reads no list page'); assert.equal(overlays.length, overlays0, 'and no overlay')
    const dates = surface.findAll(node => node.getAttribute('data-check-lot') === '7')[0].textContent
    assert.ok(dates.includes('4'), 'the row shows the writer\'s figure')
    assert.equal((dateInput(surface, 7) as unknown as { value: string }).value, '', 'the typed figure is cleared once it is the stock')
    // a stale figure: the writer refuses with what the stock is now; the row shows it, nothing is written, the person decides again
    await surface.type(dateInput(surface, 9), '1')
    adjustAnswer = () => { throw Object.assign(new Error('conflict'), { status: 409, code: 'stock_conflict', current: { lotQuantity: 6, branchQuantity: 10 } }) }
    await surface.click(surface.find(node => node.getAttribute('data-check-action') === 'set-lot', 'Set button'))
    await surface.click(exact(surface, 'Set').at(-1)!)
    assert.equal(adjusts.length, 2); assert.equal(adjusts[1].expectedLotQuantity, 3)
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('Stock changed. Now: 6')), 'the person is told what the stock is now')
    assert.ok(surface.findAll(node => node.getAttribute('data-check-lot') === '9')[0].textContent.includes('6'), 'the date shows the figure the writer found')
    assert.equal(lists.length, lists0, 'a refusal reads no page either')
    await surface.unmount()
  }
  // ---- the switch off: the older row, no dates ----
  {
    listAnswer = () => listBody([withLots(productRow(12, 'Dated product', 8))], { capabilities: { fixStock: true, approveCounts: false } })
    const surface = await mount()
    await surface.call(inside(surface, 'data-check-select'), 'onChange', [{ target: { checked: true } }])
    assert.equal(surface.findAll(node => node.getAttribute('data-check-lot') !== null).length, 0, 'no date list without lotCounts')
    await surface.unmount()
  }
  console.log('inventoryChecksLotsPage passed: status rail, dates on a picked row, Set with review and no page read, stale figure, switch off')
} finally {
  await harness.close()
}
