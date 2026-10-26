import { productStockGuardError } from '../lib/productStockGuard'
import { Hono } from 'hono'
import { acquisitionCostResponses, hasAcquisitionCostInput } from '../lib/acquisitionCostAccess'
import { productCreateErrorResponse, hasProductMoneyPolicy, ProductMoneyWriteError } from '../lib/productWrites'
import { branchRedirectTarget } from '../lib/branchRedirectWrite'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getActionTier, getPermissionTier } from '../lib/permissions'
import { audit } from '../lib/audit'
import { broadcast } from '../durable-objects/broadcastHub'
import {
  listPendingActions,
  listPendingActionTargets,
  type ListPendingActionsOptions,
  getPendingAction,
  type PendingActionRow,
  markPendingActionApproved,
  markPendingActionRejected,
  resubmitPendingAction,
  REVIEW_REASON_MAX_LENGTH,
  type PendingActionStatus,
} from '../lib/pendingActions'
import { applyApprovedPendingAction, FeeReviewStaleError, NoReviewApplierError, productRemovePendingPointer, ReviewDecisionConflictError, ReviewRequesterPermissionError, recoverApprovedBranchAction, type ReviewerInfo } from '../lib/reviewApply'
import type { ReviewAlertEvent, ReviewAlertHook } from '../lib/reviewAlert'
import { ProductImageAssetError } from '../lib/productImagePermission'
import { ProductRemoveError } from '../lib/productDelete'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'
import { getDb } from '../lib/db'
import { reviewApprovalPermissionError } from '../lib/reviewApprovalPermission'
import { normalizeProductDiscountBody, ProductDiscountInputError } from '../lib/productDiscountGate'
import { assertBranchExpectedState, BranchEditConflictError, BranchApprovalReceiptError } from '../lib/branchWrites'
import type { BranchIdentitySnapshot } from '../lib/canonicalBranchIdentity'

// The Review/Approval page itself -- see progress.md's "Permissions UI
// redesign" item. Gated Full Access only, same pattern Users already
// uses (a flat on/off, no partial tier for the review page itself).
// Deliberately no fallback to any other permission key -- reviewing and
// approving other people's pending writes is at least as sensitive as
// the sections those writes touch, so it needs its own explicit grant.
//
// POST /:id/approve now actually replays the row's payload against the
// real write path (lib/reviewApply.ts), for the sections that have a
// registered applier -- previously (Part 146's first pass) this route
// only ever flipped the row's own status. The apply runs BEFORE the
// status update, deliberately: if applyApprovedPendingAction throws (no
// applier registered yet for this section/action/entity combination, or
// the underlying write itself fails), the row is left `open` rather than
// being marked approved without the real change having happened -- a
// reviewer sees a 500 and can retry once the cause is fixed, instead of
// the queue silently lying about what it did. Known, accepted race
// window (documented rather than hidden): if two reviewers approve the
// same row at nearly the same instant, both could pass the `status =
// 'open'` read here before either write lands, so the underlying write
// could theoretically run twice before markPendingActionApproved's own
// atomic `WHERE status = 'open'` guard rejects the second status update.
// D1 has no cross-statement locking primitive this route could take
// instead; this is the same level of best-effort atomicity the rest of
// this codebase already accepts for non-atomic multi-step writes (see
// e.g. lib/productBatches.ts's receiveBatchStock's own comment on
// routes/returns.ts's restock not being atomic with its return-items
// insert) rather than a new, worse gap introduced here.

// Coded refusals (EN text is the direct-API fallback; the Review page maps the
// codes to the translated sentences review_self_approval / review_section_full_required).
const REVIEW_SELF_APPROVAL_CODE = 'review_self_approval'
const REVIEW_SELF_APPROVAL_MESSAGE = 'You cannot approve your own request. Another reviewer must approve it.'
const REVIEW_SECTION_FULL_CODE = 'review_section_full_required'
const reviewSectionFullMessage = (section: string): string =>
  `Approving this request needs Full access to ${section}. Ask a reviewer who has it.`

