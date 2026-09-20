import { getLocalDb } from './lazyLocalDb.ts'
import { syncPendingSalesQueue } from './saleWriteTransport.ts'
import { apiFetch } from './http.ts'
import { captureActorReadScope, isActorReadScopeCurrent } from './actorReadScope.ts'
import { captureOfflineSaleOwner, offlineSaleOwnersMatch, sameQueuedSaleRevision, OFFLINE_OWNER_REVIEW_MESSAGE, type OfflineSaleOwner } from './offlineQueueOwnership.ts'
import { serializePendingSyncPreview, type PendingSyncPreviewInput } from './syncPreview.ts'
import {
  DISCARD_SYNC_UPDATE_CHANNELS,
  dispatchSyncUpdates,
  emitSyncQueueChanged,
} from './syncRuntime.ts'

export interface PendingSyncState {
  total: number
  pending: number
  syncing: number
  failed: number
  conflict: number
  quarantined: number
  owner: OfflineSaleOwner | null
  review_token: string | null
  oldest_created_at: unknown | null
  writes_require_server: true
  items: ReturnType<typeof serializePendingSyncPreview>
}

type QueueRow = PendingSyncPreviewInput & Record<string, unknown> & { _seq?: number; payload?: Record<string, unknown> }
type QueueReview = { owner: OfflineSaleOwner; scope: ReturnType<typeof captureActorReadScope>; rows: QueueRow[] }
// Tokens bind an explicit action to the exact snapshot the person reviewed.
// Neither polling nor an account switch may retarget an older action.
const queueReviews = new Map<string, QueueReview>()

async function validatedReview(token: string | undefined): Promise<QueueReview> {
  const review = token ? queueReviews.get(token) : undefined
  if (!review || !isActorReadScopeCurrent(review.scope, false)
    || !offlineSaleOwnersMatch(review.owner, captureOfflineSaleOwner())) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  const response = await apiFetch('GET', '/api/sync/owner') as { owner?: unknown }
  if (!isActorReadScopeCurrent(review.scope, false) || !offlineSaleOwnersMatch(review.owner, response.owner)) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  return review
}

export async function discardPendingSyncQueue(reason = 'Reviewed pending sales were cleared.', reviewToken?: string): Promise<{
  success: true
  discarded: number
  reason: string
}> {
  const review = await validatedReview(reviewToken)
  const db = await getLocalDb()
  const queue = db.table('sync_queue')
  const sales = db.table('sales')
  const discarded = await db.transaction('rw', queue, sales, async () => {
    if (!isActorReadScopeCurrent(review.scope, false)) return 0
    let count = 0
    for (const row of review.rows) {
      if (row._seq == null || row.status === 'syncing') continue
      const current = await queue.get(row._seq)
      if (!isActorReadScopeCurrent(review.scope, false) || !sameQueuedSaleRevision(current, row)
        || !offlineSaleOwnersMatch(current?.payload?.offline_owner, review.owner)) continue
      const mirror = Number(row.entity_id) < 0 ? await sales.get(Number(row.entity_id)) : null
      if (!isActorReadScopeCurrent(review.scope, false)) continue
      await queue.delete(row._seq)
      if (mirror && mirror.client_request_id === row.payload?.client_request_id && offlineSaleOwnersMatch(mirror.offline_owner, review.owner)) await sales.delete(Number(row.entity_id))
      count++
    }
    return count
  })
  if (reviewToken) queueReviews.delete(reviewToken)
  emitSyncQueueChanged({ reason, discarded })
  dispatchSyncUpdates(DISCARD_SYNC_UPDATE_CHANNELS, 'discard-pending-sync-queue')
  return {
    success: true,
    discarded,
    reason,
  }
}

export async function getPendingSyncState(): Promise<PendingSyncState> {
  const scope = captureActorReadScope()
  let owner: OfflineSaleOwner | null = null
  try {
    const captured = captureOfflineSaleOwner()
    const response = await apiFetch('GET', '/api/sync/owner') as { owner?: unknown }
    if (isActorReadScopeCurrent(scope, false) && offlineSaleOwnersMatch(captured, response.owner)) owner = captured
  } catch { /* Without live identity, show only the retained-record count. */ }
  const db = await getLocalDb()
  const items = await db.table('sync_queue')
    .orderBy('_seq')
    .toArray()
    .catch(() => []) as QueueRow[]
  if (!isActorReadScopeCurrent(scope, false)) owner = null
  const owned = owner ? items.filter((row) => row.channel === 'sales:create' && offlineSaleOwnersMatch(row.payload?.offline_owner, owner)) : []
  const sorted = owned.sort((a, b) => {
    const byCreated = String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
    if (byCreated !== 0) return byCreated
    return Number(a?._seq || 0) - Number(b?._seq || 0)
  })
  const counts = sorted.reduce<{ total: number; pending: number; syncing: number; failed: number; conflict: number }>((acc, item) => {
    const status = String(item?.status || 'pending')
    acc.total += 1
    if (status === 'syncing') acc.syncing += 1
    else if (status === 'conflict') acc.conflict += 1
    else if (status === 'failed') acc.failed += 1
    else acc.pending += 1
    return acc
  }, { total: 0, pending: 0, syncing: 0, failed: 0, conflict: 0 })
  const oldest = sorted[0]?.created_at || null
  const preview = serializePendingSyncPreview(sorted)
  const reviewToken = owner ? crypto.randomUUID() : null
  if (reviewToken && owner) {
    // Serialization caps the visible prefix. Unseen rows are not authorized
    // by this review, even though the summary counts include them.
    queueReviews.set(reviewToken, { owner, scope, rows: sorted.slice(0, preview.length) })
    while (queueReviews.size > 8) queueReviews.delete(queueReviews.keys().next().value!)
  }
  return {
    ...counts,
    oldest_created_at: oldest,
    writes_require_server: true,
    quarantined: items.length - owned.length,
    owner,
    review_token: reviewToken,
    items: preview,
  }
}

export async function retryPendingSyncNow(reviewToken?: string): Promise<unknown> {
  const review = await validatedReview(reviewToken)
  return syncPendingSalesQueue({ force: true, manualRecovery: true, expectedOwner: review.owner, reviewedRows: review.rows })
}
