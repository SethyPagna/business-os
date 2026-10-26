// Core logic for the Review Required permission tier's approval queue
// (migrations/0025_pending_actions.sql). This is step (1) of the
// "Permissions UI redesign" item in progress.md -- the queue itself, not
// yet wired into any write route (step 2, still open) or a frontend
// approval page (step 3, still open).
//
// Deliberately kept generic: a pending row doesn't know or care what kind
// of write it represents beyond `section`/`action_type`/`entity_type` --
// the actual re-application of an approved row's payload is each write
// route's own job once step (2) wires it in (this file has no
// knowledge of products/inventory/contacts-specific write logic, and
// should not grow any).

import { getDb } from './db'
import type { Env } from '../index'

export type PendingActionStatus = 'open' | 'approved' | 'rejected'

export interface PendingActionRow {
  id: number
  section: string
  action_type: string
  entity_type: string
  entity_id: number | null
  payload_json: string
  expected_entity_state_json?: string | null
  summary: string | null
  status: PendingActionStatus
  requested_by: number | null
  requested_by_name: string | null
  reviewed_by: number | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string
}

export interface CreatePendingActionInput {
  section: string
  actionType: string
  entityType: string
  entityId?: number | null
  payload: unknown
  expectedEntityStateJson?: string
  summary?: string | null
  requestedBy?: number | null
  requestedByName?: string | null
  /** The client's retry key; defaults to payload.client_request_id. See createPendingActionOnce. */
  clientRequestId?: string | null
}

// Inserts a new open pending-action row. Returns the created row's id.
// Never throws on a malformed payload -- JSON.stringify only fails on a
// circular structure, which no caller in this codebase should ever pass
// (a write route's own request body, already parsed from real JSON).
export async function createPendingAction(env: Env, input: CreatePendingActionInput): Promise<number> {
  return (await createPendingActionOnce(env, input)).id
}

// F5: the retry key. An explicit input.clientRequestId wins; otherwise the payload's own client_request_id (the
// write routes queue the request body they received). Only a non-empty string of sane length counts.
function pendingRequestKey(input: CreatePendingActionInput): string | null {
  const explicit = input.clientRequestId
  const fromPayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? (input.payload as Record<string, unknown>).client_request_id : undefined
  const key = typeof explicit === 'string' ? explicit : typeof fromPayload === 'string' ? fromPayload : ''
  const trimmed = key.trim()
  return trimmed && trimmed.length <= 200 ? trimmed : null
}

