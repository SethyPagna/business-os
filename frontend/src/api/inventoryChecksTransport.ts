import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import {
  assertActorReadScope, assertActorWriteIdentity, captureActorReadScope, captureActorWriteIdentity,
  type ActorReadScope, type ActorWriteIdentity,
} from './actorReadScope.ts'
import type { InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../types/inventoryChecks.ts'

/** What approving a line wrote (or, for a line already at its figure, found): ordinary stock before and after, and the target. */
export type InventoryCheckApprovalLine = { before: number; target: number; after: number; at: string; settled?: true
  /** The stock ran out before the whole shortage the count found could be removed: stock was set to 0 and `wanted` (below zero) is the figure the count asked for. */
  clamped?: true; wanted?: number }
/** A submitted count's approval (ic_fix_stock). Sent only to a viewer who may see stock. */
export type InventoryCheckApproval = {
  status: 'pending' | 'approved' | 'rejected'
  lines: number
  applied: number
  submitted_at: string
  can_approve: boolean
  /** Decided by the system, not a person: every line was replaced by a newer count. It has no decided_by_name; its note says why. */
  replaced?: true
  decided_at?: string
  decision_note?: string | null
  decided_by_name?: string | null
  /** Session detail only. */
  applied_lines?: Record<string, InventoryCheckApprovalLine>
  /** Stock may already have moved for this approval: it cannot be rejected, and only the approver who started it can finish it. */
  applying?: boolean
  /** Sent to that approver only: the request id every repeat of the approval must carry. */
  applying_request_id?: string
  /** The approval was ended by a close: lines applied stay applied (status approved), these were NOT applied, each with the reason (a refusal code or inventory_check_not_applied). */
  closed?: { lines: Record<string, string> }
  /** Session detail only: per product, the stock the counter saw. The count is measured against it. */
  baselines?: Record<string, number>
  /** Lines a newer count of the same product replaced (one waiting item per product): product id -> the newer count's session. They are never applied. */
  superseded?: Record<string, string>
}
/** The answer to one request of a decision: approving repeats the same request until done. */
export type InventoryCheckApprovalDecision = {
  approval: InventoryCheckApproval
  applied: number
  remaining: number
  done: boolean
  replayed?: boolean
  failed?: Array<{ productId: number; code: string | null; error: string }>
  /** Lines this request could not apply, each with the reason; the others were applied. */
  refused?: Array<{ productId: number; code: string }>
  /** The request took the approval over from an approver who is gone; it moved no stock, repeating it continues. */
  takeover?: true
  /** The request recorded the plan but used up its statements before any stock was written; nothing is lost, repeating it writes. */
  deferred?: true
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
  /** Only counts waiting for approval (ic_fix_stock, for a viewer who is shown approvals). */
  approval?: 'pending'
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
  current_stock?: { recorded_ordinary_quantity?: number | null; recorded_damaged_quantity?: number | null; consistent?: boolean }
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

/** ic_wired: the Products rows for the scope, cut to this viewer's Inventory grants. A server with the switch off answers 404 (the page then keeps readInventoryCheckProducts). */
export function readInventoryCheckList<T>(params: QueryParams, signal?: AbortSignal): Promise<T> {
  return apiFetch('GET', appendQuery(`${base}/list`, buildQueryString(params)), undefined, undefined, { signal })
}

/** ic_wired: the users' count entries and last stock change for the visible ids of one branch (lots=1 also brings the received dates the shared rows lack). */
export function readInventoryCheckOverlay<T>(params: { branchId: number | string; ids: Array<number | string>; lots?: boolean }, signal?: AbortSignal): Promise<T> {
  return apiFetch('GET', appendQuery(`${base}/overlay`, buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}) })), undefined, undefined, { signal })
}

export function readInventoryCheckSessions(params: InventoryCheckSessionsParams = {}, signal?: AbortSignal): Promise<{ items: InventoryCheckSession[]; total: number; page: number; pageSize: number; approvals?: boolean }> {
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
  /** Names the session in History (a count recorded after a Set from the row says so). */
  title?: string
  /** A line is a product's one count, or (ic_lot_counts) the counts typed per received date, each with the figure it showed. */
  lines: Array<{ productId: number; countedQuantity: number; seenQuantity: number | null; checked: boolean; note?: string }
    | { productId: number; lots: Array<{ batchId: number; scope: 'lot' | 'branch'; counted: number; seen: number | null }>; checked: boolean; note?: string }>
}
export function submitInventoryCheckCounts(scope: InventoryCheckWriteScope, input: InventoryCheckSubmission): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; created: boolean }> {
  if (scope.context.sessionId) throw new Error('Counts are submitted from the list, not from inside a session.')
  if (!Number.isSafeInteger(input.branchId) || input.branchId < 1) throw new Error('Choose a branch before submitting counts.')
  return write(scope, `${base}/submissions`, 'POST', input)
}

/** Approve, reject or close the open session's submitted count. Approving is repeated with the SAME requestId until the answer says done; closing ends an approval that cannot be finished (no stock moves). */
export function decideInventoryCheckApproval(scope: InventoryCheckWriteScope, input: { decision: 'approve' | 'reject' | 'close'; requestId: string }): Promise<InventoryCheckApprovalDecision> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, `${sessionPath(scope.context.sessionId)}/approval`, 'POST', input)
}

export function changeInventoryCheckSession(scope: InventoryCheckWriteScope, action: 'close' | 'resume', expectedRevision: number, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, sessionPath(scope.context.sessionId), 'PATCH', { action, expectedRevision, requestId })
}
