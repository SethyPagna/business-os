import { apiFetch, requireLiveServerWrite, route } from './http.ts'
import { appendQuery, buildQueryString, normalizePositiveUniqueIds, type QueryParams } from './query.ts'

type LookupReplacementPayload = {
  type?: unknown
  from?: unknown
  to?: unknown
  userId?: unknown
  userName?: unknown
}

const PRODUCT_READ_CACHE_WRITE_DELAY_MS = 10_000

function scheduleProductCacheWrite(cacheKey: string, result: unknown): void {
  const run = (): void => {
    import('./queryCache.ts')
      .then(({ writeCachedQueryResult }) => writeCachedQueryResult(cacheKey, result))
      .catch(() => {})
  }
  if (typeof window === 'undefined') {
    Promise.resolve().then(run).catch(() => {})
    return
  }
  window.setTimeout(run, PRODUCT_READ_CACHE_WRITE_DELAY_MS)
}

function scheduleProductsMirror(rows: unknown): void {
  const run = (): void => {
    import('./localMirrors.ts')
      .then(({ mirrorTable }) => mirrorTable('products')(rows))
      .catch(() => {})
  }
  if (typeof window === 'undefined') {
    Promise.resolve().then(run).catch(() => {})
    return
  }
  window.setTimeout(run, PRODUCT_READ_CACHE_WRITE_DELAY_MS)
}

function readProductCache(cacheKey: string): Promise<unknown> {
  return import('./queryCache.ts').then(({ readCachedQueryResult }) => readCachedQueryResult(cacheKey))
}

function routeCachedProductQuery(cacheKey: string, path: string, searchGroup?: string): Promise<unknown> {
  return route(
    cacheKey,
    async (signal?: AbortSignal) => {
      const result = await apiFetch('GET', path, undefined, undefined, { signal })
      scheduleProductCacheWrite(cacheKey, result)
      return result
    },
    () => readProductCache(cacheKey),
    { raceLocalFallback: false, searchGroup },
  )
}

export function getProducts(): Promise<unknown> {
  return route(
    'products:get',
    async () => {
      const result = await apiFetch('GET', '/api/products')
      scheduleProductsMirror(result)
      return result
    },
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('products').orderBy('name').toArray()
    },
    { raceLocalFallback: false },
  )
}

// The catalog search endpoint reads its free-text term from `query` (with
// `q` accepted as a legacy alias) -- see buildSearchFilters in
// cloudflare/src/routes/products.ts. Any OTHER key holding the typed text
// is silently dropped by the server, which does not error: it returns the
// whole unfiltered catalog, so the caller's list looks like it "ignores the
// search box" instead of failing.
//
// That is exactly the confirmed production bug this exists to make
// impossible: the Change-stock product picker
// (components/products/forms/StockAdjustModal.tsx) called this with
// `{ search: <typed text> }`, so scanning a barcode into it returned all
// 10212 products in catalog order (verified live against a production
// snapshot: `?search=3348901770569` -> total 10212, `?query=...` -> total
// 3). Every other picker happened to spell it `query`.
//
// Canonicalizing here rather than patching that one call site is the point:
// this function is the single chokepoint every product picker in the app
// goes through (POS, Products, StockAdjustModal, FastStockInModal,
// Promotions, NewReturnModal, ProductsImageOnlyView, the lookup
// snapshotter), so no future caller can reintroduce the same silent drop by
// picking a reasonable-sounding synonym. The canonical key wins if a caller
// somehow sends more than one.
const SEARCH_TERM_ALIASES = ['query', 'q', 'search', 'searchTerm', 'search_term'] as const

function canonicalizeSearchTerm(params: QueryParams): QueryParams {
  const next: QueryParams = { ...params }
  let term = ''
  for (const key of SEARCH_TERM_ALIASES) {
    const value = next[key]
    if (!term && value != null && String(value).trim()) term = String(value)
    if (key !== 'query') delete next[key]
  }
  if (term) next.query = term
  else delete next.query
  return next
}

export function searchProducts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(canonicalizeSearchTerm(params))
  const cacheKey = `products:search:${query}`
  // Fixed group name (not the per-query cacheKey above) -- every call to
  // searchProducts, regardless of which page called it or what the query
  // text is, shares this group, so typing a new character aborts whatever
  // previous searchProducts request was still in flight instead of letting
  // it keep running against the server after its result can no longer
  // matter. Products page, POS, and anywhere else calling this share one
  // group deliberately: they're all "the product search box" from the
  // server's perspective, and only ever one of them is being typed into at
  // a time in a single tab.
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/search', query), 'products:search')
}

export function getProductBootstrap(params: QueryParams = {}): Promise<unknown> {
  // Same canonicalization as searchProducts: /bootstrap runs the identical
  // buildSearchFilters term parsing, so a synonym key would silently return
  // the unfiltered catalog here too.
  const query = buildQueryString(canonicalizeSearchTerm(params))
  const cacheKey = `products:bootstrap:${query}`
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/bootstrap', query), 'products:bootstrap')
}

