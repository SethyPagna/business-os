import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { readCachedQueryResult, writeCachedQueryResult } from './queryCache.ts'
import { routeMirrored } from './localMirrors.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type InventoryPayload = Record<string, unknown>

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

function getDevicePayload(): InventoryPayload {
  return { ...getClientDeviceInfo() }
}

export function adjustStock(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'products:adjustStock',
    () => apiFetch('POST', '/api/inventory/adjust', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function transferInventoryStock(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:transfer',
    () => apiFetch(
      'POST',
      '/api/inventory/transfer',
      ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer'),
    ),
    null,
    true,
  )
}

export function moveStockRow(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:moveRow',
    () => apiFetch('POST', '/api/inventory/move-row', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
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

export function saveInventoryReasons(items: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:reasons:save',
    () => apiFetch('PUT', '/api/inventory/reasons', { ...getDevicePayload(), items }),
    null,
    true,
  )
}
