import type { IndexableType, Table } from 'dexie'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import {
  apiFetch,
  isNetErr,
  isTransientGatewayError,
  isWriteBlockedError,
  isWriteConflictError,
  route,
} from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import { captureActorReadScope, isActorReadScopeCurrent } from './actorReadScope.ts'
import { captureOfflineSaleOwner, offlineSaleOwnersMatch, OFFLINE_OWNER_REVIEW_MESSAGE, sameQueuedSaleRevision, stampOfflineSaleOwner } from './offlineQueueOwnership.ts'
import {
  OFFLINE_SALE_SYNC_UPDATE_CHANNELS,
  dispatchSyncUpdates,
  emitSyncQueueChanged,
} from './syncRuntime.ts'

type SalePayload = Record<string, unknown>
type LocalRow = Record<string, unknown> & { _seq?: number }
type QueueSyncOptions = { force?: boolean; manualRecovery?: boolean; expectedOwner?: unknown; reviewedRows?: LocalRow[] }
type LocalDb = Awaited<ReturnType<typeof getLocalDb>>

const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const OFFLINE_SALE_RETRY_DELAY_MS = 30_000
const OFFLINE_SALE_SYNC_LEASE_MS = 60_000
let pendingSalesSyncPromise: Promise<Record<string, unknown>> | null = null
let pendingRecoveryScope: ReturnType<typeof captureActorReadScope> | null = null

function asText(value: unknown): string {
  return String(value ?? '')
}

function createSaleClientRequestId(prefix = 'sale'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function ensureSaleClientRequestId(payload: SalePayload = {}, prefix = 'sale'): SalePayload {
  const current = asText(payload.client_request_id).trim()
  if (current) return { ...payload, client_request_id: current.slice(0, 120) }
  return { ...payload, client_request_id: createSaleClientRequestId(prefix) }
}

function localTable(db: LocalDb, tableName: string): Table<LocalRow, IndexableType> {
  return db.table(tableName) as Table<LocalRow, IndexableType>
}

function isRetryableOfflineSaleError(error: unknown): boolean {
  const err = error as { status?: number; message?: string; reason?: string } | null
  if (!err) return false
  if (isWriteBlockedError(err)) return true
  if (isNetErr(err)) return true
  if (isTransientGatewayError(err.status)) return true
  const message = asText(err.message).toLowerCase()
  return message.includes('timed out') || message.includes('server is offline') || message.includes('server unavailable')
}

function queuedSaleBackoffMs(retryCount = 0): number {
  const attempts = Math.max(0, Number(retryCount || 0))
  return Math.min(5 * 60_000, OFFLINE_SALE_RETRY_DELAY_MS * Math.max(1, attempts + 1))
}

async function updateQueuedRow(row: LocalRow, updates: Record<string, unknown> = {}): Promise<LocalRow | null> {
  if (row?._seq == null) return null
  const db = await getLocalDb()
  const queue = localTable(db, 'sync_queue')
  return db.transaction('rw', queue, async () => {
    const current = await queue.get(row._seq!)
    if (!sameQueuedSaleRevision(current, row)) return null
    const next = { ...current, ...updates, updated_at: new Date().toISOString() }
    await queue.put(next)
    return next
  })
}

async function completeQueuedSale(row: LocalRow, result: Record<string, unknown>): Promise<boolean> {
  if (row._seq == null) return false
  const queueSeq = row._seq
  const db = await getLocalDb()
  const syncQueue = localTable(db, 'sync_queue')
  const sales = localTable(db, 'sales')
  const localSaleId = Number(row.entity_id || 0)
  const completed = await db.transaction('rw', syncQueue, sales, async () => {
    if (!sameQueuedSaleRevision(await syncQueue.get(queueSeq), row)) return false
    await syncQueue.delete(queueSeq)
    if (Number.isFinite(localSaleId) && localSaleId < 0) {
      const mirror = await sales.get(localSaleId)
      const payload = row.payload as SalePayload
      if (mirror && mirror.client_request_id === payload.client_request_id && offlineSaleOwnersMatch(mirror.offline_owner, payload.offline_owner)) await sales.delete(localSaleId)
    }
    return true
  })
  if (!completed) return false
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, synced: 1 })
  if (typeof window !== 'undefined') {
    dispatchSyncUpdates(OFFLINE_SALE_SYNC_UPDATE_CHANNELS, 'offline-sale-synced')
    window.dispatchEvent(new CustomEvent('sync:offline-sale-synced', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        receiptNumber: result?.receiptNumber || result?.receipt_number || row.entity_name || null,
        client_request_id: (row?.payload as SalePayload | undefined)?.client_request_id || row.id || null,
        offline_owner: (row.payload as SalePayload | undefined)?.offline_owner,
        duplicate: !!result?.duplicate,
        ts: Date.now(),
      },
    }))
  }
  return true
}

