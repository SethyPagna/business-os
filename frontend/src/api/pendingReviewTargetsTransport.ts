import { apiFetch, cacheSet, route } from './http.ts'
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

// The columns the tags use (a fields=targets answer carries exactly these and a few more).
export type PendingReviewTargetRow = {
  section?: string
  entity_type?: string
  entity_id?: number | string | null
  status?: string
}

async function readRows(scope: PendingReviewScope, channel: string, slim: boolean) {
  const path = appendQuery(PENDING_REVIEW_PATHS[scope], buildQueryString({ status: 'open', fields: slim ? 'targets' : undefined }))
  // No local fallback and no cached answer: a fallback answering "nothing is pending"
  // would erase tags that are still true, and the store decides when to re-read.
  return await route(
    channel,
    () => apiFetch('GET', path),
    null,
    { raceLocalFallback: false, bypassCache: true },
  ) as { data?: unknown } | null
}

export async function getOpenPendingReviewRows(scope: PendingReviewScope): Promise<PendingReviewTargetRow[]> {
  const channel = `review:targets:${scope}`
  // fields=targets asks for only the columns the tags use (no payload, expected state or summary: about
  // 1.6 KiB a row). A Worker that predates it ignores the parameter and answers the whole row, which holds
  // the same four columns; one that refuses it (400) is asked again for the whole list.
  let response: { data?: unknown } | null
  try {
    response = await readRows(scope, channel, true)
  } catch (error) {
    if ((error as { status?: number } | null)?.status !== 400) throw error
    response = await readRows(scope, channel, false)
  }
  // route() stores every answer in the read cache (bypassCache only skips READING it) and
  // nothing ever serves this channel from there, so the copy -- every open request's whole
  // payload, from a Worker that sent it -- would sit in memory for nothing. The rows below are all the store keeps.
  cacheSet(channel, null)
  if (!Array.isArray(response?.data)) throw new Error('The review queue answered without a list of requests.')
  return response.data as PendingReviewTargetRow[]
}