// Idempotent insert. A retry of the same request (same requester, same target, same client_request_id) returns the
// row the first attempt queued and reports created=false, so the caller sends no second alert. The existence test and
// the insert are ONE statement (INSERT ... SELECT ... WHERE NOT EXISTS), so two retries racing each other cannot both
// insert; no unique index (and so no migration) is needed. A request without a key is always a new row.
export async function createPendingActionOnce(env: Env, input: CreatePendingActionInput): Promise<{ id: number; created: boolean }> {
  const db = getDb(env)
  const payloadJson = JSON.stringify(input.payload ?? {})
  const requestKey = pendingRequestKey(input)
  const params: Record<string, unknown> = {
    section: input.section,
    action_type: input.actionType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    payload_json: payloadJson,
    summary: input.summary ?? null,
    requested_by: input.requestedBy ?? null,
    requested_by_name: input.requestedByName ?? null,
    ...(input.expectedEntityStateJson === undefined ? {} : { expected_entity_state_json: input.expectedEntityStateJson }),
  }
  if (requestKey && input.requestedBy != null) {
    const sameRequest = `requested_by = @requested_by AND section = @section AND action_type = @action_type
      AND entity_type = @entity_type AND entity_id IS @entity_id
      AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.client_request_id') END = @request_key`
    const inserted = await db.prepare(`
      INSERT INTO pending_actions (
        section, action_type, entity_type, entity_id, payload_json, summary,
        status, requested_by, requested_by_name${input.expectedEntityStateJson === undefined ? '' : ', expected_entity_state_json'}
      ) SELECT
        @section, @action_type, @entity_type, @entity_id, @payload_json, @summary,
        'open', @requested_by, @requested_by_name${input.expectedEntityStateJson === undefined ? '' : ', @expected_entity_state_json'}
      WHERE NOT EXISTS (SELECT 1 FROM pending_actions WHERE ${sameRequest})
    `).run({ ...params, request_key: requestKey })
    if (inserted.changes > 0) {
      if (inserted.lastInsertRowid) return { id: inserted.lastInsertRowid, created: true }
      const row = await db.prepare(`SELECT id FROM pending_actions WHERE ${sameRequest} ORDER BY id DESC LIMIT 1`)
        .get<{ id: number }>({ section: params.section, action_type: params.action_type, entity_type: params.entity_type,
          entity_id: params.entity_id, requested_by: params.requested_by, request_key: requestKey })
      return { id: row?.id ?? 0, created: true }
    }
    const existing = await db.prepare(`SELECT id FROM pending_actions WHERE ${sameRequest} ORDER BY id ASC LIMIT 1`)
      .get<{ id: number }>({ section: params.section, action_type: params.action_type, entity_type: params.entity_type,
        entity_id: params.entity_id, requested_by: params.requested_by, request_key: requestKey })
    return { id: existing?.id ?? 0, created: false }
  }
  const result = await db.prepare(`
    INSERT INTO pending_actions (
      section, action_type, entity_type, entity_id, payload_json, summary,
      status, requested_by, requested_by_name${input.expectedEntityStateJson === undefined ? '' : ', expected_entity_state_json'}
    ) VALUES (
      @section, @action_type, @entity_type, @entity_id, @payload_json, @summary,
      'open', @requested_by, @requested_by_name${input.expectedEntityStateJson === undefined ? '' : ', @expected_entity_state_json'}
    )
  `).run({
    section: input.section,
    action_type: input.actionType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    payload_json: payloadJson,
    summary: input.summary ?? null,
    requested_by: input.requestedBy ?? null,
    requested_by_name: input.requestedByName ?? null,
    ...(input.expectedEntityStateJson === undefined ? {} : { expected_entity_state_json: input.expectedEntityStateJson }),
  })
  if (result.lastInsertRowid) return { id: result.lastInsertRowid, created: true }
  // Fallback for a fake/test D1 adapter that doesn't populate
  // meta.last_row_id -- real D1 always does, so this branch is
  // test-harness-only.
  const row = await db.prepare('SELECT id FROM pending_actions ORDER BY id DESC LIMIT 1').get<{ id: number }>()
  return { id: row?.id ?? 0, created: true }
}

export interface ListPendingActionsOptions {
  status?: PendingActionStatus | 'all'
  section?: string | null
  /**
   * Restrict to the rows this user submitted.
   *
   * This is what lets a Review Required user follow their OWN requests --
   * see the "pending"/"changes not approved" list they get -- without
   * holding the `review` permission, which would let them see (and act on)
   * everyone else's queue. The route that uses it never takes this id from
   * the request; it reads it off the session.
   */
  requestedBy?: number | null
}

/** What the pending-review tag needs to point at a record: no payload, expected state, summary or reason. */
export type PendingActionTarget = Pick<PendingActionRow,
  'id' | 'section' | 'action_type' | 'entity_type' | 'entity_id' | 'status' | 'requested_by' | 'requested_by_name' | 'created_at'>
const TARGET_COLUMNS = 'id, section, action_type, entity_type, entity_id, status, requested_by, requested_by_name, created_at'

export function listPendingActions(env: Env, options: ListPendingActionsOptions = {}): Promise<PendingActionRow[]> {
  return selectPendingActions<PendingActionRow>(env, options, '*')
}

export function listPendingActionTargets(env: Env, options: ListPendingActionsOptions = {}): Promise<PendingActionTarget[]> {
  return selectPendingActions<PendingActionTarget>(env, options, TARGET_COLUMNS)
}

