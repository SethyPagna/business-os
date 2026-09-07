// S4-12: the create-products SESSION model.
//
// The shop owner entering twenty products from one supplier delivery asked
// for the shape they already use for receiving stock: "so beginning it will
// have Brand, Supplier, Branch then add new items page which is the current
// add products ... same as the session for add stock, and will show this in
// the session".
//
// So this file is deliberately the same shape as the fast stock-in session
// (FastStockInModal.tsx + StockInSessionsSection.tsx), not a second pattern:
//
//   header (entered ONCE)  ->  repeated item entry  ->  one session record
//
// Everything here is pure so the rules can be tested without React:
// tests/createProductsSession.test.ts.
//
// The session's numbers (items / units / total cost) and its header columns
// (brand / supplier / branch) are computed the same way StockInSessionsSection
// computes a stock-in session's: a column shows the ONE value when every row
// agrees and a "Multiple ..." label when they do not -- so a header that was
// overridden on one item can never make the session summary lie.

import { identityBarcodeKey, normalizeProductGroupName } from './productDetailRule.ts'
import { barcodeKeysMatch } from './searchMatch.ts'

export type CreateProductsHeader = {
  /** Free-text brand, exactly like ProductForm's own brand field. */
  brand: string
  /** Supplier CONTACT id when a suggestion was picked; null for name-only. */
  supplierId: number | null
  supplierName: string
  /** Branch the opening stock of every product in this session lands in. */
  branchId: string
}

export type CreateProductsSessionRow = {
  key: string
  productId: number | string
  name: string
  barcode: string
  brand: string
  supplierName: string
  branchId: string
  branchName: string
  quantity: number
  unitCostUsd: number
  /** Lot the opening stock landed in; '' when the item was created at 0. */
  lotCode: string
  /** 'created' = product written; 'stock_failed' = product written, stock not. */
  status: 'created' | 'stock_failed'
  detail: string
}

export type CreateProductsSessionDraft = {
  sessionId: number
  header: CreateProductsHeader
  rows: CreateProductsSessionRow[]
  /** Which step the operator was on, so a reopen lands where they left. */
  step: 'header' | 'items'
  /**
   * The one lot date the whole delivery shares. Persisted so a session
   * resumed the next morning keeps posting into the delivery's own day
   * rather than silently splitting across two lot codes.
   */
  receivedDate?: string
}

export type CreateProductsSessionPermissionRequirement = {
  permissionKey: 'products' | 'inventory'
  actionKey: 'add' | 'adjust'
}

export type CreateProductsSessionMinimizeDetails = {
  draftKey: string
  mode: 'new' | 'existing'
  requiredPermissions: CreateProductsSessionPermissionRequirement[]
}

export function createProductsSessionPermissionRequirements(
  rows: Array<{ kind: 'receive' | 'create_receive' | 'created_zero'; status: 'queued' | 'saved'; quantity: number }>,
  mode: 'new' | 'existing',
): CreateProductsSessionPermissionRequirement[] {
  const queued = rows.filter((row) => row.status === 'queued')
  const required: CreateProductsSessionPermissionRequirement[] = []
  if (queued.some((row) => row.kind === 'create_receive' || row.kind === 'created_zero')) {
    required.push({ permissionKey: 'products', actionKey: 'add' })
  }
  if (queued.some((row) => row.kind === 'receive' || (row.kind === 'create_receive' && row.quantity > 0))) {
    required.push({ permissionKey: 'inventory', actionKey: 'adjust' })
  }
  if (!required.length) {
    required.push(mode === 'new'
      ? { permissionKey: 'products', actionKey: 'add' }
      : { permissionKey: 'inventory', actionKey: 'adjust' })
  }
  return required
}

export type CreateProductsSessionLabels = {
  multipleBrands: string
  multipleSuppliers: string
  multipleBranches: string
  none: string
}

export type CreateProductsSessionSummary = {
  items: number
  units: number
  costUsd: number
  brand: string
  supplier: string
  branch: string
}

export function emptyCreateProductsHeader(branchId = ''): CreateProductsHeader {
  return { brand: '', supplierId: null, supplierName: '', branchId }
}

/**
 * Typed-but-uncommitted header data. Close on a dirty form must offer
 * "Discard changes / Back" (the user has asked for that prompt repeatedly),
 * and the branch is PRE-FILLED from the page's default -- an untouched
 * default is not typing, so it must not arm the prompt on its own.
 */
export function isCreateProductsHeaderDirty(
  header: CreateProductsHeader,
  defaultBranchId = '',
): boolean {
  if (header.brand.trim()) return true
  if (header.supplierName.trim()) return true
  if (header.supplierId != null) return true
  return String(header.branchId || '') !== String(defaultBranchId || '')
}

/**
 * The one gate on leaving the header step. Only the branch is required: the
 * opening stock of every item has to land somewhere, while a shop that does
 * not track brands or suppliers must not be blocked from creating products.
 */
export function canStartCreateProductsSession(header: CreateProductsHeader): boolean {
  return Boolean(String(header.branchId || '').trim())
}

/**
 * What the header hands the item form. These are DEFAULTS, not a lock: the
 * item form stays the full "current add products" form and the operator may
 * still change any of the three on one item -- summarize() below is what
 * keeps the session honest when they do.
 */