// A global hook, not an import: many tests load this route with hand-written require tables, and an absent hook is a no-op.
// Every alert is sent after the write it announces committed, never on a replay, a refusal or a 409.
const reviewAlertHook = (): ReviewAlertHook | undefined =>
  (globalThis as unknown as Record<symbol, ReviewAlertHook | undefined>)[Symbol.for('business-os.review-alert.v1')]
async function announceReview(env: Env, event: ReviewAlertEvent): Promise<void> {
  try { await reviewAlertHook()?.announce(env, event) } catch { /* an alert never fails the decision it announces */ }
}
// An expense delete removes the record the alert names, so its name is read before the change; other kinds read none.
async function reviewNameBeforeChange(env: Env, row: PendingActionRow): Promise<string | null> {
  try { return (await reviewAlertHook()?.nameBeforeChange(env, row)) ?? null } catch { return null }
}

// An applier refuses on purpose with an Error named 'ReviewCodedRefusal' (string `code`, `status` 403/409/503, optional
// plain-object `details`). Matched by name and shape, not class, so an unrelated error is never mistaken for one and still
// falls through to the generic 500. `details` is spread first so it cannot overwrite success, error or code.
type ReviewMergedInto = { survivorId?: number; survivorName?: string | null; mergedName?: string | null }
function reviewCodedRefusal(err: unknown): { body: Record<string, unknown>; status: 403 | 409 | 503 } | null {
  if (!(err instanceof Error) || err.name !== 'ReviewCodedRefusal') return null
  const { code, status, details } = err as Error & { code?: unknown; status?: unknown; details?: unknown }
  if (typeof code !== 'string' || !code) return null
  if (status !== 403 && status !== 409 && status !== 503) return null
  const extra = details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {}
  return { body: { ...extra, success: false, error: err.message, code }, status }
}

// F3: ?fields= is 'targets' or absent. An empty value (?fields=) and a repeated parameter (?fields=targets&fields=targets)
// are refused, not read as absent or as the first value.
const INVALID_FIELDS_BODY = { success: false, code: 'invalid_fields', error: "fields must be 'targets' or left out." } as const
function readFieldsParam(values: string[] | undefined): 'targets' | undefined | 'invalid' {
  if (values === undefined) return undefined
  return values.length === 1 && values[0] === 'targets' ? 'targets' : 'invalid'
}

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', acquisitionCostResponses)

// --- submitter's own view (NO `review` permission required) ---------------
//
// These two routes are declared BEFORE the `review` gate below, and that
// ordering is the whole point: a Review Required user must be able to
// follow the requests THEY submitted -- see them sitting pending, read why
// one was turned down, and ask again -- without holding `review`, which
// would let them approve other people's writes, including their own.
//
// Both scope strictly to the session's own user id. Neither takes a user id
// from the request, and the resubmit guard is part of the UPDATE's WHERE
// clause rather than a read-then-write check (see resubmitPendingAction),
// so another person's row is not merely hidden here, it is unreachable.

app.get('/mine', async (c) => {
  const user = c.get('user')
  const statusParam = c.req.query('status')
  const status = (statusParam === 'approved' || statusParam === 'rejected' || statusParam === 'open')
    ? (statusParam as PendingActionStatus)
    : 'all'
  // Defaults to 'all' rather than 'open' (the reviewer list's default): the
  // submitter's question is "what happened to my requests?", and the
  // rejected ones -- the only place the reviewer's reason is visible -- are
  // exactly the rows they most need to see.
  const fields = readFieldsParam(c.req.queries('fields'))
  if (fields === 'invalid') return c.json(INVALID_FIELDS_BODY, 400)
  const options: ListPendingActionsOptions = { status, requestedBy: Number(user.id) }
  const rows = fields === 'targets' ? await listPendingActionTargets(c.env, options) : await listPendingActions(c.env, options)
  return c.json({ success: true, data: rows })
})

