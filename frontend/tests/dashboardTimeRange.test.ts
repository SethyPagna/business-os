import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { dashboardRangeQuery, dashboardRangeLabel } from '../src/components/dashboard/dashboardRange.ts'
import { reportQueryParams, getReportView } from '../src/components/sales/reports/reportModel.ts'
import { beginTrackedRequest, isTrackedRequestCurrent, invalidateTrackedRequest } from '../src/utils/loaders.ts'

const range = { startDate: '2026-09-19', endDate: '2026-09-20', startTime: '22:00', endTime: '02:00' }
const query = dashboardRangeQuery(range)
assert.deepEqual(query, { startDate: '2026-09-19', endDate: '2026-09-20', createdFrom: '2026-09-19 15:00:00', createdTo: '2026-09-19 19:01:00' })
assert.deepEqual(query, reportQueryParams({ ...range, branchId: '', status: '', paymentMethod: '' }, getReportView('overview')), 'Dashboard and Reports use identical continuous business-time bounds')
assert.match(dashboardRangeLabel(range), /22:00.*02:00.*UTC\+7/)
for (const times of [{ startTime: '', endTime: '' }, { startTime: '00:00', endTime: '23:59' }]) {
  assert.deepEqual(dashboardRangeQuery({ ...range, ...times }), { startDate: range.startDate, endDate: range.endDate })
}
assert.deepEqual(dashboardRangeQuery({ startDate: '', endDate: '', startTime: '', endTime: '' }), { startDate: '', endDate: '' })
assert.equal(dashboardRangeQuery({ ...range, startTime: '', endTime: '02:00' }).createdFrom, '2026-09-18 17:00:00')
for (const invalid of [{ ...range, startDate: '2026-02-30' }, { ...range, endDate: '' }, { ...range, endDate: range.startDate }, { ...range, startTime: '24:00' }]) assert.throws(() => dashboardRangeQuery(invalid))

