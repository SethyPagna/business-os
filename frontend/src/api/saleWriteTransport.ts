import type { IndexableType, Table } from 'dexie'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { businessDateTimeId } from '../utils/timestampId.ts'
import {
  apiFetch,
  isNetErr,
  isTransientGatewayError,
  isWriteBlockedError,
  isWriteConflictError,
  route,
} from './http.ts'
import { getLocalDb } from './lazyLocalDb.ts'
import {
  OFFLINE_SALE_SYNC_UPDATE_CHANNELS,
  dispatchSyncUpdates,
  emitSyncQueueChanged,
  registerOutboxBackgroundSync,
} from './syncRuntime.ts'

type SalePayload = Record<string, unknown>
type LocalRow = Record<string, unknown> & { _seq?: number }
type QueueSyncOptions = { force?: boolean }
type LocalDb = Awaited<ReturnType<typeof getLocalDb>>

const OFFLINE_SALE_QUEUE_CHANNEL = 'sales:create'
const OFFLINE_SALE_RETRY_DELAY_MS = 30_000

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

// Offline sales mint their receipt id at QUEUE time from the device clock
// -- the sale's own moment, not the later sync -- in the same
// RCP-YYYYMMDD-HHMMSS shape the server mints online (user, Aug 30 2026:
// receipt ids encode date+time). The id rides the replayed payload, so the
// server keeps it; the pending-sync UI reads the sale row's
// offline_pending flag, which is what the old OFFLINE- prefix signaled.
function buildOfflineSaleReceiptNumber(): string {
  return `RCP-${businessDateTimeId()}`
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

async function findQueuedSale(clientRequestId: unknown): Promise<LocalRow | null> {
  const clean = asText(clientRequestId).trim()
  if (!clean) return null
  const db = await getLocalDb()
  const rows = await localTable(db, 'sync_queue').where('channel').equals(OFFLINE_SALE_QUEUE_CHANNEL).toArray().catch(() => [])
  return (rows as LocalRow[]).find((row) => asText((row.payload as SalePayload | undefined)?.client_request_id) === clean) || null
}

async function putOfflineSaleMirror(payload: SalePayload, receiptNumber: string): Promise<number> {
  const db = await getLocalDb()
  const now = new Date().toISOString()
  const offlineId = -Math.abs(Date.now())
  await localTable(db, 'sales').put({
    id: offlineId,
    receipt_number: receiptNumber,
    client_request_id: payload.client_request_id,
    cashier_id: payload.cashier_id || null,
    cashier_name: payload.cashier_name || '',
    customer_name: payload.customer_name || '',
    customer_phone: payload.customer_phone || '',
    total_usd: payload.total_usd || 0,
    total_khr: payload.total_khr || 0,
    subtotal_usd: payload.subtotal_usd || payload.subtotal || 0,
    subtotal_khr: payload.subtotal_khr || 0,
    items: JSON.stringify(payload.items || []),
    sale_status: payload.sale_status || 'completed',
    payment_method: payload.payment_method || 'Cash',
    created_at: payload.created_at || now,
    updated_at: now,
    offline_pending: true,
  }).catch(() => null)
  return offlineId
}

async function queueOfflineSale(payload: SalePayload, reason = 'server_offline'): Promise<Record<string, unknown>> {
  const salePayload = ensureSaleClientRequestId({ ...(payload || {}) }, 'sale')
  const existing = await findQueuedSale(salePayload.client_request_id)
  if (existing) {
    return {
      success: true,
      queued: true,
      duplicate: true,
      id: existing.entity_id || null,
      receiptNumber: existing.entity_name || buildOfflineSaleReceiptNumber(),
      client_request_id: salePayload.client_request_id,
    }
  }

  const now = new Date().toISOString()
  const receiptNumber = buildOfflineSaleReceiptNumber()
  salePayload.receipt_number = salePayload.receipt_number || receiptNumber
  const localId = await putOfflineSaleMirror(salePayload, receiptNumber)
  const row = {
    id: salePayload.client_request_id,
    channel: OFFLINE_SALE_QUEUE_CHANNEL,
    operation: 'create',
    entity_table: 'sales',
    entity_id: localId,
    entity_name: receiptNumber,
    status: 'pending',
    payload: salePayload,
    created_at: now,
    updated_at: now,
    retry_count: 0,
    retry_at: now,
    error: null,
    reason,
    queue_version: 1,
    base_updated_at: salePayload.expectedUpdatedAt || salePayload.expected_updated_at || salePayload.updated_at || now,
  }
  const db = await getLocalDb()
  await localTable(db, 'sync_queue').put(row)
  registerOutboxBackgroundSync()
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, queued: 1 })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:offline-sale-queued', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        receiptNumber,
        client_request_id: salePayload.client_request_id,
        ts: now,
      },
    }))
  }
  return {
    success: true,
    queued: true,
    id: localId,
    receiptNumber,
    client_request_id: salePayload.client_request_id,
  }
}

