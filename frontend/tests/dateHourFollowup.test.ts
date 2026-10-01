import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { continuousRangeParams } from '../src/utils/continuousRangeParams.ts'
import { buildQueryString, appendQuery } from '../src/api/query.ts'

const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')

function actualFunction(file: string, start: string, endMarker: string, name: string, context: Record<string, unknown>) {
  const source = read(file), begin = source.indexOf(start), end = source.indexOf(endMarker, begin)
  assert.ok(begin >= 0 && end > begin)
  const compiled = transformSync(source.slice(begin, end).replace('export function', 'function'), { loader: 'tsx', target: 'es2022' }).code
  return new Function('ctx', `with(ctx){${compiled};return ${name}}`)(context)
}

test('actual movement transport forwards exact bounds into the query and cache identity', async () => {
  const calls: string[] = [], channels: string[] = []
  const get = actualFunction('api/inventoryTransport.ts', 'export function getInventoryMovements(', '\nexport function getInventoryReasons', 'getInventoryMovements', {
    buildQueryString, appendQuery, route: (channel: string, send: () => unknown) => { channels.push(channel); return send() }, apiFetch: async (_: string, url: string) => { calls.push(url); return {} },
  })
  await get({ startDate: '2026-09-05', endDate: '2026-09-05', createdFrom: '2026-09-05 02:00:00', createdTo: '2026-09-05 04:01:00' })
  assert.equal(new URL(calls[0], 'https://local.invalid').searchParams.get('createdFrom'), '2026-09-05 02:00:00')
  assert.match(channels[0], /createdTo=/)
})

test('actual customer report callback sends paired recurring hours and retains optional date bounds', async () => {
  let sent: any
  const source = read('components/contacts/CustomerPurchasesReportModal.tsx'), begin = source.indexOf('  const load = useCallback('), end = source.indexOf('\n\n  useEffect', begin)
  const compiled = transformSync(source.slice(begin, end), { loader: 'tsx', target: 'es2022' }).code
  const context = { useCallback: (fn: unknown) => fn, customerId: 1, fromDate: '', toDate: '', startTime: '09:00', endTime: '11:00', page: 1, pageSize: 20, t: (key: string) => key, tr: (_: unknown, key: string) => key, requestRef: { current: 0 }, setLoading() {}, setError() {}, setResult() {}, getCustomerSalesReport: async (params: any) => { sent = params; return {} } }
  await new Function('ctx', `with(ctx){${compiled};return load}`)(context)()
  assert.equal(sent.startTime, '09:00')
  assert.equal(sent.endTime, '11:00')
  assert.equal(sent.startDate, undefined)
})

test('Fees range selects continuous timestamps and movement surface exposes the same continuous picker', () => {
  assert.match(read('components/fees/FeesPage.tsx'), /range=\{stripRange\}[\s\S]{0,100}showTime[\s\S]{0,80}continuous/)
  assert.match(read('components/inventory/InventoryMovementsSurface.tsx'), /showTime\s+continuous/)
})

test('Branch hub retains continuous endpoints when switching to Inventory and never mutates invalid overnight state', () => {
  const range = Object.freeze({ startDate: '2026-09-05', endDate: '2026-09-05', startTime: '22:00', endTime: '02:00' })
  assert.throws(() => continuousRangeParams(range), RangeError)
  assert.deepEqual(continuousRangeParams({ ...range, endDate: '2026-09-06' }), { startDate: '2026-09-05', endDate: '2026-09-06', createdFrom: '2026-09-05 15:00:00', createdTo: '2026-09-05 19:01:00' })
  assert.equal(range.endDate, '2026-09-05')
  const hub = read('components/branches/BranchesHubPage.tsx')
  assert.equal((hub.match(/dateRange=\{sharedDateRange\}/g) || []).length, 3)
  assert.equal((hub.match(/onDateRangeChange=\{setSharedDateRange\}/g) || []).length, 3)
})

