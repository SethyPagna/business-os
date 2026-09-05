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
    trackedBatchProductIds = null,
    batches = [],
    selectedBatchId = null,
    damagedLots = [],
    selectedDamagedLotId = null,
    intent = 'sell',
    getDisplayStock = defaultDisplayStock,
  } = input

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
