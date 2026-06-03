import { appendActorQuery } from './actorQuery.ts'
import { apiFetch, route } from './http.ts'

export function getUsers(): Promise<unknown> {
  return route(
    'users:get',
    () => apiFetch('GET', appendActorQuery('/api/users')),
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('users').toArray()
    },
  )
}