function queuedSaleBackoffMs(retryCount = 0): number {
  const attempts = Math.max(0, Number(retryCount || 0))
  return Math.min(5 * 60_000, OFFLINE_SALE_RETRY_DELAY_MS * Math.max(1, attempts + 1))
}

async function updateQueuedRow(row: LocalRow, updates: Record<string, unknown> = {}): Promise<void> {
  if (!row?._seq) return
  const db = await getLocalDb()
  await localTable(db, 'sync_queue').put({
    ...row,
    ...updates,
    updated_at: new Date().toISOString(),
  }).catch(() => {})
}

async function completeQueuedSale(row: LocalRow, result: Record<string, unknown>): Promise<void> {
  if (row._seq == null) return
  const queueSeq = row._seq
  const db = await getLocalDb()
  const syncQueue = localTable(db, 'sync_queue')
  const sales = localTable(db, 'sales')
  const localSaleId = Number(row.entity_id || 0)
  await db.transaction('rw', syncQueue, sales, async () => {
    await syncQueue.delete(queueSeq)
    if (Number.isFinite(localSaleId) && localSaleId < 0) await sales.delete(localSaleId)
  }).catch(async () => {
    await syncQueue.delete(queueSeq).catch(() => {})
    if (Number.isFinite(localSaleId) && localSaleId < 0) await sales.delete(localSaleId).catch(() => {})
  })
  emitSyncQueueChanged({ channel: OFFLINE_SALE_QUEUE_CHANNEL, synced: 1 })
  if (typeof window !== 'undefined') {
    dispatchSyncUpdates(OFFLINE_SALE_SYNC_UPDATE_CHANNELS, 'offline-sale-synced')
    window.dispatchEvent(new CustomEvent('sync:offline-sale-synced', {
      detail: {
        channel: OFFLINE_SALE_QUEUE_CHANNEL,
        receiptNumber: result?.receiptNumber || result?.receipt_number || row.entity_name || null,
        client_request_id: (row?.payload as SalePayload | undefined)?.client_request_id || row.id || null,
        duplicate: !!result?.duplicate,
        ts: Date.now(),
      },
    }))
  }
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
  if (retryable) registerOutboxBackgroundSync()
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

export async function syncPendingSalesQueue({ force = false }: QueueSyncOptions = {}): Promise<Record<string, unknown>> {
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
    if (!force) {
      const retryAt = row.retry_at ? Date.parse(asText(row.retry_at)) : 0
      if (Number.isFinite(retryAt) && retryAt > now) continue
    }
    eligible.push(row)
  }
  eligible.sort((a, b) => asText(a.created_at).localeCompare(asText(b.created_at)))

  const result = { success: true, attempted: 0, synced: 0, failed: 0, pending: rows.length }
  for (const row of eligible) {
    result.attempted += 1
    await updateQueuedRow(row, { status: 'syncing', error: null })
    try {
      const payload = ensureSaleClientRequestId({ ...((row.payload as SalePayload) || {}) }, 'sale')
      const response = await createSaleWithoutWriteDedupe(payload) as Record<string, unknown>
      await completeQueuedSale(row, response)
      result.synced += 1
    } catch (error) {
      if (isWriteConflictError(error)) {
        await markQueuedSaleConflict(row, error)
        result.failed += 1
        continue
      }
      const retryable = isRetryableOfflineSaleError(error)
      await failQueuedSale(row, error, { retryable })
      result.failed += 1
      if (!retryable && !force) break
    }
  }
  result.pending = Math.max(0, rows.length - result.synced)
  return result
}

export async function createSale(payload: SalePayload = {}): Promise<unknown> {
  const salePayload = ensureSaleClientRequestId({ ...getClientDeviceInfo(), ...payload }, 'sale')
  try {
    return await createSaleRequest(salePayload)
  } catch (error) {
    if (isRetryableOfflineSaleError(error)) {
      const err = error as { reason?: string } | null
      return queueOfflineSale(salePayload, err?.reason || 'server_offline')
    }
    throw error
  }
}
