import { normalizePriceValue } from '../../../utils/pricing.ts'
import { normalizeProductGallery } from './productGalleryHelpers.ts'

type StockAdjustmentType = 'add' | 'remove'

interface UserRecord {
  id?: unknown
  name?: unknown
}

interface BranchStockRecord {
  branch_id?: unknown
  branch_name?: unknown
  quantity?: unknown
  [key: string]: unknown
}

interface ProductRecord {
  id?: unknown
  name?: unknown
  sku?: unknown
  barcode?: unknown
  category?: unknown
  brand?: unknown
  unit?: unknown
  description?: unknown
  selling_price_usd?: unknown
  selling_price_khr?: unknown
  wholesale_price_usd?: unknown
  wholesale_price_khr?: unknown
  purchase_price_usd?: unknown
  purchase_price_khr?: unknown
  cost_price_usd?: unknown
  cost_price_khr?: unknown
  low_stock_threshold?: unknown
  out_of_stock_threshold?: unknown
  supplier?: unknown
  custom_fields?: unknown
  image_gallery?: unknown
  image_path?: unknown
  is_active?: unknown
  is_group?: unknown
  parent_id?: unknown
  branch_stock?: BranchStockRecord[]
  updated_at?: unknown
  [key: string]: unknown
}

interface BranchRecord {
  id?: unknown
  is_default?: unknown
  [key: string]: unknown
}

interface BranchStockAdjustment {
  branchId: number
  type: StockAdjustmentType
  quantity: number
}

interface ClearStockAdjustment {
  branchId: number
  quantity: number
  unitCostUsd: unknown
  unitCostKhr: unknown
}

interface ProductStockAdjustmentOptions {
  productId?: unknown
  productName?: unknown
  type?: StockAdjustmentType | string
  quantity?: unknown
  branchId?: unknown
  unitCostUsd?: unknown
  unitCostKhr?: unknown
  reason?: unknown
  user?: UserRecord
}

interface ProductBranchInitializePlan {
  action: 'initialize'
  branchId: number
}

interface ProductBranchTransferPlan {
  action: 'transfer'
  fromBranchId: number
  toBranchId: number
  quantity: number
}

type ProductBranchMovePlan = ProductBranchInitializePlan | ProductBranchTransferPlan

interface ProductTransferStockOptions {
  productId?: unknown
  productName?: unknown
  reason?: unknown
  user?: UserRecord
}

interface ProductBulkRunEntry {
  item?: unknown
  [key: string]: unknown
}

interface ProductBulkRun {
  successes?: ProductBulkRunEntry[]
  failures?: ProductBulkRunEntry[]
  [key: string]: unknown
}

type ProductUpdates = Record<string, unknown>