const source = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('Dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function findVariable(name: string): string {
  let result = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.initializer!.getText(tree); ts.forEachChild(node, visit) }
  visit(tree); assert.ok(result, name); return result
}
function evaluate(expression: string, env: Record<string, any>): any {
  const code = ts.transpileModule(`return (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('env', `with(env){${code}}`)(env)
}
function effectContaining(fragment: string): string {
  let result = ''
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes(fragment)) result = node.arguments[0].getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree); assert.ok(result, fragment); return result
}
// Execute the actual preference functions with real range validation.
const names = ['validDashboardCustomDates', 'normalizeDashboardRangeId', 'todayDashboardFilterPrefs', 'readDashboardFilterPrefs', 'resolveDashboardFilterRange', 'dashboardPrefsForSelection']
const helpers = tree.statements.filter((n) => ts.isFunctionDeclaration(n) && names.includes(n.name!.text)).map((n) => n.getText(tree)).join('\n')
const stored = new Map<string, string>()
const prefEnv: any = { dashboardRangeQuery, window: { localStorage: { getItem: (key: string) => stored.get(key) ?? null } }, todayStr: () => '2026-09-20', statsPresetRange: () => ({ startDate: '2026-09-20', endDate: '2026-09-20' }) }
const prefsCode = ts.transpileModule(helpers + `\nreturn {${names.join(',')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const prefs = new Function('env', `with(env){${prefsCode}}`)(prefEnv)
const selected = prefs.dashboardPrefsForSelection(range, 'custom')
stored.set('actor-A', JSON.stringify(selected))
assert.deepEqual(prefs.resolveDashboardFilterRange(prefs.readDashboardFilterPrefs('actor-A')), range)
assert.equal(prefs.readDashboardFilterPrefs('actor-B').rangeId, 'today')
stored.set('old', JSON.stringify({ version: 2, rangeId: 'custom', customStart: range.startDate, customEnd: range.endDate }))
assert.deepEqual(prefs.resolveDashboardFilterRange(prefs.readDashboardFilterPrefs('old')), { ...range, startTime: '', endTime: '' })
assert.equal(prefs.dashboardPrefsForSelection({ ...range, endDate: range.startDate }, 'custom'), null)

function deferred() { let resolve!: (value: any) => void; let reject!: (reason: any) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness() {
  const calls: Array<{ method: string; query: any }> = []
  const writes: Array<{ kind: string; value: any }> = []
  let response: Promise<any> = Promise.resolve({ summary: { marker: 'summary' }, analytics: { marker: 'analytics' }, items: [{ id: 1 }], truncated: false })
  const env: any = {
    dashboardScope: 'actor-A:range-A', dashboardScopeRef: { current: 'actor-A:range-A' },
    startupRequestRef: { current: 0 }, summaryRequestRef: { current: 0 }, analyticsRequestRef: { current: 0 }, refreshRequestRef: { current: 0 },
    insightRequestRef: { current: {} }, startupLoadingRef: { current: false }, startupAttemptedRef: { current: false }, analyticsLoadingRef: { current: false },
    useCallback: (fn: any) => fn, beginTrackedRequest, isTrackedRequestCurrent, invalidateTrackedRequest,
    getCurrentDashboardRange: () => ({ ...query, granularity: 'day' }),
    getDashboardApi: () => Object.fromEntries(['getDashboardStartup', 'getDashboard', 'getAnalytics', 'getDashboardInsightList'].map((method) => [method, (q: any) => { calls.push({ method, query: q }); return response }])),
    withLoaderTimeout: (fn: () => any) => fn(), DASHBOARD_STARTUP_TIMEOUT_MS: 1, DASHBOARD_SUMMARY_TIMEOUT_MS: 1, DASHBOARD_ANALYTICS_TIMEOUT_MS: 1,
    isDashboardSummaryPayload: () => true, isDashboardAnalyticsPayload: () => true, normalizeDashboardSummaryPayload: (value: any) => value, normalizeDashboardAnalyticsPayload: (value: any) => value,
    isInvalidSessionError: () => false, getErrorMessage: (error: Error) => error.message, invalidateStockAlertPageRequests() {},
    setSummary: (value: any) => writes.push({ kind: 'summary', value }), setAnalytics: (value: any) => writes.push({ kind: 'analytics', value }),
    setSummaryError: (value: any) => writes.push({ kind: 'summaryError', value }), setAnalyticsError: (value: any) => writes.push({ kind: 'analyticsError', value }),
    setLoading: (value: any) => writes.push({ kind: 'loading', value }), setAnalyticsLoading: (value: any) => writes.push({ kind: 'analyticsLoading', value }),
    setInsightLists: (fn: any) => writes.push({ kind: 'insights', value: fn({}) }),
  }
  return { env, calls, writes, setResponse: (value: Promise<any>) => { response = value }, loader: (name: string) => evaluate(findVariable(name), env) }
}
for (const name of ['loadDashboardStartup', 'loadSummary', 'loadAnalytics', 'loadInsightList']) {
  const h = harness()
  await h.loader(name)(name === 'loadInsightList' ? 'recent_sales' : undefined)
  assert.deepEqual(h.calls[0].query, { ...query, granularity: 'day', ...(name === 'loadInsightList' ? { insight: 'recent_sales' } : {}) })
  const late = deferred(); h.setResponse(late.promise)
  const pending = h.loader(name)(name === 'loadInsightList' ? 'recent_sales' : undefined)
  h.writes.length = 0
  h.env.dashboardScopeRef.current = 'actor-A:range-B'
  h.env.startupLoadingRef.current = true
  late.resolve({ summary: {}, analytics: {}, items: [], truncated: false })
  await pending
  assert.deepEqual(h.writes, [], `${name}: old range cannot write results/errors/loading state`)
  assert.equal(h.env.startupLoadingRef.current, true, 'old startup finally cannot release new range startup')
  h.env.dashboardScopeRef.current = h.env.dashboardScope
  const failure = deferred(); h.setResponse(failure.promise)
  const failing = h.loader(name)(name === 'loadInsightList' ? 'recent_sales' : undefined)
  h.writes.length = 0; h.env.dashboardScopeRef.current = 'actor-B:range-A'
  failure.reject(new Error('old account/window failure')); await failing
  assert.deepEqual(h.writes, [], `${name}: delayed failure cannot overwrite the new range or actor`)
}
const switching = harness(); const startup = deferred(); switching.setResponse(startup.promise)
switching.env.loadingScopeRef = { current: 'actor-A:range-A' }
const oldStartup = switching.loader('loadDashboardStartup')()
switching.env.dashboardScopeRef.current = 'actor-A:range-B'
const requested: string[] = []
Object.assign(switching.env, { isActive: true, summary: null, analytics: null,
  loadSummary: () => requested.push('summary'), loadAnalytics: () => requested.push('analytics'), loadDashboardStartup: () => requested.push('startup'),
})
for (const setter of ['setSilentRefresh', 'setKpiDetail', 'setCustomerDetail', 'setProductDetail', 'setRecentSaleDetail', 'setRecentSalesOpen', 'setTopProductsListOpen', 'setTopCustomersListOpen', 'setBranchPerformanceListOpen', 'setBestHourListOpen', 'setExportChoicesOpen']) switching.env[setter] = () => {}
const loadEffect = effectContaining('void loadSummary({')
evaluate(loadEffect, switching.env)()
assert.deepEqual(requested, [], 'negative control: unfinished startup would suppress the new range')
evaluate(effectContaining('setKpiDetail(null)'), switching.env)()
switching.writes.length = 0
evaluate(loadEffect, switching.env)()
evaluate(effectContaining('void loadAnalytics({'), switching.env)()
assert.deepEqual(requested, ['summary', 'analytics'], 'actual range-reset effect permits both replacement loaders before old startup ends')
startup.resolve({ summary: {}, analytics: {} }); await oldStartup
assert.deepEqual(switching.writes, [])
const newer = harness(); const first = deferred(); const second = deferred()
newer.setResponse(first.promise); const oldList = newer.loader('loadInsightList')('top_products')
newer.setResponse(second.promise); const newList = newer.loader('loadInsightList')('top_products')
newer.writes.length = 0
second.resolve({ items: [{ id: 'new' }], truncated: false }); await newList
first.resolve({ items: [{ id: 'old' }], truncated: false }); await oldList
assert.equal(newer.writes.length, 1)
assert.equal(newer.writes[0].value.top_products.items[0].id, 'new')
assert.equal(evaluate(findVariable('summary'), { summarySnapshot: { scope: 'old', data: { total: 9 } }, dashboardScope: 'new' }), null, 'old totals masked before effects/render/export')
assert.equal(evaluate(findVariable('analytics'), { analyticsSnapshot: { scope: 'old', data: { total: 9 } }, dashboardScope: 'new' }), null)
for (const rangePending of [true, false]) {
  const state = { rangePending, loading: false, aLoading: false, summaryReady: false, analyticsReady: false }
  assert.equal(evaluate(findVariable('summaryUnavailable'), state), !rangePending, 'new range is pending, settled failure remains unavailable')
  assert.equal(evaluate(findVariable('analyticsUnavailable'), state), !rangePending)
  assert.equal(evaluate(findVariable('analyticsPending'), state), rangePending)
}

// Actual transport functions retain every bound in both URL and cache identity.
const transportSource = fs.readFileSync(new URL('../src/api/dashboardTransport.ts', import.meta.url), 'utf8')
const transportModule = { exports: {} as any }
const keys: string[] = []; const urls: string[] = []
const queryModule = await import('../src/api/query.ts')
const transportCode = ts.transpileModule(transportSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
new Function('require', 'module', 'exports', transportCode)((name: string) => name.includes('query') ? queryModule : { route: (key: string, fn: () => any) => { keys.push(key); return fn() }, apiFetch: async (_method: string, url: string) => { urls.push(url); return { items: [] } } }, transportModule, transportModule.exports)
for (const method of ['getDashboard', 'getAnalytics', 'getDashboardStartup', 'getDashboardInsightList']) {
  await transportModule.exports[method]({ ...query, insight: 'recent_sales' })
  await transportModule.exports[method]({ ...query, createdFrom: '2026-09-19 16:00:00', insight: 'recent_sales' })
  assert.notEqual(keys.at(-1), keys.at(-2))
  assert.equal(new URL(urls.at(-2)!, 'https://test').searchParams.get('createdTo'), query.createdTo)
}
console.log('PASS Dashboard continuous UTC+7/report parity, persistence, four actual loaders, stale responses, synchronous masking and transport cache identity')
