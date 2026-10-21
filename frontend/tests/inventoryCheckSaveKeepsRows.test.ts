import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'
import type { InventoryCheckSession, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'

// Board A-R1 / A-R8 / A-M9: saving one row keeps the list mounted, Done never carries a stale count,
// and each definite server refusal gets its own message while the operator's draft survives.

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
applyLocation('https://admin.example.test/inventory#hub:inventory:products')

const products = [
  { id: 12, name: 'Row twelve', quantity: 8, qty_sold: 4 },
  { id: 13, name: 'Row thirteen', quantity: 5, qty_sold: 1 },
]
const session: InventoryCheckSession = { id: 'check-1', branch_id: 1, created_by: 7, title: 'Test check', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19', updated_at: '2026-10-19', progress: { total: 2, done: 0, issue: 1, unstarted: 1 } }
const members = new Map<number, InventoryCheckSessionItem>([
  [12, { product_id: 12, state: 'issue', revision: 2, counted_quantity: 3, reason: 'Shelf short', baseline_quantity: 8, current_quantity: 8, stock_changed: false, product_snapshot: products[0] }],
  [13, { product_id: 13, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 5, current_quantity: 5, stock_changed: false, product_snapshot: products[1] }],
])
const saves: unknown[][] = []
const productReads: unknown[] = []
let sessionReads = 0
let holdReload = null as ((value: unknown) => void) | null
let holdReloadNext = false
let holdSave: Promise<void> | null = null
let saveRefusal: string | null = null
let createRefusal: string | null = null
let lifecycleRefusal: string | null = null
const refuse = (code: string) => Object.assign(new Error('refused'), { code, status: 409 })
const productsBody = () => ({ items: products, total: 2, page: 1, pageSize: 20, branches: [{ id: 1, name: 'Branch' }], stats: { total_products: 2, stock_quantity: 13 }, rankings: { products: [] }, issues: [] })
const app = {
  user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true } as Record<string, boolean> },
  page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
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
    readInventoryCheckProducts: async (params: unknown) => {
      productReads.push(params)
      if (holdReloadNext) { holdReloadNext = false; return new Promise(resolve => { holdReload = resolve }) }
      return productsBody()
    },
    readInventoryCheckSessions: async () => ({ items: [session], total: 1, page: 1, pageSize: 20 }),
    readInventoryCheckSession: async () => { sessionReads += 1; return { item: session, items: [...members.values()] } },
    readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    createInventoryCheckSession: async () => { if (createRefusal) throw refuse(createRefusal); return { item: session, receipt: {} } },
    saveInventoryCheckObservation: async (...args: unknown[]) => {
      saves.push(args)
      if (holdSave) await holdSave
      if (saveRefusal) throw refuse(saveRefusal)
      const id = args[1] as number
      const patch = args[2] as Partial<InventoryCheckSessionItem>
      const next = { ...members.get(id)!, ...patch, revision: members.get(id)!.revision + 1 } as InventoryCheckSessionItem
      members.set(id, next)
      return { item: next, session, receipt: {} }
    },
    changeInventoryCheckSession: async () => { if (lifecycleRefusal) throw refuse(lifecycleRefusal); return { item: session, receipt: {} } },
  },
}
const mount = () => harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
type Surface = Awaited<ReturnType<typeof mount>>
const rowOf = (surface: Surface, id: number) => surface.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
const action = (surface: Surface, id: number, which: 'done' | 'issue') => surface.find(node => node.getAttribute('data-check-action') === which && rowOf(surface, id).contains(node), `${which} on ${id}`)
const status = (surface: Surface, id: number) => surface.find(node => node.getAttribute('data-check-status') === String(id), `status ${id}`).textContent
// The Sessions tab names a session by its start and branch, so the row is found by its id, never by a stored title.
const openSessionRow = async (surface: Surface, tab = 'sessions') => {
  await surface.click(surface.button(tab))
  await surface.click(surface.button(/./, surface.find(node => node.getAttribute('data-inventory-check-session') === 'check-1', 'session row')))
}
const openSession = (surface: Surface) => openSessionRow(surface)
// Buttons by exact visible text: 'Count' is also a prefix of the 'Count sessions' chip. The page's own Count button carries a pill with how many products it counts, so it is found by its "Count (n)" name.
const exactButtons = (surface: Surface, text: string) => surface.findAll(node => node.tagName === 'BUTTON' && node.textContent === text)
const countButton = (surface: Surface, text: string) => surface.find(node => node.tagName === 'BUTTON' && (node.getAttribute('aria-label') ?? '').startsWith(`${text} (`), 'page Count button')
const confirmInDialog = async (surface: Surface, text: string) => { await surface.click(exactButtons(surface, text).at(-1)!) }
const attached = (node: MemoryNode) => { let at: MemoryNode | null = node; while (at && at !== at.ownerDocument.body) at = at.parentNode; return at !== null }

