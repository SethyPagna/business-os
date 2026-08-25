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
  summary?: string | null
  requestedBy?: number | null
  requestedByName?: string | null
}

// Inserts a new open pending-action row. Returns the created row's id.
// Never throws on a malformed payload -- JSON.stringify only fails on a
// circular structure, which no caller in this codebase should ever pass
// (a write route's own request body, already parsed from real JSON).
export async function createPendingAction(env: Env, input: CreatePendingActionInput): Promise<number> {
  const db = getDb(env)
  const payloadJson = JSON.stringify(input.payload ?? {})
  const result = await db.prepare(`
    INSERT INTO pending_actions (
      section, action_type, entity_type, entity_id, payload_json, summary,
      status, requested_by, requested_by_name
    ) VALUES (
      @section, @action_type, @entity_type, @entity_id, @payload_json, @summary,
      'open', @requested_by, @requested_by_name
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
  })
  if (result.lastInsertRowid) return result.lastInsertRowid
  // Fallback for a fake/test D1 adapter that doesn't populate
  // meta.last_row_id -- real D1 always does, so this branch is
  // test-harness-only.
  const row = await db.prepare('SELECT id FROM pending_actions ORDER BY id DESC LIMIT 1').get<{ id: number }>()
  return row?.id ?? 0
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

export async function listPendingActions(env: Env, options: ListPendingActionsOptions = {}): Promise<PendingActionRow[]> {
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
    SELECT * FROM pending_actions ${where} ORDER BY created_at DESC, id DESC
  `).all<PendingActionRow>(params)
  return rows ?? []
}

export async function getPendingAction(env: Env, id: number): Promise<PendingActionRow | null> {
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM pending_actions WHERE id = @id').get<PendingActionRow>({ id })
  return row ?? null
}

export interface ReviewPendingActionInput {
  reviewedBy?: number | null
  reviewedByName?: string | null
  rejectReason?: string | null
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
