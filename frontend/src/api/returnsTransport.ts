import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

export function getReturns(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    query ? `returns:get:${query}` : 'returns:get',
    () => apiFetch('GET', appendQuery('/api/returns', query)),
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('returns').orderBy('created_at').reverse().toArray()
    },
  )
}
