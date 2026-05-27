type BranchId = string | number

type BranchStockEntry = {
  branch_id?: unknown
  quantity?: unknown
}

type ProductBatch = {
  quantity?: unknown
  branch_stock?: BranchStockEntry[] | unknown
  [key: string]: unknown
}

type ProductWithBatches = {
  batches?: ProductBatch[] | unknown
} | null | undefined

type VisibleProductBatch = ProductBatch & {
  quantity: number
}

type BatchPreviewOptions = {
  limit?: number
}

function normalizeBranchId(branchId: BranchId): number | null {
  if (branchId === 'all') return null
  const parsed = Number.parseInt(String(branchId), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function getVisibleProductBatches(product: ProductWithBatches, branchId: BranchId = 'all'): VisibleProductBatch[] {
  const items = Array.isArray(product?.batches) ? product.batches : []
  const normalizedBranchId = normalizeBranchId(branchId)
  return items
    .map((batch) => {
      const branchStock: BranchStockEntry[] = Array.isArray(batch?.branch_stock)
        ? batch.branch_stock as BranchStockEntry[]
        : []
      const quantity = normalizedBranchId
        ? branchStock
          .filter((entry) => Number(entry?.branch_id || 0) === normalizedBranchId)
          .reduce((sum, entry) => sum + Number(entry?.quantity || 0), 0)
        : Number(batch?.quantity || 0)
      return {
        ...batch,
        quantity,
      }
    })
    .filter((batch) => Number(batch?.quantity || 0) > 0)
}

export function buildBatchPreview(product: ProductWithBatches, branchId: BranchId = 'all', { limit = 3 }: BatchPreviewOptions = {}) {
  const batches = getVisibleProductBatches(product, branchId)
  return {
    items: batches.slice(0, limit),
    extraCount: Math.max(0, batches.length - limit),
    totalCount: batches.length,
  }
}
