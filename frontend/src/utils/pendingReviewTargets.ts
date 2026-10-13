import { useEffect, useRef, useSyncExternalStore } from 'react'
import { captureActorReadScope, isActorReadScopeCurrent } from '../api/actorReadScope.ts'
import {
  getOpenPendingReviewRows,
  type PendingReviewScope,
  type PendingReviewTargetRow,
} from '../api/pendingReviewTargetsTransport.ts'

// The shared store behind the "waiting for review" tags. One list of the open
// review requests the signed-in user may see, held once for the whole app and
// read by every tag through useSyncExternalStore.
//
// Why a store and not a fetch inside each tag: a Products page paints hundreds of
// rows, and a tag per row that asked the server itself would send hundreds of
// identical requests. A row only READS this store; one page-level loader
// (components/shared/PendingReviewSync.tsx) fills it, once per page visit and again
// when the review queue changes. tests/pendingReviewTargets.test.ts pins 500
// rows = 1 request, and goes red if a row ever starts fetching.
//
// The key of a request is `section:entity_type:entity_id`. A request that points
// at no record yet (a product create, the saved-reasons list) has no id and uses
// '*' in its place, so the same map also answers "how many creates are waiting".

/** The id slot of a request that has no record yet. */
export const PENDING_REVIEW_NEW = '*'

export type PendingReviewId = number | string | null | undefined

export function pendingReviewKey(section: string, entityType: string, entityId?: PendingReviewId): string {
  return `${section}:${entityType}:${entityId == null ? PENDING_REVIEW_NEW : entityId}`
}

export type PendingReviewSnapshot = {
  /** Which sign-in the list was read for; a different one never inherits it. */
  readonly authority: string | null
  /** Open requests per key. */
  readonly counts: ReadonlyMap<string, number>
}

const EMPTY: PendingReviewSnapshot = { authority: null, counts: new Map() }