async function failQueuedSale(row: LocalRow, error: unknown, { retryable = false } = {}): Promise<void> {
  const err = error as { message?: string } | null
  const retryCount = Number(row.retry_count || 0) + 1
  const now = Date.now()
  await updateQueuedRow(row, {
    status: 'failed',
    retry_count: retryCount,
    retry_at: retryable ? new Date(now + queuedSaleBackoffMs(retryCount)).toISOString() : null,
    error: err?.message || asText(error || 'Sync failed'),
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, failed: 1 })
}

async function markQueuedSaleConflict(row: LocalRow, error: unknown): Promise<void> {
  const err = error as { message?: string } | null
  await updateQueuedRow(row, {
    status: 'conflict',
    retry_at: null,
    error: err?.message || asText(error || 'Server has a newer version. Review before syncing.'),
    conflict: true,
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, conflict: 1 })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:write-conflict', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        entity_table: row.entity_table || 'sales',
        entity_id: row.entity_id ?? null,
        entity_name: row.entity_name || null,
        refreshChannels: ['sales', 'products', 'inventory', 'dashboard'],
        ts: Date.now(),
      },
    }))
  }
}

function createSaleRequest(payload: SalePayload): Promise<unknown> {
  return route(
    'sales:create',
    () => apiFetch('POST', '/api/sales', payload),
    null,
    true,
  )
}

function createSaleWithoutWriteDedupe(payload: SalePayload): Promise<unknown> {
  return apiFetch(
    'POST',
    '/api/sales',
    payload,
    undefined,
    { skipWriteDedupe: true },
  )
}

async function runPendingSalesQueueSync({ force = false, expectedOwner, reviewedRows }: QueueSyncOptions = {}): Promise<Record<string, unknown>> {
  const recoveryScope = captureActorReadScope()
  const recoveryOwner = expectedOwner || captureOfflineSaleOwner()
  const reviewed = reviewedRows ? new Map(reviewedRows.map((row) => [row._seq, row])) : null
  const now = Date.now()
  const db = await getLocalDb()
  const rows = await localTable(db, 'sync_queue')
    .where('channel')
    .equals(OFFLINE_SALE_QUEUE_CHANNEL)
    .toArray()
    .catch(() => []) as LocalRow[]
  const eligible: LocalRow[] = []
  for (const row of rows) {
    if (!row?.payload) continue
    if (reviewed && !sameQueuedSaleRevision(reviewed.get(row._seq), row)) continue
    if (!offlineSaleOwnersMatch((row.payload as SalePayload).offline_owner, recoveryOwner)) continue
    const status = asText(row.status || 'pending')
    if (!['pending', 'failed', 'retry', 'syncing', 'quarantined'].includes(status)) continue
    if (status === 'syncing') {
      const claimedAt = Date.parse(asText(row.updated_at || row.created_at))
      if (Number.isFinite(claimedAt) && now - claimedAt < OFFLINE_SALE_SYNC_LEASE_MS) continue
    }
    if (!force) {
      const retryAt = row.retry_at ? Date.parse(asText(row.retry_at)) : 0
      if (Number.isFinite(retryAt) && retryAt > now) continue
    }
    eligible.push(row)
  }
  eligible.sort((a, b) => asText(a.created_at).localeCompare(asText(b.created_at)))

  const result = { success: true, attempted: 0, synced: 0, failed: 0, pending: rows.length }
  for (const row of eligible) {
    if (!isActorReadScopeCurrent(recoveryScope, false)) break
    const scope = captureActorReadScope()
    const queuedOwner = (row.payload as SalePayload).offline_owner
    const quarantine = (target: LocalRow) => updateQueuedRow(target, { status: 'quarantined', retry_at: null, reason: 'offline_owner_review', error: OFFLINE_OWNER_REVIEW_MESSAGE })
    let currentOwner
    try { currentOwner = captureOfflineSaleOwner() } catch { await quarantine(row); continue }
    if (!offlineSaleOwnersMatch(queuedOwner, currentOwner)) { await quarantine(row); continue }
    // Authenticated no-store endpoint verifies the cookie, not cached UI user
    // state. Repeat after dispatch before acknowledging/deleting local work.
    let serverOwner: Record<string, unknown>
    try { serverOwner = await apiFetch('GET', '/api/sync/owner') as Record<string, unknown> } catch { await quarantine(row); continue }
    if (!isActorReadScopeCurrent(scope, false) || !offlineSaleOwnersMatch(queuedOwner, serverOwner.owner)) { await quarantine(row); continue }
    const claimed = await updateQueuedRow(row, { status: 'syncing', error: null, sync_lease: createSaleClientRequestId('lease') })
    if (!claimed) continue
    result.attempted += 1
    try {
      if (!isActorReadScopeCurrent(scope, false)) { await quarantine(claimed); continue }
      const payload = { ...((row.payload as SalePayload) || {}) }
      if (!asText(payload.client_request_id).trim() || payload.client_request_id !== row.id) {
        await quarantine(claimed)
        continue
      }
      const response = await createSaleWithoutWriteDedupe(payload) as Record<string, unknown>
      const after = await apiFetch('GET', '/api/sync/owner') as Record<string, unknown>
      if (!isActorReadScopeCurrent(scope, false) || !offlineSaleOwnersMatch(queuedOwner, after.owner)
        || !offlineSaleOwnersMatch(queuedOwner, response.offline_owner) || response.client_request_id !== payload.client_request_id) {
        await quarantine(claimed)
        continue
      }
      if (await completeQueuedSale(claimed, response)) result.synced += 1
    } catch (error) {
      const failure = error as { status?: number; code?: string }
      if (!isActorReadScopeCurrent(scope, false) || failure.status === 401 || failure.status === 403 || String(failure.code || '').startsWith('offline_owner_')) {
        await quarantine(claimed)
        result.failed += 1
        continue
      }
      if (isWriteConflictError(error)) {
        await markQueuedSaleConflict(claimed, error)
        result.failed += 1
        continue
      }
      const retryable = isRetryableOfflineSaleError(error)
      await failQueuedSale(claimed, error, { retryable })
      result.failed += 1
      if (!retryable && !force) break
    }
  }
  result.pending = Math.max(0, rows.length - result.synced)
  return result
}

