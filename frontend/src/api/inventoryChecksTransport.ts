import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import {
  assertActorReadScope, assertActorWriteIdentity, captureActorReadScope, captureActorWriteIdentity,
  type ActorReadScope, type ActorWriteIdentity,
} from './actorReadScope.ts'
import type { InventoryCheckLotsAnswer, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../types/inventoryChecks.ts'

/** What approving a line wrote (or, for a line already at its figure, found): ordinary stock before and after, and the target. */
export type InventoryCheckApprovalLine = { before: number; target: number; after: number; at: string; settled?: true
  /** The stock ran out before the whole shortage the count found could be removed: stock was set to 0 and `wanted` (below zero) is the figure the count asked for. */
  clamped?: true; wanted?: number }
/** The approver's decision on one line (reject, or modify to a figure: one total, or the dates of a line counted by received date). Absent line = open. */
export type InventoryCheckLineDecision = { decision: 'reject' | 'modify'; counted?: number; lots?: Array<{ batchId: number; counted: number }>; note?: string; at: string; by_name?: string }
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
  /** Sent with `applying`: the products the claim has planned or part-written. Only these lines are being applied; a decision on any other line is still accepted. Absent from a Worker that predates it. */
  planned_lines?: number[]
  /** The approval was ended by a close: lines applied stay applied (status approved), these were NOT applied, each with the reason (a refusal code or inventory_check_not_applied). */
  closed?: { lines: Record<string, string> }
  /** Session detail only: per product, the stock the counter saw. The count is measured against it. */
  baselines?: Record<string, number>
  /** Lines a newer count of the same product replaced (one waiting item per product): product id -> the newer count's session. They are never applied. */
  superseded?: Record<string, string>
  /** The stored set of products the approval is about, ascending (absent only for an approval made before migration 0316: the panel then falls back to the items whose figures differ). */
  line_ids?: number[]
  /** The approver's decisions, by product id; a product with no key is open. */
  line_decisions?: Record<string, InventoryCheckLineDecision>
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

/** The answer to one line decision: no stock moves; `approval` is the approval's new state. */
export type InventoryCheckLineAnswer = { approval: InventoryCheckApproval; applied: number; remaining: number; done: boolean; line: { productId: number; action: 'reject' | 'modify' | 'reopen' }; replayed?: boolean }

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
  /** A pickup row: its task, with the task's own progress (absent once the task fell off the board). */
  task?: { id: string; title: string; status: 'open' | 'closed'; total: number; done: number }
}
/** One count task of a branch's board (contract docs/contracts/inventory-check-tasks-20261119.md, section 3.1). `issued_by` is left out for a viewer who may not see staff identity. */
export type InventoryCheckTask = {
  id: string
  branch_id: number
  title: string
  status: 'open' | 'closed'
  revision: number
  issued_at: string
  issued_by?: string
  closed_at: string | null
  total: number
  done: number
  removed: number
  selection: { kind: 'ids' } | { kind: 'filters'; filters: Record<string, string> } | null
  picked_up_by: string | null
  picked_up_at: string | null
  mine: boolean
  pickup_session_id?: string
  /** The Worker's note on a task reopened because a count it relied on was taken back (absent from a Worker that does not send it; `by` only for a viewer who may see staff identity). */
  reopened?: { at: string; reason: string; by?: string }
  can_pickup: boolean
  can_release: boolean
  can_close: boolean
}
export type InventoryCheckTasksAnswer = {
  branchId: number
  version: string
  items: InventoryCheckTask[]
  capabilities: { issue: boolean; work: boolean; maxProducts: number; maxOpenTasks: number }
}
/** What an issue names: the ids the admin chose, or the list's own filters (resolved by the Worker). */
export type InventoryCheckTaskScope = { productIds: number[] } | { filters: Record<string, string> }
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
  /** ic_lot_counts: what the count typed per received date (the approval is applied date by date). */
  lot_lines?: InventoryCheckObservation['lot_lines']
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
export function readInventoryCheckOverlay<T>(params: { branchId: number | string; ids: Array<number | string>; lots?: boolean; /** false: the page already holds the branch's figures, so the server need not build them (summary=0). */ summary?: boolean }, signal?: AbortSignal): Promise<T> {
  return apiFetch('GET', appendQuery(`${base}/overlay`, buildQueryString({ branchId: params.branchId, ids: params.ids.join(','), ...(params.lots ? { lots: 1 } : {}), ...(params.summary === false ? { summary: 0 } : {}) })), undefined, undefined, { signal })
}

