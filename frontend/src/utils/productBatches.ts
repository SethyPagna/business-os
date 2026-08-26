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
  // Scalar count attached by the LIST reads (routes/inventory.ts's
  // attachBatchCounts) when the full `batches` array is deliberately not
  // shipped -- see buildBatchPreview's fallback below.
  batch_count?: unknown
} | null | undefined

type VisibleProductBatch = ProductBatch & {
  quantity: number
}

type BatchPreviewOptions = {
  limit?: number
  includeEmpty?: boolean
}

type VisibleBatchesOptions = {
  includeEmpty?: boolean
}

function normalizeBranchId(branchId: BranchId): number | null {
  if (branchId === 'all') return null
  const parsed = Number.parseInt(String(branchId), 10)
  return Number.isFinite(parsed) ? parsed : null
}

// `includeEmpty` (default false) keeps every existing caller's behavior
// unchanged -- compact row/list previews (Inventory.tsx, ProductRowParts.tsx)
// only want lots that actually have stock, since "what's sellable here" is
// the whole point of a quick badge. A product's full detail view is the one
// place that should show EVERY active batch, zero-quantity ones included:
// every product gets one "day added" batch the moment it's created (see
// cloudflare/src/lib/productWrites.ts's seedInitialBatchForNewProduct), and
// that batch legitimately starts at 0 stock. Filtering it out by default
// used to make the detail modal's own "Added <date>" row look like separate,
// disconnected information from "Batches" below it, when it's really just
// that same first batch (its lot_code is the same date-derived code every
// other batch gets, see cloudflare/src/lib/batchCode.ts) -- passing
// includeEmpty: true is what lets a fresh, still-zero-stock product show
// that one batch instead of an empty/missing Batches section.
export function getVisibleProductBatches(product: ProductWithBatches, branchId: BranchId = 'all', { includeEmpty = false }: VisibleBatchesOptions = {}): VisibleProductBatch[] {
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
    .filter((batch) => includeEmpty || Number(batch?.quantity || 0) > 0)
}

export function buildBatchPreview(product: ProductWithBatches, branchId: BranchId = 'all', { limit = 3, includeEmpty = false }: BatchPreviewOptions = {}) {
  const batches = getVisibleProductBatches(product, branchId, { includeEmpty })
  // The list reads attach a scalar `batch_count` instead of the full array
  // (too heavy for a page of rows -- see routes/inventory.ts). When the
  // array is absent but the count is present, report the count so the badge
  // reads "N batches" rather than the 0 the empty array used to produce.
  // The count is branch-agnostic (active batches with stock anywhere), so it
  // is only used as the all-branches fallback, never to override a real
  // per-branch array the detail view loaded.
  const scalarCount = Number((product as { batch_count?: unknown })?.batch_count || 0)
  const totalCount = batches.length > 0 ? batches.length : scalarCount
  return {
    items: batches.slice(0, limit),
    extraCount: Math.max(0, totalCount - limit),
    totalCount,
  }
}
