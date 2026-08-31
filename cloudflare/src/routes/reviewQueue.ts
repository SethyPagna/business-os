import { Hono } from 'hono'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, getPermissionTier } from '../lib/permissions'
import { audit } from '../lib/audit'
import { broadcast } from '../durable-objects/broadcastHub'
import {
  listPendingActions,
  getPendingAction,
  markPendingActionApproved,
  markPendingActionRejected,
  resubmitPendingAction,
  type PendingActionStatus,
} from '../lib/pendingActions'
import { applyApprovedPendingAction, NoReviewApplierError } from '../lib/reviewApply'
import type { Env } from '../index'

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

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

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
  const rows = await listPendingActions(c.env, { status, requestedBy: Number(user.id) })
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
    // An edited payload is optional: resubmitting unchanged ("please look
    // again") is legitimate, e.g. when the rejection was a misunderstanding.
    if (body && Object.prototype.hasOwnProperty.call(body, 'payload') && body.payload !== undefined) {
      payloadJson = JSON.stringify(body.payload)
    }
    summary = typeof body?.summary === 'string' ? body.summary : null
  } catch {
    payloadJson = null
  }

  const ok = await resubmitPendingAction(c.env, id, { requestedBy: Number(user.id), payloadJson, summary })
  // One response for "not yours", "doesn't exist" and "not in a rejected
  // state" -- distinguishing them would confirm the existence of other
  // people's rows to someone probing ids.
  if (!ok) return c.json({ error: 'That request is not yours, or is not awaiting resubmission.' }, 404)

  const row = await getPendingAction(c.env, id)
  await audit(c.env, user.id, user.name || user.username, 'resubmit', 'pending_action', id, row)
  // Same channel the approve/reject handlers broadcast on, so an admin with
  // the Review page open sees it return to their queue without a refresh.
  await broadcast(c.env, 'pendingActions', { id, status: 'open' })
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
  const rows = await listPendingActions(c.env, { status, section })
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
  if (row.status !== 'open') return c.json({ error: 'Already reviewed' }, 409)

  try {
    await applyApprovedPendingAction(c.env, row, { id: user.id, name: user.name || user.username || null })
  } catch (err) {
    if (err instanceof NoReviewApplierError) {
      return c.json({ error: err.message, code: 'no_review_applier' }, 501)
    }
    return c.json({ error: (err as Error).message || 'Failed to apply the approved change' }, 500)
  }

  const ok = await markPendingActionApproved(c.env, id, {
    reviewedBy: user.id,
    reviewedByName: user.name || user.username,
  })
  if (!ok) return c.json({ error: 'Already reviewed or not found' }, 409)
  const updatedRow = await getPendingAction(c.env, id)
  await audit(c.env, user.id, user.name || user.username, 'approve', 'pending_action', id, updatedRow)
  await broadcast(c.env, 'pendingActions', { id, status: 'approved' })
  return c.json({ success: true, data: updatedRow })
})

app.post('/:id/reject', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')
  // View-only reviewers can read the queue but not act on it (Part 557 slice 5).
  if (!hasPermission(user, 'review')) return c.json({ error: 'Forbidden' }, 403)
  let reason: string | null = null
  try {
    const body = await c.req.json<{ reason?: string }>()
    reason = body?.reason ?? null
  } catch {
    reason = null
  }
  const ok = await markPendingActionRejected(c.env, id, {
    reviewedBy: user.id,
    reviewedByName: user.name || user.username,
    rejectReason: reason,
  })
  if (!ok) return c.json({ error: 'Already reviewed or not found' }, 409)
  const row = await getPendingAction(c.env, id)
  await audit(c.env, user.id, user.name || user.username, 'reject', 'pending_action', id, row)
  await broadcast(c.env, 'pendingActions', { id, status: 'rejected' })
  return c.json({ success: true, data: row })
})

export default app
