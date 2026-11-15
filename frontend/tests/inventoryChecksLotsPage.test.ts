import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, apiFetch, setSyncServerUrl } from '../src/api/http.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

// INV-B S5 (14 Nov: counted in the status icon's popover, batches read on demand): the mounted Inventory page with ic_lot_counts: the status choice in one scrolling row, counts typed per received date, and a Set straight from the row
// (confirm with before and after, the row patched from the answer, no page read; a stale figure is shown and nothing is written).
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
let lotsAnswer: ((productId: number) => Record<string, unknown>) | null = null
let submitAnswer: (input: Record<string, unknown>) => unknown = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
/** The error the page really receives for a 400: built by the real apiFetch from a stubbed network answer, not by hand (it carries the code, never the parameter name). */
async function realRefusal(body: Record<string, unknown>, status = 400): Promise<Error> {
  const saved = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
  setSyncServerUrl('https://admin.example.test'); __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  try { await apiFetch('GET', '/api/inventory-checks/list?x=1'); throw new Error('the stub answered 400 but apiFetch did not throw') } catch (error) { return error as Error } finally { globalThis.fetch = saved }
}
let realRefusalSync: Error = new Error('unset')
const sync = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('sync:update', { detail }))
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
      if (lotsAnswer) return lotsAnswer(Number(params.productId))
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
const answerOf = (summary = { ok: 2, issue: 1, pending: 1, not_checked: 5, total: 8 }) => listBody([withLots(productRow(12, 'Dated product', 8))], { capabilities, summary })
const exact = (surface: Awaited<ReturnType<typeof mount>>, text: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text)
const inside = (surface: Awaited<ReturnType<typeof mount>>, attribute: string) => surface.find(node => node.getAttribute(attribute) !== null, attribute)
const rowOf = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-inventory-check-row') === id, 'row ' + id)
// 14 Nov: the status icon of a row opens the count popover, which reads that product's batches (one request) and holds a count box per batch.
const statusButton = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-action') === 'status' && rowOf(surface, id).contains(node), 'status button ' + id)
const openCount = async (surface: Awaited<ReturnType<typeof mount>>, id: string) => { await surface.click(statusButton(surface, id)); await new Promise(resolve => setTimeout(resolve, 20)) }
const closeCount = async (surface: Awaited<ReturnType<typeof mount>>) => { await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'close', 'popover close')) }
const dateInput = (surface: Awaited<ReturnType<typeof mount>>, batch: number) => surface.find(node => node.getAttribute('data-popover-lot-count') === String(batch), `date ${batch}`)
const rowCount = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-count') !== null && rowOf(surface, id).contains(node), 'row count ' + id) as unknown as { value: string; getAttribute: (name: string) => string | null }
const rowInput = (surface: Awaited<ReturnType<typeof mount>>, id: string) => surface.find(node => node.getAttribute('data-check-count') !== null && rowOf(surface, id).contains(node), 'row count ' + id)
const setButton = (surface: Awaited<ReturnType<typeof mount>>) => surface.find(node => node.getAttribute('data-popover-action') === 'set-lot', 'Set button')
const lotLine = (surface: Awaited<ReturnType<typeof mount>>, batch: number) => surface.find(node => node.getAttribute('data-popover-lot') === String(batch), `lot ${batch}`)