async function selectPendingActions<Row>(env: Env, options: ListPendingActionsOptions, columns: string): Promise<Row[]> {
  const db = getDb(env)
  const status = options.status ?? 'open'
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  if (status !== 'all') {
    clauses.push('status = @status')
    params.status = status
  }
  if (options.section) {
    clauses.push('section = @section')
    params.section = options.section
  }
  if (options.requestedBy != null) {
    clauses.push('requested_by = @requestedBy')
    params.requestedBy = options.requestedBy
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = await db.prepare(`
    SELECT ${columns} FROM pending_actions ${where} ORDER BY created_at DESC, id DESC
  `).all<Row>(params)
  return rows ?? []
}

export async function getPendingAction(env: Env, id: number): Promise<PendingActionRow | null> {
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM pending_actions WHERE id = @id').get<PendingActionRow>({ id })
  return row ?? null
}

// K7: one cap for a reviewer's reject reason, the same number and the same
// measure (code units, reason.length) as every stock reason
// (lib/stockReason.ts STOCK_REASON_MAX_LENGTH); scripts/test-fees-k-parity-pure.cjs
// pins the two equal. Refused with 400 reason_too_long, never truncated.
export const REVIEW_REASON_MAX_LENGTH = 512

export interface ReviewPendingActionInput {
  reviewedBy?: number | null
  reviewedByName?: string | null
  rejectReason?: string | null
}

export function pendingActionApprovalStatements(row: PendingActionRow, input: ReviewPendingActionInput) {
  const fields = ['section', 'action_type', 'entity_type', 'entity_id', 'payload_json', 'summary', 'requested_by', 'requested_by_name', 'reviewed_by', 'reviewed_by_name', 'reviewed_at', 'reject_reason', 'created_at', 'updated_at'] as const
  return [{
    sql: `UPDATE pending_actions SET status='approved', reviewed_by=@reviewedBy, reviewed_by_name=@reviewedByName,
      reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=@id AND status='open' AND ${fields.map(field => `${field} IS @before_${field}`).join(' AND ')}`,
    params: { id: row.id, reviewedBy: input.reviewedBy ?? null, reviewedByName: input.reviewedByName ?? null,
      ...Object.fromEntries(fields.map(field => [`before_${field}`, row[field] ?? null])) },
  }, {
    sql: `SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[1]', '$[product_create_review_conflict]') END`,
    params: {},
  }]
}

// Marks a row approved. Does NOT re-apply the payload against the real
// write path -- that's the caller's job (the route that owns this
// section's actual write logic), matching this file's own "generic
// queue, no entity-specific knowledge" scope note above. Returns false
// if the row doesn't exist or is no longer open (already
// reviewed by someone else -- caller should treat this as a conflict,
// not silently re-approve).
export async function markPendingActionApproved(env: Env, id: number, input: ReviewPendingActionInput): Promise<boolean> {
  const db = getDb(env)
  const result = await db.prepare(`
    UPDATE pending_actions
    SET status = 'approved', reviewed_by = @reviewed_by, reviewed_by_name = @reviewed_by_name,
        reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND status = 'open'
  `).run({
    id,
    reviewed_by: input.reviewedBy ?? null,
    reviewed_by_name: input.reviewedByName ?? null,
  })
  return result.changes > 0
}

export async function markPendingActionRejected(env: Env, id: number, input: ReviewPendingActionInput): Promise<boolean> {
  const db = getDb(env)
  const result = await db.prepare(`
    UPDATE pending_actions
    SET status = 'rejected', reviewed_by = @reviewed_by, reviewed_by_name = @reviewed_by_name,
        reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, reject_reason = @reject_reason
    WHERE id = @id AND status = 'open'
  `).run({
    id,
    reviewed_by: input.reviewedBy ?? null,
    reviewed_by_name: input.reviewedByName ?? null,
    reject_reason: input.rejectReason ?? null,
  })
  return result.changes > 0
}

export async function countOpenPendingActions(env: Env): Promise<number> {
  const db = getDb(env)
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM pending_actions WHERE status = 'open'`).get<{ n: number }>()
  return row?.n ?? 0
}

/**
 * Put a rejected request back in front of the reviewers, optionally with a
 * revised payload.
 *
 * A rejection is deliberately NOT a delete: the row stays, carrying the
 * reviewer's reason, so the submitter can read why, fix the problem and ask
 * again. This reopens that same row rather than creating a second one, so
 * the request keeps one identity through however many rounds it takes --
 * `reject_reason` is cleared (it belonged to the round just superseded) but
 * the audit log retains every transition.
 *
 * Guarded on BOTH `id` and `requested_by` in the UPDATE itself, not by a
 * read-then-write check, so one person can never reopen another's rejected
 * request even by guessing an id -- and only from 'rejected', so this can
 * never resurrect something already approved and applied.
 */
export async function resubmitPendingAction(
  env: Env,
  id: number,
  input: { requestedBy: number; payloadJson?: string | null; summary?: string | null },
): Promise<boolean> {
  const db = getDb(env)
  const result = await db.prepare(`
    UPDATE pending_actions
    SET status = 'open',
        reviewed_by = NULL,
        reviewed_by_name = NULL,
        reviewed_at = NULL,
        reject_reason = NULL,
        payload_json = COALESCE(@payload_json, payload_json),
        summary = COALESCE(@summary, summary),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND requested_by = @requested_by AND status = 'rejected'
  `).run({
    id,
    requested_by: input.requestedBy,
    payload_json: input.payloadJson ?? null,
    summary: input.summary ?? null,
  })
  return result.changes > 0
}
