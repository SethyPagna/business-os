import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { dexieDb } from './localDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type BranchPayload = ExpectedUpdatedAtPayload

function getDevicePayload(): BranchPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getBranches(): Promise<unknown> {
  return routeMirrored(
    'branches:get',
    () => apiFetch('GET', '/api/branches'),
    () => dexieDb.table('branches').toArray(),
    mirrorTable('branches'),
  )
}

export function getBranchSummary(): Promise<unknown> {
  return route(
    'branches:summary',
    () => apiFetch('GET', '/api/branches/summary'),
    () => ({
      branch_count: 0,
      total_products: 0,
      in_stock: 0,
      low_stock: 0,
      out_of_stock: 0,
      stock_value_usd: 0,
    }),
  )
}

export function createBranch(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:create',
    () => apiFetch('POST', '/api/branches', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export async function updateBranch(id: string | number, payload: BranchPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('branches', id, { ...getDevicePayload(), ...(payload || {}) })
  return route(
    'branches:update',
    () => apiFetch('PUT', `/api/branches/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteBranch(
  id: string | number,
  userId: string | number | null,
  userName: string | null,
): Promise<unknown> {
  const payload = await withExpectedUpdatedAt('branches', id, { userId, userName })
  return route(
    'branches:delete',
    () => apiFetch('DELETE', `/api/branches/${encodeId(id)}`, payload),
    null,
    true,
  )
}

export function getBranchStock(id: string | number, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `branches:stock:${id}:${query}`,
    () => apiFetch('GET', appendQuery(`/api/branches/${encodeId(id)}/stock`, query)),
    () => [],
  )
}

export function getTransfers(): Promise<unknown> {
  return route(
    'transfers:get',
    () => apiFetch('GET', '/api/transfers'),
    () => dexieDb.table('stock_transfers').orderBy('created_at').reverse().toArray(),
  )
}

export function transferStock(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:transfer',
    () => apiFetch('POST', '/api/branches/transfer', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function getBranchStockIntegrity(): Promise<unknown> {
  return route(
    'branches:stockIntegrity',
    () => apiFetch('GET', '/api/branches/stock-integrity'),
    () => ({ issues: [], summary: {} }),
  )
}

export function repairBranchStockIntegrity(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:stockIntegrity:repair',
    () => apiFetch('POST', '/api/branches/stock-integrity/repair', payload),
    null,
    true,
  )
}
