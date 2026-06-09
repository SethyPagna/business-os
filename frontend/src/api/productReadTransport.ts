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

function routeCachedProductQuery(cacheKey: string, path: string): Promise<unknown> {
  return route(
    cacheKey,
    async () => {
      const result = await apiFetch('GET', path)
      scheduleProductCacheWrite(cacheKey, result)
      return result
    },
    () => readProductCache(cacheKey),
    { raceLocalFallback: false },
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
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/search', query))
}

export function getProductBootstrap(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `products:bootstrap:${query}`
  return routeCachedProductQuery(cacheKey, appendQuery('/api/products/bootstrap', query))
}

export function getProductsByIds(ids: unknown[] = [], params: QueryParams = {}): Promise<unknown> {
  const uniqueIds = normalizePositiveUniqueIds(ids, 100)
  if (!uniqueIds.length) return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 0 })
  return searchProducts({
    page: 1,
    pageSize: Math.min(Math.max(uniqueIds.length, 1), 100),
    ids: uniqueIds.join(','),
    include: 'branch_stock,images,batches',
    ...params,
  })
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
