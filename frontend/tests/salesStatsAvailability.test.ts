import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import { requireSalesStatsResult } from '../src/api/salesStatsContract.ts'
import * as scopes from '../src/api/actorReadScope.ts'
import * as http from '../src/api/http.ts'
import { getSalesStats } from '../src/api/salesTransport.ts'
import { buildQueryString } from '../src/api/query.ts'
import { clampPageNumber } from '../src/utils/pagerState.ts'
import { saleSecurityFingerprint } from '../src/components/sales/saleSettlementConfig.ts'

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
const projections = ['salesStatsParams', 'salesReadAuthority', 'salesStatsScope', 'salesStatsScopeRef', 'salesPageParams', 'salesPageScope',
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
function harness(statsApi?: (params: any) => Promise<unknown>, options: { autoReadEffects?: boolean; props?: Record<string, unknown> } = {}) {
  actor()
  const h = hooks(), rows: any[] = [], stats: any[] = []
  const props: any = { isActive: true, authReady: true, canViewSales: true, isAdmin: false, userFilter: 'all', statusFilter: 'all', debouncedSearch: '',
    salesDateRange: { startDate: '2026-09-01' }, statusSecurityScope: 'security-A', salesPage: 4, salesPageSize: 20, salesSortSpec: { field: 'date', direction: 'desc' }, syncChannel: null, ...options.props }
  const model: any = { sales: [], loadError: null, loading: false, stripCalls: 0 }, pageChanges: number[] = []
  const ref = (current: any) => ({ current })
  const refs: any = { statusSecurityRef: ref(props.statusSecurityScope), loadSecurityRef: ref(props.statusSecurityScope), latestLoadRef: ref(null), loadAbortRef: ref(null),
    loadRequestRef: ref(0), loadPromiseRef: ref(null), pendingLoadRef: ref(null), latestQueryKeyRef: ref(''), loadKeyRef: ref(''), aliveRef: ref(true), salesRef: ref([]), loadedOnceRef: ref(false), loadWatchdogRef: ref(undefined), salesStatsRequestRef: ref(0), handledSyncRef: ref('') }
  const helpers = { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, requireSalesStatsResult,
    captureActorReadScope: scopes.captureActorReadScope, isActorReadScopeCurrent: scopes.isActorReadScopeCurrent, assertActorReadScope: scopes.assertActorReadScope,
    clampPage: clampPageNumber, clearLoadWatchdog() {}, withLoaderTimeout: (fn: () => unknown) => fn(), SALES_LIST_REQUEST_TIMEOUT_MS: 8000,
    normalizeSaleRows: (value: unknown) => Array.isArray(value) ? value : [], getErrorMessage: (e: any) => e.message,
    translateOr: (_key: string, fallback: string) => fallback, loadStatsStrip: async () => { model.stripCalls++ }, setUserOptionsLoaded() {}, setHistoryReady() {},
    saleListRevenueUsd() { throw new Error('PAGE_SUBTOTAL_IS_NOT_COHORT_AUTHORITY') }, saleListCreditUsd() { throw new Error('PAGE_CREDIT_IS_NOT_COHORT_AUTHORITY') }, isCountedSale: () => true,
    setSales: (v: unknown) => { model.sales = v }, setLoadError: (v: unknown) => { model.loadError = v }, setLoading: (v: unknown) => { model.loading = v },
    setSalesPage: (v: any) => { const next = typeof v === 'function' ? v(props.salesPage) : v; pageChanges.push(next); props.salesPage = next },
    fetchSales: (params: any, options: any) => { const d = deferred(); rows.push({ ...d, params, options }); return d.promise },
    fetchSalesStats: (params: any) => { if (statsApi) return statsApi(params); const d = deferred(); stats.push({ ...d, params }); return d.promise }, window: { setTimeout: () => 1, clearTimeout() {} },
    console: { error() {} } }
  let view: any
  const execute = options.autoReadEffects ? runReadEffects : run
  const render = () => { h.begin(); refs.statusSecurityRef.current = props.statusSecurityScope; view = execute({ ...h.api, ...props, ...model, ...refs, ...helpers }); return view }
  const commit = () => { refs.latestLoadRef.current = view.loadSales; h.commit(); return render() }
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); return render() }
  render()
  return { props, model, refs, rows, stats, pageChanges, render, commit, flush, get view() { return view } }
}
function bounded<T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`fixture deadline: ${label}`), { code: 'fixture_deadline' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
const valid = (amount = 120, count = 85) => ({ total_count: count, revenue_count: count, revenue_usd: amount, pending_revenue_usd: 3, revenue_without_not_paid_usd: amount - 3, truncated_in_list: false })
const page = (n = 20) => Array.from({ length: n }, (_, i) => ({ id: i + 61, total_usd: 7, sale_status: 'completed' }))
const unknown = (v: any) => { for (const k of ['totalSalesCount', 'revenue', 'revenueCount', 'creditUsd', 'paidOnlyUsd']) assert.equal(v[k], null, k) }
let failures = 0
async function test(name: string, fn: () => void | Promise<void>) { try { await fn(); console.log('PASS ' + name) } catch (e) { failures++; console.error('FAIL ' + name); console.error(e) } }

try {
  for (const first of ['rows', 'stats']) await test(`actual independent callbacks publish in ${first}-first order`, async () => {
    const h = harness(); h.commit()
    const rp = h.view.loadSales(false), sp = h.view.loadSalesStats()
    if (first === 'rows') { h.rows[0].resolve(page()); await h.flush(); unknown(h.view); assert.equal(h.view.sales.length, 20) }
    else { h.stats[0].resolve(valid()); await h.flush(); assert.equal(h.view.revenue, 120); assert.equal(h.view.sales.length, 0) }
    if (first === 'rows') h.stats[0].resolve(valid()); else h.rows[0].resolve(page())
    await Promise.all([rp, sp]); await h.flush()
    assert.equal(h.view.revenue, 120); assert.equal(h.view.revenueCount, 85); assert.equal(h.view.sales.length, 20)
    assert.notEqual(h.view.revenue, 140, 'a page subtotal is never the cohort header')
    assert.equal(h.view.loadError, null); assert.equal(h.view.salesStatsError, null)
  })
  await test('stats error survives row success and row refresh; row error survives successful stats', async () => {
    const h = harness(); const sp = h.view.loadSalesStats(); h.stats[0].reject(new Error('stats unavailable')); await sp; await h.flush()
    assert.ok(h.view.salesStatsError); unknown(h.view)
    let rp = h.view.loadSales(false); await h.flush(); assert.ok(h.view.salesStatsError, 'row start cannot clear stats failure')
    h.rows[0].resolve(page()); await rp; await h.flush(); assert.ok(h.view.salesStatsError); assert.equal(h.view.salesReadError, h.view.salesStatsError)
    rp = h.view.loadSales(false); h.rows[1].reject(new Error('row failure')); await rp; await h.flush()
    const rowError = h.view.loadError; assert.ok(rowError)
    const again = h.view.loadSalesStats(); h.stats[1].resolve(valid()); await again; await h.flush()
    assert.equal(h.view.loadError, rowError); assert.equal(h.view.salesReadError, rowError); assert.equal(h.view.revenue, 120)
  })
  for (const index of [0, 1]) await test(`actual Retry button ${index + 1} starts both reads`, async () => {
    const h = harness(); h.view.retries[index](); await h.flush()
    assert.equal(h.rows.length, 1); assert.equal(h.stats.length, 1)
    h.rows[0].resolve(page()); h.stats[0].resolve(valid()); await h.flush()
    assert.equal(h.view.sales.length, 20); assert.equal(h.view.revenue, 120)
  })
  await test('render gate hides old ready/error immediately on filter or authority change before effects', async () => {
    for (const ready of [true, false]) {
      const h = harness(), p = h.view.loadSalesStats()
      if (ready) h.stats[0].resolve(valid()); else h.stats[0].reject(new Error('stats failed'))
      await p; await h.flush()
      assert.ok(ready ? h.view.salesStats : h.view.salesStatsError)
      h.props.statusFilter = 'awaiting_payment'; h.render() // Deliberately no effect commit.
      unknown(h.view); assert.equal(h.view.salesStatsError, null)
    }
    for (const transition of ['revision', 'actor']) {
      const h = harness(), p = h.view.loadSalesStats(); h.stats[0].resolve(valid()); await p; await h.flush()
      if (transition === 'revision') scopes.invalidateActorReadChannel('sales'); else actor(2)
      h.render(); unknown(h.view)
      if (transition === 'revision') assert.ok(h.view.salesStatsError, 'an invalidated ready answer supplies Retry instead of exposing stale numbers')
      else assert.equal(h.view.salesStatsError, null)
    }
  })
  await test('a later same-actor cache refresh cannot hide the existing Stats Retry error', async () => {
    const h = harness(), p = h.view.loadSalesStats()
    h.stats[0].reject(new Error('Stats unavailable')); await p; await h.flush()
    assert.ok(h.view.salesStatsError)
    scopes.invalidateActorReadChannel('sales'); h.render()
    unknown(h.view); assert.ok(h.view.salesStatsError, 'generic error remains retryable after a later refresh')
    actor(99); h.render(); assert.equal(h.view.salesStatsError, null, 'error cannot cross actor authority')
  })
  await test('late filter A cannot publish before or after filter B completes', async () => {
    const h = harness(), a = h.view.loadSalesStats(); h.props.debouncedSearch = 'B'; h.render()
    const b = h.view.loadSalesStats(); h.stats[1].resolve(valid(77, 30)); await b; await h.flush()
    h.stats[0].resolve(valid(999, 900)); await a; await h.flush()
    assert.equal(h.view.revenue, 77); assert.equal(h.view.totalSalesCount, 30)
    const other = harness(), old = other.view.loadSalesStats(); other.props.userFilter = '7'; other.props.isAdmin = true; other.render()
    other.stats[0].resolve(valid(999)); await old; await other.flush(); unknown(other.view)
    assert.notEqual(other.view.salesStatsRead?.status, 'ready', 'late callback itself must not publish, independently of masking')
  })
  for (const transition of ['revision', 'actor']) await test(`actual final promise hop fences ${transition} before publication`, async () => {
    const h = harness(), p = h.view.loadSalesStats(); h.stats[0].resolve(valid())
    if (transition === 'revision') scopes.invalidateActorReadChannel('sales'); else actor(2)
    await p; await h.flush(); unknown(h.view)
    assert.notEqual(h.view.salesStatsRead?.status, 'ready', 'callback guard, not only a hidden rendered stale value')
    if (transition === 'revision') { assert.equal(h.view.salesStatsRead?.status, 'error'); assert.ok(h.view.salesStatsError, 'revision failure remains visible and retryable') }
    else assert.equal(h.view.salesStatsError, null, 'a departed actor cannot publish errors')
  })
  await test('actual recovery sales sync event starts fresh callbacks while an old stats read is pending', async () => {
    http.__resetApiHealthForTests(); http.cacheClearAll(); http.setSyncServerUrl('https://sales-stats.fixture.invalid')
    const h = harness(), old = h.view.loadSalesStats()
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await assert.rejects(bounded(getSalesStats({ search: 'recovery-witness' }), 'offline health witness'), (e: any) => e.code !== 'fixture_deadline')
    const since = browserEvents.length
    globalThis.fetch = (async () => Response.json(valid())) as typeof fetch
    await assert.rejects(bounded(getSalesStats({ search: 'recovery-witness' }), 'recovered old revision'), (e: any) => e.code === 'stale_read_scope', 'first recovered HTTP belongs to the invalidated old revision')
    const event = browserEvents.slice(since).find(e => e.type === 'sync:update' && (e as CustomEvent).detail?.channel === 'sales') as CustomEvent
    assert.ok(event, 'actual http recovery dispatches sales refresh'); assert.ok(browserEvents.slice(since).some(e => e.type === 'sync:reconnected'))
    h.props.syncChannel = event.detail; h.render(); h.commit()
    assert.equal(h.rows.length, 1); assert.equal(h.stats.length, 2); assert.equal(h.model.stripCalls, 1, 'actual Sales effect refreshes all existing read surfaces')
    h.stats[0].resolve(valid(999)); await old; await h.flush(); unknown(h.view)
    h.rows[0].resolve(page()); h.stats[1].resolve(valid(77)); await h.flush()
    assert.equal(h.view.revenue, 77); assert.equal(h.view.salesStatsError, null)
    h.render(); h.commit(); assert.equal(h.stats.length, 2, 'same sync event is consumed once')
    http.__resetApiHealthForTests(); globalThis.fetch = priorFetch
  })
  await test('malformed/null answers become visible same-scope error and never successful zero', async () => {
    for (const value of [null, {}, { ...valid(), revenue_usd: '120' }, { ...valid(), total_count: -1 }]) {
      const h = harness(), p = h.view.loadSalesStats(); h.stats[0].resolve(value); await p; await h.flush()
      unknown(h.view); assert.ok(h.view.salesStatsError); assert.equal(h.view.salesStatsRead.status, 'error')
    }
  })
  await test('actual poisoned fresh transport cache becomes visible callback error without self-invalidating authority', async () => {
    const h = harness(getSalesStats)
    http.__resetApiHealthForTests(); http.cacheClearAll(); http.setSyncServerUrl('https://sales-stats.fixture.invalid'); h.render()
    const key = `sales:stats:${buildQueryString(h.view.salesStatsParams, { skipEmpty: false })}`
    const poisoned = { total_count: 0, revenue_usd: 0, pending_revenue_usd: 0, truncated_in_list: false }
    http.cacheSet(key, poisoned)
    const readScope = scopes.captureActorReadScope(key)
    let fetches = 0
    globalThis.fetch = (async () => { fetches++; throw new Error('poisoned fresh cache must fail visibly before a retry') }) as typeof fetch
    await bounded(h.view.loadSalesStats(), 'actual transport callback'); await h.flush()
    assert.equal(fetches, 0); assert.equal(http.cacheGet(key), null); assert.ok(scopes.isActorReadScopeCurrent(readScope))
    assert.equal(h.view.salesStatsRead.status, 'error'); assert.ok(h.view.salesStatsError); unknown(h.view)
    globalThis.fetch = (async () => { fetches++; return Response.json(valid()) }) as typeof fetch
    await bounded(h.view.loadSalesStats(), 'actual transport callback'); await h.flush(); assert.equal(fetches, 1); assert.equal(h.view.revenue, 120); assert.equal(h.view.salesStatsError, null)
  })
  await test('empty later row page with stats failure keeps normal surface and current page', async () => {
    const h = harness(); h.props.salesPage = 5; h.render(); h.commit()
    const rp = h.view.loadSales(false), sp = h.view.loadSalesStats(); h.rows[0].resolve([]); h.stats[0].reject(new Error('stats unavailable'))
    await Promise.all([rp, sp]); await h.flush(); h.commit()
    assert.equal(Boolean(h.view.rowFailure), false, 'aggregate failure cannot take the row-load-failure early return')
    assert.ok(h.view.salesReadError); assert.equal(h.props.salesPage, 5); assert.deepEqual(h.pageChanges, [])
  })
  await test('genuine authoritative zero is ready zero and can legitimately clamp page4 to1', async () => {
    const h = harness(), p = h.view.loadSalesStats()
    h.stats[0].resolve({ ...valid(0, 0), pending_revenue_usd: 0, revenue_without_not_paid_usd: 0 }); await p; await h.flush()
    assert.equal(h.view.totalSalesCount, 0); assert.equal(h.view.revenue, 0); assert.equal(h.view.revenueCount, 0)
    assert.equal(h.view.salesStatsError, null); h.commit(); assert.equal(h.props.salesPage, 1)
  })
  await test('old filter/page rows never become the new unknown pager page count', async () => {
    const h = harness(), p = h.view.loadSales(false); h.rows[0].resolve(page()); await p; await h.flush()
    assert.equal(h.view.currentSalesPageItems, 20)
    h.props.salesPage = 5; h.render(); assert.equal(h.view.currentSalesPageItems, 0)
    h.props.salesPage = 4; h.props.debouncedSearch = 'new'; h.render(); assert.equal(h.view.currentSalesPageItems, 0)
    h.props.statusSecurityScope = 'security-B'; h.render(); assert.equal(h.view.currentSalesPageItems, 0)
  })

  await test('actual current-page item gate rejects old actor/revision authority without a query change', async () => {
    for (const transition of [() => scopes.invalidateActorReadChannel('sales'), () => actor(2)]) {
      const h = harness(), p = h.view.loadSales(false); h.rows[0].resolve(page()); await p; await h.flush()
      assert.equal(h.view.currentSalesPageItems, 20); transition(); h.render()
      assert.equal(h.view.currentSalesPageItems, 0, 'same query text cannot authorize another actor/revision page')
    }
  })
  const jsx = (type: unknown, props: any, ...children: any[]) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } })
  const output = ts.transpileModule(read('components/sales/SalesListSurface.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    if (name === 'react') return { Fragment: 'Fragment' }
    if (name.includes('AppContext')) return { useApp: () => ({ can: () => false }) }
    if (name.includes('useColumnPreferences')) return { useColumnPreferences: () => ({ visibleCount: 0, isVisible: () => false }) }
    if (name.includes('salesListColumns')) return { SALES_COLUMNS_SURFACE_KEY: 'fixture', SALES_OPTIONAL_COLUMNS: [] }
    return {}
  }, mod, mod.exports)
  const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node)
  for (const language of ['en', 'km']) await test(`actual footer ${language}: unknown is dash, authoritative0 stays0`, () => {
    const pack = JSON.parse(read(`lang/${language}.json`)), formatted: number[] = []
    const render = (revenue: number | null, revenueCount: number | null, creditUsd: number | null, paidOnlyUsd: number | null) => text(mod.exports.default({
      collapsedSalesSections: new Set(), filtered: [], filteredIds: [], loading: false, revenue, revenueCount, creditUsd, paidOnlyUsd, salesSections: [], selectedIds: new Set(), selectionModeActive: false,
      t: (key: string) => pack[key] || key, fmtUSD: (v: number) => { assert.equal(typeof v, 'number'); formatted.push(v); return `$${v.toFixed(2)}` } }))
    const unavailable = render(null, null, null, null)
    assert.ok(unavailable.includes(`— ${pack.sales} | —`), unavailable); assert.ok(unavailable.includes(`${pack.rpt_pending_credit} —`)); assert.deepEqual(formatted, [])
    const zero = render(0, 0, 0, 0); assert.ok(zero.includes(`0 ${pack.sales} | $0.00`), zero); assert.deepEqual(formatted, [0])
  })
