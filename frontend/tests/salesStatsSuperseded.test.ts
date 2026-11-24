import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import { requireSalesStatsResult } from '../src/api/salesStatsContract.ts'
import * as scopes from '../src/api/actorReadScope.ts'
import * as http from '../src/api/http.ts'
import { getSalesStats, SALES_LIST_REQUEST_TIMEOUT_MS } from '../src/api/salesTransport.ts'
import { clampPageNumber } from '../src/utils/pagerState.ts'
import { isProductSearchTooShort } from '../src/api/productSearchIndex.ts'
import { createSalesReloadCoalescer } from '../src/components/sales/salesReloadCoalescer.ts'
import { activeSalesFocusId } from '../src/components/sales/salesFocus.ts'

const read = (rel: string) => readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const source = read('components/sales/Sales.tsx')
const ast = ts.createSourceFile('Sales.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'Sales') as ts.FunctionDeclaration
assert.ok(component?.body, 'actual Sales component')
const statements = component.body.statements
const bindingNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text]
  : name.elements.flatMap(e => ts.isBindingElement(e) ? bindingNames(e.name) : [])
function declaration(name: string): string {
  const matches = statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => bindingNames(d.name).includes(name)))
  assert.equal(matches.length, 1, `actual Sales declaration ${name}`)
  return matches[0].getText(ast)
}
function walk(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  return [...(predicate(node) ? [node] : []), ...node.getChildren(ast).flatMap(child => walk(child, predicate))]
}
const clampEffect = statements.find(n => ts.isExpressionStatement(n) && n.getText(ast).startsWith('useEffect(')
  && n.getText(ast).includes('clampPage(current, totalSalesCount'))
assert.ok(clampEffect, 'actual authoritative-count clamp effect')
const syncEffect = statements.find(n => ts.isExpressionStatement(n) && n.getText(ast).startsWith('useEffect(')
  && n.getText(ast).includes('const syncKey = syncChannel?.channel'))
assert.ok(syncEffect, 'actual Sales sync refresh effect')
const statsScopeAssignment = statements.find(n => ts.isExpressionStatement(n) && ts.isBinaryExpression(n.expression)
  && n.expression.left.getText(ast) === 'salesStatsScopeRef.current')
assert.ok(statsScopeAssignment, 'actual render-time statistics scope-ref update')
const pending = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'resolvePendingSalesLoad')
assert.ok(pending)
const retryButtons = walk(component, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'button'
  && n.getText(ast).includes("t('retry')") && n.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p)
    && p.name.getText(ast) === 'onClick' && /loadSales|retrySalesReads/.test(p.getText(ast)))) as ts.JsxElement[]
assert.equal(retryButtons.length, 2, 'actual early-error and inline-alert Retry buttons')
const retryExpressions = retryButtons.map(n => {
  const p = n.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === 'onClick') as ts.JsxAttribute
  assert.ok(p.initializer && ts.isJsxExpression(p.initializer) && p.initializer.expression)
  return p.initializer.expression.getText(ast)
})
const rowFailure = statements.find(n => ts.isIfStatement(n) && /loadError.*!loading.*!sales.length/.test(n.expression.getText(ast))) as ts.IfStatement
assert.ok(rowFailure, 'actual row-only early error gate')
const statsReadEffects = statements.filter(n => ts.isExpressionStatement(n)
  && n.getText(ast).startsWith('useEffect(') && n.getText(ast).includes('void loadSalesStats().then'))
const pageReadEffects = statements.filter(n => ts.isExpressionStatement(n)
  && n.getText(ast).startsWith('useEffect(') && n.getText(ast).includes('loadSales(false)')
  && n.getText(ast).includes('if (!isActive)') && n.getText(ast).includes('clearLoadWatchdog'))
assert.equal(statsReadEffects.length, 1, 'actual Stats callback dependency effect')
assert.equal(pageReadEffects.length, 1, 'actual list callback dependency effect')
// d1-client C3 (6.0.1623): the search the stats and list reads use is the last search long enough to query (effectiveSalesSearch), held in a ref.
const projections = ['lastSalesSearchRef', 'effectiveSalesSearch', 'focusSaleId', 'salesStatsParams', 'salesReadAuthority', 'salesStatsScope', 'salesStatsScopeRef', 'salesPageParams', 'salesPageScope',
  'salesPageRowsRef', 'salesStatsRead', 'currentSalesStatsRead', 'salesStats', 'salesStatsError', 'salesReadError',
  'loadSales', 'loadSalesStats', 'retrySalesReads', 'totalSalesCount', 'currentSalesPageItems', 'revenue', 'revenueCount', 'creditUsd', 'paidOnlyUsd']
