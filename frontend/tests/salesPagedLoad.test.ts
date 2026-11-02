// Lane 6.0.990, after the owner ruled out "Show all" (26 Oct: "it will collapse the website. do pages left back and next
// as already done for many other pages"). Sales stays on the shared 20-row pager. This file runs Sales.tsx's REAL code:
//   - loadSales (sliced from the source and compiled, as saleDetailLifecycle.test.ts does), against a fake GET /api/sales
//     that filters, sorts and pages like the Worker;
//   - the activation effect and the sync effect, re-run the way React re-runs them (only when a dependency changed), with
//     latestLoadRef moved at commit like the effect that owns it.
// Plus the shared-pager wiring, the exchange-rate note, and the packs.
//
// Run: node tests/salesPagedLoad.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }

const sales = read('../src/components/sales/Sales.tsx')
const compile = (code: string, env: Record<string, unknown>, result: string) =>
  new Function(...Object.keys(env), `${transformSync(code, { loader: 'tsx' }).code}; return ${result}`)(...Object.values(env))
const loadSalesSource = sales.slice(sales.indexOf('const loadSales = useCallback'), sales.indexOf('\n\n  useEffect', sales.indexOf('const loadSales = useCallback')))
// The two effects that start list reads, as written.
function effectBody(closingDeps: string): string {
  const end = sales.indexOf(closingDeps)
  assert.ok(end > 0, closingDeps)
  const start = sales.lastIndexOf('useEffect(() => {', end)
  return `(() => {${sales.slice(start + 'useEffect(() => {'.length, end)}})`
}
const activationSource = effectBody('  }, [clearLoadWatchdog, isActive, loadSales])')
const syncSource = effectBody('  }, [isActive, loadSales, loadSalesStats, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])')

type Row = { id: number; date: string; status: string; total: number }
type Call = { date: string; page: number; limit: number; sortBy: string; sortDir: string; status?: string; signal: AbortSignal }

// A fake GET /api/sales: filters by day and status, sorts like the Worker (date = newest id first; total), pages by offset.
function server(rows: Row[]) {
  const calls: Call[] = []
  let gate: Promise<void> | null = null
  return {
    rows, calls,
    hold() { let open!: () => void; gate = new Promise((resolve) => { open = resolve }); return () => { gate = null; open() } },
    fetchSales: async (params: Record<string, any>, options: { signal: AbortSignal }) => {
      const call: Call = { date: params.startDate, page: params.page, limit: params.limit, sortBy: params.sortBy, sortDir: params.sortDir, status: params.status, signal: options.signal }
      calls.push(call)
      if (gate) await gate
      if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      const matching = rows.filter((row) => row.date === params.startDate && (!params.status || row.status === params.status))
      const dir = params.sortDir === 'asc' ? 1 : -1
      matching.sort((a, b) => params.sortBy === 'total' ? (a.total - b.total) * dir || a.id - b.id : (a.id - b.id) * dir)
      const from = (params.page - 1) * params.limit
      return matching.slice(from, from + params.limit).map((row) => ({ ...row }))
    },
  }
}
const day = (date: string, count: number, firstId = 1) => Array.from({ length: count }, (_, i) => ({ id: firstId + i, date, status: 'completed', total: firstId + i }))

