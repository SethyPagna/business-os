import { todayStr } from '../../../utils/dateHelpers.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import Modal from '../../shared/Modal'
import SearchInput from '../../shared/SearchInput'
import ScanSearchButton from '../../shared/ScanSearchButton'
import InventoryStockModals from '../../inventory/InventoryStockModals'
import InventoryReasonManagerModal from '../../inventory/InventoryReasonManagerModal'
import ConfirmDialog, { type ConfirmReviewItem } from '../../shared/ConfirmDialog'
import { type AppSelectOption } from '../../shared/AppSelect'
import { useApp } from '../../../AppContext'
import { getProductsByIds, searchProducts } from '../../../api/productReadTransport.ts'
import { adjustStock } from '../../../api/inventoryWriteTransport.ts'
import { getBranches } from '../../../api/branchTransport.ts'
import { getInventoryReasons, saveInventoryReasons } from '../../../api/methods.ts'
import { useDebouncedValue } from '../../../utils/useDebouncedValue.ts'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import {
  applyRowOutcome,
  browserStockStorage,
  classifyStockAdjustFailure,
  createRow,
  dropFailedStockAttempt,
  emitFailedAttemptsChanged,
  hasUnsavedFailures,
  recordFailedStockAttempt,
  submitButtonState,
  type StockAdjustRow,
} from '../../../utils/stockAdjustOutcome.ts'

// Full-featured "Adjust stock" flow for the Products page "Stock Changes"
// ledger. It REUSES Inventory's own presentational adjust modal
// (InventoryStockModals) verbatim rather than reimplementing it (and
// deliberately NOT the leaner BranchStockAdjuster), so this entry point
// looks and behaves exactly like the Inventory page's adjust modal -- same
// batch picker, same pricing lock, same supplier attribution, same saved-
// reason catalog. Two steps: pick a product, then adjust it.

type InventoryId = number | string
type InventoryFormValue = string | number

// Structurally identical to InventoryStockModals.tsx's own (non-exported)
// AdjustForm -- must stay byte-for-byte in shape so our `setAdjustForm`
// typechecks against its `setAdjustForm` prop. See that file for the field
// comments (pricingLocked / batch_id / received_date / supplier_* rules).
type AdjustForm = {
  product_id?: InventoryId
  type: string
  quantity: InventoryFormValue
  reason: string
  branch_id: InventoryId | ''
  pricingLocked: boolean
  selling_price_usd: InventoryFormValue
  selling_price_khr: InventoryFormValue
  // Renamed from special_price_* with the tier itself (2026-09-04 ruling), in
  // lockstep with InventoryStockModals.tsx as the type comment above requires.
  wholesale_price_usd: InventoryFormValue
  wholesale_price_khr: InventoryFormValue
  discount_enabled: boolean
  discount_type: string
  discount_percent: InventoryFormValue
  discount_amount_usd: InventoryFormValue
  cost_usd: InventoryFormValue
  cost_khr: InventoryFormValue
  barcode: string
  batch_id: InventoryId | ''
  received_date: string
  supplier_id: number | ''
  supplier_name: string
}

// 4-union reason type -- matches BranchStockAdjuster.tsx and
// InventoryReasonManagerModal.tsx (which renders a 'delete' tab). The
// saved-reason catalog handling below is cribbed verbatim in shape from
// BranchStockAdjuster.tsx. The narrower Stock* aliases beneath exist only
// for the two casts at the InventoryStockModals boundary, whose own reason
// union has three members and no 'delete'.
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

type StockModalReasonType = 'adjust' | 'transfer' | 'move'
type StockModalReason = { id: string; type?: StockModalReasonType; label: string }
type StockModalReasonGroups = Record<StockModalReasonType, StockModalReason[]>
type StockModalReasonManagerState = { open: boolean; type: StockModalReasonType }

