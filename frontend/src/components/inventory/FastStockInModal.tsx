// F2 (Part 419): fast stock-in -- one shipment's header (branch, received
// date, supplier, paid/credit) entered ONCE, then rapid per-product lines:
// type a name, pick the row, quantity/cost/expiry, and queue it. Queued
// lines remain editable/removable until Complete writes them through the
// same receiveBatchStock kernel used by every other add-stock surface.
// Each outcome stays visible, so a partial failure can be fixed and retried.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect from '../shared/AppSelect.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import Modal from '../shared/Modal.tsx'
import { receiveBatchStock, getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { adjustStock } from '../../api/inventoryWriteTransport.ts'
import { searchProducts } from '../../api/methods.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft, writeWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { batchDisplayLabel, lotCodeAsDate } from '../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { buildProductGroups, type ProductGroup, type ProductRecord } from '../../utils/productGrouping.ts'

// Keep product creation inside this receiving flow rather than sending the
// operator to a separate page. The standard ProductForm and create transport
// remain the only product-writing path; this modal only keeps the shipment
// draft alive around that existing flow.
const ProductForm = lazyRetry(() => import('../products/forms/ProductForm'), 'fast-stock-in-create-product-form')

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface ProductCandidate extends ProductRecord {
  id: number | string
  name?: string | null
  barcode?: string | null
  stock_quantity?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  purchase_price_usd?: number | string | null
  purchase_price_khr?: number | string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  wholesale_price_usd?: number | string | null
  wholesale_price_khr?: number | string | null
  discount_enabled?: boolean | number | null
  discount_type?: string | null
  discount_percent?: number | string | null
  discount_amount_usd?: number | string | null
  parent_id?: number | string | null
  is_group?: boolean | number | null
  branch_stock?: Array<{ branch_id?: number | string | null; branch_name?: string | null; quantity?: number | string | null }>
}

interface ReceivedLine {
  key: string
  product: ProductCandidate
  productName: string
  quantity: number
  unitCost: string
  createPriceVariant: boolean
  expiryDate: string
  // The lot this line lands in, frozen when it was queued. 'new' means
  // create-or-match by the shipment date; a number tops up that exact lot.
  // Frozen because the picker below re-fetches per product/branch, so the
  // live batchChoice no longer describes a line once the next one starts.
  batchChoice: 'new' | number
  batchLabel: string
  status: 'queued' | 'saving' | 'saved' | 'error'
  detail: string
}

interface FastStockInModalProps {
  branchOptions: Array<{ value: string; label: string }>
  defaultBranchId?: string | number | null
  tr: TranslationWithFallback
  notify: (message: string, kind?: string) => void
  onClose: () => void
  onDone: () => void
  // F3 slice 2: park this shipment as a chip; the draft (slice 1) already
  // holds everything, so minimize is just "close without finishing".
  onMinimize?: (label: string) => void
  initialHeader?: Partial<Pick<FastStockInDraft, 'branchId' | 'receivedDate' | 'supplier' | 'paymentStatus' | 'creditDueDate'>>
  exchangeRate?: number
}

// F3 slice 1: the batch-in flow persists like add-product does -- the
// shipment header, in-progress line, and queued lines survive navigation/
// reload via the shared store.

type FastStockInDraft = {
  sessionId?: number
  branchId: string
  receivedDate: string
  supplier: SupplierChoice
  paymentStatus: 'paid' | 'credit'
  creditDueDate: string
  query: string
  picked: ProductCandidate | null
  quantity: string
  unitCost: string
  createPriceVariant?: boolean
  expiryDate: string
  lines?: ReceivedLine[]
  // Only set by a camera/scan-button result. Typed text must not turn every
  // empty suggestion list into a prompt to create a new catalog record.
  scannedBarcode?: string
}

type LookupOption = { id: number | string; name: string }
type CreateProductResult = {
  success?: boolean
  pending?: boolean
  error?: string
  id?: number | string
  item?: ProductCandidate
}

function normalizeLookupOptions(value: unknown): LookupOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const option = row as { id?: unknown; name?: unknown }
    if ((typeof option.id !== 'number' && typeof option.id !== 'string') || !String(option.name || '').trim()) return []
    return [{ id: option.id, name: String(option.name).trim() }]
  })
}

