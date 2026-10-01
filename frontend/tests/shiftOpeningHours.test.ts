import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { transformSync } from 'esbuild'
test('mounted Shift opening hours reach list only and revoke stale selection/detail on hour-only change', async () => {
  const require = createRequire(import.meta.url)
  const slots: any[] = []
  let cursor = 0
  let writes = 0
  let pending: Array<() => void> = []
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (next: any) => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(initial: any) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { fn, deps }; return slots[i].fn },
    useMemo(fn: any) { return fn() },
    useEffect(fn: any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const frameSource = fs.readFileSync(new URL('../src/components/sales/reports/ReportFrame.tsx', import.meta.url), 'utf8')
  const hookBody = frameSource.slice(frameSource.indexOf('export function useReportData')).replace('export function', 'function')
  const useReportData = new Function('useState', 'useRef', 'useCallback', 'useEffect', `${stripTypeScriptTypes(hookBody)}; return useReportData`)(hooks.useState, hooks.useRef, hooks.useCallback, hooks.useEffect)
  const Frame = 'ReportFrame', Pager = 'Pager', Summary = 'Summary'
  const listCalls: any[] = [], detailCalls: number[] = [], exports: any[] = []
  let lateResolve: (value: any) => void = () => {}
  let holdDetail = false
  let user: any = { id: 1, role_code: 'admin' }
  const shift = (id: number) => ({ id, shift_code: `S-${id}`, business_date: '2020-01-01', opening_float_usd: id, opening_float_khr: null, closing_counted_usd: null, closing_counted_khr: null })
  const mod: any = { exports: {} }
  let reportSource = fs.readFileSync(new URL('../src/components/sales/reports/ShiftReport.tsx', import.meta.url), 'utf8')
  if (process.env.SHIFT_HOURS_NEGATIVE_CONTROL === '1') reportSource = reportSource.replace(', openedFrom: openingRange.createdFrom, openedTo: openingRange.createdTo', '')
  if (process.env.SHIFT_HOURS_SCOPE_NEGATIVE_CONTROL === '1') reportSource = reportSource.replace('filters.endDate, filters.startTime, filters.endTime,', 'filters.endDate,')
  new Function('require', 'module', 'exports', transformSync(reportSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    if (id.includes('ReportFrame')) return { __esModule: true, default: Frame, useReportData }
    if (id.includes('PaginationControls')) return { __esModule: true, default: Pager, DEFAULT_PAGE_SIZE: 20 }
    if (id.includes('AppContext')) return { useApp: () => ({ user }) }
    if (id.includes('permissions')) return { isAdminControlUser: (u: any) => u.role_code === 'admin' }
    if (id.includes('useDebouncedValue')) return { useDebouncedValue: (value: unknown) => value }
    if (id.includes('formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('shiftTransport')) return {
      listShifts: async (input: any) => { listCalls.push(input); return { shifts: [shift(input.page === 1 ? 1 : 250)], page: input.page, total: 275, page_size: 20 } },
      fetchShiftHistory: async (id: number) => { detailCalls.push(id); return holdDetail ? new Promise((resolve) => { lateResolve = resolve }) : { shift: shift(id) } },
    }
    if (id.includes('shiftReportModel')) return require('../src/components/shifts/shiftReportModel.ts')
    if (id.includes('ShiftSummary')) return { __esModule: true, default: Summary }
    if (id.includes('reportModel')) return { reportFileName: (name: string) => name, reportQueryParams: require('../src/components/sales/reports/reportModel.ts').reportQueryParams }
    if (id.includes('reportTypes')) return { exportMenuItems: (_t: any, _can: any, csv: any) => [{ onClick: csv }] }
    if (id.includes('/csv')) return { downloadCSV: (...args: any[]) => exports.push(args) }
    if (id.includes('ShiftGate')) return { SHIFT_STATE_CHANGED_EVENT: 'shift:test' }
    if (id.includes('/kit')) return { OverflowMenu: 'Menu', Skeleton: 'Skeleton', EmptyState: 'Empty' }
    return { default: id }
  }, mod, mod.exports)
  const oldWindow = globalThis.window
  globalThis.window = new EventTarget() as any
  const props: any = { filters: { startDate: '2026-09-01', endDate: '2026-09-01', startTime: '09:00', endTime: '11:00', branchId: '' }, tr: (key: string) => key, view: { labelKey: 'shift', fallback: 'Shift', supportsTime: true }, canExport: () => true }
  const render = () => { cursor = 0; return mod.exports.default(props) }
  const settle = async () => { for (let i = 0; i < 6; i++) { render(); const jobs = pending; pending = []; jobs.forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)) } return render() }
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...Object.values(node.props).flatMap(nodes)] : []
  try {
    let tree = await settle()
    assert.equal(listCalls.at(-1).openedFrom, '2026-09-01 02:00:00')
    assert.equal(listCalls.at(-1).openedTo, '2026-09-01 04:01:00')
    assert.equal(nodes(tree).find((n) => n.type === Summary).props.shift.id, 1)
    assert.ok(detailCalls.every((value) => typeof value === 'number'), 'detail remains ID-only and covers the complete shift')
    nodes(tree).find((n) => n.type === 'Menu').props.items[0].onClick()
    assert.equal(exports.at(-1)[1][0].USD, 1, 'complete selected shift registration exports unchanged')
    holdDetail = true
    props.filters = { ...props.filters, startTime: '10:00' }
    tree = render()
    assert.ok(!nodes(tree).some((n) => n.type === Summary), 'hour-only change synchronously revokes old detail')
    await settle()
    props.filters = { ...props.filters, endTime: '12:00' }
    lateResolve({ shift: shift(999) })
    holdDetail = false
    tree = await settle()
    assert.equal(listCalls.at(-1).openedFrom, '2026-09-01 03:00:00')
    assert.equal(listCalls.at(-1).openedTo, '2026-09-01 05:01:00')
    assert.notEqual(nodes(tree).find((n) => n.type === Summary)?.props.shift.id, 999, 'late previous hour response cannot replace current detail')
    props.filters = { ...props.filters, startTime: '00:00', endTime: '23:59' }
    await settle()
    assert.equal(listCalls.at(-1).openedFrom, undefined)
    assert.equal(listCalls.at(-1).openedTo, undefined)
    assert.equal(listCalls.at(-1).from, '2026-09-01', 'full-day continues to select historical business_date')
    assert.match(reportSource, /shift_opening_time_filter/)
  } finally { slots.forEach((slot) => slot?.cleanup?.()); globalThis.window = oldWindow }
})