interface ProductBulkForm {
  category?: unknown
  unit?: unknown
  supplier?: unknown
  brand?: unknown
  low_stock_threshold?: unknown
  [key: string]: unknown
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hasBulkFormValue(value: unknown): boolean {
  return value !== undefined && value !== ''
}

function stringOrEmpty(value: unknown): string {
  return value ? String(value) : ''
}

export function buildProductWritePayload(snapshot: ProductRecord = {}, user: UserRecord = {}) {
  const gallery = normalizeProductGallery(snapshot.image_gallery, snapshot.image_path || null)
  return {
    name: stringOrEmpty(snapshot.name),
    sku: stringOrEmpty(snapshot.sku),
    barcode: stringOrEmpty(snapshot.barcode),
    category: stringOrEmpty(snapshot.category),
    brand: stringOrEmpty(snapshot.brand),
    unit: stringOrEmpty(snapshot.unit) || 'pcs',
    description: stringOrEmpty(snapshot.description),
    selling_price_usd: normalizePriceValue(snapshot.selling_price_usd || 0),
    selling_price_khr: normalizePriceValue(snapshot.selling_price_khr || 0),
    // The tier column, and NO `?? selling_price` fallback. The old VIP pair
    // that stood here defaulted to the selling price whenever a snapshot
    // omitted it, so any writer that built a payload from a partial record
    // silently stamped the selling price into the tier column -- a
    // client-composed value overwriting what the server held. That is
    // exactly the defect that would have re-polluted this column right after
    // migration 0111 moved 9,552 real prices into it. A snapshot that does
    // not carry a wholesale price writes 0, which reads as "no wholesale
    // price set" everywhere and offers no tier at the POS.
    wholesale_price_usd: normalizePriceValue(snapshot.wholesale_price_usd ?? 0),
    wholesale_price_khr: normalizePriceValue(snapshot.wholesale_price_khr ?? 0),
    purchase_price_usd: normalizePriceValue(snapshot.purchase_price_usd || snapshot.cost_price_usd || 0),
    purchase_price_khr: normalizePriceValue(snapshot.purchase_price_khr || snapshot.cost_price_khr || 0),
    cost_price_usd: normalizePriceValue(snapshot.cost_price_usd || snapshot.purchase_price_usd || 0),
    cost_price_khr: normalizePriceValue(snapshot.cost_price_khr || snapshot.purchase_price_khr || 0),
    low_stock_threshold: Number(snapshot.low_stock_threshold || 0),
    out_of_stock_threshold: Number(snapshot.out_of_stock_threshold || 0),
    supplier: stringOrEmpty(snapshot.supplier),
    custom_fields: snapshot.custom_fields || {},
    image_gallery: gallery,
    image_path: gallery[0] || null,
    is_active: snapshot.is_active ? 1 : 0,
    is_group: snapshot.parent_id ? 0 : (snapshot.is_group ? 1 : 0),
    parent_id: snapshot.parent_id ? Number(snapshot.parent_id) : null,
    userId: user.id,
    userName: user.name,
  }
}

export function buildProductBranchStockAdjustments(snapshot: ProductRecord = {}, currentProduct: ProductRecord = {}): BranchStockAdjustment[] {
  const targetMap = new Map<number, number>()
  for (const entry of snapshot?.branch_stock || []) {
    const branchId = Number(entry?.branch_id || 0)
    if (!Number.isFinite(branchId) || branchId <= 0) continue
    targetMap.set(branchId, toFiniteNumber(entry?.quantity, 0))
  }

  const currentMap = new Map<number, number>()
  for (const entry of currentProduct?.branch_stock || []) {
    const branchId = Number(entry?.branch_id || 0)
    if (!Number.isFinite(branchId) || branchId <= 0) continue
    currentMap.set(branchId, toFiniteNumber(entry?.quantity, 0))
  }

  const branchIds = [...new Set([...targetMap.keys(), ...currentMap.keys()])]
  return branchIds
    .map((branchId): BranchStockAdjustment | null => {
      const targetQty = toFiniteNumber(targetMap.get(branchId), 0)
      const currentQty = toFiniteNumber(currentMap.get(branchId), 0)
      if (targetQty === currentQty) return null
      return {
        branchId,
        type: targetQty > currentQty ? 'add' : 'remove',
        quantity: Math.abs(targetQty - currentQty),
      }
    })
    .filter((entry): entry is BranchStockAdjustment => entry !== null)
}

export function buildProductClearStockAdjustments(product: ProductRecord = {}): ClearStockAdjustment[] {
  const unitCostUsd = product?.purchase_price_usd || product?.cost_price_usd || 0
  const unitCostKhr = product?.purchase_price_khr || product?.cost_price_khr || 0
  return (product?.branch_stock || [])
    .map((entry): ClearStockAdjustment | null => {
      const branchId = Number(entry?.branch_id || 0)
      const quantity = toFiniteNumber(entry?.quantity, 0)
      if (!Number.isFinite(branchId) || branchId <= 0 || quantity <= 0) return null
      return {
        branchId,
        quantity,
        unitCostUsd,
        unitCostKhr,
      }
    })
    .filter((entry): entry is ClearStockAdjustment => entry !== null)
}

export function buildProductStockAdjustmentPayload(product: ProductRecord = {}, options: ProductStockAdjustmentOptions = {}) {
  const productId = Number(options.productId ?? product?.id ?? 0)
  const branchId = Number(options.branchId ?? 0)
  return {
    productId,
    productName: options.productName ?? product?.name ?? '',
    type: options.type || 'add',
    quantity: toFiniteNumber(options.quantity, 0),
    branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : null,
    unitCostUsd: options.unitCostUsd ?? (product?.purchase_price_usd || product?.cost_price_usd || 0),
    unitCostKhr: options.unitCostKhr ?? (product?.purchase_price_khr || product?.cost_price_khr || 0),
    reason: options.reason || '',
    userId: options.user?.id,
    userName: options.user?.name,
  }
}

export function buildProductBranchMovePlan(product: ProductRecord = {}, targetBranchId: unknown = 0): ProductBranchMovePlan | null {
  const toBranchId = Number(targetBranchId || 0)
  if (!Number.isFinite(toBranchId) || toBranchId <= 0) return null

  const currentBranch = (product?.branch_stock || [])
    .map((entry) => ({
      branchId: Number(entry?.branch_id || 0),
      quantity: toFiniteNumber(entry?.quantity, 0),
    }))
    .find((entry) => Number.isFinite(entry.branchId) && entry.branchId > 0 && entry.quantity > 0)

  if (!currentBranch) {
    return {
      action: 'initialize',
      branchId: toBranchId,
    }
  }

  if (currentBranch.branchId === toBranchId) return null

  return {
    action: 'transfer',
    fromBranchId: currentBranch.branchId,
    toBranchId,
    quantity: currentBranch.quantity,
  }
}

export function buildProductTransferStockPayload(product: ProductRecord = {}, movePlan: Partial<ProductBranchTransferPlan> = {}, options: ProductTransferStockOptions = {}) {
  return {
    fromBranchId: toFiniteNumber(movePlan?.fromBranchId, 0),
    toBranchId: toFiniteNumber(movePlan?.toBranchId, 0),
    productId: Number(options.productId ?? product?.id ?? 0),
    productName: options.productName ?? product?.name ?? '',
    quantity: toFiniteNumber(movePlan?.quantity, 0),
    note: options.reason || '',
    userId: options.user?.id,
    userName: options.user?.name,
  }
}

export function summarizeProductBulkRun(run: ProductBulkRun = {}) {
  const updatedIds = (run?.successes || [])
    .map((entry) => Number(entry?.item))
    .filter((id) => Number.isFinite(id) && id > 0)
  const failedIds = (run?.failures || [])
    .map((entry) => Number(entry?.item))
    .filter((id) => Number.isFinite(id) && id > 0)
  return {
    done: updatedIds.length,
    failed: failedIds.length,
    failedIds,
    updatedIds,
  }
}

export function buildDefinedProductUpdates(updates: ProductUpdates = {}): ProductUpdates {
  return Object.fromEntries(
    Object.entries(updates || {}).filter(([, value]) => value !== undefined),
  )
}

export function buildProductBulkUpdatePayload(
  updates: ProductUpdates = {},
  currentProduct: ProductRecord = {},
  user: UserRecord = {},
  fallbackUpdatedAt: unknown = undefined,
) {
  const expectedUpdatedAt = currentProduct?.updated_at || fallbackUpdatedAt || undefined
  return {
    ...buildDefinedProductUpdates(updates),
    updated_at: expectedUpdatedAt,
    expectedUpdatedAt,
    userId: user.id,
    userName: user.name,
  }
}

export function buildProductBulkInfoUpdates(form: ProductBulkForm = {}): ProductUpdates {
  const updates: ProductUpdates = {}
  if (form.category) updates.category = form.category
  if (form.unit) updates.unit = form.unit
  if (form.supplier) updates.supplier = form.supplier
  if (form.brand) updates.brand = form.brand
  if (hasBulkFormValue(form.low_stock_threshold)) {
    const threshold = Number.parseInt(String(form.low_stock_threshold), 10)
    if (Number.isFinite(threshold)) updates.low_stock_threshold = threshold
  }
  return updates
}

export function buildProductBulkPricingUpdates(form: ProductBulkForm = {}): ProductUpdates {
  const updates: ProductUpdates = {}
  for (const field of [
    'selling_price_usd',
    'selling_price_khr',
    'wholesale_price_usd',
    'wholesale_price_khr',
    'purchase_price_usd',
    'purchase_price_khr',
  ]) {
    if (hasBulkFormValue(form[field])) updates[field] = normalizePriceValue(form[field])
  }
  return updates
}

// --- relative price adjustment ("raise everything by $1") -----------------
//
// buildProductBulkPricingUpdates above SETS every selected product to the
// same absolute price. That is the wrong tool for "add $1 to all of these":
// it would flatten a catalogue of differently-priced products to one value.
// This computes a PER-PRODUCT update instead, since each result depends on
// that product's own current price.
//
// Deliberate decisions, each of which is a way this can go wrong quietly:
//
//   - Only the fields named in `fields` are touched. "Selling price only"
//     has to mean only that -- a helper that also nudged cost price would
//     silently change every margin in the catalogue.
//   - `skipZeroPriced` exists because a 0 usually means "not priced yet",
//     not "free". Adding $1 to those would invent a price for products
//     nobody has priced, which is worse than skipping them.
//   - Results are clamped at 0. A decrease bigger than the current price
//     would otherwise produce a negative price, which is never a real
//     intent and would corrupt totals downstream.
//   - Money is rounded to 2 decimals for USD and to whole units for KHR
//     (riel has no minor unit in practice here), so repeated adjustments
//     cannot accumulate floating-point dust.
//   - A product whose every targeted field is skipped yields NO update at
//     all, rather than an empty write. That keeps the "changed N products"
//     count honest and avoids pointless round trips.

export type BulkPriceField =
  | 'selling_price_usd'
  | 'selling_price_khr'
  | 'wholesale_price_usd'
  | 'wholesale_price_khr'
  | 'purchase_price_usd'
  | 'purchase_price_khr'

export interface BulkPriceAdjustment {
  /** 'increase' adds, 'decrease' subtracts. */
  direction: 'increase' | 'decrease'
  /** Always a positive magnitude; `direction` carries the sign. */
  amount: unknown
  /** Which price columns to move. Empty means nothing is changed. */
  fields: readonly BulkPriceField[]
  /**
   * Leave a product alone when the field being adjusted is currently 0.
   * A 0 in this catalogue means "not priced yet" far more often than it
   * means "free".
   */
  skipZeroPriced?: boolean
}

export interface BulkPriceAdjustmentResult {
  id: number
  updates: ProductUpdates
}

function roundMoney(value: number, field: BulkPriceField): number {
  if (field.endsWith('_khr')) return Math.round(value)
  return Math.round(value * 100) / 100
}

export function buildProductBulkPriceAdjustments(
  products: ProductRecord[] = [],
  adjustment: BulkPriceAdjustment,
): BulkPriceAdjustmentResult[] {
  const magnitude = Math.abs(toFiniteNumber(adjustment?.amount, 0))
  const fields = adjustment?.fields || []
  // A zero amount is a no-op, not a write of the same value back.
  if (!magnitude || !fields.length) return []
  const delta = adjustment.direction === 'decrease' ? -magnitude : magnitude

  const results: BulkPriceAdjustmentResult[] = []
  for (const product of products) {
    const id = Number(product?.id || 0)
    if (!Number.isFinite(id) || id <= 0) continue

    const updates: ProductUpdates = {}
    for (const field of fields) {
      const current = normalizePriceValue(product?.[field])
      if (adjustment.skipZeroPriced && current === 0) continue
      const next = roundMoney(Math.max(0, current + delta), field)
      // Skip a field the adjustment does not actually move -- e.g. a
      // decrease against a price already at 0.
      if (next === current) continue
      updates[field] = next
    }
    if (Object.keys(updates).length) results.push({ id, updates })
  }
  return results
}

/** How many products a given adjustment would actually change. For preview text. */
export function countProductBulkPriceAdjustments(
  products: ProductRecord[] = [],
  adjustment: BulkPriceAdjustment,
): number {
  return buildProductBulkPriceAdjustments(products, adjustment).length
}

export function getDefaultProductRestoreBranchId(branches: BranchRecord[] = []): number {
  const defaultBranch = branches.find((branch) => branch?.is_default) || branches[0] || {}
  const branchId = Number(defaultBranch?.id || 0)
  return Number.isFinite(branchId) && branchId > 0 ? branchId : 0
}

export function buildDeletedProductIdSet(snapshots: ProductRecord[] = []): Set<number> {
  return new Set(
    snapshots
      .map((snapshot) => Number(snapshot?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0),
  )
}

export function getPreferredProductRestoreBranchId(snapshot: ProductRecord = {}, defaultBranchId: unknown = 0): number {
  const fallbackBranchId = Number(defaultBranchId || 0)
  const preferredEntry = (snapshot?.branch_stock || []).find((entry) => toFiniteNumber(entry?.quantity, 0) > 0)
  const preferredBranchId = Number(preferredEntry?.branch_id || 0)
  if (Number.isFinite(preferredBranchId) && preferredBranchId > 0) return preferredBranchId
  return Number.isFinite(fallbackBranchId) && fallbackBranchId > 0 ? fallbackBranchId : 0
}

export function resolveRestoredProductParentId(
  snapshot: ProductRecord = {},
  deletedIdSet: Set<number> = new Set(),
  restoredIdMap: Map<number, unknown> = new Map(),
): number {
  const originalParentId = Number(snapshot?.parent_id || 0)
  if (!Number.isFinite(originalParentId) || originalParentId <= 0) return 0
  if (!deletedIdSet.has(originalParentId)) return originalParentId
  const restoredParentId = Number(restoredIdMap.get(originalParentId) || 0)
  return Number.isFinite(restoredParentId) && restoredParentId > 0 ? restoredParentId : 0
}
