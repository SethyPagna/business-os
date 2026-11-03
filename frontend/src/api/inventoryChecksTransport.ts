import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import {
  assertActorReadScope, assertActorWriteIdentity, captureActorReadScope, captureActorWriteIdentity,
  type ActorReadScope, type ActorWriteIdentity,
} from './actorReadScope.ts'
import type { InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../types/inventoryChecks.ts'

/** What approving a line wrote (or, for a line already at its figure, found): ordinary stock before and after, and the target. */
export type InventoryCheckApprovalLine = { before: number; target: number; after: number; at: string; settled?: true }
/** A submitted count's approval (ic_fix_stock). Sent only to a viewer who may see stock. */
export type InventoryCheckApproval = {
  status: 'pending' | 'approved' | 'rejected'
  lines: number
  applied: number
  submitted_at: string
  can_approve: boolean
  decided_at?: string
  decision_note?: string | null
  decided_by_name?: string | null
  /** Session detail only. */
  applied_lines?: Record<string, InventoryCheckApprovalLine>
}
/** The answer to one request of a decision: approving repeats the same request until done. */
export type InventoryCheckApprovalDecision = {
  approval: InventoryCheckApproval
  applied: number
  remaining: number
  done: boolean
  replayed?: boolean
  failed?: Array<{ productId: number; code: string | null; error: string }>
}

export type InventoryCheckSession = {
  id: string
  branch_id: number
  created_by: number
  title: string
  status: 'open' | 'closed'
  revision: number
  started_at: string
  updated_at: string
  closed_at?: string | null
  can_edit?: boolean
  scope: QueryParams
  progress?: { total: number; done: number; issue: number; unstarted: number }
  /** Sessions list only. Branch name is always sent; creator_name only when the viewer may see staff identity. */
  branch_name?: string | null
  creator_name?: string | null
  /** Sessions list and session read: present for a submitted count that differs from stock, to a viewer who may see stock. */
  approval?: InventoryCheckApproval
}
export type InventoryCheckSessionsParams = QueryParams & {
  branchId?: string | number
  status?: 'open' | 'closed'
  mine?: 1 | '1'
  /** Business days (YYYY-MM-DD, Cambodia UTC+7) on started_at. */
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}
export type InventoryCheckHistoryEvent = {
  id: number
  session_id: string
  product_id: number | null
  /** The session's frozen starting name for the product; null for session-level events. */
  product_name: string | null
  actor_id: number
  /** Present only when the viewer may see staff identity. */
  actor_name?: string | null
  action: string
  created_at: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}
export type InventoryCheckSessionItem = Omit<InventoryCheckObservation, 'state'> & {
  state: 'unstarted' | 'done' | 'issue'
  product_snapshot: InventoryCheckProduct
  current_product_available?: boolean
  current_product_name?: string | null
  current_quantity?: number | null
  stock_changed?: boolean
  /** The damaged units now (a Set excludes them); sent with the stock field. */
  current_stock?: { recorded_damaged_quantity?: number | null; consistent?: boolean }
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

export function readInventoryCheckSessions(params: InventoryCheckSessionsParams = {}, signal?: AbortSignal): Promise<{ items: InventoryCheckSession[]; total: number; page: number; pageSize: number }> {
  return apiFetch('GET', appendQuery(`${base}/sessions`, buildQueryString(params)), undefined, undefined, { signal })
}

export function readInventoryCheckSession(id: string, signal?: AbortSignal): Promise<{ item: InventoryCheckSession; items: InventoryCheckSessionItem[]; approval?: InventoryCheckApproval }> {
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

/** The owner's way to count: every picked product with its count in one request, recorded whole as a closed session. Nothing about stock changes. */
export type InventoryCheckSubmission = {
  branchId: number
  requestId: string
  lines: Array<{ productId: number; countedQuantity: number; seenQuantity: number | null; checked: boolean; note?: string }>
}
export function submitInventoryCheckCounts(scope: InventoryCheckWriteScope, input: InventoryCheckSubmission): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; created: boolean }> {
  if (scope.context.sessionId) throw new Error('Counts are submitted from the list, not from inside a session.')
  if (!Number.isSafeInteger(input.branchId) || input.branchId < 1) throw new Error('Choose a branch before submitting counts.')
  return write(scope, `${base}/submissions`, 'POST', input)
}

/** Approve or reject the open session's submitted count. Approving is repeated with the SAME requestId until the answer says done. */
export function decideInventoryCheckApproval(scope: InventoryCheckWriteScope, input: { decision: 'approve' | 'reject'; requestId: string; confirmDrift?: boolean }): Promise<InventoryCheckApprovalDecision> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, `${sessionPath(scope.context.sessionId)}/approval`, 'POST', input)
}

export function changeInventoryCheckSession(scope: InventoryCheckWriteScope, action: 'close' | 'resume', expectedRevision: number, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, sessionPath(scope.context.sessionId), 'PATCH', { action, expectedRevision, requestId })
}
