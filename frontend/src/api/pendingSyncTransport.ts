import { getLocalDb } from './lazyLocalDb.ts'
import { syncPendingSalesQueue } from './saleWriteTransport.ts'
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
  oldest_created_at: unknown | null
  writes_require_server: true
  items: ReturnType<typeof serializePendingSyncPreview>
}

export async function discardPendingSyncQueue(reason = 'Offline changes were cleared.'): Promise<{
  success: true
  discarded: number
  reason: string
}> {
  const db = await getLocalDb()
  const existing = await db.table('sync_queue').toArray().catch(() => [])
  await db.table('sync_queue').clear().catch(() => {})
  emitSyncQueueChanged({ reason, discarded: existing.length })
  dispatchSyncUpdates(DISCARD_SYNC_UPDATE_CHANNELS, 'discard-pending-sync-queue')
  return {
    success: true,
    discarded: existing.length,
    reason,
  }
}

export async function getPendingSyncState(): Promise<PendingSyncState> {
  const db = await getLocalDb()
  const items = await db.table('sync_queue')
    .orderBy('_seq')
    .toArray()
    .catch(() => []) as PendingSyncPreviewInput[]
  const sorted = [...items].sort((a, b) => {
    const byCreated = String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
    if (byCreated !== 0) return byCreated
    return Number(a?._seq || 0) - Number(b?._seq || 0)
  })
  const counts = sorted.reduce((acc, item) => {
    const status = String(item?.status || 'pending')
    acc.total += 1
    if (status === 'syncing') acc.syncing += 1
    else if (status === 'conflict') acc.conflict += 1
    else if (status === 'failed') acc.failed += 1
    else acc.pending += 1
    return acc
  }, { total: 0, pending: 0, syncing: 0, failed: 0, conflict: 0 })
  const oldest = sorted[0]?.created_at || null
  return {
    ...counts,
    oldest_created_at: oldest,
    writes_require_server: true,
    items: serializePendingSyncPreview(sorted),
  }
}

export function retryPendingSyncNow(): Promise<unknown> {
  return syncPendingSalesQueue({ force: true })
}
