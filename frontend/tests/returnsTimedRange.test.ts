import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { returnRangeParams } from '../src/api/returnsReadTransport.ts'
import { reportQueryParams, REPORT_VIEWS } from '../src/components/sales/reports/reportModel.ts'

const range = { startDate: '2026-09-20', endDate: '2026-09-21', startTime: '22:00', endTime: '02:00' }
const exact = returnRangeParams(range)
assert.deepEqual(exact, { startDate: range.startDate, endDate: range.endDate, createdFrom: '2026-09-20 15:00:00', createdTo: '2026-09-20 19:01:00' })
const report = reportQueryParams({ ...range, branchId: '', status: '', paymentMethod: '' }, REPORT_VIEWS.find(view => view.id === 'returns')!)
assert.equal(exact.createdFrom, report.createdFrom); assert.equal(exact.createdTo, report.createdTo)
assert.deepEqual(returnRangeParams({ ...range, startTime: '00:00', endTime: '23:59' }), { startDate: range.startDate, endDate: range.endDate })
assert.deepEqual(returnRangeParams({ startDate: '', endDate: '', startTime: '', endTime: '' }), { startDate: undefined, endDate: undefined })
for (const invalid of [{ ...range, endDate: range.startDate }, { ...range, startDate: '' }, { ...range, startTime: '25:00' }, { ...range, startDate: '2026-02-30' }]) assert.throws(() => returnRangeParams(invalid), RangeError)

const require = createRequire(import.meta.url)
const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const compile = (source: string) => ts.transpileModule(source, { fileName: 'fixture.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const channels: string[] = [], paths: string[] = []
const transport = { exports: {} as any }
new Function('exports', 'require', 'module', compile(read('api/returnsReadTransport.ts')))(transport.exports, (id: string) => {
  if (id === './http.ts') return {
    route: (key: string, work: () => unknown) => { channels.push(key); return work() },
    apiFetch: async (_method: string, path: string) => { paths.push(path); return [] },
  }
  if (id === './query.ts') return require('../src/api/query.ts')
  if (id.includes('businessTimeBounds')) return require('../src/utils/businessTimeBounds.ts')
  throw new Error(id)
}, transport)
await transport.exports.getReturns(exact)
await transport.exports.getReturns(returnRangeParams({ ...range, startTime: '23:00' }))
await transport.exports.getReturnsReport(exact)
await transport.exports.getReturnsReport(returnRangeParams({ ...range, startTime: '23:00' }))
assert.notEqual(channels[0], channels[1]); assert.notEqual(channels[2], channels[3])
assert.ok(paths.every(path => path.includes('createdFrom=') && path.includes('createdTo=')))

// Execute the actual page's memo, fetch callbacks, pagination reset and export
// menu handlers. Range conversion occurs within request try/catch, not render.
const page = read('components/returns/Returns.tsx')
const ast = ts.createSourceFile('Returns.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function nodes(predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(ast); return found
}
function variable(name: string): string {
  const node = nodes(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)[0] as ts.VariableDeclaration
  assert.ok(node?.initializer, name); return node.initializer.getText(ast)
}
const evaluate = (source: string, scope: Record<string, unknown>) => new Function(...Object.keys(scope), compile(`return (${source})`))(...Object.values(scope))
let rows: any[] = [], stats: any, pageNumber = 4, exportDialog: any, error: any
let capturedDependencies: unknown[] = []
let suppliedRows = [{ id: 1 }]
const hooks = { useMemo: (fn: () => unknown, deps: unknown[]) => { capturedDependencies = deps; return fn() }, useCallback: (fn: unknown) => fn }
const base = {
  ...hooks, returnRangeParams, scope: 'customer', debouncedSearch: '', isActive: true,
  clearLoadWatchdog: () => {}, loadPromiseRef: { current: null }, returnsRequestRef: {}, loadedOnceRef: { current: true },
  beginTrackedRequest: () => 1, isTrackedRequestCurrent: () => true, RETURNS_LOAD_TIMEOUT_MS: 100,
  setLoading: () => {}, setLoadError: (value: unknown) => { error = value },
  withLoaderTimeout: (work: () => unknown) => work(), fetchReturns: async (params: unknown) => { assert.deepEqual(params, { scope: 'customer', ...returnRangeParams(currentRange) }); return suppliedRows },
  setRows: (value: any[]) => { rows = value }, stripRequestRef: { current: 0 }, setStripLoading: () => {},
  getReturnsReport: async (params: unknown) => { assert.deepEqual(params, { scope: 'customer', ...returnRangeParams(currentRange) }); return { count: suppliedRows.length } },
  setStripData: (value: unknown) => { stats = value }, tr: (key: string) => key,
}
let currentRange = range
const makeRange = () => evaluate(variable('returnsDateRange'), { ...hooks, stripRange: currentRange })
const resetEffect = nodes(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
  && node.arguments[0]?.getText(ast).includes('setReturnPage(1)'))[0] as ts.CallExpression
assert.ok(resetEffect)
assert.match(resetEffect.arguments[1].getText(ast), /returnsDateRange/)
const firstRange = makeRange(), firstDeps = capturedDependencies
for (const time of ['22:00', '23:00']) {
  currentRange = { ...range, startTime: time }
  suppliedRows = [{ id: time === '22:00' ? 1 : 2 }]
  const returnsDateRange = makeRange()
  if (time === '23:00') assert.notDeepEqual(capturedDependencies, firstDeps, 'time-only edits invalidate the range memo')
  await evaluate(variable('loadReturns'), { ...base, returnsDateRange })()
  await evaluate(variable('loadStatsStrip'), { ...base, returnsDateRange })()
  assert.deepEqual(rows, suppliedRows); assert.equal(stats.count, 1)
  evaluate(resetEffect.arguments[0].getText(ast), { setReturnPage: (value: number) => { pageNumber = value } })()
  assert.equal(pageNumber, 1)
  const exportVisible = evaluate(variable('exportVisible'), { ...hooks, canExportReturns: true, visibleReturns: rows,
    notify: () => { throw Error('unexpected export rejection') }, tr: (key: string) => key,
    exportReturnRows: (value: unknown) => value, setExportDialog: (value: unknown) => { exportDialog = value } })
  const items = evaluate(variable('exportItems'), { ...hooks, tr: (key: string) => key, exportVisible,
    visibleReturns: rows, selectedReturns: [], exportSelected: () => {}, typeFilter: 'all', typeOptions: [],
    stripRange: currentRange, filtered: rows, scope: 'customer', CUSTOMER_SCOPE: 'customer', supplierRows: [], customerRows: rows })
  await items.find((item: any) => item.label === 'export_filtered_time_range').onClick()
  assert.deepEqual(exportDialog, { rows: suppliedRows, baseName: 'returns-filtered' }, 'filtered export follows the new timed response, retaining loaded-row export semantics')
}
currentRange = { ...range, startDate: '' }
const invalidDraft = makeRange() // must not throw during render
const originalError = console.error
try {
  console.error = () => {}
  await evaluate(variable('loadReturns'), { ...base, returnsDateRange: invalidDraft })()
  await evaluate(variable('loadStatsStrip'), { ...base, returnsDateRange: invalidDraft })()
} finally { console.error = originalError }
assert.ok(error); assert.equal(stats, null)
assert.deepEqual(firstRange, range)
assert.match(page, /range=\{stripRange\}[\s\S]{0,100}showTime\s+continuous/)
console.log('PASS Returns continuous times: Reports parity, cache identity, actual page request/reset/export flow, safe invalid drafts')
