import { apiFetch, route } from './http.ts'
import { appendActorQuery } from './actorQuery.ts'
import { dexieDb } from './localDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'

type AccessPayload = ExpectedUpdatedAtPayload

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getUsers(): Promise<unknown> {
  return routeMirrored(
    'users:get',
    () => apiFetch('GET', appendActorQuery('/api/users')),
    () => dexieDb.table('users').toArray(),
    mirrorTable('users'),
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

export async function updateUserProfile(id: string | number, payload: AccessPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('users', id, payload)
  return route(
    'users:updateProfile',
    () => apiFetch('PUT', `/api/users/${encodeId(id)}/profile`, body),
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

export function getRoles(): Promise<unknown> {
  return routeMirrored(
    'roles:get',
    () => apiFetch('GET', appendActorQuery('/api/roles')),
    () => dexieDb.table('roles').toArray(),
    mirrorTable('roles'),
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
