import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'

// Leave session must not ungroup the list. A count session's answer advertises no groupings (routes/inventoryCheckProducts.ts leaves them out
// of a session's list), and the page used to take that silence as "this server cannot group", so the first list read after Leave session
// sent no groupBy and drew no headers. Only a list answer may update what the tab has learned about groupings.
const COUNT_FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
const applyLocation = (url: string) => { const next = new URL(url, 'https://admin.example.test/'); Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) }
// The harness installs the window; every harness (the mutant gets its own) needs the same event and history stand-ins.
function installWindow() {
  listeners.clear()
  window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
  window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
  window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
  window.history.pushState = (_s, _u, url) => { applyLocation(String(url)) }
  window.history.replaceState = (_s, _u, url) => { applyLocation(String(url)) }
  applyLocation('https://admin.example.test/inventory#hub:inventory:products')
}

const row = (id: number, group_key: string) => ({ id, name: `Product ${id}`, quantity: 5, unit: 'pcs', barcode: `BC100${id}`, check_status: 'not_checked', group_key })
const items = [row(1, 'd:2026-11-12'), row(2, 'never')]
const byDate = { by: 'checked', unit: 'family', groups: [
  { key: 'd:2026-11-12', label: null, families: 1, products: 1, continued_before: false, continues_after: false },
  { key: 'never', label: null, families: 1, products: 1, continued_before: false, continues_after: false }] }
const session = { id: 'check-1', branch_id: 1, created_by: 7, title: 'T', status: 'open', revision: 1, scope: {}, started_at: '2026-10-19 02:30:00', updated_at: '2026-10-19 02:30:00', progress: { total: 1, done: 0, issue: 0, unstarted: 1 }, branch_name: 'Test branch', creator_name: 'alice' }

// advertiseInSession: true is the control (a session answer that names the groupings); false is the real server.
async function leaveSession(advertiseInSession: boolean, mutateSource?: (key: string, code: string) => string) {
  const requests: Array<Record<string, unknown>> = []
  const answer = (p: Record<string, unknown>) => {
    const inSession = typeof p.sessionId === 'string' && p.sessionId !== ''
    const grouped = !inSession && p.groupBy === 'checked'
    return { items: inSession ? [{ ...items[0], group_key: undefined }] : items, total: 2, page: 1, pageSize: 20, totalPages: 1, simple: true, branches: [{ id: 1, name: 'Test branch' }, { id: 2, name: 'Second branch' }],
      ...(p.summary === 0 ? {} : { summary: { not_checked: 2, in_check: 0, ok: 0, issue: 0, total: 2 }, facets: { brands: [], categories: [] } }),
      ...(inSession && !advertiseInSession ? {} : { capabilities: { groupings: ['checked', 'category'] } }), ...(grouped ? { grouping: byDate } : {}) }
  }
  const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'], mutateSource })
  installWindow()
  const app = {
    user: { id: 7, role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...COUNT_FIELDS } as Record<string, boolean> },
    page: 'inventory', authReady: true, canWriteToServer: true, t: (key: string) => key, notify: () => {}, settings: { navigation_mode: 'sections' }, language: 'en', AccessDenied: () => 'Access denied',
    navigateTo: (page: string, anchor?: string) => { window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } })) },
  }
  const doubles = {
    'utils/dirtyWork.ts': dirtyWork,
    'api/actorReadScope.ts': { captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }), captureActorWriteIdentity: () => ({ owner: 'test', epoch: 1 }), isActorReadScopeCurrent: () => true, isActorWriteIdentityCurrent: () => true },
    'api/inventoryChecksTransport.ts': {
      captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
      readInventoryCheckList: async () => { throw Object.assign(new Error('Not found'), { status: 404, code: 'not_found' }) },
      readInventoryCheckProducts: async (p: Record<string, unknown>) => { requests.push({ ...p }); return answer(p) },
      readInventoryCheckSessions: async () => ({ items: [session], total: 1, page: 1, pageSize: 20 }),
      readInventoryCheckSession: async () => ({ item: session, items: [{ product_id: 1, state: 'unstarted', revision: 0, counted_quantity: null, reason: null, baseline_quantity: 5, current_quantity: 5, stock_changed: false, product_snapshot: items[0] }] }),
      readInventoryCheckHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    },
  }
  type Surface = Awaited<ReturnType<typeof harness.mount>>
  const headers = (s: Surface) => s.findAll(n => n.getAttribute('data-inventory-check-group') !== null).map(n => n.getAttribute('data-inventory-check-group'))
  try {
    const s = await harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles, props: {} })
    const first = { groupBy: requests.at(-1)?.groupBy, headers: headers(s) }
    await s.click(s.button('sessions'))
    await s.click(s.button(/./, s.find(n => n.getAttribute('data-inventory-check-session') === 'check-1', 'session row')))
    await s.settle({})
    const inSession = requests.at(-1)
    const before = requests.length
    await s.click(s.button('Leave session'))
    await s.settle({})
    const after = requests.slice(before)
    const result = { first, inSession, afterGroupBy: after.map(r => r.groupBy), headers: headers(s) }
    await s.unmount()
    return result
  } finally { await harness.close() }
}

const GROUPED = ['d:2026-11-12', 'never']
const real = await leaveSession(false)
assert.equal(real.first.groupBy, 'checked', 'the first list read asks for the default grouping')
assert.deepEqual(real.first.headers, GROUPED, 'the first list is drawn with its group headers')
assert.equal(real.inSession?.sessionId, 'check-1', 'the session was opened, and its read carries the session id')
assert.ok(real.afterGroupBy.length > 0 && real.afterGroupBy.every(value => value === 'checked'), `every read after Leave session asks for the grouping (got ${JSON.stringify(real.afterGroupBy)})`)
assert.deepEqual(real.headers, GROUPED, 'the list after Leave session is drawn with its group headers again')
console.log('PASS Leave session keeps the list grouped (groupBy=checked, headers drawn) when the session answer advertises no groupings')

// CONTROL: a session answer that does name the groupings was never a problem; the harness sees groupBy and headers.
const control = await leaveSession(true)
assert.deepEqual(control.headers, GROUPED)
assert.ok(control.afterGroupBy.every(value => value === 'checked'))
console.log('PASS control: a session answer that names the groupings leaves the list grouped')

// MUTANT: undo the fix (a session answer overwrites what the tab learned) and the same scenario must go red.
const GUARD = 'if (!sessionId) knownGroupings = products.simple'
const undoFix = (key: string, code: string) => {
  if (key !== 'components/inventory/InventoryChecksPage.tsx') return code
  assert.equal(code.split(GUARD).length - 1, 1, 'the mutant anchor occurs exactly once')
  return code.replace(GUARD, 'knownGroupings = products.simple')
}
const mutant = await leaveSession(false, undoFix)
assert.ok(!mutant.afterGroupBy.every(value => value === 'checked'), `MUTANT survived: with the fix undone the list is still grouped after Leave session (${JSON.stringify(mutant.afterGroupBy)})`)
assert.deepEqual(mutant.headers, [], 'with the fix undone the list is drawn flat after Leave session')
console.log('PASS mutant: undoing the fix leaves the list ungrouped after Leave session, and this test catches it')