export function createProductsSessionDefaults(header: CreateProductsHeader): {
  brand: string
  supplier: string
  branch_id: string
} {
  return {
    brand: header.brand.trim(),
    supplier: header.supplierName.trim(),
    branch_id: String(header.branchId || ''),
  }
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * One created product, as the session records it. Reads the values that were
 * ACTUALLY saved off the item payload (falling back to the header) rather
 * than assuming the header rode through untouched.
 */
export function createProductsSessionRow(
  payload: Record<string, unknown>,
  header: CreateProductsHeader,
  extra: { productId: number | string; branchName?: string; key?: string },
): CreateProductsSessionRow {
  const branchId = String(payload.branch_id ?? header.branchId ?? '')
  return {
    key: extra.key || `${extra.productId}-${Date.now()}`,
    productId: extra.productId,
    name: String(payload.name ?? '').trim(),
    barcode: String(payload.barcode ?? '').trim(),
    brand: String(payload.brand ?? header.brand ?? '').trim(),
    supplierName: String(payload.supplier ?? header.supplierName ?? '').trim(),
    branchId,
    branchName: String(extra.branchName ?? ''),
    quantity: Math.max(0, Math.floor(numeric(payload.stock_quantity))),
    // N14-D: whatever the caller stated. The clamp stays only as a floor for a
    // negative figure; a blank never reaches here (CreateProductsSessionModal
    // refuses it before this row is built) and must never become a silent 0.
    unitCostUsd: Math.max(0, numeric(payload.cost_price_usd)),
    lotCode: '',
    status: 'created',
    detail: '',
  }
}

function collapse(values: string[], headerValue: string, multiple: string, none: string): string {
  const distinct = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (distinct.length > 1) return multiple
  if (distinct.length === 1) return distinct[0]
  return headerValue.trim() || none
}

/**
 * The session record's own columns. Same collapse rule as a stock-in
 * session's supplier/branch columns (supplier_state_count > 1 -> "Multiple
 * suppliers"), so this reads identically to the surface it mirrors.
 */
export function summarizeCreateProductsSession(
  rows: CreateProductsSessionRow[],
  header: CreateProductsHeader,
  labels: CreateProductsSessionLabels,
): CreateProductsSessionSummary {
  let units = 0
  let costUsd = 0
  for (const row of rows) {
    units += Math.max(0, row.quantity)
    costUsd += Math.max(0, row.quantity) * Math.max(0, row.unitCostUsd)
  }
  return {
    items: rows.length,
    units,
    costUsd: Math.round(costUsd * 100) / 100,
    brand: collapse(rows.map((row) => row.brand), header.brand, labels.multipleBrands, labels.none),
    supplier: collapse(rows.map((row) => row.supplierName), header.supplierName, labels.multipleSuppliers, labels.none),
    branch: collapse(rows.map((row) => row.branchName), '', labels.multipleBranches, labels.none),
  }
}

/**
 * "these two queued lines are the same product".
 *
 * The session refuses to queue one article twice, and it decided that with
 * a plain `row.barcode.trim() === barcode` comparison. Two lines typed
 * '0748485110011' and '748485110011' therefore both got through and became
 * TWO catalog rows for one article -- the 2026-09-06 leading-zero report
 * reaching the create path, where it forks the catalog rather than merely
 * failing a search.
 *
 * The barcode is compared through identityBarcodeKey, the one fold both
 * packages carry; name and cost keep the comparisons they already had (a
 * cost difference is deliberately a DIFFERENT line -- the session records
 * what each delivery actually cost).
 */
export function isSameQueuedProduct(
  left: { name?: unknown; barcode?: unknown; unitCostUsd?: unknown },
  right: { name?: unknown; barcode?: unknown; unitCostUsd?: unknown },
): boolean {
  const name = (value: unknown): string => String(value ?? '').trim().toLowerCase()
  const cents = (value: unknown): number => {
    const parsed = Number(value)
    return Math.round((Number.isFinite(parsed) ? parsed : 0) * 10000)
  }
  return name(left.name) === name(right.name)
    && identityBarcodeKey(left.barcode) === identityBarcodeKey(right.barcode)
    && cents(left.unitCostUsd) === cents(right.unitCostUsd)
}

export type SessionProductDuplicateReason = 'name' | 'barcode'

/**
 * A session-entry safety rule, deliberately separate from catalog identity.
 * The operator should not add a second line for the same barcode OR retype the
 * same normalized name in one open session; they should edit the first line's
 * quantity instead. Empty names/barcodes never match. Barcode comparison uses
 * the scanner's guarded UPC/EAN relation, so a valid UPC-E cannot collide with
 * an unrelated seven-digit internal code after its leading zero is stripped.
 */
export function sessionProductDuplicateReason(
  left: { name?: unknown; barcode?: unknown },
  right: { name?: unknown; barcode?: unknown },
): SessionProductDuplicateReason | null {
  const leftName = normalizeProductGroupName(left.name)
  const rightName = normalizeProductGroupName(right.name)
  if (leftName && leftName === rightName) return 'name'
  const leftBarcode = String(left.barcode ?? '').trim()
  const rightBarcode = String(right.barcode ?? '').trim()
  if (!leftBarcode || !rightBarcode || /^0+$/.test(leftBarcode) || /^0+$/.test(rightBarcode)) return null
  return barcodeKeysMatch(leftBarcode, rightBarcode) ? 'barcode' : null
}

export function findSessionProductDuplicate<T extends { key?: unknown; lineId?: unknown; name?: unknown; barcode?: unknown }>(
  rows: readonly T[],
  candidate: { name?: unknown; barcode?: unknown },
  excludeKey?: unknown,
): { row: T; reason: SessionProductDuplicateReason } | null {
  for (const row of rows) {
    const rowKey = row.key ?? row.lineId
    if (excludeKey != null && String(rowKey) === String(excludeKey)) continue
    const reason = sessionProductDuplicateReason(row, candidate)
    if (reason) return { row, reason }
  }
  return null
}
