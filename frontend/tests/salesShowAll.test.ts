// S4R6-2#422: the Sales page's "Show all" reads every sale of one business day in bounded pages, and FX-forward-only#264 /
// Currency-forward-only#388: a neutral "new rate applies to new sales only" line sits beside the exchange-rate editor.
//
// The Show-all half runs Sales.tsx's REAL loadSales callback (sliced out of the source and compiled, the same way
// saleDetailLifecycle.test.ts runs it) against a fake GET /api/sales that filters, sorts and pages like the Worker, and
// models React's commit order: a new loadSales closure becomes latestLoadRef.current only when the commit's effects run.
//
// Run: node tests/salesShowAll.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import {
  planSalesLoad, readShowAllPreference, showAllEligible, walkSalesPages, writeShowAllPreference,
  SHOW_ALL_MAX_PAGES, SHOW_ALL_MAX_ROWS, SHOW_ALL_PAGE_SIZE,
} from '../src/utils/salesShowAll.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// ---------------------------------------------------------------------------------------------------------------------
// The pure pieces
// ---------------------------------------------------------------------------------------------------------------------

function endpoint(total: number) {
  const calls: Array<[number, number]> = []
  return {
    calls,
    fetchPage: async (page: number, limit: number) => {
      calls.push([page, limit])
      const start = (page - 1) * limit
      return Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: start + i + 1 }))
    },
  }
}

await test('walk: every row across pages, bounded, deduped, complete only on a short page', async () => {
  const api = endpoint(250)
  const result = await walkSalesPages(api.fetchPage)
  assert.equal(result?.rows.length, 250); assert.equal(result?.complete, true); assert.equal(result?.truncated, false)
  assert.deepEqual(api.calls, [[1, 100], [2, 100], [3, 100]])
  assert.ok(SHOW_ALL_PAGE_SIZE <= 200, 'never above the Worker list cap')
  const exact = endpoint(200); assert.equal((await walkSalesPages(exact.fetchPage))?.complete, true); assert.equal(exact.calls.length, 3)
  const huge = endpoint(10_000_000); const capped = await walkSalesPages(huge.fetchPage)
  assert.equal(huge.calls.length, SHOW_ALL_MAX_PAGES); assert.equal(capped?.rows.length, SHOW_ALL_MAX_ROWS)
  assert.equal(capped?.truncated, true); assert.equal(capped?.complete, false)
  let call = 0
  const drift = await walkSalesPages(async () => { call += 1; return call === 1 ? [{ id: 3 }, { id: 2 }] : call === 2 ? [{ id: 2 }, { id: 1 }] : [] }, { pageSize: 2 })
  assert.deepEqual(drift?.rows.map((row) => row.id), [3, 2, 1])
})

await test('walk: a cancelled walk returns null; a later failed page keeps what loaded; a failed first page rejects', async () => {
  let cancelled = false
  const api = endpoint(1000)
  const result = await walkSalesPages(async (page, limit) => { const rows = await api.fetchPage(page, limit); if (page === 2) cancelled = true; return rows }, { isCancelled: () => cancelled })
  assert.equal(result, null, 'a cancelled walk publishes nothing')
  assert.equal(api.calls.length, 2)
  const partial = await walkSalesPages(async (page) => { if (page === 3) throw new Error('page 3 failed'); return Array.from({ length: 100 }, (_, i) => ({ id: page * 1000 + i })) })
  assert.equal(partial?.rows.length, 200); assert.equal(partial?.complete, false); assert.match(String(partial?.error), /page 3 failed/)
  await assert.rejects(walkSalesPages(async () => { throw new Error('page 1 failed') }), /page 1 failed/)
})

