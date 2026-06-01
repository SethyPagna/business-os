import { apiFetch, route } from './http.ts'
import { dexieDb } from './localDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'

type LookupPayload = ExpectedUpdatedAtPayload
type LookupKind = 'categories' | 'units'
type LookupConfig = {
  kind: LookupKind
  routeKey: string
  path: string
}

const CATEGORY_CONFIG: LookupConfig = {
  kind: 'categories',
  routeKey: 'categories',
  path: '/api/categories',
}

const UNIT_CONFIG: LookupConfig = {
  kind: 'units',
  routeKey: 'units',
  path: '/api/units',
}

function listLookupRows(config: LookupConfig): Promise<unknown> {
  return routeMirrored(
    `${config.routeKey}:get`,
    () => apiFetch('GET', config.path),
    () => dexieDb.table(config.kind).orderBy('name').toArray(),
    mirrorTable(config.kind),
  )
}

async function createLookupRow(config: LookupConfig, payload: LookupPayload = {}): Promise<unknown> {
  return route(
    `${config.routeKey}:create`,
    () => apiFetch('POST', config.path, payload),
    null,
    true,
  )
}

async function updateLookupRow(config: LookupConfig, id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return route(
    `${config.routeKey}:update`,
    async () => apiFetch(
      config.kind === 'units' ? 'PATCH' : 'PUT',
      `${config.path}/${id}`,
      await withExpectedUpdatedAt(config.kind, id, payload),
    ),
    null,
    true,
  )
}

async function deleteLookupRow(config: LookupConfig, id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return route(
    `${config.routeKey}:delete`,
    async () => apiFetch(
      'DELETE',
      `${config.path}/${id}`,
      await withExpectedUpdatedAt(config.kind, id, payload),
    ),
    null,
    true,
  )
}

export function getCategories(): Promise<unknown> {
  return listLookupRows(CATEGORY_CONFIG)
}

export function createCategory(payload: LookupPayload = {}): Promise<unknown> {
  return createLookupRow(CATEGORY_CONFIG, payload)
}

export function updateCategory(id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return updateLookupRow(CATEGORY_CONFIG, id, payload)
}

export function deleteCategory(id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return deleteLookupRow(CATEGORY_CONFIG, id, payload)
}

export function getUnits(): Promise<unknown> {
  return listLookupRows(UNIT_CONFIG)
}

export function createUnit(payload: LookupPayload = {}): Promise<unknown> {
  return createLookupRow(UNIT_CONFIG, payload)
}

export function updateUnit(id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return updateLookupRow(UNIT_CONFIG, id, payload)
}

export function deleteUnit(id: string | number, payload: LookupPayload = {}): Promise<unknown> {
  return deleteLookupRow(UNIT_CONFIG, id, payload)
}
