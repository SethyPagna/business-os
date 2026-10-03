// The Stock Session float (UI-STOCK spec 3-5): one session of Add, Remove or
// Set lines -- Items, then Payment (Add only), then Review, then Complete
// Session. Every stock entry point opens this one component. Lines write
// through the same kernels as before: POST /api/inventory/fast-stock-in/commit
// (per-line 0192 ids, deferred rounds), with the per-line fallback for an old
// Worker.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../AppContext'
import { canEditAcquisitionCosts, canViewAcquisitionCosts, omitUnauthorizedCatalogCosts } from '../../utils/acquisitionCostAccess.ts'
import { effectivePermissions } from '../../utils/permissions.ts'
import { useProtectedCostEntry } from '../../utils/useProtectedCostEntry.ts'
import type { SupplierChoice } from '../shared/SupplierPickerField.tsx'
import { receiveBatchStock, getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { adjustStock, commitFastStockIn, isDeferredStockInResult, type FastStockInCommitLineResult, type FastStockInCommitSettled } from '../../api/inventoryWriteTransport.ts'
import { getProductFilters, searchProducts } from '../../api/methods.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft, flushPendingWorkDraft, writeWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { stockFailureText, stockLineNeedsRemoval } from '../../utils/stockAdjustOutcome.ts'
import { activeReceivingDestination, captureReceivingRequest, productCreationRefusal, receivingDestinationRefusal, receivingDetailsLocked, restoreReceivingSubmissions, retainReceivingSubmissions, type ReceivingSubmissions } from '../../utils/receivingDestination.ts'
import { assertReceivingProductAttemptDispatch, finishReceivingProductAttempt, overlayReceivingProductAttempts, registerReceivingProductAttempt, reserveReceivingProductAttempt } from '../../utils/receivingProductAttempt.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { batchDisplayLabel, formatBatchReceivedDate, lotCodeAsDate } from '../../utils/batchLabel.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { buildProductGroups, type ProductGroup, type ProductRecord } from '../../utils/productGrouping.ts'
import { extractHistoryResultId } from '../../utils/historyHelpers.ts'
import ProductOptionSheet from '../shared/ProductOptionSheet.tsx'
import { adjustBranchQuantity, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS } from '../../utils/stockReceiptFields.ts'
import { useSavedStockReasonCatalog } from '../../utils/useSavedStockReasons.ts'
import { stockLineReason } from '../../utils/stockLineReason.ts'
import { findSessionProductDuplicate } from '../../utils/createProductsSession.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import { stableSnapshot } from '../../utils/formDirty.ts'
import {
  applyPaidToLines,
  buildStockLineRequest,
  catalogCostOf,
  commitSessionBlock,
  defaultLotChoice,
  emptyStockSessionDraft,
  lineEntryRefusal,
  lineNeedsCreate,
  modeSwitchBlocked,
  normalizeStockSessionDraft,
  openingDraft,
  paymentDifference,
  paymentStepRefusal,
  resetLineCosts,
  resolveOpeningMode,
  reviewStockLine,
  scopedSetPreviewForLot,
  sessionItemsTotal,
  sessionLinesRefusal,
  sessionLotChoices,
  sessionSteps,
  setLineFreeQuantity,
  STOCK_SESSION_FAILURE_KEYS,
  type LineEntryRefusal,
  type LotChoice,
  type SessionLinesRefusal,
  type StockMode,
  type StockSessionDraft,
  type StockSessionLine,
  type StockSessionProduct,
  type StockSessionStep,
} from '../../utils/stockSessionDraft.ts'
import { convertLegacyStockDraft, type LegacyStockDraft } from '../../utils/legacyStockDrafts.ts'
import { discardStockAdjustDraft, stockAdjustDraftKey } from '../../utils/stockAdjustDraft.ts'
import StockSessionHeader, { StockSessionSteps, STOCK_MODE_KEYS } from '../stock-session/StockSessionHeader.tsx'
import StockSessionSharedDetails from '../stock-session/StockSessionSharedDetails.tsx'
import StockSessionLineEntry from '../stock-session/StockSessionLineEntry.tsx'
import StockSessionItems from '../stock-session/StockSessionItems.tsx'
import StockSessionPaymentStep from '../stock-session/StockSessionPaymentStep.tsx'
import StockSessionReviewStep from '../stock-session/StockSessionReviewStep.tsx'
import StockSessionFooter from '../stock-session/StockSessionFooter.tsx'

// New products are made in the standard ProductForm, nested over the session.
const ProductForm = lazyRetry(() => import('../products/forms/ProductForm'), 'fast-stock-in-create-product-form')
const StockReasonsManagerModal = lazyRetry(() => import('../shared/StockReasonsManagerModal.tsx'), 'stock-session-reasons-manager')

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type { StockMode }
export type ProductCandidate = StockSessionProduct

export type StockSessionInitialLine = {
  product: ProductCandidate
  quantity: number
  mode?: StockMode
  batchId?: number | null
  reason?: string
}

// One line's committed outcome folded into the queue, as a NEW array, so the
// same value can be written to the draft synchronously and handed to React.
function applyLineOutcome(
  lines: StockSessionLine[],
  key: string,
  outcome: { status: StockSessionLine['status']; detail?: string; needsRemoval?: boolean },
): StockSessionLine[] {
  return lines.map((line) => (line.key === key ? { ...line, ...outcome } : line))
}

interface FastStockInModalProps {
  branchOptions: Array<{ value: string; label: string }>
  receivingBranchOptions?: Array<{ value: string; label: string }>
  defaultBranchId?: string | number | null
  tr: TranslationWithFallback
  notify: (message: string, kind?: string) => void
  onClose: () => void
  onDone: () => void
  // Park the session as a chip; the draft already holds everything.
  onMinimize?: (label: string) => void
  initialHeader?: Partial<Pick<StockSessionDraft, 'branchId' | 'receivedDate' | 'supplier' | 'paymentStatus' | 'creditDueDate'>>
  initialMode?: StockMode
  exchangeRate?: number
  /** Product detail / Branches row: the product already in the entry row. */
  initialProduct?: ProductCandidate | null
  /** Products select mode: the selected products queued as Items. */
  initialLines?: StockSessionInitialLine[]
  /** Products page: uploads the new product's images and returns the payload to hold. */
  onPrepareProduct?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  brandOptions?: string[]
  canCreateProducts?: boolean
  /** A chip parked by a retired stock surface (utils/legacyStockDrafts.ts). */
  legacyDraft?: LegacyStockDraft | null
}

type FastStockInCloseState = Partial<StockSessionDraft> & Record<string, unknown>

export function fastStockInHasUnsavedWork(current: FastStockInCloseState, pristine: FastStockInCloseState): boolean {
  return stableSnapshot(current) !== stableSnapshot(pristine)
}

type LookupOption = { id: number | string; name: string }
type CreateProductResult = { success?: boolean; pending?: boolean; error?: string; id?: number | string; item?: ProductCandidate }

function normalizeLookupOptions(value: unknown): LookupOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const option = row as { id?: unknown; name?: unknown }
    if ((typeof option.id !== 'number' && typeof option.id !== 'string') || !String(option.name || '').trim()) return []
    return [{ id: option.id, name: String(option.name).trim() }]
  })
}

const brandKey = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function productMatchesBrand(product: ProductCandidate, brand: string): boolean {
  const wanted = brandKey(brand)
  if (!wanted) return true
  const listed = Array.isArray(product.brands) ? product.brands : []
  return [product.brand, ...listed].flatMap((value) => String(value ?? '').split(',')).some((value) => brandKey(value) === wanted)
}

// Draft storage must not carry inline images; without a host uploader they are dropped.
function withoutInlineImages(payload: Record<string, unknown>): Record<string, unknown> {
  const isInline = (value: unknown) => typeof value === 'string' && value.startsWith('data:')
  const gallery = Array.isArray(payload.image_gallery) ? payload.image_gallery.filter((entry) => !isInline(entry)) : payload.image_gallery
  return { ...payload, image_gallery: gallery, image_path: isInline(payload.image_path) ? (Array.isArray(gallery) ? gallery[0] || null : null) : payload.image_path }
}

const priceText = (value: unknown): string => (value == null || String(value).trim() === '' ? '' : String(Number(value)))