await test('plan: page when off; walk for a new query or an explicit Retry/Refresh; otherwise probe a short complete list or skip', () => {
  const last = { key: 'k', rows: 30, complete: true }
  assert.equal(planSalesLoad({ showAll: false, explicit: true, key: 'k', last }), 'page')
  assert.equal(planSalesLoad({ showAll: true, explicit: false, key: 'k', last: null }), 'walk')
  assert.equal(planSalesLoad({ showAll: true, explicit: false, key: 'other', last }), 'walk')
  assert.equal(planSalesLoad({ showAll: true, explicit: true, key: 'k', last }), 'walk')
  assert.equal(planSalesLoad({ showAll: true, explicit: false, key: 'k', last }), 'probe')
  assert.equal(planSalesLoad({ showAll: true, explicit: false, key: 'k', last: { ...last, rows: SHOW_ALL_PAGE_SIZE } }), 'skip')
  assert.equal(planSalesLoad({ showAll: true, explicit: false, key: 'k', last: { ...last, complete: false } }), 'skip')
})

await test('Show all is for one business day; the choice is per viewer and off unless that viewer turned it on', () => {
  assert.equal(showAllEligible({ startDate: '2026-10-26', endDate: '2026-10-26' }), true)
  assert.equal(showAllEligible({ startDate: '2026-10-01', endDate: '2026-10-26' }), false)
  assert.equal(showAllEligible({}), false)
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } }
  assert.equal(readShowAllPreference(storage, 7), false, 'off by default')
  writeShowAllPreference(storage, 7, true)
  assert.equal(readShowAllPreference(storage, 7), true)
  assert.equal(readShowAllPreference(storage, 8), false, 'another viewer keeps their own choice')
  writeShowAllPreference(storage, 7, false); assert.equal(readShowAllPreference(storage, 7), false)
  assert.equal(readShowAllPreference({ getItem: () => { throw new Error('blocked') } }, 7), false, 'blocked storage reads as off')
})

// ---------------------------------------------------------------------------------------------------------------------
// The real loadSales
// ---------------------------------------------------------------------------------------------------------------------

type Row = { id: number; date: string; status: string; total: number }
type Call = { date: string; page: number; limit: number; sortBy: string; sortDir: string; status?: string; signal: AbortSignal }

const salesSource = read('../src/components/sales/Sales.tsx')
function salesReadCallback(env: Record<string, unknown>) {
  const start = salesSource.indexOf('const loadSales = useCallback')
  const end = salesSource.indexOf('\n\n  useEffect', start)
  const code = transformSync(salesSource.slice(start, end), { loader: 'tsx' }).code
  return new Function(...Object.keys(env), `${code}; return loadSales`)(...Object.values(env)) as (silent?: boolean, explicit?: boolean) => Promise<void>
}
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }

