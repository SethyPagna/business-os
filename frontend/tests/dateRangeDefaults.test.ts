import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { statsPresetRange } from '../src/components/shared/statsStripPresets.ts'
import { buildInventoryProductsSearchParams } from '../src/components/inventory/inventoryProductsQuery.ts'
import { withDashboardRangeScope } from '../src/api/dashboardTransport.ts'
import { buildQueryString } from '../src/api/query.ts'

// Execute the production initializers, preference functions and request
// expressions. No duplicate date-policy implementation lives in the fixture.
const read = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
const parse = (source: string) => ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(source: string, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(parse(source))
  return found
}
function variable(source: string, name: string): string {
  const node = find(source, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name)[0] as ts.VariableDeclaration
  assert.ok(node?.initializer, `production variable ${name} exists`)
  return node.initializer.getText()
}
function fn(source: string, name: string): string {
  const node = find(source, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0]
  assert.ok(node, `production function ${name} exists`)
  return node.getText()
}
function evaluate(code: string, context: Record<string, unknown> = {}) {
  const compiled = transformSync(`return (${code})`, { loader: 'tsx', format: 'cjs' }).code
  return new Function(...Object.keys(context), compiled)(...Object.values(context))
}
function requestArgs(source: string, callee: string): string[] {
  return find(source, (node) => ts.isCallExpression(node) && node.expression.getText().endsWith(callee))
    .map((node) => (node as ts.CallExpression).arguments[0].getText())
}
const hooks = { useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn }
let now = new Date(2026, 8, 11, 12)
const preset = (id: Parameters<typeof statsPresetRange>[0]) => statsPresetRange(id, now)
const dashboard = read('dashboard/Dashboard.tsx')
const store = new Map<string, string>()
const storageReads: string[] = []
const windowMock = { localStorage: {
  getItem: (key: string) => { storageReads.push(key); return store.get(key) ?? null },
  setItem: (key: string, value: string) => { store.set(key, value) },
} }
const helperNames = ['getDashboardFilterStorageKey', 'todayDashboardFilterPrefs', 'validDashboardCustomDates',
  'readDashboardFilterPrefs', 'normalizeDashboardRangeId', 'resolveDashboardFilterRange', 'dashboardPrefsForSelection']
const helperCode = transformSync(`${helperNames.map((name) => fn(dashboard, name)).join('\n')}; return { ${helperNames.join(',')} }`, { loader: 'ts', format: 'cjs' }).code
const helpers = new Function('window', 'DASHBOARD_FILTER_STORAGE_PREFIX', 'statsPresetRange', 'todayStr', helperCode)(
  windowMock, 'bos_dashboard_filters:', preset, () => preset('today').startDate,
)
const key = helpers.getDashboardFilterStorageKey({ id: 17 })
const day1 = '2026-09-11'
const day2 = '2026-09-12'
const expectDates = (range: any, start: string, end = start) => {
  assert.equal(range.startDate, start)
  assert.equal(range.endDate, end)
}
const persistence = find(dashboard, (node) => ts.isCallExpression(node) && node.expression.getText() === 'useEffect'
  && node.arguments[0]?.getText().includes('JSON.stringify(filterPrefs)'))[0] as ts.CallExpression
