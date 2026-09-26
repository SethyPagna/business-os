import { appendActorQuery } from './actorQuery.ts'
import { apiFetch, route } from './http.ts'
import { getUsers as getUsersRequest } from './userReadTransport.ts'

type AccessPayload = Record<string, unknown>

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
    { raceLocalFallback: false },
  )
}

export function getUserProfile(id: string | number): Promise<unknown> {
  return route(
    `users:profile:${id}`,
    () => apiFetch('GET', appendActorQuery(`/api/users/${encodeId(id)}/profile`)),
    () => null,
  )
}

export function getUserAuthMethods(id: string | number): Promise<unknown> {
  return route(
    `users:authMethods:${id}`,
    () => apiFetch('GET', appendActorQuery(`/api/users/${encodeId(id)}/auth-methods`)),
    () => null,
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

export function updateUser(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:update',
    () => apiFetch('PUT', `/api/users/${encodeId(id)}`, payload),
    null,
    true,
  )
}

export function updateUserProfile(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:updateProfile',
    () => apiFetch('PUT', `/api/users/${encodeId(id)}/profile`, payload),
    null,
    true,
  )
}

// Profile photo is its own action (routes/users.ts PUT/DELETE /users/:id/avatar):
// the upload only stores the image, this is what attaches or clears it.
export function setUserAvatar(id: string | number, avatarPath: string): Promise<unknown> {
  return route(
    'users:setAvatar',
    () => apiFetch('PUT', `/api/users/${encodeId(id)}/avatar`, { avatar_path: avatarPath }),
    null,
    true,
  )
}

export function removeUserAvatar(id: string | number): Promise<unknown> {
  return route(
    'users:removeAvatar',
    () => apiFetch('DELETE', `/api/users/${encodeId(id)}/avatar`),
    null,
    true,
  )
}

export function disconnectUserAuthProvider(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:disconnectProvider',
    () => apiFetch('POST', `/api/users/${encodeId(id)}/provider-disconnect`, payload),
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

export function resetPassword(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'users:resetPassword',
    () => apiFetch('POST', `/api/users/${encodeId(id)}/reset-password`, payload),
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

export function updateRole(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'roles:update',
    () => apiFetch('PUT', `/api/roles/${encodeId(id)}`, payload),
    null,
    true,
  )
}

export function deleteRole(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  return route(
    'roles:delete',
    () => apiFetch('DELETE', `/api/roles/${encodeId(id)}`, payload),
    null,
    true,
  )
}
