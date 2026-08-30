import { apiFetch, route } from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'

type CustomTablePayload = Record<string, unknown>

type CustomTableDataRequest = {
  tableName: string
}

type CustomRowCreateRequest = CustomTableDataRequest & {
  data: CustomTablePayload
}

type CustomRowUpdateRequest = CustomRowCreateRequest & {
  id: string | number
  expectedUpdatedAt?: string | null
}

type CustomRowDeleteRequest = CustomTableDataRequest & {
  id: string | number
  payload?: CustomTablePayload
}

function encodePathSegment(value: string | number): string {
  return encodeURIComponent(String(value))
}

function tableDataPath(tableName: string): string {
  return `/api/custom-tables/${encodePathSegment(tableName)}/data`
}

function tableRowPath(tableName: string, id: string | number): string {
  return `/api/custom-tables/${encodePathSegment(tableName)}/rows/${encodePathSegment(id)}`
}

export function getCustomTables(): Promise<unknown> {
  return route(
    'customTables:get',
    () => apiFetch('GET', '/api/custom-tables'),
    async () => {
      const db = await getLocalDb()
      return db.table('custom_tables').toArray()
    },
  )
}

export function createCustomTable(payload: CustomTablePayload = {}): Promise<unknown> {
  return route(
    'customTables:create',
    () => apiFetch('POST', '/api/custom-tables', payload),
    null,
    true,
  )
}

export function getCustomTableData({ tableName }: CustomTableDataRequest): Promise<unknown> {
  // Per-table cache/dedupe key: a constant 'customTables:data' made every
  // table share one 20s cache slot, so opening table B within the window
  // rendered table A's rows. Write-invalidation is by 'customTables' prefix,
  // so per-table keys still clear. (See feesTransport.getFee for reasoning.)
  return route(
    `customTables:data:${tableName}`,
    () => apiFetch('GET', tableDataPath(tableName)),
    () => [],
  )
}

export function insertCustomRow({ tableName, data }: CustomRowCreateRequest): Promise<unknown> {
  return route(
    'customTables:insertRow',
    () => apiFetch('POST', `/api/custom-tables/${encodePathSegment(tableName)}/rows`, { data }),
    null,
    true,
  )
}

export function updateCustomRow({ tableName, id, data, expectedUpdatedAt }: CustomRowUpdateRequest): Promise<unknown> {
  return route(
    'customTables:updateRow',
    () => apiFetch('PUT', tableRowPath(tableName, id), { data, expectedUpdatedAt }),
    null,
    true,
  )
}

export function deleteCustomRow({ tableName, id, payload = {} }: CustomRowDeleteRequest): Promise<unknown> {
  return route(
    'customTables:deleteRow',
    () => apiFetch('DELETE', tableRowPath(tableName, id), payload),
    null,
    true,
  )
}