export default function FastStockInModal({
  branchOptions, receivingBranchOptions = branchOptions, defaultBranchId, tr, notify, onClose, onDone, onMinimize, initialHeader, initialMode,
  exchangeRate: exchangeRateOverride, initialProduct, initialLines, onPrepareProduct, brandOptions, canCreateProducts, legacyDraft,
}: FastStockInModalProps) {
  const app = useApp() as { user: any; exchangeRate: number; usdSymbol: string; khrSymbol: string }
  const { user, usdSymbol, khrSymbol } = app
  const exchangeRate = exchangeRateOverride ?? app.exchangeRate
  const canViewCosts = canViewAcquisitionCosts(user)
  const canEditCosts = canEditAcquisitionCosts(user)
  const permissions = effectivePermissions(user)
  const canEditPrice = permissions.getPermissionTier('products') === 'full' && permissions.can('products', 'edit')
  const canReceive = permissions.can('inventory', 'adjust')
  const canCreate = (canCreateProducts ?? true) && permissions.can('products', 'add')
  const canEditReasons = permissions.can('inventory', 'edit_reasons')
  const packLookup = (key: string): string | undefined => tr(key, '') || undefined
  const fastStockInDraftKey = scopedWorkDraftKey('fast_stockin')
  const fallbackBranchId = String(initialHeader?.branchId || (defaultBranchId != null && defaultBranchId !== '' ? defaultBranchId : (branchOptions[0]?.value || '')))

  const entryFor = (product: ProductCandidate, mode: StockMode): Partial<StockSessionDraft> => {
    const cost = catalogCostOf(product)
    return {
      query: String(product.name || ''), picked: product, quantity: mode === 'set' ? '' : '1',
      unitCost: canViewCosts && cost != null ? String(cost) : '', sellingPrice: priceText(product.selling_price_usd),
      expiryDate: '', batchChoice: mode === 'add' ? 'new' : 'none', createPayload: null, createRequestId: '', scannedBarcode: '',
    }
  }

  // Resolved once per mount (S1): the draft, the mode it opens in, and the
  // pristine snapshot, all from the same resolution.
  const initRef = useRef<{ draft: StockSessionDraft; pristine: StockSessionDraft; legacyBlocked: string; submissions: ReceivingSubmissions } | null>(null)
  if (initRef.current === null) {
    const mintLineId = () => createClientRequestId('stockline')
    const seed = (mode: StockMode, sessionId: number) => emptyStockSessionDraft({
      sessionId, mode, branchId: fallbackBranchId, receivedDate: initialHeader?.receivedDate || todayStr(),
      supplier: initialHeader?.supplier, paymentStatus: initialHeader?.paymentStatus, creditDueDate: initialHeader?.creditDueDate,
    })
    let stored: StockSessionDraft | null = null
    let rewrite = false
    let legacyBlocked = ''
    let legacyConverted = false
    let storedRaw: unknown = null
    if (legacyDraft) {
      const converted = convertLegacyStockDraft(legacyDraft, mintLineId)
      if (converted.draft) { stored = converted.draft; rewrite = true; legacyConverted = true } else legacyBlocked = converted.blocked
    }
    if (!stored) {
      const raw = readWorkDraft<unknown>(fastStockInDraftKey)?.data
      storedRaw = raw
      const rawLines = raw && typeof raw === 'object' ? (raw as { lines?: unknown }).lines : null
      stored = normalizeStockSessionDraft(raw, mintLineId)
      // Ids minted for an older draft are written back now, not by the debounced autosave.
      rewrite = Array.isArray(rawLines) && rawLines.some((line) => !line || typeof line !== 'object' || !(line as { requestId?: unknown }).requestId)
    }
    let opened = stored ? openingDraft(stored, initialMode) : seed(resolveOpeningMode(null, initialMode), Date.now())
    if (!opened.branchId) opened = { ...opened, branchId: fallbackBranchId }
    let pristine = seed(opened.mode, opened.sessionId)
    if (initialLines?.length && !opened.lines.length) {
      const lines: StockSessionLine[] = initialLines.map((entry, index) => {
        const mode = entry.mode || opened.mode
        const cost = catalogCostOf(entry.product)
        return {
          key: `${entry.product.id}-${Date.now()}-${index}`, requestId: mintLineId(), product: entry.product,
          productName: String(entry.product.name || `#${entry.product.id}`), mode, quantity: Math.max(0, Math.floor(Number(entry.quantity) || 0)),
          freeQuantity: 0, unitCost: mode === 'add' && canViewCosts && cost != null ? String(cost) : '',
          sellingPrice: mode === 'add' ? priceText(entry.product.selling_price_usd) : '', freeGoods: false, expiryDate: '',
          batchChoice: entry.batchId != null && Number(entry.batchId) > 0 ? Number(entry.batchId) : (mode === 'add' ? 'new' : 'none'),
          batchLabel: '', ...(mode === 'set' && entry.batchId != null ? { setScope: 'lot' as const } : {}),
          reason: String(entry.reason || ''), conditionTag: '', createdProduct: false, status: 'queued', detail: '',
        }
      })
      opened = { ...opened, lines }
      pristine = { ...pristine, lines }
      rewrite = true
    }
    if (initialProduct) {
      opened = { ...opened, ...entryFor(initialProduct, opened.mode) }
      if (!stored) pristine = { ...pristine, ...entryFor(initialProduct, opened.mode) }
    }
    const submissions = restoreReceivingSubmissions(storedRaw, opened.lines)
    overlayReceivingProductAttempts(user?.id, submissions, opened.lines)
    if (rewrite) writeWorkDraft(fastStockInDraftKey, { ...opened, receivingSubmissions: submissions })
    // The work now lives in the session draft, so the retired surface's copy goes.
    // A blocked conversion keeps it: it is the evidence of an unknown outcome.
    if (legacyDraft && legacyConverted) {
      if (legacyDraft.kind === 'stock_adjust') {
        const productId = (legacyDraft.data as { product?: { id?: unknown } } | null)?.product?.id
        discardStockAdjustDraft(stockAdjustDraftKey(productId), user?.id ?? user?.username ?? null)
      } else {
        clearWorkDraft(scopedWorkDraftKey('create_products_session'))
      }
    }
    initRef.current = { draft: opened, pristine, legacyBlocked, submissions }
  }
  const init = initRef.current
  const submissionsRef = useRef(init.submissions)
  const destinationRef = useRef({ branchId: init.draft.branchId, options: receivingBranchOptions })

  // ---- shared (applies to every line) ----
  const [mode, setModeState] = useState<StockMode>(init.draft.mode)
  const [step, setStep] = useState<StockSessionStep>(init.draft.step)
  const [brand, setBrand] = useState(init.draft.brand)
  const [branchId, setBranchId] = useState(init.draft.branchId)
  destinationRef.current = { branchId, options: receivingBranchOptions }
  const [receivedDate, setReceivedDate] = useState(init.draft.receivedDate)
  const [supplier, setSupplier] = useState<SupplierChoice>(init.draft.supplier)
  const [paymentStatus, setPaymentStatus] = useState(init.draft.paymentStatus)
  const [creditDueDate, setCreditDueDate] = useState(init.draft.creditDueDate)
  const [paidAmount, setPaidAmount] = useState(init.draft.paidAmount)
  const [createdProductIds, setCreatedProductIds] = useState<string[]>(init.draft.createdProductIds)

  // ---- entry row ----
  const [query, setQuery] = useState(init.draft.query)
  const [picked, setPicked] = useState<ProductCandidate | null>(init.draft.picked)
  const [quantity, setQuantity] = useState(init.draft.quantity)
  const [protectedUnitCost, setProtectedUnitCost] = useState(init.draft.unitCost)
  const costEntry = useProtectedCostEntry(user?.id, picked?.id, canViewCosts, canEditCosts)
  const unitCost = String(costEntry.value('unitCost', protectedUnitCost, ''))
  const setUnitCost = (next: string) => { costEntry.write('unitCost', next); setProtectedUnitCost(next) }
  const [sellingPrice, setSellingPrice] = useState(init.draft.sellingPrice)
  const [expiryDate, setExpiryDate] = useState(init.draft.expiryDate)
  // Sticky across lines: a five-product damaged removal types its reason and tag once.
  const [reason, setReason] = useState(init.draft.reason)
  const [conditionTag, setConditionTag] = useState(init.draft.conditionTag)
  const [batchChoice, setBatchChoice] = useState<LotChoice>(init.draft.batchChoice)
  const [createPayload, setCreatePayload] = useState<Record<string, unknown> | null>(init.draft.createPayload)
  const [createRequestId, setCreateRequestId] = useState(init.draft.createRequestId)
  // Only set by a camera/scan-button result.
  const [scannedBarcode, setScannedBarcode] = useState(init.draft.scannedBarcode)
  const [addAttempted, setAddAttempted] = useState(false)
  const { reasons: savedReasons, reload: reloadReasons } = useSavedStockReasonCatalog('adjust')

  // ---- the session's lines ----
  const [received, setReceived] = useState<StockSessionLine[]>(init.draft.lines)
  const [editingKey, setEditingKey] = useState('')
  const [freeEditKey, setFreeEditKey] = useState('')
  const [linesInvalidKey, setLinesInvalidKey] = useState('')
  const [supplierRefused, setSupplierRefused] = useState(false)
  const [saving, setSaving] = useState(false)

  // ---- transient ----
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [searchCompleteFor, setSearchCompleteFor] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null)
  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [lotsLoadedFor, setLotsLoadedFor] = useState('')
  const [lotsFailed, setLotsFailed] = useState(false)
  const [createForm, setCreateForm] = useState<{ name: string; barcode: string } | null>(null)
  const [createCategories, setCreateCategories] = useState<LookupOption[]>([])
  const [createUnits, setCreateUnits] = useState<LookupOption[]>([])
  const [reasonsOpen, setReasonsOpen] = useState(false)
  const [fallbackBrands, setFallbackBrands] = useState<string[] | null>(null)
  const brandsRequestedRef = useRef(false)
  const sheetBatchRef = useRef<number | null>(null)
  // Set by editLine and restore: re-applied once that product's lots have loaded.
  const pendingBatchRestoreRef = useRef<LotChoice | null>(init.draft.picked ? init.draft.batchChoice : null)
  const searchSeqRef = useRef(0)
  const sessionIdRef = useRef(init.draft.sessionId)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const parentPanelRef = useRef<HTMLDivElement | null>(null)

  const productIdNumber = Number(picked?.id) > 0 ? Number(picked?.id) : 0
  const lotsKey = productIdNumber && Number(branchId) > 0 ? `${productIdNumber}:${Number(branchId)}` : ''
  const lotsReady = !lotsKey || lotsLoadedFor === lotsKey
  const steps = sessionSteps(mode, received)
  const pendingLines = received.filter((line) => line.status !== 'saved')
  overlayReceivingProductAttempts(user?.id, submissionsRef.current, received)
  const detailsLocked = receivingDetailsLocked(submissionsRef.current, received)
  const submissionLockCode = pendingLines.map(line => productCreationRefusal(submissionsRef.current, line)).find(Boolean) || 'receiving_submission_locked'
  const destinationInvalid = (mode === 'add' && !activeReceivingDestination(branchId, receivingBranchOptions))
    || receivingDestinationRefusal(branchId, receivingBranchOptions, pendingLines, submissionsRef.current) === 'receiving_branch_inactive'
  const destinationError = (lines: readonly StockSessionLine[]) => {
    overlayReceivingProductAttempts(user?.id, submissionsRef.current, lines)
    return receivingDestinationRefusal(destinationRef.current.branchId, destinationRef.current.options, lines, submissionsRef.current)
  }
  const refuseDestination = (lines: readonly StockSessionLine[]): boolean => {
    const code = destinationError(lines)
    if (!code) return false
    notify(stockFailureText({ code }, tr, tr('failed', 'Failed')), 'error')
    setStep('items')
    return true
  }
  const changeBranch = (next: string) => {
    if (detailsLocked || saving) return
    if (mode === 'add' && !activeReceivingDestination(next, receivingBranchOptions)) return
    setBranchId(next)
  }
  const currentStep: StockSessionStep = steps.includes(step) && (step === 'items' || pendingLines.length > 0) ? step : 'items'

  const currentDraft = (lines: StockSessionLine[] = received): StockSessionDraft & { receivingSubmissions?: ReceivingSubmissions } => {
    overlayReceivingProductAttempts(user?.id, submissionsRef.current, lines)
    return {
      version: 2, sessionId: sessionIdRef.current, mode, step: currentStep, brand, branchId, receivedDate, supplier,
      paymentStatus, creditDueDate, paidAmount, query, picked, quantity, unitCost: protectedUnitCost,
      sellingPrice, expiryDate, reason, conditionTag, batchChoice, createPayload, createRequestId, scannedBarcode,
      createdProductIds, lines,
      ...(receivingDetailsLocked(submissionsRef.current, lines) || Object.keys(submissionsRef.current.products).length ? { receivingSubmissions: retainReceivingSubmissions(submissionsRef.current, lines) } : {}),
    }
  }

  // Keystrokes ride the debounced autosave. No dirtyWork registration: with the
  // draft persisting, leaving is safe -- everything is here on reopen.
  useEffect(() => scheduleWorkDraftWrite<StockSessionDraft>(fastStockInDraftKey, currentDraft()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, currentStep, brand, branchId, receivedDate, supplier, paymentStatus, creditDueDate, paidAmount, query, picked, quantity, protectedUnitCost, sellingPrice, expiryDate, reason, conditionTag, batchChoice, createPayload, createRequestId, scannedBarcode, createdProductIds, received])

  // Facts (a queued line's id, a committed line's status, a created product id)
  // are written synchronously, before React renders them.
  const persistSessionDraft = (lines: StockSessionLine[] = received) => {
    writeWorkDraft<StockSessionDraft>(fastStockInDraftKey, currentDraft(lines))
  }
  const persistSubmissionDraft = (lines: StockSessionLine[] = received) => {
    const draft = currentDraft(lines)
    writeWorkDraft(fastStockInDraftKey, draft)
    if (JSON.stringify(readWorkDraft(fastStockInDraftKey)?.data) !== JSON.stringify(draft)) {
      const code = 'receiving_submission_not_saved'
      throw Object.assign(new Error(stockFailureText({ code }, tr, '')), { code })
    }
  }

  useEffect(() => {
    if (init.legacyBlocked === 'submission_unknown') notify(tr('stock_request_partially_applied', 'Stock was recorded but the request did not finish. Check the Stock Change ledger, then remove this line.'), 'error')
    else if (init.legacyBlocked) notify(tr('failed', 'Failed'), 'error')
    if (!init.draft.picked && typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- product search ----
  useEffect(() => {
    const text = query.trim()
    setSearchCompleteFor('')
    if (picked || selectedGroup || text.length < 2) { setCandidates([]); return }
    const seq = ++searchSeqRef.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: text, pageSize: brand.trim() ? 20 : 8, surface: 'inventory' }) as { items?: ProductCandidate[] }
        if (seq !== searchSeqRef.current) return
        setCandidates(Array.isArray(payload?.items) ? payload.items : [])
        setSearchCompleteFor(text)
      } catch { /* suggestions only -- typing again retries */ }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, picked, selectedGroup, brand])

  const visibleCandidates = useMemo(() => candidates.filter((candidate) => productMatchesBrand(candidate, brand)), [candidates, brand])
  const productsById = useMemo(() => new Map<unknown, ProductRecord>(visibleCandidates.map((product) => [product.id, product as ProductRecord])), [visibleCandidates])
  const candidateGroups = useMemo(() => buildProductGroups(visibleCandidates, productsById, { preserveInputOrder: true }), [visibleCandidates, productsById])
  const selectedGroupChoices = useMemo(
    () => (selectedGroup ? (selectedGroup.sellableItems.length ? selectedGroup.sellableItems : selectedGroup.items) : []),
    [selectedGroup],
  )

  useEffect(() => {
    const panel = parentPanelRef.current
    if (!panel || (!selectedGroup && !reasonsOpen)) return
    panel.setAttribute('inert', '')
    panel.setAttribute('aria-hidden', 'true')
    return () => { panel.removeAttribute('inert'); panel.removeAttribute('aria-hidden') }
  }, [selectedGroup, reasonsOpen])

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

  // ---- received dates (lots) of the picked product at the session branch ----
  useEffect(() => {
    if (!lotsKey) { setBatchOptions([]); setLotsFailed(false); setLotsLoadedFor(''); return }
    let cancelled = false
    getProductBatches(productIdNumber, Number(branchId), false)
      .then((res) => {
        if (cancelled) return
        const lots = res?.batches || []
        setBatchOptions(lots)
        setLotsFailed(false)
        setLotsLoadedFor(lotsKey)
        const restore = pendingBatchRestoreRef.current
        pendingBatchRestoreRef.current = null
        const choices = mode === 'add' ? lots : sessionLotChoices(mode, lots, supplier)
        if (typeof restore === 'number' && choices.some((lot) => Number(lot.id) === restore)) setBatchChoice(restore)
        else if (restore === 'new' && mode === 'add') setBatchChoice('new')
        else setBatchChoice(defaultLotChoice({ mode, choices, sheetBatchId: sheetBatchRef.current, sharedDate: receivedDate }))
        sheetBatchRef.current = null
      })
      .catch((error: unknown) => {
        // A failed read must never read as "this product has no lots".
        if (cancelled) return
        console.error('[FastStockInModal] batch options load failed:', error)
        setBatchOptions([])
        setLotsFailed(true)
        setLotsLoadedFor(lotsKey)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotsKey])

  const lotChoices = useMemo(() => (mode === 'add' ? batchOptions : sessionLotChoices(mode, batchOptions, supplier)), [mode, batchOptions, supplier])
  // The shared Supplier narrows Remove/Set lots; a lot it filters out is not kept.
  useEffect(() => {
    if (!lotsReady || !lotsKey || mode === 'add') return
    const valid = typeof batchChoice === 'number' ? lotChoices.some((lot) => Number(lot.id) === batchChoice) : (batchChoice === 'none' && !lotChoices.length)
    if (!valid) setBatchChoice(defaultLotChoice({ mode, choices: lotChoices, sharedDate: receivedDate }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotChoices, lotsReady])

  useEffect(() => {
    if (!createForm) return
    let cancelled = false
    void import('../../api/lookupTransport.ts').then(({ getCategories, getUnits }) => Promise.all([getCategories(), getUnits()]))
      .then(([categories, units]) => {
        if (cancelled) return
        setCreateCategories(normalizeLookupOptions(categories))
        setCreateUnits(normalizeLookupOptions(units))
      })
      .catch(() => { /* ProductForm keeps its own unit fallback */ })
    return () => { cancelled = true }
  }, [createForm])

  const ensureBrands = () => {
    if (brandOptions || brandsRequestedRef.current) return
    brandsRequestedRef.current = true
    void getProductFilters({})
      .then((payload) => {
        const rows = (payload as { brands?: unknown[] } | null)?.brands
        setFallbackBrands(Array.isArray(rows) ? rows.map((value) => String(value || '').trim()).filter(Boolean) : [])
      })
      .catch(() => { brandsRequestedRef.current = false })
  }

  // ---- entry row ----
  const branchQuantity = picked ? adjustBranchQuantity(picked.branch_stock, branchId, picked.stock_quantity) : 0
  const chosenLot = typeof batchChoice === 'number' ? batchOptions.find((lot) => Number(lot.id) === batchChoice) || null : null
  const setPreview = mode === 'set' && chosenLot ? scopedSetPreviewForLot(quantity, chosenLot, branchQuantity) : null
  // Loss rule (24 Sep): only a Set that LOWERS the received date may be tagged.
  const setLowers = Boolean(setPreview?.valid && setPreview.delta < 0)
  const duplicateRows = useMemo(() => received.map((line) => ({ ...line, name: line.productName, barcode: line.product.barcode })), [received])

  let refusal: LineEntryRefusal | null = lineEntryRefusal({
    mode, hasProduct: Boolean(picked), branchId, quantity, unitCost, supplierName: supplier.supplierName,
    lotChoice: batchChoice, lot: chosenLot, canReceive, canEditCosts, branchQuantity,
  })
  if (!refusal && picked && lotsKey && !lotsReady) refusal = { key: 'loading', fallback: 'Loading...', field: 'lot' }
  if (!refusal && picked && lotsKey && lotsFailed) refusal = { key: 'batches_load_failed', fallback: 'Could not load received dates.', field: 'lot' }
  if (!refusal && picked && mode === 'set' && batchChoice === 'none' && Number(quantity) > branchQuantity) {
    // Without a dated lot a Set can only lower the branch; raising is a receipt (Add).
    refusal = { key: 'no_batches_for_branch', fallback: 'No received dates for this branch', field: 'lot' }
  }
  const refusalMessage = refusal
    ? (refusal.gate
      ? tr(STOCK_RECEIPT_GATE_KEYS[refusal.gate], STOCK_RECEIPT_GATE_FALLBACKS[refusal.gate])
      : Object.entries(refusal.params || {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), tr(refusal.key, refusal.fallback)))
    : ''
  // Ring a control for the receipt gate (it names the control to fix) or after a refused Add.
  const invalidField = refusal && (addAttempted || (picked && refusal.gate)) ? refusal.field : null

  const resetLine = () => {
    setPicked(null)
    setQuery('')
    setQuantity(mode === 'set' ? '' : '1')
    setUnitCost('')
    setSellingPrice('')
    setExpiryDate('')
    setScannedBarcode('')
    setCreatePayload(null)
    setCreateRequestId('')
    setAddAttempted(false)
    pendingBatchRestoreRef.current = null
    setBatchChoice(mode === 'add' ? 'new' : 'none')
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  const applyEntry = (entry: Partial<StockSessionDraft>) => {
    if (entry.picked !== undefined) setPicked(entry.picked)
    if (entry.query !== undefined) setQuery(entry.query)
    if (entry.quantity !== undefined) setQuantity(entry.quantity)
    if (entry.unitCost !== undefined) setUnitCost(entry.unitCost)
    if (entry.sellingPrice !== undefined) setSellingPrice(entry.sellingPrice)
    if (entry.expiryDate !== undefined) setExpiryDate(entry.expiryDate)
    if (entry.createPayload !== undefined) setCreatePayload(entry.createPayload)
    if (entry.createRequestId !== undefined) setCreateRequestId(entry.createRequestId)
    if (entry.scannedBarcode !== undefined) setScannedBarcode(entry.scannedBarcode)
    setAddAttempted(false)
  }

  function editLine(line: StockSessionLine) {
    if (saving || line.status === 'saved' || line.needsRemoval) return
    if (receivingDetailsLocked(submissionsRef.current, [line])) { notify(stockFailureText({ code: productCreationRefusal(submissionsRef.current, line) || 'receiving_submission_locked' }, tr, ''), 'error'); return }
    setEditingKey(line.key)
    if (line.mode !== mode) setModeState(line.mode)
    applyEntry({
      picked: line.product, query: line.productName, quantity: String(line.quantity),
      unitCost: canViewCosts ? line.unitCost : '',
      sellingPrice: line.sellingPrice, expiryDate: line.expiryDate, createPayload: line.createPayload || null,
      createRequestId: line.createRequestId || '', scannedBarcode: '',
    })
    setReason(line.reason)
    setConditionTag(line.conditionTag || '')
    // Parked: the lots effect is about to re-key on this product.
    pendingBatchRestoreRef.current = line.batchChoice
    setBatchChoice(line.batchChoice)
    setStep('items')
  }

  const pick = (candidate: ProductCandidate) => {
    const duplicate = findSessionProductDuplicate(duplicateRows, candidate, editingKey)
    if (duplicate) {
      notify(tr('create_products_session_duplicate', 'Duplicate: You added this item already.'), 'error')
      if (duplicate.row.status !== 'saved') editLine(duplicate.row as unknown as StockSessionLine)
      return
    }
    setCandidates([])
    applyEntry(entryFor(candidate, mode))
    // Same product re-picked: the lots are already here, so apply the sheet's date now.
    if (lotsKey && Number(candidate.id) === productIdNumber && lotsReady) {
      setBatchChoice(defaultLotChoice({ mode, choices: lotChoices, sheetBatchId: sheetBatchRef.current, sharedDate: receivedDate }))
      sheetBatchRef.current = null
    } else {
      setBatchChoice(mode === 'add' ? 'new' : 'none')
    }
  }

  function closeCandidateOptions() {
    setSelectedGroup(null)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }

  // S3: the option sheet's branch fills the shared Branch, its received date the line's.
  const pickFromGroup = (candidate: ProductCandidate, selection?: { branchId?: string | null; batch?: { batchId?: number } }) => {
    sheetBatchRef.current = selection?.batch?.batchId != null ? Number(selection.batch.batchId) : null
    if (selection?.branchId != null && String(selection.branchId) !== String(branchId)) changeBranch(String(selection.branchId))
    pick(candidate)
    closeCandidateOptions()
  }

  const changeMode = (next: StockMode) => {
    if (saving || modeSwitchBlocked(received) || next === mode) return
    setModeState(next)
    setStep('items')
    setQuantity(next === 'set' ? '' : '1')
    setConditionTag('')
    setAddAttempted(false)
    setEditingKey('')
    if (next !== 'add' && createPayload) resetLine()
    const choices = next === 'add' ? batchOptions : sessionLotChoices(next, batchOptions, supplier)
    setBatchChoice(lotsReady && lotsKey ? defaultLotChoice({ mode: next, choices, sharedDate: receivedDate }) : (next === 'add' ? 'new' : 'none'))
  }

  const lotLabelFor = (choice: LotChoice): string => {
    if (choice === 'new') return formatBatchReceivedDate(receivedDate) || tr('new_batch', '+ New received date')
    if (choice === 'none') return tr('stock_set_branch_total', 'Branch total')
    const lot = batchOptions.find((entry) => Number(entry.id) === choice)
    return lot ? batchDisplayLabel(lot, tr('batch', 'Received date')) : ''
  }

  const addLine = () => {
    if (saving) return
    if (detailsLocked) { notify(stockFailureText({ code: submissionLockCode }, tr, ''), 'error'); return }
    if (refusal || !picked) {
      setAddAttempted(true)
      notify(refusalMessage || tr('fast_stockin_pick_product', 'Pick a product first'), 'error')
      return
    }
    const duplicate = findSessionProductDuplicate(duplicateRows, picked, editingKey)
    if (duplicate) {
      notify(tr('create_products_session_duplicate', 'Duplicate: You added this item already.'), 'error')
      if (duplicate.row.status !== 'saved') editLine(duplicate.row as unknown as StockSessionLine)
      return
    }
    const qty = Math.floor(Number(quantity.trim() || 0)) || 0
    const editingLine = editingKey ? received.find((line) => line.key === editingKey) : undefined
    // The free row belongs to the item: an edit of the paid row keeps it.
    const free = mode === 'add' ? editingLine?.freeQuantity || 0 : 0
    // Kept on a Qty 0 item too: its free row shows it; the wire sends 0 (lineWireUnitCost).
    const lineCost = mode !== 'add' ? '' : unitCost.trim()
    const linePrice = mode === 'add' ? sellingPrice.trim() : ''
    // A product made in this session is created with the price and cost the line shows.
    const heldPayload = createPayload ? {
      ...createPayload,
      ...(linePrice !== '' ? { selling_price_usd: Number(linePrice) } : {}),
      ...(canEditCosts && lineCost !== '' && qty > 0 ? { cost_price_usd: Number(lineCost) } : {}),
    } : null
    const product: ProductCandidate = heldPayload && linePrice !== '' ? { ...picked, selling_price_usd: Number(linePrice) } : picked
    const next: StockSessionLine = {
      key: editingKey || `${picked.id || 'new'}-${Date.now()}`,
      requestId: (editingKey ? received.find((line) => line.key === editingKey)?.requestId : '') || createClientRequestId('stockline'),
      product,
      productName: String(picked.name || `#${picked.id}`),
      mode,
      quantity: qty,
      freeQuantity: free,
      unitCost: lineCost,
      sellingPrice: linePrice,
      freeGoods: false,
      expiryDate: mode === 'add' ? expiryDate : '',
      batchChoice,
      batchLabel: lotLabelFor(batchChoice),
      ...(mode === 'add' && String(chosenLot?.supplier_name || '').trim() ? { lotSupplierName: String(chosenLot?.supplier_name).trim() } : {}),
      ...(mode === 'set' && chosenLot ? { setScope: 'lot' as const } : {}),
      ...(mode !== 'add' && chosenLot ? { expectedLotQuantity: Number(chosenLot.quantity) || 0 } : {}),
      reason: reason.trim(),
      conditionTag: mode === 'set' && !setLowers ? '' : conditionTag,
      createdProduct: Boolean(heldPayload) || createdProductIds.includes(String(picked.id)),
      ...(heldPayload ? { createPayload: heldPayload, createRequestId } : {}),
      status: 'queued',
      detail: '',
    }
    const nextLines = editingKey ? received.map((line) => (line.key === editingKey ? next : line)) : [next, ...received]
    persistSessionDraft(nextLines)
    setReceived(nextLines)
    setEditingKey('')
    setLinesInvalidKey('')
    // A Qty 0 item is all free: its free row opens for the quantity.
    if (mode === 'add' && canReceive && qty === 0 && free === 0 && !heldPayload) setFreeEditKey(next.key)
    resetLine()
  }

  const setLineFree = (key: string, value: string) => {
    if (detailsLocked) return
    const nextLines = setLineFreeQuantity(received, key, value)
    persistSessionDraft(nextLines)
    setReceived(nextLines)
    if (linesInvalidKey === key) setLinesInvalidKey('')
  }

  const removeLine = (key: string) => {
    if (saving) return
    const nextLines = received.filter((line) => line.key !== key)
    submissionsRef.current = retainReceivingSubmissions(submissionsRef.current, nextLines)
    persistSessionDraft(nextLines)
    setReceived(nextLines)
    if (editingKey === key) { setEditingKey(''); resetLine() }
  }

  // ---- + Create "text" -> ProductForm -> the payload is held on the line ----
  const createText = mode === 'add' && canCreate && !picked && query.trim().length >= 2 && searchCompleteFor === query.trim() ? query.trim() : null
  const openCreate = () => {
    if (!activeReceivingDestination(branchId, receivingBranchOptions) || detailsLocked) { notify(stockFailureText({ code: detailsLocked ? submissionLockCode : 'receiving_branch_inactive' }, tr, ''), 'error'); return }
    const text = query.trim()
    if (!text) return
    persistSessionDraft()
    const looksLikeBarcode = /^\d{6,}$/.test(text) || (scannedBarcode && scannedBarcode === text)
    setCreateForm({ name: looksLikeBarcode ? '' : text, barcode: looksLikeBarcode ? text : '' })
  }

  const holdNewProduct = async (payload: Record<string, unknown> = {}) => {
    const cleaned = omitUnauthorizedCatalogCosts(payload, user)
    const prepared = onPrepareProduct ? await onPrepareProduct(cleaned) : withoutInlineImages(cleaned)
    const held: Record<string, unknown> = { ...prepared, stock_quantity: 0 }
    const name = String(held.name || '').trim()
    const openingQuantity = Math.max(0, Math.floor(Number(payload.stock_quantity) || 0))
    const product: ProductCandidate = {
      id: '', name, barcode: String(held.barcode || '') || null, brand: String(held.brand || brand || '') || null,
      selling_price_usd: held.selling_price_usd as number | undefined, cost_price_usd: held.cost_price_usd as number | undefined,
      stock_quantity: 0, branch_stock: [],
    }
    const requestId = createClientRequestId('product')
    try { await registerReceivingProductAttempt(user?.id, requestId) } catch (error) {
      throw Object.assign(new Error(stockFailureText(error, tr, tr('failed', 'Failed'))), { code: (error as { code?: string })?.code })
    }
    applyEntry({
      picked: product, query: name, quantity: canReceive ? String(openingQuantity || 1) : '0',
      unitCost: canViewCosts && held.cost_price_usd != null ? String(held.cost_price_usd) : '', sellingPrice: priceText(held.selling_price_usd),
      expiryDate: String(held.expiry_date || ''), createPayload: held, createRequestId: requestId, scannedBarcode: '',
    })
    setBatchChoice('new')
    if (held.supplier && !supplier.supplierName.trim()) setSupplier({ supplierId: null, supplierName: String(held.supplier) })
  }

  const createHeldProduct = async (line: StockSessionLine): Promise<number> => {
    overlayReceivingProductAttempts(user?.id, submissionsRef.current, [line])
    const creationCode = productCreationRefusal(submissionsRef.current, line)
    if (creationCode) throw Object.assign(new Error(stockFailureText({ code: creationCode }, tr, '')), { code: creationCode })
    const payload = {
      ...(line.createPayload || {}),
      client_request_id: line.createRequestId,
      branch_id: branchId,
      stock_quantity: 0,
      userId: user?.id,
      userName: user?.name,
    }
    submissionsRef.current.products[line.key] = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
    submissionsRef.current.productOutcomes[line.key] = 'not_sent'
    const { createProduct } = await import('../../api/productWriteTransport.ts')
    const validateDestination = () => {
      const code = Number(destinationRef.current.branchId) !== Number(payload.branch_id) ? 'receiving_submission_locked' : destinationError([line])
      if (code) throw Object.assign(new Error(stockFailureText({ code }, tr, '')), { code })
    }
    validateDestination()
    persistSubmissionDraft()
    const attempt = await reserveReceivingProductAttempt(user?.id, line.createRequestId, payload, validateDestination)
    overlayReceivingProductAttempts(user?.id, submissionsRef.current, [line])
    const unknownCode = 'product_create_outcome_unknown'
    const unknownError = () => Object.assign(new Error(stockFailureText({ code: unknownCode }, tr, '')), { code: unknownCode })
    const assertDispatch = () => {
      assertReceivingProductAttemptDispatch(attempt)
      if (Number(destinationRef.current.branchId) !== Number(payload.branch_id)
        || !activeReceivingDestination(destinationRef.current.branchId, destinationRef.current.options)) throw unknownError()
    }
    let result: CreateProductResult
    try { result = await createProduct(JSON.parse(attempt.bodyJson!), assertDispatch) as CreateProductResult } catch (error) {
      const failure = error as { code?: string; outcome?: string } | null
      if (failure?.code === 'write_requires_live_server' && failure.outcome !== 'unknown') {
        await finishReceivingProductAttempt(attempt, 'not_dispatched')
        overlayReceivingProductAttempts(user?.id, submissionsRef.current, [line])
        throw error
      }
      try { await finishReceivingProductAttempt(attempt, 'unknown') } catch { }
      throw unknownError()
    }
    if (result?.pending) {
      try { await finishReceivingProductAttempt(attempt, 'pending') } catch { throw unknownError() }
      submissionsRef.current.productOutcomes[line.key] = 'pending'
      throw Object.assign(new Error(tr('product_creation_pending_review', 'Product creation is pending review and cannot be added to this stock-in session yet.')), { code: 'product_pending_review' })
    }
    if (result?.success === false) throw unknownError()
    const id = extractHistoryResultId(result as never)
    if (!id) throw unknownError()
    try { await finishReceivingProductAttempt(attempt, 'confirmed', id) } catch { throw unknownError() }
    return id
  }

  // ---- commit ----
  const describeLineResult = (line: StockSessionLine, result?: { lotCode?: string | null } | null): string => (
    line.mode === 'remove'
      ? tr('stock_line_removed', 'Removed')
      : line.mode === 'set'
        ? tr('stock_line_set', 'Set')
        : result?.lotCode
          ? `${tr('received_date', 'Received date')} ${lotCodeAsDate(result.lotCode) || result.lotCode}`
          : tr('received', 'Received')
  )

  const buildLineRequest = (line: StockSessionLine) => submissionsRef.current.requests[line.key] || buildStockLineRequest(line, {
    branchId, receivedDate, supplier, paymentStatus, creditDueDate, sessionId: sessionIdRef.current, canEditPrice,
    reasonFor: (entry) => stockLineReason(entry, tr),
  })

  const failureText = (error: unknown, fallback: string): string => {
    const code = String((error as { code?: unknown } | null)?.code || '')
    const key = STOCK_SESSION_FAILURE_KEYS[code]
    return key ? tr(key, fallback) : stockFailureText(error, tr, fallback)
  }

  // Fallback: one POST per line, reached only when the batched route 404s (old Worker).
  const performCommitSequential = async (pending: StockSessionLine[], start: StockSessionLine[]): Promise<{ failed: number; lines: StockSessionLine[] }> => {
    let failed = 0
    let lines = start
    for (const line of pending) {
      lines = applyLineOutcome(lines, line.key, { status: 'saving' })
      setReceived(lines)
      const request = buildLineRequest(line)
      try {
        const result = request.wire === 'adjust'
          ? await adjustStock(request.body) as { lotCode?: string | null } | null
          : await receiveBatchStock(request.body)
        lines = applyLineOutcome(lines, line.key, { status: 'saved', detail: describeLineResult(line, result) })
      } catch (error) {
        failed += 1
        lines = applyLineOutcome(lines, line.key, {
          status: 'error',
          detail: failureText(error, tr('error', 'Error')),
          needsRemoval: stockLineNeedsRemoval(error),
        })
      }
      persistSessionDraft(lines)
      setReceived(lines)
    }
    return { failed, lines }
  }

  const finishSession = () => {
    onDone()
    clearWorkDraft(fastStockInDraftKey)
    onClose()
  }

  const performCommit = async () => {
    if (saving) return
    let lines = received
    const pending = lines.filter((line) => line.status !== 'saved')
    if (!pending.length) { finishSession(); return }
    if (refuseDestination(pending)) return
    if (!(Number(branchId) > 0)) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
    if (!canEditCosts && pending.some((line) => line.mode === 'add' && line.quantity + line.freeQuantity > 0)) {
      notify(tr('product_cost_edit_required', 'Cost edit permission is required to receive stock.'), 'error')
      return
    }
    setSaving(true)
    let failed = 0

    // 1. New products first, each id durable before the next request.
    for (const line of pending.filter(lineNeedsCreate)) {
      lines = applyLineOutcome(lines, line.key, { status: 'saving' })
      setReceived(lines)
      try {
        const id = await createHeldProduct(line)
        lines = lines.map((entry) => (entry.key === line.key ? { ...entry, product: { ...entry.product, id }, status: 'queued', detail: '' } : entry))
        setCreatedProductIds((prev) => [...prev, String(id)])
      } catch (error) {
        failed += 1
        const reviewPending = (error as { code?: string } | null)?.code === 'product_pending_review'
        lines = applyLineOutcome(lines, line.key, { status: 'error', detail: failureText(error, tr('error', 'Error')), ...(reviewPending ? { needsRemoval: true } : {}) })
      }
      persistSessionDraft(lines)
      setReceived(lines)
    }
    // A product created with nothing to receive is finished.
    lines = lines.map((line) => (line.status === 'queued' && line.createPayload && Number(line.product.id) > 0 && line.quantity === 0 && line.freeQuantity === 0
      ? { ...line, status: 'saved', detail: tr('product_created', 'Product created') }
      : line))
    // The paid amount covers every line; with a line missing, nothing is received this time.
    if (failed) {
      persistSessionDraft(lines)
      setReceived(lines)
      setSaving(false)
      setStep('items')
      notify(tr('stock_session_partial', '{n} line(s) could not be saved. Fix them and complete again.').replace('{n}', String(failed)), 'error')
      return
    }

    // 2. The stock lines, one request per round; answered rounds durable before the next.
    const toCommit = lines.filter((line) => line.status !== 'saved')
    let requestFailure = ''
    if (toCommit.length) {
      if (refuseDestination(toCommit)) { persistSessionDraft(lines); setReceived(lines); setSaving(false); return }
      const session = commitSessionBlock({ lines, paidAmount, paymentStatus, creditDueDate, canViewCosts })
      for (const line of toCommit) captureReceivingRequest(submissionsRef.current, line, buildLineRequest(line))
      try { persistSubmissionDraft(lines) } catch (error) {
        setSaving(false)
        notify(failureText(error, tr('failed', 'Failed')), 'error')
        return
      }
      let batched: FastStockInCommitLineResult[] | null = null
      const unsettled = new Set(toCommit.map((line) => line.key))
      lines = lines.map((line) => (unsettled.has(line.key) ? { ...line, status: 'saving' as const } : line))
      setReceived(lines)
      const foldRound = (settled: FastStockInCommitSettled) => {
        for (const { index, result } of settled) {
          const line = toCommit[index]
          unsettled.delete(line.key)
          if (result?.ok) {
            lines = applyLineOutcome(lines, line.key, { status: 'saved', detail: describeLineResult(line, result as { lotCode?: string | null }) })
          } else if (isDeferredStockInResult(result)) {
            failed += 1
            lines = applyLineOutcome(lines, line.key, { status: 'queued', detail: '' })
          } else {
            failed += 1
            lines = applyLineOutcome(lines, line.key, {
              detail: failureText(result, tr('error', 'Error')),
              status: 'error',
              needsRemoval: stockLineNeedsRemoval(result),
            })
          }
        }
        persistSessionDraft(lines)
        setReceived(lines.map((item) => (unsettled.has(item.key) ? { ...item, status: 'saving' as const } : item)))
      }
      try {
        batched = await commitFastStockIn(toCommit.map(buildLineRequest), foldRound, { session })
      } catch (error) {
        requestFailure = String((error as { code?: unknown } | null)?.code || 'request')
        const message = failureText(error, error instanceof Error ? error.message : tr('error', 'Error'))
        // Only lines no round has answered: a line already saved must stay saved.
        failed += unsettled.size
        lines = lines.map((item) => (unsettled.has(item.key) ? { ...item, status: 'error' as const, detail: message } : item))
        persistSessionDraft(lines)
        setReceived(lines)
        batched = []
      }
      if (batched === null) {
        const sequential = await performCommitSequential(toCommit, lines)
        failed = sequential.failed
        lines = sequential.lines
      }
    }
    setSaving(false)
    const saved = pending.length - failed
    if (saved > 0) notify(tr('stock_session_completed', 'Received {count} stock-in line(s) successfully.').replace('{count}', String(saved)))
    if (failed) {
      onDone()
      setStep(requestFailure === 'supplier_total_mismatch' ? 'payment' : 'items')
      notify(tr('stock_session_partial', '{n} line(s) could not be saved. Fix them and complete again.').replace('{n}', String(failed)), 'error')
      return
    }
    finishSession()
  }

  // ---- payment ----
  const itemsTotal = sessionItemsTotal(received)
  const difference = paymentDifference(itemsTotal, paidAmount)
  const paymentRefusal = paymentStepRefusal({ itemsTotal, paidAmount, paymentStatus, creditDueDate, canViewCosts })
  const paymentLines = received.filter((line) => line.mode === 'add' && line.status !== 'saved')

  const matchPaid = (force: boolean) => {
    if (detailsLocked) return
    if (paidAmount.trim() === '' || (!force && Math.abs(difference) <= 0.005)) return
    const result = applyPaidToLines(received, paidAmount)
    if (!result.ok) {
      notify(result.code === 'items_total_zero'
        ? tr('items_total_zero', 'Items total is 0')
        : tr(STOCK_RECEIPT_GATE_KEYS.free_goods_required, STOCK_RECEIPT_GATE_FALLBACKS.free_goods_required), 'error')
      return
    }
    persistSessionDraft(result.lines)
    setReceived(result.lines)
  }
  const resetCosts = () => {
    if (detailsLocked) return
    const next = resetLineCosts(received)
    persistSessionDraft(next)
    setReceived(next)
    setPaidAmount('')
  }
  const setLineCost = (key: string, value: string) => {
    if (detailsLocked) return
    setReceived((prev) => prev.map((line) => (line.key === key ? { ...line, typedUnitCost: line.typedUnitCost ?? line.unitCost, unitCost: value } : line)))
  }

  // ---- steps ----
  const stepIndex = steps.indexOf(currentStep)
  const goBack = stepIndex > 0 ? () => setStep(steps[stepIndex - 1]) : undefined
  // The item to fix goes back to Items, marked; an empty item opens its free row.
  const refuseLines = (linesRefusal: SessionLinesRefusal) => {
    setLinesInvalidKey(linesRefusal.key)
    if (linesRefusal.field === 'qty') setFreeEditKey(linesRefusal.key)
    setSupplierRefused(linesRefusal.field === 'supplier')
    setStep('items')
    notify(tr(linesRefusal.messageKey, linesRefusal.fallback), 'error')
  }
  const goNext = () => {
    if (saving) return
    if (refuseDestination(pendingLines)) return
    if (currentStep === 'items') {
      if (!pendingLines.length) { if (received.length) finishSession(); return }
      if (!(Number(branchId) > 0)) { notify(tr('fast_stockin_pick_branch', 'Pick a branch'), 'error'); return }
      const linesRefusal = sessionLinesRefusal(received, { supplierName: supplier.supplierName })
      if (linesRefusal) { refuseLines(linesRefusal); return }
      setStep(steps[1])
      return
    }
    if (currentStep === 'payment') {
      const linesRefusal = sessionLinesRefusal(received, { supplierName: supplier.supplierName })
      if (linesRefusal) { refuseLines(linesRefusal); return }
      if (paymentRefusal) {
        notify(paymentRefusal === 'fast_stockin_credit_due'
          ? tr('fast_stockin_credit_due', 'Not Yet Paid stock needs a due date')
          : tr('supplier_total_mismatch', 'Paid to supplier does not match the items total'), 'error')
        return
      }
      setStep('review')
      return
    }
    void performCommit()
  }

  // ---- close / minimize ----
  const modeLabel = tr(STOCK_MODE_KEYS[mode].key, STOCK_MODE_KEYS[mode].fallback)
  const sessionLabel = `${modeLabel} ${tr('stock_session', 'Session')}`
  const closeDirty = fastStockInHasUnsavedWork({ ...currentDraft(), sessionId: 0 }, { ...init.pristine, sessionId: 0 })
  const preserveAndMinimize = () => {
    if (saving || !onMinimize) return
    flushPendingWorkDraft(fastStockInDraftKey)
    onMinimize(sessionLabel)
    onClose()
  }
  const discardAndClose = () => {
    clearWorkDraft(fastStockInDraftKey)
    if (received.some((line) => line.status === 'saved')) onDone()
    onClose()
  }
  const closeGuard = useCloseGuard({ dirty: closeDirty }, discardAndClose, onMinimize ? preserveAndMinimize : undefined)
  const requestCloseIfIdle = () => { if (!saving) closeGuard.requestClose() }
  const closeBackdropIfIdle = () => { if (!selectedGroup && !reasonsOpen) requestCloseIfIdle() }

  // ---- lot options ----
  const lotOptions = (() => {
    const newLabel = tr('received_date_new', 'New · {date}').replace('{date}', formatBatchReceivedDate(receivedDate) || receivedDate)
    if (!picked) return [{ value: mode === 'add' ? 'new' : 'none', label: mode === 'add' ? newLabel : tr('received_date', 'Received date'), disabled: true }]
    if (lotsKey && !lotsReady) return [{ value: String(batchChoice), label: tr('loading', 'Loading...'), disabled: true }]
    const lotRow = (lot: ProductBatch) => ({
      value: String(lot.id),
      label: `${batchDisplayLabel(lot, tr('batch', 'Received date'))} · ${lot.quantity}${mode === 'add' && lot.supplier_name ? ` · ${lot.supplier_name}` : ''}`,
    })
    if (mode === 'add') return [{ value: 'new', label: newLabel }, ...batchOptions.map(lotRow)]
    if (!lotChoices.length) return [{ value: 'none', label: `${tr('stock_set_branch_total', 'Branch total')} · ${branchQuantity}`, disabled: true }]
    return lotChoices.map(lotRow)
  })()

  const onLot = (value: string) => {
    if (value === 'new' || value === 'none') setBatchChoice(value)
    else if (Number(value) > 0) setBatchChoice(Number(value))
  }

  // ---- review ----
  const branchName = branchOptions.find((option) => String(option.value) === String(branchId))?.label || ''
  const reviewSummary = (() => {
    const first = [branchName, supplier.supplierName.trim()].filter(Boolean).join(' · ')
    if (!received.some((line) => line.mode === 'add')) return [first].filter(Boolean)
    const typedPaid = paidAmount.trim() === '' ? itemsTotal : Number(paidAmount)
    const amount = canViewCosts ? ` ${usdSymbol}${(Number.isFinite(typedPaid) ? typedPaid : itemsTotal).toFixed(2)}` : ''
    const payment = paymentStatus === 'credit'
      ? `${tr('on_credit', 'Not Yet Paid')}${amount}${creditDueDate ? ` · ${tr('due', 'Due')} ${formatBatchReceivedDate(creditDueDate) || creditDueDate}` : ''}`
      : `${tr('paid', 'Paid')}${amount}`
    return [first, `${formatBatchReceivedDate(receivedDate) || receivedDate} · ${payment}`].filter(Boolean)
  })()
  const reviews = currentStep === 'review' ? pendingLines.map((line) => reviewStockLine(line, branchId)) : []

  const footerPrimary = currentStep === 'review'
    ? tr('complete_session', 'Complete Session')
    : tr('next', 'Next')
  const footerDisabled = currentStep === 'items' ? !received.length : currentStep === 'payment' ? Boolean(paymentRefusal) : !pendingLines.length
  const footerTitle = currentStep === 'payment' && paymentRefusal
    ? (paymentRefusal === 'fast_stockin_credit_due' ? tr('fast_stockin_credit_due', 'Not Yet Paid stock needs a due date') : tr('supplier_total_mismatch', 'Paid to supplier does not match the items total'))
    : undefined
  const footerTotal = canViewCosts && received.some((line) => line.mode === 'add') ? `${usdSymbol}${itemsTotal.toFixed(2)}` : null
  const busy = saving

  if (createForm) {
    return (
      <Suspense fallback={null}>
        <ProductForm
          product={{ name: createForm.name, barcode: createForm.barcode, brand, supplier: supplier.supplierName, branch_id: branchId, stock_quantity: 0 }}
          draftScope={`fast-stock-in-${sessionIdRef.current}-${createForm.barcode || createForm.name}`}
          categories={createCategories}
          units={createUnits.length ? createUnits : [{ id: 'pcs', name: 'pcs' }]}
          branches={receivingBranchOptions.map((option) => ({ id: option.value, name: option.label, is_default: String(option.value) === String(defaultBranchId || '') }))}
          brandOptions={brandOptions}
          sessionDuplicateCheck={(candidate) => Boolean(findSessionProductDuplicate(duplicateRows, candidate))}
          onSave={(payload) => holdNewProduct((payload || {}) as Record<string, unknown>)}
          onClose={() => setCreateForm(null)}
          t={(key: string) => tr(key, key)}
          usdSymbol={usdSymbol}
          khrSymbol={khrSymbol}
          exchangeRate={exchangeRate}
          user={user}
        />
      </Suspense>
    )
  }

  return createPortal(
    <>
    {/* The option sheet and the reasons manager are SIBLINGS of this backdrop:
        React bubbles synthetic events through portals, so a press inside them
        would otherwise ask the float to close (tests/overlayNestedFloatBubbling.test.ts). */}
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={closeBackdropIfIdle}>
      <div
        ref={parentPanelRef}
        role="dialog"
        aria-modal="true"
        aria-label={sessionLabel}
        className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <StockSessionHeader
          mode={mode}
          onModeChange={changeMode}
          modeLocked={modeSwitchBlocked(received)}
          disabled={busy}
          tr={tr}
          onMinimize={onMinimize ? preserveAndMinimize : undefined}
          onClose={requestCloseIfIdle}
        />
        <StockSessionSteps steps={steps} current={currentStep} onStep={(next) => { if (next === 'items' || !refuseDestination(pendingLines)) setStep(next) }} disabled={busy} tr={tr} />

        <div className="modal-scroll space-y-2 px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
          {currentStep === 'items' ? (
            <>
              <StockSessionSharedDetails
                tr={tr}
                packLookup={packLookup}
                brand={brand}
                onBrand={setBrand}
                brandOptions={brandOptions || fallbackBrands || []}
                onRequestBrands={ensureBrands}
                supplier={supplier}
                onSupplier={(next) => {
                  setSupplier(next)
                  if (supplierRefused && next.supplierName.trim()) { setSupplierRefused(false); setLinesInvalidKey('') }
                }}
                supplierInvalid={invalidField === 'supplier' || (supplierRefused && !supplier.supplierName.trim())}
                branchId={branchId}
                onBranch={changeBranch}
                branchOptions={mode === 'add' ? receivingBranchOptions : branchOptions}
                branchInvalid={destinationInvalid}
                submissionLocked={detailsLocked}
                submissionMessage={stockFailureText({ code: submissionLockCode }, tr, '')}
                receivedDate={receivedDate}
                onReceivedDate={setReceivedDate}
                disabled={busy || detailsLocked}
              />
              <StockSessionLineEntry
                tr={tr}
                packLookup={packLookup}
                mode={mode}
                busy={busy || detailsLocked}
                searchInputRef={searchInputRef}
                query={query}
                onQuery={(text) => { setQuery(text); setPicked(null); setScannedBarcode(''); setCreatePayload(null) }}
                groups={candidateGroups.map((group) => ({ key: group.key, name: group.name, options: group.sellableItems.length || group.items.length, stock: group.stockTotal }))}
                onOpenGroup={(key) => { const group = candidateGroups.find((entry) => entry.key === key); if (group) setSelectedGroup(group) }}
                createText={createText}
                onCreate={openCreate}
                onScan={(value) => {
                  const barcode = String(value || '').trim()
                  setQuery(barcode)
                  setPicked(null)
                  setScannedBarcode(barcode)
                }}
                picked={picked}
                pickedStock={branchQuantity}
                pickedIsNew={Boolean(createPayload) || (picked ? createdProductIds.includes(String(picked.id)) : false)}
                onClearPick={() => { setEditingKey(''); resetLine() }}
                quantity={quantity}
                onQuantity={setQuantity}
                unitCost={unitCost}
                onUnitCost={setUnitCost}
                canViewCosts={canViewCosts}
                canEditCosts={canEditCosts}
                canReceive={canReceive}
                sellingPrice={sellingPrice}
                onSellingPrice={setSellingPrice}
                canEditPrice={canEditPrice || Boolean(createPayload)}
                expiryDate={expiryDate}
                onExpiryDate={setExpiryDate}
                lotOptions={lotOptions}
                lotValue={String(batchChoice)}
                onLot={onLot}
                conditionTag={conditionTag}
                onConditionTag={setConditionTag}
                tagDisabled={mode === 'set' && !setLowers}
                reason={reason}
                onReason={setReason}
                savedReasons={savedReasons}
                onManageReasons={canEditReasons ? () => setReasonsOpen(true) : undefined}
                onAdd={addLine}
                editing={Boolean(editingKey)}
                refusal={refusal ? refusalMessage : null}
                invalidField={invalidField}
              />
              <StockSessionItems
                lines={received}
                tr={tr}
                usdSymbol={usdSymbol}
                canViewCosts={canViewCosts}
                busy={busy}
                editingKey={editingKey}
                freeEditKey={freeEditKey}
                invalidKey={linesInvalidKey}
                canFree={canReceive && canEditCosts}
                onEdit={editLine}
                onRemove={removeLine}
                onFree={(key) => setFreeEditKey(key || '')}
                onFreeQuantity={setLineFree}
              />
            </>
          ) : currentStep === 'payment' ? (
            <StockSessionPaymentStep
              tr={tr}
              packLookup={packLookup}
              usdSymbol={usdSymbol}
              busy={busy || detailsLocked}
              paymentStatus={paymentStatus}
              onPaymentStatus={(next) => { setPaymentStatus(next); if (next === 'paid') setCreditDueDate('') }}
              creditDueDate={creditDueDate}
              onCreditDueDate={setCreditDueDate}
              dueInvalid={paymentStatus === 'credit' && !creditDueDate.trim()}
              canViewCosts={canViewCosts}
              canEditCosts={canEditCosts}
              paidAmount={paidAmount === '' ? String(itemsTotal) : paidAmount}
              onPaidAmount={setPaidAmount}
              onPaidBlur={() => matchPaid(false)}
              paidInvalid={paymentRefusal === 'supplier_total_mismatch'}
              itemsTotal={itemsTotal}
              difference={difference}
              lines={paymentLines}
              onLineCost={setLineCost}
              onMatch={() => matchPaid(true)}
              onReset={resetCosts}
              canReset={paymentLines.some((line) => line.typedUnitCost != null)}
            />
          ) : (
            <StockSessionReviewStep tr={tr} usdSymbol={usdSymbol} canViewCosts={canViewCosts} summary={reviewSummary} reviews={reviews} />
          )}
        </div>

        <StockSessionFooter
          tr={tr}
          onBack={goBack}
          itemsCount={received.length}
          total={footerTotal}
          primaryLabel={footerPrimary}
          onPrimary={goNext}
          primaryDisabled={footerDisabled}
          primaryTitle={footerTitle}
          saving={saving}
        />
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>

      {selectedGroup ? (
        <ProductOptionSheet
          product={{
            ...(selectedGroupChoices[0] || selectedGroup.leadProduct || selectedGroup.items[0]),
            name: selectedGroup.name,
          } as never}
          choices={selectedGroupChoices as never[]}
          t={(key: string) => tr(key, key)}
          fmtUSD={(value: number) => `${usdSymbol}${Number(value || 0).toFixed(2)}`}
          intent="stock"
          activeBranchId={branchId || defaultBranchId || null}
          pickLabel={tr('select', 'Select')}
          onClose={closeCandidateOptions}
          onPick={(candidate, selection) => pickFromGroup(candidate as unknown as ProductCandidate, selection)}
        />
      ) : null}

      {reasonsOpen ? (
        <Suspense fallback={null}>
          <StockReasonsManagerModal
            initialTab="adjust"
            layer="nested"
            onChanged={reloadReasons}
            onClose={() => { setReasonsOpen(false); reloadReasons() }}
          />
        </Suspense>
      ) : null}
    </>,
    document.body,
  )
}
