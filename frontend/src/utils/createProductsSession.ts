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
    unitCostUsd: Math.max(0, numeric(payload.cost_price_usd)),
    lotCode: '',
    status: 'created',
    detail: '',
  }
}

/**
 * The opening stock of a created product goes through the SAME kernel every
 * other add-stock surface uses (receiveBatchStock), carrying this session's
 * id as the movement reference -- which is precisely what makes the whole
 * run show up as ONE row in Stock-in Sessions, with this session's supplier,
 * branch, line count and total cost on it. Returns null when the item was
 * created at zero, because there is no receipt to post.
 */
export function openingStockRequest(
  row: CreateProductsSessionRow,
  header: CreateProductsHeader,
  sessionId: number,
  receivedDate: string,
): {
  productId: number
  branchId: number
  quantity: number
  receivedDate: string | null
  expiryDate: string | null
  supplierId: number | null
  supplierName: string | null
  unitCostUsd: number | null
  sessionId: number
} | null {
  const productId = Number(row.productId)
  const branchId = Number(row.branchId)
  if (!productId || !branchId || row.quantity <= 0) return null
  // The item form stays editable, so a row may carry a supplier the header
  // never picked. A supplier CONTACT id only travels with the name it
  // belongs to -- an overridden name is a deliberate name-only attribution
  // (the same first-class state the import engine writes), never a silent
  // re-label of someone else's contact.
  const rowSupplier = row.supplierName.trim()
  const sameAsHeader = rowSupplier.toLowerCase() === header.supplierName.trim().toLowerCase()
  return {
    productId,
    branchId,
    quantity: row.quantity,
    receivedDate: receivedDate.trim() || null,
    expiryDate: null,
    supplierId: sameAsHeader ? header.supplierId : null,
    supplierName: rowSupplier || null,
    unitCostUsd: row.unitCostUsd > 0 ? row.unitCostUsd : null,
    sessionId,
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
