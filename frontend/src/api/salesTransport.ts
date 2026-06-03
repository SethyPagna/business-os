import { SYNC } from '../constants.ts'
import { apiFetch, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

type SalePayload = Record<string, unknown>

export function createSale(payload: SalePayload): Promise<unknown> {
  return route(
    'sales:create',
    () => apiFetch('POST', '/api/sales', payload),
    null,
    true,
  )
}

export function createSaleWithoutWriteDedupe(payload: SalePayload): Promise<unknown> {
  return apiFetch(
    'POST',
    '/api/sales',
    payload,
    SYNC.REQUEST_TIMEOUT_MS,
    { skipWriteDedupe: true },
  )
}

export function getSales(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  const mirror = query ? undefined : mirrorTable('sales')
  return routeMirrored(
    `sales:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/sales', query)),
    async () => {
      const db = await getLocalDb()
      return db.table('sales').orderBy('created_at').reverse().limit(1000).toArray()
    },
    mirror,
  )
}
