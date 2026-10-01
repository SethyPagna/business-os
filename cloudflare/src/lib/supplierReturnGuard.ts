import type { D1Compat } from './db'
import { selectInChunks } from './sqlBinding'
import type { FifoLotAvailability } from './productBatches'

export async function supplierReturnLots(db: D1Compat, supplierId: number, pairs: Array<{ productId: number; branchId: number }>): Promise<Map<string, FifoLotAvailability[]>> {
  const map = new Map<string, FifoLotAvailability[]>()
  const products = [...new Set(pairs.map(pair => pair.productId))]
  const branches = [...new Set(pairs.map(pair => pair.branchId))]
  const rows = await selectInChunks(products, branches.length + 1, chunk => db.prepare(`
    SELECT pb.variant_product_id AS product_id,bbs.branch_id,pb.id AS batch_id,pb.lot_code,pb.received_at,pb.expiry_date,bbs.quantity AS available
    FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
    WHERE pb.supplier_id=? AND pb.variant_product_id IN (${chunk.map(() => '?').join(',')})
      AND bbs.branch_id IN (${branches.map(() => '?').join(',')}) AND pb.is_active=1 AND bbs.quantity>0
    ORDER BY (pb.received_at IS NULL),pb.received_at,pb.batch_number,pb.id
  `).all<{ product_id: number; branch_id: number; batch_id: number; lot_code: string | null; received_at: string | null; expiry_date: string | null; available: number }>([supplierId, ...chunk, ...branches]))
  for (const row of rows) {
    const key = `${row.product_id}:${row.branch_id}`
    const lots = map.get(key) || []
    lots.push({ batchId: row.batch_id, lotCode: row.lot_code, receivedAt: row.received_at, expiryDate: row.expiry_date, available: row.available })
    map.set(key, lots)
  }
  return map
}