test('actual Shift transport scopes cache and request URLs to paired opening timestamps', async () => {
  const source = fs.readFileSync(new URL('../src/api/shiftTransport.ts', import.meta.url), 'utf8')
  const begin = source.indexOf('export async function listShifts('), end = source.indexOf('export async function fetchShiftHistory(', begin)
  const code = transformSync(source.slice(begin, end).replace('export async', 'async'), { loader: 'ts', target: 'es2022' }).code
  const channels: string[] = [], urls: string[] = [], invalidated: string[] = []
  const list = new Function('ctx', `with(ctx){${code};return listShifts}`)({
    queryString: (input: Record<string, unknown>) => '?' + new URLSearchParams(Object.entries(input).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)])),
    route: async (channel: string, loader: () => unknown) => { channels.push(channel); return loader() },
    apiFetch: async (_method: string, url: string) => { urls.push(url); return { shifts: [], total: 0 } },
    cacheInvalidate: (channel: string) => invalidated.push(channel),
  })
  const range = { from: '2026-09-01', to: '2026-09-01', openedFrom: '2026-09-01 02:00:00', openedTo: '2026-09-01 04:01:00' }
  await list(range, { fresh: true })
  await list({ ...range, openedTo: '2026-09-01 05:01:00' })
  assert.notEqual(channels[0], channels[1], 'different hour ranges cannot reuse one list cache')
  assert.deepEqual(invalidated, [channels[0]])
  const query = new URL(urls[0], 'http://test').searchParams
  assert.equal(query.get('openedFrom'), range.openedFrom)
  assert.equal(query.get('openedTo'), range.openedTo)
  await list({ from: '', to: '' })
  assert.equal(new URL(urls[2], 'http://test').searchParams.has('openedFrom'), false)
})

