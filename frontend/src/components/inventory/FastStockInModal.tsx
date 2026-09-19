// F2 (Part 419): fast stock-in -- one shipment's header (branch, received
// date, supplier, paid/credit) entered ONCE, then rapid per-product lines:
// type a name, pick the row, quantity/cost/expiry, and queue it. Queued
// lines remain editable/removable until Complete writes them through the
// same receiveBatchStock kernel used by every other add-stock surface.
// Each outcome stays visible, so a partial failure can be fixed and retried.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../AppContext'
import { canEditAcquisitionCosts, canViewAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import { useProtectedCostEntry } from '../../utils/useProtectedCostEntry.ts'
import X from 'lucide-react/dist/esm/icons/x.js'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect from '../shared/AppSelect.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import { receiveBatchStock, getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { adjustStock, commitFastStockIn, type FastStockInCommitLine, type FastStockInCommitLineResult } from '../../api/inventoryWriteTransport.ts'
import StockConditionTagRow from './StockConditionTagRow'
import { searchProducts } from '../../api/methods.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft, flushPendingWorkDraft, writeWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { batchDisplayLabel, lotCodeAsDate } from '../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { buildProductGroups, type ProductGroup, type ProductRecord } from '../../utils/productGrouping.ts'
import ProductOptionSheet from '../shared/ProductOptionSheet.tsx'
import { stockReceiptGateCode, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS } from '../../utils/stockReceiptFields.ts'
import InfoHint from '../shared/InfoHint.tsx'
import StockReasonField from '../shared/StockReasonField.tsx'
import { useSavedStockReasons } from '../../utils/useSavedStockReasons.ts'
import { stockLineReason } from '../../utils/stockLineReason.ts'
import { findSessionProductDuplicate } from '../../utils/createProductsSession.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import { stableSnapshot } from '../../utils/formDirty.ts'

// Keep product creation inside this receiving flow rather than sending the
// operator to a separate page. The standard ProductForm and create transport
// remain the only product-writing path; this modal only keeps the shipment
// draft alive around that existing flow.
const ProductForm = lazyRetry(() => import('../products/forms/ProductForm'), 'fast-stock-in-create-product-form')

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

// N27 (2026-09-06): the one stock-change entry point. The owner asked for the
// one-by-one Add / Remove / Set modal to be folded into this flow -- "remove
// the one by one add and do fast stock in... keep the enter and able to
// choose to switch option remove and set". The mode is chosen once, frozen
// onto each queued line, and honoured by the write: add goes through the
// batch-receipt kernel as before; remove and set go through POST
// /api/inventory/adjust exactly as the one-by-one modal did (a set is
// converted server-side into the add or remove of the difference).
export type StockMode = 'add' | 'remove' | 'set'

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
  // N14-D: frozen with the line, like everything else here -- the declaration
  // belongs to THIS receipt, not to whatever the form shows when it commits.
  freeGoods: boolean
  createPriceVariant: boolean
  expiryDate: string
  // The lot this line lands in, frozen when it was queued. 'new' means
  // create-or-match by the shipment date; a number tops up that exact lot.
  // Frozen because the picker below re-fetches per product/branch, so the
  // live batchChoice no longer describes a line once the next one starts.
  batchChoice: 'new' | number
  batchLabel: string
  // N27: frozen with the line -- the switch may move on to the next line.
  mode: StockMode
  // P3-L2: the operator's reason, frozen with the line and written to its
  // movement exactly as typed. Blank -> stockLineReason() supplies the
  // session label the write path carried before (N27 hardcoded it).
  reason: string
  // P3-L6: frozen with the line for the same reason. '' is the untagged
  // default; a tag makes a remove KEEP the units in the product group as a
  // non-sellable tagged row, and makes an add receive straight into that row
  // ("Restock with tag") while still recording the supplier purchase.
  conditionTag: string
  // True when THIS session created the product (scan -> create), so the queue
  // can tag New / Existing the way the session receipt does.
  createdProduct: boolean
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
  // N27: which way the switch starts (the Adjust menu's Add / Remove /
  // Adjust quantity entries). A saved draft's own mode wins over it.
  initialMode?: StockMode
  exchangeRate?: number
}

// F3 slice 1: the batch-in flow persists like add-product does -- the
// shipment header, in-progress line, and queued lines survive navigation/
// reload via the shared store.

type FastStockInDraft = {
  sessionId?: number
  mode?: StockMode
  conditionTag?: string
  createdProductIds?: string[]
  branchId: string
  receivedDate: string
  supplier: SupplierChoice
  paymentStatus: 'paid' | 'credit'
  creditDueDate: string
  query: string
  picked: ProductCandidate | null
  quantity: string
  unitCost: string
  freeGoods?: boolean
  createPriceVariant?: boolean
  expiryDate: string
  reason?: string
  batchChoice?: 'new' | number
  lines?: ReceivedLine[]
  // Only set by a camera/scan-button result. Typed text must not turn every
  // empty suggestion list into a prompt to create a new catalog record.
  scannedBarcode?: string
}

type FastStockInCloseState = Pick<FastStockInDraft,
  'mode' | 'conditionTag' | 'createdProductIds' | 'branchId' | 'receivedDate' | 'supplier' |
  'paymentStatus' | 'creditDueDate' | 'query' | 'picked' | 'quantity' |
  'unitCost' | 'freeGoods' | 'createPriceVariant' | 'expiryDate' | 'reason' | 'batchChoice' |
  'lines' | 'scannedBarcode'>

