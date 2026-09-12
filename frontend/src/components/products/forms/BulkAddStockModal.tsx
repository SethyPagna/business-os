import { todayStr } from '../../../utils/dateHelpers.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import DateEntryInput from '../../shared/DateEntryInput.tsx'
import { getInventoryReasons, saveInventoryReasons } from '../../../api/methods.ts'
import { getProductBatches, type ProductBatch } from '../../../api/batchesTransport.ts'
import { createClientRequestId } from '../../../api/requestIds.ts'
// Same saved-reason catalog + "Manage reasons" flow Inventory's own "Adjust
// stock" modal already uses -- this bulk modal was the one place still
// hardcoding `Bulk ${action} stock` as the reason with no way to pick or
// type a real one. Every selected product has its own received-date list, so
// this surface renders one explicit lot choice per row. A single shared picker
// would silently apply one product's batch id to unrelated products.
import InventoryReasonManagerModal from '../../inventory/InventoryReasonManagerModal.tsx'
import SupplierPickerField from '../../shared/SupplierPickerField.tsx'
import InfoHint from '../../shared/InfoHint.tsx'
import { adjustBranchQuantity, bulkStockReceiptWire, scopedSetPreview, stockReceiptGateCode, type StockSetScope, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS } from '../../../utils/stockReceiptFields.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../../shared/ConfirmDialog.tsx'
import UnsavedChangesPrompt from '../../shared/UnsavedChangesPrompt.tsx'
import { useCloseGuard } from '../../../utils/useCloseGuard.ts'
import { dateToBatchCode } from '../../../utils/batchCode.ts'
import { batchDisplayLabel } from '../../../utils/batchLabel.ts'
import {
  applyRowOutcome,
  classifyStockAdjustFailure,
  countRows,
  createRow,
  hasUnsavedFailures,
  rowsToSubmit,
  submitButtonState,
  type StockAdjustRow,
} from '../../../utils/stockAdjustOutcome.ts'

const BULK_ADD_STOCK_MUTATION_TIMEOUT_MS = 12000

// All received-date defaults use the fixed Cambodia business calendar day.
function todayIsoDate(): string {
  return todayStr()
}

type Translate = (key: string) => string | undefined
type InventoryReasonType = 'adjust' | 'transfer' | 'move' | 'delete'

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type Branch = {
  id: number | string
  name: string
  is_default?: boolean | number | null
}

type Product = {
  id: number | string
  name: string
  purchase_price_usd?: number
  purchase_price_khr?: number
  stock_quantity?: number | string | null
  branch_stock?: Array<{ branch_id?: number | string | null; quantity?: number | string | null }>
}

type User = {
  id?: number | string
  name?: string
} | null | undefined

type StockAction = 'add' | 'remove' | 'set'

type AdjustStockPayload = {
  productId: number | string
  productName: string
  type: StockAction
  quantity: number
  branchId: number | null
  // N14-D: optional, and absent for a remove. Nothing here substitutes the
  // product's stored price for a cost the operator did not type.
  unitCostUsd?: number
  freeGoods?: boolean
  reason: string
  userId?: number | string
  userName?: string
  receivedDate?: string
  supplierId?: number
  supplierName?: string
  batchId?: number | 'new'
  setScope?: StockSetScope
  expectedLotQuantity?: number
  expectedBranchQuantity?: number
  client_request_id?: string
}

type ApiResult = {
  success?: boolean
  error?: string
  action_history_id?: number
}

type ProductApi = {
  adjustStock: (payload: AdjustStockPayload) => Promise<ApiResult | undefined>
}

type BulkAddStockResult = {
  quantity: number
  branchId: string
  done: number
  failed: number
  updatedIds: number[]
  failedIds: number[]
  action: StockAction
  serverActionHistoryIds: number[]
}

type BulkLotSelection = {
  batchId: number | 'new'
  batchQuantity: number | null
  batchLabel: string
}

