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
  special_price_usd: InventoryFormValue
  special_price_khr: InventoryFormValue
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
  special_price_usd?: number
  special_price_khr?: number
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

export default function StockAdjustModal({ initialType = 'add', initialProduct = null, onClose, onDone, t }: StockAdjustModalProps) {
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

  useEffect(() => {
    if (selectedProduct) return
    let cancelled = false
    setSearching(true)
    // include branch_stock so per-branch quantity + remove-availability
    // checks below are accurate; the search endpoint supports `include`
    // (same param getProductsByIds passes).
    searchProducts({ search: debouncedSearch, pageSize: 20, include: 'branch_stock' })
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
  const [pendingReasonDelete, setPendingReasonDelete] = useState<InventoryReason | null>(null)
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
  // Select-then-confirm: staging the entry opens the ConfirmDialog below
  // instead of a bare window.confirm(); the removal runs from its onConfirm.
  const deleteSavedReason = useCallback((entry: InventoryReason) => {
    setPendingReasonDelete(entry)
  }, [])
  const commitDeleteSavedReason = useCallback(async () => {
    if (!pendingReasonDelete) return
    const next = inventoryReasons.filter((item) => item.id !== pendingReasonDelete.id)
    setPendingReasonDelete(null)
    await saveReasonCatalog(next)
  }, [inventoryReasons, pendingReasonDelete, saveReasonCatalog])

  // --- adjust form (step 2) ---
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(() => ({
    type: initialType,
    quantity: 1,
    reason: '',
    branch_id: '',
    pricingLocked: true,
    selling_price_usd: 0,
    selling_price_khr: 0,
    special_price_usd: 0,
    special_price_khr: 0,
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
      special_price_usd: product.special_price_usd || 0,
      special_price_khr: product.special_price_khr || 0,
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
        selectProduct((rows[0] as PickedProduct | undefined) || initial as PickedProduct)
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
        special_price_usd: parseFloat(String(adjustForm.special_price_usd)) || 0,
        special_price_khr: parseFloat(String(adjustForm.special_price_khr)) || 0,
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
  }, [selectedProduct, adjustSaving, adjustForm, user, notify, tr])

  const commitAdjust = useCallback(async () => {
    const adjustmentRequest = pendingAdjust
    if (!adjustmentRequest) return
    // Single-flight guard: a double-submit must never issue two writes.
    if (!beginSingleAction(submitRef, { blocked: adjustSaving })) return
    setAdjustSaving(true)
    try {
      const res = await adjustStock(adjustmentRequest) as { success?: boolean; error?: string } | undefined
      if (res?.success !== false) {
        notify(tr('stock_updated', 'Stock updated'))
        setPendingAdjust(null)
        onDone()
        onClose()
      } else {
        // Keep the review dialog open on a rejected write so the operator can
        // fix the reason/quantity and retry rather than losing the request.
        notify(res?.error || 'Adjustment failed', 'error')
      }
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : 'Error', 'error')
    } finally {
      finishSingleAction(submitRef)
      setAdjustSaving(false)
    }
  }, [pendingAdjust, adjustSaving, notify, tr, onDone, onClose])

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
            <ScanSearchButton onDetected={setSearch} t={t} />
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

  return (
    <>
      <InventoryStockModals
        adjustModal={product}
        transferModal={null}
        adjustForm={adjustForm}
        setAdjustForm={setAdjustForm}
        adjustSaving={adjustSaving}
        onAdjust={onAdjust}
        onCloseAdjust={onClose}
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
          confirmLabel={tr('confirm', 'Confirm')}
          working={adjustSaving}
          workingLabel={tr('saving', 'Saving...')}
          onConfirm={commitAdjust}
          onClose={() => { if (!adjustSaving) setPendingAdjust(null) }}
        />
      ) : null}
      {pendingReasonDelete ? (
        <ConfirmDialog
          t={t}
          title={tr('delete_saved_reason_confirm', 'Delete this saved reason?')}
          message={pendingReasonDelete.label}
          danger
          working={savingReasons}
          onConfirm={() => { void commitDeleteSavedReason() }}
          onClose={() => setPendingReasonDelete(null)}
        />
      ) : null}
    </>
  )
}
