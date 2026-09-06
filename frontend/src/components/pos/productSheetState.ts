// The ProductDetailSheet's derived state, extracted as a pure function.
//
// Everything the sheet renders that is not a fetch or a `useState` is
// computed here: which branches to offer and how many units each holds,
// which product ROW the branch/option steps resolve to, the ONE stock
// number the sheet shows and the Add buttons enforce, whether the
// warehouse option is selectable, and the received-date (lot) list.
//
// It lives outside the component because every one of the defects this
// module was written to fix was invisible to the tests that existed:
// each of them was a regex over ProductDetailSheet.tsx's SOURCE TEXT,
// which cannot tell you that a flat product's stock reads 0 while its
// branch_stock says 28.
import { sortBatchesForPicker } from './posCore.ts'
import { branchRoleFromName, branchCanSell, type BranchRole } from '../../utils/branchRoles.ts'

export type BranchStockRow = {
  branch_id?: string | number | null
  branch_name?: string
  quantity?: string | number
}

export type SheetProductLike = Record<string, unknown> & {
  id: string | number
  branch_stock?: BranchStockRow[]
  out_of_stock_threshold?: string | number
  stock_quantity?: string | number
}

export type SheetBatchLike = {
  id: number
  quantity?: string | number
  expiry_date?: string | null
  batch_number?: number | null
  received_date?: string | null
  created_at?: string | null
  __productId?: number
}

export type SheetDamagedLotLike = {
  id: number
  quantity_remaining?: string | number
}

// One branch pill. `quantity` is the RESOLVED row's stock at that branch
// (the number the Add buttons enforce once you pick it), `groupQuantity`
// the whole group's -- the two differ whenever a name group carries
// several rows, and the pill must show the one the sale is capped by.
export type SheetBranchOption = {
  id: string
  name: string
  quantity: number
  groupQuantity: number
  role: BranchRole
  selectable: boolean
  blockedMessageKey: string | null
}

// 'sell' -- POS, add-items-to-sale, a return's replacement line: the
// warehouse is shown with its quantity but cannot be picked.
// 'stock'  -- add/remove/set/transfer/fast-stock-in: every branch the
// operation permits is selectable.
export type SheetIntent = 'sell' | 'stock'

export type ProductSheetStateInput = {
  product: SheetProductLike
  // getVariantChoices(product): the group's rows. EMPTY for a flat product.
  variants?: readonly SheetProductLike[]
  groupProduct?: boolean
  selectedBranchId?: string | null
  activeBranchId?: string | number | null
  selectedVariantId?: string | null
  trackedBatchProductIds?: Set<number> | null
  // Some hosts cannot honour a received date at all: a sale line's
  // REPLACEMENT is planned server-side with batchId null and drawn by FIFO
  // (cloudflare/src/routes/sales.ts, the line_replaced branch), so offering
  // the step there would let a cashier choose an intake the write then
  // ignores -- a silent break of the batch-identity rule. Hiding it makes the
  // sheet say what the surface can actually do rather than gating the pick on
  // a question with no effect. On-hand still comes from branch_stock.
  receivedDateStepHidden?: boolean
  batches?: readonly SheetBatchLike[]
  selectedBatchId?: number | null
  damagedLots?: readonly SheetDamagedLotLike[]
  selectedDamagedLotId?: number | null
  intent?: SheetIntent
  // Cross-branch fallback used only when the product carries no
  // branch_stock at all (POS's getDisplayStock).
  getDisplayStock?: (product: SheetProductLike | undefined) => number
  // What actually tells the resolved rows apart (posCore's
  // buildVariantOptionLabels stepTitle). Taken as a callback because it is
  // computed FROM the candidate pool this function resolves, and a plain
  // value would have to be derived by a second, duplicate resolution.
  optionStepTitleFor?: (pool: SheetProductLike[]) => string
}

