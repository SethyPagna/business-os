import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { readCachedQueryResult, writeCachedQueryResult } from './queryCache.ts'
import { routeMirrored } from './localMirrors.ts'

type InventoryMovementParams = {
  branchId?: string | number | null
  userId?: string | number | null
  search?: string | null
  searchMode?: string | null
  startDate?: string | null
  endDate?: string | null
  page?: string | number | null
  pageSize?: string | number | null
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
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/inventory/products/search', query)),
    () => readCachedQueryResult(cacheKey),
    (result: unknown) => writeCachedQueryResult(cacheKey, result),
  )
}

export function getInventoryBootstrap(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `inventory:bootstrap:v1:${query}`
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/inventory/bootstrap', query)),
    () => readCachedQueryResult(cacheKey),
    (result: unknown) => writeCachedQueryResult(cacheKey, result),
  )
}

export function getInventoryMovements({
  branchId,
  userId,
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
