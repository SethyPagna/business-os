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

export function searchProducts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
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
  const query = buildQueryString(params)
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
  const cacheKey = `products:byIds:${query}`
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/search', query))
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