type Props = { date: string; status?: string; sortBy?: string; sortDir?: string; page?: number; isActive?: boolean; sync?: { channel: string; ts: number } | null }
function harness(api: ReturnType<typeof server>) {
  const refs = {
    statusSecurityRef: { current: 's1' }, loadSecurityRef: { current: 's1' }, latestLoadRef: { current: null as any }, loadAbortRef: { current: null },
    loadRequestRef: { current: 0 }, loadPromiseRef: { current: null }, pendingLoadRef: { current: null }, latestQueryKeyRef: { current: '' },
    loadKeyRef: { current: '' }, aliveRef: { current: true }, salesRef: { current: [] as Row[] }, loadedOnceRef: { current: false },
    loadWatchdogRef: { current: undefined }, handledSyncRef: { current: '' },
  }
  const view = { sales: [] as Row[], published: [] as Row[][], errors: [] as unknown[], loading: [] as boolean[], stats: 0 }
  const render = (props: Props) => compile(loadSalesSource, {
    ...refs, useCallback: (callback: unknown) => callback, statusSecurityScope: 's1', authReady: true, canViewSales: true,
    isAdmin: false, userFilter: 'all', statusFilter: props.status || 'all', debouncedSearch: '',
    salesDateRange: { startDate: props.date, endDate: props.date }, salesPage: props.page || 1, salesPageSize: 20,
    salesSortSpec: { field: props.sortBy || 'date', direction: props.sortDir || 'desc' },
    beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent,
    clearLoadWatchdog: () => {}, setLoading: (value: boolean) => view.loading.push(value), setLoadError: (value: unknown) => { if (value) view.errors.push(value) },
    setSales: (rows: Row[]) => { view.sales = rows; view.published.push(rows) },
    window: { setTimeout: () => 1 }, withLoaderTimeout: (run: () => Promise<unknown>) => run(), SALES_LIST_REQUEST_TIMEOUT_MS: 8000,
    fetchSales: api.fetchSales, normalizeSaleRows: (rows: unknown) => rows as Row[],
    getErrorMessage: (error: unknown) => String((error as Error)?.message || error), translateOr: (_key: string, fallback: string) => fallback,
    resolvePendingSalesLoad: (pending: unknown, success: boolean) => success ? pending : null,
    console: { error: () => {} },
  }, 'loadSales') as (silent?: boolean) => Promise<void>
  // React: useCallback keeps loadSales while its inputs are equal; a commit runs latestLoadRef's effect, then the activation
  // effect and the sync effect -- each only when one of its dependencies changed.
  let last: { props: Props; load: (silent?: boolean) => Promise<void>; isActive: boolean; syncKey: string } | null = null
  const filterKey = (p: Props) => JSON.stringify([p.date, p.status, p.sortBy, p.sortDir, p.page])
  const commit = (props: Props) => {
    const isActive = props.isActive ?? true
    const load = last && filterKey(last.props) === filterKey(props) ? last.load : render(props)
    refs.latestLoadRef.current = load
    const env = {
      ...refs, isActive, loadSales: load, syncChannel: props.sync ?? null,
      setHistoryReady: () => {}, clearLoadWatchdog: () => {}, invalidateTrackedRequest, salesStatsRequestRef: { current: 0 }, setLoading: () => {},
      setUserOptionsLoaded: () => {}, loadSalesStats: async () => { view.stats += 1 }, loadStatsStrip: async () => {},
    }
    if (!last || last.isActive !== isActive || last.load !== load) (compile(`const run = ${activationSource}`, env, 'run') as () => void)()
    const syncKey = props.sync ? `${props.sync.channel}:${props.sync.ts}` : ''
    if (!last || last.isActive !== isActive || last.load !== load || last.syncKey !== syncKey) (compile(`const run = ${syncSource}`, env, 'run') as () => void)()
    last = { props, load, isActive, syncKey }
    return load
  }
  return { refs, view, render, commit }
}
const ids = (rows: Row[]) => rows.map((row) => row.id)
const fresh = async (rows: Row[], props: Props) => { const api = server(rows); const h = harness(api); h.commit(props); await settle(); return ids(h.view.sales) }

await test('a page read is 20 rows of the active query; the pager page is part of the query', async () => {
  const api = server(day('T', 45)); const h = harness(api)
  h.commit({ date: 'T' }); await settle()
  assert.deepEqual(ids(h.view.sales), Array.from({ length: 20 }, (_, i) => 45 - i))
  h.commit({ date: 'T', page: 3 }); await settle()
  assert.deepEqual(ids(h.view.sales), [5, 4, 3, 2, 1])
  assert.deepEqual(api.calls.map((call) => [call.page, call.limit]), [[1, 20], [3, 20]])
})

await test('a filter change during a read stops it: it aborts, publishes nothing, and the new query is read once', async () => {
  const api = server([...day('T', 30, 1), ...day('Y', 5, 1000)]); const h = harness(api)
  const open = api.hold()
  h.commit({ date: 'T' }); await settle()
  const first = api.calls[0]
  h.commit({ date: 'Y' })
  assert.equal(first.signal.aborted, true, 'the old read is cancelled at once')
  open(); await settle()
  assert.equal(h.view.published.length, 1, 'only the new query publishes')
  assert.ok(h.view.sales.length === 5 && h.view.sales.every((row) => row.date === 'Y'))
  assert.deepEqual(api.calls.map((call) => call.date), ['T', 'Y'])
  assert.equal(h.view.errors.length, 0, 'a superseded read is not an error')
  assert.equal(h.view.loading.at(-1), false, 'the spinner ends')
})