app.post('/:id/resubmit', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')

  let payloadJson: string | null = null
  let summary: string | null = null
  try {
    const body = await c.req.json<{ payload?: unknown; summary?: string }>()
    if (hasAcquisitionCostInput({ payload_json: body.payload }, user)) {
      return c.json({ error: 'Cost-entry permission is required to submit cost changes.', code: 'product_cost_edit_required' }, 403)
    }
    // An edited payload is optional: resubmitting unchanged ("please look
    // again") is legitimate, e.g. when the rejection was a misunderstanding.
    if (body && Object.prototype.hasOwnProperty.call(body, 'payload') && body.payload !== undefined) {
      payloadJson = JSON.stringify(body.payload)
    }
    summary = typeof body?.summary === 'string' ? body.summary : null
  } catch {
    payloadJson = null
  }

  if (payloadJson != null) {
    const existing = await getPendingAction(c.env, id)
    if (!existing || existing.requested_by !== Number(user.id)) {
      return c.json({ error: 'That request is not yours, or is not awaiting resubmission.' }, 404)
    }
    if (productRemovePendingPointer(existing)) {
      return c.json({ error: 'A product removal approval pointer cannot be edited. Submit a new removal request instead.' }, 400)
    }
    if (existing.section === 'products' && existing.entity_type === 'product') {
      let oldPayload: unknown
      try { oldPayload = JSON.parse(existing.payload_json || '{}') } catch { oldPayload = null }
      if (!hasProductMoneyPolicy(oldPayload) && hasProductMoneyPolicy(JSON.parse(payloadJson))) {
        return c.json({ error: 'A product price plan must be created by a new product edit.', code: 'product_money_plan_immutable' }, 409)
      }
      if (hasProductMoneyPolicy(oldPayload)) {
        const stable = (value: unknown): string => JSON.stringify(value, (_key, part) =>
          part && typeof part === 'object' && !Array.isArray(part)
            ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part)
        if (stable(oldPayload) !== stable(JSON.parse(payloadJson))) {
          return c.json({ error: 'A saved product price plan cannot be edited. Submit a new product edit; unchanged resubmission is allowed.', code: 'product_money_plan_immutable' }, 409)
        }
      }
      // OPUS-H-7: a resubmitted product payload is held to the same canonical discount block as a new edit
      // (after the plan checks, which compare what the requester sent with what was saved).
      const nextPayload = JSON.parse(payloadJson) as unknown
      if (nextPayload && typeof nextPayload === 'object' && !Array.isArray(nextPayload)) {
        const invalidDiscount = normalizeProductDiscountBody(nextPayload as Record<string, unknown>)
        if (invalidDiscount) return c.json(invalidDiscount, 400)
        payloadJson = JSON.stringify(nextPayload)
      }
    }
  }

  const existing = await getPendingAction(c.env, id)
  if (existing?.requested_by === Number(user.id) && existing.section === 'branches'
    && existing.action_type === 'update' && existing.entity_type === 'branch') {
    try {
      const current = await getDb(c.env).prepare('SELECT * FROM branches WHERE id = @id')
        .get<BranchIdentitySnapshot>({ id: existing.entity_id })
      if (!current) throw new BranchEditConflictError()
      assertBranchExpectedState(current, existing.expected_entity_state_json)
    } catch (error) {
      if (error instanceof BranchEditConflictError) {
        return c.json({ success: false, error: error.message, code: error.code, conflict: true }, 409)
      }
      throw error
    }
  }
  const ok = await resubmitPendingAction(c.env, id, { requestedBy: Number(user.id), payloadJson, summary })
  // One response for "not yours", "doesn't exist" and "not in a rejected
  // state" -- distinguishing them would confirm the existence of other
  // people's rows to someone probing ids.
  if (!ok) return c.json({ error: 'That request is not yours, or is not awaiting resubmission.' }, 404)

  const row = await getPendingAction(c.env, id)
  await audit(c.env, user.id, actorSnapshot(user), 'resubmit', 'pending_action', id, row)
  // Same channel the approve/reject handlers broadcast on, so an admin with
  // the Review page open sees it return to their queue without a refresh.
  c.executionCtx.waitUntil(broadcast(c.env, 'pendingActions', { id, status: 'open' }))
  // Its UPDATE is guarded on the requester and on 'rejected', so only the request that reopened the row gets here.
  if (row) await announceReview(c.env, { kind: 'resubmitted', row })
  return c.json({ success: true, data: row })
})