/** ic_lot_counts: ONE product's batches at ONE branch, read only when its count popover opens (never for a page of rows). Answers 404 while the switch is OFF. */
export function readInventoryCheckLots(params: { productId: number | string; branchId: number | string }, signal?: AbortSignal): Promise<InventoryCheckLotsAnswer> {
  return apiFetch('GET', appendQuery(`${base}/lots`, buildQueryString({ productId: params.productId, branchId: params.branchId })), undefined, undefined, { signal })
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
  /** The task this count is for (the task view): part of the request's identity. */
  taskId?: string
  /** Names the session in History (a count recorded after a Set from the row says so). */
  title?: string
  /** A line is a product's one count, or (ic_lot_counts) the counts typed per received date, each with the figure it showed. */
  lines: Array<{ productId: number; countedQuantity: number; seenQuantity: number | null; checked: boolean; note?: string }
    | { productId: number; lots: Array<{ batchId: number; scope: 'lot' | 'branch'; counted: number; seen: number | null }>; checked: boolean; note?: string }>
}
export function submitInventoryCheckCounts(scope: InventoryCheckWriteScope, input: InventoryCheckSubmission): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; created: boolean; /** Present when the submission named a task: whether it closed it. */ task?: { id: string; closed: boolean }; closedTasks?: string[] }> {
  if (scope.context.sessionId) throw new Error('Counts are submitted from the list, not from inside a session.')
  if (!Number.isSafeInteger(input.branchId) || input.branchId < 1) throw new Error('Choose a branch before submitting counts.')
  return write(scope, `${base}/submissions`, 'POST', input)
}

/** Approve, reject or close the open session's submitted count. Approving is repeated with the SAME requestId until the answer says done; closing ends an approval that cannot be finished (no stock moves). */
export function decideInventoryCheckApproval(scope: InventoryCheckWriteScope, input: { decision: 'approve' | 'reject' | 'close'; requestId: string; /** Approve only: accept these lines and leave the rest open. */ productIds?: number[] }): Promise<InventoryCheckApprovalDecision> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, `${sessionPath(scope.context.sessionId)}/approval`, 'POST', input)
}

/** Reject, modify or reopen ONE line of the open session's pending approval. One request, replay-safe under its requestId; the answer carries the new approval. */
export function decideInventoryCheckLine(scope: InventoryCheckWriteScope, input: { productId: number; action: 'reject' | 'modify' | 'reopen'; counted?: number; lots?: Array<{ batchId: number; counted: number }>; note?: string; requestId: string }): Promise<InventoryCheckLineAnswer> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, `${sessionPath(scope.context.sessionId)}/approval/lines`, 'POST', input)
}

export function changeInventoryCheckSession(scope: InventoryCheckWriteScope, action: 'close' | 'resume', expectedRevision: number, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  if (!scope.context.sessionId) throw new Error('An Inventory session is required.')
  return write(scope, sessionPath(scope.context.sessionId), 'PATCH', { action, expectedRevision, requestId })
}

/** The branch's count tasks: every open one, then the latest closed ones. 404 while the list switch is off (the page then shows no Tasks). */
export function readInventoryCheckTasks(branchId: string | number, signal?: AbortSignal): Promise<InventoryCheckTasksAnswer> {
  return apiFetch('GET', appendQuery(`${base}/tasks`, buildQueryString({ branchId })), undefined, undefined, { signal })
}

const taskPath = (id: string) => `${base}/tasks/${encodeURIComponent(id)}`

/** Issue a count task: exactly one of the chosen ids and the list's filters. One request; a repeat of the same request id answers the same task. */
export function issueInventoryCheckTask(scope: InventoryCheckWriteScope, input: { branchId: number; requestId: string; scope: InventoryCheckTaskScope }): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; created: boolean }> {
  if (!Number.isSafeInteger(input.branchId) || input.branchId < 1) throw new Error('Choose a branch before issuing a task.')
  return write(scope, `${base}/tasks`, 'POST', { branchId: input.branchId, requestId: input.requestId, ...input.scope })
}

export function pickupInventoryCheckTask(scope: InventoryCheckWriteScope, taskId: string, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; created: boolean }> {
  return write(scope, `${taskPath(taskId)}/pickup`, 'POST', { requestId })
}

export function releaseInventoryCheckTask(scope: InventoryCheckWriteScope, taskId: string, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt; released: boolean }> {
  return write(scope, `${taskPath(taskId)}/release`, 'POST', { requestId })
}

/** Close a task by hand: the existing close, with the task's own revision from the board. It needs no selected session. */
export function closeInventoryCheckTask(scope: InventoryCheckWriteScope, taskId: string, expectedRevision: number, requestId: string): Promise<{ item: InventoryCheckSession; receipt: InventoryCheckReceipt }> {
  return write(scope, sessionPath(taskId), 'PATCH', { action: 'close', expectedRevision, requestId })
}