export function buildPendingReviewSnapshot(
  rows: readonly PendingReviewTargetRow[],
  authority: string | null = null,
): PendingReviewSnapshot {
  const counts = new Map<string, number>()
  for (const row of rows) {
    // The route is asked for status=open; a row that says otherwise is not waiting.
    if (row.status !== undefined && row.status !== 'open') continue
    if (!row.section || !row.entity_type) continue
    const key = pendingReviewKey(row.section, row.entity_type, row.entity_id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return { authority, counts }
}

/** True when any of these records has an open request. A missing id never matches. */
export function isPendingReview(
  snapshot: PendingReviewSnapshot,
  section: string,
  entityType: string,
  ids: readonly PendingReviewId[],
): boolean {
  for (const id of ids) {
    if (id == null) continue
    if (snapshot.counts.has(pendingReviewKey(section, entityType, id))) return true
  }
  return false
}

/** Open requests that point at no record yet, e.g. product creates waiting for approval. */
export function pendingReviewCount(snapshot: PendingReviewSnapshot, section: string, entityType: string): number {
  return snapshot.counts.get(pendingReviewKey(section, entityType, PENDING_REVIEW_NEW)) ?? 0
}

/**
 * Which list this user reads. The Worker lets only the review permission ('view'
 * or 'full') list everyone's requests; every other user reads their own.
 */
export function pendingReviewScopeFor(reviewTier: string | null | undefined): PendingReviewScope {
  return reviewTier === 'full' || reviewTier === 'view' ? 'all' : 'mine'
}

// ---- the store ------------------------------------------------------------

let snapshot: PendingReviewSnapshot = EMPTY
const listeners = new Set<() => void>()
let scope: PendingReviewScope = 'mine'
let inflight: Promise<void> | null = null
let rereadAfterInflight = false

function publish(next: PendingReviewSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getPendingReviewSnapshot(): PendingReviewSnapshot {
  return snapshot
}

/** Adds a reader. Reading never fetches: only refreshPendingReviewTargets does. */
export function subscribePendingReviewTargets(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function readOnce(): Promise<void> {
  const actor = captureActorReadScope('review')
  // Another account never inherits the previous account's list, not even while
  // its own is still on the wire.
  if (snapshot.authority !== actor.authority) publish({ authority: actor.authority, counts: new Map() })
  const rows = await getOpenPendingReviewRows(scope)
  if (!isActorReadScopeCurrent(actor, false)) return
  publish(buildPendingReviewSnapshot(rows, actor.authority))
}

/**
 * Re-reads the list. Calls that arrive while a read is on the wire share it, so a
 * page and a modal opening in the same moment cost one request.
 *
 * afterChange: the review queue has changed since a read now on the wire began (the
 * caller's own write was just answered "queued for review", or the queue announced
 * a change). That read may have been answered before the change committed, so one
 * more read follows it; without that the new request's tag would be missing until
 * the next page visit.
 *
 * A failed read keeps the last list and the next trigger tries again: the tag is a
 * hint beside a row, never a gate on it, so it must not raise an error over one.
 */
export function refreshPendingReviewTargets(
  nextScope?: PendingReviewScope,
  options: { afterChange?: boolean } = {},
): Promise<void> {
  if (nextScope) scope = nextScope
  if (inflight) {
    if (options.afterChange) rereadAfterInflight = true
    return inflight
  }
  const run = (async () => {
    try {
      do {
        rereadAfterInflight = false
        try { await readOnce() } catch { /* keep the last list; see above */ }
      } while (rereadAfterInflight)
    } finally {
      inflight = null
    }
  })()
  inflight = run
  return run
}

/**
 * For a write wrapper: a response that says { pending: true } was queued for
 * review instead of applied, so the tags must learn about it now. Returns the
 * response untouched, so it chains onto the wrapper's promise.
 */
export function noteQueuedForReview<T>(response: T): T {
  if ((response as { pending?: unknown } | null | undefined)?.pending === true) {
    void refreshPendingReviewTargets(undefined, { afterChange: true })
  }
  return response
}

// ---- hooks ----------------------------------------------------------------

/**
 * Row-level read. The snapshot React compares is a boolean, so a row re-renders
 * only when ITS answer flips, never because some other row's request arrived.
 */
export function useIsPendingReview(section: string, entityType: string, ids: readonly PendingReviewId[]): boolean {
  const read = () => isPendingReview(getPendingReviewSnapshot(), section, entityType, ids)
  return useSyncExternalStore(subscribePendingReviewTargets, read, read)
}

export function usePendingReviewCount(section: string, entityType: string): number {
  const read = () => pendingReviewCount(getPendingReviewSnapshot(), section, entityType)
  return useSyncExternalStore(subscribePendingReviewTargets, read, read)
}

/**
 * Page-level loader: ONE read when the page becomes active, and one more each
 * time the review queue announces a change (the `pendingActions` sync channel).
 * Exactly one of these per page; the rows below it only read.
 */
export function usePendingReviewTargetsLoader(input: {
  active: boolean
  reviewTier: string | null | undefined
  syncChannel?: string | null
  syncTs?: number | null
}): void {
  const { active, reviewTier, syncChannel, syncTs } = input
  const readScope = pendingReviewScopeFor(reviewTier)
  // The announcement already on screen when the page becomes active was answered by
  // the visit read below; only a newer one is a change. The visit read is keyed on
  // the page becoming active, not on every announcement, which the effect after it
  // owns, so it reads the latest announcement through a ref.
  const latestTs = useRef(syncTs)
  latestTs.current = syncTs
  const seenTs = useRef(syncTs)

  useEffect(() => {
    if (!active) return
    seenTs.current = latestTs.current
    void refreshPendingReviewTargets(readScope)
  }, [active, readScope])

  useEffect(() => {
    if (!active || syncChannel !== 'pendingActions' || syncTs === seenTs.current) return
    seenTs.current = syncTs
    void refreshPendingReviewTargets(readScope, { afterChange: true })
  }, [active, readScope, syncChannel, syncTs])
}