// --- reviewer routes -------------------------------------------------------
// 'review' is a VIEW_TIER section (Part 557 slice 5): a 'view' grant can READ
// the pending queue (GET / and GET /:id below) but cannot act on it. This gate
// admits view OR full (tier != none); the two WRITES (approve/reject) re-check
// strict hasPermission('review') (=== true) individually, which a 'view' value
// fails -- so a view reviewer watches the queue without approving anyone's
// changes (including their own).
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (getPermissionTier(user, 'review') === 'none') return c.json({ error: 'Forbidden' }, 403)
  await next()
})

app.get('/', async (c) => {
  const statusParam = c.req.query('status')
  const status = (statusParam === 'all' || statusParam === 'approved' || statusParam === 'rejected' || statusParam === 'open')
    ? (statusParam as PendingActionStatus | 'all')
    : 'open'
  const section = c.req.query('section') || null
  const fields = readFieldsParam(c.req.queries('fields'))
  if (fields === 'invalid') return c.json(INVALID_FIELDS_BODY, 400)
  const options: ListPendingActionsOptions = { status, section }
  const rows = fields === 'targets' ? await listPendingActionTargets(c.env, options) : await listPendingActions(c.env, options)
  return c.json({ success: true, data: rows })
})

app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const row = await getPendingAction(c.env, id)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true, data: row })
})

