import { sumCountedQuantities, subtractCountedQuantity } from './countedDamagedStock'
import type { ProductMergeCaseSnapshot, ProductMergeStockRow, ProductMergeBatchStockRow, ProductMergeBatchRow } from './productMergeSnapshot'

type MergeReceiptOrigin = {
  original: ProductMergeBatchRow
  quantityByBranch: ReadonlyMap<number, number>
}

type MergeTagOrigin = {
  original: Record<string, unknown>
  id: number
  branchId: number
  batchId: number | null
  quantity: number
  remaining: number
}

type MergeProductLedger = {
  productId: number
  quantityByBranch: Map<number, number>
  receipts: MergeReceiptOrigin[]
  tags: MergeTagOrigin[]
  total: number
}

function identity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('merge_state_conflict')
  return value
}

function quantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('merge_state_conflict')
  return subtractCountedQuantity(value, [])
}

function quantitiesByBranch(rows: readonly ProductMergeStockRow[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.branch_id) || row.branch_id <= 0 || result.has(row.branch_id)
      || !Number.isFinite(row.quantity) || row.quantity < 0) throw new Error('merge_state_conflict')
    result.set(row.branch_id, subtractCountedQuantity(row.quantity, []))
  }
  return result
}

function productLedger(
  productId: number,
  cache: unknown,
  stocks: readonly ProductMergeStockRow[],
  receiptRows: readonly ProductMergeBatchRow[],
  receiptStocks: readonly ProductMergeBatchStockRow[],
  tagRows: readonly Record<string, unknown>[],
): MergeProductLedger {
  const branches = quantitiesByBranch(stocks)
  const receiptMap = new Map<number, { original: ProductMergeBatchRow; quantityByBranch: Map<number, number> }>()
  for (const row of receiptRows) {
    const id = identity(row.id)
    if (identity(row.variant_product_id) !== productId || receiptMap.has(id)) throw new Error('merge_state_conflict')
    receiptMap.set(id, { original: row, quantityByBranch: new Map() })
  }
  const totals = new Map<number, number[]>()
  for (const row of receiptStocks) {
    const receipt = receiptMap.get(identity(row.batch_id))
    identity(row.branch_id)
    if (!receipt || receipt.quantityByBranch.has(row.branch_id)) throw new Error('merge_state_conflict')
    receipt.quantityByBranch.set(row.branch_id, quantity(row.quantity))
    const values = totals.get(row.branch_id) ?? []
    values.push(row.quantity)
    totals.set(row.branch_id, values)
  }
  for (const [branchId, values] of totals) {
    if (subtractCountedQuantity(branches.get(branchId) ?? 0, values) < 0) throw new Error('merge_state_conflict')
  }
  const tags: MergeTagOrigin[] = []
  const taggedBySource = new Map<string, { branchId: number; batchId: number | null; values: number[] }>()
  const tagIds = new Set<number>()
  for (const row of tagRows) {
    const id = identity(row.id), branchId = identity(row.branch_id)
    const batchId = row.batch_id === null ? null : identity(row.batch_id)
    const cap = quantity(row.quantity), remaining = quantity(row.quantity_remaining)
    if (identity(row.product_id) !== productId || tagIds.has(id) || remaining > cap
      || (batchId !== null && !receiptMap.has(batchId))) throw new Error('merge_state_conflict')
    tagIds.add(id)
    const key = `${branchId}:${batchId ?? 'null'}`
    const source = taggedBySource.get(key) ?? { branchId, batchId, values: [] }
    source.values.push(remaining)
    taggedBySource.set(key, source)
    tags.push({ original: row, id, branchId, batchId, quantity: cap, remaining })
  }
  for (const { branchId, batchId, values } of taggedBySource.values()) {
    const capacity = batchId === null
      ? subtractCountedQuantity(branches.get(branchId) ?? 0, totals.get(branchId) ?? [])
      : receiptMap.get(batchId)!.quantityByBranch.get(branchId) ?? 0
    if (subtractCountedQuantity(capacity, values) < 0) throw new Error('merge_state_conflict')
  }
  const total = sumCountedQuantities([...branches.values()])
  if (quantity(cache) !== total) throw new Error('merge_state_conflict')
  return { productId, quantityByBranch: branches, receipts: [...receiptMap.values()], tags, total }
}

export function planExactProductMergeStock(snapshot: ProductMergeCaseSnapshot, disposition: 'merge' | 'write_off') {
  const keeperId = identity(snapshot.canonicalProduct?.id), duplicateId = identity(snapshot.duplicateProduct?.id)
  if (keeperId === duplicateId || snapshot.damagedStockRows.some(row => row.product_id !== keeperId && row.product_id !== duplicateId)) throw new Error('merge_state_conflict')
  const keeperSource = productLedger(keeperId, snapshot.canonicalProduct?.stock_quantity, snapshot.canonicalStockBefore,
    snapshot.canonicalBatchRows, snapshot.canonicalBatchStockRows, snapshot.damagedStockRows.filter(row => row.product_id === keeperId))
  const duplicateSource = productLedger(duplicateId, snapshot.duplicateProduct?.stock_quantity, snapshot.duplicateStockRows,
    snapshot.duplicateBatchRows, snapshot.duplicateBatchStockRows, snapshot.damagedStockRows.filter(row => row.product_id === duplicateId))
  const keeper = keeperSource.quantityByBranch, duplicate = duplicateSource.quantityByBranch
  const duplicateTotal = duplicateSource.total
  const after = new Map(keeper)
  if (disposition === 'merge') for (const [branchId, quantity] of duplicate) {
    if (quantity > 0) after.set(branchId, sumCountedQuantities([after.get(branchId) ?? 0, quantity]))
  }
  return {
    keeperSource,
    duplicateSource,
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
