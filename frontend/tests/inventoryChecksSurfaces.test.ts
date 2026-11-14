import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode } from './mountedComponentHarness.ts'
import type { InventoryCheckSession, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
// Counting is its own grant and so is every field it shows (owner, 21 Oct 2026): Inventory Full no longer implies them.
const COUNT_FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true, inventory_check_show_sales: true, inventory_check_show_customers: true }

// Board 6.0.859 (A1-A5, AC-A2/A3/A5/A6): the Sessions tab, the pinned controls, the session bar, Count review, states
// and icon-only buttons -- mounted in both language packs with the real components and a doubled transport.

const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'] })
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
const applyLocation = (url: string) => {
  const next = new URL(url, window.location.href)
  Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash })
}
window.history.pushState = (_state, _unused, url) => applyLocation(String(url))
window.history.replaceState = (_state, _unused, url) => applyLocation(String(url))
const goTo = (section: string) => applyLocation(`https://admin.example.test/inventory#hub:inventory:${section}`)

const packs = Object.fromEntries(['en', 'km'].map(language => [language, JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
// qty_sold and selling_price_usd are wire residue an older server may send: no surface draws them.
const product = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, quantity: 10, qty_sold: 4, selling_price_usd: 2.5, ...extra })
let products = [product(12, 'Row twelve', { barcode: '885000111', brand: 'Brand B' }), product(13, 'Row thirteen')]
let branches = [{ id: 1, name: 'Main' }]
let issues: Array<Record<string, unknown>> = []
const session = (id: string, started: string, extra: Partial<InventoryCheckSession> = {}): InventoryCheckSession => ({
  id, branch_id: 1, created_by: 7, title: 'Stored fixed title', status: 'open', revision: 1, scope: {}, started_at: started, updated_at: started,
  closed_at: null, can_edit: true, progress: { total: 20, done: 12, issue: 2, unstarted: 6 }, branch_name: 'Main', creator_name: 'alice', ...extra,
})
let sessionList: InventoryCheckSession[] = []
let sessionTotal = 0
let selected = session('s-1', '2026-10-19 02:30:00')
let members: InventoryCheckSessionItem[] = [{ product_id: 12, state: 'issue', revision: 1, counted_quantity: 8, reason: 'Shelf short', baseline_quantity: 12, current_quantity: 10, stock_changed: true, product_snapshot: products[0] }]
const productReads: Array<Record<string, unknown>> = []
const sessionReads: Array<Record<string, unknown>> = []
// The Worker tells a viewer who is shown approvals (ic_fix_stock + stock figures) with `approvals: true`; only then may the list be narrowed to counts waiting for one.
let sessionApprovals = false
const creates: unknown[][] = []
const submissions: Array<{ scope: unknown; input: { branchId: number; requestId: string; lines: Array<Record<string, unknown>> } }> = []
// A held gate keeps a read pending so the loading shape can be inspected, then lets it through.
let productGate: Promise<void> | null = null
let releaseProducts: () => void = () => {}
let historyGate: Promise<void> | null = null
let releaseHistory: () => void = () => {}
let failHistory = false
let historyBody: { items: unknown[]; total: number; page: number; pageSize: number } = { items: [], total: 0, page: 1, pageSize: 20 }
// The ic_simple answer: the Issues tab is this list with checkState=issue, so its rows carry the check facts.
const productsBody = (params: Record<string, unknown> = {}) => { const rows = params.checkState === 'issue' ? issues : products; return { items: rows, total: rows.length, page: 1, pageSize: 20, simple: true, branches, summary: { not_checked: 18, in_check: 1, ok: 0, issue: 1, total: 20 }, facets: { brands: ['Brand B'], categories: [] }, facetsLimited: { brands: false, categories: false } } }
const app = {
  user: { id: 7, username: 'alice', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...COUNT_FIELDS } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied', notify: () => {},
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
    readInventoryCheckList: async () => { throw Object.assign(new Error('Not found'), { status: 404, code: 'not_found' }) }, // ic_wired is off here: the older list is what this test is about
    readInventoryCheckProducts: async (params: Record<string, unknown>) => {
      productReads.push(params)
      if (productGate) await productGate
      return productsBody(params)
    },
    readInventoryCheckSessions: async (params: Record<string, unknown>) => { sessionReads.push(params); return { items: sessionList, total: sessionTotal || sessionList.length, page: Number(params.page) || 1, pageSize: 20, ...(sessionApprovals ? { approvals: true } : {}) } },
    readInventoryCheckSession: async () => ({ item: selected, items: members }),
    readInventoryCheckHistory: async () => {
      if (historyGate) await historyGate
      if (failHistory) throw new Error('history unavailable')
      return historyBody
    },
    createInventoryCheckSession: async (...args: unknown[]) => { creates.push(args); return { item: selected, receipt: {} } },
    submitInventoryCheckCounts: async (scope: unknown, input: { branchId: number; requestId: string; lines: Array<Record<string, unknown>> }) => { submissions.push({ scope, input }); return { item: { ...selected, id: 'submitted', status: 'closed' }, receipt: {}, created: true } },
    saveInventoryCheckObservation: async () => { throw new Error('not used') },
    changeInventoryCheckSession: async () => ({ item: selected, receipt: {} }),
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
type Surface = Awaited<ReturnType<typeof mount>>
const useLanguage = (language: string) => { app.language = language; app.t = (key: string) => packs[language][key] || key; return packs[language] }
const exact = (surface: Surface, text: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text)
const byLabel = (surface: Surface, label: string) => surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === label, `button ${label}`)
// The empty state's own button: a short ✕ + "Clear", told apart from the Filters menu's Clear link by where it sits.
const emptyClear = (surface: Surface, word: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === word && surface.findAll(box => box.getAttribute('data-inventory-check-empty') !== null && box.contains(node)).length === 1)
const sessionRow = (surface: Surface, id: string) => surface.find(node => node.getAttribute('data-inventory-check-session') === id, `session ${id}`)
const chooseFilter = async (surface: Surface, filtersLabel: string, section: string, option: string) => {
  if (!surface.findAll(node => node.getAttribute('data-filter-menu-section') !== null).length) await surface.click(byLabel(surface, filtersLabel))
  const header = surface.find(node => node.getAttribute('data-filter-menu-section') === section, `${section} section`)
  if (header.querySelectorAll('[role="option"]').length === 0 && !header.textContent.includes(option)) await surface.click(surface.button(/./, header))
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && header.contains(node) && node.textContent === option, `${option} in ${section}`))
}
const pinned = (surface: Surface) => surface.find(node => node.getAttribute('data-inventory-check-pinned') !== null, 'pinned controls')
const visibleText = (node: MemoryNode) => node.textContent.replace(/[\s ]+/g, ' ').trim()

