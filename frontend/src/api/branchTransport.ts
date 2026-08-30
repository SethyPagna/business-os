import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type BranchPayload = ExpectedUpdatedAtPayload
const BRANCH_MIRROR_WRITE_DELAY_MS = 10_000

function getDevicePayload(): BranchPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getBranches(): Promise<unknown> {
  return route(
    'branches:get',
    async () => {
      const result = await apiFetch('GET', '/api/branches')
      const run = (): void => {
        import('./localMirrors.ts')
          .then(({ mirrorTable }) => mirrorTable('branches')(result))
          .catch(() => {})
      }
      if (typeof window === 'undefined') Promise.resolve().then(run).catch(() => {})
      else window.setTimeout(run, BRANCH_MIRROR_WRITE_DELAY_MS)
      return result
    },
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('branches').toArray()
    },
    { raceLocalFallback: false },
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
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('stock_transfers').orderBy('created_at').reverse().toArray()
    },
    { raceLocalFallback: false },
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

export function transferStockBulk(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:transfer-bulk',
    () => apiFetch('POST', '/api/branches/transfer-bulk', { ...getDevicePayload(), ...(payload || {}) }),
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
