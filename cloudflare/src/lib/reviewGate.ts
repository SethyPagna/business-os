// Step (2) of the "Permissions UI redesign" item in progress.md: the
// single call every Review-Required-gated write route makes to decide
// "apply this write directly" vs. "queue it instead". Sits between
// lib/permissions.ts's tier read (step 0, already built) and
// lib/pendingActions.ts's queue storage (step 1, already built) -- this
// file's only job is to connect the two for a write route without that
// route needing to know pending_actions' schema itself.
//
// A queued request also announces itself (owner, 13 Oct 2026): ONE "Review requested" Telegram alert per row, sent
// here -- the single place every Review-Required-gated write route queues through -- right after the insert, so a
// request that was not queued (Full tier, a refusal, a failed insert) sends nothing. It reaches lib/reviewAlert.ts
// through a global hook rather than an import, for the reason that file's header gives.
//
// Deliberately generic, same "no entity-specific knowledge" discipline
// pendingActions.ts already holds itself to: this file doesn't know what
// a fee/product/contact looks like, only that a section+action+entity
// happened and needs either applying now or queuing.
//
// A route's own top-level permission gate (the `app.use('*', ...)`
// middleware every routes/*.ts file already has) must use
// `getPermissionTier(user, section) !== 'none'` -- NOT the plain
// `hasPermission()` boolean check -- so a Review Required user reaches
// the route at all; hasPermission() is deliberately strict (`=== true`)
// and would 403 a 'review'-tier user before they ever got here. Once
// inside a specific write handler, call maybeQueueForReview(): a null
// result means the tier is 'full' (or the section isn't in
// REVIEW_TIER_KEYS at all) and the caller should perform its write
// exactly as before; a non-null result is the new pending_actions row's
// id -- the caller must NOT perform the write, and should return that id
// to the client (202, `{ pending: true, pendingActionId }`) instead.

import { createPendingAction } from './pendingActions'
import { getPermissionTier, type PermissionUser } from './permissions'
import type { Env } from '../index'
import { actorSnapshot } from './actorSnapshot'
import type { ReviewAlertHook } from './reviewAlert'

const reviewAlertHook = (): ReviewAlertHook | undefined =>
  (globalThis as unknown as Record<symbol, ReviewAlertHook | undefined>)[Symbol.for('business-os.review-alert.v1')]

export interface MaybeQueueForReviewInput {
  actionType: string
  entityType: string
  entityId?: number | null
  payload: unknown
  expectedEntityStateJson?: string
  summary?: string | null
}

// The subset of SessionUser every caller has in scope (routes/*.ts's
// `c.get('user')`) -- kept narrow/structural rather than importing the
// real SessionUser type, so this file has no dependency on lib/auth.ts.
export type ReviewGateUser = PermissionUser & {
  id?: number | null
  username?: string | null
  name?: string | null
}

export async function maybeQueueForReview(
  env: Env,
  user: ReviewGateUser,
  section: string,
  input: MaybeQueueForReviewInput,
): Promise<number | null> {
  const tier = getPermissionTier(user, section)
  if (tier !== 'review') return null
  const requestedByName = actorSnapshot(user)
  const pendingId = await createPendingAction(env, {
    section,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    payload: input.payload,
    expectedEntityStateJson: input.expectedEntityStateJson,
    summary: input.summary ?? null,
    requestedBy: user?.id ?? null,
    requestedByName,
  })
  // The row exists: announce it. The alert reads nothing from the request's summary (it holds amounts) -- only the
  // fixed phrase for this kind of request, the record's name and the account USERNAME.
  try {
    await reviewAlertHook()?.announce(env, {
      kind: 'created',
      row: {
        section, action_type: input.actionType, entity_type: input.entityType, entity_id: input.entityId ?? null,
        payload_json: JSON.stringify(input.payload ?? {}), requested_by_name: requestedByName,
      },
    })
  } catch { /* an alert never fails the write that queued it */ }
  return pendingId
}