assert.ok(persistence, 'production account preference persistence effect exists')
function persist(prefs: unknown, storageKey = key) {
  evaluate(persistence.arguments[0].getText(), { window: windowMock, filterPrefs: prefs, dashboardFilterStorageKey: storageKey })()
}
function selectDashboard(range: unknown, source?: string) {
  let state: any
  evaluate(variable(dashboard, 'handleDashboardRangeChange'), {
    ...hooks, dashboardPrefsForSelection: helpers.dashboardPrefsForSelection,
    dashboardFilterStorageKey: key, setFilterSelection: (next: unknown) => { state = next },
  })(range, source)
  assert.equal(state.storageKey, key)
  return state.prefs
}
function reload() { return helpers.readDashboardFilterPrefs(key) }
const invalidPrefs = [null, 'broken json', '{}', '[]', 'null', '{"rangeId":"invalid"}',
  '{"rangeId":"90d"}', '{"rangeId":"custom","customStart":"","customEnd":""}',
  '{"rangeId":"all"}', '{"rangeId":"custom","customStart":"2026-09-11","customEnd":"2026-09-11"}',
  '{"version":3,"rangeId":"all"}', '{"version":2,"rangeId":"custom","customStart":"2026-02-30","customEnd":"2026-03-01"}',
  '{"version":2,"rangeId":"custom","customStart":"2026-09-12","customEnd":"2026-09-11"}',
  '{"version":2,"rangeId":"custom","customStart":"2026-09-11","customEnd":""}',
  '{"version":2,"rangeId":"custom","customStart":"2026-9-11","customEnd":"2026-09-11"}']
for (const raw of invalidPrefs) {
  now = new Date(2026, 8, 11, 12)
  store.clear()
  if (raw !== null) store.set(key, raw)
  const prefs = reload()
  assert.equal(prefs.rangeId, 'today', String(raw))
  expectDates(helpers.resolveDashboardFilterRange(prefs), day1)
  persist(prefs)
  assert.equal(JSON.parse(store.get(key)!).rangeId, 'today', 'automatic Today is never serialized as custom')
  now = new Date(2026, 8, 12, 12)
  expectDates(helpers.resolveDashboardFilterRange(reload()), day2)
}
for (const rangeId of ['today', 'yesterday', '7d', '30d', 'week', 'month', 'year', 'all'] as const) {
  now = new Date(2026, 8, 11, 12)
  persist(selectDashboard(preset(rangeId), rangeId))
  now = new Date(2026, 8, 12, 12)
  const prefs = reload()
  assert.equal(prefs.rangeId, rangeId)
  assert.deepEqual(helpers.resolveDashboardFilterRange(prefs), { ...preset(rangeId), startTime: '', endTime: '' })
}
// An explicit fixed custom day equal to Today must NOT become relative.
now = new Date(2026, 8, 11, 12)
persist(selectDashboard(preset('today'), 'custom'))
now = new Date(2026, 8, 12, 12)
assert.equal(reload().rangeId, 'custom')
expectDates(helpers.resolveDashboardFilterRange(reload()), day1)
assert.equal(helpers.dashboardPrefsForSelection({ startDate: '', endDate: '' }, 'custom'), null)
assert.equal(helpers.dashboardPrefsForSelection({ startDate: '2026-02-30', endDate: '2026-03-01' }), null)
// A trusted legacy named selection retains identity through migration, while
// equal dates cannot collapse a named Month into a rolling 30-day selection.
store.set(key, JSON.stringify({ rangeId: 'month', customStart: '', customEnd: '' }))
persist(reload())
assert.equal(reload().rangeId, 'month')
now = new Date(2026, 3, 30, 12)
assert.deepEqual(preset('month'), preset('30d'))
persist(selectDashboard(preset('month'), 'month'))
now = new Date(2026, 4, 1, 12)
expectDates(helpers.resolveDashboardFilterRange(reload()), '2026-05-01')
store.set('bos_dashboard_filters:last', JSON.stringify({ version: 2, rangeId: 'all' }))
store.set('bos_dashboard_filters:guest', JSON.stringify({ version: 2, rangeId: 'all' }))
storageReads.length = 0
assert.equal(helpers.readDashboardFilterPrefs(helpers.getDashboardFilterStorageKey({ id: 18 })).rangeId, 'today')
assert.equal(helpers.readDashboardFilterPrefs(helpers.getDashboardFilterStorageKey(null)).rangeId, 'today')
assert.deepEqual(storageReads, ['bos_dashboard_filters:18'], 'no unowned fallback or guest preference is read')
const currentAccountPrefs = evaluate(variable(dashboard, 'filterPrefs'), {
  filterSelection: { storageKey: key, prefs: { version: 2, rangeId: 'all' } },
  dashboardFilterStorageKey: 'bos_dashboard_filters:18', initialFilterPrefs: helpers.todayDashboardFilterPrefs(),
})
assert.equal(currentAccountPrefs.rangeId, 'today', 'account change masks previous selection before effects')
console.log('PASS Dashboard preference validation, account isolation, and two-business-day round trips')

