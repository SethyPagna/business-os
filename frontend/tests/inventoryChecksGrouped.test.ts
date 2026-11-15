import assert from 'node:assert/strict'
import { createHarness, MemoryNode, propsOf, type MountedSurface } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// The mounted Inventory page with a server that groups its list (capabilities.groupings): what it asks for, what a header counts, and that collapsing is local.
const COUNT_FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
let harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const applyLocation = (url: string) => { const next = new URL(url, 'https://admin.example.test/'); Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) }
window.history.pushState = (_s, _u, url) => { applyLocation(String(url)) }
window.history.replaceState = (_s, _u, url) => { applyLocation(String(url)) }
applyLocation('https://admin.example.test/inventory#hub:inventory:products')

const row = (id: number, group_key: string, extra: Partial<InventoryCheckProduct> = {}): InventoryCheckProduct => ({ id, name: `Product ${id}`, quantity: 5, unit: 'pcs', barcode: `BC100${id}`, check_status: 'not_checked', group_key, ...extra })
const items = [row(1, 'd:2026-11-12'), row(2, 'd:2026-11-12'), row(3, 'd:2026-11-03'), row(4, 'never')]
const byDate = { by: 'checked', unit: 'family', groups: [
  { key: 'd:2026-11-12', label: null, families: 2, products: 40, continued_before: false, continues_after: true },
  { key: 'd:2026-11-03', label: null, families: 1, products: 7, continued_before: false, continues_after: false },
  { key: 'never', label: null, families: 1, products: 120, continued_before: false, continues_after: false }] }
const byCategory = { by: 'category', unit: 'family', groups: [
  { key: 'c:serum', label: 'Serum', families: 2, products: 9, continued_before: false, continues_after: false },
  { key: 'none', label: null, families: 2, products: 30, continued_before: false, continues_after: false }] }
const categoryItems = [row(1, 'c:serum'), row(2, 'c:serum'), row(3, 'none'), row(4, 'none')]
const requests: Array<Record<string, unknown>> = []
let groupings: string[] | null = null
let total = 160
// A server that cannot group still accepts groupBy and ignores it; one that can answers `grouping`. denyCategory: the grant is gone (403).
let serverGroups = true
let denyCategory = false
const answer = (params: Record<string, unknown>) => {
  const grouped = serverGroups && (params.groupBy === 'checked' || params.groupBy === 'category')
  if (denyCategory && params.groupBy === 'category') throw Object.assign(new Error('Hidden'), { status: 403, code: 'inventory_check_field_hidden' })
  return { items: grouped && params.groupBy === 'category' ? categoryItems : items, total, page: 1, pageSize: 20, totalPages: Math.ceil(total / 20), simple: true, branches: [{ id: 1, name: 'Test branch' }, { id: 2, name: 'Second branch' }],
    ...(params.summary === 0 ? {} : { summary: { not_checked: 17, in_check: 2, ok: 5, issue: 1, total: 25 }, facets: { brands: [], categories: [] } }),
    ...(groupings ? { capabilities: { groupings } } : {}), ...(grouped ? { grouping: params.groupBy === 'category' ? byCategory : byDate } : {}) }
}
// ic_wired: the Products list with the same grouping block.
let wiredOn = false
const wiredRequests: Array<Record<string, unknown>> = []
const wiredAnswer = (params: Record<string, unknown>) => ({ wired: true, projected: false, total, page: 1, pageSize: 20, totalPages: 8, summary: { ok: 1, issue: 0, not_checked: 3, total: 4 },
  items: items.map(item => ({ id: item.id, name: item.name, barcode: item.barcode, stock_quantity: 5, unit: 'pcs', group_key: item.group_key, branch_stock: [{ branch_id: 1, branch_name: 'Test branch', quantity: 5 }, { branch_id: 2, branch_name: 'Second branch', quantity: 0 }] })),
  capabilities: { groupings: ['checked', 'category'] }, ...(params.groupBy === 'checked' ? { grouping: byDate } : {}) })
