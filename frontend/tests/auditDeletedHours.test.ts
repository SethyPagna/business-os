import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { continuousRangeParams } from '../src/utils/continuousRangeParams.ts'
import { auditFilterKey, auditWindowWasCut, buildAuditRequestParams, initialAuditViewState, setAuditPreset } from '../src/utils/auditLogView.ts'

const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
function callback(source: string, begin: string, endMarker: string, name: string, context: Record<string, unknown>) {
  const from = source.indexOf(begin), to = source.indexOf(endMarker, from)
  assert.ok(from >= 0 && to > from)
  return new Function('ctx', `with(ctx){${transformSync(source.slice(from, to), { loader: 'tsx', target: 'es2022' }).code};return ${name}}`)(context)
}

test('actual Audit loader and Load more retain continuous endpoints and hour-only cursor identity changes', async () => {
  const source = read('components/utils-settings/AuditLog.tsx')
  const view = { ...initialAuditViewState(), preset: 'custom' as const, rangeStart: '2026-09-05', rangeEnd: '2026-09-05', rangeStartTime: '09:00', rangeEndTime: '11:00' }
  const params = buildAuditRequestParams(view, { today: '2026-10-01' }), sent: any[] = []
  const context = { useCallback: (fn: unknown) => fn, params, filterKey: auditFilterKey(view, '2026-10-01'), view, today: '2026-10-01', auditWindowWasCut, buildAuditRequestParams, aliveRef: { current: true }, loadedOnceRef: { current: false }, loadedKeyRef: { current: '' }, loadRequestRef: { current: 0 }, loadWatchdogRef: { current: null }, nextCursor: 'cursor', loading: false, loadingMore: false,
    beginTrackedRequest: (ref: any) => ++ref.current, isTrackedRequestCurrent: (ref: any, id: number) => ref.current === id, withLoaderTimeout: (fn: () => unknown) => fn(), window: { clearTimeout() {}, setTimeout() { return 1 } }, setLogs() {}, setLoadingMore() {}, setLoading() {}, setError() {}, setWindowCut() {}, setNextCursor() {}, setHasMore() {}, setUserCounts() {}, setSectionCounts() {}, setHasLoadedOnce() {}, mergeAuditRows: (_: unknown, rows: unknown) => rows, AUDIT_LOG_LOAD_TIMEOUT_MS: 1000, getErrorMessage: String,
    getAuditLogsRequest: async (query: any) => { sent.push(query); return { items: [], hasMore: false } } }
  await callback(source, '  const load = useCallback(', '\n\n  const loadMore', 'load', context)(true)
  await callback(source, '  const loadMore = useCallback(', '\n\n  useEffect', 'loadMore', context)()
  assert.equal(sent[0].createdFrom, '2026-09-05 02:00:00'); assert.equal(sent[0].createdTo, '2026-09-05 04:01:00')
  assert.equal(sent[1].createdFrom, sent[0].createdFrom); assert.equal(sent[1].cursor, 'cursor'); assert.equal(sent[1].counts, undefined)
  assert.notEqual(auditFilterKey(view, '2026-10-01'), auditFilterKey({ ...view, rangeStartTime: '12:00', rangeEndTime: '13:00' }, '2026-10-01'))
  assert.equal(buildAuditRequestParams(setAuditPreset(view, 'today', '2026-10-01'), { today: '2026-10-01' }).createdFrom, undefined, 'date presets reset to original full day')
})

test('actual deleted-ledger effect forwards hours, handles invalid bounds, and refreshes on hour-only edits', async () => {
  const source = read('components/review/LegacyDeletedSalesSection.tsx'), ast = ts.createSourceFile('ledger.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect = '', dependencies = ''
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('getLegacyDeletedSales')) { effect = node.arguments[0].getText(ast); dependencies = node.arguments[1].getText(ast) }
    ts.forEachChild(node, visit)
  }; visit(ast); assert.ok(effect)
  let sent: any, error = ''
  const context = { continuousRangeParams, search: '', cashier: 'all', fromDate: '2026-09-05', toDate: '2026-09-05', startTime: '09:00', endTime: '11:00', page: 1, pageSize: 20, refreshToken: 0, aliveRef: { current: true }, requestRef: { current: 0 }, clampPage: (page: number) => page, setPage() {}, setData() {}, setLoading() {}, setError: (value: string) => { error = value }, tr: (_: string, fallback: string) => fallback, getLegacyDeletedSales: async (query: any) => { sent = query; return { items: [], total_lines: 0 } } }
  const compiled = transformSync(`const effect=${effect}`, { loader: 'tsx', target: 'es2022' }).code
  new Function('ctx', `with(ctx){${compiled};effect()}`)(context); await new Promise(setImmediate)
  assert.equal(sent.createdFrom, '2026-09-05 02:00:00'); assert.equal(sent.createdTo, '2026-09-05 04:01:00'); assert.equal(sent.from, '2026-09-05'); assert.equal(error, '')
  assert.match(dependencies, /startTime/); assert.match(dependencies, /endTime/)
  new Function('ctx', `with(ctx){${compiled};effect()}`)({ ...context, startTime: '12:00', endTime: '13:00' }); await new Promise(setImmediate)
  assert.equal(sent.createdFrom, '2026-09-05 05:00:00')
  new Function('ctx', `with(ctx){${compiled};effect()}`)({ ...context, startTime: '18:00', endTime: '09:00' }); await new Promise(setImmediate)
  assert.match(error, /ordered date\/time/)
})

test('both surfaces expose the shared continuous hour picker including the Audit preset view', () => {
  const audit = read('components/utils-settings/AuditLog.tsx'), legacy = read('components/review/LegacyDeletedSalesSection.tsx')
  assert.doesNotMatch(audit, /\{view\.preset === 'custom' \? \(\s*<StatsRangeRow/)
  for (const source of [audit, legacy]) assert.match(source, /showTime\s+continuous/)
})
