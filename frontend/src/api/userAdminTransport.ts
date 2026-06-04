import { appendActorQuery } from './actorQuery.ts'
import { apiFetch, route } from './http.ts'
import { getUsers as getUsersRequest } from './userReadTransport.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'

type AccessPayload = ExpectedUpdatedAtPayload

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getUsers(): Promise<unknown> {
  return getUsersRequest()
}

export function getRoles(): Promise<unknown> {
  return route(
    'roles:get',
    () => apiFetch('GET', appendActorQuery('/api/roles')),
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('roles').toArray()
    },
  )
}

export function createUser(payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:create',
    () => apiFetch('POST', '/api/users', payload),
    null,
    true,
  )
}

export async function updateUser(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('users', id, payload)
  return route(
    'users:update',
    () => apiFetch('PUT', `/api/users/${encodeId(id)}`, body),
    null,
    true,
  )
}

export function changeUserPassword(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:changePassword',
    () => apiFetch('POST', `/api/users/${encodeId(id)}/change-password`, payload),
    null,
    true,
  )
}

export function createRole(payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'roles:create',
    () => apiFetch('POST', '/api/roles', payload),
    null,
    true,
  )
}

export async function updateRole(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('roles', id, payload)
  return route(
    'roles:update',
    () => apiFetch('PUT', `/api/roles/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteRole(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('roles', id, payload)
  return route(
    'roles:delete',
    () => apiFetch('DELETE', `/api/roles/${encodeId(id)}`, body),
    null,
    true,
  )
}