test('actual movement export fetches changed hours with identical dates instead of exporting stale visible groups', async () => {
  let sent: any, exported: unknown
  const source = read('components/inventory/Inventory.tsx'), begin = source.indexOf('  const runRangedMovementExport = useCallback('), end = source.indexOf('\n\n', begin)
  const compiled = transformSync(source.slice(begin, end), { loader: 'tsx', target: 'es2022' }).code
  const context = {
    useCallback: (fn: unknown) => fn, continuousRangeParams, movementStartDate: '2026-09-05', movementEndDate: '2026-09-05', movementStartTime: '09:00', movementEndTime: '11:00', branchFilter: 'all', deferredSearch: '', searchMode: 'and', movFilter: 'all', movementUserFilter: 'all', notify() {}, tr: (_: string, fallback: string) => fallback, visibleMovementGroups: [{ id: 'stale' }], INVENTORY_MOVEMENTS_TIMEOUT_MS: 1000,
    getInventoryApi: () => ({ getInventoryMovements: async (params: any) => { sent = params; return { items: [{ id: 'latest' }], total: 1 } } }), withLoaderTimeout: (fn: () => unknown) => fn(), matchesMulti: () => true, buildMovementGroups: (items: unknown) => items, exportMovementGroups: async (items: unknown) => { exported = items },
  }
  await new Function('ctx', `with(ctx){${compiled};return runRangedMovementExport}`)(context)({ startDate: '2026-09-05', endDate: '2026-09-05', startTime: '12:00', endTime: '13:00' })
  assert.equal(sent.createdFrom, '2026-09-05 05:00:00')
  assert.equal(sent.createdTo, '2026-09-05 06:01:00')
  assert.deepEqual(exported, [{ id: 'latest' }])
})

test('actual Branch loader dispatches changed endpoints while pending and prevents stale state, with same-query dedup', async () => {
  const source = read('components/branches/Branches.tsx')
  const begin = source.indexOf('  const load = useCallback(async (silent = loadedOnceRef.current) => {')
  const end = source.indexOf('\n\n  useEffect', begin)
  assert.ok(begin > 0 && end > begin)
  const compiled = transformSync(source.slice(begin, end), { loader: 'tsx', target: 'es2022' }).code
  const create = new Function('ctx', `with(ctx){${compiled};return load}`)
  const requests: Array<{ params: any; resolve: (value: unknown) => void }> = []
  const state = { rows: [{ id: 7 }, { id: 8 }] }
  const shared = {
    useCallback: (fn: unknown) => fn, continuousRangeParams, loadedOnceRef: { current: true }, loadPromiseRef: { current: null }, loadPromiseModeRef: { current: '' }, loadPromiseKeyRef: { current: '' }, loadRequestRef: { current: 0 }, loadWatchdogRef: { current: null },
    tab: 'transfers', transferFromFilter: 'all', transferToFilter: 'all', transferPage: 1, transferPageSize: 20, BRANCHES_LIST_TIMEOUT_MS: 1000, BRANCH_TRANSFERS_TIMEOUT_MS: 1000,
    window: { clearTimeout() {}, setTimeout() { return 1 } }, tr: (_: string, fallback: string) => fallback, notify() {}, setLoading() {}, setLoadError() {}, setBranches() {}, setTransfers: (rows: any[]) => { state.rows = rows }, setTransferTotal() {}, isBranchRecord: () => true, isTransferRecord: () => true,
    beginTrackedRequest: (ref: any) => ++ref.current, isTrackedRequestCurrent: (ref: any, id: number) => ref.current === id, withLoaderTimeout: (fn: () => unknown) => fn(), getFirstLoaderError: () => '', getErrorMessage: String,
    settleLoaderMap: async (tasks: Record<string, () => unknown>) => ({ values: Object.fromEntries(await Promise.all(Object.entries(tasks).map(async ([key, fn]) => [key, await fn()]))), hasAnySuccess: true, errors: [] }),
    branchApi: { getBranches: async () => [], getTransfers: (params: any) => new Promise(resolve => { requests.push({ params, resolve }) }) },
  }
  const range = { startDate: '2026-09-05', endDate: '2026-09-05', startTime: '09:00', endTime: '11:00' }
  const first = create({ ...shared, branchDateRange: range })(true)
  const latest = create({ ...shared, branchDateRange: { ...range, startTime: '12:00', endTime: '13:00' } })
  const second = latest(true)
  const duplicate = latest(true)
  assert.equal(requests.length, 2, 'new hour endpoints must dispatch even when previous transfer page is pending')
  assert.equal(requests[1].params.createdFrom, '2026-09-05 05:00:00')
  assert.equal(requests[1].params.createdTo, '2026-09-05 06:01:00')
  requests[1].resolve({ items: [{ id: 99 }, { id: 100 }], total: 2 })
  await Promise.all([second, duplicate])
  requests[0].resolve({ items: [{ id: 77 }, { id: 88 }], total: 2 })
  await first
  assert.deepEqual(state.rows.map(row => row.id), [99, 100])
})