app.post('/:id/approve', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')
  // View-only reviewers can read the queue but not act on it (Part 557 slice 5).
  if (!hasPermission(user, 'review')) return c.json({ error: 'Forbidden' }, 403)

  const row = await getPendingAction(c.env, id)
  if (!row) return c.json({ error: 'Not found' }, 404)
  // N12: the queue exists so a second person checks a write. Nobody approves
  // their own request, whatever their grants (a reviewer who also holds a
  // Review Required tier elsewhere could otherwise queue and approve the same
  // change), and an approval replays a write in the row's section with the
  // reviewer's authority, so the reviewer needs Full access to that section.
  // Reject is deliberately not blocked: a requester withdrawing their own request is harmless.
  if (row.requested_by != null && Number(row.requested_by) === Number(user.id)) {
    return c.json({ error: REVIEW_SELF_APPROVAL_MESSAGE, code: REVIEW_SELF_APPROVAL_CODE }, 403)
  }
  if (getPermissionTier(user, row.section) !== 'full') {
    return c.json({ error: reviewSectionFullMessage(row.section), code: REVIEW_SECTION_FULL_CODE, section: row.section }, 403)
  }
  const productRemoveApproval = productRemovePendingPointer(row) != null
  if (productRemoveApproval && getActionTier(user, 'products', 'delete') !== 'full') {
    return c.json({ error: 'Full product removal permission is required to approve this request.' }, 403)
  }
  let pendingActionMarkedAtomically = false
  let recordNameBefore: string | null = null
  let mergedInto: ReviewMergedInto | undefined
  let restUnapplied: string[] = []
  try {
    // Finding H: the reviewer's CURRENT grant for this exact action and for each of its effects (price,
    // cost, image), checked before any receipt replay or write (lib/reviewApprovalPermission.ts).
    const refusal = await reviewApprovalPermissionError(c.env, user, row, productRemoveApproval)
    if (refusal) return c.json(refusal.body, refusal.status)
    if (row.status !== 'open') {
      if (row.status === 'approved' && row.section === 'branches' && row.action_type === 'update' && row.entity_type === 'branch') {
        try {
          const receipt = await recoverApprovedBranchAction(c.env, row, user.id)
          if (receipt) return c.json({ success: true, data: receipt, replayed: true })
        } catch (error) {
          if (error instanceof BranchApprovalReceiptError) return c.json({ success: false, error: error.message, code: error.code,
            ...(error.code === 'unknown_outcome' ? { action: 'retry_same_request' } : {}) }, error.status)
          throw error
        }
      }
      if (productRemoveApproval && row.status === 'approved') {
        return c.json({ success: true, data: row, replayed: true })
      }
      return c.json({ error: 'Already reviewed' }, 409)
    }

    recordNameBefore = await reviewNameBeforeChange(c.env, row)
    // { "confirm_merge_into": <product id> } names the survivor the reviewer saw; anything else (no body, not JSON, not a
    // positive integer) is "not confirmed" and passed on as absent. The extended type keeps the extra property from being
    // an excess-property error against ReviewerInfo.
    const confirmBody = await c.req.json<{ confirm_merge_into?: unknown }>().catch(() => null)
    const stated = confirmBody?.confirm_merge_into
    const confirmed = typeof stated === 'number' ? stated : typeof stated === 'string' && /^\d+$/.test(stated.trim()) ? Number(stated.trim()) : NaN
    const confirmMergeInto = Number.isSafeInteger(confirmed) && confirmed > 0 ? confirmed : undefined
    const stampedFingerprint = confirmBody && typeof (confirmBody as { confirm_fingerprint?: unknown }).confirm_fingerprint === 'string'
      ? (confirmBody as { confirm_fingerprint: string }).confirm_fingerprint.slice(0, 400) : undefined
    const reviewer: ReviewerInfo & { confirmMergeInto?: number } = {
      id: user.id, name: actorSnapshot(user), redirectTarget: () => branchRedirectTarget(c),
      ...(confirmMergeInto !== undefined ? { confirmMergeInto } : {}),
      ...(stampedFingerprint !== undefined ? { confirmFingerprint: stampedFingerprint } : {}),
    }
    const outcome = await applyApprovedPendingAction(c.env, row, reviewer, user, (promise) => c.executionCtx.waitUntil(promise))
    if (outcome.replayedBranchAction) return c.json({ success: true, data: outcome.replayedBranchAction, replayed: true })
    pendingActionMarkedAtomically = outcome.pendingActionMarkedAtomically
    mergedInto = (outcome as { mergedInto?: ReviewMergedInto }).mergedInto
    restUnapplied = outcome.restUnapplied ?? []
  } catch (err) {
    const coded = reviewCodedRefusal(err)
    if (coded) return c.json(coded.body, coded.status)
    const stockError = productStockGuardError(err)
    if (stockError) return c.json({ success: false, code: stockError.code, error: stockError.message }, 409)
    // Finding I (lib/reviewApply.ts ReviewIdentityConflictError, matched by its code): the request would mint a
    // duplicate product; nothing was written and it stays open.
    if (err instanceof Error && (err as { code?: unknown }).code === 'review_identity_conflict') {
      return c.json({ success: false, error: err.message, code: 'review_identity_conflict',
        existing_product_id: (err as { existingProductId?: unknown }).existingProductId ?? null,
        existing_product_name: (err as { existingProductName?: unknown }).existingProductName ?? null }, 409)
    }
    if (row.section === 'products' && row.action_type === 'create' && row.entity_type === 'product') {
      const response = productCreateErrorResponse(err)
      if (response) return c.json(response.body, response.status)
    }
    if (err instanceof BranchApprovalReceiptError) return c.json({ success: false, error: err.message, code: err.code,
      ...(err.code === 'unknown_outcome' ? { action: 'retry_same_request' } : {}) }, err.status)
    if (err instanceof BranchEditConflictError) return c.json({ success: false, error: err.message, code: err.code, conflict: true }, 409)
    if (err instanceof ProductMoneyWriteError) return c.json({ error: err.message, code: err.code }, err.status as 400 | 409)
    if (err instanceof ProductDiscountInputError) return c.json({ error: err.message, code: err.code, field: err.field }, 400)
    if (err instanceof NoReviewApplierError) {
      return c.json({ error: err.message, code: 'no_review_applier' }, 501)
    }
    if (err instanceof ReviewRequesterPermissionError) {
      return c.json({ error: err.message, code: err.code }, 409)
    }
    if (err instanceof ProductImageAssetError) {
      return c.json({ error: err.message, code: err.code }, 409)
    }
    if (err instanceof ProductRemoveError) {
      return c.json({ error: err.message, code: err.code }, err.status)
    }
    // K3: the expense changed after the delete was requested; nothing applied, the request stays open.
    if (err instanceof FeeReviewStaleError) return c.json({ success: false, error: err.message, code: err.code, conflict: true }, 409)
    // K6: another decision won; nothing applied.
    if (err instanceof ReviewDecisionConflictError) return c.json({ error: err.message, code: err.code }, 409)
    // The one operator-worded refusal that still travels as a 500; every other unexpected failure keeps its detail server-side.
    if (err instanceof Error && (err as { code?: unknown }).code === 'canonical_branch_identity_locked') return c.json({ error: err.message, code: 'canonical_branch_identity_locked' }, 500)
    console.error('[review-queue] apply failed', err)
    return c.json({ error: 'Failed to apply the approved change' }, 500)
  }

  if (!pendingActionMarkedAtomically) {
    const ok = await markPendingActionApproved(c.env, id, {
      reviewedBy: user.id,
      reviewedByName: actorSnapshot(user),
    })
    if (!ok) return c.json({ error: 'Already reviewed or not found' }, 409)
  }
  const updatedRow = await getPendingAction(c.env, id)
  await audit(c.env, user.id, actorSnapshot(user), 'approve', 'pending_action', id, updatedRow)
  c.executionCtx.waitUntil(broadcast(c.env, 'pendingActions', { id, status: 'approved' }))
  // Only the request whose approval committed gets here: the loser of a race, and every replay, returned above.
  await announceReview(c.env, {
    kind: 'approved', row: updatedRow ?? row, by: actorSnapshot(user), recordName: recordNameBefore,
    merged: mergedInto ? { retired: mergedInto.mergedName, kept: mergedInto.survivorName } : null,
  })
  return c.json({ success: true, data: updatedRow,
    ...(mergedInto ? { merged_into: { id: mergedInto.survivorId ?? null, name: mergedInto.survivorName ?? null }, rest_unapplied: restUnapplied } : {}) })
})