try {
  // ---- N2 (review 14 Nov round 2): the per-date entries chunk fails to load. It goes first: the chunk is still unloaded, so the fault is real. The page, its rows and every unsubmitted count survive, the person is
  // offered a retry (the project's lazyRetry recovery, no reload while counts are unsubmitted), the warm-up's rejection is swallowed, and a retry brings the entries back. ----
  {
    const chunkKey = 'components/inventory/inventoryCheckLotChunk.ts'
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    let attempts = 0
    ;(doubles as Record<string, Record<string, unknown>>)[chunkKey] = { loadLotEntries: () => { attempts += 1; return Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/InventoryCheckLotEntries.js')) } }
    listAnswer = () => listBody([withLots(productRow(12, 'Dated one', 8)), productRow(13, 'Plain product', 4)], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 2, total: 2 } })
    const surface = await mount()
    await surface.type(rowInput(surface, '13'), '3')
    await openCount(surface, '12')
    await new Promise(resolve => setTimeout(resolve, 1500))
    assert.ok(attempts >= 3, 'the import was retried quietly (' + attempts + ')')
    assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length, 2, 'the page and its rows are still there')
    assert.equal(rowCount(surface, '13').value, '3', 'the unsubmitted count survived')
    assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-popover') !== null).length, 1, 'the popover is still open')
    assert.equal(surface.findAll(node => node.getAttribute('data-lazy-retry') !== null).length, 1, 'a retry is offered inside it')
    delete (doubles as Record<string, unknown>)[chunkKey]
    await surface.click(surface.find(node => node.getAttribute('data-lazy-retry') !== null, 'retry'))
    await new Promise(resolve => setTimeout(resolve, 100))
    await surface.type(dateInput(surface, 7), '4')
    assert.equal(rowCount(surface, '12').value, '4', 'after the retry the entries work')
    assert.equal(rowCount(surface, '13').value, '3', 'and the other count is untouched')
    process.off('unhandledRejection', onUnhandled)
    assert.deepEqual(unhandled, [], 'no rejection went unhandled (the warm-up swallows its own)')
    await surface.unmount()
  }
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
  // ---- the page reads nothing for batches: drawing the list asks for none; opening a row asks for that one product's, in one request ----
  {
    listAnswer = () => answerOf(); lotReads.length = 0
    const surface = await mount()
    assert.deepEqual(lotReads, [], 'no batch is read for the page')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') !== null).length, 0, 'and no batch line is drawn')
    assert.equal(surface.findAll(node => node.getAttribute('data-selected') !== null).length, 0, 'nothing is ticked by default')
    await openCount(surface, '12')
    assert.deepEqual(lotReads, [], 'F3: a normal open reads nothing: the entries are drawn from the batches the row already carries, at the first paint')
    assert.deepEqual(surface.findAll(node => node.getAttribute('data-popover-lot') !== null).map(node => node.getAttribute('data-popover-lot')), ['7', '9'], 'the popover shows the batches it holds')
    await surface.unmount()
  }
  // ---- F3: a row that says lots_more (more dates than the list carries) reads that one product's batches, once, when opened ----
  {
    listAnswer = () => listBody([{ ...withLots(productRow(12, 'Dated product', 8)), lots_more: true }], { capabilities, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } }); lotReads.length = 0
    const surface = await mount()
    await openCount(surface, '12')
    assert.deepEqual(lotReads, [[12, 1]], 'lots_more: the one request, for that product')
    await surface.unmount()
  }
  // ---- a row counted per batch: a count on each, the row total is the sum; Set from a batch confirms before and after, patches the row, reads no page ----
  {
    listAnswer = () => answerOf(); adjusts.length = 0; lotReads.length = 0
    const surface = await mount()
    await openCount(surface, '12')
    await surface.type(dateInput(surface, 7), '4')
    assert.equal(rowCount(surface, '12').value, '4', 'the row count is the sum of its batches')
    assert.equal(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_issue', 'the icon shows the draft: one short')
    const lists0 = lists.length, overlays0 = overlays.length
    adjustAnswer = payload => ({ productId: 12, branchId: 1, batchId: payload.batchId, before: { lotQuantity: 5, branchQuantity: 8 }, after: { lotQuantity: 4, branchQuantity: 7 } })
    await surface.click(setButton(surface))
    assert.equal(adjusts.length, 0, 'nothing is written until it is confirmed')
    const review = surface.find(node => node.tagName === 'DL', 'review').textContent
    assert.ok(review.includes('5 → 4'), 'the review shows the stock before and after: ' + review)
    await surface.click(exact(surface, 'Cancel').at(-1)!)
    assert.equal(adjusts.length, 0, 'Cancel writes nothing')
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(adjusts.length, 1)
    assert.deepEqual({ ...adjusts[0], client_request_id: String(adjusts[0].client_request_id).startsWith('inventory_set') }, { type: 'set', setScope: 'lot', productId: 12, branchId: 1, batchId: 7, quantity: 4, expectedLotQuantity: 5, reason: 'Inventory check', client_request_id: true })
    assert.equal(lists.length, lists0, 'a Set reads no list page'); assert.equal(overlays.length, overlays0, 'and no overlay'); assert.equal(lotReads.length, 0, 'and reads no batches at all')
    assert.ok(lotLine(surface, 7).textContent.includes('4'), 'the batch shows the writer\'s figure')
    assert.equal((dateInput(surface, 7) as unknown as { value: string }).value, '', 'the typed figure is cleared once it is the stock')
    // a stale figure: the writer refuses with what the stock is now; the batch shows it, nothing is written, the person decides again with THAT figure
    await surface.type(dateInput(surface, 9), '1')
    adjustAnswer = () => { throw Object.assign(new Error('conflict'), { status: 409, code: 'stock_conflict', current: { lotQuantity: 6, branchQuantity: 10 } }) }
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(adjusts.length, 2); assert.equal(adjusts[1].expectedLotQuantity, 3)
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('Stock changed. Now: 6')), 'the person is told what the stock is now')
    assert.ok(lotLine(surface, 9).textContent.includes('6'), 'the batch shows the figure the writer found')
    adjustAnswer = payload => ({ productId: 12, branchId: 1, batchId: payload.batchId, before: { lotQuantity: 6, branchQuantity: 10 }, after: { lotQuantity: 1, branchQuantity: 5 } })
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(adjusts.length, 3); assert.equal(adjusts[2].expectedLotQuantity, 6, 'the second try is measured from the figure the refusal named, not the stale one (no refusal loop)')
    assert.equal(lists.length, lists0, 'a refusal reads no page either')
    await surface.unmount()
  }
  // ---- audit G1: dated and plain rows in one submission, one request ----
  {
    adjusts.length = 0; submissions.length = 0
    listAnswer = () => listBody([withLots(productRow(12, 'Dated product', 8)), productRow(13, 'Plain product', 4)], { capabilities, summary: { ok: 0, issue: 0, not_checked: 2, total: 2 } })
    const surface = await mount()
    await openCount(surface, '12')
    await surface.type(dateInput(surface, 7), '4')
    await closeCount(surface)
    await openCount(surface, '13')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') !== null).length, 0, 'a product with no batch counts one total')
    await surface.type(surface.find(node => node.getAttribute('data-popover-total') !== null && node.tagName === 'INPUT', 'plain total'), '4')
    await closeCount(surface)
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await surface.click(exact(surface, 'Submit').at(-1)!)
    assert.equal(submissions.length, 1, 'ONE request carries both kinds of row')
    assert.deepEqual((submissions[0].lines as Array<Record<string, unknown>>).map(line => ['lots' in line ? 'dated' : 'plain', line.productId]), [['dated', 12], ['plain', 13]])
    assert.deepEqual((submissions[0].lines as Array<{ lots: unknown }>)[0].lots, [{ batchId: 7, scope: 'lot', counted: 4, seen: 5 }])
    assert.deepEqual({ ...(submissions[0].lines as Array<Record<string, unknown>>)[1] }, { productId: 13, countedQuantity: 4, seenQuantity: 4, checked: false })
    await surface.unmount()
  }
  // ---- "matches stock" on a batched product fills every batch with its own stock; one tick, one dated line per batch ----
  {
    submissions.length = 0
    listAnswer = () => answerOf()
    const surface = await mount()
    await openCount(surface, '12')
    await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches'))
    assert.equal((dateInput(surface, 7) as unknown as { value: string }).value, '5'); assert.equal((dateInput(surface, 9) as unknown as { value: string }).value, '3')
    assert.equal(rowCount(surface, '12').value, '8')
    assert.equal(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_ok', 'the green check, not submitted yet')
    await closeCount(surface)
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await surface.click(exact(surface, 'Submit').at(-1)!)
    assert.deepEqual((submissions[0].lines as Array<{ lots: unknown }>)[0].lots, [{ batchId: 7, scope: 'lot', counted: 5, seen: 5 }, { batchId: 9, scope: 'lot', counted: 3, seen: 3 }])
    await surface.unmount()
  }
  // ---- F1 (review 14 Nov): a submission over the plan's line cap is never a dead end. The cap comes in capabilities; the page sends the run of products that fits and keeps the rest as drafts;
  // a server refusal (an older page, a cap that moved) says what to do and keeps every count. ----
  {
    const three = () => listBody([withLots(productRow(12, 'Dated one', 8)), withLots(productRow(14, 'Dated two', 8)), withLots(productRow(16, 'Dated three', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 4 }, summary: { ok: 0, issue: 0, not_checked: 3, total: 3 } })
    const matchAll = async (surface: Awaited<ReturnType<typeof mount>>) => {
      for (const id of ['12', '14', '16']) { await openCount(surface, id); await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches')); await closeCount(surface) }
    }
    const submitNow = async (surface: Awaited<ReturnType<typeof mount>>) => {
      await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
      await surface.click(exact(surface, 'Submit').at(-1)!)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    lotsAnswer = productId => ({ productId, branchId: 1, lots: [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }] })
    submissions.length = 0; listAnswer = three; submitAnswer = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
    const surface = await mount()
    await matchAll(surface)
    await submitNow(surface)
    assert.equal(submissions.length, 1, 'three products of two dates each are 6 lines against a cap of 4: the first send carries what fits')
    assert.deepEqual((submissions[0].lines as Array<{ productId: number }>).map(line => line.productId), [12, 14], 'in order, whole products only')
    assert.equal(rowCount(surface, '16').value, '8', 'the product that did not fit is still a draft on the page')
    assert.equal(rowCount(surface, '12').value, '', 'the ones sent are cleared')
    await submitNow(surface)
    assert.equal(submissions.length, 2); assert.deepEqual((submissions[1].lines as Array<{ productId: number }>).map(line => line.productId), [16], 'the next Submit sends the rest')
    await surface.unmount()
    // a cap smaller than ONE product: nothing is sent, the person is told what to do
    submissions.length = 0
    listAnswer = () => listBody([withLots(productRow(12, 'Dated one', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 1 }, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    const tight = await mount()
    await openCount(tight, '12'); await tight.click(tight.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches')); await closeCount(tight)
    await tight.click(tight.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    assert.equal(submissions.length, 0, 'nothing is sent that the server would refuse')
    assert.ok(tight.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('larger than one submission can carry')), 'and the person is told in words')
    assert.equal(rowCount(tight, '12').value, '8', 'the count is kept')
    await tight.unmount()
    // the server refuses all the same (no cap known to the page): the code has its own message, the counts are kept and the same Submit is a fresh request
    submissions.length = 0
    listAnswer = () => answerOf()
    const refused = await mount()
    await openCount(refused, '12'); await refused.click(refused.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches')); await closeCount(refused)
    submitAnswer = () => { throw realRefusalSync }
    realRefusalSync = await realRefusal({ error: 'inventory_check_too_many_lines', code: 'inventory_check_too_many_lines' })
    await submitNow(refused)
    assert.ok(refused.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('larger than one submission can carry')), 'the refusal is explained, not "Check not saved. Try again."')
    assert.equal(rowCount(refused, '12').value, '8', 'the counts are kept')
    submitAnswer = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
    await submitNow(refused)
    assert.equal(submissions.length, 2); assert.notEqual(submissions[0].requestId, submissions[1].requestId, 'a refused request is dropped: the next Submit is a new one')
    await refused.unmount()
    lotsAnswer = null
  }
  // ---- A (14 Nov round 2b): units found on a batch the system says is empty. The empty dates are carried by the row, collapsed by default, reachable with one tap, counted like any entry,
  // never part of "matches stock", and cost no request. ----
  {
    const withEmpty = (row: Row): Row => ({ ...withLots(row), lots: [...(withLots(row).lots as Row[]), { id: 11, received_at: '2026-08-01', branches: [{ branch_id: 1, quantity: 0 }] }] })
    listAnswer = () => listBody([withEmpty(productRow(12, 'Dated product', 8))], { capabilities, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    lotReads.length = 0; submissions.length = 0
    const surface = await mount()
    await openCount(surface, '12')
    const lotIds = () => surface.findAll(node => node.getAttribute('data-popover-lot') !== null).map(node => node.getAttribute('data-popover-lot'))
    assert.deepEqual(lotIds(), ['7', '9'], 'the empty received date is hidden by default')
    const toggle = surface.find(node => node.getAttribute('data-popover-action') === 'toggle-empty', 'empty toggle')
    assert.equal(toggle.getAttribute('aria-label'), 'Show empty received dates (1)'); assert.equal(toggle.getAttribute('title'), 'Show empty received dates (1)'); assert.ok(toggle.textContent.includes('(1)'), 'icon plus the count')
    assert.deepEqual(lotReads, [], 'collapsed: no extra read')
    await surface.click(toggle)
    assert.deepEqual(lotIds(), ['7', '9', '11'], 'one tap reaches it, as a normal count entry')
    assert.deepEqual(lotReads, [], 'expanding reads nothing: the row carried it')
    await surface.type(dateInput(surface, 11), '2')
    assert.equal(rowCount(surface, '12').value, '2', 'counted like any entry')
    assert.equal(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_issue', '2 found where the system had 0')
    await closeCount(surface)
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await surface.click(exact(surface, 'Submit').at(-1)!)
    assert.deepEqual((submissions[0].lines as Array<{ lots: unknown }>)[0].lots, [{ batchId: 11, scope: 'lot', counted: 2, seen: 0 }], 'the line is written for the date a person typed on')
    await surface.unmount()
    // "matches stock" never writes a line for an empty date, even with it expanded
    submissions.length = 0
    const second = await mount()
    await openCount(second, '12')
    await second.click(second.find(node => node.getAttribute('data-popover-action') === 'toggle-empty', 'empty toggle'))
    await second.click(second.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches'))
    await closeCount(second)
    await second.click(second.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await second.click(exact(second, 'Submit').at(-1)!)
    assert.deepEqual((submissions[0].lines as Array<{ lots: Array<{ batchId: number }> }>)[0].lots.map(line => line.batchId), [7, 9], 'matches stock writes the stocked dates only')
    assert.deepEqual(lotReads, [], 'the whole flow read no batch')
    await second.unmount()
  }
  // ---- B (14 Nov round 2b): the whole-page mark is back in per-batch mode. It writes one line per stocked batch the rows carry (never an empty date), a total for a product with no stocked batch, and leaves a
  // product whose dates the row could not carry in full to its own popover; submit splits the lines by capabilities.lotLinesPerSubmission. ----
  {
    listAnswer = () => listBody([withLots(productRow(12, 'Dated one', 8)), productRow(13, 'Plain product', 4), withLots(productRow(14, 'Dated two', 8)), { ...withLots(productRow(17, 'Too many dates', 8)), lots_more: true }],
      { capabilities: { ...capabilities, lotLinesPerSubmission: 4 }, summary: { ok: 0, issue: 0, not_checked: 4, total: 4 } })
    submissions.length = 0; lotReads.length = 0
    const surface = await mount()
    const markButtons = surface.findAll(node => node.getAttribute('data-selection-action') === 'mark')
    assert.equal(markButtons.length, 1, 'the whole-page mark is offered in per-batch mode')
    await surface.click(markButtons[0])
    assert.deepEqual(surface.findAll(node => node.getAttribute('data-selected') !== null).map(node => node.getAttribute('data-inventory-check-row')), ['12', '13', '14'], 'a product whose dates are only partly carried is left for its popover')
    assert.equal(rowCount(surface, '12').value, '8'); assert.equal(rowCount(surface, '13').value, '4')
    assert.equal(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_ok')
    const submitNow = async () => { await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await surface.click(exact(surface, 'Submit').at(-1)!); await new Promise(resolve => setTimeout(resolve, 20)) }
    await submitNow()
    const shape = (line: Record<string, unknown>) => 'lots' in line ? [line.productId, (line.lots as Array<{ batchId: number; counted: number; seen: number }>).map(entry => [entry.batchId, entry.counted, entry.seen])] : [line.productId, 'total', line.countedQuantity]
    assert.equal(submissions.length, 1)
    assert.deepEqual((submissions[0].lines as Array<Record<string, unknown>>).map(shape), [[12, [[7, 5, 5], [9, 3, 3]]], [13, 'total', 4]], 'cap 4: 2 lines of product 12 and 1 for the plain product fit; the next product (2 more) waits')
    assert.equal(rowCount(surface, '14').value, '8', 'the product that did not fit is still a draft')
    await submitNow()
    assert.deepEqual((submissions[1].lines as Array<Record<string, unknown>>).map(shape), [[14, [[7, 5, 5], [9, 3, 3]]]], 'the next Submit sends the rest')
    assert.deepEqual(lotReads, [], 'marking the page read no batch')
    await surface.unmount()
  }
  // ---- N1 (review 14 Nov round 2): the whole-page mark never overwrites a row the counter already answered. A chosen status, any date typed (valid or not) and a count all stay. ----
  {
    const shape = (line: Record<string, unknown>) => 'lots' in line ? [line.productId, (line.lots as Array<{ batchId: number; counted: number; seen: number }>).map(entry => [entry.batchId, entry.counted, entry.seen])] : [line.productId, 'total', line.countedQuantity]
    const markPage = async (surface: Awaited<ReturnType<typeof mount>>) => { await surface.click(surface.findAll(node => node.getAttribute('data-selection-action') === 'mark')[0]) }
    const submitNow = async (surface: Awaited<ReturnType<typeof mount>>) => { await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await surface.click(exact(surface, 'Submit').at(-1)!); await new Promise(resolve => setTimeout(resolve, 20)) }
    const sent = () => (submissions.at(-1)?.lines as Array<Record<string, unknown>> | undefined)?.map(shape)
    const dated = () => listBody([withLots(productRow(12, 'Dated one', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    // B1: one valid shortage and one mistyped date, then the page mark: the row stays as the counter left it
    listAnswer = dated; submissions.length = 0
    let surface = await mount()
    await openCount(surface, '12'); await surface.type(dateInput(surface, 7), '4'); await surface.type(dateInput(surface, 9), '3,'); await closeCount(surface)
    const before = rowCount(surface, '12').value
    await markPage(surface)
    assert.equal(rowCount(surface, '12').value, before, 'B1: the page mark left the partly typed row alone')
    assert.notEqual(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_ok', 'B1: it was not turned into matches stock')
    await surface.unmount()
    // B2: "Does not match" per batch, then the page mark: still waiting for its count, never all-matching
    listAnswer = dated; submissions.length = 0
    surface = await mount()
    await openCount(surface, '12'); await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'differs', 'differs')); await closeCount(surface)
    await markPage(surface)
    assert.equal(rowCount(surface, '12').value, '', 'B2: the row still waits for the count the person found')
    assert.notEqual(statusButton(surface, '12').getAttribute('data-check-status-kind'), 'draft_ok', 'B2: not marked matching')
    await surface.unmount()
    // B3 control: one valid differing date alone is kept
    listAnswer = dated; submissions.length = 0
    surface = await mount()
    await openCount(surface, '12'); await surface.type(dateInput(surface, 7), '4'); await closeCount(surface)
    await markPage(surface); await submitNow(surface)
    assert.deepEqual(sent(), [[12, [[7, 4, 5]]]], 'B3: a valid typed 4 on one date is kept as typed')
    await surface.unmount()
    // B4: plain mode (lot counts off): "Does not match", then the page mark
    listAnswer = () => listBody([productRow(13, 'Plain', 4), productRow(14, 'Plain two', 6)], { capabilities: { fixStock: true, approveCounts: false }, summary: { ok: 0, issue: 0, not_checked: 2, total: 2 } }); submissions.length = 0
    surface = await mount()
    await openCount(surface, '13'); await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'differs', 'differs')); await closeCount(surface)
    await markPage(surface)
    assert.equal(rowCount(surface, '13').value, '', 'B4: the answered row still waits for its count')
    assert.equal(rowCount(surface, '14').value, '6', 'B4: an untouched row is still marked by the page mark')
    assert.notEqual(statusButton(surface, '13').getAttribute('data-check-status-kind'), 'draft_ok')
    await surface.unmount()
  }
  // ---- N4 (review 14 Nov round 2): the batches a row carries can be out of date (a stock-in on another device adds a date). A row changed elsewhere reads /lots once before the popover or the page mark uses
  // its batches, and a count the server refuses as incomplete (409 inventory_check_lots_incomplete) patches the rows and keeps every typed count. ----
  {
    const shape = (line: Record<string, unknown>) => 'lots' in line ? [line.productId, (line.lots as Array<{ batchId: number; counted: number; seen: number }>).map(entry => [entry.batchId, entry.counted, entry.seen])] : [line.productId, 'total', line.countedQuantity]
    const markPage = async (surface: Awaited<ReturnType<typeof mount>>) => { await surface.click(surface.findAll(node => node.getAttribute('data-selection-action') === 'mark')[0]); await new Promise(resolve => setTimeout(resolve, 20)) }
    const submitNow = async (surface: Awaited<ReturnType<typeof mount>>) => { await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await surface.click(exact(surface, 'Submit').at(-1)!); await new Promise(resolve => setTimeout(resolve, 20)) }
    const sent = () => (submissions.at(-1)?.lines as Array<Record<string, unknown>> | undefined)?.map(shape)
    const dated = () => listBody([withLots(productRow(12, 'Dated one', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    const changedElsewhere = async () => { sync({ channel: 'inventory', payload: { id: 12, action: 'stock-in' } }); await new Promise(resolve => setTimeout(resolve, 20)) }
    // what the server holds now: a third received date (batch 11, 4 units) arrived on another device
    const nowLots = (productId: number) => ({ productId, branchId: 1, lots: [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }, { batchId: 11, receivedAt: '2026-11-10', expiry: null, quantity: 4 }] })
    // popover: control first (a row nobody changed reads nothing), then the changed row reads once and shows the new date
    listAnswer = dated; lotsAnswer = nowLots; lotReads.length = 0; submissions.length = 0
    let surface = await mount()
    await openCount(surface, '12')
    assert.deepEqual(lotReads, [], 'control: a row nobody changed draws from the batches it carries, no read')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') === '11').length, 0)
    await closeCount(surface)
    await changedElsewhere()
    await openCount(surface, '12')
    assert.deepEqual(lotReads, [[12, 1]], 'a row changed on another device reads /lots once when its popover opens')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') === '11').length, 1, 'and shows the date that arrived there')
    await surface.click(surface.find(node => node.getAttribute('data-popover-action') === 'matches', 'matches'))
    await closeCount(surface)
    await submitNow(surface)
    assert.deepEqual(sent(), [[12, [[7, 5, 5], [9, 3, 3], [11, 4, 4]]]], 'Matches stock counted every date the server holds')
    await surface.unmount()
    // the popover read is remembered: the next open of the same row reads nothing more
    listAnswer = dated; lotReads.length = 0
    surface = await mount()
    await changedElsewhere(); await openCount(surface, '12'); await closeCount(surface); await openCount(surface, '12')
    assert.equal(lotReads.length, 1, 'read once, not on every open')
    await surface.unmount()
    // the whole-page mark reads the changed row once and marks every date it holds now
    listAnswer = dated; lotReads.length = 0; submissions.length = 0
    surface = await mount()
    await changedElsewhere()
    await markPage(surface)
    assert.deepEqual(lotReads, [[12, 1]], 'the page mark read the changed row once, before using its batches')
    await submitNow(surface)
    assert.deepEqual(sent(), [[12, [[7, 5, 5], [9, 3, 3], [11, 4, 4]]]], 'the page mark answered every stocked date, the new one included')
    await surface.unmount()
    // a changed row whose read fails is left for its own popover (never marked from batches that may be out of date); an unchanged row beside it is marked
    listAnswer = () => listBody([withLots(productRow(12, 'Dated one', 8)), withLots(productRow(14, 'Dated two', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 2, total: 2 } })
    lotsAnswer = () => { throw new Error('offline') }; lotReads.length = 0; submissions.length = 0
    surface = await mount()
    await changedElsewhere()
    await markPage(surface)
    assert.equal(rowCount(surface, '12').value, '', 'the changed row whose read failed was not marked')
    assert.equal(rowCount(surface, '14').value, '8', 'the row nobody changed was')
    await surface.unmount()
    // the server refuses a partial count: the rows take its dates, every typed count stays, no list is read, the person is told which product
    lotsAnswer = nowLots; listAnswer = dated; lotReads.length = 0; submissions.length = 0
    surface = await mount()
    await openCount(surface, '12'); await surface.type(dateInput(surface, 7), '4'); await closeCount(surface)
    const listsBefore = lists.length
    const refusal409 = await realRefusal({ error: 'inventory_check_lots_incomplete', code: 'inventory_check_lots_incomplete', productIds: [12], lots: [{ productId: 12, lots: nowLots(12).lots }] }, 409)
    submitAnswer = () => { throw refusal409 }
    await submitNow(surface)
    assert.equal(submissions.length, 1)
    assert.equal(lists.length, listsBefore, 'no list was read for the refusal: the answer carried the dates')
    assert.equal(rowCount(surface, '12').value, '4', 'the count typed stays')
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('another date') && node.textContent.includes('Dated one')), 'the person is told what to do and which product')
    await openCount(surface, '12')
    assert.deepEqual(lotReads, [], 'the rows were patched from the refusal: the popover opens with no read')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') === '11').length, 1, 'the new date is there to count')
    assert.equal((dateInput(surface, 7) as unknown as { value: string }).value, '4', 'the date typed before is still typed')
    await surface.type(dateInput(surface, 9), '3'); await surface.type(dateInput(surface, 11), '4'); await closeCount(surface)
    submitAnswer = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
    await submitNow(surface)
    assert.deepEqual(sent(), [[12, [[7, 4, 5], [9, 3, 3], [11, 4, 4]]]], 'the next Submit carries every date')
    await surface.unmount()
    lotsAnswer = null
  }
  // ---- N3 + N5 (review 14 Nov round 2): wired only (ic_lot_counts OFF) the server still enforces its caps on every submission, so the page is told them and splits by BOTH (lines and products), with no dates in sight.
  // 401 plain products with a line cap of 400 and a product cap of 40: 40 go, the rest wait, nothing is refused. ----
  {
    const rows = Array.from({ length: 401 }, (_, index) => productRow(1000 + index, 'Plain ' + index, 5))
    const plainOnly = (caps: Record<string, number>) => () => listBody(rows, { capabilities: { fixStock: true, approveCounts: false, ...caps }, summary: { ok: 0, issue: 0, not_checked: 401, total: 401 } })
    const markAndSubmit = async (surface: Awaited<ReturnType<typeof mount>>) => {
      await surface.click(surface.findAll(node => node.getAttribute('data-selection-action') === 'mark')[0])
      await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await surface.click(exact(surface, 'Submit').at(-1)!); await new Promise(resolve => setTimeout(resolve, 20))
    }
    listAnswer = plainOnly({ lotLinesPerSubmission: 400, productsPerSubmission: 40 }); submissions.length = 0
    let surface = await mount()
    await markAndSubmit(surface)
    assert.equal(submissions.length, 1)
    assert.equal((submissions[0].lines as unknown[]).length, 40, 'both caps present, no lot counts: the product cap splits the 401 plain products')
    assert.equal(surface.findAll(node => node.getAttribute('data-selected') !== null).length, 361, 'the products that did not fit stay as drafts')
    await surface.unmount()
    // Only the line cap known (an older answer): 400 of 401 go, and the same split with 500 products (a Paid page)
    for (const [caps, expected] of [[{ lotLinesPerSubmission: 400 }, 400], [{ lotLinesPerSubmission: 1600, productsPerSubmission: 500 }, 401]] as const) {
      listAnswer = plainOnly(caps); submissions.length = 0
      surface = await mount()
      await markAndSubmit(surface)
      assert.equal((submissions[0].lines as unknown[]).length, expected, JSON.stringify(caps))
      await surface.unmount()
    }
  }
  // ---- M07 (review 14 Nov round 2): the whole-page mark writes the stocked dates only: a date this branch holds at 0 is never part of "matches stock" ----
  {
    const withEmptyDate = (row: Row): Row => ({ ...row, lots: [
      { id: 7, received_at: '2026-10-01', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 9, received_at: '2026-10-09', branches: [{ branch_id: 1, quantity: 3 }] }, { id: 11, received_at: '2026-09-01', branches: [{ branch_id: 1, quantity: 0 }] }] })
    listAnswer = () => listBody([withEmptyDate(productRow(20, 'With an empty date', 8))], { capabilities: { ...capabilities, lotLinesPerSubmission: 400 }, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    submissions.length = 0
    const surface = await mount()
    await surface.click(surface.findAll(node => node.getAttribute('data-selection-action') === 'mark')[0])
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')); await surface.click(exact(surface, 'Submit').at(-1)!); await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual((submissions[0].lines as Array<{ lots: Array<{ batchId: number }> }>)[0].lots.map(entry => entry.batchId), [7, 9], 'no empty-date line: batch 11 holds 0 here and was never counted')
    await surface.unmount()
  }
  // ---- audit G1b: the switch went OFF under an open tab: one re-read, then the same counts go as plain lines (no second refusal) ----
  {
    submissions.length = 0
    listAnswer = () => answerOf()
    const surface = await mount()
    await openCount(surface, '12')
    await surface.type(dateInput(surface, 7), '4')
    await closeCount(surface)
    submitAnswer = () => { throw Object.assign(new Error('off'), { status: 409, code: 'inventory_check_lot_counts_off' }) }
    listAnswer = () => listBody([withLots(productRow(12, 'Dated product', 8))], { capabilities: { fixStock: true, approveCounts: false }, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    const before = lists.length
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await surface.click(exact(surface, 'Submit').at(-1)!)
    assert.equal(lists.length, before + 1, 'exactly one re-read of the list')
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('turned off')), 'and the person is told why')
    submitAnswer = () => ({ item: { id: 'session-new' }, receipt: {}, created: true })
    assert.equal(rowCount(surface, '12').value, '', 'the sum of the typed batches is NOT carried over as the product count (a partly dated product would read as a shortage)')
    assert.equal(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit').getAttribute('aria-disabled'), 'true', 'Submit asks for a count first')
    assert.ok(rowCount(surface, '12').getAttribute('readonly') === null, 'with the switch off the row count is a plain input again')
    await surface.type(rowCount(surface, '12') as never, '8')
    await surface.click(surface.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit'))
    await surface.click(exact(surface, 'Submit').at(-1)!)
    assert.equal(submissions.length, 2); assert.deepEqual({ ...(submissions[1].lines as Array<Record<string, unknown>>)[0] }, { productId: 12, countedQuantity: 8, seenQuantity: 8, checked: false }, 'the second send is the typed product count, plain: no refusal loop')
    await surface.unmount()
  }
  // ---- audit G12: a status the server refuses is dropped once; G13: one status choice on the page ----
  {
    listAnswer = async query => { if (query.get('checkState') === 'pending') throw await realRefusal({ error: 'inventory_check_invalid_query', code: 'inventory_check_invalid_query', parameter: 'checkState' }); return answerOf() }
    const surface = await mount()
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
    assert.ok(surface.findAll(node => node.getAttribute('data-filter-menu-section') === 'sort').length > 0, 'the Filters menu is open (the control: its Sort section is there)')
    assert.equal(surface.findAll(node => node.getAttribute('data-filter-menu-section') === 'checkState').length, 0, 'G13: the Filters menu has no second status section')
    await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
    assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Stats').length + surface.findAll(node => node.getAttribute('data-stat-card') !== null).length, 0, 'G13: no stat-card selector beside the rail')
    const before = lists.length
    await surface.click(surface.button('Waiting for approval', inside(surface, 'data-inventory-check-status-rail')))
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(lists.filter(query => query.get('checkState') === 'pending').length, 1, 'G12: the refused status was asked once and never repeated')
    assert.ok(lists.length <= before + 2, 'at most one retry (All is the page Products already holds, so it may need no read at all)')
    assert.ok(lists.every((query, index) => index < before || query.get('checkState') !== 'ok'), 'no other status was invented')
    assert.equal(surface.button('all', inside(surface, 'data-inventory-check-status-rail')).getAttribute('aria-pressed'), 'true', 'the page shows All')
    assert.equal(surface.findAll(node => node.getAttribute('role') === 'alert').length, 0, 'and shows no error')
    await surface.unmount()
  }
  // ---- audit G7 + G8 + G14: the Set from a row ----
  {
    adjusts.length = 0; submissions.length = 0
    listAnswer = () => listBody([withLots(productRow(12, 'Dated product', 8)), productRow(13, 'Second product', 3)], { capabilities, summary: { ok: 0, issue: 1, not_checked: 1, total: 2 } })
    seedOverlay = new Map([[12, { product_id: 12, last_change_at: null, check: { state: 'issue', counted_quantity: 4, seen_quantity: 5, note: 'short', at: '2026-11-02T01:00:00.000Z', session_id: 'sess-1', revision: 1 } }]])
    const surface = await mount()
    await openCount(surface, '12')
    await surface.type(dateInput(surface, 7), '4')
    const lists0 = lists.length
    adjustAnswer = () => { throw Object.assign(new Error('held'), { status: 409, code: 'inventory_check_count_pending' }) }
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('waiting for approval')), 'G7: a held Set says a count is waiting, not "not saved"')
    assert.equal(lists.length, lists0)
    adjustAnswer = () => { throw Object.assign(new Error('branch'), { status: 409, code: 'branch_redirect_required' }) }
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    assert.ok(surface.findAll(node => node.getAttribute('role') === 'alert').some(node => node.textContent.includes('disabled branch')), 'G7: a disabled branch has its own sentence')
    adjustAnswer = payload => ({ productId: 12, branchId: 1, batchId: payload.batchId, before: { lotQuantity: 5, branchQuantity: 8 }, after: { lotQuantity: 4, branchQuantity: 7 } })
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    await new Promise(resolve => setTimeout(resolve, 40))
    sync({ channel: 'products', payload: { id: 12, action: 'update' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-changed-elsewhere') !== null).length, 0, 'G8: the echo of this tab own Set is not "changed elsewhere"')
    sync({ channel: 'products', payload: { id: 13, action: 'update' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(surface.findAll(node => node.getAttribute('data-inventory-check-changed-elsewhere') !== null).length, 1, 'G8: another row changed elsewhere still shows the hint (the control)')
    assert.equal(submissions.length, 0, 'N2: the client never sends a second request after a Set')
    assert.equal(surface.findAll(node => node.getAttribute('data-check-list-status') === 'issue').length, 1, 'N2: without issue_closed the row stays an Issue (the writer did not close it: a date still differs, or a count waits)')
    await surface.type(dateInput(surface, 9), '2')
    adjustAnswer = payload => ({ productId: 12, branchId: 1, batchId: payload.batchId, before: { lotQuantity: 3, branchQuantity: 7 }, after: { lotQuantity: 2, branchQuantity: 6 }, issue_closed: true })
    await surface.click(setButton(surface))
    await surface.click(exact(surface, 'Set').at(-1)!)
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(submissions.length, 0, 'still no second request')
    assert.equal(surface.findAll(node => node.getAttribute('data-check-list-status') === 'issue').length, 0, 'N2: the row leaves Issues because the writer said issue_closed, with nothing read')
    await surface.unmount()
  }
  // ---- a product holding more batches than one count may carry says so; units on no received date show read-only ----
  {
    lotReads.length = 0
    listAnswer = () => listBody([productRow(12, 'Dated product', 11)], { capabilities, summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } })
    lotsAnswer = () => ({ productId: 12, branchId: 1, more: true, lots: [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }] })
    const surface = await mount()
    await openCount(surface, '12')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-more') !== null).length, 1, 'the popover says more received dates exist than one count can carry')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-unlotted') !== null).length, 0, 'and claims no unlotted remainder while it cannot know')
    assert.equal(lotReads.length, 1, 'one request, no "load more" round trip')
    await surface.unmount()
    lotsAnswer = () => ({ productId: 12, branchId: 1, lots: [{ batchId: 7, receivedAt: '2026-10-01', expiry: null, quantity: 5 }, { batchId: 9, receivedAt: '2026-10-09', expiry: null, quantity: 3 }] })
    const loose = await mount()
    await openCount(loose, '12')
    assert.ok(inside(loose, 'data-popover-unlotted').textContent.includes('3'), 'branch 11, dates 5 + 3: 3 units on no date')
    await loose.unmount()
    lotsAnswer = null
  }
  // ---- owner 9 Nov: the date order is offered once a status that has a checked list is chosen ----
  {
    listAnswer = () => answerOf()
    const surface = await mount()
    const trigger = () => surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger')
    const sortOption = () => surface.findAll(node => node.getAttribute('role') === 'option' && (node.textContent === 'Newest check first' || node.textContent === 'inventory_check_sort_checked'))
    await surface.click(trigger())
    let sortSection = surface.find(node => node.getAttribute('data-filter-menu-section') === 'sort', 'sort section')
    if (sortSection.querySelectorAll('[role="option"]').length === 0) await surface.click(surface.button(/./, sortSection))
    assert.equal(sortOption().length, 0, 'no date order while All is chosen')
    await surface.click(trigger())
    await surface.click(surface.button('Checked OK', inside(surface, 'data-inventory-check-status-rail')))
    await surface.click(trigger())
    sortSection = surface.find(node => node.getAttribute('data-filter-menu-section') === 'sort', 'sort section')
    if (sortSection.querySelectorAll('[role="option"]').length === 0) await surface.click(surface.button(/./, sortSection))
    assert.equal(sortOption().length, 1, 'the date order appears with a checked status')
    await surface.click(sortOption()[0])
    assert.equal(lists.at(-1)!.get('sortBy'), 'checked'); assert.equal(lists.at(-1)!.get('checkState'), 'ok')
    await surface.unmount()
  }
  // ---- the switch off: one total per product, and no batch is ever read ----
  {
    lotReads.length = 0
    listAnswer = () => listBody([withLots(productRow(12, 'Dated product', 8))], { capabilities: { fixStock: true, approveCounts: false } })
    const surface = await mount()
    await openCount(surface, '12')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-lot') !== null).length, 0, 'no batch list without lotCounts')
    assert.equal(surface.findAll(node => node.getAttribute('data-popover-single') !== null).length, 1, 'one total instead')
    assert.deepEqual(lotReads, [], 'and the batches were never asked for')
    await surface.unmount()
  }
  console.log('inventoryChecksLotsPage passed: status rail, on-demand batches in the count popover, per-batch counts and sum, Set with review and no page read, stale figure, switch off')
} finally {
  await harness.close()
}