const pages = [
  ['sales/Sales.tsx', '[stripRange, setStripRange]'],
  ['returns/Returns.tsx', '[stripRange, setStripRange]'],
  ['fees/FeesPage.tsx', '[stripRange, setStripRange]'],
  ['branches/BranchesHubPage.tsx', '[sharedDateRange, setSharedDateRange]'],
  ['branches/Branches.tsx', '[localBranchDateRange, setLocalBranchDateRange]'],
  ['inventory/Inventory.tsx', '[localStripRange, setLocalStripRange]'],
] as const
for (const [file, stateName] of pages) {
  now = new Date(2026, 8, 11, 12)
  let current: any
  const useState = (init: () => unknown) => { current = init(); return [current, (next: unknown) => { current = next }] }
  const [, select] = evaluate(variable(read(file), stateName), { useState, todayDateTimeRange: () => preset('today'), statsPresetRange: preset })
  expectDates(current, day1)
  select(preset('all'))
  expectDates(current, '')
}

// Evaluate the actual first request expressions with the selected production
// state. URL serialization proves All time drops both bounds in list APIs.
const common = { search: '', debouncedSearch: '', typeFilter: 'all', scope: 'customer', branchFilter: '',
  page: 1, pageSize: 20, exportPage: 1, exportPageSize: 500, transferPage: 1, transferPageSize: 20, transferFromFilter: 'all', transferToFilter: 'all',
  deferredSearch: '', searchMode: 'auto', productsPage: 1, productsPageSize: 20 }
for (const range of [preset('today'), preset('all')]) {
  const bounded = !!range.startDate
  const checkWire = (params: any, start = 'startDate', end = 'endDate') => {
    const wire = new URLSearchParams(buildQueryString(params))
    assert.equal(wire.get(start), bounded ? day1 : null)
    assert.equal(wire.get(end), bounded ? day1 : null)
  }
  for (const [file, memo] of [['sales/Sales.tsx', 'salesDateRange'], ['returns/Returns.tsx', 'returnsDateRange']] as const) {
    checkWire(evaluate(variable(read(file), memo), { ...hooks, stripRange: range }))
  }
  for (const params of requestArgs(read('fees/FeesPage.tsx'), 'getFeesRequest')) {
    checkWire(evaluate(params, { ...common, stripRange: range }), 'from', 'to')
  }
  for (const params of requestArgs(read('branches/Branches.tsx'), 'getTransfers')) {
    checkWire(evaluate(params, { ...common, branchDateRange: range, pageSize: 500 }))
  }
  const inventoryParams = requestArgs(read('inventory/Inventory.tsx'), 'buildInventoryProductsSearchParams')[0]
  checkWire(buildInventoryProductsSearchParams(evaluate(inventoryParams, { ...common, stripRange: range })))
  for (const [file, endpoint] of [['returns/Returns.tsx', 'getReturnsReport'], ['fees/FeesPage.tsx', 'getFeesReport']] as const) {
    checkWire(evaluate(requestArgs(read(file), endpoint)[0], { ...common, stripRange: range }))
  }
  const canonical = evaluate(variable(dashboard, 'getCurrentDashboardRange'), { ...hooks, customStart: range.startDate, customEnd: range.endDate })()
  for (const endpoint of ['getDashboardStartup', 'getDashboard', 'getAnalytics']) {
    const params = evaluate(requestArgs(dashboard, endpoint)[0], { ...canonical, gran: canonical.granularity })
    const wire = withDashboardRangeScope(params)
    expectDates(wire, bounded ? day1 : '')
    assert.equal(wire.rangeScope, bounded ? undefined : 'all')
  }
}
console.log('PASS six page initializers and first list/stat/export request bounds; Dashboard startup/summary/analytics parity')

