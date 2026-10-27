import assert from 'node:assert/strict'
import fs from 'node:fs'

// How the Sales page uses the pieces tested in salesSearchFlow.test.ts.
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sales = read('../src/components/sales/Sales.tsx')
const surface = read('../src/components/sales/SalesListSurface.tsx')
const strip = read('../src/components/shared/StatsStrip.tsx')

// Typing: settled (350 ms, IME-aware), and the list and its stats read that one text.
assert.ok(sales.includes('useSettledSearch(search)'), 'the search is settled, not followed key by key')
assert.ok(!sales.includes('useDebouncedValue') && !sales.includes('debouncedSearch'), 'no 180 ms per-pause search left')
assert.ok(sales.includes('{...searchCompositionProps}'), 'the search box reports IME composition')
assert.equal((sales.match(/\.\.\.\(settledSearch \? \{ search: settledSearch \} : \{\}\)/g) || []).length, 2, 'list and stats both read the settled text')

// The page belongs to its filters: no effect resets it after the list already fired with the old page.
assert.ok(!/useEffect\(\(\) => \{\s*setSalesPage\(1\)\s*\}/.test(sales), 'no page-reset effect (it fired a second request)')
assert.ok(/const pageScope = JSON\.stringify\(\[[^\]]*settledSearch[^\]]*\]\)/.test(sales), 'the page scope follows the settled search, not the raw text')
assert.ok(sales.includes('const salesPage = pageSelection.scope === pageScope ? pageSelection.page : 1'), 'page is 1 in the same render the filters change')

// A newer query preempts the older one instead of waiting behind it or being dropped by its failure.
assert.ok(sales.includes('planSalesLoad(loadPromiseRef.current ? inFlightKeyRef.current : null, loadKey)'), 'loadSales plans against the request in flight')
const preempt = sales.slice(sales.indexOf("if (plan === 'preempt') {"), sales.indexOf("if (plan === 'preempt') {") + 420)
assert.ok(preempt.includes('loadAbortRef.current?.abort()') && preempt.includes('invalidateTrackedRequest(loadRequestRef)'), 'the older request is aborted and its answer ignored')

// Refreshes see the server; paging may use a page read a moment ago; leaving drops the cache.
assert.ok(/if \(silent\) \{\s*pageCacheRef\.current\.clear\(\)/.test(sales), 'a refresh clears the page cache')
assert.ok(sales.includes('pageCacheRef.current.get(loadKey)'), 'paging reads the cache first')
assert.ok(sales.includes('pagesToPrefetch(Number(params.page), Number(params.limit), salesStatsTotalRef.current, pageWasFull)'), 'look-ahead uses the true total')
assert.ok(sales.includes('if (!silent) schedulePrefetch('), 'look-ahead follows paging, not pushes')

// Search all dates: only when a search found nothing inside a date range.
assert.ok(sales.includes('onSearchAllDates={settledSearch && (stripRange.startDate || stripRange.endDate) && !loadError ? searchAllDates : undefined}'))
assert.ok(sales.includes('const searchAllDates = useCallback(() => setStripRange({ ...EMPTY_DATE_TIME_RANGE }), [])'), 'it widens to every date and keeps Today as the default')
assert.ok(sales.includes("useState<DateTimeRange>(() => todayDateTimeRange())"), 'Today stays the default range')
assert.equal((surface.match(/\{emptyState\}/g) || []).length, 2, 'both the table and the card list show the widening action')
assert.ok(surface.includes('<CalendarRange') && surface.includes("t('all')") && surface.includes("title={t('sales_search_all_dates')}"), 'icon + one word, tooltip with the full action')

// The period cards read the history only while open.
assert.ok(strip.includes('onOpenChange?.(statsOpen)'), 'the strip tells the page when it opens')
assert.ok(sales.includes("onOpenChange={setStripOpen}") && sales.includes('!stripAvailable || !stripOpen || !stripHasRange'), 'stats-strip reads wait for the panel to open')

// A row about to be opened warms its detail read.
assert.ok(surface.includes('onPointerEnter={() => onSaleIntent?.(sale, false)}') && surface.includes('onPointerDown={() => onSaleIntent?.(sale, true)}'))
assert.ok(sales.includes('const read = warmed && warmed.id === numericId'), 'opening a sale reuses the warmed read')

const packs = ['en', 'km'].map((code) => JSON.parse(fs.readFileSync(new URL(`../src/lang/${code}.json`, import.meta.url), 'utf8')))
for (const key of ['sales_search_all_dates', 'sales_search_no_match_range']) {
  for (const pack of packs) assert.ok(typeof pack[key] === 'string' && pack[key].length > 0, `${key} exists in both packs`)
  assert.notEqual(packs[0][key], packs[1][key], `${key} is translated`)
}

console.log('PASS sales search wiring')
