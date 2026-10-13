import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString } from './query.ts'

// The one read behind the "waiting for review" tags (components/shared/
// PendingReviewTag.tsx): which records have an OPEN request in the review queue.
//
// Who may call which route is decided by the Worker (routes/reviewQueue.ts), and
// this file mirrors it so the browser never asks for something it will be refused:
//   GET /api/review        every open request. Needs the `review` permission at
//                          'view' or 'full' (the reviewer gate).
//   GET /api/review/mine   the signed-in user's own requests. Declared before that
//                          gate, so any signed-in user may call it; the Worker
//                          scopes it to the session user and takes no user id.
// Owner ruling (13 Oct 2026, Q9): requesters see their own, reviewers see all.
export type PendingReviewScope = 'all' | 'mine'

export const PENDING_REVIEW_PATHS: Record<PendingReviewScope, string> = {
  all: '/api/review',
  mine: '/api/review/mine',
}

// The columns the tags use. The Worker sends the whole row (payload included);
// nothing here reads more than the target a request points at.
export type PendingReviewTargetRow = {
  section?: string
  entity_type?: string
  entity_id?: number | string | null
  status?: string
}

export async function getOpenPendingReviewRows(scope: PendingReviewScope): Promise<PendingReviewTargetRow[]> {
  const path = appendQuery(PENDING_REVIEW_PATHS[scope], buildQueryString({ status: 'open' }))
  // No local fallback and no cache: a fallback answering "nothing is pending"
  // would erase tags that are still true, and the store decides when to re-read.
  const response = await route(
    `review:targets:${scope}`,
    () => apiFetch('GET', path),
    null,
    { raceLocalFallback: false, bypassCache: true },
  ) as { data?: unknown } | null
  if (!Array.isArray(response?.data)) throw new Error('The review queue answered without a list of requests.')
  return response.data as PendingReviewTargetRow[]
}