export function fastStockInHasUnsavedWork(current: FastStockInCloseState, pristine: FastStockInCloseState): boolean {
  return stableSnapshot(current) !== stableSnapshot(pristine)
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

export default function FastStockInModal({ branchOptions, defaultBranchId, tr, notify, onClose, onDone, onMinimize, initialHeader, initialMode, exchangeRate = 4100 }: FastStockInModalProps) {
  const { user } = useApp() as { user: any }
  const canViewCosts = canViewAcquisitionCosts(user)
  const canEditCosts = canEditAcquisitionCosts(user)
  // This modal only receives the fallback-aware tr(); DateEntryInput wants a
  // bare pack lookup, so adapt rather than duplicate its strings.
  const packLookup = (key: string): string | undefined => tr(key, '') || undefined
  const fastStockInDraftKey = scopedWorkDraftKey('fast_stockin')
  // ---- shipment header (entered once, applies to every line) ----
  const draftRef = useRef<FastStockInDraft | null>(readWorkDraft<FastStockInDraft>(fastStockInDraftKey)?.data ?? null)
  const draft = draftRef.current
  const pristineCloseStateRef = useRef<FastStockInCloseState>({
    mode: initialMode || 'add',
    conditionTag: '',
    createdProductIds: [],
    branchId: String(initialHeader?.branchId || (defaultBranchId != null ? defaultBranchId : (branchOptions[0]?.value || ''))),
    receivedDate: initialHeader?.receivedDate || todayStr(),
    supplier: initialHeader?.supplier || { supplierId: null, supplierName: '' },
    paymentStatus: initialHeader?.paymentStatus || 'paid',
    creditDueDate: initialHeader?.creditDueDate || '',
    query: '',
    picked: null,
    quantity: '1',
    unitCost: '',
    freeGoods: false,
    createPriceVariant: false,
    expiryDate: '',
    reason: '',
    batchChoice: 'new',
    lines: [],
    scannedBarcode: '',
  })
  const [branchId, setBranchId] = useState<string>(draft?.branchId || initialHeader?.branchId || (defaultBranchId != null ? String(defaultBranchId) : (branchOptions[0]?.value || '')))
  // Received date defaults to TODAY (business day) rather than empty (user,
  // Sep 3 2026): nearly every fast stock-in is for stock that just arrived,
  // so the date the batch code derives from should already be filled in and
  // the cashier only edits it for a late-entered delivery.
  const [receivedDate, setReceivedDate] = useState<string>(draft?.receivedDate || initialHeader?.receivedDate || todayStr())
  const [supplier, setSupplier] = useState<SupplierChoice>(draft?.supplier || initialHeader?.supplier || { supplierId: null, supplierName: '' })
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>(draft?.paymentStatus || initialHeader?.paymentStatus || 'paid')
  const [creditDueDate, setCreditDueDate] = useState(draft?.creditDueDate || initialHeader?.creditDueDate || '')
  // N27: add / remove / set. Per line once queued; this is the switch for the
  // NEXT line.
  const [mode, setMode] = useState<StockMode>(draft?.mode || initialMode || 'add')
  const [conditionTag, setConditionTag] = useState<string>(draft?.conditionTag || '')
  // Products this session created (scan -> Create product), so the queue can
  // say New / Existing with certainty rather than guessing.
  const [createdProductIds, setCreatedProductIds] = useState<string[]>(draft?.createdProductIds || [])

  // ---- per-line entry ----
  const [query, setQuery] = useState(draft?.query || '')
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null)
  const [picked, setPicked] = useState<ProductCandidate | null>(draft?.picked || null)
  const [quantity, setQuantity] = useState(draft?.quantity || '1')
  const [protectedUnitCost, setProtectedUnitCost] = useState(draft?.unitCost || '')
  const [protectedFreeGoods, setProtectedFreeGoods] = useState(Boolean(draft?.freeGoods))
  const costEntry = useProtectedCostEntry(user?.id, picked?.id, canViewCosts, canEditCosts)
  const unitCost = String(costEntry.value('unitCost', protectedUnitCost, ''))
  const freeGoods = Boolean(costEntry.value('freeGoods', protectedFreeGoods, false))
  const setUnitCost = (next: string) => { costEntry.write('unitCost', next); setProtectedUnitCost(next) }
  const setFreeGoods = (next: boolean) => { costEntry.write('freeGoods', next); setProtectedFreeGoods(next) }
  // Retain the persisted field for draft compatibility, but receipt prices
  // never request a separate product, including old price-variant drafts.
  const [createPriceVariant, setCreatePriceVariant] = useState(false)
  const [expiryDate, setExpiryDate] = useState(draft?.expiryDate || '')
  // P3-L2: sticky across lines like the mode switch -- a damaged-goods removal
  // of five products is typed once. Frozen onto each line as it queues.
  const [reason, setReason] = useState(draft?.reason || '')
  // The same saved-reason catalog the adjust form offers (type 'adjust'); a
  // failed read leaves the free-text box, never blocks a line.
  const savedReasons = useSavedStockReasons()
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
  // A draft saved before the mode switch existed holds add lines that never
  // recorded a mode; they stay adds rather than reading as 'changes'.
  const [received, setReceived] = useState<ReceivedLine[]>(() => (draft?.lines || []).map((line) => ({ ...line, mode: line.mode || 'add', reason: line.reason || '', conditionTag: line.conditionTag || '', createdProduct: Boolean(line.createdProduct) })))
  const [editingKey, setEditingKey] = useState('')
  const duplicateRows = useMemo(() => received.map((line) => ({
    ...line,
    name: line.productName,
    barcode: line.product.barcode,
  })), [received])
  // Set by editLine, consumed by the lot-options effect once that product's
  // lots have loaded. Without it the effect's own setBatchChoice('new') wins
  // the race and the reopened line loses the lot it was queued against.
  const pendingBatchRestoreRef = useRef<'new' | number | null>(draft?.batchChoice ?? null)
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
  // The rows the option sheet actually offers for the open group.
  const selectedGroupChoices = useMemo(
    () => (selectedGroup ? (selectedGroup.sellableItems.length ? selectedGroup.sellableItems : selectedGroup.items) : []),
    [selectedGroup],
  )

  // Autosave the header + in-progress line (debounced, shared cadence).
  // Deliberately NO dirtyWork registration: with the draft persisting,
  // leaving is SAFE -- everything is exactly here on reopen -- so the
  // three-option navigation guard would only nag about work that cannot
  // be lost.
  useEffect(() => {
    return scheduleWorkDraftWrite<FastStockInDraft>(fastStockInDraftKey, {
      sessionId: sessionIdRef.current, mode, conditionTag, createdProductIds,
      branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost: protectedUnitCost, freeGoods: protectedFreeGoods, createPriceVariant, expiryDate, reason, batchChoice, lines: received, scannedBarcode,
    })
  }, [branchId, receivedDate, supplier, paymentStatus, creditDueDate, query, picked, quantity, protectedUnitCost, protectedFreeGoods, createPriceVariant, expiryDate, reason, batchChoice, received, scannedBarcode, mode, conditionTag, createdProductIds])

  useEffect(() => {
    const text = query.trim()
    setSearchCompleteFor('')
    if (picked || selectedGroup || text.length < 2) { setCandidates([]); return }
    const seq = ++searchSeqRef.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: text, pageSize: 8, surface: 'inventory' }) as { items?: ProductCandidate[] }
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

  // The refusal the Add button would produce, read from the SAME kernel that
  // produces it (stockReceiptGateCode, below in addLine) rather than a second
  // hand-written condition that can drift away from it. A primary control that
  // cannot proceed must say why, next to itself, before the click -- a catalog
  // cost prefetched as 0 otherwise makes the default Add path a guaranteed
  // refusal with nothing on screen pointing at the box that clears it.
  const pendingReceiptGate = mode === 'add' ? stockReceiptGateCode({
    isStockIn: true,
    supplierName: supplier.supplierName,
    unitCostUsd: unitCost,
    freeGoods,
  }) : ''
  const zeroCostNeedsDeclaration = pendingReceiptGate === 'free_goods_required'

  const pick = (candidate: ProductCandidate) => {
    const duplicate = findSessionProductDuplicate(duplicateRows, candidate, editingKey)
    if (duplicate) {
      notify(tr('create_products_session_duplicate', 'Duplicate: You added this item already.'), 'error')
      if (duplicate.row.status !== 'saved') editLine(duplicate.row)
      return
    }
    setPicked(candidate)
    setCandidates([])
    setQuery(String(candidate.name || ''))
    // A catalog cost of zero is a known value (free goods), not an unknown
    // value. Keep the canonical cost field first, with the legacy purchase
    // field as a compatibility fallback for older products.
    const rawCost = candidate.cost_price_usd != null
      ? candidate.cost_price_usd
      : candidate.purchase_price_usd
    const cost = Number(rawCost)
    if (canViewCosts && rawCost != null && Number.isFinite(cost) && cost >= 0) setUnitCost(String(cost))
    else setUnitCost('')
    setCreatePriceVariant(false)
    setScannedBarcode('')
  }

  function closeCandidateOptions() {
    setSelectedGroup(null)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const pickFromGroup = (candidate: ProductCandidate, selection?: { branchId?: string | null }) => {
    pick(candidate)
    // The branch the sheet resolved is the one whose count the operator was
    // reading; carry it onto the line rather than silently re-deriving one.
    if (selection?.branchId != null) setBranchId(String(selection.branchId))
    closeCandidateOptions()
  }

  const resetLine = () => {
    setPicked(null)
    setQuery('')
    setQuantity('1')
    setUnitCost('')
    setFreeGoods(false)
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
      mode, conditionTag, createdProductIds, branchId, receivedDate, supplier, paymentStatus, creditDueDate,
      query, picked, quantity, unitCost: protectedUnitCost, freeGoods: protectedFreeGoods, createPriceVariant, expiryDate, reason, batchChoice, lines: received, scannedBarcode,
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
    setCreatedProductIds((prev) => [...prev, String(productId)])
    const created: ProductCandidate = {
      ...(item || {}),
      ...payload,
      id: productId,
      name: String(item?.name || payload.name || ''),
      barcode: String(item?.barcode || createBarcode),
    }
    pick(created)
    notify(tr('product_created_continue_stockin', 'Product created. Continue adding it to this stock-in session.'))
  }

  const addLine = () => {
    if (saving) return
    const rawQuantity = quantity.trim()
    const qty = Math.floor(Number(rawQuantity)) || 0
    if (!picked) { notify(tr('fast_stockin_pick_product', 'Pick a product first'), 'error'); return }
    const duplicate = findSessionProductDuplicate(duplicateRows, picked, editingKey)
    if (duplicate) {
      notify(tr('create_products_session_duplicate', 'Duplicate: You added this item already.'), 'error')
      if (duplicate.row.status !== 'saved') editLine(duplicate.row)
      return
    }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    // N27: an add and a remove are MOVEMENTS -- zero moves nothing. A set is a
    // TARGET, and zero is a number an operator counts: the last one sold, a
    // branch being emptied. The route enforces the same split
    // (routes/inventory.ts: `type === 'set' ? !(quantity >= 0) : !(quantity > 0)`),
    // so this is the same rule read early, not a second one.
    if (qty <= 0 && mode !== 'set') { notify(tr('fast_stockin_qty', 'Quantity must be at least 1'), 'error'); return }
    // An empty box must not queue "set to 0" by accident -- `Number('')` is 0 --
    // and a branch cannot hold less than nothing.
    if (mode === 'set' && (!rawQuantity || qty < 0)) { notify(tr('fast_stockin_set_qty', 'Quantity must be 0 or more'), 'error'); return }
    // A remove has no receipt: no payment, no supplier, no cost to check.
    if (canEditCosts && mode !== 'remove' && paymentStatus === 'credit' && !creditDueDate.trim()) {
      notify(tr('fast_stockin_credit_due', 'Not Yet Paid stock needs a due date'), 'error')
      return
    }
    // N14-D: the same rule POST /api/batches and /api/inventory/adjust enforce
    // (cloudflare/src/lib/stockReceiptGate.ts), checked as the line is queued
    // so a whole session is not typed up before the first refusal. Adds only:
    // a set's direction (and therefore whether it is a receipt) is decided
    // server-side against live stock, and the route gates it there.
    if (mode === 'add') {
      if (!canEditCosts) { notify(tr('product_cost_edit_required', 'Cost edit permission is required to receive stock.'), 'error'); return }
      const receiptGate = stockReceiptGateCode({
        isStockIn: true,
        supplierName: supplier.supplierName,
        unitCostUsd: unitCost,
        freeGoods,
      })
      if (receiptGate) {
        notify(tr(STOCK_RECEIPT_GATE_KEYS[receiptGate], STOCK_RECEIPT_GATE_FALLBACKS[receiptGate]), 'error')
        return
      }
    }
    const lineName = String(picked.name || `#${picked.id}`)
    // A set targets the branch total, not a lot; the server posts the
    // difference itself.
    const effectiveBatchChoice: 'new' | number = mode === 'set' ? 'new' : batchChoice
    const chosenLot = typeof effectiveBatchChoice === 'number'
      ? batchOptions.find((batch) => Number(batch.id) === effectiveBatchChoice)
      : null
    const next: ReceivedLine = {
        key: editingKey || `${picked.id}-${Date.now()}`,
        product: picked,
        productName: lineName,
        quantity: qty,
        unitCost: mode === 'remove' ? '' : unitCost,
        freeGoods: mode === 'remove' ? false : freeGoods,
        createPriceVariant: false,
        expiryDate: mode === 'remove' ? '' : expiryDate,
        batchChoice: effectiveBatchChoice,
        batchLabel: chosenLot
          ? batchDisplayLabel(chosenLot, tr('batch', 'Received date'))
          : mode === 'remove'
            ? tr('fast_stock_auto_lot', 'Oldest received dates first')
            : mode === 'set'
              ? (branchOptions.find((option) => String(option.value) === String(branchId))?.label || tr('branch', 'Branch'))
              : tr('new_batch', '+ New received date'),
        mode,
        reason: reason.trim(),
        conditionTag: mode === 'set' ? '' : conditionTag,
        createdProduct: createdProductIds.includes(String(picked.id)),
        status: 'queued',
        detail: tr('ready_to_receive', 'Ready'),
    }
    setReceived((prev) => editingKey
      ? prev.map((line) => line.key === editingKey ? next : line)
      : [next, ...prev])
    setEditingKey('')
    resetLine()
  }

  function editLine(line: ReceivedLine) {
    if (saving || line.status === 'saved') return
    setEditingKey(line.key)
    setMode(line.mode)
    setConditionTag(line.conditionTag || '')
    setPicked(line.product)
    setQuery(line.productName)
    setQuantity(String(line.quantity))
    setUnitCost(canViewCosts ? line.unitCost : '')
    setFreeGoods(canViewCosts && line.freeGoods)
    setCreatePriceVariant(false)
    setExpiryDate(line.expiryDate)
    setReason(line.reason)
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
    if (!canEditCosts && pending.some((line) => line.mode === 'add')) { notify(tr('product_cost_edit_required', 'Cost edit permission is required to receive stock.'), 'error'); return }
    if (!pending.length) {
      if (received.some((line) => line.status === 'saved')) onDone()
      clearWorkDraft(fastStockInDraftKey)
      onClose()
      return
    }
    if (!branchId) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (canEditCosts && pending.some((line) => line.mode !== 'remove') && paymentStatus === 'credit' && !creditDueDate.trim()) { notify(tr('fast_stockin_credit_due', 'Not Yet Paid stock needs a due date'), 'error'); return }
    setPendingCommit(pending)
  }

  // N27: the mode frozen on the line decides the write. Remove and set take
  // the same POST /api/inventory/adjust the one-by-one modal used, carrying
  // this session id so the ledger groups them with the rest. P3-L6 "Restock
  // with tag": the ordinary add wire is POST /api/batches (receiveBatchStock);
  // the tagged one is POST /api/inventory/adjust, because that is the single
  // writer that receives the purchase AND holds the units as a tagged row in
  // one request. Split out from performCommit (P4-B) so the SAME per-line
  // body this function builds can go either through one batched
  // POST /api/inventory/fast-stock-in/commit request or, on a 404 fallback,
  // through the original adjustStock / receiveBatchStock transports -- one
  // source of the wire/body shape, not two that can drift apart.
  const buildLineRequest = (line: ReceivedLine): FastStockInCommitLine => {
    if (line.mode === 'remove') {
      return { key: line.key, wire: 'adjust', body: {
        productId: Number(line.product.id), type: 'remove', quantity: line.quantity,
        // P3-L6: a tagged removal keeps the units in the group.
        conditionTag: line.conditionTag || undefined,
        reason: stockLineReason(line, tr), branchId: Number(branchId),
        // A chosen lot is drained by id; otherwise the oldest lots first.
        batchId: typeof line.batchChoice === 'number' ? line.batchChoice : null,
        sessionId: sessionIdRef.current,
      } }
    }
    if (line.mode === 'set') {
      return { key: line.key, wire: 'adjust', body: {
        productId: Number(line.product.id), type: 'set', quantity: line.quantity,
        reason: stockLineReason(line, tr), branchId: Number(branchId),
        // Receipt fields ride along: a set that RAISES stock is an add
        // server-side and is gated like one; a set that lowers it ignores them.
        receivedDate: receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
        supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
        ...(canEditCosts ? { unitCostUsd: Number(line.unitCost) >= 0 && line.unitCost !== '' ? Number(line.unitCost) : null } : {}),
        freeGoods: line.freeGoods, paymentStatus,
        creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
        sessionId: sessionIdRef.current,
      } }
    }
    if (line.mode === 'add' && line.conditionTag) {
      return { key: line.key, wire: 'adjust', body: {
        productId: Number(line.product.id), type: 'add', quantity: line.quantity,
        reason: stockLineReason(line, tr), branchId: Number(branchId),
        conditionTag: line.conditionTag,
        batchId: typeof line.batchChoice === 'number' ? line.batchChoice : null,
        receivedDate: receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
        supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
        unitCostUsd: Number(line.unitCost) >= 0 && line.unitCost !== '' ? Number(line.unitCost) : null,
        freeGoods: line.freeGoods, paymentStatus,
        creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
        sessionId: sessionIdRef.current,
      } }
    }
    return { key: line.key, wire: 'receive', body: {
      productId: Number(line.product.id), branchId: Number(branchId), quantity: line.quantity,
      // Same two-line rule as ReceiveBatchModal: a chosen lot is topped up by
      // id and keeps its own received date; only 'new' derives a lot code
      // from this shipment's date.
      batchId: typeof line.batchChoice === 'number' ? line.batchChoice : null,
      receivedDate: line.batchChoice === 'new' ? (receivedDate.trim() || null) : null,
      expiryDate: line.expiryDate.trim() || null,
      supplierId: supplier.supplierId, supplierName: supplier.supplierName.trim() || null,
      unitCostUsd: Number(line.unitCost) >= 0 && line.unitCost !== '' ? Number(line.unitCost) : null,
      freeGoods: line.freeGoods,
      // Typed text or null: a blank line keeps the Worker's own "Stock
      // received (<lot>)" label (see utils/stockLineReason.ts).
      reason: line.reason.trim() || null,
      paymentStatus, creditDueDate: paymentStatus === 'credit' ? creditDueDate.trim() : null,
      sessionId: sessionIdRef.current,
    } }
  }

  const describeLineResult = (line: ReceivedLine, result?: { lotCode?: string | null } | null): string => (
    line.mode === 'remove'
      ? tr('stock_line_removed', 'Removed')
      : line.mode === 'set'
      ? tr('stock_line_set', 'Set')
      : result?.lotCode
      // Z1a: the server hands back an MMDDYYYY lot code; show it as the
      // received date it encodes, not as a raw 8-digit run.
      ? `${tr('received_date', 'Received date')} ${lotCodeAsDate(result.lotCode) || result.lotCode}`
      : tr('received', 'Received')
  )

  // Fallback path: one POST per line, exactly as before P4-B. Reached only
  // when the batched endpoint answers 404 (an old Worker build still live
  // during a rolling deploy) -- receiveBatchStock and adjustStock are the
  // same two transports the batched route's Worker-side kernels wrap, so a
  // stale client and a stale server both keep working against each other.
  const performCommitSequential = async (pending: ReceivedLine[]): Promise<number> => {
    let failed = 0
    for (const line of pending) {
      setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saving' } : item))
      const request = buildLineRequest(line)
      try {
        const result = request.wire === 'adjust'
          ? await adjustStock(request.body) as { lotCode?: string | null } | null
          : await receiveBatchStock(request.body)
        setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saved', detail: describeLineResult(line, result) } : item))
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : tr('error', 'Error')
        setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'error', detail: message } : item))
      }
    }
    return failed
  }

  const performCommit = async (pending: ReceivedLine[]) => {
    if (saving) return
    if (!canEditCosts && pending.some((line) => line.mode === 'add')) { notify(tr('product_cost_edit_required', 'Cost edit permission is required to receive stock.'), 'error'); return }
    setSaving(true)
    pending.forEach((line) => setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saving' } : item)))
    let failed = 0
    // P4-B: one request for the whole session instead of one per line (see
    // cloudflare/src/routes/stockInCommit.ts). `batched` stays null only when
    // the endpoint 404s (old Worker build); any other failure of the request
    // itself -- network/5xx -- fails every still-saving line with that one
    // message rather than retrying the old N-request loop, which would just
    // fail the same way N times.
    let batched: FastStockInCommitLineResult[] | null = null
    try {
      batched = await commitFastStockIn(pending.map(buildLineRequest))
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('error', 'Error')
      failed = pending.length
      setReceived((prev) => prev.map((item) => pending.some((line) => line.key === item.key) ? { ...item, status: 'error', detail: message } : item))
      batched = []
    }
    if (batched === null) {
      // The deployed Worker predates POST /api/inventory/fast-stock-in/commit.
      failed = await performCommitSequential(pending)
    } else if (batched.length > 0) {
      pending.forEach((line, index) => {
        const result = batched![index]
        if (result?.ok) {
          setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'saved', detail: describeLineResult(line, result as { lotCode?: string | null }) } : item))
        } else {
          failed += 1
          const message = result?.error || tr('error', 'Error')
          setReceived((prev) => prev.map((item) => item.key === line.key ? { ...item, status: 'error', detail: message } : item))
        }
      })
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
  const modeCount = (lines: ReceivedLine[], which: StockMode) => lines.filter((line) => line.mode === which).length
  const pendingAllAdd = pendingCommit ? modeCount(pendingCommit, 'add') === pendingCommit.length : true
  // The shipment fields (date, supplier, payment) belong to receipts; with the
  // switch on remove and nothing else queued they have nothing to describe.
  const receiptFieldsRelevant = mode !== 'remove' || received.some((line) => line.mode !== 'remove')
  const commitReviewItems: ConfirmReviewItem[] = pendingCommit ? [
    { label: tr('branch', 'Branch'), value: commitBranchName },
    { label: tr('lines', 'Lines'), value: pendingCommit.length },
    ...(pendingAllAdd ? [] : [
      { label: tr('add', 'Add'), value: modeCount(pendingCommit, 'add') },
      { label: tr('remove', 'Remove'), value: modeCount(pendingCommit, 'remove') },
      { label: tr('set', 'Set'), value: modeCount(pendingCommit, 'set') },
    ]),
    { label: tr('total_units', 'Total units'), value: pendingCommit.reduce((total, line) => total + line.quantity, 0) },
    ...(canViewCosts ? [{ label: tr('total_cost', 'Total cost'), value: `$${pendingCommit.reduce((total, line) => total + (line.mode === 'remove' ? 0 : Math.max(0, line.quantity) * Math.max(0, Number(line.unitCost) || 0)), 0).toFixed(2)}` }] : []),
    // Receipt fields describe adds (and sets, which may add); a pure
    // remove session has none to review.
    ...(pendingCommit.some((line) => line.mode !== 'remove') ? [
    { label: tr('received_date', 'Received date'), value: receivedDate.trim() || tr('today', 'Today') },
    { label: tr('supplier', 'Supplier'), value: supplier.supplierName.trim() || '—' },
    { label: tr('payment', 'Payment'), value: paymentStatus === 'credit'
      ? `${tr('on_credit', 'Not Yet Paid')}${creditDueDate.trim() ? ` · ${creditDueDate.trim()}` : ''}`
      : tr('paid', 'Paid') },
    ] : []),
  ] : []
  const sessionCostTotal = received.reduce((total, line) => (
    total + (line.mode === 'remove' ? 0 : Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.unitCost) || 0))
  ), 0)
  const closeState: FastStockInCloseState = {
    mode, conditionTag, createdProductIds, branchId, receivedDate, supplier, paymentStatus, creditDueDate,
    query, picked, quantity, unitCost: protectedUnitCost, freeGoods: protectedFreeGoods, createPriceVariant, expiryDate, reason, batchChoice,
    lines: received, scannedBarcode,
  }
  const closeDirty = fastStockInHasUnsavedWork(closeState, pristineCloseStateRef.current)
  // The minus is an explicit preserve action. It flushes the exact draft,
  // parks the chip, then unmounts. The X/backdrop are dismissal requests and
  // must never reuse this callback: dirty work goes through the shared
  // Discard / Back / Minimize prompt instead.
  const preserveAndMinimize = () => {
    if (saving || !onMinimize) return
    flushPendingWorkDraft(fastStockInDraftKey)
    onMinimize(tr('fast_stockin_title', 'Fast stock-in'))
    onClose()
  }
  const discardAndClose = () => {
    clearWorkDraft(fastStockInDraftKey)
    if (successCount > 0) onDone()
    onClose()
  }
  const closeGuard = useCloseGuard({ dirty: closeDirty }, discardAndClose, onMinimize ? preserveAndMinimize : undefined)
  const requestCloseIfIdle = () => { if (!saving) closeGuard.requestClose() }
  const closeBackdropIfIdle = () => { if (!selectedGroup) requestCloseIfIdle() }

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
          sessionDuplicateCheck={(candidate) => Boolean(findSessionProductDuplicate(duplicateRows, candidate))}
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
                onMinimize={preserveAndMinimize}
              />
            ) : null}
            <button type="button" onClick={requestCloseIfIdle} disabled={saving} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="modal-scroll space-y-4 p-4">
          {/* Search comes first on phones and desktops; shipment details sit below it. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-900/10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                {editingKey ? tr('edit_stock_line', 'Edit product line') : tr('fast_stockin_line', 'Next product')}
              </span>
              {/* N27: add / remove / set for the NEXT line; each queued line
                  keeps the mode it was queued with. */}
              <span className="flex items-center gap-1">
                <span className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-600" role="group" aria-label={tr('stock_action', 'Stock action')}>
                  {(['add', 'remove', 'set'] as const).map((option) => (
                    <button key={option} type="button" disabled={saving} aria-pressed={mode === option}
                      onClick={() => setMode(option)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${mode === option
                        ? option === 'remove' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : option === 'set' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                      {option === 'add' ? tr('add', 'Add') : option === 'remove' ? tr('remove', 'Remove') : tr('set', 'Set')}
                    </button>
                  ))}
                </span>
                <InfoHint label={tr('stock_action', 'Stock action')} text={tr('fast_stock_mode_hint', 'Add receives stock under a received date. Remove takes stock out — pick the received date, or the oldest received dates drain first. Set makes the branch total exactly this quantity; the difference posts as an add (supplier and cost required) or a remove.')} />
              </span>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input ref={searchInputRef} className="input w-full text-sm" placeholder={tr('fast_stockin_search', 'Type a product name or barcode…')} value={query}
                  onChange={(event) => { setQuery(event.target.value); setPicked(null); setEditingKey(''); setScannedBarcode('') }} autoFocus />
                {candidateGroups.length > 0 ? (
                  <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                    {candidateGroups.map((group) => (
                      <button key={group.key} type="button" onClick={() => setSelectedGroup(group)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        <span className="scroll-x-clean text-gray-800 dark:text-gray-200">{group.name}</span>
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
              {mode === 'set' ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  {tr('fast_stock_set_hint', 'Set makes the branch total exactly this quantity. The difference posts as an add (supplier and cost required) or a remove.')}
                </div>
              ) : (
                <div className="mt-2">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('batch', 'Received date')}</span>
                  {batchLoading ? (
                    <div className="text-[11px] text-gray-400">{tr('loading', 'Loading...')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button"
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                        onClick={() => setBatchChoice('new')}>
                        {mode === 'remove' ? tr('fast_stock_auto_lot', 'Oldest received dates first') : tr('new_batch', '+ New received date')}
                      </button>
                      {batchOptions.map((batch) => (
                        <button key={batch.id} type="button"
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === Number(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                          onClick={() => setBatchChoice(Number(batch.id))}>
                          {batchDisplayLabel(batch, tr('batch', 'Received date'))} ({batch.quantity})
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Preview only -- the backend recomputes the authoritative
                      code from whichever date is actually submitted. */}
                  {mode === 'add' ? <span className="mt-1 block text-[11px] text-gray-400">
                    {batchChoice === 'new'
                      ? `${tr('batch_code_preview', 'Received date code')}: ${dateToBatchCode(receivedDate) || '--'}`
                      : tr('existing_lot_keeps_date', 'Tops up the selected received date — that date stays.')}
                  </span> : null}
                </div>
              )}
              {/* P3-L6: keep-or-destroy (remove) and sellable-or-tagged
                  (add) as ONE compact row on every screen size. Not offered
                  for 'set' -- see StockConditionTagRow and the route's own
                  refusal. */}
              {mode !== 'set' ? (
                <div className="mt-2">
                  <StockConditionTagRow
                    mode={mode === 'remove' ? 'remove' : 'add'}
                    value={conditionTag}
                    onChange={setConditionTag}
                    tr={tr}
                    id="fast-stockin-condition-tag"
                  />
                </div>
              ) : null}
              <div className={`mt-2 grid grid-cols-2 gap-2 sm:items-end ${mode === 'remove' ? 'sm:grid-cols-[5rem_1fr]' : 'sm:grid-cols-[5rem_8.5rem_8rem_1fr]'}`}>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{mode === 'set' ? tr('set_to', 'Set to') : tr('quantity', 'Qty')}</span><input type="number" min={mode === 'set' ? 0 : 1} step="1" className="input text-center text-sm" value={quantity} onChange={(event) => setQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addLine() }} /></label>
                {mode !== 'remove' && (canViewCosts || canEditCosts) ? <>
                <label className="block"><span className="mb-1 block whitespace-nowrap text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('cost_price_usd', 'Cost price $')} <span className="text-red-500" aria-hidden="true">*</span></span><input type="number" min="0" step="0.0001" className="input text-sm" required disabled={!canEditCosts || freeGoods} value={freeGoods ? 0 : unitCost} onChange={(event) => {
                  const next = event.target.value
                  setUnitCost(next)
                  setFreeGoods(freeGoods)
                  // A new receipt price belongs to a new lot of this product.
                  // A separate product requires an explicit independent choice.
                  setCreatePriceVariant(false)
                }} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_optional', 'Expiry (optional)')}</span><DateEntryInput className="text-sm" t={packLookup} ariaLabel={tr('expiry_optional', 'Expiry (optional)')} value={expiryDate} onChange={(iso) => setExpiryDate(iso)} /></label>
                <div className="flex min-w-0 items-end gap-1.5">
                  {unitCost.trim() !== '' ? <span className="mb-2 whitespace-nowrap text-[10px] tabular-nums text-gray-500 sm:text-[11px]">{tr('total_cost', 'Total cost')}: ${(Math.max(0, Number(quantity) || 0) * Math.max(0, Number(unitCost) || 0)).toFixed(2)}</span> : null}
                </div>
                {/* N14-D: $0.00 is a claim the operator makes, never a default.
                    Its own row under the inputs: inside the cost cell it made that
                    cell taller than its siblings, and sm:items-end then lifted the
                    cost input off the line the other inputs sit on. */}
                <label className={`col-span-2 flex w-fit cursor-pointer items-center gap-1.5 rounded text-[11px] text-gray-600 sm:col-span-4 dark:text-gray-400 ${zeroCostNeedsDeclaration ? 'bg-amber-50 px-1 py-0.5 font-medium text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700' : ''}`} title={tr('stock_receipt_free_goods_hint', 'Tick only when the supplier gave these goods at no cost. The declaration is written onto the receipt.')}>
                  <input type="checkbox" className="h-3.5 w-3.5" checked={freeGoods} disabled={!canEditCosts} onChange={(event) => { setFreeGoods(event.target.checked); if (event.target.checked) { setUnitCost('0'); setCreatePriceVariant(false) } }} />
                  {tr('stock_receipt_free_goods', 'Free')}
                </label>
                </> : null}
                {/* P3-L2: the reason, per line. A full row for add and set;
                    beside Qty for a remove, whose row has the room. */}
                <StockReasonField
                  id="fast-stockin-reason"
                  className={`col-span-2 ${mode === 'remove' ? 'sm:col-span-1' : 'sm:col-span-4'}`}
                  label={<span className="inline-flex items-center gap-1">{tr('reason', 'Reason')}<InfoHint label={tr('reason', 'Reason')} text={tr('fast_stock_reason_hint', "Written on each line's stock movement exactly as typed. Leave blank to use the session label.")} /></span>}
                  labelClassName="text-[11px] font-medium text-gray-600 dark:text-gray-400"
                  value={reason}
                  onChange={setReason}
                  onEnter={addLine}
                  savedReasons={savedReasons}
                  placeholder={tr('reason_placeholder', 'e.g. Physical count, Damaged goods…')}
                />
              </div>
              {/* Its own row: this queues a line, Complete in the footer is
                  what writes. Sharing a grid cell with the running total made
                  it read as a field decoration rather than an action. */}
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                {pendingReceiptGate ? (
                  <span className="min-w-0 flex-1 text-right text-[11px] text-amber-700 dark:text-amber-300">
                    {tr(STOCK_RECEIPT_GATE_KEYS[pendingReceiptGate], STOCK_RECEIPT_GATE_FALLBACKS[pendingReceiptGate])}
                  </span>
                ) : null}
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
              {receiptFieldsRelevant ? <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
                <DateEntryInput className="h-9 w-full text-sm" t={packLookup} ariaLabel={tr('received_date', 'Received date')} value={receivedDate} onChange={(iso) => setReceivedDate(iso)} />
              </label>
              <div className="col-span-2"><SupplierPickerField
                value={supplier}
                onChange={setSupplier}
                tr={tr}
                idPrefix="fast-stockin"
                hint={tr('fast_stockin_supplier_hint', 'Recorded on every received date this session receives (first attribution sticks).')}
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
                      {mode === 'paid' ? tr('paid', 'Paid') : tr('on_credit', 'Not Yet Paid')}
                    </button>
                  ))}
                  {paymentStatus === 'credit' ? (
                    <DateEntryInput className="flex-1 text-sm" t={packLookup} ariaLabel={tr('due', 'due')} value={creditDueDate} onChange={(iso) => setCreditDueDate(iso)} />
                  ) : null}
                </div>
              </div>
              </> : null}
            </div>
          </div>

          {/* what landed */}
          {received.length > 0 ? (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <span>{tr('fast_stockin_received', 'Received this session')} ({successCount})</span>
                {canViewCosts ? <span className="shrink-0 tabular-nums normal-case">{tr('total_cost', 'Total cost')}: ${sessionCostTotal.toFixed(2)}</span> : null}
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {received.map((line) => (
                  <div key={line.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900/50">
                    {/* N26 sibling: the full name wraps -- never "…" on the one
                        thing a queued line is read by; barcode under it. */}
                    <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-300">
                      <span className="block break-words">{line.status === 'saved' ? '✅' : line.status === 'error' ? '⚠️' : line.status === 'saving' ? '⏳' : '•'} {line.productName} <span className={`ml-1 inline-block rounded px-1 py-0.5 align-middle text-[10px] font-semibold ${line.createdProduct ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>{line.createdProduct ? tr('stock_session_new_product', 'New') : tr('stock_session_existing_product', 'Existing')}</span> <span className={`whitespace-nowrap ${line.mode === 'remove' ? 'text-red-600 dark:text-red-400' : line.mode === 'set' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{line.mode === 'remove' ? '−' : line.mode === 'set' ? '=' : '×'} {line.quantity} · {line.batchLabel}</span></span>
                      {line.product.barcode ? <span className="block break-all dense-id text-[10px] text-gray-400">{line.product.barcode}</span> : null}
                      {line.reason ? <span className="block break-words text-[10px] text-gray-500 dark:text-gray-400">{line.reason}</span> : null}
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
            {received.length} {tr('lines_queued', 'queued')}{canViewCosts ? ` · $${sessionCostTotal.toFixed(2)}` : ''}
          </span>
          <button type="button" tabIndex={-1}
            title={tr('add_next_hint', 'Add & next queues this line; nothing is written until Complete.')}
            aria-label={tr('add_next_hint', 'Add & next queues this line; nothing is written until Complete.')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-400 dark:border-gray-600 dark:text-gray-500">i</button>
          <button type="button" className="btn-primary ml-auto flex h-10 w-fit max-w-full items-center text-sm" disabled={saving || !received.length} onClick={commitSession}>
            {saving ? `⏳ ${tr('saving_label', 'Saving…')}` : `✓ ${received.every((line) => line.mode === 'add') ? tr('complete_stock_session', 'Complete stock-in session') : tr('complete_stock_session_changes', 'Post stock changes')}`}{successCount > 0 ? ` — ${successCount} ${tr('lines_received', 'line(s) received')}` : ''}
          </button>
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />

      {pendingCommit ? (
        <ConfirmDialog
          title={pendingAllAdd ? tr('complete_stock_session', 'Complete stock-in session') : tr('complete_stock_session_changes', 'Post stock changes')}
          message={pendingAllAdd
            ? tr('confirm_complete_stock_session', 'Receive {lines} product line(s), {units} total unit(s), into {branch}?')
              .replace('{lines}', String(pendingCommit.length))
              .replace('{units}', String(pendingCommit.reduce((total, line) => total + line.quantity, 0)))
              .replace('{branch}', commitBranchName)
            : tr('confirm_complete_stock_session_mixed', 'Post {lines} stock line(s) — {adds} add · {removes} remove · {sets} set — for {branch}?')
              .replace('{lines}', String(pendingCommit.length))
              .replace('{adds}', String(modeCount(pendingCommit, 'add')))
              .replace('{removes}', String(modeCount(pendingCommit, 'remove')))
              .replace('{sets}', String(modeCount(pendingCommit, 'set')))
              .replace('{branch}', commitBranchName)}
          items={commitReviewItems}
          note={tr('confirm_complete_stock_session_note', 'This posts stock movements and creates or updates the related received dates.')}
          confirmLabel={pendingAllAdd ? tr('complete_stock_session', 'Complete stock-in session') : tr('complete_stock_session_changes', 'Post stock changes')}
          working={saving}
          workingLabel={tr('saving_label', 'Saving…')}
          onConfirm={() => void performCommit(pendingCommit)}
          onClose={() => { if (!saving) setPendingCommit(null) }}
          t={(key: string) => tr(key, key)}
        />
      ) : null}

      {/* One shared option sheet, not a private nested Modal: this popup
          used to show name / barcode / a branch-summed quantity / unit cost
          in its own layout, so the same product looked different here than
          in the POS. Branch, option and received date are now chosen the
          same way on every surface. */}
      {selectedGroup ? (
        <ProductOptionSheet
          // The lead row is the first OFFERED one, not group.leadProduct: a
          // family whose root is filtered out of the offer still has a root,
          // and handing that root in as `product` resolved the sheet to a row
          // it never listed. SaleDetailModal's addCandidateGroups already
          // takes the lead this way (lead = choices[0]).
          product={{
            ...(selectedGroupChoices[0] || selectedGroup.leadProduct || selectedGroup.items[0]),
            name: selectedGroup.name,
          } as never}
          choices={selectedGroupChoices as never[]}
          t={(key: string) => tr(key, key)}
          fmtUSD={(value: number) => `$${Number(value || 0).toFixed(2)}`}
          // Stock-in receives into either canonical branch.
          intent="stock"
          activeBranchId={branchId || defaultBranchId || null}
          pickLabel={tr('select', 'Select')}
          onClose={closeCandidateOptions}
          onPick={(candidate, selection) => pickFromGroup(candidate as unknown as ProductCandidate, selection)}
        />
      ) : null}
    </div>,
    document.body,
  )
}