export default function FastStockInModal({ branchOptions, defaultBranchId, tr, notify, onClose, onDone, onMinimize, initialHeader, exchangeRate = 4100 }: FastStockInModalProps) {
  // This modal only receives the fallback-aware tr(); DateEntryInput wants a
  // bare pack lookup, so adapt rather than duplicate its strings.
  const packLookup = (key: string): string | undefined => tr(key, '') || undefined
  const fastStockInDraftKey = scopedWorkDraftKey('fast_stockin')
  // ---- shipment header (entered once, applies to every line) ----
  const draftRef = useRef<FastStockInDraft | null>(readWorkDraft<FastStockInDraft>(fastStockInDraftKey)?.data ?? null)
  const draft = draftRef.current
  const [branchId, setBranchId] = useState<string>(draft?.branchId || initialHeader?.branchId || (defaultBranchId != null ? String(defaultBranchId) : (branchOptions[0]?.value || '')))
  // Received date defaults to TODAY (business day) rather than empty (user,
  // Sep 3 2026): nearly every fast stock-in is for stock that just arrived,
  // so the date the batch code derives from should already be filled in and
  // the cashier only edits it for a late-entered delivery.
  const [receivedDate, setReceivedDate] = useState<string>(draft?.receivedDate || initialHeader?.receivedDate || todayStr())
  const [supplier, setSupplier] = useState<SupplierChoice>(draft?.supplier || initialHeader?.supplier || { supplierId: null, supplierName: '' })
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>(draft?.paymentStatus || initialHeader?.paymentStatus || 'paid')
  const [creditDueDate, setCreditDueDate] = useState(draft?.creditDueDate || initialHeader?.creditDueDate || '')

  // ---- per-line entry ----
  const [query, setQuery] = useState(draft?.query || '')
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null)
  const [picked, setPicked] = useState<ProductCandidate | null>(draft?.picked || null)
  const [quantity, setQuantity] = useState(draft?.quantity || '1')
  const [unitCost, setUnitCost] = useState(draft?.unitCost || '')
  const [createPriceVariant, setCreatePriceVariant] = useState(Boolean(draft?.createPriceVariant))
  const [expiryDate, setExpiryDate] = useState(draft?.expiryDate || '')
  const [scannedBarcode, setScannedBarcode] = useState(draft?.scannedBarcode || '')
  // Deliberately NOT persisted in the draft, same reasoning as
  // ReceiveBatchModal: a lot id can go stale between sessions (merged,
  // emptied, deactivated) and 'new' is always a safe default.
  const [batchChoice, setBatchChoice] = useState<'new' | number>('new')
  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [pendingCommit, setPendingCommit] = useState<ReceivedLine[] | null>(null)
  const [searchCompleteFor, setSearchCompleteFor] = useState('')
  const [createBarcode, setCreateBarcode] = useState('')
  const [createCategories, setCreateCategories] = useState<LookupOption[]>([])
  const [createUnits, setCreateUnits] = useState<LookupOption[]>([])
  const [saving, setSaving] = useState(false)
  const [received, setReceived] = useState<ReceivedLine[]>(draft?.lines || [])
  const [editingKey, setEditingKey] = useState('')
  // Set by editLine, consumed by the lot-options effect once that product's
  // lots have loaded. Without it the effect's own setBatchChoice('new') wins
  // the race and the reopened line loses the lot it was queued against.
  const pendingBatchRestoreRef = useRef<'new' | number | null>(null)
  const searchSeqRef = useRef(0)
  const sessionIdRef = useRef(draft?.sessionId || Date.now())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const parentPanelRef = useRef<HTMLDivElement | null>(null)
  const scannedCreateUnits = useMemo(
    () => (createUnits.length ? createUnits : [{ id: 'pcs', name: 'pcs' }]),
    [createUnits],
  )
  const scannedCreateBranches = useMemo(
    () => branchOptions.map((branch) => ({
      id: branch.value,
      name: branch.label,
      is_default: String(branch.value) === String(defaultBranchId || ''),
    })),
    [branchOptions, defaultBranchId],
  )
  const productsById = useMemo(
    () => new Map<unknown, ProductRecord>(candidates.map((product) => [product.id, product as ProductRecord])),
    [candidates],
  )
  const candidateGroups = useMemo(
    () => buildProductGroups(candidates, productsById, { preserveInputOrder: true }),
    [candidates, productsById],
  )

  // Autosave the header + in-progress line (debounced, shared cadence).
  // Deliberately NO dirtyWork registration: with the draft persisting,
  // leaving is SAFE -- everything is exactly here on reopen -- so the
  // three-option navigation guard would only nag about work that cannot
  // be lost.
  useEffect(() => {
    return scheduleWorkDraftWrite<FastStockInDraft>(fastStockInDraftKey, {
      sessionId: sessionIdRef.current,
      branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost, createPriceVariant, expiryDate, lines: received, scannedBarcode,
    })
  }, [branchId, receivedDate, supplier, paymentStatus, creditDueDate, query, picked, quantity, unitCost, createPriceVariant, expiryDate, received, scannedBarcode])

  useEffect(() => {
    const text = query.trim()
    setSearchCompleteFor('')
    if (picked || selectedGroup || text.length < 2) { setCandidates([]); return }
    const seq = ++searchSeqRef.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: text, pageSize: 8 }) as { items?: ProductCandidate[] }
        if (seq !== searchSeqRef.current) return
        setCandidates(Array.isArray(payload?.items) ? payload.items : [])
        setSearchCompleteFor(text)
      } catch { /* suggestions only -- typing again retries */ }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, picked, selectedGroup])

  useEffect(() => {
    const panel = parentPanelRef.current
    if (!panel || !selectedGroup) return
    panel.setAttribute('inert', '')
    panel.setAttribute('aria-hidden', 'true')
    return () => { panel.removeAttribute('inert'); panel.removeAttribute('aria-hidden') }
  }, [selectedGroup])

  useEffect(() => {
    if (!selectedGroup) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeCandidateOptions()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  })

  // The same lot list every other add-stock surface shows, scoped to the
  // picked product and this shipment's branch. Mirrors ReceiveBatchModal's
  // effect exactly, including onlyAvailable=false: topping an empty lot back
  // up is a normal receipt, so empty lots must stay selectable.
  useEffect(() => {
    const productId = Number(picked?.id)
    const parsedBranchId = Number(branchId)
    setBatchChoice('new')
    if (!productId || !parsedBranchId) { setBatchOptions([]); pendingBatchRestoreRef.current = null; return }
    let cancelled = false
    setBatchLoading(true)
    getProductBatches(productId, parsedBranchId, false)
      .then((res) => {
        if (cancelled) return
        const lots = res?.batches || []
        setBatchOptions(lots)
        // Re-apply a lot the operator had already chosen for this line, but
        // only while it still exists here -- otherwise leave 'new'.
        const restore = pendingBatchRestoreRef.current
        pendingBatchRestoreRef.current = null
        if (typeof restore === 'number' && lots.some((lot) => Number(lot.id) === restore)) setBatchChoice(restore)
      })
      .catch((error: unknown) => {
        // The transport rejects rather than resolving empty, precisely so a
        // failed read can never read as "this product has no lots".
        if (cancelled) return
        console.error('[FastStockInModal] batch options load failed:', error)
        setBatchOptions([])
      })
      .finally(() => { if (!cancelled) setBatchLoading(false) })
    return () => { cancelled = true }
  }, [picked?.id, branchId])

  // ProductForm needs the same lookup data as the normal catalog-create
  // surface. Fetch it only when a real unmatched scan asks to create; empty
  // arrays are safe while it loads because ProductForm has its normal `pcs`
  // fallback and the backend remains the authority for identity validation.
  useEffect(() => {
    if (!createBarcode) return
    let cancelled = false
    void Promise.all([
      import('../../api/lookupTransport.ts').then(({ getCategories }) => getCategories()),
      import('../../api/lookupTransport.ts').then(({ getUnits }) => getUnits()),
    ]).then(([categories, units]) => {
      if (cancelled) return
      setCreateCategories(normalizeLookupOptions(categories))
      setCreateUnits(normalizeLookupOptions(units))
    }).catch(() => {
      // The form remains usable with its normal fallback unit; lookup reads
      // are a convenience, not a reason to discard this stock-in session.
    })
    return () => { cancelled = true }
  }, [createBarcode])

  const pick = (candidate: ProductCandidate) => {
    setPicked(candidate)
    setCandidates([])
    setQuery(String(candidate.name || ''))
    const cost = Number(candidate.cost_price_usd)
    if (Number.isFinite(cost) && cost > 0) setUnitCost(String(cost))
    setCreatePriceVariant(false)
    setScannedBarcode('')
  }

  function closeCandidateOptions() {
    setSelectedGroup(null)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const pickFromGroup = (candidate: ProductCandidate) => {
    pick(candidate)
    closeCandidateOptions()
  }

  const resetLine = () => {
    setPicked(null)
    setQuery('')
    setQuantity('1')
    setUnitCost('')
    setCreatePriceVariant(false)
    setExpiryDate('')
    setScannedBarcode('')
    pendingBatchRestoreRef.current = null
    setBatchChoice('new')
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const persistDraftBeforeProductCreate = () => {
    writeWorkDraft<FastStockInDraft>(fastStockInDraftKey, {
      sessionId: sessionIdRef.current,
      branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost, createPriceVariant, expiryDate, lines: received, scannedBarcode,
    })
  }

  const openCreateForUnknownScan = () => {
    const barcode = scannedBarcode.trim()
    if (!barcode || barcode !== query.trim() || searchCompleteFor !== barcode || candidates.length) return
    // Write synchronously before replacing the receiver UI with ProductForm.
    // Cancelling that form returns here with the in-memory state too; this
    // write additionally protects the session against a navigation/reload.
    persistDraftBeforeProductCreate()
    setCreateBarcode(barcode)
  }

  const createProductForScannedBarcode = async (payload: Record<string, unknown> = {}) => {
    const { createProduct } = await import('../../api/productWriteTransport.ts')
    const result = await createProduct({ ...payload, barcode: createBarcode, branch_id: branchId, stock_quantity: 0 }) as CreateProductResult
    if (result?.success === false) throw new Error(result.error || tr('failed', 'Failed to create product'))
    if (result?.pending) {
      throw new Error(tr('product_creation_pending_review', 'Product creation is pending review and cannot be added to this stock-in session yet.'))
    }
    const item = result?.item
    const productId = item?.id ?? result?.id
    if (productId == null || productId === '') throw new Error(tr('failed', 'Created product could not be loaded'))
    const created: ProductCandidate = {
      ...(item || {}),
      ...payload,
      id: productId,
      name: String(item?.name || payload.name || ''),
      barcode: String(item?.barcode || createBarcode),
    }
    setCreateBarcode('')
    pick(created)
    notify(tr('product_created_continue_stockin', 'Product created. Continue adding it to this stock-in session.'))
  }

  const addLine = () => {
    if (saving) return
    const qty = Math.floor(Number(quantity)) || 0
    if (!picked) { notify(tr('fast_stockin_pick_product', 'Pick a product first'), 'error'); return }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (qty <= 0) { notify(tr('fast_stockin_qty', 'Quantity must be at least 1'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate.trim()) {
      notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error')
      return
    }
    const lineName = String(picked.name || `#${picked.id}`)
    // Unlocked pricing always creates a fresh lot server-side, so a chosen
    // lot must not ride along with it -- same rule the adjust surfaces use.
    const variantWins = costChanged(picked, unitCost) && createPriceVariant
    const effectiveBatchChoice: 'new' | number = variantWins ? 'new' : batchChoice
    const chosenLot = typeof effectiveBatchChoice === 'number'
      ? batchOptions.find((batch) => Number(batch.id) === effectiveBatchChoice)
      : null
    const next: ReceivedLine = {
        key: editingKey || `${picked.id}-${Date.now()}`,
        product: picked,
        productName: lineName,
        quantity: qty,
        unitCost,
        createPriceVariant: variantWins,
        expiryDate,
        batchChoice: effectiveBatchChoice,
        batchLabel: chosenLot ? batchDisplayLabel(chosenLot, tr('batch', 'Batch')) : tr('new_batch', '+ New batch'),
        status: 'queued',
        detail: tr('ready_to_receive', 'Ready'),
    }
    setReceived((prev) => editingKey
      ? prev.map((line) => line.key === editingKey ? next : line)
      : [next, ...prev])
    setEditingKey('')
    resetLine()
  }

  const editLine = (line: ReceivedLine) => {
    if (saving || line.status === 'saved') return
    setEditingKey(line.key)
    setPicked(line.product)
    setQuery(line.productName)
    setQuantity(String(line.quantity))
    setUnitCost(line.unitCost)
    setCreatePriceVariant(line.createPriceVariant)
    setExpiryDate(line.expiryDate)
    // Parked rather than set: the options effect is about to re-key on this
    // product and would overwrite a direct set.
    pendingBatchRestoreRef.current = line.batchChoice
    setBatchChoice(line.batchChoice)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const removeLine = (key: string) => {
    if (saving) return
    setReceived((prev) => prev.filter((line) => line.key !== key))
    if (editingKey === key) { setEditingKey(''); resetLine() }
  }

  // Validate, then park the batch for review. The write itself lives in
  // performCommit -- ConfirmDialog replaces the old native browser confirm,
  // which was off-brand and untranslatable.
  const commitSession = () => {
    if (saving) return
    const pending = received.filter((line) => line.status !== 'saved')
    if (!pending.length) {
      if (received.some((line) => line.status === 'saved')) onDone()
      clearWorkDraft(fastStockInDraftKey)
      onClose()
      return
    }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate.trim()) { notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error'); return }
    setPendingCommit(pending)
  }

  const performCommit = async (pending: ReceivedLine[]) => {
    if (saving) return
    setSaving(true)
    let failed = 0
    for (const line of pending) {
      setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saving' } : item))
      try {
        const result = line.createPriceVariant
          ? await adjustStock({
              productId: Number(line.product.id), type: 'add', quantity: line.quantity,
              reason: tr('stock_in_session_reason', 'Stock-in session'), branchId: Number(branchId),
              unlockPricing: true,
              receivedDate: receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
              supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
              unitCostUsd: Number(line.unitCost), paymentStatus,
              creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
              sessionId: sessionIdRef.current,
              pricing: pricingForVariant(line.product, Number(line.unitCost)),
            }) as { batchNumber?: number | null; lotCode?: string | null; createdSibling?: boolean }
          : await receiveBatchStock({
              productId: Number(line.product.id), branchId: Number(branchId), quantity: line.quantity,
              // Same two-line rule as ReceiveBatchModal: a chosen lot is topped
              // up by id and keeps its own received date; only 'new' derives a
              // lot code from this shipment's date.
              batchId: typeof line.batchChoice === 'number' ? line.batchChoice : null,
              receivedDate: line.batchChoice === 'new' ? (receivedDate.trim() || null) : null,
              expiryDate: line.expiryDate.trim() || null,
              supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
              unitCostUsd: Number(line.unitCost) >= 0 && line.unitCost !== '' ? Number(line.unitCost) : null,
              paymentStatus, creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
              sessionId: sessionIdRef.current,
            })
        setReceived((prev) => prev.map((item) => item.key === line.key ? {
          ...item, status: 'saved', detail: result?.lotCode
            // Z1a: the server hands back an MMDDYYYY lot code; show it as the
            // received date it encodes, not as a raw 8-digit run.
            ? `${tr('lot', 'lot')} ${lotCodeAsDate(result.lotCode) || result.lotCode}`
            : line.createPriceVariant
              ? tr('price_variant_received', 'Price variant received')
              : tr('received', 'Received'),
        } : item))
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : tr('error', 'Error')
        setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'error', detail: message } : item))
      }
    }
    setSaving(false)
    setPendingCommit(null)
    const saved = pending.length - failed
    // The pack string carries a {count} placeholder and tr() does not
    // interpolate, so substitute here -- otherwise the operator reads a
    // literal "{count}".
    if (saved > 0) notify(tr('stock_session_completed', 'Received {count} stock-in line(s) successfully.').replace('{count}', String(saved)))
    if (failed) {
      // Refresh the parent only after the partial/complete decision, so the
      // list reload cannot race the retry the operator is about to make.
      onDone()
      notify(tr('stock_session_partial', '{n} line(s) could not be saved. Fix them and complete again.').replace('{n}', String(failed)), 'error')
      return
    }
    onDone()
    clearWorkDraft(fastStockInDraftKey)
    onClose()
  }

  const successCount = received.filter((line) => line.status === 'saved').length
  const commitBranchName = branchOptions.find((option) => String(option.value) === String(branchId))?.label || tr('branch', 'selected branch')
  const commitReviewItems: ConfirmReviewItem[] = pendingCommit ? [
    { label: tr('branch', 'Branch'), value: commitBranchName },
    { label: tr('lines', 'Lines'), value: pendingCommit.length },
    { label: tr('total_units', 'Total units'), value: pendingCommit.reduce((total, line) => total + line.quantity, 0) },
    { label: tr('total_cost', 'Total cost'), value: `$${pendingCommit.reduce((total, line) => total + Math.max(0, line.quantity) * Math.max(0, Number(line.unitCost) || 0), 0).toFixed(2)}` },
    { label: tr('received_date', 'Received date'), value: receivedDate.trim() || tr('today', 'Today') },
    { label: tr('supplier', 'Supplier'), value: supplier.supplierName.trim() || '—' },
    { label: tr('payment', 'Payment'), value: paymentStatus === 'credit'
      ? `${tr('on_credit', 'On credit')}${creditDueDate.trim() ? ` · ${creditDueDate.trim()}` : ''}`
      : tr('paid', 'Paid') },
  ] : []
  const sessionCostTotal = received.reduce((total, line) => (
    total + Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitCost) || 0)
  ), 0)
  // X/backdrop keep the draft (reopen later, shipment intact); only the
  // explicit Done button completes the batch and clears it.
  const closeIfIdle = () => { if (!saving) { if (successCount > 0) onDone(); onClose() } }
  const closeBackdropIfIdle = () => { if (!selectedGroup) closeIfIdle() }

  // The receiver stays mounted (and its session state stays in memory) while
  // the standard product form is open. Cancel simply returns to the exact
  // pending scan; a successful create calls `pick` above and resumes the
  // quantity/cost line without re-entering shipment header data.
  if (createBarcode) {
    return (
      <Suspense fallback={null}>
        <ProductForm
          product={{ barcode: createBarcode, branch_id: branchId, name: '', stock_quantity: 0 }}
          draftScope={`fast-stock-in-${sessionIdRef.current}-${createBarcode}`}
          categories={createCategories}
          units={scannedCreateUnits}
          branches={scannedCreateBranches}
          onSave={(payload) => createProductForScannedBarcode((payload || {}) as Record<string, unknown>)}
          onClose={() => setCreateBarcode('')}
          t={(key: string) => tr(key, key)}
          usdSymbol="$"
          khrSymbol="៛"
          exchangeRate={exchangeRate}
        />
      </Suspense>
    )
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={closeBackdropIfIdle}>
      <div ref={parentPanelRef} className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h2 className="min-w-0 truncate text-lg font-bold text-gray-900 dark:text-white">⚡ {tr('fast_stockin_title', 'Fast stock-in')}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {onMinimize ? (
              <MinimizeButton
                disabled={saving}
                tr={tr}
                onMinimize={() => { onMinimize(tr('fast_stockin_title', 'Fast stock-in')); onClose() }}
              />
            ) : null}
            <button type="button" onClick={closeIfIdle} disabled={saving} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          {/* Search comes first on phones and desktops; shipment details sit below it. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              {editingKey ? tr('edit_stock_line', 'Edit product line') : tr('fast_stockin_line', 'Next product')}
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input ref={searchInputRef} className="input w-full text-sm" placeholder={tr('fast_stockin_search', 'Type a product name or barcode…')} value={query}
                  onChange={(event) => { setQuery(event.target.value); setPicked(null); setEditingKey(''); setScannedBarcode('') }} autoFocus />
                {candidateGroups.length > 0 ? (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                    {candidateGroups.map((group) => (
                      <button key={group.key} type="button" onClick={() => setSelectedGroup(group)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">{group.name}</span>
                        <span className="flex-shrink-0 text-[10px] text-gray-400">{group.sellableItems.length || group.items.length} {tr('options', 'options')} · {group.stockTotal}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <ScanSearchButton onDetected={(value) => {
                const barcode = String(value || '').trim()
                setQuery(barcode)
                setPicked(null)
                setEditingKey('')
                setScannedBarcode(barcode)
              }} t={(key) => tr(key, key)} title={tr('scan_product_for_stock_in', 'Scan product for this stock-in')} />
            </div>
            {scannedBarcode && scannedBarcode === query.trim() && searchCompleteFor === scannedBarcode && candidates.length === 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="min-w-0">{tr('unknown_barcode', 'No product matches this scanned barcode.')}</span>
                <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={openCreateForUnknownScan}>
                  {tr('create_product', 'Create product')}
                </button>
              </div>
            ) : null}
            {picked ? (
              <>
              {/* The same lot picker the three sibling add-stock surfaces
                  already have. A batch is identified by its date: "New batch"
                  derives the lot code from the shipment date, an existing chip
                  tops up that exact lot. Chosen before the numbers. */}
              {costChanged(picked, unitCost) && createPriceVariant ? (
                <div className="mt-2 rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {tr('batch_auto_new_unlocked', 'A new batch is created automatically for unlocked pricing.')}
                </div>
              ) : (
                <div className="mt-2">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('batch', 'Batch')}</span>
                  {batchLoading ? (
                    <div className="text-[11px] text-gray-400">{tr('loading', 'Loading...')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button"
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                        onClick={() => setBatchChoice('new')}>
                        {tr('new_batch', '+ New batch')}
                      </button>
                      {batchOptions.map((batch) => (
                        <button key={batch.id} type="button"
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === Number(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                          onClick={() => setBatchChoice(Number(batch.id))}>
                          {batchDisplayLabel(batch, tr('batch', 'Batch'))} ({batch.quantity})
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Preview only -- the backend recomputes the authoritative
                      code from whichever date is actually submitted. */}
                  <span className="mt-1 block text-[11px] text-gray-400">
                    {batchChoice === 'new'
                      ? `${tr('batch_code_preview', 'Batch code')}: ${dateToBatchCode(receivedDate) || '--'}`
                      : tr('existing_lot_keeps_date', 'Tops up the selected lot — its received date stays.')}
                  </span>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[5rem_6rem_8rem_1fr] sm:items-end">
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</span><input type="number" min="1" step="1" className="input text-center text-sm" value={quantity} onChange={(event) => setQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addLine() }} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('unit_cost_usd', 'Unit cost $')}</span><input type="number" min="0" step="0.01" className="input text-sm" value={unitCost} onChange={(event) => {
                  const next = event.target.value
                  setUnitCost(next)
                  setCreatePriceVariant(costChanged(picked, next))
                }} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_optional', 'Expiry (optional)')}</span><DateEntryInput className="text-sm" t={packLookup} ariaLabel={tr('expiry_optional', 'Expiry (optional)')} value={expiryDate} onChange={(iso) => setExpiryDate(iso)} /></label>
                <div className="flex min-w-0 items-end gap-1.5">
                  <span className="mb-2 whitespace-nowrap text-[10px] tabular-nums text-gray-500 sm:text-[11px]">{tr('total_cost', 'Total cost')}: ${(Math.max(0, Number(quantity) || 0) * Math.max(0, Number(unitCost) || 0)).toFixed(2)}</span>
                </div>
                {costChanged(picked, unitCost) ? (
                  <label className="col-span-2 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-4 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={createPriceVariant} onChange={(event) => setCreatePriceVariant(event.target.checked)} />
                    <span><strong>{tr('create_price_variant', 'Create/use a price variant')}</strong><br />{tr('create_price_variant_hint', `The cost changed from $${currentCost(picked).toFixed(2)} to $${Number(unitCost || 0).toFixed(2)}. Keep this on a separate product row with the same name and details.`)}</span>
                  </label>
                ) : null}
              </div>
              {/* Its own row: this queues a line, Complete in the footer is
                  what writes. Sharing a grid cell with the running total made
                  it read as a field decoration rather than an action. */}
              <div className="mt-2 flex items-center justify-end">
                <button type="button" className="btn-primary h-10 shrink-0 px-3 text-xs disabled:opacity-50" disabled={saving} onClick={addLine}>
                  {editingKey ? tr('update_line', 'Update line') : `＋ ${tr('fast_stockin_add', 'Add & next')}`}
                </button>
              </div>
              </>
            ) : null}
          </div>

          {/* shipment header -- once */}
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('fast_stockin_header', 'This shipment (applies to every line)')}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('branch', 'Branch')}</span>
                <AppSelect
                  value={branchId}
                  onChange={(next) => setBranchId(next)}
                  ariaLabel={tr('branch', 'Branch')}
                  buttonClassName="h-9 w-full text-sm"
                  optionClassName="text-sm"
                  options={branchOptions}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
                <DateEntryInput className="h-9 w-full text-sm" t={packLookup} ariaLabel={tr('received_date', 'Received date')} value={receivedDate} onChange={(iso) => setReceivedDate(iso)} />
              </label>
              <div className="col-span-2"><SupplierPickerField
                value={supplier}
                onChange={setSupplier}
                tr={tr}
                idPrefix="fast-stockin"
                hint={tr('fast_stockin_supplier_hint', 'Recorded on every lot this session receives (first attribution sticks).')}
                hintDisplay="tooltip"
              /></div>
              <div className="col-span-2 sm:col-span-4">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('payment', 'Payment')}</span>
                <div className="flex gap-1.5">
                  {(['paid', 'credit'] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setPaymentStatus(mode)}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${paymentStatus === mode
                        ? 'border-blue-500 bg-blue-100/70 font-semibold text-blue-700 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                      {mode === 'paid' ? tr('paid', 'Paid') : tr('on_credit', 'On credit')}
                    </button>
                  ))}
                  {paymentStatus === 'credit' ? (
                    <DateEntryInput className="flex-1 text-sm" t={packLookup} ariaLabel={tr('due', 'due')} value={creditDueDate} onChange={(iso) => setCreditDueDate(iso)} />
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* what landed */}
          {received.length > 0 ? (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <span>{tr('fast_stockin_received', 'Received this session')} ({successCount})</span>
                <span className="shrink-0 tabular-nums normal-case">{tr('total_cost', 'Total cost')}: ${sessionCostTotal.toFixed(2)}</span>
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {received.map((line) => (
                  <div key={line.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900/50">
                    <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                      {line.status === 'saved' ? '✅' : line.status === 'error' ? '⚠️' : line.status === 'saving' ? '⏳' : '•'} {line.productName} × {line.quantity} · {line.batchLabel}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                      {/* A server error reason wraps rather than being squeezed
                          out -- never a dead-end ellipsis on the only
                          explanation a failed line gets. */}
                      <span className={`break-words text-[10px] ${line.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>{line.detail}</span>
                      {line.status !== 'saved' ? <button type="button" disabled={saving} onClick={() => editLine(line)} className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-blue-600 dark:hover:bg-gray-700" aria-label={tr('edit', 'Edit')}><Pencil className="h-3.5 w-3.5" /></button> : null}
                      {line.status !== 'saved' ? <button type="button" disabled={saving} onClick={() => removeLine(line.key)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" aria-label={tr('remove', 'Remove')}><Trash2 className="h-3.5 w-3.5" /></button> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

        </div>

        {/* A plain footer after the modal-scroll body is already pinned: the
            panel is flex-col and the body carries flex-1 with min-height 0.
            One commit control at every breakpoint, so Complete never scrolls
            out of reach behind a long queue. */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            {received.length} {tr('lines_queued', 'queued')} · ${sessionCostTotal.toFixed(2)}
          </span>
          <button type="button" tabIndex={-1}
            title={tr('add_next_hint', 'Add & next queues this line; nothing is written until Complete.')}
            aria-label={tr('add_next_hint', 'Add & next queues this line; nothing is written until Complete.')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-400 dark:border-gray-600 dark:text-gray-500">i</button>
          <button type="button" className="btn-primary ml-auto flex h-10 w-fit max-w-full items-center text-sm" disabled={saving || !received.length} onClick={commitSession}>
            {saving ? `⏳ ${tr('saving_label', 'Saving…')}` : `✓ ${tr('complete_stock_session', 'Complete stock-in session')}`}{successCount > 0 ? ` — ${successCount} ${tr('lines_received', 'line(s) received')}` : ''}
          </button>
        </div>
      </div>

      {pendingCommit ? (
        <ConfirmDialog
          title={tr('complete_stock_session', 'Complete stock-in session')}
          message={tr('confirm_complete_stock_session', 'Receive {lines} product line(s), {units} total unit(s), into {branch}?')
            .replace('{lines}', String(pendingCommit.length))
            .replace('{units}', String(pendingCommit.reduce((total, line) => total + line.quantity, 0)))
            .replace('{branch}', commitBranchName)}
          items={commitReviewItems}
          note={tr('confirm_complete_stock_session_note', 'This posts stock movements and creates or updates the related lots.')}
          confirmLabel={tr('complete_stock_session', 'Complete stock-in session')}
          working={saving}
          workingLabel={tr('saving_label', 'Saving…')}
          onConfirm={() => void performCommit(pendingCommit)}
          onClose={() => { if (!saving) setPendingCommit(null) }}
          t={(key: string) => tr(key, key)}
        />
      ) : null}

      {selectedGroup ? (
        <Modal title={selectedGroup.name} onClose={closeCandidateOptions} size="md" layer="nested" unsavedChanges="read-only">
          <div className="space-y-3">
            <button type="button" className="btn-secondary h-10 px-3 text-sm" onClick={closeCandidateOptions}>← {tr('back', 'Back')}</button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(selectedGroup.sellableItems.length ? selectedGroup.sellableItems : selectedGroup.items).map((candidate) => (
                <button key={String(candidate.id)} type="button" onClick={() => pickFromGroup(candidate as ProductCandidate)} className="min-h-14 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:bg-blue-950/20">
                  <span className="block font-medium text-gray-800 dark:text-gray-200">{String(candidate.name || selectedGroup.name)}</span>
                  <span className="block font-mono text-[11px] text-gray-500">{String(candidate.barcode || tr('no_barcode', 'No barcode'))}</span>
                  <span className="block text-[11px] text-gray-500">{tr('quantity', 'Quantity')}: {Number(candidate.stock_quantity) || 0} · {tr('unit_cost_usd', 'Unit cost')}: ${currentCost(candidate as ProductCandidate).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>,
    document.body,
  )
}

function currentCost(product: ProductCandidate): number {
  return Number(product.cost_price_usd ?? product.purchase_price_usd ?? 0) || 0
}

function costChanged(product: ProductCandidate, next: string): boolean {
  if (next.trim() === '' || !Number.isFinite(Number(next))) return false
  return Math.round(currentCost(product) * 100) !== Math.round(Number(next) * 100)
}

function pricingForVariant(product: ProductCandidate, costUsd: number): Record<string, unknown> {
  return {
    selling_price_usd: Number(product.selling_price_usd) || 0,
    selling_price_khr: Number(product.selling_price_khr) || 0,
    wholesale_price_usd: Number(product.wholesale_price_usd) || 0,
    wholesale_price_khr: Number(product.wholesale_price_khr) || 0,
    discount_enabled: Boolean(product.discount_enabled),
    discount_type: product.discount_type || 'percent',
    discount_percent: Number(product.discount_percent) || 0,
    discount_amount_usd: Number(product.discount_amount_usd) || 0,
    cost_usd: costUsd,
    cost_khr: Number(product.cost_price_khr ?? product.purchase_price_khr ?? 0) || 0,
    barcode: product.barcode || null,
  }
}