app.post('/:id/reject', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')
  // View-only reviewers can read the queue but not act on it (Part 557 slice 5).
  if (!hasPermission(user, 'review')) return c.json({ error: 'Forbidden' }, 403)
  let reason: string | null = null
  try {
    const body = await c.req.json<{ reason?: unknown }>()
    const supplied = body?.reason ?? null
    // K7: a reason is text, and capped like every other reason. Refused,
    // never truncated: the request stays open.
    if (supplied !== null && typeof supplied !== 'string') return c.json({ error: 'The reason must be text.', code: 'invalid_reason' }, 400)
    reason = supplied
  } catch {
    reason = null
  }
  if (reason !== null && reason.length > REVIEW_REASON_MAX_LENGTH) {
    return c.json({ error: `Reason is too long (max ${REVIEW_REASON_MAX_LENGTH} characters)`, code: 'reason_too_long' }, 400)
  }
  const ok = await markPendingActionRejected(c.env, id, {
    reviewedBy: user.id,
    reviewedByName: actorSnapshot(user),
    rejectReason: reason,
  })
  if (!ok) return c.json({ error: 'Already reviewed or not found' }, 409)
  const row = await getPendingAction(c.env, id)
  await audit(c.env, user.id, actorSnapshot(user), 'reject', 'pending_action', id, row)
  c.executionCtx.waitUntil(broadcast(c.env, 'pendingActions', { id, status: 'rejected' }))
  // markPendingActionRejected only changes a row that is still 'open', so only the winner gets here.
  if (row) await announceReview(c.env, { kind: 'rejected', row, by: actorSnapshot(user), reason })
  return c.json({ success: true, data: row })
})

export default app
