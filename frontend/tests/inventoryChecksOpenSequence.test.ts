import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'

// INV-B S1 (Inventory replan rev. 2, 4 Nov 2026): the BASELINE of how the Inventory Check page opens.
//
// Today, opening the page sends the list request with NO branchId. When the answer lists exactly ONE branch, the page selects it and remounts, and the
// remount sends the same request again with branchId -- a sequential waterfall, both at full cost (about 2.5M rows each on the live list). Pinned here
// for both servers (ic_simple OFF and ON) so a later change cannot make it worse unseen. The control is a shop with two branches, which has no waterfall.
//
// S4b flips the one-branch case to ONE request (the sole branch is read from the rows' branch_stock). When it does, change EXPECTED_REQUESTS_ONE_BRANCH
// from 2 to 1 and drop the second-request assertions; everything else here must stay true.
const EXPECTED_REQUESTS_ONE_BRANCH = 2

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
const answer = (query: URLSearchParams) => {
  const base = { items: [{ id: 12, name: 'Sequence product', quantity: 8, unit: 'pcs' }], total: 45, page: Number(query.get('page') ?? 1), pageSize: 20, branches }
  const facets = { brands: ['Test brand'], categories: ['Test category'] }
  const limited = { brands: false, categories: false, reasons: false }
  if (!simple) return { ...base, facets: { ...facets, reasons: [] }, facetsLimited: limited, stats: { total_products: 45 }, issues: [] }
  return { ...base, simple: true, summary: { not_checked: 40, in_check: 2, ok: 2, issue: 1, total: 45 }, facets, facetsLimited: limited }
}
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
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: null, items: [] }),
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}

async function openPage(shopBranches: Array<{ id: number; name: string }>, icSimple: boolean) {
  calls.length = 0; inFlight = 0; answered = 0
  branches = shopBranches; simple = icSimple
  open('hub:inventory:products')
  const surface = await harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
  return surface
}

try {
  for (const icSimple of [false, true]) {
    const server = icSimple ? 'ic_simple ON' : 'ic_simple OFF'

    // ---- one branch: the waterfall (today: 2, one after the other) ----
    const one = await openPage([{ id: 1, name: 'Only branch' }], icSimple)
    assert.ok(one.text().includes('Sequence product'), `${server}, one branch: the list is drawn`)
    assert.ok(!one.text().includes('unavailable'), `${server}, one branch: no load error`)
    assert.equal(calls.length, EXPECTED_REQUESTS_ONE_BRANCH, `${server}, one branch: list requests on open (the waterfall is 2; S4b makes it 1)`)
    assert.equal(calls[0].query.has('branchId'), false, `${server}, one branch: the first request names no branch`)
    for (const call of calls) {
      assert.equal(call.query.get('page'), '1'); assert.equal(call.query.get('pageSize'), '20')
      assert.equal(call.query.get('sortBy'), 'name'); assert.equal(call.query.get('sortDirection'), 'asc')
      assert.equal(call.query.has('summary'), false, `${server}: the first page asks for its summary`)
    }
    if (EXPECTED_REQUESTS_ONE_BRANCH === 2) {
      assert.equal(calls[1].query.get('branchId'), '1', `${server}, one branch: the second request carries the sole branch`)
      assert.equal(calls[1].answersBefore, 1, `${server}, one branch: the second request starts only after the first was answered (sequential)`)
      assert.deepEqual(calls.map(call => call.overlapped), [false, false], `${server}, one branch: the two requests never overlap`)
    }
    await one.unmount()

    // ---- control: two branches, no waterfall ----
    const two = await openPage([{ id: 1, name: 'Branch one' }, { id: 2, name: 'Branch two' }], icSimple)
    assert.ok(two.text().includes('Sequence product'), `${server}, two branches: the list is drawn`)
    assert.equal(calls.length, 1, `${server}, two branches: one request (positive control: only a single-branch shop waterfalls)`)
    assert.equal(calls[0].query.has('branchId'), false, `${server}, two branches: the open request names no branch`)
    await two.unmount()
  }
  console.log('inventoryChecksOpenSequence passed: one-branch open sends 2 sequential list requests on both servers; two branches send 1')
} finally {
  await harness.close()
}