for (const wasReady of [true, false]) await test(`same React authority session reset reruns actual Stats and page effects (ready=${wasReady})`, async () => {
  const user = Object.freeze({ id: 1, role_code: 'staff', permissions: { sales: 'full' } })
  const fingerprint = saleSecurityFingerprint(user, true)
  const security = 'stable:' + fingerprint
  const h = harness(undefined, { autoReadEffects: true, props: { user, statusSecurityScope: security } })
  h.commit()
  assert.equal(h.stats.length, 1); assert.equal(h.rows.length, 1)
  const params = JSON.stringify(h.stats[0].params)
  const pageParams = JSON.stringify(h.rows[0].params)
  h.rows[0].resolve(page())
  if (wasReady) h.stats[0].resolve(valid())
  else h.stats[0].reject(new Error('old Stats failed'))
  await h.flush(); h.commit()
  assert.ok(wasReady ? h.view.salesStats : h.view.salesStatsError)
  const oldAuthority = h.view.salesReadAuthority
  const oldStatsScope = h.view.salesStatsScope, oldPageScope = h.view.salesPageScope
  const oldStatsCallback = h.view.loadSalesStats, oldRowsCallback = h.view.loadSales

  scopes.resetActorReadSession()
  h.render() // Deliberately BEFORE effects.
  assert.strictEqual(h.props.user, user)
  assert.equal(h.props.statusSecurityScope, security)
  assert.equal(saleSecurityFingerprint(user, true), fingerprint)
  assert.notEqual(h.view.salesReadAuthority, oldAuthority)
  unknown(h.view); assert.equal(h.view.salesStatsError, null, 'old authority error must not cross session reset')
  assert.notEqual(h.view.salesStatsScope, oldStatsScope, 'Stats query lifecycle observes actual authority')
  assert.notEqual(h.view.salesPageScope, oldPageScope, 'page lifecycle observes actual authority')
  assert.notStrictEqual(h.view.loadSalesStats, oldStatsCallback)
  assert.notStrictEqual(h.view.loadSales, oldRowsCallback)
  assert.equal(h.stats.length, 1); assert.equal(h.rows.length, 1, 'render itself must not dispatch')
  h.commit() // THE witness: actual callback-dependent effects start fresh reads.
  assert.equal(h.stats.length, 2, 'actual Stats effect reruns')
  assert.equal(h.rows.length, 2, 'actual page effect reruns')
  assert.equal(JSON.stringify(h.stats[1].params), params, 'authority stays out of URL parameters')
  assert.equal(JSON.stringify(h.rows[1].params), pageParams)
  h.stats[1].resolve(valid(88)); h.rows[1].resolve(page())
  await h.flush(); h.commit()
  assert.equal(h.view.revenue, 88); assert.equal(h.view.salesStatsError, null)
  assert.equal(h.view.currentSalesPageItems, 20)
  h.render(); h.commit()
  assert.equal(h.stats.length, 2); assert.equal(h.rows.length, 2, 'unchanged authority rerender adds no requests')
})