// A fake GET /api/sales: filters by day and status, sorts like the Worker (date = newest id first; total), pages by offset.
function server(rows: Row[]) {
  const calls: Call[] = []
  let gate: Promise<void> | null = null
  let fail: ((call: Call) => boolean) | null = null
  return {
    rows, calls,
    hold() { let open!: () => void; gate = new Promise((resolve) => { open = resolve }); return () => { gate = null; open() } },
    failWhen(rule: ((call: Call) => boolean) | null) { fail = rule },
    fetchSales: async (params: Record<string, any>, options: { signal: AbortSignal }) => {
      const call: Call = { date: params.startDate, page: params.page, limit: params.limit, sortBy: params.sortBy, sortDir: params.sortDir, status: params.status, signal: options.signal }
      calls.push(call)
      if (gate) await gate
      if (options.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (fail?.(call)) throw new Error(`page ${call.page} failed`)
      const matching = rows.filter((row) => row.date === params.startDate && (!params.status || row.status === params.status))
      const dir = params.sortDir === 'asc' ? 1 : -1
      matching.sort((a, b) => params.sortBy === 'total' ? (a.total - b.total) * dir || a.id - b.id : (a.id - b.id) * dir)
      const from = (params.page - 1) * params.limit
      return matching.slice(from, from + params.limit).map((row) => ({ ...row }))
    },
  }
}
const day = (date: string, count: number, firstId = 1, extra: Partial<Row> = {}) => Array.from({ length: count }, (_, i) => ({ id: firstId + i, date, status: 'completed', total: firstId + i, ...extra }))

type Props = { date: string; showAll: boolean; status?: string; sortBy?: string; sortDir?: string; page?: number }
function harness(api: ReturnType<typeof server>) {
  const refs = {
    statusSecurityRef: { current: 's1' }, loadSecurityRef: { current: 's1' }, latestLoadRef: { current: null as any }, loadAbortRef: { current: null },
    loadRequestRef: { current: 0 }, loadPromiseRef: { current: null }, pendingLoadRef: { current: null }, latestQueryKeyRef: { current: '' },
    showAllSnapshotRef: { current: null }, loadKeyRef: { current: '' }, aliveRef: { current: true }, salesRef: { current: [] as Row[] },
    loadedOnceRef: { current: false }, loadWatchdogRef: { current: undefined },
  }
  const view = { sales: [] as Row[], published: [] as Row[][], status: null as any, errors: [] as unknown[], loading: [] as boolean[] }
  const render = (props: Props) => salesReadCallback({
    ...refs, useCallback: (callback: unknown) => callback, statusSecurityScope: 's1', authReady: true, canViewSales: true,
    isAdmin: false, userFilter: 'all', statusFilter: props.status || 'all', debouncedSearch: '',
    salesDateRange: { startDate: props.date, endDate: props.date }, salesPage: props.page || 1, salesPageSize: 20,
    salesSortSpec: { field: props.sortBy || 'date', direction: props.sortDir || 'desc' }, showAllActive: props.showAll && showAllEligible({ startDate: props.date, endDate: props.date }),
    planSalesLoad, walkSalesPages, SHOW_ALL_MAX_PAGES,
    beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent,
    clearLoadWatchdog: () => {}, setLoading: (value: boolean) => view.loading.push(value), setLoadError: (value: unknown) => { if (value) view.errors.push(value) },
    setSales: (rows: Row[]) => { view.sales = rows; view.published.push(rows) },
    setShowAllStatus: (next: any) => { view.status = typeof next === 'function' ? next(view.status) : next },
    window: { setTimeout: () => 1 }, withLoaderTimeout: (run: () => Promise<unknown>) => run(), SALES_LIST_REQUEST_TIMEOUT_MS: 8000,
    fetchSales: api.fetchSales, normalizeSaleRows: (rows: unknown) => rows as Row[],
    getErrorMessage: (error: unknown) => String((error as Error)?.message || error), translateOr: (_key: string, fallback: string) => fallback,
    resolvePendingSalesLoad: (pending: unknown, success: boolean) => success ? pending : null,
    console: { error: () => {} },
  })
  // React: the commit's effects run in source order -- latestLoadRef first, then the filter effect's loadSales(false).
  const commit = (props: Props) => { const load = render(props); refs.latestLoadRef.current = load; return load }
  return { refs, view, render, commit }
}
const ids = (rows: Row[]) => rows.map((row) => row.id)
const fresh = async (rows: Row[], props: Props) => { const api = server(rows); const h = harness(api); await h.commit(props)(false); await settle(); return ids(h.view.sales) }

await test('first open with a sync event queued behind it: the whole day, four requests, no half-list (review S1)', async () => {
  const api = server(day('T', 300))
  const h = harness(api)
  const load = h.commit({ date: 'T', showAll: true })
  void load(false); void load(true)
  await settle()
  assert.equal(h.view.sales.length, 300)
  assert.deepEqual(ids(h.view.sales).slice(0, 3), [300, 299, 298])
  assert.deepEqual(api.calls.map((call) => [call.page, call.limit]), [[1, 100], [2, 100], [3, 100], [4, 100]], 'the queued refresh of a 300-row list reads nothing')
  assert.equal(h.view.status?.note, 'stale', 'and says the list may be out of date instead')
})

await test('date change with a late ref and a stale closure: never a row from the previous query (review S2b)', async () => {
  const api = server([...day('Y', 80, 1000), ...day('T', 300, 1)])
  const h = harness(api)
  const loadY = h.commit({ date: 'Y', showAll: true })
  await loadY(false); await settle()
  assert.equal(h.view.sales.length, 80)
  // Render for today. Before its commit an old closure fires (a sync event or a mutation handler holding loadY)...
  void loadY(true)
  // ...then the commit: latestLoadRef moves, the filter effect reads today, and the sync effect re-fires with the new closure.
  const loadT = h.commit({ date: 'T', showAll: true })
  void loadT(false); void loadT(true)
  // A handler that kept loadY from before the change calls it after the commit.
  void loadY(true)
  await settle()
  assert.equal(h.view.sales.length, 300)
  assert.ok(h.view.sales.every((row) => row.date === 'T'), 'today only')
  for (const list of h.view.published) assert.ok(list.every((row) => row.date === list[0]?.date), 'no published list mixes two days')
  // Once everything is idle, the kept closure fires again (a mutation handler finishing late).
  void loadY(true); await settle()
  assert.ok(h.view.sales.length === 300 && h.view.sales.every((row) => row.date === 'T'), 'a late old closure cannot bring yesterday back')
  const afterCommit = api.calls.slice(api.calls.findIndex((call) => call.date === 'T'))
  assert.ok(afterCommit.every((call) => call.date === 'T'), 'the stale closure reads with the newest filters, not its own')
})

await test('a filter change during a walk stops it: its requests abort and it publishes nothing', async () => {
  const api = server([...day('T', 300, 1), ...day('Y', 50, 1000)])
  const h = harness(api)
  const open = api.hold()
  const loadT = h.commit({ date: 'T', showAll: true })
  void loadT(false)
  await settle()
  const tCall = api.calls[0]
  const loadY = h.commit({ date: 'Y', showAll: true })
  void loadY(false)
  assert.equal(tCall.signal.aborted, true, 'the old walk is cancelled at once')
  open(); await settle()
  assert.equal(h.view.published.length, 1, 'one publish')
  assert.ok(h.view.sales.length === 50 && h.view.sales.every((row) => row.date === 'Y'))
  assert.equal(api.calls.filter((call) => call.date === 'T').length, 1, 'no further page of the old day')
  assert.equal(h.view.errors.length, 0, 'a superseded read is not an error')
  assert.equal(h.view.loading.at(-1), false, 'the spinner ends')
})

await test('a refresh drops a row that left the filter (review S4)', async () => {
  const api = server([{ id: 9, date: 'T', status: 'completed', total: 9 }, { id: 7, date: 'T', status: 'completed', total: 7 }, { id: 5, date: 'T', status: 'completed', total: 5 }])
  const h = harness(api)
  const load = h.commit({ date: 'T', showAll: true, status: 'completed' })
  await load(false); await settle()
  assert.deepEqual(ids(h.view.sales), [9, 7, 5])
  api.rows.find((row) => row.id === 7)!.status = 'cancelled'
  api.rows.push({ id: 11, date: 'T', status: 'completed', total: 11 })
  await load(true); await settle()
  assert.deepEqual(ids(h.view.sales), [11, 9, 5])
  assert.deepEqual(ids(h.view.sales), await fresh(api.rows, { date: 'T', showAll: true, status: 'completed' }), 'equals a fresh load')
  assert.deepEqual(api.calls.slice(1).map((call) => [call.page, call.limit]), [[1, 100]], 'one request')
  assert.equal(h.view.status, null)
})

await test('a refresh keeps the active sort, also under a non-date sort and date ascending (review S5)', async () => {
  for (const sort of [{ sortBy: 'total', sortDir: 'asc' }, { sortBy: 'date', sortDir: 'asc' }]) {
    const api = server([{ id: 1, date: 'T', status: 'completed', total: 9 }, { id: 2, date: 'T', status: 'completed', total: 1 }, { id: 3, date: 'T', status: 'completed', total: 5 }])
    const h = harness(api)
    const load = h.commit({ date: 'T', showAll: true, ...sort })
    await load(false); await settle()
    api.rows.push({ id: 4, date: 'T', status: 'completed', total: 3 })
    await load(true); await settle()
    const expected = await fresh(api.rows, { date: 'T', showAll: true, ...sort })
    assert.deepEqual(ids(h.view.sales), expected, `${sort.sortBy} ${sort.sortDir}`)
    assert.deepEqual(expected, sort.sortBy === 'total' ? [2, 4, 3, 1] : [1, 2, 3, 4])
    assert.ok(api.calls.every((call) => call.sortBy === sort.sortBy && call.sortDir === sort.sortDir), 'every page asks for the active sort')
  }
})

await test('a failed page keeps what loaded and offers Retry; Retry re-reads the day; a failed first page is an error', async () => {
  const api = server(day('T', 250))
  const h = harness(api)
  api.failWhen((call) => call.page === 2)
  const load = h.commit({ date: 'T', showAll: true })
  await load(false); await settle()
  assert.equal(h.view.sales.length, 100, 'page 1 stays on screen')
  assert.deepEqual(h.view.status, { note: 'partial', count: 100 })
  assert.equal(h.view.errors.length, 0, 'not a failed list')
  const before = api.calls.length
  await load(true); await settle()
  assert.equal(api.calls.length, before, 'a background refresh does not re-walk a partial list')
  api.failWhen(null)
  await load(false, true); await settle()
  assert.equal(h.view.sales.length, 250); assert.equal(h.view.status, null)
  const apiFail = server(day('T', 10)); apiFail.failWhen(() => true)
  const h2 = harness(apiFail)
  await h2.commit({ date: 'T', showAll: true })(false); await settle()
  assert.equal(h2.view.errors.length, 1); assert.deepEqual(h2.view.sales, [])
})

await test('reads per action: off = base 20-row page; on = one walk per query, never one per sync event', async () => {
  // Off: exactly the base behaviour.
  const off = server(day('T', 300)); const ho = harness(off)
  const loadOff = ho.commit({ date: 'T', showAll: false })
  await loadOff(false); await loadOff(true); await settle()
  assert.deepEqual(off.calls.map((call) => [call.page, call.limit]), [[1, 20], [1, 20]])
  // On, 300 sales: open = 4 requests; three sync events = 0; explicit Refresh = 4 again; a sort change = a new walk.
  const on = server(day('T', 300)); const h = harness(on)
  const load = h.commit({ date: 'T', showAll: true })
  await load(false); await settle(); assert.equal(on.calls.length, 4)
  for (let i = 0; i < 3; i += 1) { await load(true); await settle() }
  assert.equal(on.calls.length, 4, 'sync events read nothing for a list of a page or more')
  await load(false); await settle(); assert.equal(on.calls.length, 4, 'a non-explicit foreground reload of the same query reads nothing either')
  await load(false, true); await settle(); assert.equal(on.calls.length, 8, 'the explicit Refresh walks once')
  await h.commit({ date: 'T', showAll: true, sortBy: 'total', sortDir: 'desc' })(false); await settle(); assert.equal(on.calls.length, 12)
  // On, 30 sales: a sync event reads one page.
  const small = server(day('T', 30)); const hs = harness(small)
  const loadSmall = hs.commit({ date: 'T', showAll: true })
  await loadSmall(false); await loadSmall(true); await loadSmall(true); await settle()
  assert.deepEqual(small.calls.map((call) => [call.page, call.limit]), [[1, 100], [1, 100], [1, 100]])
  // On, a 5,000-sale day: the walk stops at the bound and says so; sync events read nothing.
  const busy = server(day('T', 5000)); const hb = harness(busy)
  const loadBusy = hb.commit({ date: 'T', showAll: true })
  await loadBusy(false); await loadBusy(true); await settle()
  assert.equal(busy.calls.length, SHOW_ALL_MAX_PAGES); assert.equal(hb.view.sales.length, SHOW_ALL_MAX_ROWS)
  assert.equal(hb.view.status?.note, 'stale')
  assert.ok([...off.calls, ...on.calls, ...small.calls, ...busy.calls].every((call) => call.limit <= SHOW_ALL_PAGE_SIZE))
})

await test('a list that grows past one page stops probing: one probe, then nothing until a walk', async () => {
  const api = server(day('T', 90)); const h = harness(api)
  const load = h.commit({ date: 'T', showAll: true })
  await load(false); await settle()
  api.rows.push(...day('T', 20, 500))
  await load(true); await settle()
  assert.equal(h.view.sales.length, 90, 'a full page is not the whole list, so it is not published')
  assert.equal(h.view.status?.note, 'stale')
  await load(true); await settle()
  assert.equal(api.calls.length, 2)
})

await test('turning Show all off and on again re-walks (the held rows were the paged list)', async () => {
  const api = server(day('T', 150)); const h = harness(api)
  await h.commit({ date: 'T', showAll: true })(false); await settle()
  await h.commit({ date: 'T', showAll: false })(false); await settle()
  assert.equal(h.view.sales.length, 20)
  await h.commit({ date: 'T', showAll: true })(false); await settle()
  assert.equal(h.view.sales.length, 150)
  assert.equal(api.calls.length, 2 + 1 + 2)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page wiring
// ---------------------------------------------------------------------------------------------------------------------

await test('the Sales page: one-label toggle with aria-pressed, never disabled, visible notes, an honest pager', () => {
  const sales = salesSource
  const toggle = sales.slice(sales.indexOf('data-testid="sales-show-all-toggle"'), sales.indexOf('<ChevronsDown'))
  assert.match(toggle, /aria-pressed=\{showAllPreference\}/)
  assert.match(toggle, /aria-label=\{translateOr\('sales_show_all', 'Show all sales'\)\}/, 'one label; the state is aria-pressed')
  assert.ok(!/disabled=/.test(toggle), 'never a disabled control with no visible reason')
  assert.ok(!sales.includes('sales_show_pages'))
  assert.match(toggle, /writeShowAllPreference\(browserStorage\(\), showAllViewer, next\)/, 'remembered per viewer')
  assert.match(sales, /useState\(\(\) => readShowAllPreference\(browserStorage\(\), showAllViewer\)\)/, 'starts from the viewer\'s own choice (off by default)')
  assert.match(sales, /: !showAllDayRange \? \{ note: 'single_day', count: 0 \}/, 'a wider range says why in visible text')
  assert.match(sales, /const pagerPageSize = showAllActive \? Math\.max\(1, allVisibleSales\.length\) : salesPageSize/)
  assert.match(sales, /const pagerTotal = showAllActive \? allVisibleSales\.length : totalSalesCount/, 'the pager never claims more rows than are shown')
  assert.equal((sales.match(/totalItems=\{pagerTotal\}/g) || []).length, 2, 'both pagers')
  assert.match(sales, /data-testid="sales-show-all-reload" onClick=\{\(\) => \{ void loadSales\(false, true\) \}\}/, 'Retry/Refresh is an explicit walk')
  assert.ok(!sales.includes('salesRef.current }'), 'loadSales never reads salesRef to decide what to show')
  assert.match(sales, /if \(!syncKey \|\| handledSyncRef\.current === syncKey\) return/, 'each sync event is handled once, not again on every filter change')
})

await test('exchange-rate note: the line sits under the rate editor, neutral, no behaviour attached', () => {
  const settings = read('../src/components/utils-settings/Settings.tsx')
  const rate = settings.indexOf("field('exchange_rate', t('exchange_rate')")
  const note = settings.indexOf("t('exchange_rate_forward_only_note')")
  const tax = settings.indexOf("t('tax_enabled') ||")
  assert.ok(rate > 0 && note > rate && note < tax, 'rendered after the rate fields, in the same section')
  assert.match(settings, /<p data-testid="exchange-rate-forward-only-note"[^>]*>\{t\('exchange_rate_forward_only_note'\)\}<\/p>/)
})

await test('every new string exists in both packs, Khmer is Khmer and short', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['exchange_rate_forward_only_note', 'sales_show_all', 'sales_show_all_one_day', 'sales_show_all_truncated', 'sales_show_all_partial', 'sales_show_all_stale']) {
    assert.ok(en[key] && km[key] && en[key] !== km[key] && /[ក-៿]/.test(km[key]), key)
  }
  assert.equal(en.sales_show_pages, undefined); assert.equal(km.sales_show_pages, undefined)
  assert.ok(en.sales_show_all_partial.includes('{count}') && km.sales_show_all_partial.includes('{count}'))
  assert.ok(km.sales_show_all_truncated.length <= 60, 'the capped-day note is short')
  assert.match(en.exchange_rate_forward_only_note, /new sales only/i)
})

if (failed) { console.error(`${failed} failure(s)`); process.exit(1) }
console.log('sales show-all and forward-only note tests passed')