const app = {
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...COUNT_FIELDS } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true,
  t: (key: string) => ({ expand: 'Expand', collapse: 'Collapse', inventory_check_group_never: 'Never checked', inventory_check_group_no_category: 'No category', inventory_check_group_by: 'Group by', inventory_check_group_checked: 'Last checked date', inventory_check_group_category: 'Category', inventory_check_group_none: 'No grouping' } as Record<string, string>)[key] ?? key,
  notify: () => {}, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
  navigateTo: (page: string, anchor?: string) => { window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } })) },
}
const doubles = {
  'utils/dirtyWork.ts': dirtyWork,
  'api/actorReadScope.ts': { captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }), captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }), isActorReadScopeCurrent: () => true, isActorWriteIdentityCurrent: () => true },
  'api/inventoryChecksTransport.ts': {
    captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
    readInventoryCheckList: async (params: Record<string, unknown>) => {
      if (!wiredOn) throw Object.assign(new Error('Not found'), { status: 404, code: 'not_found' })
      wiredRequests.push({ ...params })
      return wiredAnswer(params)
    },
    readInventoryCheckProducts: async (params: Record<string, unknown>) => { requests.push({ ...params }); return answer(params) },
    readInventoryCheckSessions: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
const headers = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-inventory-check-group') !== null)
const rowIds = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-inventory-check-row') !== null).map(node => node.getAttribute('data-inventory-check-row'))
const head = (s: MountedSurface, key: string) => s.find(node => node.getAttribute('data-inventory-check-group') === key, `header ${key}`)
const pagerText = (s: MountedSurface) => s.find(node => node.getAttribute('data-inventory-check-pager') === 'top', 'top pager').textContent
const chooseGroup = async (s: MountedSurface, option: string) => {
  if (!s.findAll(node => node.getAttribute('data-filter-menu-section') !== null).length) await s.click(s.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  const section = s.find(node => node.getAttribute('data-filter-menu-section') === 'group', 'Group by section')
  if (section.querySelectorAll('[role="option"]').length === 0) await s.click(s.button(/./, section))
  await s.click(s.find(node => node.getAttribute('role') === 'option' && section.contains(node) && node.textContent === option, option))
}
const search = (s: MountedSurface) => s.field('inventory-check-search')
// Every frame that reaches the screen with rows but no group header is a flat first paint: the grouped list's chunk is fetched with the first request and the list is drawn once both are in.
function watchFlatFrames() {
  const flatFrames: string[] = []
  const originals = { appendChild: MemoryNode.prototype.appendChild, insertBefore: MemoryNode.prototype.insertBefore }
  for (const name of ['appendChild', 'insertBefore'] as const) {
    const original = originals[name] as (...args: unknown[]) => unknown
    ;(MemoryNode.prototype as unknown as Record<string, unknown>)[name] = function (this: MemoryNode, ...args: unknown[]) {
      const result = original.apply(this, args)
      if (document.body.querySelector('[data-inventory-check-row]') && !document.body.querySelector('[data-inventory-check-group]')) flatFrames.push(name)
      return result
    }
  }
  return { stop: () => { Object.assign(MemoryNode.prototype, originals); return flatFrames } }
}
// Every Sort choice, one after the other, with "No grouping" already chosen: each read is flat, sends no groupBy, and nothing draws a section. Returns how many choices were walked.
const sweepSorts = async (s: MountedSurface, sent: Array<Record<string, unknown>> = requests) => {
  const openSort = async () => {
    if (!s.findAll(node => node.getAttribute('data-filter-menu-section') !== null).length) await s.click(s.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
    const section = s.find(node => node.getAttribute('data-filter-menu-section') === 'sort', 'Sort section (shown with No grouping)')
    if (section.querySelectorAll('[role="option"]').length === 0) await s.click(s.button(/./, section))
    return section
  }
  const count = (await openSort()).querySelectorAll('[role="option"]').length
  assert.ok(count >= 2, 'the Sort menu offers the name sorts')
  for (let index = 0; index < count; index++) {
    const section = await openSort()
    const option = section.querySelectorAll('[role="option"]')[index]
    const label = option.textContent
    assert.ok(!/Newest check first|inventory_check_sort_checked/.test(label), 'the date sort is not offered')
    const before = sent.length
    await s.click(option)
    await s.settle({})
    for (const request of sent.slice(before)) assert.equal(request.groupBy, undefined, `no groupBy with No grouping + ${label}`)
    assert.equal(headers(s).length, 0, `no sections with No grouping + ${label}`)
  }
  return count
}
const enter = async (s: MountedSurface) => { const box = search(s); await s.call(box, 'onKeyDown', [{ key: 'Enter', preventDefault() {}, nativeEvent: {}, currentTarget: { value: propsOf(box).value }, target: box }]) }

try {
  // 1. A server that cannot group ignores groupBy: the first request already carries it, a cold tab reads exactly once, and an answer without `grouping` draws the name order with no Group by control.
  serverGroups = false
  const plain = await mount()
  assert.equal(requests.length, 1, 'a cold tab spends one list read, not a probe plus a second read')
  assert.equal(requests[0].groupBy, 'checked', 'the first request carries groupBy=checked')
  assert.equal(requests[0].sortBy, undefined, 'never together with a sort')
  assert.equal(headers(plain).length, 0, 'no headers: the name-order list')
  await plain.click(plain.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  assert.ok(!plain.findAll(node => node.getAttribute('data-filter-menu-section') === 'group').length, 'the Group by control is hidden')
  assert.deepEqual(rowIds(plain), ['1', '2', '3', '4'])
  await plain.click(plain.button('next', plain.find(node => node.getAttribute('data-inventory-check-pager-lock') !== null, 'paging controls')))
  assert.ok(requests.at(-1)?.groupBy === undefined && requests.at(-1)?.sortBy === 'name', 'once an answer carried no grouping the next read is the name-ordered read: the sort is kept, not dropped')
  await plain.unmount()
  // The page remembers, for the tab, that this server did not group; the next scenario is a new tab on a server that does.
  await harness.close(); harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })

  // 2. The server advertises it: the page asks again, grouped, with no sort, and never draws the name-ordered answer first.
  groupings = ['checked', 'category']
  serverGroups = true
  requests.length = 0
  const watch = watchFlatFrames()
  const s = await mount()
  assert.deepEqual(watch.stop(), [], 'the first paint of a grouped list is grouped: never flat, then regrouped')
  assert.equal(requests.length, 1, 'a cold tab on a grouping server is also one list read')
  assert.ok(requests[0].groupBy === 'checked' && requests[0].sortBy === undefined && requests[0].sortDirection === undefined, 'groupBy=checked, no sort')
  assert.deepEqual(headers(s).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'])
  assert.ok(head(s, 'd:2026-11-12').textContent.startsWith('12/11/2026') && head(s, 'd:2026-11-12').textContent.includes('40'), 'dd/mm/yyyy and the server total, not the two rows on the page')
  assert.ok(head(s, 'never').textContent.startsWith('Never checked') && head(s, 'never').textContent.includes('120'))

  // 3. Collapsing sends nothing and moves no pager or total.
  const pagerBefore = pagerText(s), readsBefore = requests.length
  await s.click(s.button('Collapse', head(s, 'd:2026-11-12')))
  assert.deepEqual(rowIds(s), ['3', '4'], 'the collapsed group hides its rows')
  assert.equal(requests.length, readsBefore, 'a collapse sends no request')
  assert.equal(pagerText(s), pagerBefore, 'the pager is unchanged')
  assert.ok(head(s, 'd:2026-11-12').textContent.includes('40'), 'the header total is unchanged')

  // 4. The page-wide "matches stock" acts on open groups only.
  await s.click(s.find(node => node.getAttribute('data-selection-action') === 'mark', 'mark page'))
  assert.deepEqual(s.findAll(node => node.getAttribute('data-selected') !== null).map(node => node.getAttribute('data-inventory-check-row')), ['3', '4'], 'the collapsed group was left alone')
  assert.equal(s.find(node => node.getAttribute('data-selected-count') !== null, 'counted').textContent, '2 counted', 'only the two open rows were answered; the hidden ones have no draft')
  assert.equal(s.find(node => node.getAttribute('data-selection-action') === 'mark', 'mark page').getAttribute('title'), 'Mark every product in the open groups as matching stock', 'the tooltip says the tap acts on the open groups')
  assert.equal(requests.length, readsBefore, 'a mark reads nothing')

  // 5. A typed search (or a code scanned into the box) asks for no grouping: the answer is the flat list, every group opens again, and clearing the box brings the grouping back.
  await s.type(search(s), 'BC1001')
  await s.settle({ until: () => requests.at(-1)?.query === 'BC1001' })
  assert.equal(requests.at(-1)?.groupBy, undefined, 'no groupBy while a search is typed')
  assert.equal(requests.filter(request => request.query === 'BC1001' && request.groupBy !== undefined).length, 0, 'no grouped read of the search was ever sent')
  assert.equal(headers(s).length, 0, 'the search is a flat list')
  assert.ok(rowIds(s).includes('1'), 'the hit is on the page')
  const beforeScan = requests.length
  await enter(s)
  assert.equal(requests.length, beforeScan, 'the same code is not read again')
  assert.equal(requests.at(-1)?.groupBy, undefined, 'a scanned code is a search too')
  await s.type(search(s), '')
  await s.settle({ until: () => requests.at(-1)?.groupBy === 'checked' })
  assert.equal(requests.at(-1)?.query, '', 'the cleared box is read again')
  assert.deepEqual(headers(s).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'], 'grouped again once the search is cleared')
  assert.deepEqual(rowIds(s), ['1', '2', '3', '4'], 'with every group open (the collapse is cleared by the search)')

  // 6. A filter change clears the collapse; the grouping choice asks again with its own key and no sort.
  await s.click(s.button('Collapse', head(s, 'd:2026-11-03')))
  await chooseGroup(s, 'Category')
  assert.equal(requests.at(-1)?.groupBy, 'category')
  assert.equal(requests.at(-1)?.sortBy, undefined)
  assert.deepEqual(headers(s).map(node => node.getAttribute('data-inventory-check-group')), ['c:serum', 'none'])
  assert.ok(head(s, 'c:serum').textContent.startsWith('Serum') && head(s, 'none').textContent.startsWith('No category'), 'Category label, and No category last')
  assert.deepEqual(rowIds(s), ['1', '2', '3', '4'], 'a new grouping starts with every group open')

  // 6b. The grant for Category goes while the choice is stored: one 403, then the last checked date, once.
  denyCategory = true
  requests.length = 0
  await s.type(search(s), 'BC1002')
  await enter(s)
  await s.settle({ until: () => requests.at(-1)?.query === 'BC1002' })
  assert.deepEqual(requests.map(request => request.groupBy), [undefined], 'the typed search never asks for Category, so the refusal is not reached')
  await s.type(search(s), '')
  await s.settle({ until: () => requests.at(-1)?.groupBy === 'checked' })
  assert.deepEqual(requests.map(request => request.groupBy), [undefined, 'category', 'checked'], 'cleared: one refused read, then one fallback read: no loop')
  await s.settle({})
  assert.equal(requests.length, 3, 'nothing more is sent')
  assert.deepEqual(headers(s).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'], 'grouped by date again')
  denyCategory = false

  // 7. No grouping: today's name order, no groupBy.
  await chooseGroup(s, 'No grouping')
  assert.equal(requests.at(-1)?.groupBy, undefined)
  assert.equal(requests.at(-1)?.sortBy, 'name')
  assert.equal(headers(s).length, 0)
  // 7b. No grouping plus every remaining sort: a flat list, drawn without sections, and no groupBy on the wire.
  assert.ok(await sweepSorts(s) >= 2, 'ic_simple: every remaining sort is flat')
  await s.unmount()

  // 8. ic_wired: the first read of the Products-backed list carries groupBy and no sort, and its sections draw.
  await harness.close(); harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
  wiredOn = true
  const wiredWatch = watchFlatFrames()
  const wiredPage = await mount()
  assert.deepEqual(wiredWatch.stop(), [], 'wired: the first paint is grouped too')
  assert.equal(wiredRequests.length, 1, 'a cold wired tab is one list read')
  assert.ok(wiredRequests[0].groupBy === 'checked' && wiredRequests[0].sortBy === undefined && wiredRequests[0].sortDirection === undefined, 'groupBy=checked, no sort')
  assert.deepEqual(headers(wiredPage).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'], 'the wired list is drawn in sections')
  assert.ok(head(wiredPage, 'd:2026-11-12').textContent.includes('40'), 'with the server total')
  await chooseGroup(wiredPage, 'No grouping')
  assert.ok(wiredRequests.at(-1)?.groupBy === undefined && wiredRequests.at(-1)?.sortBy === 'name', 'No grouping goes back to the sorted read')
  assert.equal(headers(wiredPage).length, 0)
  assert.ok(await sweepSorts(wiredPage, wiredRequests) >= 2, 'wired: every remaining sort is flat')
  await chooseGroup(wiredPage, 'Last checked date')
  assert.equal(wiredRequests.at(-1)?.groupBy, 'checked')
  // A typed search: the wired read carries no groupBy (the device index and the Products store answer it, no extra read), and clearing it groups again.
  const readsBeforeSearch = wiredRequests.length
  await wiredPage.type(search(wiredPage), 'rose')
  await wiredPage.settle({ until: () => wiredRequests.at(-1)?.query === 'rose' })
  assert.equal(wiredRequests.length, readsBeforeSearch + 1, 'one list read for the typed search')
  assert.equal(wiredRequests.at(-1)?.groupBy, undefined, 'wired: no groupBy while a search is typed')
  assert.equal(headers(wiredPage).length, 0, 'wired: the search is flat')
  await wiredPage.type(search(wiredPage), '')
  await wiredPage.settle({ until: () => wiredRequests.at(-1)?.groupBy === 'checked' })
  assert.equal(wiredRequests.length, readsBeforeSearch + 2, 'one list read to group again')
  assert.deepEqual(headers(wiredPage).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'], 'wired: grouped again after the search')
  await wiredPage.unmount()
  console.log('inventoryChecksGrouped mounted journeys passed')
} finally { await harness.close() }