export function syncPendingSalesQueue(options: QueueSyncOptions = {}): Promise<Record<string, unknown>> {
  if (options.manualRecovery !== true || !Array.isArray(options.reviewedRows) || !offlineSaleOwnersMatch(options.expectedOwner, captureOfflineSaleOwner())) {
    return Promise.resolve({ success: false, manual_recovery_required: true, synced: 0, error: 'Pending sales are retained. Review them in the original account and explicitly choose recovery.' })
  }
  if (pendingSalesSyncPromise && pendingRecoveryScope && !isActorReadScopeCurrent(pendingRecoveryScope, false)) {
    return Promise.resolve({ success: false, manual_recovery_required: true, synced: 0, error: 'A prior account recovery is finishing. Keep the records and review again.' })
  }
  if (!pendingSalesSyncPromise) {
    pendingRecoveryScope = captureActorReadScope()
    pendingSalesSyncPromise = runPendingSalesQueueSync(options).finally(() => {
      pendingSalesSyncPromise = null
      pendingRecoveryScope = null
    })
  }
  return pendingSalesSyncPromise
}

export async function createSale(payload: SalePayload = {}): Promise<unknown> {
  const scope = captureActorReadScope()
  const salePayload = ensureSaleClientRequestId(stampOfflineSaleOwner({ ...getClientDeviceInfo(), ...payload }), 'sale')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw Object.assign(new Error('Connect to the server before recording this sale. Your draft is retained; no sale was queued.'), { code: 'online_required' })
  }
  try {
    return await createSaleRequest(salePayload)
  } catch (error) {
    if (isRetryableOfflineSaleError(error)) {
      if (!isActorReadScopeCurrent(scope, false)) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
      // A lost response might already have committed. Keep the original
      // request identity/draft for receipt recovery; never enqueue or mint a
      // replacement request merely because its outcome is unknown.
      throw Object.assign(new Error('The server could not confirm this sale. Keep the original draft and request; reconnect and check its receipt before retrying. No new offline sale was queued.'), { code: 'sale_confirmation_required', client_request_id: salePayload.client_request_id, cause: error })
    }
    throw error
  }
}
