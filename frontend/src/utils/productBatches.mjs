export function getVisibleProductBatches(product, branchId = 'all') {
  const items = Array.isArray(product?.batches) ? product.batches : []
  const normalizedBranchId = branchId === 'all' ? null : Number.parseInt(branchId, 10)
  return items
    .map((batch) => {
      const branchStock = Array.isArray(batch?.branch_stock) ? batch.branch_stock : []
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

export function buildBatchPreview(product, branchId = 'all', { limit = 3 } = {}) {
  const batches = getVisibleProductBatches(product, branchId)
  return {
    items: batches.slice(0, limit),
    extraCount: Math.max(0, batches.length - limit),
    totalCount: batches.length,
  }
}
