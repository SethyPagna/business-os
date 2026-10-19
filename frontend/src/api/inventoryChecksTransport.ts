import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import {
  assertActorReadScope, assertActorWriteIdentity, captureActorReadScope, captureActorWriteIdentity,
  type ActorReadScope, type ActorWriteIdentity,
} from './actorReadScope.ts'
import type { InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../types/inventoryChecks.ts'

export type InventoryCheckSession = {
  id: string
  branch_id: number
  created_by: number
  title: string
  status: 'open' | 'closed'
  revision: number
  started_at: string
  updated_at: string
  scope: QueryParams
  progress?: { total: number; done: number; issue: number; unstarted: number }
}
export type InventoryCheckSessionItem = Omit<InventoryCheckObservation, 'state'> & {
  state: 'unstarted' | 'done' | 'issue'
  product_snapshot: InventoryCheckProduct
  current_product_available?: boolean
  current_product_name?: string | null
  current_quantity?: number | null
  stock_changed?: boolean
}
export type InventoryCheckReceipt = {
  requestId: string
  eventId: number
  action: string
  sessionId: string
  sessionRevision: number
  itemRevision?: number
  replayed: boolean
}
export type InventoryCheckContext = Readonly<{ branchId: string; sessionId: string; epoch: number }>
export type InventoryCheckWriteScope = Readonly<{
  context: InventoryCheckContext
  readScope: ActorReadScope
  writeIdentity: ActorWriteIdentity
  isCurrent: (context: InventoryCheckContext) => boolean
}>

const base = '/api/inventory-checks'
const sessionPath = (id: string) => `${base}/sessions/${encodeURIComponent(id)}`

export function captureInventoryCheckWriteScope(context: InventoryCheckContext, isCurrent: InventoryCheckWriteScope['isCurrent']): InventoryCheckWriteScope {
  return Object.freeze({ context: Object.freeze({ ...context }), readScope: Object.freeze(captureActorReadScope('inventoryChecks')), writeIdentity: Object.freeze(captureActorWriteIdentity()), isCurrent })
}

function assertContext(scope: InventoryCheckWriteScope, dispatched = false): void {
  try {
    assertActorWriteIdentity(scope.writeIdentity, dispatched ? 'unknown' : 'not_dispatched')
    assertActorReadScope(scope.readScope, false)
    if (!scope.isCurrent(scope.context)) {
      throw Object.assign(new Error('Inventory selection changed. Reload this session before continuing.'), { code: 'inventory_check_scope_changed' })
    }
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { outcome: dispatched ? 'unknown' : 'not_dispatched' })
  }
}

async function write<T>(scope: InventoryCheckWriteScope, path: string, method: 'POST' | 'PATCH', payload: unknown): Promise<T> {
  assertContext(scope)
  const frozenPayload = JSON.parse(JSON.stringify(payload))
  const result = await route<T>(`inventoryChecks:${scope.context.sessionId || 'create'}`, () => {
    assertContext(scope)
    return apiFetch(method, path, frozenPayload)
  }, null, { isWrite: true, writeScope: scope.readScope, writeIdentity: scope.writeIdentity })
  assertContext(scope, true)
  if (!result) throw Object.assign(new Error('Inventory save was not confirmed.'), { outcome: 'unknown' })
  return result
}

export function readInventoryCheckProducts<T>(params: QueryParams, signal?: AbortSignal): Promise<T> {
  return apiFetch('GET', appendQuery(`${base}/products`, buildQueryString(params)), undefined, undefined, { signal })
}

export function readInventoryCheckSessions(params: QueryParams = {}, signal?: AbortSignal): Promise<{ items: InventoryCheckSession[]; total: number; page: number; pageSize: number }> {
  return apiFetch('GET', appendQuery(`${base}/sessions`, buildQueryString(params)), undefined, undefined, { signal })
}

export function readInventoryCheckSession(id: string, signal?: AbortSignal): Promise<{ item: InventoryCheckSession; items: InventoryCheckSessionItem[] }> {
  return apiFetch('GET', sessionPath(id), undefined, undefined, { signal })
}

export function readInventoryCheckHistory<T>(id: string, params: QueryParams = {}, signal?: AbortSignal): Promise<T> {
  return apiFetch('GET', appendQuery(`${sessionPath(id)}/history`, buildQueryString(params)), undefined, undefined, { signal })
}

export function createInventoryCheckSession(scope: InventoryCheckWriteScope, input: { title: string; productIds: number[]; scope: QueryParams; requestId: string }): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (scope.context.sessionId) throw new Error('A new Inventory session cannot reuse an existing session selection.')
  const branchId = Number(scope.context.branchId)
  if (!Number.isSafeInteger(branchId) || branchId < 1) throw new Error('Choose a branch before starting an Inventory session.')
  return write(scope, `${base}/sessions`, 'POST', { ...input, branchId })
}

export function saveInventoryCheckObservation(scope: InventoryCheckWriteScope, productId: number, patch: InventoryCheckPatch, expectedRevision: number, expectedSessionRevision: number, requestId: string): Promise<{ item: InventoryCheckSessionItem; session: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (!scope.context.sessionId || !Number.isSafeInteger(productId) || productId < 1) throw new Error('An Inventory session and product are required.')
  return write(scope, `${sessionPath(scope.context.sessionId)}/items/${productId}`, 'PATCH', { ...patch, expectedRevision, expectedSessionRevision, requestId })
}

export function changeInventoryCheckSession(scope: InventoryCheckWriteScope, action: 'close' | 'resume', expectedRevision: number, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, sessionPath(scope.context.sessionId), 'PATCH', { action, expectedRevision, requestId })
}
