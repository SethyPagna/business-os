import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { appendQuery, buildQueryString, type QueryParams } from '../src/api/query.ts'
import type { InventoryCheckSession, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'

// The Inventory Check page against the server the shop runs by default: ic_simple OFF. That server answers the old list (no `simple`, stats, issues) and
// refuses a query key it does not know with 400. A page that sends `summary` on a page step, or `checkState` for the Issues tab or the status filter, would
// break on page 2, on Issues and on the filter -- while its page-1 test stays green. So this test mounts the real page and walks all of them, counting
// what reaches the wire (the real query serializer, over the page's transport call).
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
open('hub:inventory:products')

// ---- the server ----
type Wire = { url: string; query: URLSearchParams }
const wire: Wire[] = []
let server: 'off' | 'on' = 'off'
// A server that already carries the fix maps checkState=issue to its old issue state; the server this page was built against does not.
let aliasUnderstood = false
const OFF_KEYS = new Set(['query', 'branchId', 'category', 'brand', 'stockState', 'page', 'pageSize', 'sortBy', 'sortDirection', 'sessionId', 'state'])
const ON_KEYS = new Set(['query', 'branchId', 'category', 'brand', 'stockState', 'checkState', 'page', 'pageSize', 'sortBy', 'sortDirection', 'sessionId', 'summary'])
const branches = [{ id: 1, name: 'Branch one' }, { id: 2, name: 'Branch two' }]
const answer = (query: URLSearchParams) => {
  const page = Number(query.get('page') ?? 1)
  const issue = query.get('state') === 'issue' || query.get('checkState') === 'issue'
  const row = { id: 12, name: `${issue ? 'Issue' : 'Product'} page ${page}`, quantity: 8, unit: 'pcs' }
  const base = { items: [row], total: 45, page, pageSize: 20, branches }
  if (server === 'off') return { ...base, facets: { brands: ['Test brand'], categories: ['Test category'], reasons: [] }, facetsLimited: { brands: false, categories: false, reasons: false }, stats: { total_products: 45 }, issues: [] }
  return { ...base, simple: true, ...(query.get('summary') === '0' ? {} : { summary: { not_checked: 40, in_check: 2, ok: 2, issue: 1, total: 45 }, facets: { brands: ['Test brand'], categories: ['Test category'] }, facetsLimited: { brands: false, categories: false } }) }
}
const session: InventoryCheckSession = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Test check', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19 02:30:00', updated_at: '2026-10-19 02:30:00', progress: { total: 1, done: 0, issue: 0, unstarted: 1 }, branch_name: 'Branch one', creator_name: 'alice' }
const member: InventoryCheckSessionItem = { product_id: 12, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 8, current_quantity: 8, stock_changed: false, product_snapshot: { id: 12, name: 'Product page 1' } }
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
    readInventoryCheckProducts: async (params: QueryParams) => {
      const url = appendQuery('/api/inventory-checks/products', buildQueryString(params))
      const query = new URL(url, 'https://admin.example.test').searchParams
      wire.push({ url, query })
      const known = server === 'off' ? OFF_KEYS : ON_KEYS
      for (const key of query.keys()) {
        if (!known.has(key) && !(server === 'off' && aliasUnderstood && key === 'checkState' && query.get(key) === 'issue')) throw Object.assign(new Error('inventory_check_invalid_query'), { status: 400, code: 'inventory_check_invalid_query', parameter: key })
      }
      return answer(query)
    },
    readInventoryCheckSessions: async () => ({ items: [session], total: 1, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => ({ item: session, items: [member] }),
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
type Surface = Awaited<ReturnType<typeof mount>>

const pager = (surface: Surface) => surface.find(node => node.getAttribute('data-inventory-check-pager-lock') !== null, 'paging controls')
const step = async (surface: Surface) => { await surface.click(surface.button('next', pager(surface))) }
const last = () => wire.at(-1)!
const keysOf = (entry: Wire) => [...entry.query.keys()].sort()
const menuSections = async (surface: Surface) => {
  const sections = () => surface.findAll(node => node.getAttribute('data-filter-menu-section') !== null)
  if (!sections().length) await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  return sections().map(node => node.getAttribute('data-filter-menu-section'))
}
// The Filters menu (FilterMenu): open it once, expand a section, tick an option.
const chooseFilter = async (surface: Surface, section: string, option: string) => {
  await menuSections(surface)
  const header = surface.find(node => node.getAttribute('data-filter-menu-section') === section, section + ' section')
  if (header.querySelectorAll('[role="option"]').length === 0) await surface.click(surface.button(/./, header))
  await surface.click(surface.find(node => node.getAttribute('role') === 'option' && header.contains(node) && node.textContent === option, option + ' in ' + section))
}
const noError = (surface: Surface, where: string) => assert.ok(!surface.text().includes('unavailable'), `${where}: no load error is shown`)
const neither = (entries: Wire[], where: string) => {
  assert.ok(entries.length > 0, `${where}: positive control, requests were made`)
  assert.deepEqual(entries.filter(entry => entry.query.has('summary')).map(entry => entry.url), [], `${where}: no request carries summary`)
  assert.deepEqual(entries.filter(entry => entry.query.has('checkState')).map(entry => entry.url), [], `${where}: no request carries checkState`)
}

try {
  // ---- OFF: Products, page steps, the filter menu ----
  const products = await mount()
  noError(products, 'page 1')
  assert.deepEqual(keysOf(last()), ['page', 'pageSize', 'sortBy', 'sortDirection'], 'page 1 asks the old list for its page, size and sort only')
  assert.ok(products.text().includes('Product page 1'), 'the old list is drawn')
  assert.ok(!(await menuSections(products)).includes('checkState'), 'the Products filter menu offers no check-status filter the server would refuse')
  assert.ok((await menuSections(products)).includes('stockState'), 'positive control: the menu is open and its other filters are there')
  const productsFrom = wire.length - 1
  await step(products)
  assert.equal(last().query.get('page'), '2'); noError(products, 'page 2'); assert.ok(products.text().includes('Product page 2'), 'page 2 is drawn')
  await step(products)
  assert.equal(last().query.get('page'), '3'); noError(products, 'page 3'); assert.ok(products.text().includes('Product page 3'))
  neither(wire.slice(productsFrom), 'Products pages 1-3 (OFF)')

  // ---- OFF: the Issues tab and its pages ----
  const issuesFrom = wire.length
  await products.click(products.button('issues'))
  noError(products, 'Issues'); assert.equal(last().query.get('page'), '1')
  assert.equal(last().query.get('state'), 'issue', 'Issues asks the old list in its own words: state=issue')
  assert.ok(products.text().includes('Issue page 1'), 'the Issues answer is drawn')
  assert.ok(!(await menuSections(products)).includes('checkState'), 'and the Issues filter menu has no check-status choice (the tab is the status)')
  await step(products)
  assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('state'), 'issue'); noError(products, 'Issues page 2'); assert.ok(products.text().includes('Issue page 2'))
  neither(wire.slice(issuesFrom), 'Issues and its page 2 (OFF)')

  // ---- OFF: back to Products, then inside a session ----
  await products.click(products.button('products'))
  noError(products, 'back to Products'); assert.equal(last().query.has('state'), false, 'Products does not carry the Issues key back')
  await products.click(products.button('sessions'))
  await products.click(products.button(/./, products.find(node => node.getAttribute('data-inventory-check-session') === 'check-1', 'session row')))
  noError(products, 'session'); assert.equal(last().query.get('sessionId'), 'check-1')
  const sessionFrom = wire.length - 1
  assert.ok((await menuSections(products)).includes('checkState'), 'inside a session the old list has a status choice of its own (unstarted | done | issue), so it is offered')
  await step(products)
  assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('sessionId'), 'check-1'); noError(products, 'session page 2')
  for (const [option, old] of [['inventory_check_unstarted', 'unstarted'], ['done', 'done'], ['issues', 'issue']]) {
    await chooseFilter(products, 'checkState', option)
    assert.equal(last().query.get('state'), old, `the ${option} choice is asked in the old list's word`); assert.equal(last().query.get('sessionId'), 'check-1'); assert.equal(last().query.get('page'), '1')
    noError(products, option)
    await step(products)
    assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('state'), old, 'and a page step keeps it')
  }
  neither(wire.slice(sessionFrom), 'a session, its page 2 and its status choices (OFF)')
  await products.unmount()

  // ---- OFF: a cold landing on Issues has not heard from the server yet ----
  open('hub:inventory:issues')
  aliasUnderstood = true
  const before = wire.length
  const cold = await mount()
  noError(cold, 'cold Issues')
  assert.equal(wire.length - before, 1, 'a cold landing on Issues reads once: finding out which server this is does not reload the list')
  assert.equal(last().query.get('checkState'), 'issue', 'with nothing known yet it uses the name both servers understand')
  assert.equal(last().query.has('state'), false)
  assert.ok(cold.text().includes('Issue page 1'))
  await step(cold)
  assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('state'), 'issue', 'and once the answer has shown the old list it speaks the old word'); assert.equal(last().query.has('checkState'), false)
  assert.equal(last().query.has('summary'), false); noError(cold, 'cold Issues page 2')
  await cold.unmount()
  aliasUnderstood = false

  // ---- The switch moves under an open tab: a refused key makes the page forget the server, and Retry speaks the words both understand ----
  open('hub:inventory:products')
  const turning = await mount()
  await turning.click(turning.button('issues'))
  assert.equal(last().query.get('state'), 'issue', 'the tab learned the old list and speaks its words')
  server = 'on'
  await step(turning)
  assert.equal(last().query.get('state'), 'issue'); assert.ok(turning.text().includes('unavailable'), 'the ic_simple server refuses the old word: the page says so and offers Retry')
  await turning.click(turning.button('retry'))
  assert.equal(last().query.get('checkState'), 'issue', 'Retry asks Issues in the shared words'); assert.equal(last().query.has('state'), false); assert.equal(last().query.has('summary'), false)
  noError(turning, 'after Retry'); assert.ok(turning.text().includes('Issue page 2'), 'and the page recovers on the page it was on')
  await step(turning)
  assert.equal(last().query.get('page'), '3'); assert.equal(last().query.get('summary'), '0', 'now that the answer was the check-status list, page steps skip the counts again'); assert.equal(last().query.get('checkState'), 'issue')
  await turning.unmount()
  server = 'off'

  // ---- Control: the same walk against the ic_simple server does send them, and does offer the filter (the instrument sees both keys) ----
  server = 'on'
  open('hub:inventory:products')
  const onFrom = wire.length
  const simple = await mount()
  noError(simple, 'ON page 1'); assert.equal(last().query.has('summary'), false, 'ON: page 1 asks for the check counts')
  assert.ok((await menuSections(simple)).includes('checkState'), 'ON: the check-status filter is offered')
  await step(simple)
  assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('summary'), '0', 'ON: a page step inside the scope asks the server to skip the counts')
  await step(simple)
  assert.equal(last().query.get('summary'), '0')
  await simple.click(simple.button('issues'))
  assert.equal(last().query.get('checkState'), 'issue', 'ON: the Issues tab asks with checkState'); assert.equal(last().query.has('state'), false); assert.equal(last().query.has('summary'), false, 'ON: a changed scope asks for fresh counts')
  await step(simple)
  assert.equal(last().query.get('page'), '2'); assert.equal(last().query.get('summary'), '0'); assert.equal(last().query.get('checkState'), 'issue')
  assert.ok(wire.slice(onFrom).some(entry => entry.query.has('summary')) && wire.slice(onFrom).some(entry => entry.query.has('checkState')), 'positive control: the walk does carry both keys when the server speaks them')
  noError(simple, 'ON')
  await simple.unmount()
  server = 'off'

  // ---- The pure rule the page uses ----
  const { productsWireParams, productsServerOf } = await import('../src/components/inventory/inventoryCheckProductsRequest.ts')
  const logical = { branchId: '1', stockState: '', checkState: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc', query: '', page: 2, pageSize: 20, sessionId: '' }
  const wired = (params: Record<string, string | number>, kind: 'unknown' | 'simple' | 'old', skip: boolean) => Object.fromEntries(new URLSearchParams(buildQueryString(productsWireParams(params, kind, skip))))
  assert.equal(productsServerOf({}), 'old'); assert.equal(productsServerOf({ simple: false }), 'old'); assert.equal(productsServerOf({ simple: true }), 'simple')
  assert.deepEqual(wired(logical, 'old', true), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20' }, 'an old server is never asked to skip a summary it does not have')
  assert.deepEqual(wired(logical, 'unknown', true), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20' }, 'nor one that has not answered yet')
  assert.deepEqual(wired(logical, 'simple', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20' })
  assert.deepEqual(wired(logical, 'simple', true), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', summary: '0' })
  assert.deepEqual(wired({ ...logical, checkState: 'issue' }, 'old', true), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', state: 'issue' }, 'Issues on an old server is state=issue')
  assert.deepEqual(wired({ ...logical, checkState: 'ok' }, 'old', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20' }, 'a status the old server cannot honour outside a session is not sent (it would be a 400)')
  assert.deepEqual(wired({ ...logical, checkState: 'not_checked' }, 'old', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20' })
  for (const [choice, old] of [['in_check', 'unstarted'], ['ok', 'done'], ['issue', 'issue']]) {
    assert.deepEqual(wired({ ...logical, checkState: choice, sessionId: 'check-1' }, 'old', true), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', sessionId: 'check-1', state: old }, `inside a session ${choice} is the old state ${old}`)
  }
  assert.deepEqual(wired({ ...logical, checkState: 'not_checked', sessionId: 'check-1' }, 'old', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', sessionId: 'check-1' })
  assert.deepEqual(wired({ ...logical, checkState: 'constructor', sessionId: 'check-1' }, 'old', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', sessionId: 'check-1' }, 'only the three known choices are mapped')
  assert.deepEqual(wired({ ...logical, checkState: 'issue' }, 'simple', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', checkState: 'issue' })
  assert.deepEqual(wired({ ...logical, checkState: 'issue' }, 'unknown', false), { branchId: '1', sortBy: 'name', sortDirection: 'asc', page: '2', pageSize: '20', checkState: 'issue' }, 'before any answer, Issues uses the name both servers understand')
  console.log('inventoryChecksOffServer mounted journeys passed')
} finally {
  await harness.close()
}