type PickedProduct = Record<string, any> & {
  id: InventoryId
  name?: string
  unit?: string
  barcode?: string
  selling_price_usd?: number
  selling_price_khr?: number
  // Was special_price_*: the 2026-09-04 ruling deleted the "VIP" tier those
  // columns backed, and migration 0111 moved the values into this pair.
  wholesale_price_usd?: number
  wholesale_price_khr?: number
  discount_enabled?: number | boolean | null
  discount_type?: string
  discount_percent?: number
  discount_amount_usd?: number
  cost_price_usd?: number
  cost_price_khr?: number
  purchase_price_usd?: number
  purchase_price_khr?: number
  stock_quantity?: number
  branch_stock?: Array<Record<string, any>>
}

type Branch = {
  id: InventoryId
  name?: string
  is_default?: boolean | number | null
}

type StockAdjustModalProps = {
  initialType?: 'add' | 'remove' | 'set'
  initialProduct?: Record<string, any> | null
  // Reopening an UNSAVED failed attempt from the Stock Change section: the
  // row carries exactly the values that failed, so the operator lands back on
  // the same form instead of retyping it. `resumeAttemptId` is the persisted
  // record this modal clears once the retry commits.
  resumeRow?: {
    type?: string
    quantity?: number
    reason?: string
    branchId?: number | null
    batchId?: number | string | null
    receivedDate?: string
  } | null
  resumeAttemptId?: string | null
  onClose: () => void
  onDone: () => void
  t: (key: string) => string
}

// useApp() is annotated to return `unknown` (see AppContextCore.tsx); every
// consumer narrows it at the call site (Inventory.tsx does `useApp() as
// InventoryAppContext`). This is the slice this modal reads.
type AppContextSlice = {
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
  usdSymbol: string
  user: { id?: string | number; name?: string; username?: string } | null | undefined
  notify: (message: unknown, type?: string, duration?: number) => void
}

// All received-date defaults use the fixed Cambodia business calendar day.
function todayIsoDate(): string {
  return todayStr()
}

function stockQtyOf(product?: Record<string, any> | null): number {
  if (!product) return 0
  const rows = Array.isArray(product.branch_stock) ? product.branch_stock : []
  if (rows.length) return rows.reduce((sum, entry) => sum + Number(entry?.quantity || 0), 0)
  return Number(product.stock_quantity || 0)
}

