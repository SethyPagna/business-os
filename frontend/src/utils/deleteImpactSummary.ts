type BranchStockEntry = {
  branch_id?: unknown
  quantity?: unknown
}

type BatchEntry = {
  [key: string]: unknown
}

// Loosely typed on purpose -- callers pass `ProductRecord` snapshots (which
// carry an index signature, not a declared `batches` field) straight from
// `snapshotProductsByIds`, and this also has to tolerate whatever a raw API
// row looks like without throwing.
export type DeleteImpactProduct = {
  id?: unknown
  name?: unknown
  branch_stock?: BranchStockEntry[] | unknown
  image_gallery?: unknown[] | unknown
  image_path?: unknown
  batches?: BatchEntry[] | unknown
  [key: string]: unknown
}

export interface DeleteImpactSummary {
  productCount: number
  productNames: string[]
  totalStockUnits: number
  branchesWithStock: number
  productsWithImages: number
  productsWithBatches: number
}

const EMPTY_SUMMARY: DeleteImpactSummary = {
  productCount: 0,
  productNames: [],
  totalStockUnits: 0,
  branchesWithStock: 0,
  productsWithImages: 0,
  productsWithBatches: 0,
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

// Summarizes what deleting these product row(s) will also take with it --
// stock units/branches, uploaded images, and active batch/lot stock -- for
// DeleteConfirmModal's "This will also remove:" section (progress.md part
// 202: "show what will be affected and require explicit confirmation").
// Pure/no I/O: takes already-loaded snapshots (from `snapshotProductsByIds`,
// which include `branch_stock`/`images`/`batches` per its own fetch include
// list), never fetches anything itself. Deliberately tolerant of malformed
// input (missing arrays, non-array `branch_stock`, undefined product list)
// since it's driven by whatever's already in memory, not a trusted schema.
export function summarizeDeleteImpact(products: DeleteImpactProduct[] | null | undefined): DeleteImpactSummary {
  if (!Array.isArray(products) || products.length === 0) return { ...EMPTY_SUMMARY }

  const productNames: string[] = []
  let totalStockUnits = 0
  let productsWithImages = 0
  let productsWithBatches = 0
  const branchesWithStock = new Set<string>()

  for (const product of products) {
    productNames.push(typeof product?.name === 'string' ? product.name : '')

    const branchStock = Array.isArray(product?.branch_stock) ? (product.branch_stock as BranchStockEntry[]) : []
    for (const row of branchStock) {
      const qty = toNumber(row?.quantity)
      totalStockUnits += qty
      if (qty > 0 && row?.branch_id != null) branchesWithStock.add(String(row.branch_id))
    }

    const gallery = Array.isArray(product?.image_gallery) ? (product.image_gallery as unknown[]) : []
    const hasImage = gallery.length > 0 || Boolean(product?.image_path)
    if (hasImage) productsWithImages += 1

    const batches = Array.isArray(product?.batches) ? (product.batches as BatchEntry[]) : []
    if (batches.length > 0) productsWithBatches += 1
  }

  return {
    productCount: products.length,
    productNames,
    totalStockUnits,
    branchesWithStock: branchesWithStock.size,
    productsWithImages,
    productsWithBatches,
  }
}
