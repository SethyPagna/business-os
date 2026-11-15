import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests } from '../src/api/http.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

// N2 (round 3): the per-date entries chunk fails with an error lazyRetry does not recognise as a chunk error: the popover's own boundary shows a compact inline retry, the page and every count stay.
// (Its own file: the entries chunk is loaded once per module graph, so a second fault cannot follow a first success.)
const FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts', 'api/dataEpoch.ts', 'api/productSearchIndex.ts', 'components/inventory/inventoryCheckLotChunk.ts'] })
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
let seedOverlay: Map<number, Record<string, unknown>> | null = null
const adjusts: Array<Record<string, unknown>> = []
const submissions: Array<Record<string, unknown>> = []
/** The on-demand batch reads the count popover made: [productId, branchId]. */
const lotReads: Array<[number, number]> = []
let submitAnswer: (input: Record<string, unknown>) => unknown = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
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
    submitInventoryCheckCounts: async (_scope: unknown, input: Record<string, unknown>) => { submissions.push(input); return submitAnswer(input) },
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
    // The popover's one request per opened product (GET /api/inventory-checks/lots): the batches the row's list answer carries stand in for what the server would answer.
    readInventoryCheckLots: async (params: { productId: number | string; branchId: number | string }) => {
      lotReads.push([Number(params.productId), Number(params.branchId)])
      const lots = Number(params.productId) === 12 ? [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }] : []
      return { productId: Number(params.productId), branchId: Number(params.branchId), lots }
    },
    readInventoryCheckProducts: async () => { throw new Error('the older list must not be asked while ic_wired is on') },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: null, items: [] }),
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
async function mount(permissions: Record<string, boolean> = FIELDS) {
  lists.length = 0; overlays.length = 0; held.clear(); authorityCurrent = true; epoch = 'epoch-a'; ranked = null; overlayEntries = seedOverlay ?? new Map(); seedOverlay = null
  open('hub:inventory:products')
  return harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app: app(permissions), doubles, props: {} })
}

const withLots = (row: Row): Row => ({ ...row, lots: [
  { id: 7, received_at: '2026-10-01', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 9, received_at: '2026-10-09', branches: [{ branch_id: 1, quantity: 3 }] }] })
const capabilities = { fixStock: true, approveCounts: false, lotCounts: true, directSet: true }
const rowOf = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-inventory-check-row') === id, 'row ' + id)
// 14 Nov: the status icon of a row opens the count popover, which reads that product's batches (one request) and holds a count box per batch.
const statusButton = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-action') === 'status' && rowOf(surface, id).contains(node), 'status button ' + id)
const openCount = async (surface: Awaited<ReturnType<typeof mount>>, id: string) => { await surface.click(statusButton(surface, id)); await new Promise(resolve => setTimeout(resolve, 20)) }
const dateInput = (surface: Awaited<ReturnType<typeof mount>>, batch: number) => surface.find(node => node.getAttribute('data-popover-lot-count') === String(batch), `date ${batch}`)
const rowCount = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-count') !== null && rowOf(surface, id).contains(node), 'row count ' + id) as unknown as { value: string; getAttribute: (name: string) => string | null }
const rowInput = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-count') !== null && rowOf(surface, id).contains(node), 'row count ' + id)

try {
  const chunkKey = 'components/inventory/inventoryCheckLotChunk.ts'
  let attempts = 0
  ;(doubles as Record<string, Record<string, unknown>>)[chunkKey] = { loadLotEntries: () => { attempts += 1; return Promise.reject(new Error('boom: not a chunk error')) } }
  listAnswer = () => listBody([withLots(productRow(12, 'Dated one', 8)), productRow(13, 'Plain product', 4)], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 2, total: 2 } })
  const errors: unknown[] = []
  const savedError = console.error
  console.error = (...args: unknown[]) => { errors.push(String(args[0]).slice(0, 80)) }
  const surface = await mount()
  await surface.type(rowInput(surface, '13'), '3')
  await openCount(surface, '12')
  await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'differs', 'differs'))
  await new Promise(resolve => setTimeout(resolve, 100))
  console.error = savedError
  assert.ok(attempts >= 1)
  assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length, 2, 'the page and its rows survive')
  assert.equal(rowCount(surface, '13').value, '3', 'the unsubmitted count survived')
  assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-popover') !== null).length, 1, 'the popover stays open')
  assert.equal(surface.findAll(node => node.getAttribute('data-popover-chunk-failed') !== null).length, 1, 'a compact inline message is shown')
  assert.equal(surface.findAll(node => node.getAttribute('data-popover-action') === 'differs').length, 1, 'the quick answers still work')
  delete (doubles as Record<string, unknown>)[chunkKey]
  await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'retry-entries', 'retry'))
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(surface.findAll(node => node.getAttribute('data-popover-chunk-failed') !== null).length, 0)
  await surface.type(dateInput(surface, 7), '4')
  assert.equal(rowCount(surface, '12').value, '4', 'after the retry the entries work')
  assert.equal(rowCount(surface, '13').value, '3')
  await surface.unmount()
  console.log('inventoryChecksLotChunkFailure passed: a chunk that fails to load shows an inline retry, keeps the page and the counts, and the retry brings the entries back')
} finally {
  await harness.close()
}