export type ProductSheetState = {
  branchOptions: SheetBranchOption[]
  effectiveBranchId: string | null
  effectiveBranchOption: SheetBranchOption | null
  candidatePool: SheetProductLike[]
  effectiveVariant: SheetProductLike | null
  effectiveVariantStock: number
  displayedStock: number
  branchSummary: string
  warehouseDisabled: boolean
  isBatchTracked: boolean
  mergeRowsIntoLotList: boolean
  batchSelectionRequired: boolean
  batchReadyToSell: boolean
  receivedDateOptions: SheetBatchLike[]
  receivedDateTotal: number
  // TRUE when the branch holds units in branch_stock but the lot ledger
  // has nothing to draw them from. The sheet used to render this as
  // "Stock: 0" beside a branch line saying 28 -- two ledgers contradicting
  // each other on one screen, with no way for a cashier to tell which
  // one to believe.
  stockWithoutReceivedDate: boolean
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The branch NAME this product's own branch_stock payload carries for an id,
 * or null when the payload does not mention that branch.
 *
 * The name is the only discriminator the two canonical roles have in this
 * lineage (utils/branchRoles.ts), and every product row already ships one per
 * active branch -- so nothing has to be looked up to know whether an id is
 * the warehouse.
 */
export function branchNameFromProduct(product: SheetProductLike | null | undefined, branchId: unknown): string | null {
  const key = branchId == null ? '' : String(branchId)
  if (!key) return null
  for (const entry of Array.isArray(product?.branch_stock) ? product.branch_stock : []) {
    if (String(entry?.branch_id) === key) return String(entry?.branch_name ?? '')
  }
  return null
}

/**
 * Whether a SALE line may resolve to this branch.
 *
 * POS resolved a cart line's branch from the active branch filter, else from
 * whichever branch held the most units -- neither of which knew the warehouse
 * does not sell. Filter to the warehouse, or hold stock only there, and the
 * one-tap add booked a warehouse line that the checkout then refused with a
 * 400 the cashier could do nothing about. The branch is decided here now, on
 * the same predicate the sheet greys the pill with and the Worker rejects on.
 *
 * A branch the payload does not name is left alone: an unrecognised id is not
 * evidence of a stock-only branch.
 */
export function branchAllowsSale(product: SheetProductLike | null | undefined, branchId: unknown): boolean {
  const name = branchNameFromProduct(product, branchId)
  return name == null ? true : branchCanSell(name)
}

// `blocked` means: there is stock, but only where a sale may not be rung.
// The caller opens the sheet -- which shows the warehouse pill greyed WITH
// its quantity and says why -- instead of booking a line the checkout would
// refuse with a 400 the cashier can do nothing about.
export type SaleBranchDecision = { branchId: number | null; blocked: boolean }

/**
 * Which branch a POS cart line resolves to.
 *
 * POS used to answer this as `primaryBranchFilterId ?? pickBestBranchId()`,
 * and neither half knew the warehouse does not sell: filtering the grid to
 * the warehouse booked warehouse lines outright, and a product held ONLY at
 * the warehouse resolved there through the highest-stock loop -- which is the
 * normal state of a product waiting to be transferred. Both now come back
 * `blocked` instead.
 *
 * `defaultBranchId` is a preselection preference, never a role: a deployment
 * whose default branch is the warehouse must not turn every sale into a
 * warehouse sale, so it is honoured only when it may sell.
 */
export function resolveSaleBranch(
  product: SheetProductLike | null | undefined,
  options: { activeBranchFilterId?: unknown; defaultBranchId?: unknown } = {},
): SaleBranchDecision {
  const active = options.activeBranchFilterId
  if (active != null && String(active) !== '') {
    const id = Number(active)
    if (Number.isFinite(id)) {
      return branchAllowsSale(product, id) ? { branchId: id, blocked: false } : { branchId: null, blocked: true }
    }
  }

  const rawPreferred = options.defaultBranchId
  const preferred = rawPreferred == null || String(rawPreferred) === '' ? null : Number(rawPreferred)
  let best: number | null = null
  let bestQuantity = 0
  let unsellableStock = false
  for (const entry of Array.isArray(product?.branch_stock) ? product.branch_stock : []) {
    const id = Number(entry?.branch_id)
    const quantity = toNumber(entry?.quantity)
    if (!Number.isFinite(id) || quantity <= 0) continue
    if (!branchAllowsSale(product, id)) { unsellableStock = true; continue }
    if (preferred != null && Number.isFinite(preferred) && id === preferred) return { branchId: id, blocked: false }
    if (quantity > bestQuantity) { best = id; bestQuantity = quantity }
  }

  if (best != null) return { branchId: best, blocked: false }
  if (unsellableStock) return { branchId: null, blocked: true }
  if (preferred != null && Number.isFinite(preferred) && branchAllowsSale(product, preferred)) {
    return { branchId: preferred, blocked: false }
  }
  return { branchId: null, blocked: false }
}

export function defaultDisplayStock(product: SheetProductLike | undefined): number {
  return toNumber(product?.stock_quantity)
}

export function deriveProductSheetState(input: ProductSheetStateInput): ProductSheetState {
  const {
    product,
    variants = [],
    groupProduct = false,
    selectedBranchId = null,
    activeBranchId = null,
    selectedVariantId = null,
    trackedBatchProductIds: trackedBatchProductIdsInput = null,
    receivedDateStepHidden = false,
    batches = [],
    selectedBatchId = null,
    damagedLots = [],
    selectedDamagedLotId = null,
    intent = 'sell',
    getDisplayStock = defaultDisplayStock,
  } = input
  // A hidden step is an ABSENT step, not an unanswered one: with no tracked
  // ids the received-date gate never engages, so the pick is not blocked on a
  // question this surface deliberately refuses to ask.
  const trackedBatchProductIds = receivedDateStepHidden ? null : trackedBatchProductIdsInput

  // A flat product is a one-row group. Every derivation below walks THIS
  // pool, never `variants` directly -- the old code walked `variants` for
  // the resolved row and `variants.length ? variants : [product]` for the
  // branch list, so a flat product got branch options but no resolved row.
  const rowPool: SheetProductLike[] = variants.length ? [...variants] : [product]

  const branchNames = new Map<string, string>()
  const branchGroupTotals = new Map<string, number>()
  for (const row of rowPool) {
    for (const entry of Array.isArray(row?.branch_stock) ? row.branch_stock : []) {
      const id = entry?.branch_id
      if (id == null) continue
      const key = String(id)
      if (!branchNames.has(key)) branchNames.set(key, String(entry.branch_name || key))
      branchGroupTotals.set(key, (branchGroupTotals.get(key) || 0) + toNumber(entry?.quantity))
    }
  }

  const branchIds = [...branchNames.keys()].sort((a, b) => (
    String(branchNames.get(a)).localeCompare(String(branchNames.get(b)), undefined, { sensitivity: 'base' })
  ))

  const stockAtBranch = (row: SheetProductLike | null, branchId: string | null): number => {
    if (!row) return 0
    if (branchIds.length && branchId != null) {
      return toNumber((Array.isArray(row.branch_stock) ? row.branch_stock : [])
        .find((entry) => String(entry?.branch_id) === branchId)?.quantity)
    }
    return toNumber(getDisplayStock(row))
  }

  // Which rows this branch actually carries. A row with no branch_stock
  // rows at all is branch-agnostic and stays offered everywhere.
  const poolAtBranch = (branchId: string | null): SheetProductLike[] => {
    if (!branchIds.length || branchId == null) return rowPool
    const narrowed = rowPool.filter((row) => {
      const rows = Array.isArray(row.branch_stock) ? row.branch_stock : []
      if (!rows.length) return true
      return rows.some((entry) => String(entry?.branch_id) === branchId)
    })
    return narrowed.length ? narrowed : rowPool
  }

  const resolveRow = (pool: SheetProductLike[]): SheetProductLike | null => (
    pool.find((row) => String(row.id) === String(selectedVariantId)) || pool[0] || null
  )

  const branchOptions: SheetBranchOption[] = branchIds.map((id) => {
    const name = String(branchNames.get(id) ?? id)
    const role = branchRoleFromName(name)
    const sellable = intent !== 'sell' || branchCanSell(name)
    return {
      id,
      name,
      // The pill's number is the row the sheet WOULD resolve to at that
      // branch, so a pill can never read "in stock" while the row the Add
      // button is capped by has nothing there.
      quantity: stockAtBranch(resolveRow(poolAtBranch(id)), id),
      groupQuantity: branchGroupTotals.get(id) || 0,
      role,
      selectable: sellable,
      blockedMessageKey: sellable ? null : 'pos_warehouse_not_sellable',
    }
  })

  const selectableIds = branchOptions.filter((option) => option.selectable).map((option) => option.id)
  const activeBranchKey = activeBranchId == null ? null : String(activeBranchId)
  // Preselection never lands on a branch the intent forbids: preselecting
  // the warehouse on a sale surface would open the sheet on a branch every
  // Add button refuses, with no explanation.
  const preferredIds = selectableIds.length ? selectableIds : branchIds
  const fallbackBranchId = preferredIds.includes(String(activeBranchKey))
    ? activeBranchKey
    : (preferredIds[0] ?? null)
  const effectiveBranchId = selectedBranchId != null && preferredIds.includes(selectedBranchId)
    ? selectedBranchId
    : fallbackBranchId

  const candidatePool = poolAtBranch(effectiveBranchId)
  const effectiveVariant = resolveRow(candidatePool)
  const effectiveVariantStock = stockAtBranch(effectiveVariant, effectiveBranchId)

  const optionStepIsIndistinguishable = groupProduct
    && candidatePool.length > 1
    && input.optionStepTitleFor?.(candidatePool) === 'Option'
  const everyCandidateBatchTracked = candidatePool.length > 0
    && candidatePool.every((row) => trackedBatchProductIds?.has(Number(row.id)) ?? false)
  const mergeRowsIntoLotList = optionStepIsIndistinguishable && everyCandidateBatchTracked

  const resolvedProduct = groupProduct ? effectiveVariant : product
  const isBatchTracked = mergeRowsIntoLotList
    || (resolvedProduct != null && (trackedBatchProductIds?.has(Number(resolvedProduct.id)) ?? false))

  const receivedDateOptions = sortBatchesForPicker(batches as readonly SheetBatchLike[]) as SheetBatchLike[]
  const receivedDateTotal = receivedDateOptions.reduce((sum, batch) => sum + toNumber(batch.quantity), 0)
  const selectedBatch = receivedDateOptions.find((batch) => batch.id === selectedBatchId) || null
  const selectedDamagedLot = damagedLots.find((lot) => lot.id === selectedDamagedLotId) || null

  const batchSelectionRequired = isBatchTracked
  const batchReadyToSell = selectedDamagedLot != null
    ? toNumber(selectedDamagedLot.quantity_remaining) > 0
    : (!batchSelectionRequired || (selectedBatch != null && toNumber(selectedBatch.quantity) > 0))

  // On-hand comes from branch_stock, the ledger that answers "how many
  // units are at this branch". The lot ledger answers a different
  // question -- WHICH intake a sale draws from -- and is only allowed to
  // narrow the number once a specific lot is picked.
  const displayedStock = selectedDamagedLot
    ? toNumber(selectedDamagedLot.quantity_remaining)
    : selectedBatch
      ? toNumber(selectedBatch.quantity)
      : effectiveVariantStock

  const branchSummary = branchOptions.map((option) => `${option.name}: ${option.quantity}`).join(' · ')

  return {
    branchOptions,
    effectiveBranchId,
    effectiveBranchOption: branchOptions.find((option) => option.id === effectiveBranchId) || null,
    candidatePool,
    effectiveVariant,
    effectiveVariantStock,
    displayedStock,
    branchSummary,
    warehouseDisabled: branchOptions.some((option) => option.role === 'warehouse' && !option.selectable),
    isBatchTracked,
    mergeRowsIntoLotList,
    batchSelectionRequired,
    batchReadyToSell,
    receivedDateOptions,
    receivedDateTotal,
    stockWithoutReceivedDate: batchSelectionRequired
      && receivedDateOptions.length === 0
      && effectiveVariantStock > 0,
  }
}
