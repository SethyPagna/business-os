import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Modal from '../shared/Modal.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import {
  createInventorySession,
  type InventoryStockSessionLine,
  type InventoryStockSessionProduct,
} from '../../api/inventoryWriteTransport.ts'
import { searchProducts } from '../../api/methods.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { buildProductGroups, type ProductGroup, type ProductRecord } from '../../utils/productGrouping.ts'
import { getPermissionTierFromMap, parsePermissionMap } from '../../utils/permissions.ts'
import { isActionOverriddenOff } from '../../utils/permissionActions.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft, writeWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import { stockReceiptGateCode, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS } from '../../utils/stockReceiptFields.ts'
import InfoHint from '../shared/InfoHint.tsx'
import {
  canStartCreateProductsSession,
  createProductsSessionDefaults,
  emptyCreateProductsHeader,
  isCreateProductsHeaderDirty,
  summarizeCreateProductsSession,
  type CreateProductsHeader,
  type CreateProductsSessionDraft,
  type CreateProductsSessionRow,
} from '../../utils/createProductsSession.ts'
import type {
  BranchOption,
  CategoryOption,
  GroupCandidate,
  ProductUser,
  ProductFormState,
  UnitOption,
} from './forms/ProductForm'

const ProductForm = lazyRetry(() => import('./forms/ProductForm'), 'create-products-session-form')

type Translate = (key: string) => string
type AddProductsMode = 'new' | 'existing'
const STOCK_SESSION_MAX_LINES = 25
const STOCK_SESSION_MAX_BYTES = 64 * 1024

type ProductCandidate = ProductRecord & {
  id: number | string
  name?: string | null
  barcode?: string | null
  cost_price_usd?: number | string | null
  purchase_price_usd?: number | string | null
  branch_stock?: Array<{ branch_id?: number | string | null; branch_name?: string | null; quantity?: number | string | null }>
}

type SessionLine = {
  lineId: string
  kind: 'receive' | 'create_receive' | 'created_zero'
  productId: number | null
  product: InventoryStockSessionProduct | null
  name: string
  barcode: string
  brand: string
  supplierId: number | null
  supplierName: string
  supplierLocked?: boolean
  branchId: string
  branchName: string
  receivedDate: string
  expiryDate: string
  batchId: number | null
  batchLabel: string
  quantity: number
  unitCostUsd: number
  // Frozen at queue time, per line: the session-level declaration can be
  // toggled again for later lines, and each queued line must keep the answer
  // that was true when it was added.
  freeGoods: boolean
  status: 'queued' | 'saved'
  detail: string
}

type UnifiedSessionDraft = Omit<CreateProductsSessionDraft, 'rows'> & {
  rows?: CreateProductsSessionRow[]
  lines?: SessionLine[]
  mode?: AddProductsMode
  query?: string
  clientRequestId?: string
  freeGoods?: boolean
  submittedItems?: InventoryStockSessionLine[] | null
  submissionErrorCode?: string
}

type CreateProductsSessionModalProps = {
  categories: CategoryOption[]
  units: UnitOption[]
  branches: BranchOption[]
  brandOptions?: string[]
  groupCandidates?: GroupCandidate[]
  defaultBranchId?: string
  initialMode?: AddProductsMode
  allowNew?: boolean
  allowExisting?: boolean
  canReceiveStock?: boolean
  onPrepareProduct: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  onCreateProduct: (payload: Record<string, unknown>) => Promise<number | string>
  onClose: () => void
  onDone: () => void
  notify: (message: string, kind?: string) => void
  t: Translate
  usdSymbol: string
  khrSymbol: string
  exchangeRate: number
  user?: ProductUser | null
}

const PRODUCT_FIELDS = [
  'name', 'barcode', 'category', 'categories', 'unit', 'description', 'tag_label',
  'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  'cost_price_usd', 'cost_price_khr', 'low_stock_threshold', 'out_of_stock_threshold',
  'image_path', 'image_gallery', 'is_active', 'supplier', 'custom_fields', 'brand', 'brands',
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd',
  'discount_amount_khr', 'discount_label', 'discount_badge_color', 'discount_starts_at',
  'discount_ends_at', 'expiry_date', 'expiry_alert_days',
] as const

const PRODUCT_NUMBER_FIELDS = new Set([
  'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  'cost_price_usd', 'cost_price_khr', 'low_stock_threshold', 'out_of_stock_threshold',
  'discount_percent', 'discount_amount_usd', 'discount_amount_khr', 'expiry_alert_days',
])

function stockSessionProduct(payload: Record<string, unknown>): InventoryStockSessionProduct {
  const product: InventoryStockSessionProduct = {}
  for (const field of PRODUCT_FIELDS) {
    if (!(field in payload)) continue
    const value = payload[field]
    if (PRODUCT_NUMBER_FIELDS.has(field)) {
      const parsed = Number(value)
      product[field] = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    } else if (field === 'discount_enabled' || field === 'is_active') {
      product[field] = Boolean(value)
    } else {
      product[field] = value
    }
  }
  return product
}

function currentCost(product: ProductCandidate | null): number {
  const parsed = Number(product?.cost_price_usd ?? product?.purchase_price_usd ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function isDefinitiveNoWriteStockSessionError(error: unknown): boolean {
  const failure = error as { status?: unknown; code?: unknown } | null
  const status = Number(failure?.status)
  const code = String(failure?.code || '')
  if ([400, 403, 404].includes(status)) return true
  return status === 409 && !!code && code !== 'idempotency_conflict'
}

function stockSessionErrorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code || '')
}

function hasAllPermission(value: unknown): boolean {
  const parsed = parsePermissionMap(value)
  return parsed.all === true
}

function canCommitProductCreateInStockSession(user?: ProductUser | null): boolean {
  // Runtime callers always provide the actor. Keep the permissive fallback
  // only for older/test callers that predate this prop; a real Review-tier
  // actor must continue through the ordinary product review workflow.
  if (!user) return true
  const merged = {
    ...parsePermissionMap(user.role_permissions),
    ...parsePermissionMap(user.permissions),
  }
  const admin = String(user.username || '').trim().toLowerCase() === 'admin'
    || String(user.role_code || '').trim().toLowerCase() === 'admin'
    || hasAllPermission(user.role_permissions)
    || hasAllPermission(user.permissions)
  return getPermissionTierFromMap(merged, 'products', admin) === 'full'
    && !isActionOverriddenOff(merged, 'products', 'add')
}

function quantityAtBranch(product: ProductCandidate, branchId: string): number {
  const entry = (product.branch_stock || []).find((row) => String(row.branch_id ?? '') === String(branchId))
  const value = Number(entry?.quantity ?? product.stock_quantity ?? 0)
  return Number.isFinite(value) ? value : 0
}

