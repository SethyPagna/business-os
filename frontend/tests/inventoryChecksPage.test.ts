import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import type { InventoryCheckSession, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { fmtDateTime24 } from '../src/utils/formatters.ts'

const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
const uuidDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
const restoreUuid = () => { if (uuidDescriptor) Object.defineProperty(crypto, 'randomUUID', uuidDescriptor); else Reflect.deleteProperty(crypto, 'randomUUID') }
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const entries: string[] = ['https://admin.example.test/inventory#hub:inventory:products']
let entryIndex = 0
let blockNavigation = false
const applyLocation = (url: string) => {
  const next = new URL(url, window.location.href)
  Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash })
}
const publishLocation = () => window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page: 'inventory', path: window.location.pathname, anchor: window.location.hash.slice(1) } }))
window.history.pushState = (_state, _unused, url) => { entries.splice(entryIndex + 1); entries.push(new URL(String(url), window.location.href).href); entryIndex += 1; applyLocation(entries[entryIndex]) }
window.history.replaceState = (_state, _unused, url) => { entries[entryIndex] = new URL(String(url), window.location.href).href; applyLocation(entries[entryIndex]) }
window.history.back = () => { if (entryIndex > 0) { entryIndex -= 1; applyLocation(entries[entryIndex]); window.dispatchEvent(new Event('popstate')); publishLocation() } }
window.history.forward = () => { if (entryIndex < entries.length - 1) { entryIndex += 1; applyLocation(entries[entryIndex]); window.dispatchEvent(new Event('popstate')); publishLocation() } }
applyLocation(entries[0])
// Sort is a section of the Filters menu: its choices are {field}-templated, so these four read with their field key in them.
const SORT_WORDS: Record<string, string> = { sort_field_high_low: '{field}: high → low', sort_field_low_high: '{field}: low → high', sort_name_az: 'Name A–Z', sort_name_za: 'Name Z–A' }
const product = { id: 12, name: 'Test variant', quantity: 8, unit: 'pcs', latest_received_at: '2026-10-01 09:00:00', next_expiry_date: '2027-03-15', cost_price_usd: 913.27, selling_price_usd: 17, brand: 'Test brand', qty_sold: 4 }
let selected: InventoryCheckSession = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Test check', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19 02:30:00', updated_at: '2026-10-19 02:30:00', progress: { total: 1, done: 0, issue: 0, unstarted: 1 }, branch_name: 'Test branch', creator_name: 'alice' }
let observation: InventoryCheckSessionItem = { product_id: 12, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 9, current_quantity: 8, stock_changed: true, product_snapshot: product }
const productRequests: Array<Record<string, unknown>> = []
const saves: unknown[][] = []
const sessionReads: Array<Record<string, unknown>> = []
const creates: unknown[][] = []
let saveFailure: 'none' | 'known' | 'unknown' = 'none'
let failRead = false
let historyTimestamp: string | number = '2026-10-19 18:05:00'
let productTotal = 1
let emptyPastLastPage = false
let productOverride: InventoryCheckProduct[] | null = null
let memberOverride: InventoryCheckSessionItem[] | null = null
let readRevision = '1'
let delayedProducts: ((value: unknown) => void) | null = null
let delayBootstrap = false
const bootstrapReads: Array<{ params: Record<string, unknown>; resolve: (value: unknown) => void }> = []
const response = () => ({ items: [product], total: 1, page: 1, pageSize: 20, branches: [{ id: 1, name: 'Test branch' }], facets: { brands: ['Off-page brand'], categories: ['Off-page category'], reasons: ['Off-page reason'] }, facetsLimited: { brands: true, categories: false, reasons: false }, stats: { total_products: 1, stock_quantity: 8, qty_sold: 4, unique_customer_count: 2 }, issues: [{ product_id: 12, branch_id: 1, session_id: 'check-1', session_title: 'Test check', created_by: 7, reason: 'All-session issue reason', revision: 1, state: 'issue', counted_quantity: 37 }] })
const app = {
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, inventory_check_show_cost: false } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => SORT_WORDS[key] ?? key,
  settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  navigateTo: (page: string, anchor?: string) => {
    if (blockNavigation || dirtyWork.hasDirtyWork()) return
    window.history.pushState(null, '', `/inventory${window.location.search}#${anchor || ''}`)
    window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } }))
  },
}
const doubles = {
  'utils/dirtyWork.ts': dirtyWork,
  'api/actorReadScope.ts': {
    captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: readRevision }),
    captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }),
    isActorReadScopeCurrent: () => true,
    isActorWriteIdentityCurrent: () => true,
  },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckProducts: async (params: Record<string, unknown>) => {
      productRequests.push(params)
      if (failRead) throw new Error('test read failure')
      if (delayBootstrap) return new Promise(resolve => { bootstrapReads.push({ params, resolve }) })
      if (delayedProducts) return new Promise(resolve => { delayedProducts = resolve })
      return { ...response(), items: productOverride ?? (emptyPastLastPage && Number(params.page) > Math.ceil(productTotal / Number(params.pageSize)) ? [] : response().items), total: productOverride?.length ?? productTotal, rankings: { products: [{ family_key: 'off-page', name: 'Best seller beyond visible page', qty_sold: 99 }], ...(params.customerRanking === '1' ? { customers: [{ customer_id: 9, name: 'Opt-in customer identity', sale_count: 7 }] } : {}) } }
    },
    readInventoryCheckSessions: async (params: Record<string, unknown>) => { sessionReads.push(params); return { items: [selected], total: 1, page: 1, pageSize: 20 } },
    readInventoryCheckSession: async () => ({ item: selected, items: memberOverride ?? [observation] }),
    readInventoryCheckHistory: async () => ({ items: [{ id: 2, session_id: 'check-1', product_id: null, product_name: null, actor_id: 7, actor_name: 'alice', action: 'create', created_at: historyTimestamp, before: null, after: { status: 'open' } }, { id: 1, session_id: 'check-1', product_id: 12, product_name: 'Test variant', actor_id: 7, actor_name: 'alice', action: 'observe', created_at: historyTimestamp, before: { state: 'unstarted' }, after: { state: 'issue', reason: 'History reason' } }], total: 2, page: 1, pageSize: 20 }),
    createInventoryCheckSession: async (...args: unknown[]) => { creates.push(args); return { item: selected, receipt: {} } },
    saveInventoryCheckObservation: async (...args: unknown[]) => {
      saves.push(args)
      if (saveFailure !== 'none') throw Object.assign(new Error('test save failure'), { outcome: saveFailure === 'unknown' ? 'unknown' : 'not_dispatched' })
      const patch = args[2] as Partial<InventoryCheckSessionItem>
      observation = { ...observation, ...patch, revision: observation.revision + 1 }
      return { item: observation, session: selected, receipt: {} }
    },
    changeInventoryCheckSession: async () => { selected = { ...selected, status: selected.status === 'open' ? 'closed' : 'open', revision: selected.revision + 1 }; return { item: selected, receipt: {} } },
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
type Surface = Awaited<ReturnType<typeof mount>>
// A session is opened from its row (found by id: the list names sessions by start and branch, never a stored title).
const clickSessionRow = async (surface: Surface) => { await surface.click(surface.button(/./, surface.find(node => node.getAttribute('data-inventory-check-session') === 'check-1', 'session row'))) }
const openSession = async (surface: Surface, tab = 'sessions') => { await surface.click(surface.button(tab)); await clickSessionRow(surface) }
// Buttons by exact visible text: 'Count' is a prefix of the 'Count sessions' chip, and a dialog's Confirm repeats its action's label.
const exactButtons = (surface: Surface, text: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text)
// The page's own Count button carries a pill with how many products it counts, so it is found by its "Count (n)" name.
const countButton = (surface: Surface) => surface.find(node => node.tagName === 'BUTTON' && (node.getAttribute('aria-label') ?? '').startsWith('Count ('), 'page Count button')
const confirmInDialog = async (surface: Surface, text: string) => { await surface.click(exactButtons(surface, text).at(-1)!) }
// The Filters menu (FilterMenu): open it once, expand a section, tick an option.
const chooseFilter = async (surface: Surface, section: string, option: string) => {
  if (!surface.findAll(node => node.getAttribute('data-filter-menu-section') !== null).length) await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  const header = surface.find(node => node.getAttribute('data-filter-menu-section') === section, section + ' section')
  if (header.querySelectorAll('[role="option"]').length === 0) await surface.click(surface.button(/./, header))
  await surface.click(surface.find(node => node.getAttribute('role') === 'option' && header.contains(node) && node.textContent === option, option + ' in ' + section))
}
try {
  delayBootstrap = true
  const bootstrap = await mount()
  await bootstrap.type(bootstrap.field('inventory-check-search'), 'Typed before branch discovery')
  await bootstrap.click(bootstrap.button('Today'))
  await chooseFilter(bootstrap, 'sort', 'stock: high → low')
  const newestBootstrap = bootstrapReads.at(-1)!
  delayBootstrap = false
  await act(async () => { newestBootstrap.resolve(response()) })
  await bootstrap.settle()
  assert.equal(propsOf(bootstrap.field('inventory-check-search')).value, 'Typed before branch discovery', 'sole-branch discovery preserves controls typed while its request was pending')
  assert.equal(productRequests.at(-1)?.branchId, '1')
  assert.equal(productRequests.at(-1)?.query, newestBootstrap.params.query)
  assert.equal(productRequests.at(-1)?.startDate, newestBootstrap.params.startDate)
  assert.equal(productRequests.at(-1)?.endDate, newestBootstrap.params.endDate)
  assert.equal(productRequests.at(-1)?.sortDirection, 'desc')
  for (const older of bootstrapReads.slice(0, -1)) older.resolve({ ...response(), items: [{ ...product, name: 'Stale bootstrap result' }] })
  await bootstrap.settle()
  assert.ok(!bootstrap.text().includes('Stale bootstrap result'), 'older bootstrap requests remain fenced after branch discovery')
  await bootstrap.unmount()
  const filtering = await mount()
  assert.ok(filtering.find(node => node.getAttribute('data-inventory-check-page') !== null, 'Inventory page root').className.split(' ').includes('page-scroll'))
  const retainedFilters: Record<string, string> = { branchId: '1' }
  for (const [section, label, value, key] of [
    ['brand', 'Off-page brand', 'Off-page brand', 'brand'], ['category', 'Off-page category', 'Off-page category', 'category'],
    ['reason', 'Off-page reason', 'Off-page reason', 'reason'], ['stockState', 'low_stock', 'low_stock', 'stockState'],
    ['state', 'issues', 'issue', 'state'], ['sort', 'qty_sold: high → low', 'qty_sold', 'sortBy'],
  ]) {
    const beforeFilter = productRequests.length
    await chooseFilter(filtering, section, label)
    retainedFilters[key] = value
    assert.ok(productRequests.length > beforeFilter, `${key} changes the request key and dispatches a fresh query`)
    for (const [field, expected] of Object.entries(retainedFilters)) assert.equal(productRequests.at(-1)?.[field], expected, `${field} survives the next filter change`)
  }
  assert.equal(productRequests.at(-1)?.sortDirection, 'desc', 'a Sort choice sends its field and its direction together')
  await chooseFilter(filtering, 'sort', 'qty_sold: low → high')
  assert.deepEqual([productRequests.at(-1)?.sortBy, productRequests.at(-1)?.sortDirection], ['qty_sold', 'asc'], 'the other direction of the same field is one more choice in the same section')
  assert.equal(filtering.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger').getAttribute('title'), 'filters (6)', 'the Filters trigger counts the five chosen filters and the non-default Sort')
  await filtering.unmount()
  const surface = await mount()
  assert.ok(surface.text().includes('Test variant'))
  assert.ok(!surface.text().includes('inventory_check_filter_options_limited'), 'the capped-facet note is not a line of prose in the toolbar')
  assert.equal(surface.findAll(node => node.getAttribute('aria-label') === 'inventory_check_filter_options_limited').length, 0, 'and it is no hint button beside Filters any more')
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  await surface.click(surface.button(/./, surface.find(node => node.getAttribute('data-filter-menu-section') === 'category', 'category section')))
  assert.ok(!surface.find(node => node.getAttribute('data-filter-menu-section') === 'category', 'category section').textContent.includes('inventory_check_filter_options_limited'), 'a list the server did not cap carries no note')
  await chooseFilter(surface, 'brand', 'Off-page brand')
  assert.ok(surface.find(node => node.getAttribute('data-filter-menu-section') === 'brand', 'brand section').textContent.includes('inventory_check_filter_options_limited'), 'a capped list says so inside its own Filters section, where the person is choosing')
  assert.ok(surface.text().includes('Off-page brand'), 'filter options come from the complete cohort facet response, never the visible products')
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.textContent === 'all' && surface.find(n => n.getAttribute('data-filter-menu-section') === 'brand', 'brand section').contains(node), 'brand All row'))
  assert.ok(!surface.text().includes('913.27'), 'denied cost never renders')
  assert.equal(productRequests.at(-1)?.startDate, undefined)
  await surface.click(surface.button('Today'))
  assert.match(String(productRequests.at(-1)?.startDate), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(productRequests.at(-1)?.startDate, productRequests.at(-1)?.endDate, 'the full-day received/sales/customer cohort reaches the actual transport')
  assert.equal(productRequests.at(-1)?.startTime, undefined)
  await surface.click(surface.button('Received dates select products'))
  assert.ok(surface.text().includes('Received dates select products'), 'date cohort and current stock semantics are explicit, behind a hint')
  await openSession(surface)
  assert.ok(surface.text().includes('19/10/2026 09:30') && surface.text().includes('Test branch') && surface.text().includes('@alice'), 'the session bar names the session by start, branch and creator')
  await surface.click(surface.button('Report issue'))
  await surface.type(surface.field('inventory-check-count-12'), '0')
  await surface.type(surface.field('inventory-check-reason-12'), 'Shelf differs')
  saveFailure = 'unknown'
  await surface.click(surface.button('Save issue'))
  assert.ok(surface.text().includes('Save not confirmed'))
  assert.ok(!surface.text().includes('Counted 0'), 'unknown acknowledgement never becomes optimistic saved state')
  const first = saves.at(-1)!
  saveFailure = 'none'
  await surface.click(surface.button('Retry'))
  const second = saves.at(-1)!
  assert.deepEqual(second.slice(1), first.slice(1), 'unknown retry retains product, patch, both revisions and request ID')
  assert.ok(surface.text().includes('Counted 0'), 'confirmed zero survives resumed server observations')
  assert.ok(surface.text().includes('Shelf differs'))
  readRevision = '2'
  await surface.render({})
  assert.ok(surface.text().includes('@alice') && surface.text().includes('Shelf differs'), 'ordinary own-write channel invalidation preserves the selected session')
  await surface.click(surface.button('Test variant'))
  const detailText = surface.find(node => node.getAttribute('data-inventory-check-detail') !== null, 'detail list').textContent
  assert.ok(detailText.includes('Current stock8 pcs') && detailText.includes('Starting stock9') && detailText.includes('Difference−1'), 'the detail float shows stock with its unit, the fixed baseline and the drift: ' + detailText)
  assert.ok(detailText.includes('Received date01/10/2026') && detailText.includes('Expiry15/03/2027'), 'and the latest received date and the next expiry: ' + detailText)
  assert.ok(detailText.includes('Counted0 (−8)') && detailText.includes('Check statusIssue · Shelf differs') && detailText.includes('Sold4') && detailText.includes('BrandTest brand'), 'and the count against stock, the check status with its reason, sales and brand: ' + detailText)
  assert.ok(!detailText.includes('Cost') && !surface.text().includes('913.27'), 'cost never reaches the float for a role that may not see it')
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'detail close'))
  await surface.click(surface.button('Close session'))
  assert.ok(surface.text().includes('Close this count session?'), 'Close first shows the shared review')
  const closeReview = surface.find(node => node.tagName === 'DL', 'close review').textContent
  assert.ok(closeReview.includes('products1') && closeReview.includes('Done0') && closeReview.includes('Issue0') && closeReview.includes('Not started1'), 'the review lists total / done / issue / not started counts: ' + closeReview)
  assert.ok(surface.text().includes('19/10/2026 · Test branch'), 'the review names the session by its start date and branch, not by a stored title')
  await confirmInDialog(surface, 'Close session')
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'closed session cannot edit')
  await surface.click(surface.button('Resume session'))
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1)
  await openSession(surface)
  assert.equal(surface.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1, 'reselecting the current session returns to its editable product list')
  await surface.click(surface.button('history'))
  assert.ok(surface.text().includes('History reason'), 'session immutable action history is read through the dedicated endpoint')
  assert.ok(surface.text().includes('20/10/2026 01:05'), 'SQLite UTC history timestamps use dd/mm/yyyy and 24-hour business time across midnight')
  const historyText = surface.find(node => node.getAttribute('data-inventory-check-history') === '1', 'observe event').textContent
  assert.equal(historyText, '20/10/2026 01:05 · @alice · Test variant · Not started → Issue · History reason', 'a history row reads date · user · product · state change · reason, with no ids')
  assert.ok(surface.find(node => node.getAttribute('data-inventory-check-history') === '2', 'create event').textContent.endsWith('Session created'), 'a session-level event names its action')
  const allHistory = surface.findAll(node => node.getAttribute('data-inventory-check-history') !== null).map(node => node.textContent).join('|')
  assert.ok(!allHistory.includes('inventory_check_') && !allHistory.split(/[^a-z_]+/i).some(word => ['observe', 'create', 'close', 'resume', 'unstarted'].includes(word)) && !allHistory.includes('#'), 'no raw action key or product id reaches the screen: ' + allHistory)
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'history close'))
  await surface.unmount()

  app.user = { ...app.user, id: 8 }
  const other = await mount()
  await openSession(other)
  assert.ok(other.text().includes('Shelf differs'), 'permitted staff can view another account session')
  assert.equal(other.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'another employee cannot edit the creator session')
  await other.unmount()

  app.user = { ...app.user, id: 7 }
  const creation = await mount()
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, writable: true, value: undefined })
  await openSession(creation)
  await creation.click(creation.button('Leave session'))
  await creation.click(countButton(creation))
  const reviewRows = creation.find(node => node.tagName === 'DL', 'count review').textContent
  assert.ok(creation.text().includes('Start a count session?') && reviewRows.includes('products1') && reviewRows.includes('Test branch'), 'Count reviews the product count and branch before anything is created: ' + reviewRows)
  assert.equal(creates.length, 0, 'nothing is created until the review is confirmed')
  await creation.click(creation.button('Cancel', creation.find(node => node.tagName === 'DL', 'review').parentNode!.parentNode!))
  assert.equal(creates.length, 0, 'Cancel creates nothing')
  await creation.click(countButton(creation))
  await confirmInDialog(creation, 'Count')
  const input = creates.at(-1)?.[1] as { productIds: number[]; scope: Record<string, unknown>; requestId: string }
  assert.deepEqual(input.productIds, [12])
  assert.equal(input.scope.membership, 'visible_page', 'creation records its actual bounded membership')
  assert.match(input.requestId, /^inventory_check_\d+_[a-z0-9]+$/, 'session creation uses the shared supported-browser fallback without randomUUID')
  restoreUuid()
  await creation.unmount()

  failRead = true
  const failed = await mount()
  assert.ok(failed.text().includes('unavailable'))
  assert.ok(!failed.text().includes('Test variant'), 'failed read never substitutes cached catalog rows')
  failRead = false
  const beforeRetry = productRequests.length
  await failed.click(failed.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'retry', 'load Retry'))
  assert.ok(productRequests.length > beforeRetry && failed.text().includes('Test variant') && !failed.text().includes('unavailable'), 'the load error offers Retry, which re-reads and brings the rows back')
  await failed.unmount()

  const switching = await mount()
  await openSession(switching)
  await switching.click(switching.button('Edit issue'))
  await switching.type(switching.field('inventory-check-reason-12'), 'Private A draft')
  app.user = { ...app.user, id: 8 }
  await switching.render({})
  assert.equal(switching.findAll(node => node.getAttribute('id') === 'inventory-check-reason-12').length, 0)
  assert.equal(dirtyWork.getDirtyWork().filter(entry => entry.pageId === 'inventory').length, 0, 'actor transitions detach actual row dirty entries without allowing a stale guard to retain protected input')
  app.user = { ...app.user, id: 7 }
  await switching.render({})
  assert.ok(!switching.text().includes('Private A draft'), 'A→B→A remount never restores private in-memory drafts')
  assert.equal(switching.findAll(node => node.getAttribute('data-check-action') === 'done').length, 0, 'account transition returns to unselected Products')
  await switching.unmount()

  const raced = await mount()
  delayedProducts = () => {}
  await raced.type(raced.field('inventory-check-search'), 'older query')
  const oldResponse = delayedProducts as (value: unknown) => void
  delayedProducts = null
  await raced.type(raced.field('inventory-check-search'), 'newer query')
  assert.equal(productRequests.at(-1)?.query, 'newer query')
  oldResponse({ ...response(), items: [{ ...product, name: 'STALE PRIVATE RESULT' }] })
  await raced.settle()
  assert.ok(!raced.text().includes('STALE PRIVATE RESULT'), 'late query completion cannot publish under a different query')
  await openSession(raced)
  await raced.click(raced.button('Edit issue'))
  await raced.type(raced.field('inventory-check-reason-12'), 'Known refusal draft')
  saveFailure = 'known'
  await raced.click(raced.button('Save issue'))
  assert.ok(raced.text().includes('Check not saved'))
  assert.equal((raced.field('inventory-check-reason-12') as unknown as { value: string }).value, 'Known refusal draft')
  saveFailure = 'none'
  const previous = saves.at(-1)!
  await raced.click(raced.button('Retry'))
  assert.deepEqual(saves.at(-1)?.slice(1), previous.slice(1), 'known-refusal retry also keeps frozen expected revisions')
  app.user = { ...app.user, permissions: { ...app.user.permissions, inventory_check_show_cost: false, inventory_check_show_stock: false, inventory_check_show_sales: false } }
  await raced.render({})
  assert.ok(!raced.text().includes('Now 8') && !raced.text().includes('Sold 4'), 'same-account field revocation synchronously detaches protected row values')
  assert.ok(!raced.text().includes('Counted 0'), 'stock denial also removes the saved count')
  assert.equal(raced.findAll(node => node.getAttribute('id') === 'inventory-check-reason-12').length, 0)
  await raced.unmount()

  const blindOwner = await mount()
  await openSession(blindOwner)
  assert.ok(blindOwner.text().includes('Counted 0'), 'a creator keeps their own entered count while system stock stays hidden')
  assert.ok(!blindOwner.text().includes('Now 8'))
  await blindOwner.click(blindOwner.button('Edit issue'))
  await blindOwner.type(blindOwner.field('inventory-check-count-12'), '37')
  await blindOwner.click(blindOwner.button('Save issue'))
  assert.equal((saves.at(-1)?.[2] as { counted_quantity: number }).counted_quantity, 37)
  assert.ok(blindOwner.text().includes('Counted 37'))
  await blindOwner.unmount()
  app.user = { ...app.user, id: 8 }
  const blindOther = await mount()
  await blindOther.click(blindOther.button('issues'))
  assert.equal(productRequests.at(-1)?.state, 'issue', 'all-session issue filtering belongs to the server population before pagination')
  assert.ok(blindOther.text().includes('All-session issue reason'))
  assert.ok(!blindOther.text().includes('37'), 'all-session issue summaries respect other creator hidden counts')
  assert.equal(blindOther.findAll(node => node.getAttribute('data-check-action') === 'issue').length, 0, 'all-session issue list has no writes before selecting a real session')
  await blindOther.click(blindOther.button('Open session'))
  assert.equal(productRequests.at(-1)?.sessionId, 'check-1')
  assert.equal(productRequests.at(-1)?.branchId, '1', 'issue link resumes its actual branch/session identity')
  assert.ok(!blindOther.text().includes('Counted 37'), 'stock-blind staff cannot see another creator entered count')
  assert.equal(blindOther.findAll(node => node.getAttribute('data-check-action') === 'issue').length, 0)
  await blindOther.unmount()
  app.user = { ...app.user, role_code: 'admin' }
  const admin = await mount()
  await openSession(admin)
  assert.equal(admin.findAll(node => node.getAttribute('data-check-action') === 'done').length, 1, 'administrator authority can edit another creator session')
  await admin.click(admin.button('Test variant'))
  assert.ok(admin.find(node => node.getAttribute('data-inventory-check-detail') !== null, 'detail list').textContent.includes('Cost$913.2700'), 'cost shows in the detail float for a role allowed to see it')
  await admin.unmount()

  window.history.replaceState(null, '', '/inventory?retained=1#hub:inventory:issues')
  productTotal = 41
  const cold = await mount()
  assert.equal(cold.button('issues').getAttribute('aria-pressed'), 'true', 'cold Inventory URL selects Issues through the actual shared hook')
  assert.ok(cold.text().includes('All-session issue reason'))
  assert.equal(window.location.search, '?retained=1', 'initial section publication preserves query state')
  await cold.click(cold.button('products'))
  assert.equal(window.location.hash, '#hub:inventory:products')
  await cold.click(cold.button('sessions'))
  assert.equal(window.location.hash, '#hub:inventory:sessions')
  await act(async () => { window.history.back() }); await cold.settle()
  assert.equal(cold.button('products').getAttribute('aria-pressed'), 'true', 'Back restores the previously committed Products section')
  await act(async () => { window.history.back() }); await cold.settle()
  assert.equal(cold.button('issues').getAttribute('aria-pressed'), 'true', 'Back restores the cold Issues section')
  await act(async () => { window.history.forward() }); await cold.settle()
  assert.equal(cold.button('products').getAttribute('aria-pressed'), 'true', 'Forward restores the committed Products section')
  blockNavigation = true
  const blockedHash = window.location.hash
  await cold.click(cold.button('sessions'))
  assert.equal(window.location.hash, blockedHash)
  assert.equal(cold.button('products').getAttribute('aria-pressed'), 'true', 'page body defers to the app navigation guard instead of switching eagerly')
  blockNavigation = false
  await cold.click(cold.button('sessions'))
  await clickSessionRow(cold)
  await cold.click(cold.button('next'))
  assert.equal(productRequests.at(-1)?.page, 2)
  await cold.click(cold.button('Edit issue'))
  await cold.type(cold.field('inventory-check-reason-12'), 'Guarded local draft')
  assert.ok(dirtyWork.getDirtyWork().some(entry => entry.pageId === 'inventory'), 'the actual row registers its entered count/reason in the actual shared dirty-work registry')
  assert.equal(propsOf(cold.button('Leave session')).disabled, true)
  assert.equal(propsOf(cold.button('Close session')).disabled, true)
  assert.equal(propsOf(cold.button('refresh')).disabled, true)
  assert.equal(propsOf(cold.find(node => node.getAttribute('data-inventory-check-query-lock') !== null, 'query controls')).disabled, true)
  assert.equal(propsOf(cold.find(node => node.getAttribute('data-inventory-check-pager-lock') !== null, 'paging controls')).disabled, true)
  assert.equal(propsOf(cold.button('top_customers')).disabled, true, 'ranking opt-in cannot change scope while the real row is editing')
  const beforeBlockedInput = productRequests.length
  await cold.type(cold.field('inventory-check-search'), 'must not change scope')
  assert.equal(productRequests.length, beforeBlockedInput)
  await cold.click(cold.button('issues'))
  assert.equal(productRequests.at(-1)?.page, 2, 'a rejected section request cannot eagerly reset pagination and remount a dirty row')
  assert.equal((cold.field('inventory-check-reason-12') as unknown as { value: string }).value, 'Guarded local draft', 'rejected section navigation preserves the mounted local editor')
  assert.equal(cold.button('products').getAttribute('aria-pressed'), 'true')
  await cold.click(cold.button('Cancel'))
  assert.equal(dirtyWork.getDirtyWork().filter(entry => entry.pageId === 'inventory').length, 0, 'actual row Cancel releases navigation protection')
  assert.equal(propsOf(cold.button('Leave session')).disabled, false)
  await cold.click(cold.button('sessions'))
  assert.equal(cold.button('sessions').getAttribute('aria-pressed'), 'true')
  await cold.unmount()
  window.history.replaceState(null, '', '/inventory#hub:inventory:products')
  const shrinking = await mount()
  await shrinking.click(shrinking.button('next'))
  await shrinking.click(shrinking.button('next'))
  assert.equal(productRequests.at(-1)?.page, 3)
  productTotal = 1
  emptyPastLastPage = true
  const beforeShrink = productRequests.length
  await shrinking.click(shrinking.button('refresh'))
  assert.deepEqual(productRequests.slice(beforeShrink).map(request => request.page), [3, 1], 'a smaller authoritative total re-requests the valid page through the shared pager')
  assert.ok(shrinking.text().includes('Test variant'), 'the re-request restores rows after the former last page is empty')
  await shrinking.unmount()
  emptyPastLastPage = false
  productTotal = 1

  window.history.replaceState(null, '', '/inventory#hub:inventory:products')
  app.user = { ...app.user, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, contacts: true } }
  const beforeRanking = productRequests.length
  const ranking = await mount()
  assert.ok(productRequests.slice(beforeRanking).every(request => request.customerRanking === undefined), 'customer identities are not requested before explicit opt-in')
  assert.ok(!ranking.text().includes('Opt-in customer identity'))
  await ranking.click(ranking.button('Stats'))
  assert.ok(ranking.text().includes('Best seller beyond visible page'), 'product ranking uses the full-cohort server ranking rather than sorting the current page')
  await ranking.click(ranking.button('top_products'))
  assert.ok(ranking.text().includes('99'))
  await ranking.click(ranking.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'product ranking close'))
  const customersToggle = () => ranking.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'top_customers', 'Top customers toggle')
  assert.equal(customersToggle().textContent, '', 'Top customers is an icon-only toggle')
  await ranking.click(customersToggle())
  assert.equal(productRequests.at(-1)?.customerRanking, '1')
  assert.ok(ranking.text().includes('Opt-in customer identity'))
  await ranking.click(customersToggle())
  assert.equal(productRequests.at(-1)?.customerRanking, undefined)
  assert.ok(!ranking.text().includes('Opt-in customer identity'), 'toggle-off removes customer names while the next bounded request loads')
  await ranking.click(customersToggle())
  assert.ok(ranking.text().includes('Opt-in customer identity'))
  app.user = { ...app.user, permissions: { inventory: true, inventory_checks: true, contacts: false } }
  await ranking.render({})
  assert.equal(ranking.findAll(node => node.tagName === 'BUTTON' && (node.textContent.includes('top_customers') || node.getAttribute('aria-label') === 'top_customers')).length, 0, 'Contacts denial immediately removes customer ranking controls')
  assert.ok(!ranking.text().includes('Opt-in customer identity'))
  await ranking.unmount()

  app.user = { ...app.user, id: 7, permissions: { inventory: true, inventory_checks: true } }
  selected = { ...selected, progress: { total: 2, done: 0, issue: 1, unstarted: 1 } }
  memberOverride = [
    { ...observation, product_id: 901, state: 'issue', reason: 'Saved original issue', counted_quantity: 37, baseline_quantity: 19283, current_quantity: null, current_product_available: false, current_product_name: null, product_snapshot: { id: 901, name: 'Removed original', cost_price_usd: 913.27, selling_price_usd: 777.13 } },
    { ...observation, product_id: 902, state: 'unstarted', counted_quantity: null, baseline_quantity: 19284, current_quantity: 8, current_product_available: true, current_product_name: 'Current renamed name', product_snapshot: { id: 902, name: 'Starting original name' } },
  ]
  productOverride = [{ id: 902, name: 'Current renamed name', quantity: 8 }]
  const members = await mount()
  await openSession(members)
  assert.ok(members.text().includes('Removed original') && members.text().includes('Saved original issue'), 'removed originals remain visible from their authorized frozen session snapshots')
  assert.ok(members.text().includes('Unavailable') && members.text().includes('Renamed') && !members.text().includes('Unavailable session products'), 'unavailable and renamed originals are small row badges, not prose blocks')
  assert.ok(members.text().includes('Current renamed name') && !members.text().includes('Starting original name'), 'a renamed row shows its current name; the starting name waits behind its hint')
  await members.click(members.button('Starting name: Starting original name'))
  assert.ok(members.text().includes('Starting original name') && members.text().includes('Current renamed name'), 'renamed originals show starting and current identity under the original product ID')
  assert.equal(members.findAll(node => Boolean(node.getAttribute('data-check-action') && node.getAttribute('aria-label')?.includes('Removed original'))).length, 0, 'unavailable originals are read-only')
  assert.ok(members.findAll(node => Boolean(node.getAttribute('data-check-action') && node.getAttribute('aria-label')?.includes('Current renamed name'))).length > 0, 'a current renamed member remains independently checkable')
  assert.ok(!members.text().includes('913.27') && !members.text().includes('777.13'), 'unavailable snapshots never imply current prices or expose frozen commercial fields')
  await members.click(members.button('refresh'))
  assert.equal(members.findAll(node => node.getAttribute('data-inventory-check-row') === '901').length, 1, 'repeated reads preserve one frozen original without duplication')
  productOverride = []
  await members.click(members.button('refresh'))
  assert.equal(members.findAll(node => node.getAttribute('data-inventory-check-row') === '901').length, 1)
  assert.equal(members.findAll(node => node.getAttribute('data-inventory-check-row') === '902').length, 0, 'a member absent only from a filtered or paged response is not mislabeled unavailable')
  assert.ok(!members.text().includes('No matching products.'), 'empty live results do not conceal the frozen unavailable member behind a generic empty state')
  memberOverride = memberOverride.map(item => ({ ...item, current_product_available: false, current_product_name: null }))
  await members.click(members.button('refresh'))
  assert.equal(members.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length, 2, 'all removed originals remain visible with zero current products')
  assert.equal(members.findAll(node => node.getAttribute('data-check-action') !== null).length, 0)
  app.user = { ...app.user, id: 8, permissions: { inventory: true, inventory_checks: true, inventory_check_show_stock: false, inventory_check_show_price: false, inventory_check_show_cost: false } }
  await members.render({})
  await openSession(members)
  assert.ok(members.text().includes('Removed original'))
  assert.ok(!members.text().includes('19283') && !members.text().includes('19284') && !members.text().includes('37'), 'hidden system quantities and another creator count stay absent in the frozen fallback')
  assert.equal(members.findAll(node => node.getAttribute('data-check-action') !== null).length, 0)
  await members.unmount()
  productOverride = null
  memberOverride = null
  app.user = { ...app.user, id: 7, permissions: { inventory: true, inventory_checks: true } }
  selected = { ...selected, started_at: '2026-10-19 18:05:00', progress: undefined, branch_name: null, creator_name: undefined }
  for (const language of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
    app.language = language
    app.t = (key: string) => pack[key] || key
    window.history.replaceState(null, '', '/inventory#hub:inventory:products')
    const dates = await mount()
    await dates.click(dates.button(pack.inventory_check_sessions))
    assert.ok(dates.find(node => node.getAttribute('data-inventory-check-session') === 'check-1', 'session row').textContent.includes('20/10/2026 01:05'), `${language}: the session row shows its start with the same business date/time formatter`)
    await clickSessionRow(dates)
    for (const raw of ['2026-10-19 18:05:00', 0, 'not-a-date']) {
      historyTimestamp = raw
      await dates.click(dates.button(pack.history))
      const historyRow = dates.find(node => node.getAttribute('data-inventory-check-history') === '1', 'history event')
      const expected = raw === '2026-10-19 18:05:00' ? '20/10/2026 01:05' : fmtDateTime24(raw)
      assert.ok(historyRow.textContent.startsWith(`${expected} · `), `${language}: history uses the actual formatter including zero/invalid fallback`)
      assert.ok(historyRow.textContent.includes(`${pack.inventory_check_unstarted} → ${pack.inventory_check_issue}`) && !dates.text().includes('inventory_check_history_'), `${language}: history states are translated`)
      assert.ok(historyRow.textContent.includes('History reason'))
      assert.ok(!dates.text().includes('913.27'), `${language}: date formatting does not expose cost`)
      await dates.click(dates.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === pack.close, 'history close'))
    }
    await dates.unmount()
  }
  console.log('inventoryChecksPage mounted journeys passed')
} finally { restoreUuid(); await harness.close() }