try {
  for (const language of ['en', 'km']) {
    const pack = useLanguage(language)
    goTo('sessions')
    // AC-A2: two sessions a minute apart are told apart by date and time, branch, creator, counts and state.
    branches = [{ id: 1, name: 'Main' }]
    sessionList = [
      session('s-2', '2026-10-19 02:31:00', { status: 'closed', closed_at: '2026-10-19 10:00:00', progress: { total: 5, done: 4, issue: 1, unstarted: 0 }, creator_name: 'bob' }),
      session('s-1', '2026-10-19 02:30:00'),
    ]
    sessionTotal = 45
    const list = await mount()
    // Lane 6.0.933: the Sessions tab pins ONE row -- Filters, then the dates and presets; no Refresh (1 Nov) -- instead of a date row plus a row for one icon.
    const rangeRows = list.findAll(node => node.getAttribute('data-stats-range-controls') !== null)
    assert.equal(rangeRows.length, 1, `${language}: the Sessions tab has a single pinned row`)
    const rowButtons = rangeRows[0].querySelectorAll('button').map(node => node.getAttribute('aria-label'))
    assert.ok(rowButtons.indexOf(pack.filters) === 0 && !rowButtons.includes(pack.refresh), `${language}: Filters leads that row and there is no Refresh: ${rowButtons.join(' | ')}`)
    const first = visibleText(sessionRow(list, 's-1')), second = visibleText(sessionRow(list, 's-2'))
    assert.ok(first.includes('19/10/2026 09:30') && second.includes('19/10/2026 09:31'), `${language}: sessions a minute apart show different date and time (${first} | ${second})`)
    assert.notEqual(first, second)
    assert.ok(first.includes('Main') && first.includes('@alice') && second.includes('@bob'), `${language}: branch and creator are on the row`)
    assert.ok(first.includes(pack.open) && second.includes(pack.shift_status_closed), `${language}: state chip, translated`)
    assert.ok(second.includes('19/10/2026 17:00'), `${language}: a closed session shows when it closed`)
    assert.ok(!first.includes('Stored fixed title') && !second.includes('Stored fixed title'), `${language}: the stored fixed title is never the display name`)
    const counts = list.findAll(node => node.getAttribute('data-session-counts') !== null && sessionRow(list, 's-1').contains(node))[0]
    assert.deepEqual(counts.querySelectorAll('span').map(node => node.textContent), ['12', '2'], `${language}: done and issue; what is left is the ring's grey`)
    assert.deepEqual(counts.querySelectorAll('span').map(node => node.getAttribute('aria-label')), [`${pack.inventory_check_done}: 12`, `${pack.inventory_check_issue}: 2`], `${language}: each count names itself`)
    const ring = sessionRow(list, 's-1').querySelectorAll('[role="img"]')
    assert.deepEqual(ring.map(node => node.getAttribute('aria-label')), [`${pack.inventory_check_progress} 14/20`], `${language}: the ring says how many of the 20 are checked`)
    assert.deepEqual(ring[0].querySelectorAll('circle').map(node => node.getAttribute('data-ring-arc')), [null, 'done', 'issue'], `${language}: grey track, then the done arc, then the issue arc`)

    // Sessions filters: Open / Closed / Mine / dates go to the server and send the pager back to page 1.
    // Count sessions page like products (owner, 14 Nov): the controls sit above the list AND below it, one state, one request per step, the true total (45).
    const pagerAt = (position: 'top' | 'bottom') => list.find(node => node.getAttribute('data-inventory-check-pager') === position, `${position} pager`)
    assert.ok(pagerAt('top') !== pagerAt('bottom') && pagerAt('top').textContent.length > 0 && pagerAt('top').textContent === pagerAt('bottom').textContent, `${language}: the sessions list has the same pager above and below`)
    const readsBeforeStep = sessionReads.length
    await list.click(list.button(pack.next, pagerAt('top')))
    assert.equal(sessionReads.at(-1)?.page, 2, `${language}: paging from the TOP pager reaches page 2`)
    assert.equal(sessionReads.length, readsBeforeStep + 1, `${language}: one request per page step`)
    assert.equal(pagerAt('top').textContent, pagerAt('bottom').textContent, `${language}: both pagers moved together`)
    await chooseFilter(list, pack.filters, 'status', pack.shift_status_closed)
    assert.deepEqual([sessionReads.at(-1)?.status, sessionReads.at(-1)?.page], ['closed', 1], `${language}: Closed is a server filter and resets the page`)
    await list.click(list.button(pack.next))
    await chooseFilter(list, pack.filters, 'creator', pack.inventory_check_filter_creator_mine)
    assert.deepEqual([sessionReads.at(-1)?.status, sessionReads.at(-1)?.mine, sessionReads.at(-1)?.page], ['closed', 1, 1], `${language}: Mine joins the filters, keeps Closed and resets the page`)
    assert.equal(byLabel(list, pack.filters).getAttribute('title'), `${pack.filters} (2)`, `${language}: the trigger counts the two chosen filters`)
    await list.click(list.button(pack.next))
    const todayPreset = list.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-pressed') !== null && node.textContent.length > 1 && pinned(list).contains(node))[1]
    await list.click(todayPreset)
    const lastRead = sessionReads.at(-1)!
    assert.match(String(lastRead.startDate), /^\d{4}-\d{2}-\d{2}$/, `${language}: a date preset sends business days`)
    assert.equal(lastRead.page, 1, `${language}: a date change resets the page`)
    assert.equal(lastRead.createdFrom, undefined, `${language}: sessions filter on days, never on time bounds`)
    // The sessions date row is its own: it must not filter the Products tab.
    const productsBefore = productReads.length
    await list.click(list.button(pack.products))
    assert.ok(productReads.length > productsBefore && productReads.at(-1)?.startDate === undefined && productReads.at(-1)?.endDate === undefined, `${language}: the Products tab has no sales date range at all`)
    await list.unmount()

    // Queue-first review: a viewer who is shown approvals can narrow the list to counts waiting for one; nobody else is offered the choice.
    goTo('sessions')
    const readsBefore = sessionReads.length
    const plain = await mount()
    await plain.click(byLabel(plain, pack.filters))
    assert.deepEqual(plain.findAll(node => node.getAttribute('data-filter-menu-section') !== null).map(node => node.getAttribute('data-filter-menu-section')), ['status', 'creator'], `${language}: without approvals the menu has no approval section`)
    assert.ok(sessionReads.length > readsBefore && sessionReads.slice(readsBefore).every(read => read.approval === undefined), `${language}: and no read ever asks for it`)
    await plain.unmount()
    sessionApprovals = true
    goTo('sessions')
    const approvers = await mount()
    await approvers.click(byLabel(approvers, pack.filters))
    assert.deepEqual(approvers.findAll(node => node.getAttribute('data-filter-menu-section') !== null).map(node => node.getAttribute('data-filter-menu-section')), ['status', 'creator', 'approval'], `${language}: a viewer shown approvals gets the approval section`)
    await chooseFilter(approvers, pack.filters, 'approval', pack.inventory_check_approval_pending)
    assert.deepEqual([sessionReads.at(-1)?.approval, sessionReads.at(-1)?.page], ['pending', 1], `${language}: Waiting for approval is a server filter and resets the page`)
    assert.equal(byLabel(approvers, pack.filters).getAttribute('title'), `${pack.filters} (1)`, `${language}: the trigger counts it`)
    const readsWithFilter = sessionReads.length
    await chooseFilter(approvers, pack.filters, 'status', pack.shift_status_closed)
    assert.deepEqual([sessionReads.at(-1)?.approval, sessionReads.at(-1)?.status], ['pending', 'closed'], `${language}: it joins the other filters`)
    assert.equal(sessionReads.length, readsWithFilter + 1, `${language}: one read per change, none repeated because the answer says approvals`)
    await chooseFilter(approvers, pack.filters, 'approval', pack.all)
    assert.equal(sessionReads.at(-1)?.approval, undefined, `${language}: All lifts the approval filter`)
    await chooseFilter(approvers, pack.filters, 'status', pack.all)
    const kept = [sessionList, sessionTotal] as const
    sessionList = []; sessionTotal = 0
    await chooseFilter(approvers, pack.filters, 'approval', pack.inventory_check_approval_pending)
    assert.ok(approvers.text().includes(pack.inventory_check_sessions_no_match) && emptyClear(approvers, pack.clear).length === 1, `${language}: with only Waiting for approval chosen, nothing waiting is told as a filtered-away list, with ✕ Clear`)
    await approvers.click(emptyClear(approvers, pack.clear)[0])
    assert.deepEqual([sessionReads.at(-1)?.approval, sessionReads.at(-1)?.status], [undefined, undefined], `${language}: Clear lifts the approval filter with the others`)
    await approvers.unmount()
    sessionApprovals = false
    ;[sessionList, sessionTotal] = kept

    // Empty states carry the right action per tab.
    goTo('sessions')
    sessionList = []; sessionTotal = 0
    const none = await mount()
    assert.ok(none.text().includes(pack.inventory_check_sessions_empty), `${language}: no sessions yet`)
    await none.click(exact(none, pack.inventory_check_start_page)[0])
    assert.equal(none.button(pack.products).getAttribute('aria-pressed'), 'true', `${language}: the Sessions empty state's Count action leads to Products`)
    await none.unmount()
    goTo('sessions')
    const filteredNone = await mount()
    await chooseFilter(filteredNone, pack.filters, 'status', pack.shift_status_closed)
    assert.ok(filteredNone.text().includes(pack.inventory_check_sessions_no_match) && emptyClear(filteredNone, pack.clear).length === 1, `${language}: filtered-away sessions offer ✕ Clear`)
    await filteredNone.click(emptyClear(filteredNone, pack.clear)[0])
    assert.equal(sessionReads.at(-1)?.status, undefined, `${language}: Clear clears the session filters`)
    await filteredNone.unmount()
    goTo('products')
    products = []
    const noProducts = await mount()
    await chooseFilter(noProducts, pack.filters, 'brand', 'Brand B')
    assert.ok(noProducts.text().includes(pack.inventory_check_empty) && emptyClear(noProducts, pack.clear).length === 1, `${language}: filtered-away products offer ✕ Clear`)
    await noProducts.click(emptyClear(noProducts, pack.clear)[0])
    assert.equal(productReads.at(-1)?.brand, '', `${language}: Clear resets the chosen brand`)
    await noProducts.unmount()
    goTo('issues')
    const noIssues = await mount()
    assert.ok(noIssues.text().includes(pack.inventory_check_issues_empty), `${language}: no issues`)
    await noIssues.unmount()
    products = [product(12, 'Row twelve', { barcode: '885000111', brand: 'Brand B' }), product(13, 'Row thirteen')]

    // Issues: the product row, the session chip and the reason.
    issues = [{ ...product(12, 'Row twelve', { barcode: '885000111', brand: 'Brand B' }), check_status: 'issue', check_counted_quantity: 8, check_note: 'Shelf short', check_by: 'alice', check_at: '2026-10-19 02:35:00', check_session_id: 's-1', check_branch_id: 1 }]
    goTo('issues')
    const issueTab = await mount()
    const issueRow = issueTab.find(node => node.getAttribute('data-inventory-check-row') === '12', 'issue row')
    assert.ok(issueRow.textContent.includes('Row twelve') && issueRow.textContent.includes('Shelf short') && issueRow.textContent.includes(`${pack.inventory_check_counted} 8`), `${language}: issue row shows the product, its reason and its count`)
    const chip = issueTab.button(pack.inventory_check_open_session, issueRow)
    assert.ok(chip.textContent.includes('Main') && chip.getAttribute('aria-label')?.includes(pack.inventory_check_open_session), `${language}: a session chip names the branch and opens the session`)
    assert.equal(issueTab.findAll(node => node.getAttribute('data-check-action') === 'done' || node.getAttribute('data-check-action') === 'issue').length, 0, `${language}: Issues rows write nothing into a session; they are the list's rows, counted by Submit`)
    assert.ok(!issueTab.text().includes(pack.inventory_check_state), `${language}: the Issues tab has no Check status choice`)
    await issueTab.click(chip)
    assert.equal(productReads.at(-1)?.sessionId, 's-1', `${language}: the chip opens its session`)
    assert.equal(productReads.some(read => read.checkState === 'issue' && read.state === undefined), true, `${language}: the Issues tab asks with checkState=issue`)
    await issueTab.unmount()
    issues = []
  }

  // First-load skeleton, then rows; the load error keeps filters.
  {
    const pack = useLanguage('en')
    goTo('products')
    productGate = new Promise<void>(resolve => { releaseProducts = resolve })
    const loading = await mount()
    assert.equal(loading.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 1, 'first load shows skeleton rows')
    assert.ok(loading.find(node => node.getAttribute('role') === 'status', 'loading status').textContent === pack.loading, 'the skeleton announces loading')
    assert.equal(loading.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length, 0)
    productGate = null
    releaseProducts()
    await loading.settle()
    assert.equal(loading.findAll(node => node.getAttribute('data-inventory-check-skeleton') !== null).length, 0, 'the skeleton leaves with the rows')
    assert.equal(loading.findAll(node => node.getAttribute('data-inventory-check-row') !== null).length, 2)
    await loading.unmount()
  }

  // Submit: a review first, and a Submit that is not ready says why. (There is no Count (n) button: the rows count themselves.)
  for (const language of ['en', 'km']) {
    const pack = useLanguage(language)
    goTo('products')
    branches = [{ id: 1, name: 'Main' }, { id: 2, name: 'Second' }]
    submissions.length = 0
    const counting = await mount()
    const rowOf = (id: number) => counting.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
    const countOf = (id: number) => counting.find(node => node.getAttribute('data-check-count') !== null && rowOf(id).contains(node), `count of ${id}`)
    const submitButton = () => counting.find(node => node.getAttribute('data-selection-action') === 'submit', 'Submit')
    // No select-all and no check box (14 Nov): a row is picked by answering it. "Does not match" in the status popover picks it and waits for its count.
    const pickAll = async () => { for (const id of [12, 13]) {
      await counting.click(counting.find(node => node.getAttribute('data-check-action') === 'status' && rowOf(id).contains(node), `status of ${id}`))
      await counting.click(counting.find(node => node.getAttribute('data-popover-action') === 'differs', 'does not match'))
      await counting.click(counting.find(node => node.getAttribute('data-popover-action') === 'close', 'close'))
    } }
    assert.equal(counting.findAll(node => node.tagName === 'BUTTON' && (node.getAttribute('aria-label') ?? '').startsWith(`${pack.inventory_check_start_page} (`)).length, 0, `${language}: no Count (n) button on the list`)
    assert.equal(counting.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === pack.refresh).length, 0, `${language}: and no Refresh button`)
    await pickAll()
    assert.equal(submitButton().getAttribute('aria-disabled'), 'true', `${language}: Submit waits for a branch`)
    assert.equal(submitButton().getAttribute('title'), pack.inventory_check_count_blocked_branch, `${language}: and its tooltip says why`)
    const before = counting.findAll(node => node.tagName === 'DL').length
    await counting.click(submitButton())
    assert.equal(counting.findAll(node => node.tagName === 'DL').length, before, `${language}: a blocked Submit does nothing`)
    await chooseFilter(counting, pack.filters, 'branchId', 'Second')
    assert.ok(counting.text().includes(pack.inventory_check_discard_counts_title), `${language}: choosing another branch with picks asks before starting over`)
    await counting.click(exact(counting, pack.discard).at(-1)!)
    assert.equal(counting.find(node => node.getAttribute('data-selected-count') !== null, 'selected count').textContent, '', `${language}: a counted stock belongs to one branch, so confirming starts the picks over`)
    await pickAll()
    assert.equal(submitButton().getAttribute('title'), pack.inventory_check_submit_need_counts, `${language}: then it asks for a count in every picked row`)
    await counting.type(countOf(12), '10')
    await counting.type(countOf(13), '7')
    assert.equal(submitButton().getAttribute('aria-disabled'), null, `${language}: Submit is live once every picked row has a count`)
    assert.equal(submitButton().getAttribute('title'), pack.inventory_check_submit)
    await counting.click(submitButton())
    const review = counting.find(node => node.tagName === 'DL', 'submit review').textContent
    assert.ok(review.includes(pack.products) && review.includes('2') && review.includes('Second') && review.includes(pack.inventory_check_differences + '1'), `${language}: the review shows 2 products, the branch and how many differ: ${review}`)
    assert.equal(submissions.length, 0, `${language}: nothing is sent before Confirm`)
    await counting.click(exact(counting, pack.inventory_check_submit).at(-1)!)
    assert.equal(submissions.at(-1)?.input.lines.length, 2, `${language}: Confirm sends exactly the reviewed products`)
    assert.equal(submissions.at(-1)?.input.branchId, 2)
    assert.equal(creates.length, 0, `${language}: no session is created from the list`)
    await counting.unmount()
    branches = [{ id: 1, name: 'Main' }]
  }

  // The session bar, the history float, and the icon-only button policy.
  for (const language of ['en', 'km']) {
    const pack = useLanguage(language)
    goTo('products')
    members = [{ product_id: 12, state: 'issue', revision: 1, counted_quantity: 8, reason: 'Shelf short', baseline_quantity: 12, current_quantity: 10, stock_changed: true, product_snapshot: products[0] }]
    selected = session('s-1', '2026-10-19 02:30:00')
    sessionList = [selected]; sessionTotal = 0
    const bar = await mount()
    await bar.click(bar.button(pack.inventory_check_sessions))
    await bar.click(bar.button(/./, sessionRow(bar, 's-1')))
    const barText = visibleText(bar.find(node => node.getAttribute('data-inventory-check-session-bar') !== null, 'session bar'))
    assert.ok(barText.startsWith('14/20') && barText.includes('19/10/2026 09:30 · Main · @alice'), `${language}: the bar reads the ring, then date, branch and creator: ${barText}`)
    assert.ok(!barText.includes(pack.open) && !barText.includes(pack.shift_status_closed), `${language}: an open session carries no status chip`)
    assert.equal(bar.findAll(node => node.getAttribute('role') === 'img' && node.getAttribute('aria-label') === pack.view_only).length, 0, `${language}: an editable session has no read-only marker`)
    const actions = bar.find(node => node.getAttribute('data-inventory-check-actions') !== null, 'action row')
    const barButtons = bar.findAll(node => node.tagName === 'BUTTON' && actions.contains(node))
    assert.deepEqual(barButtons.map(node => node.getAttribute('aria-label')), [pack.inventory_check_leave_session, pack.inventory_check_session_details, pack.history, pack.inventory_check_close_session], `${language}: back, the session-details hint, History and Close, in that order; no Refresh`)
    for (const button of barButtons) assert.ok(button.textContent === '' && (button.getAttribute('title') === button.getAttribute('aria-label') || button.getAttribute('aria-label') === pack.inventory_check_session_details), `${language}: ${button.getAttribute('aria-label')} is icon-only with a matching tooltip (the hint opens its own panel)`)
    // Every pinned control is an icon with a translated name -- except the date chips and the Sort select, whose words are their value.
    for (const button of bar.findAll(node => node.tagName === 'BUTTON' && pinned(bar).contains(node))) {
      if (button.closest('[data-date-presets]') || button.getAttribute('aria-label') === pack.date_time_range || button.textContent === pack.stats) continue
      assert.ok(button.textContent === '' && (button.getAttribute('aria-label') || '').length > 0 && (button.getAttribute('title') || button.getAttribute('aria-label')), `${language}: pinned button ${button.getAttribute('aria-label')} is icon-only`)
    }

    // History opens with its shape on screen, then fills; a failure keeps a Retry.
    historyGate = new Promise<void>(resolve => { releaseHistory = resolve })
    historyBody = { items: [{ id: 1, session_id: 's-1', product_id: 12, product_name: 'Row twelve', actor_id: 7, actor_name: 'alice', action: 'observe', created_at: '2026-10-19 02:35:00', before: { state: 'unstarted' }, after: { state: 'issue', reason: 'Shelf short' } }, { id: 2, session_id: 's-1', product_id: null, product_name: null, actor_id: 7, actor_name: 'alice', action: 'resume', created_at: '2026-10-19 02:40:00', before: { status: 'closed' }, after: { status: 'open' } }, { id: 3, session_id: 's-1', product_id: null, product_name: null, actor_id: 7, action: 'future_action', created_at: '2026-10-19 02:41:00', before: null, after: null }], total: 3, page: 1, pageSize: 20 }
    await bar.click(byLabel(bar, pack.history))
    assert.equal(bar.findAll(node => node.getAttribute('data-inventory-check-history-skeleton') !== null).length, 1, `${language}: the history float opens with skeleton rows, not a bare Loading line`)
    historyGate = null
    releaseHistory()
    await bar.settle()
    const rows = bar.findAll(node => node.getAttribute('data-inventory-check-history') !== null).map(node => visibleText(node))
    assert.equal(rows[0], `19/10/2026 09:35 · @alice · Row twelve · ${pack.inventory_check_unstarted} → ${pack.inventory_check_issue} · Shelf short`, `${language}: date · user · product · state change · reason`)
    assert.equal(rows[1], `19/10/2026 09:40 · @alice · ${pack.inventory_check_history_action_resume}`, `${language}: a session-level action is translated`)
    assert.equal(rows[2], `19/10/2026 09:41 · ${pack.inventory_check_history_action_other}`, `${language}: an unknown action never shows its code, and no name shows without permission`)
    await bar.click(byLabel(bar, pack.close))
    failHistory = true
    historyBody = { items: [], total: 0, page: 1, pageSize: 20 }
    await bar.click(byLabel(bar, pack.history))
    assert.ok(bar.text().includes(pack.inventory_check_load_failed), `${language}: history load failure is announced`)
    failHistory = false
    const historyRetry = bar.button(pack.retry, bar.find(node => node.getAttribute('role') === 'alert' && node.textContent.includes(pack.inventory_check_load_failed) && node.querySelector('button') !== null, 'history alert'))
    assert.ok(historyRetry.textContent === '' && historyRetry.getAttribute('aria-label') === pack.retry && historyRetry.getAttribute('title') === pack.retry, `${language}: the History Retry is icon-only with a translated tooltip`)
    await bar.click(historyRetry)
    assert.ok(bar.text().includes(pack.inventory_check_history_empty), `${language}: Retry re-reads the history`)
    await bar.click(byLabel(bar, pack.close))

    // Read-only: another person's session explains itself; Close and the editors are absent.
    app.user = { ...app.user, id: 8 }
    selected = session('s-1', '2026-10-19 02:30:00', { can_edit: false, status: 'closed', closed_at: '2026-10-19 10:00:00' })
    sessionList = [selected]
    await bar.unmount()
    const readOnly = await mount()
    await readOnly.click(readOnly.button(pack.inventory_check_sessions))
    await readOnly.click(readOnly.button(/./, sessionRow(readOnly, 's-1')))
    const roBar = visibleText(readOnly.find(node => node.getAttribute('data-inventory-check-session-bar') !== null, 'session bar'))
    assert.ok(roBar.includes(pack.shift_status_closed), `${language}: a closed session shows its Closed chip: ${roBar}`)
    assert.equal(readOnly.findAll(node => node.getAttribute('role') === 'img' && node.getAttribute('aria-label') === pack.view_only && node.getAttribute('title') === pack.view_only).length, 1, `${language}: a session the viewer cannot change shows an eye with a translated name`)
    await readOnly.click(readOnly.button(pack.inventory_check_read_only_hint))
    assert.ok(readOnly.text().includes(pack.inventory_check_read_only_hint), `${language}: the read-only eye explains itself in an InfoHint`)
    assert.equal(readOnly.findAll(node => node.tagName === 'BUTTON' && [pack.inventory_check_close_session, pack.inventory_check_resume_session].includes(node.getAttribute('aria-label') || '')).length, 0, `${language}: no Close or Resume for a viewer who cannot edit`)
    assert.equal(readOnly.findAll(node => node.getAttribute('data-check-action') !== null).length, 0)
    await readOnly.unmount()
    app.user = { ...app.user, id: 7 }
    selected = session('s-1', '2026-10-19 02:30:00')
  }

  // The server's can_edit can only narrow: the creator of a session the server says they cannot change gets no editors.
  {
    const pack = useLanguage('en')
    goTo('sessions')
    selected = session('s-1', '2026-10-19 02:30:00', { can_edit: false })
    sessionList = [selected]
    const narrowed = await mount()
    await narrowed.click(narrowed.button(/./, sessionRow(narrowed, 's-1')))
    assert.equal(narrowed.findAll(node => node.getAttribute('role') === 'img' && node.getAttribute('aria-label') === pack.view_only).length, 1, 'the server verdict shows as a read-only eye')
    assert.equal(narrowed.findAll(node => node.getAttribute('data-check-action') !== null).length, 0, 'and no editor even for the creator')
    assert.equal(narrowed.findAll(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === pack.inventory_check_close_session).length, 0)
    await narrowed.unmount()
    selected = session('s-1', '2026-10-19 02:30:00')
  }

  // The pinned order: dates, then search / scan / Filters, then the context bar (branch, Count); sort and chosen filters live only in the Filters menu.
  {
    const pack = useLanguage('en')
    goTo('products')
    const order = await mount()
    const root = pinned(order)
    const walk = (node: MemoryNode): MemoryNode[] => node.childNodes.flatMap(child => child.nodeType === 1 ? [child, ...walk(child)] : [])
    const position = (needle: (node: MemoryNode) => boolean) => walk(root).findIndex(needle)
    const stats = position(node => node.tagName === 'BUTTON' && node.textContent === pack.stats)
    const search = position(node => node.getAttribute('id') === 'inventory-check-search')
    const scan = position(node => node.getAttribute('aria-label') === pack.scan_barcode)
    const filtersAt = position(node => node.getAttribute('aria-label') === pack.filters)
    const context = position(node => node.getAttribute('data-inventory-check-context') !== null)
    assert.ok(stats >= 0 && stats < search && search < scan && scan < filtersAt && filtersAt < context, `stats ${stats} < search ${search} < scan ${scan} < filters ${filtersAt} < context ${context}`)
    assert.equal(order.findAll(node => node.getAttribute('data-stats-range-controls') !== null).length, 0, 'the Products tab has no date row: the sales range is gone')
    assert.equal(order.findAll(node => node.getAttribute('aria-label') === pack.sort_by || node.getAttribute('data-inventory-check-filters') !== null).length, 0, 'there is no Sort row any more: Sort is a section of the Filters menu')
    const contextBar = order.find(node => node.getAttribute('data-inventory-check-context') !== null, 'context bar')
    assert.ok(contextBar.querySelector('[data-sole-branch]')?.textContent?.includes('Main'), 'the one active branch is shown as a label, not a picker, in the context bar')
    assert.ok(!walk(order.find(node => node.getAttribute('data-inventory-check-controls') !== null, 'search row')).some(node => node.getAttribute('data-sole-branch') !== null), 'and not in the search row')
    assert.ok(!order.text().includes(pack.all_branches), 'no Branch choice for a sole branch')
    await chooseFilter(order, pack.filters, 'brand', 'Brand B')
    assert.equal(byLabel(order, pack.filters).getAttribute('title'), `${pack.filters} (1)`, 'the trigger carries the count')
    assert.ok(!contextBar.textContent.includes('Brand B'), 'the chosen brand shows nowhere outside the menu')
    // A scan only fills Search.
    assert.ok(order.find(node => node.getAttribute('data-sole-branch') !== null, 'branch label'))
    await order.unmount()
  }
  console.log('PASS inventoryChecksSurfaces: sessions list, filters, Submit review, session bar, history float, states and icon-only buttons in EN and KM')
} finally { await harness.close() }