await test('actual authority-key refresh supersedes pending rows through existing coalescer and ignores late Stats', async () => {
  for (const oldFails of [false, true]) {
    const h = harness(undefined, { autoReadEffects: true })
    h.commit()
    assert.equal(h.rows.length, 1); assert.equal(h.stats.length, 1)
    const oldSignal = h.rows[0].options.signal as AbortSignal
    const oldPageScope = h.view.salesPageScope
    scopes.resetActorReadSession(); h.render(); unknown(h.view); h.commit()
    assert.notEqual(h.view.salesPageScope, oldPageScope)
    assert.equal(oldSignal.aborted, true, 'new page authority must supersede the old query')
    assert.equal(h.rows.length, 1, 'existing coalescer waits for the old request to settle')
    assert.equal(h.stats.length, 2, 'Stats effect starts the new authority')
    h.stats[1].resolve(valid(77)); await h.flush()
    assert.equal(h.view.revenue, 77)
    if (oldFails) h.stats[0].reject(new Error('late old authority failure'))
    else h.stats[0].resolve(valid(999))
    h.rows[0].resolve([{ id: 'old-private-page' }]); await h.flush()
    assert.equal(h.view.revenue, 77); assert.equal(h.view.salesStatsError, null)
    assert.equal(h.rows.length, 2, 'old finally hands the queued load to the new page scope')
    assert.deepEqual(h.view.sales, [], 'old page result must not publish')
    h.rows[1].resolve(page()); await h.flush(); h.commit()
    assert.equal(h.view.currentSalesPageItems, 20)
    assert.equal(h.view.revenue, 77)
  }
})

