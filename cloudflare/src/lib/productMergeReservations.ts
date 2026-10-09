import type { getDb } from './db'
import type { ProductMergeCaseSnapshot, ProductMergeReadPlan } from './productMergeSnapshot'
import type { ProductMergeForwardStockIdentity } from './productMergeForwardStock'
import { planProductMergeCaseSnapshot, productMergeCaptureGuard, runProductMergeReadBatch } from './productMergeSnapshot'
import { planExactProductMergeStock } from './countedProductMerge'

export type ProductMergeReservedIds = Pick<ProductMergeForwardStockIdentity, 'planId' | 'transitionId' | 'historyId' | 'origins'> & { imageIds: number[] }
const MAX_RESERVED_ROWS = 10_000
const tables = ['undo_snapshots', 'action_history', 'product_batches', 'damaged_stock_lots', 'product_images'] as const

export function planProductMergeReservations(snapshot: ProductMergeCaseSnapshot, operationId: string, galleryAdditionCount: number): ProductMergeReadPlan<ProductMergeReservedIds> {
  const guard = productMergeCaptureGuard(snapshot)
  const keeperId = snapshot.canonicalProduct?.id, loserId = snapshot.duplicateProduct?.id
  if (!Number.isSafeInteger(keeperId) || !Number.isSafeInteger(loserId) || !keeperId || !loserId || keeperId <= 0 || loserId <= 0 || keeperId === loserId
    || typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(operationId)
    || !Number.isSafeInteger(galleryAdditionCount) || galleryAdditionCount < 0 || galleryAdditionCount > MAX_RESERVED_ROWS) throw new Error('merge_state_conflict')
  const decoded = planProductMergeCaseSnapshot(keeperId, loserId, []).decode(new Map([['capture', [{ data: guard.params.observedCapture, oversized: 0 }]]]))
  if (JSON.stringify(decoded) !== JSON.stringify({ ...snapshot, reparentedByTable: [] })) throw new Error('merge_snapshot_incomplete')
  const source = planExactProductMergeStock(snapshot, 'merge').duplicateSource
  const receiptIds = source.receipts.map(row => row.original.id as number), tagIds = source.tags.map(row => row.id)
  if ([receiptIds, tagIds].some(ids => ids.length > MAX_RESERVED_ROWS || new Set(ids).size !== ids.length
    || ids.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error('merge_state_conflict')
  const sql = `SELECT ${tables.flatMap(table => [
    `(SELECT COALESCE(MAX(id),0) FROM ${table}) AS ${table}_id`,
    `(SELECT seq FROM sqlite_sequence WHERE name='${table}') AS ${table}_seq`,
    `(SELECT COUNT(*) FROM sqlite_sequence WHERE name='${table}') AS ${table}_sequences`,
  ]).join(',')}`
  const reads = [{ key: 'reservations', sql }]
  return { reads, decode(rows) {
    const results = rows.get('reservations')
    if (results?.length !== 1) throw new Error('merge_reservation_incomplete')
    const row = results[0]
    const integer = (value: unknown) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('merge_reservation_invalid')
      return value
    }
    const base = (table: typeof tables[number]) => {
      const count = integer(row[`${table}_sequences`])
      if (count > 1 || (count === 0) !== (row[`${table}_seq`] === null)) throw new Error('merge_reservation_invalid')
      return Math.max(integer(row[`${table}_id`]), count === 0 ? 0 : integer(row[`${table}_seq`]))
    }
    const allocate = (table: typeof tables[number], count: number) => {
      const previous = base(table)
      if (!Number.isSafeInteger(previous + count)) throw new Error('merge_reservation_overflow')
      return Array.from({ length: count }, (_, index) => previous + index + 1)
    }
    const [planId, transitionId] = allocate('undo_snapshots', 2)
    const [historyId] = allocate('action_history', 1)
    const receipts = allocate('product_batches', receiptIds.length), tags = allocate('damaged_stock_lots', tagIds.length)
    return { planId, transitionId, historyId, origins: { operationId,
      receiptIds: receiptIds.map((sourceReceiptId, index) => ({ sourceReceiptId, targetReceiptId: receipts[index] })),
      tagIds: tagIds.map((sourceTagId, index) => ({ sourceTagId, targetTagId: tags[index] })) },
      imageIds: allocate('product_images', galleryAdditionCount) }
  } }
}

export async function readProductMergeReservations(db: ReturnType<typeof getDb>, snapshot: ProductMergeCaseSnapshot, operationId: string, galleryAdditionCount: number): Promise<ProductMergeReservedIds> {
  const plan = planProductMergeReservations(snapshot, operationId, galleryAdditionCount)
  return plan.decode(await runProductMergeReadBatch(db, plan.reads))
}