try {
  // A-R1 + A-R8: a tick save keeps the rows mounted; Issue -> Done sends no count.
  const surface = await mount()
  await openSession(surface)
  // Lane 6.0.933: under a Check status filter the saved row still stays where it is -- a tick reads neither the products nor the session again.
  await surface.click(surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'filters', 'Filters trigger'))
  const stateSection = surface.find(node => node.getAttribute('data-filter-menu-section') === 'state', 'Check status section')
  if (!stateSection.querySelectorAll('[role="option"]').length) await surface.click(surface.button(/./, stateSection))
  await surface.click(surface.find(node => node.getAttribute('role') === 'option' && stateSection.contains(node) && node.textContent === 'issues', 'Issues option'))
  const root = surface.find(node => node.getAttribute('data-inventory-check-page') !== null, 'page root') as MemoryNode & { scrollTop?: number }
  const row12 = rowOf(surface, 12), row13 = rowOf(surface, 13)
  const tick13 = action(surface, 13, 'done')
  root.scrollTop = 321
  tick13.focus()
  assert.equal(status(surface, 13), 'Not started')
  const readsBefore = productReads.length, sessionReadsBefore = sessionReads, savesBefore = saves.length
  let releaseSave!: () => void
  holdSave = new Promise<void>(resolve => { releaseSave = resolve })
  await surface.click(tick13)
  assert.ok(rowOf(surface, 13).textContent.includes('Saving'), 'the row being saved says so')
  assert.ok(!rowOf(surface, 12).textContent.includes('Saving'), 'other rows never claim to be saving')
  assert.equal(propsOf(action(surface, 12, 'done')).disabled, true, 'the single in-flight write keeps other actions from racing it')
  holdSave = null
  releaseSave()
  await surface.settle()
  assert.deepEqual(saves.at(-1)?.slice(1, 3), [13, { state: 'done', counted_quantity: null, reason: null }])
  // Lane 6.0.894: the PATCH answer carries the saved item and session, so a count save is ONE request (it was PATCH + products + session).
  assert.equal(productReads.length, readsBefore, 'a saved count does not refetch products')
  assert.equal(sessionReads, sessionReadsBefore, 'a saved count does not refetch the session')
  assert.equal(saves.length, savesBefore + 1, 'exactly one PATCH')
  assert.equal(rowOf(surface, 12), row12, 'unsaved row keeps its DOM node after the save')
  assert.equal(rowOf(surface, 13), row13, 'saved row keeps its DOM node after the save')
  assert.equal(action(surface, 13, 'done'), tick13, 'the tick button is the same node')
  assert.equal(tick13.ownerDocument.activeElement, tick13, 'focus stays on the tick that was pressed')
  assert.ok(attached(tick13), 'the focused tick is still attached')
  assert.equal(surface.find(node => node.getAttribute('data-inventory-check-page') !== null, 'page root'), root)
  assert.equal(root.scrollTop, 321, 'scroll position is untouched')
  assert.equal(status(surface, 13), 'Done', 'only the saved row changes, from the authoritative response')
  assert.equal(status(surface, 12), 'Issue', 'the other row keeps its state')
  assert.equal(propsOf(action(surface, 12, 'done')).disabled, false, 'other rows stay enabled during the reload')
  assert.equal(propsOf(action(surface, 13, 'done')).disabled, false)
  assert.ok(!surface.findAll(node => node.getAttribute('role') === 'status').some(node => node.textContent.includes('loading')), 'no loading line is inserted above the rows')
  // The explicit Refresh button still reloads both reads; the held reload proves rows stay mounted through it.
  holdReloadNext = true
  await surface.click(surface.button('refresh'))
  assert.ok(holdReload, 'the Refresh reload is in flight')
  assert.equal(rowOf(surface, 12), row12, 'rows survive the Refresh reload')
  assert.equal(rowOf(surface, 13), row13)
  holdReload!(productsBody())
  await surface.settle()
  assert.equal(productReads.length, readsBefore + 1, 'Refresh reads products once')
  assert.equal(sessionReads, sessionReadsBefore + 1, 'Refresh reads the session once')

  // A definite 409 means the page is behind the server: one reload of both reads. A permission refusal is not staleness.
  const beforeConflict = [productReads.length, sessionReads]
  saveRefusal = 'inventory_check_baseline_changed'
  await surface.click(surface.button('Mark done', rowOf(surface, 12)))
  await surface.settle()
  assert.deepEqual([productReads.length, sessionReads], [beforeConflict[0] + 1, beforeConflict[1] + 1], 'a 409 conflict reloads products and the session once')
  saveRefusal = 'inventory_check_owner_required'
  await surface.click(surface.button('Mark done', rowOf(surface, 12)))
  await surface.settle()
  assert.deepEqual([productReads.length, sessionReads], [beforeConflict[0] + 1, beforeConflict[1] + 1], 'an owner refusal does not reload')
  saveRefusal = null

  // A-R8: Issue -> Done must not resend the old counted quantity (3 differs from stock 8).
  await surface.click(surface.button('Mark done', rowOf(surface, 12)))
  assert.deepEqual(saves.at(-1)?.slice(1, 3), [12, { state: 'done', counted_quantity: null, reason: null }], 'Done after Issue carries no count')
  assert.equal(status(surface, 12), 'Done')
  await surface.unmount()

  // A-M9: each definite refusal has its own message in both packs; the draft stays and a corrected save is a fresh request.
  members.set(13, { ...members.get(13)!, state: 'unstarted', counted_quantity: null, reason: null })
  for (const language of ['en', 'km']) {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
    app.language = language
    app.t = (key: string) => pack[key] || key
    for (const code of ['inventory_check_count_requires_issue', 'inventory_check_baseline_changed', 'inventory_check_owner_required', 'inventory_check_product_not_eligible']) {
      const message = pack[code.replace('inventory_check_', 'inventory_check_error_')]
      assert.ok(message, `${language}: ${code} has a message`)
      const page = await mount()
      await openSessionRow(page, pack.inventory_check_sessions)
      await page.click(page.button(pack.inventory_check_report_issue, rowOf(page, 13)))
      await page.type(page.field('inventory-check-count-13'), '2')
      await page.type(page.field('inventory-check-reason-13'), 'Draft survives')
      saveRefusal = code
      await page.click(page.button(pack.inventory_check_save_issue, rowOf(page, 13)))
      const text = rowOf(page, 13).textContent
      assert.ok(text.includes(message), `${language}: ${code} shows its own message`)
      assert.ok(!text.includes(pack.inventory_check_save_failed), `${language}: ${code} is not the generic failure`)
      assert.equal((page.field('inventory-check-reason-13') as unknown as { value: string }).value, 'Draft survives', `${language}: draft reason kept`)
      assert.equal((page.field('inventory-check-count-13') as unknown as { value: string }).value, '2', `${language}: draft count kept`)
      const failed = saves.at(-1)!
      saveRefusal = null
      await page.click(page.button(pack.inventory_check_retry, rowOf(page, 13)))
      assert.notEqual(saves.at(-1)![5], failed[5], `${language}: a definite refusal is not replayed under its old request id`)
      assert.equal(saves.at(-1)![1], 13)
      members.set(13, { ...members.get(13)!, state: 'unstarted', counted_quantity: null, reason: null })
      await page.unmount()
    }
    // Create and Close/Resume surfaces map the same codes.
    const page = await mount()
    createRefusal = 'inventory_check_product_not_eligible'
    await page.click(countButton(page, pack.inventory_check_start_page))
    assert.ok(page.text().includes(pack.inventory_check_count_review_title), `${language}: Count opens a review before anything is created`)
    await confirmInDialog(page, pack.inventory_check_start_page)
    assert.ok(page.text().includes(pack.inventory_check_error_product_not_eligible), `${language}: create refusal message`)
    createRefusal = null
    await page.unmount()
    const lifecycle = await mount()
    await openSessionRow(lifecycle, pack.inventory_check_sessions)
    lifecycleRefusal = 'inventory_check_owner_required'
    await lifecycle.click(lifecycle.button(pack.inventory_check_close_session))
    await confirmInDialog(lifecycle, pack.inventory_check_close_session)
    assert.ok(lifecycle.text().includes(pack.inventory_check_error_owner_required), `${language}: close refusal message`)
    lifecycleRefusal = null
    await lifecycle.unmount()
  }
  console.log('PASS inventory check save keeps rows mounted, Done carries no count, refusals have specific messages')
} finally { await harness.close() }