export function getProductsByIds(ids: unknown[] = [], params: QueryParams = {}): Promise<unknown> {
  const uniqueIds = normalizePositiveUniqueIds(ids, 100)
  if (!uniqueIds.length) return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 0 })
  const query = buildQueryString({
    page: 1,
    pageSize: Math.min(Math.max(uniqueIds.length, 1), 100),
    ids: uniqueIds.join(','),
    include: 'branch_stock,images,batches',
    ...params,
  })
  // Deliberately does NOT go through searchProducts()/its shared
  // 'products:search' abort group. This function is used to re-fetch the
  // canonical row(s) for a specific id right after a write (e.g. building
  // an undo/redo snapshot after Save, or confirming a just-created row) --
  // a fundamentally different call than "what's currently typed in the
  // search box." Sharing the group meant an unrelated keystroke or a
  // background list refresh landing at the same moment could abort THIS
  // request instead, which callers (e.g. Products.tsx's
  // handleSaveWithGallery) awaited as part of their own save flow -- the
  // resulting "Request superseded by a newer search" AbortError bubbled up
  // through their catch block and got shown to the user as "Failed to save
  // product," even though the actual write had already succeeded. Each
  // by-id lookup gets its own cache key (already true) and now its own
  // unshared request lifecycle, so it can never be cancelled by, or cancel,
  // the box search.
  // v2: every payload cached under the v1 key was written while the endpoint
  // ignored `ids` (the head of the whole catalog, not the requested rows).
  // Those entries live in the local mirror and would be served as the offline
  // fallback for this exact query string, so the key is versioned rather than
  // reused -- a client that already has the fix never reads a pre-fix answer.
  const cacheKey = `products:byIds:v2:${query}`
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/search', query))
    .then((payload) => restrictPayloadToIds(payload, uniqueIds))
}

// A by-id lookup must answer with the rows that were asked for or with
// nothing -- never with a substitute. The endpoint used to ignore `ids`
// entirely and answer 200 with the head of the whole catalog, so callers
// that take items[0] (StockAdjustModal's refresh, Inventory's adjust
// refresh, Products' undo/redo snapshot, the brand/category/unit lookup
// snapshots) silently bound themselves to the catalog's first row by name
// -- "Abercrombie Authantic 10ml" -- instead of the product the operator
// picked. The server now filters (cloudflare/src/routes/products.ts), and
// this pass makes the guarantee hold on the client too, so an older or
// cached response cannot reintroduce a wrong-record write.
function restrictPayloadToIds(payload: unknown, requestedIds: number[]): unknown {
  const wanted = new Set(requestedIds.map((id) => Number(id)))
  const keep = (row: unknown): boolean => {
    const id = Number((row as { id?: unknown })?.id)
    return Number.isFinite(id) && wanted.has(id)
  }
  if (Array.isArray(payload)) return payload.filter(keep)
  const items = (payload as { items?: unknown })?.items
  if (!Array.isArray(items)) return payload
  const filtered = items.filter(keep)
  if (filtered.length === items.length) return payload
  return { ...(payload as Record<string, unknown>), items: filtered, total: filtered.length }
}

// D3: the product detail page's one-round-trip report -- per-lot totals,
// per-supplier totals, and the sales breakdown. Fresh on every open for
// the same reason as the ledger below.
export function getProductDetailReport(productId: number | string, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return apiFetch('GET', appendQuery(`/api/products/${encodeURIComponent(String(productId))}/detail-report`, query))
}

// Drill-downs for the detail report's Sales and Suppliers rows: the individual
// sales of a product within one day/month, and the batches one supplier
// delivered for this product. Fetched on demand when a row is opened, so kept
// off the cached path like the report/ledger above.
export function getProductSalesDetail(productId: number | string, period: string, mode: 'day' | 'month'): Promise<unknown> {
  const query = buildQueryString({ period, mode })
  return apiFetch('GET', appendQuery(`/api/products/${encodeURIComponent(String(productId))}/sales-detail`, query))
}
export function getProductSupplierPurchases(productId: number | string, supplierKey: string): Promise<unknown> {
  const query = buildQueryString({ supplierKey })
  return apiFetch('GET', appendQuery(`/api/products/${encodeURIComponent(String(productId))}/supplier-purchases`, query))
}

// D1: the Stock Change ledger read. Deliberately NOT routed through the
// cached-query path -- a ledger must reflect the write that just happened,
// and the section refetches on open/page/view changes anyway.
export function getStockLedger(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return apiFetch('GET', appendQuery('/api/products/stock-ledger', query))
}

// Server-grouped receiving sessions. Summaries are paged independently from
// their lines so old-system history never requires downloading the entire
// stock ledger, and one session cannot be split by movement pagination.
export function getStockInSessions(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return apiFetch('GET', appendQuery('/api/products/stock-in-sessions', query))
}

export function getStockInSessionLines(key: string): Promise<unknown> {
  const query = buildQueryString({ key })
  return apiFetch('GET', appendQuery('/api/products/stock-in-session-lines', query))
}

export function getProductFilters(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `products:filters:${query}`
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/filters', query))
}

export function getProductLookupUsage(): Promise<unknown> {
  const cacheKey = 'products:lookups:usage'
  return routeCachedProductQuery(cacheKey, '/api/products/lookups/usage')
}

export function replaceProductLookupValues({
  type,
  from = [],
  to = null,
  userId = null,
  userName = '',
}: LookupReplacementPayload = {}): Promise<unknown> {
  const payload = {
    type: String(type || '').trim(),
    from: Array.isArray(from) ? from : [from],
    to,
    userId,
    userName,
  }
  requireLiveServerWrite('products:lookup:replace')
  return apiFetch('POST', '/api/products/lookups/replace', payload)
}
