import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'
import { APP_NAVIGATION_EVENT } from '../src/app/pathRouting.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'

// One world for the count-task page tests: the real Inventory page mounted on the harness, a Worker double that answers the task routes the way
// docs/contracts/inventory-check-tasks-20261119.md says, and every request recorded in order. The page itself, the hook, the drafts and the store are real.
export const pack = (language: 'en' | 'km') => JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
const FIELDS = { inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true, inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true }
export type Viewer = 'admin' | 'employee' | 'issuer' | 'neither'
export const viewerUser = (viewer: Viewer) => viewer === 'admin' ? { id: 1, username: 'boss', role_code: 'admin', permissions: { inventory: true, inventory_checks: true, ...FIELDS } }
  : viewer === 'employee' ? { id: 7, username: 'sok', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, ...FIELDS } }
    : viewer === 'issuer' ? { id: 8, username: 'dara', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, inventory_check_issue: true, 'inventory_checks:tasks': false, ...FIELDS } }
      : { id: 9, username: 'vann', role_code: 'employee', permissions: { inventory: true, inventory_checks: true, 'inventory_checks:tasks': false, ...FIELDS } }

export type BoardTask = { id: string; branch_id: number; title: string; status: 'open' | 'closed'; revision: number; issued_at: string; issued_by?: string; closed_at: string | null; total: number; done: number; removed: number
  selection: { kind: 'ids' } | { kind: 'filters'; filters: Record<string, string> } | null; picked_up_by: string | null; picked_up_at: string | null; mine: boolean; pickup_session_id?: string; can_pickup: boolean; can_release: boolean; can_close: boolean }
export const task = (id: string, over: Partial<BoardTask> = {}): BoardTask => ({ id, branch_id: 1, title: '', status: 'open', revision: 0, issued_at: '2026-11-18T03:00:00.000Z', issued_by: 'boss', closed_at: null, total: 4, done: 0, removed: 0, selection: { kind: 'ids' },
  picked_up_by: null, picked_up_at: null, mine: false, can_pickup: true, can_release: false, can_close: false, ...over })

const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
const docListeners = new Map<string, Set<EventListener>>()
const applyLocation = (url: string) => { const next = new URL(url, 'https://admin.example.test/'); Object.assign(window.location, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash }) }
function installWindow() {
  listeners.clear()
  window.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as EventListenerOrEventListenerObject) } }
  window.removeEventListener = (type: string, listener: unknown) => { if (listener) listeners.get(type)?.delete(listener as EventListenerOrEventListenerObject) }
  window.dispatchEvent = event => { for (const listener of [...listeners.get(event.type) ?? []]) { if (typeof listener === 'function') listener.call(window, event); else listener.handleEvent(event) }; return true }
  // The harness document keeps no listeners: the page's foreground listener needs a real one.
  docListeners.clear()
  document.addEventListener = (type: string, listener: unknown) => { if (listener) { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type)!.add(listener as EventListener) } }
  document.removeEventListener = (type: string, listener: unknown) => { if (listener) docListeners.get(type)?.delete(listener as EventListener) }
  document.dispatchEvent = (event: Event) => { for (const listener of [...docListeners.get(event.type) ?? []]) listener.call(document, event); return true }
  window.history.pushState = (_s, _u, url) => { applyLocation(String(url)) }
  window.history.replaceState = (_s, _u, url) => { applyLocation(String(url)) }
}
export const open = (section: string) => applyLocation(`https://admin.example.test/inventory#hub:inventory:${section}`)