const code = `${pending.getText(ast)}\n${projections.map(declaration).join('\n')}\n${statsScopeAssignment.getText(ast)}\n${clampEffect.getText(ast)}\n${syncEffect.getText(ast)}\n`
const compile = (body: string, result: string) => new Function('env', `with(env){${transformSync(body, { loader: 'tsx', target: 'es2022', jsxFactory: 'jsx', jsxFragment: 'Fragment' }).code};return (${result})}`)
const viewExpression = `{ sales, loading, loadError, salesReadError, salesStatsRead, salesStats, salesStatsError,
  salesReadAuthority, salesStatsScope, salesStatsParams, salesPageScope, totalSalesCount, currentSalesPageItems, revenue, revenueCount, creditUsd, paidOnlyUsd,
  loadSales, loadSalesStats, retries:[${retryExpressions.join(',')}], rowFailure:(${rowFailure.expression.getText(ast)}) }`
const run = compile(code, viewExpression)
const runReadEffects = compile(`${code}\n${statsReadEffects[0].getText(ast)}\n${pageReadEffects[0].getText(ast)}\n`, viewExpression)

type Slot = { value?: any; deps?: unknown[]; cleanup?: () => void }
function hooks() {
  let cursor = 0, dirty = false
  const slots: Slot[] = [], effects = new Map<number, () => void | (() => void)>()
  const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]))
  const api: any = {
    useState(initial: unknown) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true }] },
    useRef(initial: unknown) { return (slots[cursor++] ??= { value: { current: initial } }).value },
    useMemo(fn: () => unknown, deps: unknown[]) { const slot = slots[cursor++] ??= {}; if (changed(slot.deps, deps)) { slot.value = fn(); slot.deps = deps }; return slot.value },
    useCallback(fn: unknown, deps: unknown[]) { return api.useMemo(() => fn, deps) },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const index = cursor++, slot = slots[index] ??= {}; if (changed(slot.deps, deps)) { slot.deps = deps; effects.set(index, fn) } },
  }
  return { api, begin() { cursor = 0; dirty = false }, dirty: () => dirty, commit() {
    for (const [index, fn] of effects) { slots[index].cleanup?.(); slots[index].cleanup = fn() || undefined }; effects.clear()
  } }
}
function deferred() { let resolve!: (v: any) => void, reject!: (e: unknown) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const data = new Map<string, string>()
const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, String(v)) }, removeItem: (k: string) => { data.delete(k) } }
const priorWindow = (globalThis as any).window
const priorFetch = globalThis.fetch
const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const browserEvents: Event[] = []
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
Object.assign(globalThis, { window: { localStorage: store, sessionStorage: store, location: { origin: 'https://stats.fixture.invalid' }, addEventListener() {}, dispatchEvent(event: Event) { browserEvents.push(event); return true }, setTimeout, clearTimeout } })
function actor(id = 1) { data.set('businessos_user', JSON.stringify({ id })); scopes.resetActorReadSession() }
function harness(statsApi?: (params: any, options?: any) => Promise<unknown>, options: { autoReadEffects?: boolean; props?: Record<string, unknown> } = {}) {
  actor()
  const h = hooks(), rows: any[] = [], stats: any[] = []
  const props: any = { isActive: true, authReady: true, canViewSales: true, isAdmin: false, userFilter: 'all', statusFilter: 'all', debouncedSearch: '',
    salesDateRange: { startDate: '2026-09-01' }, salesFocus: null, search: '', statusSecurityScope: 'security-A', salesPage: 4, salesPageSize: 20, salesSortSpec: { field: 'date', direction: 'desc' }, syncChannel: null, ...options.props }
  const model: any = { sales: [], loadError: null, loading: false, stripCalls: 0 }, pageChanges: number[] = []
  const ref = (current: any) => ({ current })
  const refs: any = { statusSecurityRef: ref(props.statusSecurityScope), loadSecurityRef: ref(props.statusSecurityScope), latestLoadRef: ref(null), loadAbortRef: ref(null),
    loadRequestRef: ref(0), loadPromiseRef: ref(null), pendingLoadRef: ref(null), latestQueryKeyRef: ref(''), loadKeyRef: ref(''), aliveRef: ref(true), salesRef: ref([]), loadedOnceRef: ref(false), loadWatchdogRef: ref(undefined), salesStatsRequestRef: ref(0), salesStatsAbortRef: ref(null), handledSyncRef: ref('') }
  // d1-client C3 (6.0.1623): a sync event no longer reads inside the effect; it is noted by the Sales reload coalescer, which reloads once when its quiet
  // window ends. The REAL coalescer runs here with a manual clock (fireReload = the window elapsing); its run body is Sales.tsx runSalesReloadRef.
  const reloadTimers = new Map<number, () => void>()
  let nextReloadTimer = 1
  refs.salesReloadRef = ref(createSalesReloadCoalescer(
    { setTimeout: (callback: () => void) => { const id = nextReloadTimer++; reloadTimers.set(id, callback); return id }, clearTimeout: (id: number) => { reloadTimers.delete(id) }, now: () => 0 },
    (plan) => {
      if (!props.isActive) return
      if (plan.rowsAndTotals) { void view.loadSales(true); void view.loadSalesStats() }
      if (plan.strip) void model.stripCalls++
    },
  ))
  const fireReload = () => { for (const [id, callback] of [...reloadTimers]) { reloadTimers.delete(id); callback() } }
  const helpers = { activeSalesFocusId, isProductSearchTooShort, beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, requireSalesStatsResult,
    captureActorReadScope: scopes.captureActorReadScope, isActorReadScopeCurrent: scopes.isActorReadScopeCurrent, assertActorReadScope: scopes.assertActorReadScope,
    clampPage: clampPageNumber, clearLoadWatchdog() {}, withLoaderTimeout: (fn: () => unknown) => fn(), SALES_LIST_REQUEST_TIMEOUT_MS: 8000,
    normalizeSaleRows: (value: unknown) => Array.isArray(value) ? value : [], getErrorMessage: (e: any) => e.message,
    translateOr: (_key: string, fallback: string) => fallback, loadStatsStrip: async () => { model.stripCalls++ }, setUserOptionsLoaded() {}, setHistoryReady() {},
    saleListRevenueUsd() { throw new Error('PAGE_SUBTOTAL_IS_NOT_COHORT_AUTHORITY') }, saleListCreditUsd() { throw new Error('PAGE_CREDIT_IS_NOT_COHORT_AUTHORITY') }, isCountedSale: () => true,
    setSales: (v: unknown) => { model.sales = v }, setLoadError: (v: unknown) => { model.loadError = v }, setLoading: (v: unknown) => { model.loading = v },
    setSalesPage: (v: any) => { const next = typeof v === 'function' ? v(props.salesPage) : v; pageChanges.push(next); props.salesPage = next },
    fetchSales: (params: any, options: any) => { const d = deferred(); rows.push({ ...d, params, options }); return d.promise },
    fetchSalesStats: (params: any, options: any) => { if (statsApi) return statsApi(params, options); const d = deferred(); stats.push({ ...d, params, options }); return d.promise }, window: { setTimeout: () => 1, clearTimeout() {} },
    console: { error() {} } }
  let view: any
  const execute = options.autoReadEffects ? runReadEffects : run
  const render = () => { h.begin(); refs.statusSecurityRef.current = props.statusSecurityScope; view = execute({ ...h.api, ...props, ...model, ...refs, ...helpers }); return view }
  const commit = () => { refs.latestLoadRef.current = view.loadSales; h.commit(); return render() }
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); return render() }
  render()
  return { props, model, refs, rows, stats, pageChanges, render, commit, flush, fireReload, get view() { return view } }
}
function bounded<T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`fixture deadline: ${label}`), { code: 'fixture_deadline' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
const valid = (amount = 120, count = 85) => ({ total_count: count, revenue_count: count, revenue_usd: amount, pending_revenue_usd: 3, revenue_without_not_paid_usd: amount - 3, truncated_in_list: false })
const unknown = (v: any) => { for (const k of ['totalSalesCount', 'revenue', 'revenueCount', 'creditUsd', 'paidOnlyUsd']) assert.equal(v[k], null, k) }
let failures = 0
async function test(name: string, fn: () => void | Promise<void>) { try { await fn(); console.log('PASS ' + name) } catch (e) { failures++; console.error('FAIL ' + name); console.error(e) } }

const settle = (ms = 15) => new Promise<void>(r => setTimeout(r, ms))
type Call = { url: string; signal?: AbortSignal; respond: (r: Response) => void }
function stubFetch(auto?: (index: number) => Response | undefined) {
  const calls: Call[] = []
  globalThis.fetch = ((url: unknown, init: any) => new Promise<Response>((resolve, reject) => {
    const index = calls.length
    calls.push({ url: String(url), signal: init?.signal, respond: resolve })
    const instant = auto?.(index)
    if (instant) { resolve(instant); return }
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as typeof fetch
  return calls
}
const realTransport = () => { http.__resetApiHealthForTests(); http.cacheClearAll(); http.setSyncServerUrl('https://sales-stats.fixture.invalid') }
const abortError = () => Object.assign(new Error('Request superseded by a newer search'), { name: 'AbortError' })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

try {
  await test('defect 1, real transport: the same totals query asked twice while on the wire ends ready after one more request', async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch()
    const first = h.view.loadSalesStats(); await settle(); const second = h.view.loadSalesStats(); await settle()
    assert.ok(calls.length >= 1)
    calls[calls.length - 1].respond(json(valid(120, 85))); await Promise.all([first, second]); await h.flush()
    assert.equal(h.view.salesStatsRead.status, 'ready', 'a superseded read must not end in the failure box'); assert.equal(h.view.salesStatsRead.value.revenue_usd, 120)
    assert.equal(calls.length, 2, 'exactly one more read, not a loop')
  })
  await test('defect 1: an AbortError this page did not cause is read once more and ends ready', async () => {
    let n = 0
    const h = harness(() => { n++; return n === 1 ? Promise.reject(abortError()) : Promise.resolve(valid(55, 9)) })
    await h.view.loadSalesStats(); await h.flush()
    assert.equal(n, 2); assert.equal(h.view.salesStatsError, null); assert.equal(h.view.revenue, 55)
  })
  await test('defect 1: the second read is also cancelled by someone else -> the box shows after exactly one reread', async () => {
    let n = 0
    const h = harness(() => { n++; return Promise.reject(n < 5 ? abortError() : new Error('runaway reread')) })
    await h.view.loadSalesStats(); await h.flush()
    assert.equal(n, 2, 'at most one reread per call'); assert.equal(h.view.salesStatsRead.status, 'error'); assert.ok(h.view.salesStatsError)
  })
  await test('aborted by this page (superseded by a newer query): no box, no reread, the newer answer wins', async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch()
    const a = h.view.loadSalesStats(); await settle()
    h.props.debouncedSearch = 'Bravo'; h.render()
    const b = h.view.loadSalesStats(); await settle()
    assert.equal(calls.length, 2, 'A then B, no reread of A')
    calls[1].respond(json(valid(77, 30))); await Promise.all([a, b]); await h.flush()
    assert.equal(calls.length, 2); assert.equal(h.view.revenue, 77); assert.equal(h.view.salesStatsError, null)
  })
  await test('a failure that is not an AbortError is never read again', async () => {
    let n = 0
    const h = harness(() => { n++; return n === 1 ? Promise.reject(new Error('Server error')) : Promise.resolve(valid()) })
    await h.view.loadSalesStats(); await h.flush()
    assert.equal(n, 1); assert.equal(h.view.salesStatsRead.status, 'error'); assert.ok(h.view.salesStatsError)
  })
  await test('aborted by this page own controller while still current: not another caller cancel, no reread', async () => {
    let n = 0
    const h = harness((_p, o) => { n++; if (n > 1) return Promise.resolve(valid()); return new Promise((_ok, reject) => o.signal.addEventListener('abort', () => reject(abortError()))) })
    const p = h.view.loadSalesStats(); h.refs.salesStatsAbortRef.current.abort(); await p; await h.flush()
    assert.equal(n, 1, 'one read only')
  })
  await test('aborted by this page going inactive: no box and no reread', async () => {
    let n = 0
    const h = harness((_p, o) => { n++; if (n > 1) return Promise.resolve(valid()); return new Promise((_ok, reject) => o.signal.addEventListener('abort', () => reject(abortError()))) })
    const p = h.view.loadSalesStats()
    invalidateTrackedRequest(h.refs.salesStatsRequestRef); h.refs.salesStatsAbortRef.current.abort(); await p; await h.flush()
    assert.equal(n, 1); assert.equal(h.view.salesStatsError, null); assert.notEqual(h.view.salesStatsRead?.status, 'error')
  })
  for (const status of [500, 403]) await test(`a real ${status} from the totals still shows the box`, async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch(() => json({ error: 'nope' }, status))
    await bounded(h.view.loadSalesStats(), `totals ${status}`); await h.flush()
    assert.ok(calls.length >= 1); assert.equal(h.view.salesStatsRead.status, 'error'); assert.ok(h.view.salesStatsError); unknown(h.view)
  })
  await test('defect 3: the totals read gets the list budget and a real timeout still shows the box without a reread', async () => {
    let budget: unknown, n = 0
    const h = harness((params, options) => { budget = options.timeoutMs; n++; return getSalesStats(params, { ...options, timeoutMs: 30 }) })
    realTransport(); const calls = stubFetch()
    await bounded(h.view.loadSalesStats(), 'timeout'); await h.flush()
    assert.equal(budget, 8000, 'the harness injects SALES_LIST_REQUEST_TIMEOUT_MS = 8000; totals must pass exactly that value')
    assert.equal(n, 1, 'a request_timeout is not an AbortError: no page-level reread'); assert.ok(calls.length >= 1)
    assert.equal(h.view.salesStatsRead.status, 'error'); assert.ok(h.view.salesStatsError)
  })
  await test('defect 3: the real list budget the totals must share is 20 s, longer than the 12 s default', () => {
    assert.equal(SALES_LIST_REQUEST_TIMEOUT_MS, 20_000)
    assert.ok(SALES_LIST_REQUEST_TIMEOUT_MS > 12_000)
  })
  await test('a different actor\'s answer is never shown', async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch()
    const p = h.view.loadSalesStats(); await settle()
    actor(2); calls[calls.length - 1].respond(json(valid(999, 900))); await p; await h.flush()
    unknown(h.view); assert.equal(h.view.salesStatsError, null); assert.notEqual(h.view.salesStatsRead?.status, 'ready')
    const other = harness((_p) => Promise.resolve(valid(999, 900))); const q = other.view.loadSalesStats(); actor(3); await q; await other.flush()
    unknown(other.view); assert.notEqual(other.view.salesStatsRead?.status, 'ready'); assert.equal(other.view.salesStatsError, null)
  })
  await test('defect 2a, real transport: a revision bump (roles-style cache clear) while the read is on the wire is read once more and ends ready', async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch()
    const p = h.view.loadSalesStats(); await settle()
    scopes.invalidateActorReadChannel('sales'); calls[0].respond(json(valid(10, 1))); await settle()
    assert.equal(calls.length, 2, 'the answer the cache fenced is replaced by one more read, not shown and not failed')
    calls[1].respond(json(valid(120, 85))); await p; await h.flush()
    assert.equal(h.view.salesStatsRead.status, 'ready'); assert.equal(h.view.salesStatsRead.value.revenue_usd, 120)
  })
  await test('defect 2b: a ready total stays on screen after a later sales revision bump', async () => {
    const h = harness(), p = h.view.loadSalesStats(); h.stats[0].resolve(valid()); await p; await h.flush()
    scopes.invalidateActorReadChannel('sales'); h.render()
    assert.equal(h.view.revenue, 120); assert.equal(h.view.salesStatsError, null)
    actor(2); h.render(); unknown(h.view); assert.equal(h.view.salesStatsError, null, 'an account change still drops it')
  })
  await test('defects 1 and 2a, real transport: the recovered totals are on screen, not just ready in state', async () => {
    const h = harness(getSalesStats); realTransport(); const calls = stubFetch()
    const p = h.view.loadSalesStats(); await settle()
    scopes.invalidateActorReadChannel('sales'); calls[0].respond(json(valid(10, 1))); await settle()
    calls[1].respond(json(valid(120, 85))); await p; await h.flush()
    assert.equal(h.view.revenue, 120); assert.equal(h.view.salesStatsError, null)
  })
} finally { (globalThis as any).window = priorWindow; globalThis.fetch = priorFetch; http.__resetApiHealthForTests(); if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else delete (globalThis as any).navigator }
if (failures) process.exitCode = 1