// Execute the source-aware rail callback, including colliding presets.
const require = createRequire(import.meta.url)
const mod = { exports: {} as any }
const railCode = transformSync(read('shared/StatsRangeRow.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', railCode)((id: string) => {
  if (id.includes('DateTimeRangePicker')) return () => null
  if (id.includes('statsStripPresets')) return require('../src/components/shared/statsStripPresets.ts')
  return require(id)
}, mod, mod.exports)
let selection: any
const rail = mod.exports.default({ range: preset('today'), t: (key: string) => key,
  onRangeChange: (range: unknown, source: string) => { selection = { range, source } } })
for (const button of rail.props.children[1].props.children) {
  button.props.onClick()
  assert.equal(selection.source, button.key)
}
const picker = read('shared/DateTimeRangePicker.tsx')
const manual = evaluate(variable(picker, 'apply'), {
  value: preset('today'), continuous: false, setRangeInvalid: () => {}, onChange: (range: unknown, source: string) => { selection = { range, source } },
})
manual({ startDate: day1, endDate: day1 })
assert.equal(selection.source, 'custom')
assert.equal(helpers.dashboardPrefsForSelection(selection.range, selection.source).rangeId, 'custom')

const inventory = read('inventory/Inventory.tsx')
const cards = [{ key: 'products', value: 17 }, { key: 'stock-value', value: 80 },
  { key: 'revenue', value: 100, sub: 'Profit 20', details: [{ value: 100 }] }]
const masked = evaluate(variable(inventory, 'displayedStripCards'), { stripCards: cards, stripHasRange: false })
assert.equal(masked[0].value, 17)
assert.equal(masked[1].value, 80)
assert.equal(masked[2].value, '—')
assert.equal(masked[2].details, undefined)
assert.equal(masked[2].sub, undefined)
let cleared = 0
let requested = 0
await evaluate(variable(inventory, 'loadStatsStrip'), { ...hooks, isActive: true, stripRange: preset('all'),
  stripRequestRef: { current: 2 }, setStripKernel: () => { cleared++ }, setStripCustomerReturns: () => { cleared++ },
  setStripSupplierReturns: () => { cleared++ }, setStripLoading: () => {}, getSalesStatsStrip: () => { requested++ },
})()
assert.equal(cleared, 3)
assert.equal(requested, 0)
const csvCall = find(inventory, (node) => ts.isCallExpression(node) && node.expression.getText() === 'downloadCSV'
  && node.arguments[0]?.getText().includes('inventory-stats-'))[0] as ts.CallExpression
const exportRows = evaluate(csvCall.arguments[1].getText(), { hasRange: false, startDate: '', endDate: '',
  totalProducts: 17, inStockCount: 10, lowStockCount: 3, outStockCount: 4, totalValue: 80,
  totals: { revenue_usd: 999 }, cust: { count: 999 }, supp: { count: 999 },
})
assert.equal(exportRows.find((row: any) => row.metric === 'products_current').value, 17)
assert.equal(exportRows.find((row: any) => row.metric === 'revenue_usd').value, '—')
assert.equal(exportRows.find((row: any) => row.metric === 'range_start').value, 'all')
assert.equal(evaluate(variable(read('sales/Sales.tsx'), 'stripStatus'), {
  stripAvailable: true, stripHasRange: false, stripSnapshot: { status: 'ready', data: { revenue_usd: 100 } },
}), 'no-range')
console.log('PASS explicit preset/manual identity and honest unsupported All-time statistics')