export default function StockAdjustModal({ initialType = 'add', initialProduct = null, resumeRow = null, resumeAttemptId = null, onClose, onDone, t }: StockAdjustModalProps) {
  const { fmtUSD, fmtKHR, usdSymbol, user, notify } = useApp() as AppContextSlice

  const isKhmer = /[ក-៿]/.test(t('cancel') || '')
  const tr = useCallback((key: string, fallbackEn?: string, fallbackKm?: string): string => {
    const value = t(key)
    if (value && value !== key) return value
    return (isKhmer ? (fallbackKm ?? fallbackEn) : fallbackEn) ?? key
  }, [t, isKhmer])

  // --- product picker (step 1) ---
  const initialPickedProduct = initialProduct?.id != null ? initialProduct as PickedProduct : null
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(initialPickedProduct)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 200)
  const [results, setResults] = useState<PickedProduct[]>([])
  const [searching, setSearching] = useState(false)

  // Camera results belong to this picker only. A named handler (rather than
  // passing a generic setSearch reference) makes that boundary explicit and
  // clears stale rows while the exact barcode query is loading.
  const handleProductScan = useCallback((value: string) => {
    const barcode = String(value || '').trim()
    if (!barcode) return
    setResults([])
    setSearch(barcode)
  }, [])

  useEffect(() => {
    if (selectedProduct) return
    let cancelled = false
    setSearching(true)
    // include branch_stock so per-branch quantity + remove-availability
    // checks below are accurate; the search endpoint supports `include`
    // (same param getProductsByIds passes).
    // `query` is the catalog search endpoint's free-text parameter. This
    // used to say `search:`, which the server does not read: it answered
    // 200 with the entire unfiltered catalog, so typing or scanning a
    // barcode here listed unrelated products (reported live: scanning
    // 3348901770569 still showed "Abercrombie Authantic 10ml"). The
    // transport now canonicalizes the key for every caller
    // (api/productReadTransport.ts) -- this spells it correctly regardless.
    searchProducts({ query: debouncedSearch, pageSize: 20, include: 'branch_stock' })
      .then((raw) => {
        if (cancelled) return
        const rows = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { items?: unknown })?.items)
            ? (raw as { items: PickedProduct[] }).items
            : []
        setResults(rows as PickedProduct[])
      })
      .catch(() => { if (!cancelled) setResults([]) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [debouncedSearch, selectedProduct])

  // --- branches ---
  const [branches, setBranches] = useState<Branch[]>([])
  useEffect(() => {
    let cancelled = false
    getBranches()
      .then((raw) => { if (!cancelled) setBranches(Array.isArray(raw) ? (raw as Branch[]) : []) })
      .catch(() => { if (!cancelled) setBranches([]) })
    return () => { cancelled = true }
  }, [])
  const defaultBranch = useMemo(
    () => branches.find((branch) => branch.is_default) || branches[0] || null,
    [branches],
  )

  // --- saved-reason catalog (cribbed verbatim in shape from BranchStockAdjuster.tsx) ---
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<ReasonManagerState>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
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
  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await saveInventoryReasons(nextItems) as { pending?: boolean; items?: InventoryReason[] } | undefined
      if (result?.pending) {
        notify(tr('reason_submitted_for_review', 'Submitted for review -- changes will appear once approved.'))
        return inventoryReasons
      }
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons, notify, tr])
  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])
  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(tr('rename_reason_prompt', 'Rename saved reason'), entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => (item.id === entry.id ? { ...item, label: nextLabel.trim() } : item))
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])
  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(tr('delete_saved_reason_confirm', 'Delete this saved reason?'))) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])

  // --- adjust form (step 2) ---
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(() => ({
    type: initialType,
    quantity: 1,
    reason: '',
    branch_id: '',
    pricingLocked: true,
    selling_price_usd: 0,
    selling_price_khr: 0,
    wholesale_price_usd: 0,
    wholesale_price_khr: 0,
    discount_enabled: false,
    discount_type: 'percent',
    discount_percent: 0,
    discount_amount_usd: 0,
    cost_usd: 0,
    cost_khr: 0,
    barcode: '',
    batch_id: '',
    received_date: todayIsoDate(),
    supplier_id: '',
    supplier_name: '',
  }))
  const [adjustSaving, setAdjustSaving] = useState(false)
  const submitRef = useRef(false)
  // Part 563: the built, validated adjustment request awaiting the operator's
  // explicit confirm. onAdjust validates + builds the request and parks it
  // here (opening the review dialog); commitAdjust does the actual write once
  // the dialog is confirmed. null = no confirm pending.
  const [pendingAdjust, setPendingAdjust] = useState<Parameters<typeof adjustStock>[0] | null>(null)
  // Failure resilience (user, Sep 3: a failed adjustment "should not close the
  // action ... so user can edit the failed to correct"). `rows` is the
  // row-outcome list from utils/stockAdjustOutcome.ts -- one row here, since
  // POST /api/inventory/adjust commits exactly one product per call, but the
  // same reducer the bulk surface uses so the rule is one rule. A row that
  // reached 'done' is never resubmitted; a failed row keeps its request
  // verbatim and carries the server's reason for inline display.
  const [rows, setRows] = useState<StockAdjustRow<Parameters<typeof adjustStock>[0]>[]>([])
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const attemptIdRef = useRef<string>(resumeAttemptId || `attempt-${Date.now().toString(36)}`)
  const resumeRef = useRef(resumeRow)
  const storage = useMemo(() => browserStockStorage(), [])
  const userKey = user?.id ?? user?.username ?? null
  const failedRow = rows.find((row) => row.status === 'failed') || null
  const submitState = submitButtonState(rows)

  // Initialize adjustForm exactly like Inventory.openAdjust once a product
  // is picked (pricingLocked true, prices from the product, branch = default).
  const selectProduct = useCallback((product: PickedProduct) => {
    setSelectedProduct(product)
    setAdjustForm({
      product_id: product.id,
      type: initialType,
      quantity: 1,
      reason: '',
      branch_id: defaultBranch?.id != null ? String(defaultBranch.id) : '',
      pricingLocked: true,
      selling_price_usd: product.selling_price_usd || 0,
      selling_price_khr: product.selling_price_khr || 0,
      // Was the special_price_* pair for the deleted "VIP" tier; prefilled from
      // the row's real wholesale price now, and sent back out with the pricing
      // payload below so an unlocked receipt that creates a new row carries
      // the tier onto it.
      wholesale_price_usd: product.wholesale_price_usd || 0,
      wholesale_price_khr: product.wholesale_price_khr || 0,
      discount_enabled: !!product.discount_enabled,
      discount_type: product.discount_type || 'percent',
      discount_percent: product.discount_percent || 0,
      discount_amount_usd: product.discount_amount_usd || 0,
      cost_usd: product.cost_price_usd || product.purchase_price_usd || 0,
      cost_khr: product.cost_price_khr || product.purchase_price_khr || 0,
      barcode: product.barcode || '',
      batch_id: '',
      received_date: todayIsoDate(),
      supplier_id: '',
      supplier_name: '',
    })
    // Resuming an unsaved failed attempt: put back exactly what the operator
    // had typed (type, quantity, reason, branch, lot, date) on top of the
    // freshly seeded form, once.
    const resume = resumeRef.current
    if (resume) {
      resumeRef.current = null
      setAdjustForm((prev) => ({
        ...prev,
        type: resume.type || prev.type,
        quantity: resume.quantity != null ? resume.quantity : prev.quantity,
        reason: resume.reason || prev.reason,
        branch_id: resume.branchId != null ? String(resume.branchId) : prev.branch_id,
        batch_id: resume.batchId != null ? resume.batchId : prev.batch_id,
        received_date: resume.receivedDate || prev.received_date,
      }))
    }
  }, [defaultBranch, initialType])

  // When opened from a product detail card, skip the product-picker step and
  // refresh that exact row with branch_stock/images/batches before adjustment.
  // This makes the floating Adjust Stock action authoritative even if the
  // detail card itself came from a lighter paged product row.
  useEffect(() => {
    const initial = initialProduct
    const id = initial?.id
    if (!initial || id == null) return
    let cancelled = false
    getProductsByIds([id])
      .then((raw) => {
        if (cancelled) return
        const rows = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { items?: unknown })?.items)
            ? (raw as { items: PickedProduct[] }).items
            : []
        // Key the refreshed row by the id that was asked for. Taking
        // items[0] meant that any response that was not exactly this
        // product -- and until the fix in this lane the endpoint ignored
        // `ids` and answered with the head of the whole catalog -- silently
        // rebound the form to a different product: reported live on an
        // iPhone, picking "Dior Backstage Highlighter New 002" and getting
        // "Abercrombie Authantic 10ml" (the catalog's first row by name) in
        // the adjustment below. The picked product's identity now comes
        // from its id, and an unmatched response falls back to the row the
        // operator actually clicked rather than to a stranger.
        const refreshed = (rows as PickedProduct[]).find((row) => Number(row?.id) === Number(id))
        selectProduct(refreshed || initial as PickedProduct)
      })
      .catch(() => { if (!cancelled) selectProduct(initial as PickedProduct) })
    return () => { cancelled = true }
  }, [initialProduct?.id, selectProduct])

  // onAdjust: replicates Inventory.handleAdjust's validation + payload build
  // EXACTLY, minus the undo/redo action-history pinning (omitted here).
  const onAdjust = useCallback(async () => {
    const product = selectedProduct
    if (!product) { notify('Select a product first', 'error'); return }
    if (adjustSaving) return
    const qty = parseFloat(String(adjustForm.quantity))
    if (!qty || qty <= 0) { notify('Invalid quantity', 'error'); return }
    if (!String(adjustForm.reason || '').trim()) {
      notify(tr('adjust_reason_required', 'A reason is required for this stock adjustment.'), 'error')
      return
    }
    const numericBranchId = adjustForm.branch_id ? parseInt(String(adjustForm.branch_id), 10) : null
    const branchStockById = new Map(
      (Array.isArray(product.branch_stock) ? product.branch_stock : []).map((entry) => [Number(entry?.branch_id || 0), entry]),
    )
    const selectedBranchStock = numericBranchId ? branchStockById.get(numericBranchId) : null
    const unlockPricing = adjustForm.type === 'add' && !adjustForm.pricingLocked
    if (!unlockPricing && (adjustForm.type === 'add' || adjustForm.type === 'remove') && numericBranchId) {
      if (adjustForm.batch_id === '') { notify(tr('select_batch_required', 'Select a batch first'), 'error'); return }
      if (adjustForm.type === 'remove' && adjustForm.batch_id === 'new') { notify(tr('select_batch_required', 'Select a batch first'), 'error'); return }
    }
    const adjustmentRequest = {
      productId: product.id,
      productName: product.name,
      type: adjustForm.type,
      quantity: qty,
      reason: adjustForm.reason || '',
      branchId: numericBranchId,
      userId: user?.id,
      userName: user?.name || user?.username,
      unlockPricing,
      batchId: !unlockPricing && adjustForm.batch_id !== '' ? adjustForm.batch_id : undefined,
      receivedDate: adjustForm.type === 'add'
          && (unlockPricing || (Boolean(numericBranchId) && adjustForm.batch_id === 'new'))
          && adjustForm.received_date
        ? String(adjustForm.received_date)
        : undefined,
      supplierId: adjustForm.type === 'add' && adjustForm.supplier_id !== '' ? Number(adjustForm.supplier_id) : undefined,
      supplierName: adjustForm.type === 'add' && String(adjustForm.supplier_name || '').trim() !== '' ? String(adjustForm.supplier_name).trim() : undefined,
      pricing: unlockPricing ? {
        selling_price_usd: parseFloat(String(adjustForm.selling_price_usd)) || 0,
        selling_price_khr: parseFloat(String(adjustForm.selling_price_khr)) || 0,
        // Was special_price_*, renamed with the tier by the 2026-09-04 ruling.
        // /adjust names the wholesale pair now, so this is a live column. No
        // input renders for it -- the values ride through prefilled from the
        // row -- but unlocked pricing can land the receipt on a NEW product
        // row, and this pair is what seeds that row's tier. Kept identical to
        // Inventory.tsx's copy of this payload.
        wholesale_price_usd: parseFloat(String(adjustForm.wholesale_price_usd)) || 0,
        wholesale_price_khr: parseFloat(String(adjustForm.wholesale_price_khr)) || 0,
        discount_enabled: !!adjustForm.discount_enabled,
        discount_type: adjustForm.discount_type,
        discount_percent: parseFloat(String(adjustForm.discount_percent)) || 0,
        discount_amount_usd: parseFloat(String(adjustForm.discount_amount_usd)) || 0,
        cost_usd: parseFloat(String(adjustForm.cost_usd)) || 0,
        cost_khr: parseFloat(String(adjustForm.cost_khr)) || 0,
        barcode: adjustForm.barcode || null,
      } : undefined,
    }
    if (adjustForm.type === 'remove') {
      if (numericBranchId) {
        const available = Number(selectedBranchStock?.quantity || 0)
        if (available <= 0) { notify(tr('no_stock_in_branch', 'No stock in this branch to remove'), 'error'); return }
        if (qty > available) { notify(`Cannot remove ${qty} - only ${available} available`, 'error'); return }
      } else {
        const totalQty = stockQtyOf(product)
        if (totalQty <= 0) { notify('No stock available to remove', 'error'); return }
        if (qty > totalQty) { notify(`Cannot remove ${qty} - only ${totalQty} available`, 'error'); return }
      }
    }
    // Part 563: don't write yet -- park the validated request and open the
    // review dialog. commitAdjust runs the actual write once confirmed.
    setPendingAdjust(adjustmentRequest)
    // Keep the row's identity across a retry: an edited-and-resubmitted failed
    // row stays the SAME rowId, so the outcome list never grows a phantom
    // duplicate and a committed row can never be re-entered.
    setRows((prev) => {
      const retryTarget = prev.find((row) => row.status === 'failed') || prev.find((row) => row.status === 'pending')
      if (retryTarget) {
        return prev.map((row) => (row.rowId === retryTarget.rowId
          ? { ...row, status: 'pending' as const, request: adjustmentRequest, failure: null }
          : row))
      }
      return [...prev.filter((row) => row.status === 'done'), createRow(adjustmentRequest)]
    })
  }, [selectedProduct, adjustSaving, adjustForm, user, notify, tr])

  // Persist the failed attempt so the Stock Change section can list it (and
  // reopen it prefilled) even if the operator navigates away. There is no
  // server-side 'failed' status to write to -- inventory_movements only ever
  // records movements that committed -- so this is client-side, per user, and
  // marked UNSAVED in the ledger until it is fixed or discarded.
  const persistFailedAttempt = useCallback((
    request: Parameters<typeof adjustStock>[0],
    rowId: string,
    failure: ReturnType<typeof classifyStockAdjustFailure>,
  ) => {
    const req = (request || {}) as Record<string, any>
    const branchId = req.branchId != null ? Number(req.branchId) : null
    recordFailedStockAttempt(storage, userKey, {
      id: attemptIdRef.current,
      createdAt: new Date().toISOString(),
      source: 'adjust',
      rows: [{
        rowId,
        productId: req.productId ?? null,
        productName: String(req.productName || selectedProduct?.name || ''),
        type: String(req.type || ''),
        quantity: Number(req.quantity || 0),
        branchId,
        branchName: branchId ? String(branches.find((b) => Number(b.id) === branchId)?.name || branchId) : '',
        batchId: req.batchId ?? null,
        receivedDate: String(req.receivedDate || ''),
        reason: String(req.reason || ''),
        note: '',
        failure,
      }],
    })
    emitFailedAttemptsChanged()
  }, [storage, userKey, selectedProduct, branches])

  const commitAdjust = useCallback(async () => {
    const adjustmentRequest = pendingAdjust
    if (!adjustmentRequest) return
    // The row this confirm is committing -- never a row already 'done'.
    const target = rows.find((row) => row.status === 'pending') || rows.find((row) => row.status === 'failed')
    if (!target) return
    // Single-flight guard: a double-submit must never issue two writes.
    if (!beginSingleAction(submitRef, { blocked: adjustSaving })) return
    setAdjustSaving(true)
    setRows((prev) => applyRowOutcome(prev, target.rowId, { status: 'saving' }))
    try {
      const res = await adjustStock(adjustmentRequest) as { success?: boolean; error?: string } | undefined
      if (res?.success !== false) {
        setRows((prev) => applyRowOutcome(prev, target.rowId, { status: 'done' }))
        dropFailedStockAttempt(storage, userKey, attemptIdRef.current)
        emitFailedAttemptsChanged()
        notify(tr('stock_updated', 'Stock updated'))
        setPendingAdjust(null)
        onDone()
        onClose()
        return
      }
      // A `{success:false}` body is a rejected write, same as a thrown one.
      throw Object.assign(new Error(res?.error || 'Adjustment failed'), { status: 400 })
    } catch (error: unknown) {
      // THE RULE: a failure never closes this modal and never resets a field.
      // The row keeps the exact request the operator built, the server's own
      // reason is pinned to it for inline display, and the attempt is
      // persisted so the Stock Change section lists it as unsaved.
      const failure = classifyStockAdjustFailure(error)
      setRows((prev) => applyRowOutcome(prev, target.rowId, { status: 'failed', failure }))
      persistFailedAttempt(adjustmentRequest, target.rowId, failure)
      notify(failure.message, 'error')
    } finally {
      finishSingleAction(submitRef)
      setAdjustSaving(false)
    }
  }, [pendingAdjust, rows, adjustSaving, notify, tr, onDone, onClose, storage, userKey, persistFailedAttempt])

  // Closing with an unresolved failure asks first (shared ConfirmDialog, never
  // window.confirm): discard the failed attempt, or keep editing it.
  const requestClose = useCallback(() => {
    if (adjustSaving) return
    if (hasUnsavedFailures(rows)) { setConfirmDiscard(true); return }
    onClose()
  }, [adjustSaving, rows, onClose])

  const discardFailedAndClose = useCallback(() => {
    dropFailedStockAttempt(storage, userKey, attemptIdRef.current)
    emitFailedAttemptsChanged()
    setConfirmDiscard(false)
    onClose()
  }, [storage, userKey, onClose])

  // Step 1: product picker.
  if (!selectedProduct) {
    return (
      <Modal title={tr('adjust_pick_product', 'Choose a product to adjust')} onClose={onClose} size="sm">
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <SearchInput
                id="stock-adjust-product-search"
                value={search}
                onChange={setSearch}
                placeholder={t('search')}
                autoFocus
              />
            </div>
            <ScanSearchButton
              onDetected={handleProductScan}
              t={t}
              title={tr('scan_product_for_adjustment', 'Scan product for this stock adjustment')}
            />
          </div>
          {searching && !results.length ? (
            <div className="py-6 text-center text-sm text-gray-400">{t('loading')}</div>
          ) : !results.length ? (
            <div className="py-6 text-center text-sm text-gray-400">{t('no_data_found')}</div>
          ) : (
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {results.map((product) => (
                <button
                  key={String(product.id)}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-900/20"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{product.name || String(product.id)}</span>
                    <span className="block truncate text-xs text-gray-400">
                      {product.barcode ? `${product.barcode} · ` : ''}{stockQtyOf(product)} {product.unit || ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    )
  }

  // Step 2: reuse Inventory's own adjust modal, fully wired.
  const product = selectedProduct
  const numericBranchId = adjustForm.branch_id ? Number(adjustForm.branch_id) : null
  const branchRows = Array.isArray(product.branch_stock) ? product.branch_stock : []
  const branchEntry = numericBranchId ? branchRows.find((entry) => Number(entry?.branch_id) === numericBranchId) : null
  const adjustCurrentQuantity = branchEntry ? Number(branchEntry.quantity || 0) : stockQtyOf(product)
  const adjustCurrentPricing = {
    selling_price_usd: Number(product.selling_price_usd) || 0,
    selling_price_khr: Number(product.selling_price_khr) || 0,
  }
  const branchSelectOptions: AppSelectOption[] = branches.map((branch) => ({
    value: String(branch.id),
    label: branch.is_default ? `${branch.name || branch.id} (${tr('default', 'default')})` : String(branch.name || branch.id),
  }))

  // Compact review rows for the confirm dialog, read from the parked request
  // (so they match exactly what will be written, not the live form).
  const buildAdjustReviewItems = (): ConfirmReviewItem[] => {
    const req = pendingAdjust
    if (!req) return []
    const reqType = String(req.type || '')
    const typeLabel = reqType === 'remove' ? tr('remove', 'Remove') : reqType === 'set' ? tr('set', 'Set') : tr('add', 'Add')
    const reqBranchId = req.branchId != null ? Number(req.branchId) : null
    const branchName = reqBranchId ? (branches.find((b) => Number(b.id) === reqBranchId)?.name || String(reqBranchId)) : '--'
    const items: ConfirmReviewItem[] = [
      { label: tr('type', 'Type'), value: typeLabel },
      { label: tr('quantity', 'Quantity'), value: `${Number(req.quantity || 0)}${product.unit ? ` ${product.unit}` : ''}` },
      { label: tr('branch', 'Branch'), value: branchName },
    ]
    const reqReason = String(req.reason || '').trim()
    if (reqReason) items.push({ label: tr('reason', 'Reason'), value: reqReason })
    const reqSupplier = String(req.supplierName || '').trim()
    if (reqSupplier) items.push({ label: tr('supplier', 'Supplier'), value: reqSupplier })
    return items
  }

  // The failed row's reason, shown INLINE next to the values that produced it
  // (not only as a toast, which disappears). 409/400 insufficient stock adds
  // the available quantity; an offline failure says the write never left the
  // device and the row is being kept.
  const failureNotice = failedRow?.failure ? (
    <div
      data-stock-adjust-failure="true"
      className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <div className="font-semibold">
        {failedRow.failure.offline
          ? tr('stock_adjust_failed_offline', 'Not saved — offline. Your entry is kept.', 'មិនបានរក្សាទុក — គ្មានអ៊ីនធឺណិត។ ធាតុរបស់អ្នកត្រូវបានរក្សាទុក។')
          : tr('stock_adjust_failed_row', 'Not saved — fix and retry', 'មិនបានរក្សាទុក — សូមកែ ហើយព្យាយាមម្ដងទៀត')}
      </div>
      <div className="mt-0.5 break-words">{failedRow.failure.message}</div>
      {failedRow.failure.available != null ? (
        <div className="mt-0.5 tabular-nums">
          {tr('available', 'Available')}: <b>{failedRow.failure.available}</b>
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <InventoryStockModals
        adjustModal={product}
        transferModal={null}
        adjustForm={adjustForm}
        setAdjustForm={setAdjustForm}
        adjustSaving={adjustSaving}
        onAdjust={onAdjust}
        onCloseAdjust={requestClose}
        adjustNotice={failureNotice}
        adjustSubmitLabel={submitState.mode === 'retry'
          ? `${tr('retry', 'Retry')} (${submitState.failedCount})`
          : undefined}
        adjustTargetOptions={[product]}
        adjustTargetSelectOptions={[]}
        adjustBranchSelectOptions={branchSelectOptions}
        branchSelectOptions={branchSelectOptions}
        branchCount={branches.length}
        adjustCurrentQuantity={adjustCurrentQuantity}
        adjustCurrentPricing={adjustCurrentPricing}
        defaultAddQuantity={1}
        getStockQty={stockQtyOf}
        fmtKHR={fmtKHR}
        fmtUSD={fmtUSD}
        usdSymbol={usdSymbol}
        // InventoryStockModals' reason union is the three stock-flow groups
        // (no 'delete'); narrow our 4-union catalog to its shape here. The
        // setter is only ever called by it with type 'adjust'/'transfer'.
        reasonsByType={reasonsByType as StockModalReasonGroups}
        setReasonManager={setReasonManager as unknown as Dispatch<SetStateAction<StockModalReasonManagerState>>}
        t={t}
        tr={tr}
        // Transfer side is unused here (transferModal is null).
        transferForm={{ from_branch_id: '', to_branch_id: '', quantity: '', reason: '' }}
        setTransferForm={() => {}}
        onTransfer={() => {}}
        onCloseTransfer={onClose}
        transferSaving={false}
        transferSourceBranchOptions={[]}
        branchWithPlaceholderOptions={[]}
      />
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
        tr={tr}
      />
      {pendingAdjust ? (
        <ConfirmDialog
          t={t}
          title={tr('adjust_stock', 'Adjust stock')}
          message={String(pendingAdjust.productName || product.name || '')}
          items={buildAdjustReviewItems()}
          // Once anything has failed the primary action is a RETRY of exactly
          // that row, never a fresh submit -- committed rows are excluded by
          // rowsToSubmit(), so a retry can never double-apply.
          confirmLabel={submitState.mode === 'retry'
            ? `${tr('retry_failed', 'Retry failed')} (${submitState.failedCount})`
            : tr('confirm', 'Confirm')}
          working={adjustSaving}
          workingLabel={tr('saving', 'Saving...')}
          onConfirm={commitAdjust}
          onClose={() => { if (!adjustSaving) setPendingAdjust(null) }}
        >
          {failureNotice}
        </ConfirmDialog>
      ) : null}
      {confirmDiscard ? (
        <ConfirmDialog
          t={t}
          danger
          title={tr('discard_failed_adjustment', 'Discard the unsaved adjustment?', 'បោះបង់ការកែស្តុកដែលមិនបានរក្សាទុក?')}
          message={tr(
            'discard_failed_adjustment_desc',
            'This entry was never saved. Discard it, or keep editing to fix and retry.',
            'ធាតុនេះមិនត្រូវបានរក្សាទុកទេ។ បោះបង់វា ឬបន្តកែដើម្បីព្យាយាមម្ដងទៀត។',
          )}
          items={buildAdjustReviewItems()}
          confirmLabel={tr('discard', 'Discard', 'បោះបង់')}
          cancelLabel={tr('keep_editing', 'Keep editing', 'បន្តកែ')}
          onConfirm={discardFailedAndClose}
          onClose={() => setConfirmDiscard(false)}
        />
      ) : null}
    </>
  )
}