export type Call = { route: string; params: Record<string, unknown> }
export async function createTasksWorld(options: { branches?: Array<{ id: number; name: string }>; products?: number; /** Rewrites a source module as it loads (a planted defect for a test that must catch it). */ mutateSource?: (key: string, code: string) => string } = {}) {
  const harness = await createHarness({ observe: ['api/actorReadScope.ts', 'utils/dirtyWork.ts'], ...(options.mutateSource ? { mutateSource: options.mutateSource } : {}) })
  installWindow()
  open('products')
  const branches = options.branches ?? [{ id: 1, name: 'Main' }]
  const world = {
    harness, calls: [] as Call[], branches,
    board: [] as BoardTask[], capabilities: { issue: true, work: true, maxProducts: 300, maxOpenTasks: 30 },
    boardStatus: 200,
    productCount: options.products ?? 25,
    /** The products of each task, by task id. */
    taskProducts: new Map<string, number[]>(),
    /** What the server knows of each product's latest count: its time. */
    checks: new Map<number, { at: string; state: 'done' | 'issue'; counted_quantity: number }>(),
    failures: {} as Record<string, unknown>,
    notices: [] as Array<{ text: string; tone: string }>,
    guard: null as null | ReturnType<typeof dirtyWork.getDirtyWork>,
    user: viewerUser('employee') as ReturnType<typeof viewerUser>,
    language: 'en' as 'en' | 'km',
    closeTaskOnSubmit: true,
    /** False: the device is offline (the app's canWriteToServer), so every write is refused before it is sent. */
    online: true,
    /** The state the list reports for a task the board does not list (an old one). */
    offBoardStatus: 'closed' as 'open' | 'closed',
    /** A viewer who may not see staff identity gets no issued_by key at all (contract 3.1). */
    hideIssuer: false,
    /** The answer of a submission says the task closed even when part of it is left (a closed-elsewhere race). */
    forceClosed: false,
    productsPerSubmission: 40,
    /** While set, GET /tasks waits for it (a first open shows its skeleton until the answer arrives). */
    hold: null as Promise<void> | null,
    /** The write identity of the signed-in account: a mounted page freezes it when it opens, and an account or server switch moves it on (the real one only ever goes up). */
    identityEpoch: 1,
    count: (route: string) => world.calls.filter(call => call.route === route).length,
    ofRoute: (route: string) => world.calls.filter(call => call.route === route),
    reset: () => { world.calls.length = 0 },
    mount: async () => {
      const words = pack(world.language)
      const app = {
        user: world.user, page: 'inventory', authReady: true, canWriteToServer: world.online, language: world.language, settings: { navigation_mode: 'sections' }, AccessDenied: () => 'Access denied',
        t: (key: string) => words[key] ?? key, notify: (text: string, tone: string) => { world.notices.push({ text, tone }) },
        // The app's guard in miniature: a hub switch or a page leave with dirty work raises the three-option guard (it is recorded here) and goes nowhere.
        navigateTo: (page: string, anchor?: string) => {
          const dirty = dirtyWork.getDirtyWork()
          if (dirty.length) { world.guard = dirty; return }
          window.history.pushState(null, '', `/inventory#${anchor || ''}`)
          window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/inventory', anchor } }))
        },
        navigate: (anchor: string) => { window.history.pushState(null, '', `/inventory#${anchor}`); window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page: 'inventory', path: '/inventory', anchor } })) },
      }
      return harness.mount({ component: 'components/inventory/InventoryChecksPage.tsx', app, doubles: doubles(), props: {} })
    },
  }
  const record = (route: string, params: Record<string, unknown> = {}) => { world.calls.push({ route, params: { ...params } }) }
  const rowOf = (id: number) => ({ id, name: `Product ${id}`, unit: 'pcs', barcode: `BC${1000 + id}`, stock_quantity: 8, branch_stock: world.branches.map(branch => ({ branch_id: branch.id, branch_name: branch.name, quantity: 8 })) })
  const overlayEntry = (id: number) => { const check = world.checks.get(id); return { product_id: id, last_change_at: null, ...(check ? { check: { state: check.state, counted_quantity: check.counted_quantity, seen_quantity: 8, note: null, at: check.at, session_id: 's-x', by: 'alice' } } : {}) } }
  const fail = (key: string) => { const failure = world.failures[key]; if (failure) { delete world.failures[key]; throw failure } }
  const mark = (id: string, patch: Partial<BoardTask>) => { const row = world.board.find(candidate => candidate.id === id); if (row) Object.assign(row, patch) }
  const doubles = () => ({
    'utils/dirtyWork.ts': dirtyWork,
    'api/actorReadScope.ts': { captureActorReadScope: () => ({ authority: 'test', channel: 'inventoryChecks', revision: '1' }), captureActorWriteIdentity: () => ({ owner: 'test', epoch: world.identityEpoch }), isActorReadScopeCurrent: () => true, isActorWriteIdentityCurrent: (identity?: { owner?: string; epoch?: number }) => identity?.owner !== 'test' || identity.epoch === world.identityEpoch },
    'api/productReadTransport.ts': { peekProductSearch: () => null, primeProductSearch: () => {}, getProductFilters: async () => ({ brands: ['Dior', 'Lancome'], categories: [] }) },
    'api/branchTransport.ts': { getBranches: async () => { record('branches'); fail('branches'); return world.branches.map(branch => ({ ...branch, is_active: 1 })) } },
    'api/inventoryChecksTransport.ts': {
      captureInventoryCheckWriteScope: (context: unknown, isCurrent: unknown) => ({ context, readScope: {}, writeIdentity: {}, isCurrent }),
      readInventoryCheckProducts: async (params: Record<string, unknown>) => { record('products-old', params); throw Object.assign(new Error('the older list must not be read'), { status: 500 }) },
      readInventoryCheckList: async (params: Record<string, unknown>) => {
        record('list', params); fail('list')
        const ids = params.taskId ? world.taskProducts.get(String(params.taskId)) ?? [] : Array.from({ length: world.productCount }, (_v, index) => index + 1)
        const page = Number(params.page) || 1, pageSize = Number(params.pageSize) || 20
        return { wired: true, projected: false, items: ids.slice((page - 1) * pageSize, page * pageSize).map(rowOf), total: ids.length, page, pageSize, totalPages: Math.max(1, Math.ceil(ids.length / pageSize)), overlay_ids: 150,
          ...(params.summary === 0 ? {} : { summary: { ok: 0, issue: 0, not_checked: ids.length, total: ids.length } }), capabilities: { productsPerSubmission: world.productsPerSubmission },
          ...(params.taskId ? { task: { id: String(params.taskId), status: world.board.find(row => row.id === params.taskId)?.status ?? world.offBoardStatus, total: ids.length } } : {}) }
      },
      readInventoryCheckOverlay: async (params: { ids: number[]; summary?: boolean }) => { record('overlay', { ids: params.ids.join(','), summary: params.summary }); return { items: params.ids.map(overlayEntry), ...(params.summary === false ? {} : { summary: { ok: 0, issue: 0, not_checked: 1, total: 1 } }) } },
      readInventoryCheckLots: async () => ({ lots: [] }),
      readInventoryCheckSessions: async (params: Record<string, unknown>) => { record('sessions', params); return { items: (world.failures.sessionItems as unknown[]) ?? [], total: ((world.failures.sessionItems as unknown[]) ?? []).length, page: 1, pageSize: 20 } },
      readInventoryCheckTasks: async (branchId: string | number) => {
        record('tasks', { branchId })
        if (world.boardStatus === 404) throw Object.assign(new Error('Not found'), { status: 404, code: 'not_found' })
        fail('board')
        if (world.hold) await world.hold
        const strip = ({ issued_by: _issuer, ...rest }: BoardTask) => rest
        return JSON.parse(JSON.stringify({ branchId: Number(branchId), version: `k${world.calls.length}`, items: world.board.map(row => world.hideIssuer ? strip(row) : row), capabilities: world.capabilities }))
      },
      issueInventoryCheckTask: async (_scope: unknown, input: Record<string, unknown>) => {
        record('issue', input as Record<string, unknown>); fail('issue')
        const ids = (input.scope as { productIds?: number[] }).productIds
        const id = `task-${world.board.length + 1}`
        world.board.unshift(task(id, { total: ids?.length ?? 6, can_close: true }))
        return { item: { id, progress: { total: ids?.length ?? 6 } }, receipt: {}, created: true }
      },
      pickupInventoryCheckTask: async (_scope: unknown, id: string, requestId: string) => {
        record('pickup', { id, requestId }); fail('pickup')
        mark(id, { picked_up_by: world.user.username, mine: true, can_pickup: false, can_release: true, pickup_session_id: 'pickup-1' })
        return { item: { id: 'pickup-1' }, receipt: {}, created: true }
      },
      releaseInventoryCheckTask: async (_scope: unknown, id: string, requestId: string) => {
        record('release', { id, requestId }); fail('release')
        mark(id, { picked_up_by: null, mine: false, can_pickup: true, can_release: false })
        return { item: { id: 'pickup-1' }, receipt: {}, released: true }
      },
      closeInventoryCheckTask: async (_scope: unknown, id: string, revision: number, requestId: string) => {
        record('close', { id, revision, requestId }); fail('close')
        mark(id, { status: 'closed', can_pickup: false, can_release: false, can_close: false, closed_at: '2026-11-19T05:00:00.000Z' })
        return { item: { id }, receipt: {} }
      },
      submitInventoryCheckCounts: async (_scope: unknown, input: { taskId?: string; lines: Array<{ productId: number; countedQuantity: number }> }) => {
        record('submissions', input as unknown as Record<string, unknown>); fail('submit')
        for (const line of input.lines) world.checks.set(line.productId, { at: '2026-11-19T04:00:00.000Z', state: 'done', counted_quantity: line.countedQuantity })
        let closed = false
        for (const row of world.board) {
          const ids = world.taskProducts.get(row.id) ?? []
          row.done = ids.filter(id => world.checks.has(id)).length
          if (row.status === 'open' && ids.length && (row.done >= ids.length || world.forceClosed) && world.closeTaskOnSubmit && row.id === input.taskId) { Object.assign(row, { status: 'closed', can_pickup: false, can_release: false, can_close: false }); closed = true }
        }
        return { item: { id: 'submitted' }, receipt: {}, created: true, ...(input.taskId ? { task: { id: input.taskId, closed } } : {}) }
      },
    },
  })
  return world
}
export type World = Awaited<ReturnType<typeof createTasksWorld>>
export type Surface = Awaited<ReturnType<World['mount']>>
export const rowOf = (surface: Surface, id: number) => surface.find(node => node.getAttribute('data-inventory-check-row') === String(id), `row ${id}`)
export const countInput = (surface: Surface, id: number) => surface.find(node => node.getAttribute('data-check-count') !== null && rowOf(surface, id).contains(node), `count of ${id}`)
export const taskRowOf = (surface: Surface, id: string) => surface.find(node => node.getAttribute('data-inventory-check-task') === id, `task ${id}`)
export const actionIn = (_surface: Surface, scope: ReturnType<typeof taskRowOf>, action: string) => scope.querySelectorAll('[data-task-action]').filter(node => node.getAttribute('data-task-action') === action)[0] ?? null
export const hasAction = (surface: Surface, id: string, action: string) => !!actionIn(surface, taskRowOf(surface, id), action)
export function resetWindow() { installWindow() }
