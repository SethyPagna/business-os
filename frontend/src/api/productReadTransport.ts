import { apiFetch, requireLiveServerWrite } from './http.ts'
import { appendQuery, buildQueryString, normalizePositiveUniqueIds, type QueryParams } from './query.ts'
import { dexieDb } from './localDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { readCachedQueryResult, writeCachedQueryResult } from './queryCache.ts'

type LookupReplacementPayload = {
  type?: unknown
  from?: unknown
  to?: unknown
  userId?: unknown
  userName?: unknown
}

export function getProducts(): Promise<unknown> {
  return routeMirrored(
    'products:get',
    () => apiFetch('GET', '/api/products'),
    () => dexieDb.table('products').orderBy('name').toArray(),
    mirrorTable('products'),
  )
}

export function searchProducts(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `products:search:${query}`
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/products/search', query)),
    () => readCachedQueryResult(cacheKey),
    (result: unknown) => writeCachedQueryResult(cacheKey, result),
  )
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
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', appendQuery('/api/products/filters', query)),
    () => readCachedQueryResult(cacheKey),
    (result: unknown) => writeCachedQueryResult(cacheKey, result),
  )
}

export function getProductLookupUsage(): Promise<unknown> {
  const cacheKey = 'products:lookups:usage'
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', '/api/products/lookups/usage'),
    () => readCachedQueryResult(cacheKey),
    (result: unknown) => writeCachedQueryResult(cacheKey, result),
  )
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