await test('A -> B -> A before the aborted read settles: the abort is a hand-over, not an error, and A is read again', async () => {
  const api = server([...day('T', 30, 1), ...day('Y', 5, 1000)]); const h = harness(api)
  const open = api.hold()
  h.commit({ date: 'T' }); await settle()
  h.commit({ date: 'Y' })
  h.commit({ date: 'T' })                     // back to the first query while its aborted read is still pending
  assert.equal(api.calls[0].signal.aborted, true)
  open(); await settle()
  assert.equal(h.view.errors.length, 0, 'no "could not refresh" for a read this page cancelled itself')
  assert.ok(h.view.sales.length === 20 && h.view.sales.every((row) => row.date === 'T'), 'the queued load ran and shows the query on screen')
  assert.deepEqual(api.calls.map((call) => call.date), ['T', 'T'], 'one fresh read of the query now on screen')
  assert.equal(h.view.loading.at(-1), false, 'the spinner ends')
})

await test('a closure kept from before a filter change reads the newest query, never its own', async () => {
  const api = server([...day('Y', 8, 1000), ...day('T', 30, 1)]); const h = harness(api)
  const loadY = h.commit({ date: 'Y' }); await settle()
  h.commit({ date: 'T' }); await settle()
  await loadY(true); await settle()
  assert.ok(h.view.sales.every((row) => row.date === 'T'), 'a late old closure cannot bring yesterday back')
  assert.deepEqual(api.calls.map((call) => call.date), ['Y', 'T', 'T'])
})

await test('a refresh equals a fresh load of the page: a sale that left the filter goes, the active sort holds', async () => {
  for (const sort of [{ sortBy: 'date', sortDir: 'desc' }, { sortBy: 'total', sortDir: 'asc' }]) {
    const api = server([{ id: 1, date: 'T', status: 'completed', total: 9 }, { id: 2, date: 'T', status: 'completed', total: 1 }, { id: 3, date: 'T', status: 'completed', total: 5 }])
    const h = harness(api)
    h.commit({ date: 'T', status: 'completed', ...sort }); await settle()
    api.rows.find((row) => row.id === 3)!.status = 'cancelled'
    api.rows.push({ id: 4, date: 'T', status: 'completed', total: 3 })
    h.commit({ date: 'T', status: 'completed', ...sort, sync: { channel: 'sales', ts: 1 } }); await settle()
    assert.deepEqual(ids(h.view.sales), await fresh(api.rows, { date: 'T', status: 'completed', ...sort }), `${sort.sortBy} ${sort.sortDir}`)
    assert.ok(!ids(h.view.sales).includes(3))
  }
})

await test('the sync guard: two events read twice; an event with a filter change reads once; a hidden page reads on return', async () => {
  const api = server(day('T', 30)); const h = harness(api)
  h.commit({ date: 'T' }); await settle(); assert.equal(api.calls.length, 1)
  h.commit({ date: 'T', sync: { channel: 'sales', ts: 1 } }); await settle()
  h.commit({ date: 'T', sync: { channel: 'sales', ts: 2 } }); await settle()
  assert.equal(api.calls.length, 3, 'two events, two reads')
  // A filter change after the last event: the effect re-runs (loadSales changed) but the event was handled already.
  h.commit({ date: 'T', status: 'completed', sync: { channel: 'sales', ts: 2 } }); await settle()
  assert.equal(api.calls.length, 4, 'a filter change is one read, not one plus a replayed event')
  // An event and a filter change in the same commit: the foreground read, and the event coalesces behind it.
  h.commit({ date: 'T', status: 'all', sync: { channel: 'sales', ts: 3 } }); await settle()
  assert.equal(api.calls.length, 6, 'the new query, then the one queued refresh for the event')
  // Hidden: an event reads nothing; coming back reads once.
  h.commit({ date: 'T', status: 'all', isActive: false, sync: { channel: 'sales', ts: 3 } }); await settle()
  h.commit({ date: 'T', status: 'all', isActive: false, sync: { channel: 'sales', ts: 4 } }); await settle()
  assert.equal(api.calls.length, 6, 'an event while Sales is hidden reads nothing')
  h.commit({ date: 'T', status: 'all', isActive: true, sync: { channel: 'sales', ts: 4 } }); await settle()
  assert.equal(api.calls.length, 7, 'showing Sales again reads once, covering that event')
  assert.ok(h.view.stats >= 3, 'each handled event also refreshes the summary')
})