function legacyLines(rows: CreateProductsSessionRow[] = []): SessionLine[] {
  return rows.map((row, index) => ({
    lineId: `legacy_${String(row.productId || index)}_${index}`,
    kind: 'created_zero',
    productId: Number(row.productId) || null,
    product: null,
    name: row.name,
    barcode: row.barcode,
    brand: row.brand,
    supplierId: null,
    supplierName: row.supplierName,
    branchId: row.branchId,
    branchName: row.branchName,
    receivedDate: '',
    expiryDate: '',
    batchId: null,
    batchLabel: row.lotCode,
    quantity: row.quantity,
    unitCostUsd: row.unitCostUsd,
    // A pre-N14-D draft never declared it, and a resumed draft must not
    // acquire a declaration nobody made.
    freeGoods: false,
    status: 'saved',
    detail: row.detail,
  }))
}

export default function CreateProductsSessionModal({
  categories,
  units,
  branches,
  brandOptions = [],
  groupCandidates = [],
  defaultBranchId = '',
  initialMode = 'new',
  allowNew = true,
  allowExisting = true,
  canReceiveStock = true,
  onPrepareProduct,
  onCreateProduct,
  onClose,
  onDone,
  notify,
  t,
  usdSymbol,
  khrSymbol,
  exchangeRate,
  user,
}: CreateProductsSessionModalProps) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const packLookup = (key: string): string | undefined => tr(key, '') || undefined
  const resolvedDefaultBranchId = String(defaultBranchId || (branches.find((branch) => branch.is_default) || branches[0])?.id || '')
  const draftKey = scopedWorkDraftKey('create_products_session')
  const draftRef = useRef<UnifiedSessionDraft | null>(readWorkDraft<UnifiedSessionDraft>(draftKey)?.data ?? null)
  const draft = draftRef.current
  const sessionIdRef = useRef(draft?.sessionId || Date.now())
  const sessionRequestIdRef = useRef(draft?.clientRequestId || `stockin_${sessionIdRef.current}`)
  const parentContentRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchSeqRef = useRef(0)
  const batchLoadKeyRef = useRef('')
  const batchChoiceSeedRef = useRef<number | null>(null)
  const canCommitProductAdd = canCommitProductCreateInStockSession(user)

  const [header, setHeader] = useState<CreateProductsHeader>(() => draft?.header
    ? { ...draft.header, branchId: draft.header.branchId || resolvedDefaultBranchId }
    : emptyCreateProductsHeader(resolvedDefaultBranchId))
  const [receivedDate, setReceivedDate] = useState(draft?.receivedDate || todayStr())
  // Free goods is a fact about the DELIVERY, so it lives with the other
  // once-entered shared details rather than being asked per line. Each queued
  // line still freezes its own copy.
  const [freeGoods, setFreeGoods] = useState(draft?.freeGoods === true)
  const [rows, setRows] = useState<SessionLine[]>(() => draft?.lines || legacyLines(draft?.rows))
  const [submittedItems, setSubmittedItems] = useState<InventoryStockSessionLine[] | null>(() => draft?.submittedItems || null)
  const [submissionErrorCode, setSubmissionErrorCode] = useState(draft?.submissionErrorCode || '')
  const [step, setStep] = useState<'header' | 'items'>(draft?.step === 'items' ? 'items' : 'header')
  const firstAvailableMode: AddProductsMode = allowNew ? 'new' : 'existing'
  const restoredMode = draft?.mode === 'new' || draft?.mode === 'existing' ? draft.mode : initialMode
  const [mode, setMode] = useState<AddProductsMode>(
    (restoredMode === 'new' && allowNew) || (restoredMode === 'existing' && allowExisting) ? restoredMode : firstAvailableMode,
  )
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [itemFormSeq, setItemFormSeq] = useState(() => rows.length)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [commitError, setCommitError] = useState('')
  const [query, setQuery] = useState(draft?.query || '')
  const [candidates, setCandidates] = useState<ProductCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<ProductCandidate | null>(null)
  const [lineBranchId, setLineBranchId] = useState(resolvedDefaultBranchId)
  const [lineSupplier, setLineSupplier] = useState<SupplierChoice>({ supplierId: null, supplierName: '' })
  const [lineReceivedDate, setLineReceivedDate] = useState(receivedDate)
  const [lineQuantity, setLineQuantity] = useState('1')
  const [lineUnitCost, setLineUnitCost] = useState('')
  const [lineExpiryDate, setLineExpiryDate] = useState('')
  const [batchChoice, setBatchChoice] = useState<'new' | number>('new')
  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchFailed, setBatchFailed] = useState(false)
  const [exactBatchLoadKey, setExactBatchLoadKey] = useState('')
  const submissionLocked = submittedItems !== null
  const idempotencyConflict = submissionLocked && submissionErrorCode === 'idempotency_conflict'

  const branchSelectOptions = useMemo(() => branches.map((branch) => ({ value: String(branch.id ?? ''), label: String(branch.name || branch.id || '') })), [branches])
  const itemUnits = useMemo(() => units.length ? units : [{ id: 'pcs', name: 'pcs' }], [units])
  const itemDefaults = useMemo(() => createProductsSessionDefaults(header), [header])
  const itemCreateDefaults = useMemo(() => ({ ...itemDefaults, received_date: receivedDate }), [itemDefaults, receivedDate])
  const editingLine = useMemo(() => rows.find((row) => row.lineId === editingLineId && row.status === 'queued') || null, [editingLineId, rows])
  const editingNewLine = editingLine?.kind === 'create_receive' ? editingLine : null
  const editingExistingLine = editingLine?.kind === 'receive' ? editingLine : null
  const branchNameFor = (branchId: string): string => branchSelectOptions.find((option) => option.value === String(branchId))?.label || ''
  const productsById = useMemo(() => new Map<unknown, ProductRecord>(candidates.map((product) => [product.id, product])), [candidates])
  const groups = useMemo(() => buildProductGroups(candidates, productsById, { preserveInputOrder: true }), [candidates, productsById])
  const groupOptions = useMemo(() => {
    if (!selectedGroup) return [] as ProductCandidate[]
    return (selectedGroup.sellableItems.length ? selectedGroup.sellableItems : selectedGroup.items) as ProductCandidate[]
  }, [selectedGroup])
  const summaryRows = useMemo<CreateProductsSessionRow[]>(() => rows.map((row) => ({
    key: row.lineId, productId: row.productId || row.lineId, name: row.name, barcode: row.barcode,
    brand: row.brand, supplierName: row.supplierName, branchId: row.branchId, branchName: row.branchName,
    quantity: row.quantity, unitCostUsd: row.unitCostUsd, lotCode: row.batchLabel,
    status: 'created', detail: row.detail,
  })), [rows])
  const summary = useMemo(() => {
    const baseSummary = summarizeCreateProductsSession(summaryRows, header, {
      multipleBrands: tr('multiple_brands', 'Multiple brands'),
      multipleSuppliers: tr('mixed_suppliers', 'Multiple suppliers'),
      multipleBranches: tr('multiple_branches', 'Multiple branches'),
      none: tr('none', 'None'),
    })
    return rows.length ? baseSummary : { ...baseSummary, branch: branchNameFor(header.branchId) || baseSummary.branch }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryRows, rows.length, header, branchSelectOptions, t])

  useEffect(() => scheduleWorkDraftWrite<UnifiedSessionDraft>(draftKey, {
    sessionId: sessionIdRef.current, clientRequestId: sessionRequestIdRef.current, header, rows: [], lines: rows,
    step, receivedDate, freeGoods, mode, query, submittedItems, submissionErrorCode,
  }), [draftKey, header, rows, step, receivedDate, freeGoods, mode, query, submittedItems, submissionErrorCode])

  useEffect(() => {
    if (!resolvedDefaultBranchId) return
    setHeader((prev) => prev.branchId ? prev : { ...prev, branchId: resolvedDefaultBranchId })
    setLineBranchId((prev) => prev || resolvedDefaultBranchId)
  }, [resolvedDefaultBranchId])

  useEffect(() => {
    const seq = ++searchSeqRef.current
    const invalidate = () => { if (searchSeqRef.current === seq) searchSeqRef.current += 1 }
    if (mode !== 'existing' || selectedGroup || query.trim().length < 2) {
      setCandidates([]); setSearching(false); setSearchFailed(false); return invalidate
    }
    const text = query.trim()
    const timer = window.setTimeout(() => {
      setSearching(true); setSearchFailed(false)
      void searchProducts({ query: text, pageSize: 8 })
        .then((payload) => {
          if (seq !== searchSeqRef.current) return
          const items = (payload as { items?: ProductCandidate[] })?.items
          setCandidates(Array.isArray(items) ? items : [])
        })
        .catch((error: unknown) => {
          if (seq !== searchSeqRef.current || (error instanceof Error && error.name === 'AbortError')) return
          setCandidates([]); setSearchFailed(true)
        })
        .finally(() => { if (seq === searchSeqRef.current) setSearching(false) })
    }, 250)
    return () => { window.clearTimeout(timer); invalidate() }
  }, [mode, query, selectedGroup])

  useEffect(() => {
    const dialog = parentContentRef.current?.closest('[role="dialog"]')
    if (!dialog || (!itemFormOpen && !selectedGroup && !editingExistingLine)) return
    dialog.setAttribute('inert', '')
    dialog.setAttribute('aria-hidden', 'true')
    return () => { dialog.removeAttribute('inert'); dialog.removeAttribute('aria-hidden') }
  }, [itemFormOpen, selectedGroup, editingExistingLine])

  useEffect(() => {
    if (!selectedGroup) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); closeExistingOptions()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  })

  useEffect(() => {
    const productId = Number(selectedProduct?.id || 0)
    const branchId = Number(lineBranchId || 0)
    const loadKey = productId && branchId ? `${productId}:${branchId}` : ''
    batchLoadKeyRef.current = loadKey
    const seededBatchId = batchChoiceSeedRef.current
    setBatchOptions([]); setBatchChoice('new'); setExactBatchLoadKey(''); setBatchFailed(false)
    if (!loadKey) { setBatchLoading(false); return }
    setBatchLoading(true)
    void getProductBatches(productId, branchId, false)
      .then((payload) => {
        if (batchLoadKeyRef.current !== loadKey) return
        const batches = Array.isArray(payload?.batches) ? payload.batches : []
        setBatchOptions(batches)
        setBatchChoice(seededBatchId && batches.some((batch) => Number(batch.id) === seededBatchId) ? seededBatchId : 'new')
        batchChoiceSeedRef.current = null
        setExactBatchLoadKey(loadKey)
      })
      .catch(() => {
        if (batchLoadKeyRef.current === loadKey) {
          batchChoiceSeedRef.current = null
          setBatchFailed(true)
        }
      })
      .finally(() => { if (batchLoadKeyRef.current === loadKey) setBatchLoading(false) })
  }, [selectedProduct?.id, lineBranchId])

  const resetExistingCandidate = () => {
    batchChoiceSeedRef.current = null
    setSelectedProduct(null); setLineBranchId(header.branchId || resolvedDefaultBranchId)
    setLineSupplier({ supplierId: header.supplierId, supplierName: header.supplierName })
    setLineReceivedDate(receivedDate); setLineQuantity('1'); setLineUnitCost(''); setLineExpiryDate('')
    setBatchOptions([]); setBatchChoice('new'); setBatchFailed(false); setExactBatchLoadKey('')
  }
  const openExistingOptions = (group: ProductGroup) => { resetExistingCandidate(); setSelectedGroup(group) }
  function closeExistingOptions() {
    setSelectedGroup(null); resetExistingCandidate()
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }
  const selectExistingProduct = (product: ProductCandidate) => {
    setSelectedProduct(product); setLineUnitCost(String(currentCost(product))); setLineExpiryDate(String(product.expiry_date || ''))
  }

  const queueExistingLine = (replaceLineId?: string) => {
    if (submissionLocked) return
    if (!replaceLineId && rows.filter((row) => row.status === 'queued').length >= STOCK_SESSION_MAX_LINES) {
      notify(`${tr('limit', 'Limit')}: ${STOCK_SESSION_MAX_LINES}`, 'error'); return
    }
    if (!selectedProduct) return
    const productId = Number(selectedProduct.id)
    const branchId = Number(lineBranchId)
    const quantity = Number(lineQuantity)
    const unitCostText = lineUnitCost.trim()
    const unitCostUsd = Number(unitCostText)
    const expectedLoadKey = `${productId}:${branchId}`
    if (!productId || !branchId || !Number.isSafeInteger(quantity) || quantity <= 0) {
      notify(tr('invalid_quantity', 'Invalid quantity'), 'error'); return
    }
    if (!unitCostText || !Number.isFinite(unitCostUsd) || unitCostUsd < 0) {
      notify(`${tr('unit_cost_usd', 'Unit cost (USD)')}: ${tr('enter_amount', 'Enter Amount')}`, 'error'); return
    }
    if (batchLoading || batchFailed || exactBatchLoadKey !== expectedLoadKey) {
      notify(tr('load_failed', 'Could not load stock batches.'), 'error'); return
    }
    const chosenBatch = typeof batchChoice === 'number' ? batchOptions.find((batch) => Number(batch.id) === batchChoice) || null : null
    const lotAttributedName = chosenBatch?.supplier_name?.trim() || ''
    // N14-D, same kernel the session writer runs. An attributed lot answers
    // the supplier half; nothing answers the cost half but the operator.
    const receiptGate = stockReceiptGateCode({
      isStockIn: quantity > 0,
      supplierName: lineSupplier.supplierName,
      lotSupplierName: lotAttributedName,
      unitCostUsd: unitCostText,
      freeGoods,
    })
    if (receiptGate) {
      notify(tr(STOCK_RECEIPT_GATE_KEYS[receiptGate], STOCK_RECEIPT_GATE_FALLBACKS[receiptGate]), 'error'); return
    }
    const row: SessionLine = {
      lineId: replaceLineId || `receive_${productId}_${Date.now()}_${rows.length}`, kind: 'receive', productId, product: null,
      name: String(selectedProduct.name || `#${productId}`), barcode: String(selectedProduct.barcode || ''), brand: String(selectedProduct.brand || ''),
      supplierId: lotAttributedName || lineSupplier.supplierId == null
        ? null
        : Number(lineSupplier.supplierId),
      supplierName: lotAttributedName || lineSupplier.supplierName.trim(), supplierLocked: Boolean(lotAttributedName),
      branchId: String(branchId), branchName: branchNameFor(String(branchId)), receivedDate: lineReceivedDate || receivedDate,
      expiryDate: lineExpiryDate, batchId: chosenBatch ? Number(chosenBatch.id) : null,
      batchLabel: chosenBatch ? batchDisplayLabel(chosenBatch, tr('batch', 'Batch')) : tr('new_batch', '+ New batch'),
      quantity, unitCostUsd, freeGoods,
      status: 'queued', detail: tr('ready_to_receive', 'Ready'),
    }
    setRows((prev) => replaceLineId ? prev.map((entry) => entry.lineId === replaceLineId ? row : entry) : [row, ...prev])
    setCommitError(''); setSubmissionErrorCode(''); setQuery('')
    if (replaceLineId) { setEditingLineId(null); resetExistingCandidate() } else closeExistingOptions()
  }

  const writeDraft = () => writeWorkDraft<UnifiedSessionDraft>(draftKey, {
    sessionId: sessionIdRef.current, clientRequestId: sessionRequestIdRef.current, header, rows: [], lines: rows,
    step: 'items', receivedDate, mode, query, submittedItems, submissionErrorCode,
  })
  const openItemForm = () => {
    if (submissionLocked) return
    setEditingLineId(null); writeDraft(); setItemFormOpen(true)
  }
  const closeItemForm = () => { setItemFormOpen(false); setEditingLineId(null) }

  const openQueuedLine = (line: SessionLine) => {
    // submittedItems is the exact payload whose outcome may be unknown. It is
    // immutable until the same request resolves or a definitive no-write
    // response unlocks it; never offer an editor that can diverge from it.
    if (submissionLocked || saving || line.status !== 'queued') return
    setCommitError(''); setSubmissionErrorCode(''); setEditingLineId(line.lineId)
    if (line.kind === 'create_receive') {
      writeDraft(); setItemFormOpen(true); return
    }
    if (line.kind !== 'receive' || !line.productId) return
    batchChoiceSeedRef.current = line.batchId
    setSelectedProduct({
      id: line.productId,
      name: line.name,
      barcode: line.barcode,
      brand: line.brand,
      cost_price_usd: line.unitCostUsd,
      expiry_date: line.expiryDate,
    })
    setLineBranchId(line.branchId)
    setLineSupplier({ supplierId: line.supplierId, supplierName: line.supplierName })
    setLineReceivedDate(line.receivedDate)
    setLineQuantity(String(line.quantity))
    setLineUnitCost(String(line.unitCostUsd))
    setLineExpiryDate(line.expiryDate)
  }

  const saveNewItem = async (payload: Record<string, unknown>) => {
    if (saving) throw new Error(tr('saving_label', 'Saving…'))
    const quantityValue = payload.stock_quantity == null || payload.stock_quantity === '' ? 0 : Number(payload.stock_quantity)
    if (!Number.isSafeInteger(quantityValue) || quantityValue < 0) throw new Error(tr('invalid_quantity', 'Invalid quantity'))
    const quantity = quantityValue
    const branchId = Number(payload.branch_id ?? header.branchId)
    const name = String(payload.name || '').trim()
    const barcode = String(payload.barcode || '').trim()
    // N14-D: a blank cost is NOT zero. It used to become 0 here, which records
    // the goods as free -- a claim nobody made -- and the session writer then
    // filled its own blank from the product's cost_price_usd. Both guesses are
    // gone; a receipt states its cost or it is refused, here and on the wire.
    const costText = payload.cost_price_usd == null ? '' : String(payload.cost_price_usd).trim()
    const costValue = Number(costText)
    if (costText === '' || !Number.isFinite(costValue) || costValue < 0) throw new Error(`${tr('unit_cost_usd', 'Unit cost (USD)')}: ${tr('enter_amount', 'Enter Amount')}`)
    const cost = costValue
    if (!name || !branchId) throw new Error(tr('create_products_branch_required', 'Choose the branch this delivery goes to.'))
    // The same supplier the session writer now requires on every line that
    // moves stock. A zero-quantity create is catalogue work and carries none.
    const receiptSupplier = String(payload.supplier ?? header.supplierName ?? '').trim()
    const receiptGate = stockReceiptGateCode({ isStockIn: quantity > 0, supplierName: receiptSupplier, unitCostUsd: costText, freeGoods })
    if (receiptGate) throw new Error(tr(STOCK_RECEIPT_GATE_KEYS[receiptGate], STOCK_RECEIPT_GATE_FALLBACKS[receiptGate]))
    const queuedTwin = rows.find((row) => row.kind === 'create_receive' && row.name.trim().toLowerCase() === name.toLowerCase()
      && row.barcode.trim() === barcode && Math.round(row.unitCostUsd * 10000) === Math.round((Number.isFinite(cost) ? cost : 0) * 10000))
    if (queuedTwin) throw new Error(tr('create_match_twin_title', 'Product already exists'))
    setSaving(true)
    try {
      if (quantity === 0 && !canCommitProductAdd) {
        // Review-tier product creation must keep using the registered product
        // review workflow. The atomic session endpoint deliberately requires
        // Full products:add and must never bypass that approval boundary.
        const productId = await onCreateProduct({ ...payload, stock_quantity: 0 })
        const row: SessionLine = {
          lineId: `created_${String(productId)}_${Date.now()}`, kind: 'created_zero', productId: Number(productId) || null, product: null,
          name, barcode, brand: String(payload.brand ?? header.brand ?? '').trim(), supplierId: null,
          supplierName: String(payload.supplier ?? header.supplierName ?? '').trim(), branchId: String(branchId), branchName: branchNameFor(String(branchId)),
          receivedDate: String(payload.received_date || receivedDate), expiryDate: String(payload.expiry_date || ''), batchId: null, batchLabel: '', quantity: 0,
          unitCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : 0, freeGoods, status: 'saved', detail: tr('product_created', 'Product created'),
        }
        setRows((prev) => [row, ...prev]); onDone()
      } else {
        if (quantity > 0 && !canReceiveStock) throw new Error(tr('no_permission', 'You do not have permission to receive stock.'))
        if (rows.filter((row) => row.status === 'queued').length >= STOCK_SESSION_MAX_LINES) {
          throw new Error(`${tr('limit', 'Limit')}: ${STOCK_SESSION_MAX_LINES}`)
        }
        const prepared = await onPrepareProduct(payload)
        const supplierName = String(payload.supplier ?? header.supplierName ?? '').trim()
        const sameSupplier = supplierName.toLowerCase() === header.supplierName.trim().toLowerCase()
        const row: SessionLine = {
          lineId: `create_${Date.now()}_${rows.length}`, kind: 'create_receive', productId: null, product: stockSessionProduct(prepared),
          name, barcode, brand: String(payload.brand ?? header.brand ?? '').trim(), supplierId: sameSupplier ? header.supplierId : null,
          supplierName, branchId: String(branchId), branchName: branchNameFor(String(branchId)), receivedDate: String(payload.received_date || receivedDate),
          expiryDate: String(payload.expiry_date || ''), batchId: null, batchLabel: quantity > 0 ? tr('new_batch', '+ New batch') : '', quantity,
          unitCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : 0, freeGoods, status: 'queued', detail: tr('ready_to_receive', 'Ready'),
        }
        setRows((prev) => [row, ...prev])
      }
      setCommitError(''); setSubmissionErrorCode(''); closeItemForm(); setItemFormSeq((seq) => seq + 1)
    } catch (error) {
      throw error instanceof Error ? error : new Error(tr('failed', 'Failed'))
    } finally { setSaving(false) }
  }

  const saveEditedNewLine = async (lineId: string, payload: Record<string, unknown>) => {
    if (saving || submissionLocked) throw new Error(tr('saving_label', 'Saving…'))
    const current = rows.find((row) => row.lineId === lineId && row.kind === 'create_receive' && row.status === 'queued')
    if (!current) throw new Error(tr('failed', 'Failed'))
    const quantity = Number(payload.stock_quantity)
    const branchId = Number(payload.branch_id)
    const name = String(payload.name || '').trim()
    const barcode = String(payload.barcode || '').trim()
    // Same rule as adding the line. Number('') is 0, so reading the cost
    // straight off the payload turned a cleared field into a free receipt on
    // the way back through the editor.
    const costText = payload.cost_price_usd == null ? '' : String(payload.cost_price_usd).trim()
    const cost = Number(costText)
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error(tr('invalid_quantity', 'Invalid quantity'))
    if (quantity > 0 && !canReceiveStock) throw new Error(tr('no_permission', 'You do not have permission to receive stock.'))
    if (!branchId || !name) throw new Error(tr('create_products_branch_required', 'Choose the branch this delivery goes to.'))
    if (costText === '' || !Number.isFinite(cost) || cost < 0) throw new Error(`${tr('unit_cost_usd', 'Unit cost (USD)')}: ${tr('enter_amount', 'Enter Amount')}`)
    const editGate = stockReceiptGateCode({
      isStockIn: quantity > 0,
      supplierName: String(payload.supplier ?? current.supplierName ?? header.supplierName ?? '').trim(),
      unitCostUsd: costText,
      freeGoods,
    })
    if (editGate) throw new Error(tr(STOCK_RECEIPT_GATE_KEYS[editGate], STOCK_RECEIPT_GATE_FALLBACKS[editGate]))
    const queuedTwin = rows.find((row) => row.lineId !== lineId && row.kind === 'create_receive'
      && row.name.trim().toLowerCase() === name.toLowerCase() && row.barcode.trim() === barcode
      && Math.round(row.unitCostUsd * 10000) === Math.round(cost * 10000))
    if (queuedTwin) throw new Error(tr('create_match_twin_title', 'Product already exists'))
    setSaving(true)
    try {
      const prepared = await onPrepareProduct(payload)
      const supplierName = String(payload.supplier ?? current.supplierName ?? header.supplierName ?? '').trim()
      const sameSupplier = supplierName.toLowerCase() === header.supplierName.trim().toLowerCase()
      const updated: SessionLine = {
        ...current,
        // Stable line identity is part of the idempotency key. Editing replaces
        // its content in place; it never manufactures a new logical line.
        lineId,
        product: stockSessionProduct(prepared),
        name,
        barcode,
        brand: String(payload.brand ?? current.brand ?? header.brand ?? '').trim(),
        supplierId: sameSupplier ? header.supplierId : null,
        supplierName,
        branchId: String(branchId),
        branchName: branchNameFor(String(branchId)),
        receivedDate: String(payload.received_date || current.receivedDate || receivedDate),
        expiryDate: String(payload.expiry_date || ''),
        batchId: null,
        batchLabel: quantity > 0 ? tr('new_batch', '+ New batch') : '',
        quantity,
        unitCostUsd: cost,
      }
      setRows((prev) => prev.map((row) => row.lineId === lineId ? updated : row))
      setCommitError(''); setSubmissionErrorCode(''); closeItemForm()
    } catch (error) {
      throw error instanceof Error ? error : new Error(tr('failed', 'Failed'))
    } finally { setSaving(false) }
  }

  const removeLine = (lineId: string) => { if (!saving && !submissionLocked) setRows((prev) => prev.filter((row) => row.lineId !== lineId || row.status === 'saved')) }

  const sessionLine = (line: SessionLine): InventoryStockSessionLine => {
    if (line.kind === 'create_receive' && Number(line.quantity) === 0) {
      // Catalog-only creates intentionally carry no receipt/lot/AP fields.
      // The server still validates branch/date identity, then returns null
      // batch and movement ids in the immutable session receipt.
      return {
        line_id: line.lineId,
        kind: 'create_receive',
        branch_id: Number(line.branchId),
        quantity: 0,
        received_date: line.receivedDate,
        product: line.product || {},
      }
    }
    const common = {
      line_id: line.lineId,
      branch_id: Number(line.branchId),
      quantity: Number(line.quantity),
      batch_id: line.batchId == null ? null : Number(line.batchId),
      // An attributed lot keeps its first supplier server-side. Reflect that
      // lock on screen and omit any replacement attribution on the wire.
      supplier_id: line.supplierLocked || line.supplierId == null ? null : Number(line.supplierId),
      supplier_name: line.supplierLocked ? null : (line.supplierName || null),
      received_date: line.receivedDate,
      expiry_date: line.expiryDate || null,
      notes: tr('create_products_session_title', 'Add/Create Products Session'),
      unit_cost_usd: Number(line.unitCostUsd),
      free_goods: line.freeGoods === true,
      payment_status: null,
      credit_due_date: null,
    }
    return line.kind === 'receive'
      ? { ...common, kind: 'receive', product_id: Number(line.productId) }
      : { ...common, kind: 'create_receive', product: line.product || {} }
  }

  const finishSession = async () => {
    if (saving || idempotencyConflict) return
    const pending = rows.filter((row) => row.status === 'queued')
    if (!pending.length && !submittedItems) {
      clearWorkDraft(draftKey); if (rows.length) onDone(); onClose(); return
    }
    const attemptItems = submittedItems || pending.map(sessionLine)
    const attemptPayload = {
      client_request_id: sessionRequestIdRef.current,
      mode: 'stock_in' as const,
      items: attemptItems,
    }
    if (attemptItems.length > STOCK_SESSION_MAX_LINES || new TextEncoder().encode(JSON.stringify(attemptPayload)).length > STOCK_SESSION_MAX_BYTES) {
      const message = `${tr('limit', 'Limit')}: ${STOCK_SESSION_MAX_LINES} / 64 KB`
      setCommitError(message); notify(message, 'error'); return
    }
    if (!submittedItems) {
      // Once a network write starts, persist and freeze its exact logical
      // payload. A lost success response can then be retried under the same
      // request/line ids without accidentally applying an edited second run.
      setSubmittedItems(attemptItems)
      writeWorkDraft<UnifiedSessionDraft>(draftKey, {
        sessionId: sessionIdRef.current, clientRequestId: sessionRequestIdRef.current, header,
        rows: [], lines: rows, step: 'items', receivedDate, mode, query, submittedItems: attemptItems, submissionErrorCode: '',
      })
    }
    setSaving(true); setCommitError(''); setSubmissionErrorCode('')
    try {
      const receipt = await createInventorySession(attemptPayload)
      notify(tr('stock_session_completed', 'Received {count} stock-in line(s) successfully.').replace('{count}', String(receipt.memberCount)), 'success')
      clearWorkDraft(draftKey); onDone(); onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('failed', 'Failed')
      const errorCode = stockSessionErrorCode(error)
      if (isDefinitiveNoWriteStockSessionError(error)) {
        // The server positively rejected this request before applying stock,
        // so correction may reuse the same known-unused request identity.
        // Unknown outcomes and idempotency conflicts stay frozen for exact retry.
        setSubmittedItems(null)
        setSubmissionErrorCode('')
        writeWorkDraft<UnifiedSessionDraft>(draftKey, {
          sessionId: sessionIdRef.current, clientRequestId: sessionRequestIdRef.current, header,
          rows: [], lines: rows, step: 'items', receivedDate, mode, query, submittedItems: null, submissionErrorCode: '',
        })
      } else {
        setSubmissionErrorCode(errorCode)
        writeWorkDraft<UnifiedSessionDraft>(draftKey, {
          sessionId: sessionIdRef.current, clientRequestId: sessionRequestIdRef.current, header,
          rows: [], lines: rows, step: 'items', receivedDate, mode, query,
          submittedItems: attemptItems, submissionErrorCode: errorCode,
        })
      }
      setCommitError(message); notify(message, 'error')
    } finally { setSaving(false) }
  }

  const headerDirty = isCreateProductsHeaderDirty(header, resolvedDefaultBranchId)
  const canStart = canStartCreateProductsSession(header)
  const closeIsGuarded = headerDirty && rows.length === 0 && !submissionLocked
  const requestClose = () => { if (!saving) { if (!rows.length && !submissionLocked) clearWorkDraft(draftKey); onClose() } }

  const editingNewProduct: ProductFormState | null = editingNewLine ? {
    ...(editingNewLine.product || {}),
    name: editingNewLine.name,
    barcode: editingNewLine.barcode,
    brand: editingNewLine.brand,
    supplier: editingNewLine.supplierName,
    branch_id: editingNewLine.branchId,
    stock_quantity: editingNewLine.quantity,
    received_date: editingNewLine.receivedDate,
    expiry_date: editingNewLine.expiryDate,
    cost_price_usd: editingNewLine.unitCostUsd,
  } : null
  const editingExistingDirty = Boolean(editingExistingLine && !batchLoading && (
    lineBranchId !== editingExistingLine.branchId
    || lineSupplier.supplierId !== editingExistingLine.supplierId
    || lineSupplier.supplierName !== editingExistingLine.supplierName
    || lineReceivedDate !== editingExistingLine.receivedDate
    || lineQuantity !== String(editingExistingLine.quantity)
    || lineUnitCost !== String(editingExistingLine.unitCostUsd)
    || lineExpiryDate !== editingExistingLine.expiryDate
    || batchChoice !== (editingExistingLine.batchId ?? 'new')
  ))

  const renderExistingLineFields = (onContinue: () => void) => selectedProduct ? (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-[11px] text-gray-500">{tr('branch', 'Branch')}</span><AppSelect value={lineBranchId} onChange={setLineBranchId} ariaLabel={tr('branch', 'Branch')} buttonClassName="h-9 w-full text-sm" options={branchSelectOptions} /></label>
        <SupplierPickerField value={lineSupplier} onChange={setLineSupplier} tr={(key, fallback) => tr(key, fallback || key)} idPrefix="create-products-existing-line" hintDisplay="tooltip" lockedName={typeof batchChoice === 'number' ? batchOptions.find((batch) => Number(batch.id) === batchChoice)?.supplier_name?.trim() || null : null} hint={typeof batchChoice === 'number' && !batchOptions.find((batch) => Number(batch.id) === batchChoice)?.supplier_name?.trim() ? tr('supplier_will_fill_lot', 'This lot has no supplier yet — your choice will be recorded on it.') : null} />
        <label><span className="mb-1 block text-[11px] text-gray-500">{tr('received_date', 'Received date')}</span><DateEntryInput className="h-9 w-full text-sm" t={packLookup} ariaLabel={tr('received_date', 'Received date')} value={lineReceivedDate} onChange={setLineReceivedDate} /></label>
        <label><span className="mb-1 block text-[11px] text-gray-500">{tr('expiry_optional', 'Expiry (optional)')}</span><DateEntryInput className="h-9 w-full text-sm" t={packLookup} ariaLabel={tr('expiry_optional', 'Expiry (optional)')} value={lineExpiryDate} onChange={setLineExpiryDate} /></label>
        <label><span className="mb-1 block text-[11px] text-gray-500">{tr('quantity', 'Quantity')}</span><input className="input h-9 w-full text-sm" type="number" min="1" step="1" value={lineQuantity} onChange={(event) => setLineQuantity(event.target.value)} /></label>
        <label><span className="mb-1 block text-[11px] text-gray-500">{tr('unit_cost_usd', 'Unit cost (USD)')}</span><input className="input h-9 w-full text-sm" type="number" min="0" step="0.01" value={lineUnitCost} onChange={(event) => setLineUnitCost(event.target.value)} /></label>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-[11px] text-gray-500">{tr('batch', 'Batch')}</span>
        {batchLoading ? <p className="text-xs text-gray-400">{tr('loading', 'Loading...')}</p> : batchFailed ? <p className="text-xs text-red-600">{tr('load_failed', 'Could not load stock batches.')}</p> : <div className="flex flex-wrap gap-1.5"><button type="button" className={batchChoice === 'new' ? 'rounded-full border border-blue-600 bg-blue-50 px-2.5 py-1 text-xs text-blue-700' : 'rounded-full border border-gray-300 px-2.5 py-1 text-xs'} onClick={() => setBatchChoice('new')}>{tr('new_batch', '+ New batch')}</button>{batchOptions.map((batch) => <button key={batch.id} type="button" className={batchChoice === Number(batch.id) ? 'rounded-full border border-blue-600 bg-blue-50 px-2.5 py-1 text-xs text-blue-700' : 'rounded-full border border-gray-300 px-2.5 py-1 text-xs'} onClick={() => setBatchChoice(Number(batch.id))}>{batchDisplayLabel(batch, tr('batch', 'Batch'))} ({batch.quantity})</button>)}</div>}
      </div>
      <button type="button" className="btn-primary mt-4 h-11 w-full text-sm disabled:opacity-50" disabled={batchLoading || batchFailed || exactBatchLoadKey !== `${Number(selectedProduct.id)}:${Number(lineBranchId)}`} onClick={onContinue}>{editingExistingLine ? tr('save_changes', 'Save changes') : tr('continue', 'Continue')}</button>
    </div>
  ) : null

  return (
    <>
      <Modal title={step === 'header' ? tr('create_products_session_title', 'Add/Create Products Session') : `${tr('create_products_session_title', 'Add/Create Products Session')} · ${summary.items}`} onClose={requestClose} size="lg" unsavedChanges={{ dirty: closeIsGuarded }}>
        <div ref={parentContentRef} className="space-y-4">
            <div className={`rounded-xl border p-3 ${step === 'header' ? 'border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
              {/* N1: the explanation used to be a paragraph under this title,
                  costing three lines of the fold before the first field. It is
                  the same sentence, moved behind the info affordance beside the
                  title, so the section opens on its inputs. */}
              <div className="mb-2 flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500"><span className="truncate">{tr('create_products_header_step', 'Shared details (entered once)')}</span><InfoHint label={tr('create_products_header_step', 'Shared details (entered once)')} text={tr('create_products_header_hint', 'Brand, supplier and branch apply to every product you add in this session — type them once.')} /></span>{step === 'items' ? <button type="button" disabled={submissionLocked} className="btn-secondary px-2 py-1 text-xs disabled:opacity-50" onClick={() => setStep('header')}>{tr('create_products_edit_header', 'Edit shared details')}</button> : null}</div>
            {step === 'header' ? (
              <>
                {/* Brand+Supplier on row one, Branch+Received date on row two.
                    The modal is max-w-3xl (768px), so from the 640px breakpoint
                    up its content box is always wide enough for two columns --
                    these four fields never fall into four separate rows above
                    that width. Below it they stack one per row on purpose. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label><span className="mb-1 block text-[11px] text-gray-500">{tr('brand', 'Brand')}</span><input className="input w-full text-sm" value={header.brand} list="create-products-brand-options" aria-label={tr('brand', 'Brand')} placeholder={tr('optional', 'Optional')} onChange={(event) => setHeader((prev) => ({ ...prev, brand: event.target.value }))} /><datalist id="create-products-brand-options">{brandOptions.map((brand) => <option key={brand} value={brand} />)}</datalist></label>
                  <SupplierPickerField value={{ supplierId: header.supplierId, supplierName: header.supplierName }} onChange={(next) => setHeader((prev) => ({ ...prev, supplierId: next.supplierId, supplierName: next.supplierName }))} tr={(key, fallback) => tr(key, fallback || key)} idPrefix="create-products-session" hint={tr('create_products_supplier_hint', 'Recorded on the opening stock of every product this session creates.')} hintDisplay="tooltip" />
                  <label><span className="mb-1 block text-[11px] text-gray-500">{tr('branch', 'Branch')}</span><AppSelect value={header.branchId} onChange={(next) => setHeader((prev) => ({ ...prev, branchId: next }))} ariaLabel={tr('branch', 'Branch')} buttonClassName="h-9 w-full text-sm" options={branchSelectOptions} /></label>
                  <label><span className="mb-1 block text-[11px] text-gray-500">{tr('received_date', 'Received date')}</span><DateEntryInput className="h-9 w-full text-sm" t={packLookup} ariaLabel={tr('received_date', 'Received date')} value={receivedDate} onChange={setReceivedDate} /></label>
                  <label className="flex items-center gap-2 text-xs text-gray-600 sm:col-span-2 dark:text-gray-300"><input type="checkbox" className="h-4 w-4" checked={freeGoods} onChange={(event) => setFreeGoods(event.target.checked)} /><span>{tr('stock_receipt_free_goods', 'Free goods (no cost)')}</span><InfoHint label={tr('stock_receipt_free_goods', 'Free goods (no cost)')} text={tr('stock_receipt_free_goods_hint', 'Tick this only when the goods really arrived at no cost. It is the declaration that lets a $0.00 unit cost be recorded; without it a blank or zero cost is refused.')} /></label>
                </div>
                <div className="mt-3 flex justify-end"><button type="button" className="btn-primary flex h-10 items-center gap-1.5 px-4 text-sm disabled:opacity-50" disabled={!canStart || (!allowNew && !allowExisting) || submissionLocked} onClick={() => setStep('items')}><PackagePlus className="h-4 w-4" />{tr('create_products_start', 'Add items')}</button></div>
              </>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><div><dt className="text-[11px] text-gray-500">{tr('brand', 'Brand')}</dt><dd className="truncate font-medium">{summary.brand}</dd></div><div><dt className="text-[11px] text-gray-500">{tr('supplier', 'Supplier')}</dt><dd className="truncate font-medium">{summary.supplier}</dd></div><div><dt className="text-[11px] text-gray-500">{tr('branch', 'Branch')}</dt><dd className="truncate font-medium">{summary.branch}</dd></div><div><dt className="text-[11px] text-gray-500">{tr('received_date', 'Received date')}</dt><dd className="truncate font-medium tabular-nums">{receivedDate}</dd></div></dl>
            )}
          </div>
          {step === 'items' ? (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 grid grid-cols-2 gap-2">{allowNew ? <button type="button" disabled={submissionLocked} aria-pressed={mode === 'new'} className={mode === 'new' ? 'btn-primary min-h-11 text-sm' : 'btn-secondary min-h-11 text-sm'} onClick={() => setMode('new')}>{tr('add_product', 'New product')}</button> : null}{allowExisting ? <button type="button" disabled={submissionLocked} aria-pressed={mode === 'existing'} className={mode === 'existing' ? 'btn-primary min-h-11 text-sm' : 'btn-secondary min-h-11 text-sm'} onClick={() => setMode('existing')}>{tr('existing_product', 'Have Already')}</button> : null}</div>
              {mode === 'new' && allowNew ? <button type="button" className="btn-primary flex h-11 w-full items-center justify-center gap-1.5 text-sm" disabled={saving || submissionLocked} onClick={openItemForm}><PackagePlus className="h-4 w-4" />{tr('create_products_add_item', 'Add new product')}</button> : null}
              {mode === 'existing' && allowExisting ? <div><label className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input ref={searchInputRef} className="input w-full pl-9 text-sm" value={query} disabled={submissionLocked} placeholder={tr('fast_stockin_search', 'Type a product name or barcode…')} onChange={(event) => setQuery(event.target.value)} autoFocus /></label>{searching ? <p className="mt-2 text-xs text-gray-400">{tr('loading', 'Loading...')}</p> : null}{searchFailed ? <p className="mt-2 text-xs text-red-600">{tr('load_failed', 'Failed to load products')}</p> : null}{groups.length ? <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">{groups.map((group) => <button key={group.key} type="button" disabled={submissionLocked} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700" onClick={() => openExistingOptions(group)}><span className="min-w-0 truncate font-medium">{group.name}</span><span className="shrink-0 text-[11px] text-gray-500">{group.sellableItems.length || group.items.length} {tr('options', 'options')} · {group.stockTotal}</span></button>)}</div> : null}</div> : null}
              <div className="mt-4 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><span>{tr('create_products_created', 'Saved list')} ({summary.items})</span><span className="tabular-nums normal-case">{tr('total_units', 'Total units')}: {summary.units} · {usdSymbol}{summary.costUsd.toFixed(2)}</span></div>
              {rows.length ? <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">{rows.map((row) => (
                <div key={row.lineId} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-2 py-2 text-sm dark:bg-gray-900/50">
                  <button type="button" disabled={row.status !== 'queued' || submissionLocked} className="min-w-0 flex-1 text-left disabled:cursor-default" aria-label={`${tr('edit', 'Edit')} ${row.name}`} onClick={() => openQueuedLine(row)}>
                    <span className="block truncate">{row.status === 'saved' ? '✅' : '•'} {row.name}{row.barcode ? ` · ${row.barcode}` : ''}</span>
                    <span className="block truncate text-[10px] text-gray-500">{row.brand || tr('none', 'None')} · {row.supplierName || tr('none', 'None')} · {row.branchName || tr('none', 'None')} · {row.receivedDate} · {row.batchLabel || tr('product_created', 'Product created')}</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1"><span className="text-[11px] tabular-nums">× {row.quantity} · {usdSymbol}{(row.quantity * row.unitCostUsd).toFixed(2)}</span>{row.status === 'queued' ? <button type="button" disabled={submissionLocked} aria-label={tr('remove', 'Remove')} className="rounded p-1 text-gray-400 hover:text-red-600 disabled:opacity-40" onClick={() => removeLine(row.lineId)}><Trash2 className="h-4 w-4" /></button> : null}</span>
                </div>
              ))}</div> : <p className="mt-2 rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:bg-gray-900/50">{tr('create_products_none_yet', 'No products added yet.')}</p>}
              {idempotencyConflict ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{commitError ? `${commitError} · ` : ''}idempotency_conflict · {tr('resolve', 'Resolve')}</p> : commitError ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{commitError}{submissionLocked ? ` · ${tr('retry', 'Retry')}` : ''}</p> : null}
            </div>
          ) : null}
          {/* One close affordance only -- the Modal header X. The footer keeps
              the primary action alone (and disappears entirely on the header
              step, where "Add items" is the primary action). */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">{step === 'items' ? <button type="button" className="btn-primary h-10 px-4 text-sm disabled:opacity-50" disabled={saving || idempotencyConflict || (rows.length === 0 && !submittedItems)} onClick={() => void finishSession()}>{saving ? tr('saving_label', 'Saving…') : idempotencyConflict ? tr('failed', 'Failed') : submissionLocked ? tr('retry', 'Retry') : `✓ ${tr('create_products_finish', 'Complete session')}`}</button> : null}</div>
        </div>
      </Modal>

      {itemFormOpen ? <Suspense fallback={null}><ProductForm key={editingNewLine ? `create-products-line-${editingNewLine.lineId}` : `create-products-item-${itemFormSeq}`} product={editingNewProduct} createDefaults={itemCreateDefaults} showReceivedDate draftScope={editingNewLine ? `create-products-session-${sessionIdRef.current}-line-${editingNewLine.lineId}` : `create-products-session-${sessionIdRef.current}-item-${itemFormSeq}`} modalLayer="nested" categories={categories} units={itemUnits} branches={branches} brandOptions={brandOptions} groupCandidates={groupCandidates} onSave={(payload) => editingNewLine ? saveEditedNewLine(editingNewLine.lineId, (payload || {}) as unknown as Record<string, unknown>) : saveNewItem((payload || {}) as unknown as Record<string, unknown>)} onClose={closeItemForm} t={t} usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate} user={user} /></Suspense> : null}

      {editingExistingLine ? (
        <Modal title={`${tr('edit', 'Edit')}: ${editingExistingLine.name}`} onClose={() => { setEditingLineId(null); resetExistingCandidate() }} size="md" layer="nested" unsavedChanges={{ dirty: editingExistingDirty }}>
          {renderExistingLineFields(() => queueExistingLine(editingExistingLine.lineId))}
        </Modal>
      ) : null}

      {selectedGroup ? (
        <Modal title={selectedGroup.name} onClose={closeExistingOptions} size="md" layer="nested" unsavedChanges="read-only">
          <div className="space-y-4">
            <button type="button" className="btn-secondary h-10 px-3 text-sm" onClick={closeExistingOptions}>← {tr('back', 'Back')}</button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{groupOptions.map((product) => {
              const selected = String(selectedProduct?.id || '') === String(product.id)
              return <button key={String(product.id)} type="button" aria-pressed={selected} className={`min-h-14 rounded-lg border px-3 py-2 text-left ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-700'}`} onClick={() => selectExistingProduct(product)}><span className="block font-medium">{String(product.name || selectedGroup.name)}</span><span className="block font-mono text-[11px] opacity-80">{String(product.barcode || tr('no_barcode', 'No barcode'))}</span><span className="block text-[11px] opacity-80">{tr('quantity', 'Quantity')}: {quantityAtBranch(product, lineBranchId)} · {tr('unit_cost_usd', 'Unit cost')}: {usdSymbol}{currentCost(product).toFixed(2)}</span></button>
            })}</div>
            {renderExistingLineFields(() => queueExistingLine())}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
