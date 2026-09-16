// Step (2) of the "Permissions UI redesign" item in progress.md: the
// single call every Review-Required-gated write route makes to decide
// "apply this write directly" vs. "queue it instead". Sits between
// lib/permissions.ts's tier read (step 0, already built) and
// lib/pendingActions.ts's queue storage (step 1, already built) -- this
// file's only job is to connect the two for a write route without that
// route needing to know pending_actions' schema itself.
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

export interface MaybeQueueForReviewInput {
  actionType: string
  entityType: string
  entityId?: number | null
  payload: unknown
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
  return createPendingAction(env, {
    section,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    payload: input.payload,
    summary: input.summary ?? null,
    requestedBy: user?.id ?? null,
    requestedByName: actorSnapshot(user),
  })
}