await test('after the page\'s own writes the reload is a real page read (foreground and background)', async () => {
  const api = server(day('T', 30)); const h = harness(api)
  const load = h.commit({ date: 'T' }); await settle()
  api.rows.find((row) => row.id === 30)!.status = 'cancelled'
  await load(); await settle()               // import done, write conflict
  assert.equal(api.calls.length, 2)
  api.rows.push({ id: 31, date: 'T', status: 'completed', total: 31 })
  await load(true); await settle()           // bulk status, customer change, return success
  assert.equal(api.calls.length, 3)
  assert.equal(ids(h.view.sales)[0], 31)
  // Every post-write reload on the page goes through loadSales.
  for (const site of [/if \(isWriteConflict\(error\)\) \{\s*await loadSales\(\)/, /setShowImport\(false\)\s*loadSales\(\)/, /await Promise\.all\(\[loadSales\(true\), actionHistory\.refreshServerItems\(\)\]\)/]) assert.match(sales, site)
})

await test('Sales uses the shared Previous/Next pager like Returns: same component, props, placement and count', () => {
  assert.match(sales, /import PaginationControls, \{ clampPage, DEFAULT_PAGE_SIZE \} from '\.\.\/shared\/PaginationControls'/)
  const returns = read('../src/components/returns/Returns.tsx')
  const shape = (source: string) => (source.match(/<PaginationControls\s+compact\s+rangeAsPageSize\s+compactCentered/g) || []).length
  assert.equal(shape(sales), 2, 'top (in the pager row) and bottom')
  assert.equal(shape(returns), 2)
  assert.match(sales, /<PagerActionRow[\s\S]*?<PaginationControls\s+compact\s+rangeAsPageSize\s+compactCentered\s+page=\{salesPage\}\s+pageSize=\{salesPageSize\}\s+totalItems=\{totalSalesCount\}/)
  assert.match(sales, /<div data-sales-bottom-pager="" className="mt-3 flex justify-center">\s*<PaginationControls compact rangeAsPageSize compactCentered page=\{salesPage\} pageSize=\{salesPageSize\} totalItems=\{totalSalesCount\}/)
  assert.match(sales, /const \[salesPageSize, setSalesPageSize\] = useState\(DEFAULT_PAGE_SIZE\)/)
  assert.match(read('../src/components/shared/PaginationControls.tsx'), /export const DEFAULT_PAGE_SIZE = 20/)
  // The count is the server aggregate over the same filters as the list (falls back to the rows held before it lands).
  assert.match(sales, /const totalSalesCount = salesStats\?\.total_count \?\? allVisibleSales\.length/)
  assert.ok(!/show-all|showAll|ShowAll/.test(sales), 'no Show all left')
  assert.ok(!fs.existsSync(new URL('../src/utils/salesShowAll.ts', import.meta.url)))
})

await test('exchange-rate note: the line sits under the rate editor, neutral, no behaviour attached', () => {
  const settings = read('../src/components/utils-settings/Settings.tsx')
  const rate = settings.indexOf("field('exchange_rate', t('exchange_rate')")
  const note = settings.indexOf("t('exchange_rate_forward_only_note')")
  const tax = settings.indexOf("t('tax_enabled') ||")
  assert.ok(rate > 0 && note > rate && note < tax, 'rendered after the rate fields, in the same section')
  assert.match(settings, /<p data-testid="exchange-rate-forward-only-note"[^>]*>\{t\('exchange_rate_forward_only_note'\)\}<\/p>/)
})

await test('packs: the note in both languages, no Show-all strings left', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.ok(en.exchange_rate_forward_only_note && /[ក-៿]/.test(km.exchange_rate_forward_only_note))
  assert.match(en.exchange_rate_forward_only_note, /new sales only/i)
  assert.deepEqual([...Object.keys(en), ...Object.keys(km)].filter((key) => key.startsWith('sales_show_')), [])
})

if (failed) { console.error(`${failed} failure(s)`); process.exit(1) }
console.log('sales paged load, pager and forward-only note tests passed')