await test('plain revision change keeps authority query keys stable and causes no added read-effect loop', async () => {
  const h = harness(undefined, { autoReadEffects: true })
  h.commit(); h.rows[0].resolve(page()); h.stats[0].resolve(valid())
  await h.flush(); h.commit()
  const authority = h.view.salesReadAuthority
  const statsScope = h.view.salesStatsScope, pageScope = h.view.salesPageScope
  const statsCallback = h.view.loadSalesStats, rowsCallback = h.view.loadSales
  scopes.invalidateActorReadChannel('sales')
  h.render()
  assert.equal(h.view.salesReadAuthority, authority)
  assert.equal(h.view.salesStatsScope, statsScope); assert.equal(h.view.salesPageScope, pageScope)
  assert.strictEqual(h.view.loadSalesStats, statsCallback); assert.strictEqual(h.view.loadSales, rowsCallback)
  unknown(h.view); assert.ok(h.view.salesStatsError, 'invalidated numbers remain unavailable with current-actor Retry')
  h.commit(); h.render(); h.commit()
  assert.equal(h.stats.length, 1); assert.equal(h.rows.length, 1, 'revision alone cannot loop callback effects')
})
} finally { (globalThis as any).window = priorWindow; globalThis.fetch = priorFetch; http.__resetApiHealthForTests(); if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else delete (globalThis as any).navigator }
if (failures) process.exitCode = 1