type BulkAddStockModalProps = {
  productIds: Array<number | string>
  products: Product[]
  branches: Branch[]
  user?: User
  onClose: () => void
  onDone: (result: BulkAddStockResult) => void
  t: Translate
  // Carried over from the inline "Adjust stock" bulk panel on Products.tsx
  // (bulkEditForm.action/qty) so this modal continues that choice instead
  // of silently discarding it and re-asking for a plain add -- previously
  // this modal always sent type:'add' no matter what the panel's
  // Add/Remove/Set buttons had selected, the exact "two UIs disagreeing
  // with each other" case this pass is fixing.
  initialAction?: StockAction
  initialQuantity?: number | string
}

function getProductApi(): ProductApi {
  return (window as unknown as { api: ProductApi }).api
}

function parseQuantity(value: string, action: StockAction): number | null {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  // 'set' legitimately allows 0 (set stock to zero); add/remove need a
  // positive amount to actually change anything.
  if (action !== 'set' && amount <= 0) return null
  return amount
}

function normalizeBranchId(value: string): number | null {
  if (!value) return null
  const branchId = Number.parseInt(value, 10)
  return Number.isFinite(branchId) ? branchId : null
}

function normalizeProductId(value: number | string): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

export default function BulkAddStockModal({ productIds, products, branches, user, onClose, onDone, t, initialAction, initialQuantity }: BulkAddStockModalProps) {
  const defaultBranchId = branches.find((branch) => branch.is_default)?.id || branches[0]?.id || ''
  const [branchId, setBranchId] = useState(String(defaultBranchId))
  const [action, setAction] = useState<StockAction>(initialAction || 'add')
  const [setScope, setSetScope] = useState<StockSetScope>('lot')
  const [qty, setQty] = useState(initialQuantity != null && initialQuantity !== '' ? String(initialQuantity) : '')
  // D4b: the received date IS the lot control in a bulk add -- there is no
  // per-product batch picker here (see the import comment above for why a
  // single picker can't span a mixed selection), but the date drives the
  // server's date->code matching per product exactly as a picker's "New
  // batch" does, so late bulk stock-ins land with their real date.
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  // Per-product outcomes of the last submit -- what succeeded (never retried),
  // what failed and why. Empty until the first commit.
  const [rows, setRows] = useState<StockAdjustRow<AdjustStockPayload>[]>([])
  const [lotSelections, setLotSelections] = useState<Record<number, BulkLotSelection>>({})
  const [lotOptions, setLotOptions] = useState<Record<number, ProductBatch[]>>({})
  const [lotLoading, setLotLoading] = useState<Record<number, boolean>>({})
  const [lotErrors, setLotErrors] = useState<Record<number, string>>({})
  const [lotReloadKey, setLotReloadKey] = useState(0)
  const [serverActionHistoryIds, setServerActionHistoryIds] = useState<number[]>([])
  // D5a: one supplier for the whole bulk receive event -- every lot this
  // add creates gets it; a lot that already has a supplier keeps its own
  // (COALESCE fill server-side, first attribution sticks). supplierId only
  // ever comes from picking a contact suggestion; free text stays a
  // deliberate name-only attribution.
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  // N14-D: what this bulk receipt cost per unit. It used to be taken from each
  // product's stored purchase_price_usd (or 0), so a bulk add recorded a cost
  // nobody entered -- and, for anything with no stored price, recorded the
  // goods as free. One typed figure for the whole event, like the supplier and
  // the received date above it.
  const [unitCost, setUnitCost] = useState('')
  const [freeGoods, setFreeGoods] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // Part 563: the review dialog is open (handleSave validated + opened it;
  // commitBulk runs the per-product writes on confirm).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<ReasonManagerState>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const saveInFlightRef = useRef(false)
  const selectedProductIds = useMemo(() => new Set(productIds.map((id) => String(id))), [productIds])
  const selectedProducts = useMemo(() => products.filter((product) => selectedProductIds.has(String(product.id))), [products, selectedProductIds])
  const selectedProductSignature = useMemo(() => selectedProducts.map((product) => String(product.id)).sort().join(','), [selectedProducts])

  // Every selected product owns a different lot list. Load them independently
  // and fail loudly per row; an empty/error result must never turn into an
  // implicit New/FIFO choice. Set includes active zero lots, Remove only lots
  // with stock, and Add offers both explicit New and existing lots.
  useEffect(() => {
    const numericBranchId = normalizeBranchId(branchId)
    setLotSelections({})
    setLotOptions({})
    setLotErrors({})
    if (!numericBranchId || !selectedProducts.length) return
    let cancelled = false
    const initialLoading = Object.fromEntries(selectedProducts.map((product) => [normalizeProductId(product.id), true]))
    setLotLoading(initialLoading)
    for (const product of selectedProducts) {
      const productId = normalizeProductId(product.id)
      void getProductBatches(productId, numericBranchId, action === 'remove')
        .then((response) => {
          if (cancelled) return
          setLotOptions((current) => ({ ...current, [productId]: response?.batches || [] }))
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setLotErrors((current) => ({ ...current, [productId]: error instanceof Error ? error.message : (t('load_failed') || 'Failed to load') }))
        })
        .finally(() => {
          if (!cancelled) setLotLoading((current) => ({ ...current, [productId]: false }))
        })
    }
    return () => { cancelled = true }
  // selectedProductSignature intentionally represents the selected rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, branchId, lotReloadKey, selectedProductSignature])

  useEffect(() => {
    let cancelled = false
    getInventoryReasons()
      .then((result) => {
        if (cancelled) return
        const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: InventoryReason[] }).items : []
        setInventoryReasons(items)
      })
      .catch(() => { if (!cancelled) setInventoryReasons([]) })
    return () => { cancelled = true }
  }, [])
  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])
  // Same saveReasonCatalog/addSavedReason/renameSavedReason/deleteSavedReason
  // pattern as Inventory.tsx -- one shared catalog, edited from wherever a
  // reason picker appears.
  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await saveInventoryReasons(nextItems) as { pending?: boolean; items?: InventoryReason[] } | undefined
      if (result?.pending) {
        setMsg(t('reason_submitted_for_review') || 'Submitted for review -- changes will appear once approved.')
        return inventoryReasons
      }
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons, t])
  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])
  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(t('rename_reason_prompt') || 'Rename saved reason', entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => (item.id === entry.id ? { ...item, label: nextLabel.trim() } : item))
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(t('delete_saved_reason_confirm') || 'Delete this saved reason?')) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const runBulkStockMutation = useCallback((loader: () => Promise<ApiResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, BULK_ADD_STOCK_MUTATION_TIMEOUT_MS)
  ), [])
  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: 'Global (no branch)' },
    ...branches.map((branch) => ({
      value: branch.id,
      label: branch.is_default ? `${branch.name} (default)` : branch.name,
    })),
  ], [branches])
  const actionLabels: Record<StockAction, string> = {
    add: t('add') || 'Add',
    remove: t('remove') || 'Remove',
    set: t('set') || 'Set',
  }
  const rowsLocked = rows.length > 0
  const productBranchQuantity = (product: Product): number => adjustBranchQuantity(product.branch_stock, branchId, product.stock_quantity)
  const selectedLotFor = (product: Product): ProductBatch | null => {
    const productId = normalizeProductId(product.id)
    const selection = lotSelections[productId]
    if (!selection || selection.batchId === 'new') return null
    return (lotOptions[productId] || []).find((batch) => Number(batch.id) === Number(selection.batchId)) || null
  }
  const buildRowRequest = (product: Product, amount: number): AdjustStockPayload => {
    const productId = normalizeProductId(product.id)
    const selection = lotSelections[productId]
    const selectedLot = selectedLotFor(product)
    const base: AdjustStockPayload = {
      productId: product.id,
      productName: product.name,
      type: action,
      quantity: amount,
      branchId: normalizeBranchId(branchId),
      reason: reason.trim(),
      userId: user?.id,
      userName: user?.name,
      batchId: selection?.batchId,
    }
    if (action === 'add') return { ...base, ...bulkStockReceiptWire('add', { unitCost, freeGoods, supplierId, supplierName, receivedDate }) }
    if (action === 'set' && selectedLot) return {
      ...base,
      setScope,
      batchId: Number(selectedLot.id),
      expectedLotQuantity: Number(selectedLot.quantity || 0),
      expectedBranchQuantity: productBranchQuantity(product),
      client_request_id: createClientRequestId('stock-set'),
    }
    return base
  }

  const selectionProblem = (): string => {
    if (selectedProducts.some((product) => lotLoading[normalizeProductId(product.id)])) return t('loading') || 'Received dates are still loading.'
    const loadFailure = selectedProducts.find((product) => lotErrors[normalizeProductId(product.id)])
    if (loadFailure) return `${t('load_failed') || 'Failed to load'}: ${loadFailure.name}`
    const missing = selectedProducts.find((product) => !lotSelections[normalizeProductId(product.id)])
    if (missing) return `${t('select_batch_required') || 'Select a received date first'}: ${missing.name}`
    if (action !== 'add') {
      const notExisting = selectedProducts.find((product) => lotSelections[normalizeProductId(product.id)]?.batchId === 'new')
      if (notExisting) return `${t('select_batch_required') || 'Select an existing received date first'}: ${notExisting.name}`
    }
    if (action === 'set') {
      const invalid = selectedProducts.find((product) => {
        const lot = selectedLotFor(product)
        return !lot || !scopedSetPreview({ scope: setScope, targetQuantity: qty, lotQuantity: lot.quantity, branchQuantity: productBranchQuantity(product) }).valid
      })
      if (invalid) return `${t('stock_set_lot_negative') || 'This correction would make the selected received date negative.'}: ${invalid.name}`
    }
    return ''
  }

  // Part 563: validate, then open the review dialog. commitBulk runs the
  // actual per-product writes once the operator confirms.
  const handleSave = () => {
    if (saving) return
    if (parseQuantity(qty, action) === null) { setMsg('Enter a valid quantity'); return }
    const lotProblem = selectionProblem()
    if (lotProblem) { setMsg(lotProblem); return }
    // Same rule Inventory.tsx already enforces for every other
    // stock-adjustment surface -- routes/inventory.ts's /adjust
    // requires `reason` server-side too, this just fails fast client-side with
    // a clear message instead of a per-product server error.
    if (!reason.trim()) { setMsg(t('adjust_reason_required') || 'A reason is required for this stock adjustment.'); return }
    setMsg(null)
    setConfirmOpen(true)
  }

  const buildBulkReviewItems = (): ConfirmReviewItem[] => {
    // Matches the branch dropdown's own label for the branchless option.
    const branchName = branchId ? (branches.find((b) => String(b.id) === String(branchId))?.name || String(branchId)) : 'Global (no branch)'
    const items: ConfirmReviewItem[] = [
      { label: t('type') || 'Type', value: actionLabels[action] },
      { label: t('products') || 'Products', value: String(selectedProducts.length) },
      { label: t('quantity') || 'Quantity', value: String(qty || 0) },
      { label: t('branch') || 'Branch', value: branchName },
    ]
    const trimmedReason = reason.trim()
    if (trimmedReason) items.push({ label: t('reason') || 'Reason', value: trimmedReason })
    items.push({ label: t('selected_received_date') || 'Selected received date', value: String(Object.keys(lotSelections).length) })
    if (action === 'set') items.push({
      label: t('stock_set_scope') || 'Set quantity for',
      value: setScope === 'lot' ? (t('stock_set_scope_lot') || 'Selected received date') : (t('stock_set_scope_branch') || 'Branch total'),
    })
    if (action === 'add') {
      if (supplierName.trim()) items.push({ label: t('supplier') || 'Supplier', value: supplierName.trim() })
      // The receipt cost is a claim about money; it belongs in the review the
      // operator confirms, not only in the field they typed it into.
      items.push({
        label: t('unit_cost_usd') || 'Unit cost $',
        value: freeGoods ? (t('stock_receipt_free_goods') || 'Free goods') : `$${String(unitCost)}`,
      })
    }
    return items
  }

  const commitBulk = async () => {
    setConfirmOpen(false)
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    const amount = parseQuantity(qty, action)
    if (amount === null) {
      finishSingleAction(saveInFlightRef)
      setMsg('Enter a valid quantity')
      return
    }
    // N14-D: the same rule routes/inventory.ts enforces on every Add row this
    // loop submits (cloudflare/src/lib/stockReceiptGate.ts). Checked once, up
    // front so a bulk receipt that would be refused row by row never starts.
    // Scoped Set is an inventory correction with its own optimistic snapshots,
    // not a supplier receipt, even when its delta raises the selected lot.
    const receiptGate = stockReceiptGateCode({
      isStockIn: action === 'add',
      supplierName,
      unitCostUsd: unitCost,
      freeGoods,
    })
    if (receiptGate) {
      finishSingleAction(saveInFlightRef)
      setMsg(t(STOCK_RECEIPT_GATE_KEYS[receiptGate]) || STOCK_RECEIPT_GATE_FALLBACKS[receiptGate])
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      // Row outcomes (utils/stockAdjustOutcome.ts): the first pass submits
      // every selected product, a retry submits ONLY the rows that failed.
      // rowsToSubmit() excludes anything already 'done', so no product can be
      // adjusted twice by a retry -- /api/inventory/adjust is a one-row,
      // non-idempotent write, so that exclusion is the guarantee.
      const startingRows = rows.length
        ? rows
        : selectedProducts.map((product) => createRow(buildRowRequest(product, amount)))
      let working = startingRows
      let completedHistoryIds = [...serverActionHistoryIds]
      setRows(working)
      for (const row of rowsToSubmit(startingRows)) {
        const product = selectedProducts.find((entry) => normalizeProductId(entry.id) === Number(row.request.productId))
        if (!product) continue
        working = applyRowOutcome(working, row.rowId, { status: 'saving' })
        setRows(working)
        try {
          const result = await runBulkStockMutation(() => getProductApi().adjustStock(row.request), 'Bulk adjust product stock')
          if (result?.success === false) throw new Error(result?.error || 'Failed to adjust stock')
          const historyId = Number(result?.action_history_id || 0)
          if (historyId > 0 && !completedHistoryIds.includes(historyId)) {
            completedHistoryIds = [...completedHistoryIds, historyId]
            setServerActionHistoryIds(completedHistoryIds)
          }
          working = applyRowOutcome(working, row.rowId, { status: 'done' })
        } catch (error) {
          // Never swallow the reason -- the operator needs to know WHICH
          // product refused and why (insufficient stock, and how much is
          // actually available) to fix it.
          working = applyRowOutcome(working, row.rowId, {
            status: 'failed',
            failure: classifyStockAdjustFailure(error),
          })
        }
        setRows(working)
      }
      const counts = countRows(working)
      const updatedIds = working.filter((row) => row.status === 'done').map((row) => Number(row.request.productId))
      const failedIds = working.filter((row) => row.status === 'failed').map((row) => Number(row.request.productId))
      if (counts.failed > 0) {
        // THE RULE (user, Sep 3): a failure keeps this dialog open with every
        // typed value intact and the per-product reason on screen. Nothing is
        // reported as finished until the operator resolves or discards it.
        setMsg(t('stock_rows_failed') || `${counts.failed} product(s) could not be saved. Fix them and retry.`)
        return
      }
      if (counts.done) onDone({ quantity: amount, branchId, done: counts.done, failed: 0, updatedIds, failedIds, action, serverActionHistoryIds: completedHistoryIds })
      else setMsg('Failed to adjust stock')
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  // Leaving with failures still unsaved asks first: abandon them, or keep
  // editing. Whatever DID commit is still reported so the page refreshes
  // and undo history stays truthful.
  const reportAndClose = () => {
    const counts = countRows(rows)
    const amount = parseQuantity(qty, action)
    const updatedIds = rows.filter((row) => row.status === 'done').map((row) => Number(row.request.productId))
    const failedIds = rows.filter((row) => row.status === 'failed').map((row) => Number(row.request.productId))
    if (counts.done && amount !== null) {
      onDone({ quantity: amount, branchId, done: counts.done, failed: counts.failed, updatedIds, failedIds, action, serverActionHistoryIds })
      return
    }
    onClose()
  }

  // S4-21: this modal used to own a PRIVATE "Discard the unsaved
  // adjustment?" ConfirmDialog -- one of the copies the shared guard exists
  // to retire. It now declares what is at risk and lets the one guard raise
  // the one prompt; the failed/done counts it used to show are handed to
  // that prompt as `items`, so nothing was traded away for the merge.
  //
  // Two different things are losable here, and the old dialog only knew
  // about the first: rows that FAILED and were never retried, and a header
  // filled in but never submitted at all (the far more common accident --
  // quantity, reason and supplier typed, then the Cancel button).
  const bulkCounts = countRows(rows)
  const bulkHeaderTyped = qty.trim().length > 0
    || reason.trim().length > 0
    || supplierName.trim().length > 0
    || supplierId !== null
  const bulkDirty = hasUnsavedFailures(rows) || (rows.length === 0 && (bulkHeaderTyped || Object.keys(lotSelections).length > 0))
  const closeGuard = useCloseGuard({ dirty: bulkDirty }, reportAndClose)
  const bulkPromptItems = bulkCounts.failed || bulkCounts.done
    ? [
      { label: t('failed') || 'Failed', value: String(bulkCounts.failed) },
      { label: t('done') || 'Done', value: String(bulkCounts.done) },
    ]
    : undefined

  const requestClose = () => {
    if (saving) return
    closeGuard.requestClose()
  }

  const modal = (
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-start justify-center overflow-y-auto bg-black/50 sm:items-center">
      <div className="modal-panel-safe fade-in my-auto w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:p-5">
        <h2 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">
          {t('adjust_stock_for_products') || `${actionLabels[action]} Stock -- ${productIds.length} Products`}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('adjust_stock_bulk_desc') || 'This will apply the same change to each selected product.'}</p>
        <div className="space-y-4">
          {/* Same border-2 / blue-50+blue-700 segmented style as
              InventoryStockModals.tsx and the Products.tsx inline bulk
              panel that opens this modal --
              continues whatever choice was already made there instead of
              only ever offering "add" here. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adjust_stock') || 'Adjust stock'}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['add', 'remove', 'set'] as StockAction[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={rowsLocked}
                  onClick={() => { setAction(value); if (value === 'set') setSetScope('lot') }}
                  className={`rounded-xl border-2 py-2 text-xs font-medium ${action === value ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                >
                  {actionLabels[value]}
                </button>
              ))}
            </div>
            {action === 'set' ? (
              <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={t('stock_set_scope') || 'Set quantity for'}>
                {([
                  ['lot', t('stock_set_scope_lot') || 'Selected received date'],
                  ['branch', t('stock_set_scope_branch') || 'Branch total'],
                ] as [StockSetScope, string][]).map(([scope, label]) => (
                  <button key={scope} type="button" disabled={rowsLocked} aria-pressed={setScope === scope}
                    onClick={() => setSetScope(scope)}
                    className={`rounded-lg border-2 px-2 py-1.5 text-xs font-medium ${setScope === scope ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {branches.length > 0 ? (
            <div>
              <label htmlFor="bulk-add-stock-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Branch</label>
              <AppSelect
                id="bulk-add-stock-branch"
                className="w-full"
                buttonClassName="w-full"
                value={branchId}
                options={branchOptions}
                onChange={setBranchId}
                ariaLabel="Branch"
                disabled={rowsLocked}
              />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quantity') || 'Quantity'}</label>
            <input className="input" type="number" min="0" step="any" disabled={rowsLocked} value={qty} onChange={(event) => setQty(event.target.value)} placeholder="e.g. 10" autoFocus />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[1, 5, 10, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={rowsLocked}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${Number(qty) === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                  onClick={() => setQty(String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div data-bulk-lot-selection="true" className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-700">
            {selectedProducts.map((product) => {
              const productId = normalizeProductId(product.id)
              const selection = lotSelections[productId]
              const selectedLot = selectedLotFor(product)
              const preview = action === 'set' && selectedLot
                ? scopedSetPreview({ scope: setScope, targetQuantity: qty, lotQuantity: selectedLot.quantity, branchQuantity: productBranchQuantity(product) })
                : null
              return (
                <div key={productId} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/30">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words font-semibold text-gray-800 dark:text-gray-100">{product.name}</span>
                    {action === 'set' ? <span className="shrink-0 tabular-nums text-gray-500">{t('branch_total') || 'Branch total'}: {productBranchQuantity(product)}</span> : null}
                  </div>
                  {lotLoading[productId] ? (
                    <div className="text-xs text-gray-400">{t('loading') || 'Loading...'}</div>
                  ) : lotErrors[productId] ? (
                    <div role="alert" className="flex items-center justify-between gap-2 text-xs text-rose-700 dark:text-rose-300">
                      <span className="min-w-0 break-words">{lotErrors[productId]}</span>
                      <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-[11px]" onClick={() => setLotReloadKey((value) => value + 1)}>{t('retry') || 'Retry'}</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {action === 'add' ? (
                        <button type="button" disabled={rowsLocked} aria-pressed={selection?.batchId === 'new'}
                          className={`rounded-full border px-2 py-1 text-[11px] ${selection?.batchId === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                          onClick={() => setLotSelections((current) => ({ ...current, [productId]: { batchId: 'new', batchQuantity: null, batchLabel: t('new_batch') || '+ New received date' } }))}>
                          {t('new_batch') || '+ New received date'}
                        </button>
                      ) : null}
                      {(lotOptions[productId] || []).map((batch) => (
                        <button key={batch.id} type="button" disabled={rowsLocked} aria-pressed={Number(selection?.batchId) === Number(batch.id)}
                          className={`rounded-full border px-2 py-1 text-[11px] ${Number(selection?.batchId) === Number(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                          onClick={() => setLotSelections((current) => ({ ...current, [productId]: { batchId: Number(batch.id), batchQuantity: Number(batch.quantity || 0), batchLabel: batchDisplayLabel(batch, t('batch') || 'Received date') } }))}>
                          {batchDisplayLabel(batch, t('batch') || 'Received date')} ({batch.quantity})
                        </button>
                      ))}
                      {!(lotOptions[productId] || []).length && action !== 'add' ? <span className="text-[11px] text-gray-400">{action === 'remove' ? (t('no_batches_with_stock') || 'No received dates with stock in this branch') : (t('no_batches_for_branch') || 'No received dates for this branch')}</span> : null}
                    </div>
                  )}
                  {preview ? (
                    <div className={`mt-1 text-[11px] tabular-nums ${preview.valid ? 'text-gray-500' : 'font-semibold text-rose-700 dark:text-rose-300'}`}>
                      {t('lot_quantity') || 'Received-date quantity'}: {preview.beforeLotQuantity} → {preview.afterLotQuantity}; {t('branch_total') || 'Branch total'}: {preview.beforeBranchQuantity} → {preview.afterBranchQuantity}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
          {/* Scoped Set is an inventory correction, not a supplier receipt. */}
          {action === 'add' ? (
            <div>
              <label htmlFor="bulk-add-stock-received-date" className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('received_date') || 'Received date'}
              </label>
              {/* Typed, not a native picker (Sep 3) -- the bulk add's own
                  received date, which derives every lot code it creates. */}
              <DateEntryInput
                id="bulk-add-stock-received-date"
                className="text-sm"
                t={t}
                ariaLabel={t('received_date') || 'Received date'}
                value={receivedDate}
                onChange={(iso) => setReceivedDate(iso)}
                disabled={rowsLocked}
              />
              <div className="mt-1 text-[11px] text-gray-400">
                {t('batch_code_preview') || 'Received date code'}: {dateToBatchCode(receivedDate) || '--'}
              </div>
              {/* D5a: the same supplier picker every other add surface has.
                  One choice for the whole bulk event; lots that already
                  carry a supplier keep theirs (fill-only server-side). */}
              {/* N14-D: one typed receipt cost for the whole bulk event, beside
                  the one supplier and the one received date it already had. */}
              <div className="mt-3">
                <label htmlFor="bulk-add-stock-unit-cost" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('unit_cost_usd') || 'Unit cost $'} <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <input
                  id="bulk-add-stock-unit-cost"
                  className="input w-full text-sm"
                  type="number"
                  min="0"
                  step="any"
                  required
                  disabled={freeGoods || rowsLocked}
                  value={freeGoods ? '0' : unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                />
                <span className="mt-1 flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-400">
                  <input type="checkbox" className="h-3.5 w-3.5" disabled={rowsLocked} checked={freeGoods} onChange={(event) => { setFreeGoods(event.target.checked); if (event.target.checked) setUnitCost('0') }} />
                  {t('stock_receipt_free_goods') || 'Free goods'}
                  <InfoHint label={t('stock_receipt_free_goods') || 'Free goods'} text={t('stock_receipt_free_goods_hint') || 'Tick only when the supplier gave these goods at no cost. The declaration is written onto the receipt.'} />
                </span>
              </div>
              <div className="mt-3">
                <SupplierPickerField
                  idPrefix="bulk-add-stock"
                  value={{ supplierId, supplierName }}
                  disabled={rowsLocked}
                  onChange={(next) => { setSupplierId(next.supplierId); setSupplierName(next.supplierName) }}
                  tr={(key, fallbackEn, _fallbackKm) => { const value = t(key); return value && value !== key ? value : (fallbackEn ?? key) }}
                  hint={t('supplier_bulk_hint') || 'Applies to every received date this bulk add creates or fills — received dates that already have a supplier keep theirs.'}
                />
              </div>
            </div>
          ) : null}
          <div>
            <label htmlFor="bulk-add-stock-reason" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('reason') || 'Reason'}
            </label>
            {reasonsByType.adjust.length ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {reasonsByType.adjust.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={rowsLocked}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                    onClick={() => setReason(entry.label)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              id="bulk-add-stock-reason"
              className="input text-sm"
              value={reason}
              disabled={rowsLocked}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('reason_placeholder') || 'Choose a saved reason or type your own'}
            />
            <button
              type="button"
              disabled={rowsLocked}
              className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => setReasonManager({ open: true, type: 'adjust' })}
            >
              {t('manage_reasons') || 'Manage reasons'}
            </button>
          </div>
          {msg ? <p className="text-sm text-red-600 dark:text-red-400">{msg}</p> : null}
          {/* Per-product outcomes: what committed (excluded from any retry)
              and what refused, with the server's own reason inline. */}
          {rows.some((row) => row.status !== 'pending') ? (
            <div data-bulk-stock-outcomes="true" className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2 dark:border-gray-700">
              {rows.map((row) => (
                <div key={row.rowId} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                    row.status === 'done'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : row.status === 'failed'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {row.status === 'done'
                      ? (t('done') || 'Done')
                      : row.status === 'failed'
                        ? (t('failed') || 'Failed')
                        : (t('pending') || 'Pending')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-800 dark:text-gray-100">{row.request.productName}</span>
                    {row.failure ? (
                      <span className="block break-words text-rose-600 dark:text-rose-300">
                        {row.failure.message}
                        {row.failure.available != null ? ` (${t('available') || 'Available'}: ${row.failure.available})` : ''}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving
                ? (t('saving') || 'Saving...')
                : submitButtonState(rows).mode === 'retry'
                  ? `${t('retry_failed') || 'Retry failed'} (${submitButtonState(rows).failedCount})`
                  : `${actionLabels[action]} ${qty || 0} ${action === 'set' ? '' : 'to each'}`.trim()}
            </button>
            <button className="btn-secondary" onClick={requestClose}>{t('cancel') || 'Cancel'}</button>
          </div>
        </div>
      </div>
      <InventoryReasonManagerModal
        addSavedReason={addSavedReason}
        deleteSavedReason={deleteSavedReason}
        reasonDraft={reasonDraft}
        reasonManager={reasonManager}
        reasonsByType={reasonsByType}
        renameSavedReason={renameSavedReason}
        savingReasons={savingReasons}
        setReasonDraft={setReasonDraft}
        setReasonManager={setReasonManager}
        t={t}
        tr={(key: string, fallbackEn?: string) => t(key) || fallbackEn || key}
      />
      {confirmOpen ? (
        <ConfirmDialog
          t={(key: string) => t(key)}
          title={t('adjust_stock') || 'Adjust stock'}
          message={t('adjust_stock_bulk_desc') || 'This will apply the same change to each selected product.'}
          items={buildBulkReviewItems()}
          confirmLabel={`${actionLabels[action]} ${qty || 0} ${action === 'set' ? '' : 'to each'}`.trim()}
          working={saving}
          workingLabel={t('saving') || 'Saving...'}
          onConfirm={commitBulk}
          onClose={() => { if (!saving) setConfirmOpen(false) }}
        />
      ) : null}
      <UnsavedChangesPrompt guard={closeGuard} items={bulkPromptItems} />
    </div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}
