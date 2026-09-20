import type { D1Compat } from './db'

export const TRANSFER_LOT_PAGE_MAX = 512
export type TransferLotCursor = { productId: number; branchId: number; receivedAt: string | null; batchNumber: number | null; batchId: number }
export type TransferRunLot = { batchId: number; available: number; cursor: TransferLotCursor }
export type TransferLotPage = {
  productId: number; branchId: number; selectedBatchId: number | null
  lots: TransferRunLot[]; exhausted: boolean
}

function positiveId(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }

/** One result-bounded query; not a guarantee on SQLite rows examined or CPU.
 * Cursor is internal planning state, never client authority.
 * This is not a reservation/snapshot. Commit must revalidate stock and provenance.
 * Preserves existing FIFO: date NULL last, batch_number NULL first, then id.
 */
export async function readTransferLotPage(db: D1Compat, input: {
  productId: number; branchId: number; limit: number
  selectedBatchId?: number | null; after?: TransferLotCursor | null
}): Promise<TransferLotPage> {
  const { productId, branchId, limit } = input
  const selectedBatchId = input.selectedBatchId ?? null
  const after = input.after ?? null
  if (!positiveId(productId) || !positiveId(branchId) || !Number.isInteger(limit) || limit < 1 || limit > TRANSFER_LOT_PAGE_MAX
    || (selectedBatchId !== null && !positiveId(selectedBatchId))) throw new Error('Invalid transfer lot page')
  if (after && (selectedBatchId !== null || after.productId !== productId || after.branchId !== branchId
    || !positiveId(after.batchId) || (after.receivedAt !== null && typeof after.receivedAt !== 'string')
    || (after.batchNumber !== null && !Number.isSafeInteger(after.batchNumber)))) throw new Error('Invalid transfer lot cursor')
  const cursorClause = after ? `AND ((pb.received_at IS NULL), COALESCE(pb.received_at,''),
    (pb.batch_number IS NOT NULL), COALESCE(pb.batch_number,0), pb.id)
    > (@dateNull,@date,@numberPresent,@number,@batch)` : ''
  const selectedClause = selectedBatchId !== null ? 'AND pb.id=@selected' : ''
  const rows = await db.prepare(`SELECT pb.id AS batchId, pb.received_at AS receivedAt,
      pb.batch_number AS batchNumber, bs.quantity AS available
    FROM product_batches pb JOIN branch_batch_stock bs ON bs.batch_id=pb.id AND bs.branch_id=@branch
    WHERE pb.variant_product_id=@product AND pb.is_active=1 AND bs.quantity>0
      ${selectedClause} ${cursorClause}
    ORDER BY (pb.received_at IS NULL),pb.received_at,pb.batch_number,pb.id LIMIT @limit`)
    .all<{ batchId: number; receivedAt: string | null; batchNumber: number | null; available: number }>({
      product: productId, branch: branchId, limit: selectedBatchId !== null ? 1 : limit + 1,
      ...(selectedBatchId !== null ? { selected: selectedBatchId } : {}),
      ...(after ? { dateNull: after.receivedAt === null ? 1 : 0, date: after.receivedAt ?? '',
        numberPresent: after.batchNumber === null ? 0 : 1, number: after.batchNumber ?? 0, batch: after.batchId } : {}),
    })
  const lots = rows.slice(0, limit).map(row => {
    if (!positiveId(row.batchId) || !Number.isFinite(row.available) || row.available <= 0) throw new Error('Invalid stored transfer lot quantity')
    return { batchId: row.batchId, available: row.available,
      cursor: { productId, branchId, receivedAt: row.receivedAt, batchNumber: row.batchNumber, batchId: row.batchId } }
  })
  return { productId, branchId, selectedBatchId, lots, exhausted: selectedBatchId !== null || rows.length <= limit }
}
