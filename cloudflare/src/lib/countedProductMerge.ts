import { sumCountedQuantities, subtractCountedQuantity } from './countedDamagedStock'
import type { ProductMergeCaseSnapshot, ProductMergeStockRow, ProductMergeBatchStockRow } from './productMergeSnapshot'

function quantitiesByBranch(rows: readonly ProductMergeStockRow[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.branch_id) || row.branch_id <= 0 || result.has(row.branch_id)
      || !Number.isFinite(row.quantity) || row.quantity < 0) throw new Error('merge_state_conflict')
    result.set(row.branch_id, subtractCountedQuantity(row.quantity, []))
  }
  return result
}

function assertReceiptCoverage(branches: ReadonlyMap<number, number>, rows: readonly ProductMergeBatchStockRow[]): void {
  const receipts = new Set<string>()
  const totals = new Map<number, number[]>()
  for (const row of rows) {
    const key = `${row.batch_id}:${row.branch_id}`
    if (!Number.isSafeInteger(row.batch_id) || row.batch_id <= 0
      || !Number.isSafeInteger(row.branch_id) || row.branch_id <= 0 || receipts.has(key)
      || !Number.isFinite(row.quantity) || row.quantity < 0) throw new Error('merge_state_conflict')
    receipts.add(key)
    const values = totals.get(row.branch_id) ?? []
    values.push(row.quantity)
    totals.set(row.branch_id, values)
  }
  for (const [branchId, values] of totals) {
    if (subtractCountedQuantity(branches.get(branchId) ?? 0, values) < 0) throw new Error('merge_state_conflict')
  }
}

export function planExactProductMergeStock(snapshot: ProductMergeCaseSnapshot, disposition: 'merge' | 'write_off') {
  const keeper = quantitiesByBranch(snapshot.canonicalStockBefore)
  const duplicate = quantitiesByBranch(snapshot.duplicateStockRows)
  assertReceiptCoverage(keeper, snapshot.canonicalBatchStockRows)
  assertReceiptCoverage(duplicate, snapshot.duplicateBatchStockRows)
  const keeperTotal = sumCountedQuantities([...keeper.values()])
  const duplicateTotal = sumCountedQuantities([...duplicate.values()])
  if (snapshot.canonicalProduct?.stock_quantity !== keeperTotal || snapshot.duplicateProduct?.stock_quantity !== duplicateTotal) {
    throw new Error('merge_state_conflict')
  }
  const after = new Map(keeper)
  if (disposition === 'merge') for (const [branchId, quantity] of duplicate) {
    if (quantity > 0) after.set(branchId, sumCountedQuantities([after.get(branchId) ?? 0, quantity]))
  }
  return {
    keeperByBranch: after,
    keeperTotal: sumCountedQuantities([...after.values()]),
    moved: disposition === 'merge' ? duplicateTotal : 0,
    writtenOff: disposition === 'write_off' ? duplicateTotal : 0,
    receiptAfter: (batchId: number, branchId: number, incoming: number): number => sumCountedQuantities([
      snapshot.canonicalBatchStockRows.find(row => row.batch_id === batchId && row.branch_id === branchId)?.quantity ?? 0,
      incoming,
    ]),
  }
}
