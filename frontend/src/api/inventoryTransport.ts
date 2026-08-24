import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

type InventoryMovementParams = {
  branchId?: string | number | null
  userId?: string | number | null
  productId?: string | number | null
  search?: string | null
  searchMode?: string | null
  startDate?: string | null
  endDate?: string | null
  page?: string | number | null
  pageSize?: string | number | null
}

const INVENTORY_READ_CACHE_WRITE_DELAY_MS = 10_000

function scheduleInventoryCacheWrite(cacheKey: string, result: unknown): void {
  const run = (): void => {
    import('./queryCache.ts')
      .then(({ writeCachedQueryResult }) => writeCachedQueryResult(cacheKey, result))
      .catch(() => {})
  }
  if (typeof window === 'undefined') {
    Promise.resolve().then(run).catch(() => {})
    return
  }
  window.setTimeout(run, INVENTORY_READ_CACHE_WRITE_DELAY_MS)
}

function readInventoryCache(cacheKey: string): Promise<unknown> {
  return import('./queryCache.ts').then(({ readCachedQueryResult }) => readCachedQueryResult(cacheKey))
}

function routeCachedInventoryQuery(cacheKey: string, path: string, searchGroup?: string): Promise<unknown> {
  return route(
    cacheKey,
    async (signal?: AbortSignal) => {
      const result = await apiFetch('GET', path, undefined, undefined, { signal })
      scheduleInventoryCacheWrite(cacheKey, result)
      return result
    },
    () => readInventoryCache(cacheKey),
    { raceLocalFallback: false, searchGroup },
  )
}

export function getInventorySummary({ branchId }: { branchId?: string | number | null } = {}): Promise<unknown> {
  const query = buildQueryString({ branchId })
  return route(
    branchId ? `inventory:summary:${branchId}` : 'inventory:summary',
    () => apiFetch('GET', appendQuery('/api/inventory/summary', query)),
    () => [],
  )
}

export function getInventoryStats(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `inventory:stats:${query}`,
    () => apiFetch('GET', appendQuery('/api/inventory/stats', query)),
    () => ({ item: null }),
  )
}

export function searchInventoryProducts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `inventory:products:search:v2:${query}`
  // Stable group (not the per-query cacheKey): a new keystroke aborts
  // whatever previous Inventory search request was still in flight, same
  // reasoning as products:search in productReadTransport.ts.
  return routeCachedInventoryQuery(cacheKey, appendQuery('/api/inventory/products/search', query), 'inventory:search')
}

export function getInventoryBootstrap(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `inventory:bootstrap:v1:${query}`
  return routeCachedInventoryQuery(cacheKey, appendQuery('/api/inventory/bootstrap', query), 'inventory:bootstrap')
}

export function getInventoryMovements({
  branchId,
  userId,
  productId,
  search,
  searchMode,
  startDate,
  endDate,
  page = 1,
  pageSize = 10000,
}: InventoryMovementParams = {}): Promise<unknown> {
  const safePage = Math.max(1, Number(page || 1) || 1)
  const safePageSize = Math.min(Math.max(Number(pageSize || 10000) || 10000, 1), 50000)
  const query = buildQueryString({
    branchId,
    userId,
    productId,
    search,
    searchMode,
    startDate,
    endDate,
    page: safePage,
    pageSize: safePageSize,
  })
  return route(
    `inventory:movements:${query}`,
    () => apiFetch('GET', appendQuery('/api/inventory/movements', query)),
    () => ({
      items: [],
      total: 0,
      page: safePage,
      pageSize: safePageSize,
      totalPages: 1,
    }),
  )
}

export function getInventoryReasons(): Promise<unknown> {
  return route('inventory:reasons:get', () => apiFetch('GET', '/api/inventory/reasons'), () => ({ items: [] }))
}
