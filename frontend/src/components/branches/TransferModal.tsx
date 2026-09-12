import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import { transferDraftKey, readTransferDraft, writeTransferDraft, discardTransferDraft, completeTransferDraft, parkTransferDraft, markRestoreHandled } from '../../utils/minimizedWork.ts'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import {
  getBranchStock as getBranchStockRequest,
  transferStock as transferStockRequest,
  transferStockBulk as transferStockBulkRequest,
  prepareTransferRun, loadTransferRun, saveTransferRun, executeTransferRun,
  type PendingTransferRun,
} from '../../api/branchTransport.ts'
import { getProductBatches, getTrackedBatchProductIds } from '../../api/batchesTransport.ts'
import type { ProductBatch } from '../../api/batchesTransport.ts'
import { useDebouncedValue } from '../products/helpers/productPageHelpers.ts'
import { fuzzyTextMatches, sortBySearchRelevance } from '../../utils/searchMatch.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import { buildProductGroups } from '../../utils/productGrouping.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import ProductOptionSheet from '../shared/ProductOptionSheet.tsx'
import { branchCanBeTransferDestination, branchCanBeTransferSource, branchCanTransferBetween, branchRoleFromName } from '../../utils/branchRoles.ts'
import { localizeBranchRuleError } from '../../api/branchRuleErrors.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { captureActorReadScope, assertActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'

const TRANSFER_STOCK_LOAD_TIMEOUT_MS = 12000
// Transfers can allocate and materialize many lot rows in one D1 batch. Keep
// the request alive long enough for a real commit; a short client timeout
// falsely reports failure after the server has moved stock, which was the
// source of the Shop → Warehouse “could not transfer” reports.
const TRANSFER_STOCK_MUTATION_TIMEOUT_MS = 45000
const TRANSFER_STOCK_BULK_MUTATION_TIMEOUT_MS = 90000
// Mirrors MAX_BULK_TRANSFER_ITEMS in the Worker's POST /transfer-bulk. A
// whole-branch move can be thousands of rows, so it is split into requests
// this size rather than raising the server cap -- the cap is what keeps one
// request's db.batch() inside the Worker's memory and D1's statement limits.
const TRANSFER_BULK_CHUNK_SIZE = 200
const TRANSFER_SEARCH_DEBOUNCE_MS = 200
const TRANSFER_STOCK_PAGE_SIZE = 50

type PendingTransferItem = { productId: string | number; quantity: number; batchId?: number; batchLabel?: string; productName?: string }
type PendingTransfer = {
  /** 'selected' = the checked rows. 'entire_branch' = every in-stock row. */
  scope: 'selected' | 'entire_branch'
  items: PendingTransferItem[]
  totalUnits: number
  fromName: string
  toName: string
  /** How many requests this will take -- >1 means it is not one atomic step. */
  chunks: number
  fromBranch: string
  toBranch: string
  authority: ActorReadScope
}

/** A bulk request permits one row per product. Multiple lots remain explicit
 * across requests, with every body frozen by the existing receipt workflow. */
export function packTransferLots(items: PendingTransferItem[]): PendingTransferItem[][] {
  const chunks: PendingTransferItem[][] = []
  for (const item of items) {
    let chunk = chunks.find((rows) => rows.length < TRANSFER_BULK_CHUNK_SIZE && !rows.some((row) => String(row.productId) === String(item.productId)))
    if (!chunk) { chunk = []; chunks.push(chunk) }
    chunk.push(item)
  }
  return chunks
}

export function positiveTransferLots(batches: ProductBatch[]): ProductBatch[] {
  return batches.filter((batch) => Number.isInteger(Number(batch.id)) && Number(batch.id) > 0 && Number(batch.is_active) === 1 && Number.isFinite(Number(batch.quantity)) && Number(batch.quantity) > 0 && !!batch.received_at)
}

export function selectedTransferLot(product: TransferProduct, batches: ProductBatch[], batchId: number | undefined, quantity: number): PendingTransferItem {
  const batch = positiveTransferLots(batches).find((row) => Number(row.id) === batchId)
  if (!batch) throw new Error('transfer_pick_batch_first')
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(Number(product.branch_quantity)) || quantity > Math.min(Number(product.branch_quantity), Number(batch.quantity))) throw new Error('transfer_invalid_quantity')
  return { productId: product.id, quantity, batchId: Number(batch.id), productName: product.name, batchLabel: batchDisplayLabel(batch, '') }
}

/**
 * Every row that actually has stock to move, at its full branch quantity.
 *
 * Module-scope and pure on purpose: 'entire branch' must mean the same thing
 * regardless of what is typed in the search box or which rows are checked.
 * Reading it off the filtered list instead is precisely the bug the old
 * Select all had -- it summed whatever happened to be on screen.
 */
function entireBranchItems(rows: TransferProduct[]): PendingTransferItem[] {
  return rows
    .map((product) => ({ productId: product.id, quantity: Number(product.branch_quantity || 0) }))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0)
}

type TranslateFunction = (key: string) => string
type NotifyFunction = (message: string, type?: string) => void

type BranchOption = {
  id: string | number
  name: string
  is_active?: boolean | number
}

type TransferProduct = {
  id: string | number
  name?: string
  sku?: string
  barcode?: string
  unit?: string
  branch_quantity?: number | string
}

/**
 * The rows the shared option sheet reads.
 *
 * GET /api/branches/:id/stock answers for ONE branch: its rows carry
 * branch_quantity and no branch_stock ledger at all. The sheet reads
 * branch_stock, so the source branch's own number is handed to it as that
 * ledger rather than leaving it to fall back on a cross-branch total.
 */
type TransferSheetRow = TransferProduct & {
  stock_quantity: number
  branch_stock: Array<{ branch_id: string; branch_name: string; quantity: number }>
}

function sheetChoicesFor(rows: TransferProduct[], branchId: string, branchName: string): TransferSheetRow[] {
  return rows.map((row) => {
    const quantity = Number(row.branch_quantity) || 0
    return { ...row, stock_quantity: quantity, branch_stock: [{ branch_id: String(branchId), branch_name: branchName, quantity }] }
  })
}

type TransferStockResponse = {
  items?: TransferProduct[]
  page?: number
  totalPages?: number
}

type TransferResult = {
  success?: boolean
  error?: string
  // Present only when the destination write redirected to a different,
  // already-existing identical product (findIdentityMatch in
  // productIdentity.ts -- see branches.ts's POST /transfer comment) rather
  // than the product actually selected to transfer.
  mergedIntoProductId?: number | string
  mergedIntoProductName?: string | null
}

type TransferBulkResult = {
  success?: boolean
  error?: string
  transferredCount?: number
  // Same identity-match redirect as TransferResult.mergedIntoProductId
  // above, one entry per selected item that got redirected -- see
  // branches.ts's POST /transfer-bulk comment.
  merges?: Array<{
    productId: number | string
    productName?: string | null
    mergedIntoProductId: number | string
    mergedIntoProductName?: string | null
  }>
}

type TransferMode = 'single' | 'multiple'

type TransferModalProps = {
  branches: BranchOption[]
  onClose: () => void
  onDone: () => void
  user?: { id?: string | number; name?: string }
  notify: NotifyFunction
}

type AppContextValue = {
  t: TranslateFunction
  settings?: { language?: string }
  can: (page: string, action: string) => boolean
}

type TransferApi = {
  getBranchStock: (
    branchId: number,
    options: { page?: number; pageSize?: number; stockState?: string; query?: string },
  ) => Promise<unknown>
  transferStock: (payload: {
    fromBranchId: number
    toBranchId: number
    productId: string | number
    productName: string
    quantity: number
    reason: string
    userId?: string | number
    userName?: string
    // Present only when the source product is batch/lot-tracked -- see the
    // batch/lot picker state comment below and branches.ts's POST /transfer
    // batch-aware comment for what happens server-side.
    batchId?: number | null
  }) => Promise<TransferResult>
  transferStockBulk: (payload: {
    fromBranchId: number
    toBranchId: number
    reason: string
    items: PendingTransferItem[]
    userId?: string | number
    userName?: string
  }) => Promise<TransferBulkResult>
}

const useApp = useAppHook as () => AppContextValue

function getTransferApi(): TransferApi {
  return {
    getBranchStock: (branchId, options) => getBranchStockRequest(branchId, options),
    transferStock: (payload) => transferStockRequest(payload) as Promise<TransferResult>,
    transferStockBulk: (payload) => transferStockBulkRequest(payload) as Promise<TransferBulkResult>,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeTransferStockRows(stock: unknown): TransferProduct[] {
  if (Array.isArray(stock)) return stock.filter((product): product is TransferProduct => !!product && typeof product === 'object')
  const response = stock as TransferStockResponse
  if (Array.isArray(response?.items)) return response.items.filter((product): product is TransferProduct => !!product && typeof product === 'object')
  return []
}

/**
 * 1. Transfer Modal Component
 * 1.1 Purpose
 * - Move product quantity from one branch to another.
 * - Validate source/destination/quantity before write.
 * - Surface transfer results through notifications.
 */
export default function TransferModal({ branches, onClose, onDone, user, notify }: TransferModalProps) {
  const { t, settings, can } = useApp()
  const canTransferStock = can('branches', 'transfer')
  const transferAuthorityRef = useRef({ allowed: canTransferStock, actorId: String(user?.id) })
  transferAuthorityRef.current = { allowed: canTransferStock, actorId: String(user?.id) }
  const [savedRun, setSavedRun] = useState<PendingTransferRun | null>(null)
  const [retryError, setRetryError] = useState('')
  const [retryStorageError, setRetryStorageError] = useState('')
  useEffect(() => {
    try { setSavedRun(loadTransferRun(user?.id)); setRetryStorageError('') }
    catch (error) { setRetryStorageError(getErrorMessage(error, t('transfer_failed'))) }
  }, [user?.id])

  /**
   * 2. UI State
   * 2.1 Form inputs and branch-scoped product cache.
   */
  const draftKey = transferDraftKey('branch_transfer')
  const [initialDraft] = useState(() => readTransferDraft<{ fromBranch: string; toBranch: string; search: string; reason: string; selectedQuantities: Record<string, string>; selectedLots?: Record<string, number>; showAllProducts: boolean; showSelectedOnly: boolean }>('branch_transfer', user?.id))
  const [fromBranch, setFromBranch] = useState(initialDraft?.fromBranch || '')
  const [toBranch, setToBranch] = useState(initialDraft?.toBranch || '')
  const [search, setSearch] = useState(initialDraft?.search || '')
  const debouncedSearch = useDebouncedValue(search, TRANSFER_SEARCH_DEBOUNCE_MS)
  const [products, setProducts] = useState<TransferProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<TransferProduct | null>(null)
  const [quantity, setQuantity] = useState('')
  // The transfer's documented cause. Required -- see requireTransferReason.
  const [reason, setReason] = useState(initialDraft?.reason || '')
  const [saving, setSaving] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false)
  const [singleStockPage, setSingleStockPage] = useState(1)
  const [singleStockTotalPages, setSingleStockTotalPages] = useState(1)
  const stockRequestRef = useRef(0)
  const productsBranchRef = useRef('')
  const transferInFlightRef = useRef(false)
  const aliveRef = useRef(true)

  /**
   * 2.1b Optional batch/lot picker (single mode only). Operators can select
   * a precise lot when that matters; otherwise the server allocates the
   * requested quantity FIFO across available source lots in one transaction.
   * This keeps quantity entry direct without weakening lot traceability.
   */
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  // A received date chosen in the shared option sheet has to survive the
  // batch load that follows the pick -- that load clears the selection, so
  // the choice is seeded here and re-applied once the lots arrive.
  const batchSeedRef = useRef<number | null>(null)
  // Same-name rows collapse to ONE title row; tapping it opens the shared
  // option sheet, which is where the option and the received date get
  // chosen. The old list committed the pick on the first tap.
  const [picking, setPicking] = useState<{ product: TransferSheetRow; rows: TransferSheetRow[] } | null>(null)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const batchRequestRef = useRef(0)
  // Which product ids carry active batch/lot tracking at the source branch.
  // They show the optional lot selector below; they do not gate quantity entry.
  const [trackedBatchProductIds, setTrackedBatchProductIds] = useState<Set<number>>(new Set())

  /**
   * 2.2 Multi-select mode state (kept fully separate from the single-mode
   * state above, so single-mode's existing fetch/submit paths -- and the
   * tests that pin their exact shape -- are untouched by this addition).
   * `multiProducts` loads the *unpaged* branch-stock listing (calling
   * getBranchStock with no page/pageSize/query params hits the `!wantsPaged`
   * branch of GET /api/branches/:id/stock, which returns every active
   * product's branch_quantity for this branch in one response) so the
   * multi-select picker never needs a "next page" click.
   */
  // One picker handles both one-product and many-product transfers. Selecting
  // one row submits one item; selecting several submits them atomically through
  // the same bulk endpoint. Keeping one mode removes the two diverging search
  // and loading paths that repeatedly fell out of sync.
  const [mode] = useState<TransferMode>('multiple')
  const [multiProducts, setMultiProducts] = useState<TransferProduct[]>([])
  const [loadingMultiProducts, setLoadingMultiProducts] = useState(false)
  const [showAllProducts, setShowAllProducts] = useState(initialDraft?.showAllProducts || false)
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>(initialDraft?.selectedQuantities || {})
  const [selectedLots, setSelectedLots] = useState<Record<string, number>>(initialDraft?.selectedLots || {})
  const [rowLots, setRowLots] = useState<Record<string, { branch: string; authority: ActorReadScope; batches: ProductBatch[]; error?: string }>>({})
  const [preparingLots, setPreparingLots] = useState(false)
  const lotIntentRef = useRef(0)
  const lotBranchRef = useRef(fromBranch)
  lotBranchRef.current = fromBranch
  const selectedLotProducts = Object.keys(selectedQuantities).sort().join(',')
  useEffect(() => {
    let cancelled = false
    const branch = fromBranch
    if (!branch) return
    const authority = captureActorReadScope('batches')
    const ids = Object.keys(selectedQuantities).filter((id) => !rowLots[id] || rowLots[id].error || !rowLots[id].batches.length || rowLots[id].branch !== branch || !isActorReadScopeCurrent(rowLots[id].authority))
    let next = 0
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (!cancelled && next < ids.length) {
        const id = ids[next++]
        try {
          assertActorReadScope(authority)
          const result = await withLoaderTimeout(() => getProductBatches(Number(id), Number(branch)), 'Transfer received dates', TRANSFER_STOCK_LOAD_TIMEOUT_MS)
          if (cancelled || lotBranchRef.current !== branch || !isActorReadScopeCurrent(authority)) return
          setRowLots((current) => ({ ...current, [id]: { branch, authority, batches: positiveTransferLots(result.batches) } }))
        } catch {
          if (cancelled || lotBranchRef.current !== branch || !isActorReadScopeCurrent(authority)) return
          setRowLots((current) => ({ ...current, [id]: { branch, authority, batches: [], error: t('failed_to_load_data') } }))
        }
      }
    }))
    return () => { cancelled = true }
  }, [fromBranch, selectedLotProducts, user?.id])

  const expandEntireBranchLots = async (items: PendingTransferItem[], products: TransferProduct[]) => {
    const intent = ++lotIntentRef.current
    const branch = fromBranch
    const authority = captureActorReadScope('batches')
    setPreparingLots(true)
    let abandoned = false
    try {
      const expanded: PendingTransferItem[][] = new Array(items.length)
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        while (!abandoned && next < items.length) {
          const index = next++
          assertActorReadScope(authority)
          if (lotBranchRef.current !== branch || intent !== lotIntentRef.current) throw new Error('stale')
          const item = items[index]
          const result = await withLoaderTimeout(() => getProductBatches(Number(item.productId), Number(branch)), 'Transfer received dates', TRANSFER_STOCK_LOAD_TIMEOUT_MS)
          if (abandoned) return
          assertActorReadScope(authority)
          const lots = positiveTransferLots(result.batches)
          if (!lots.length) throw new Error(t('transfer_no_batches'))
          if (Math.abs(lots.reduce((sum, lot) => sum + Number(lot.quantity), 0) - item.quantity) > 0.000001) throw new Error(t('transfer_lot_stock_mismatch'))
          const product = products.find((row) => String(row.id) === String(item.productId))!
          expanded[index] = lots.map((lot) => selectedTransferLot(product, lots, Number(lot.id), Number(lot.quantity)))
        }
      }))
      if (!aliveRef.current || lotBranchRef.current !== branch || intent !== lotIntentRef.current) return null
      assertActorReadScope(authority)
      return expanded.flat()
    } catch (error) {
      abandoned = true
      if (aliveRef.current && lotBranchRef.current === branch && isActorReadScopeCurrent(authority)) notify(getErrorMessage(error, t('failed_to_load_data')), 'error')
      return null
    } finally { if (intent === lotIntentRef.current) setPreparingLots(false) }
  }
  // Multi mode: view filter that narrows the (whole-catalog) list to just
  // the checked rows, so the picked set can be reviewed/adjusted in one
  // screen instead of hunting scattered highlighted rows through thousands.
  const [showSelectedOnly, setShowSelectedOnly] = useState(initialDraft?.showSelectedOnly || false)
  const [savingBulk, setSavingBulk] = useState(false)
  // A transfer parked for confirmation. Both the checked-rows transfer and
  // the whole-branch transfer go through this one shape, so there is exactly
  // one place that actually writes (runPendingTransfer).
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null)

  // S4-21. This modal builds its own chrome instead of using shared/Modal,
  // so it opts into the SAME guard directly -- one mechanism with two entry
  // points, never a second implementation. What a dismissal would lose is
  // the branches picked and the quantities typed against them; the search
  // box and paging are navigation, not work.
  const transferDirty = Boolean(fromBranch) || Boolean(toBranch)
    || Boolean(quantity.trim()) || Boolean(reason.trim())
    || Object.values(selectedQuantities).some((value) => String(value || '').trim().length > 0)
  const draftFinishedRef = useRef(false)
  const draftGuardRef = useRef({ dirty: transferDirty, pending: !!savedRun, busy: saving || savingBulk })
  draftGuardRef.current = { dirty: transferDirty, pending: !!savedRun, busy: saving || savingBulk }
  const draftState = { fromBranch, toBranch, search, reason, selectedQuantities, selectedLots, showAllProducts, showSelectedOnly }
  const draftLifecycleRef = useRef({ draftKey, actorId: user?.id, dirty: transferDirty, form: draftState })
  draftLifecycleRef.current = { draftKey, actorId: user?.id, dirty: transferDirty, form: draftState }
  useEffect(() => {
    if (transferDirty && !draftFinishedRef.current) writeTransferDraft('branch_transfer', user?.id, draftKey, draftState)
  }, [draftKey, user?.id, fromBranch, toBranch, search, reason, selectedQuantities, selectedLots, showAllProducts, showSelectedOnly, transferDirty])
  useEffect(() => {
    markRestoreHandled('branch_transfer')
    const preserve = () => {
      const latest = draftLifecycleRef.current
      if (!draftFinishedRef.current && latest.dirty) {
        writeTransferDraft('branch_transfer', latest.actorId, latest.draftKey, latest.form)
        parkTransferDraft('branch_transfer', latest.actorId, latest.draftKey, t('stock_transfer'))
      }
    }
    window.addEventListener('pagehide', preserve)
    return () => { window.removeEventListener('pagehide', preserve); preserve() }
  }, [])
  useEffect(() => registerDirtyWork({
    key: draftKey, pageId: 'branches', label: t('stock_transfer'),
    isDirty: () => !draftFinishedRef.current && (draftGuardRef.current.busy || (draftGuardRef.current.dirty && !draftGuardRef.current.pending)),
    discard: () => {
      if (draftGuardRef.current.busy || draftGuardRef.current.pending) return
      draftFinishedRef.current = discardTransferDraft('branch_transfer', user?.id, draftKey)
    },
  }), [draftKey, user?.id])
  const preserveAndMinimize = () => {
    if (saving || savingBulk || !canTransferStock) return
    if (!writeTransferDraft('branch_transfer', user?.id, draftKey, draftState)) { notify(t('save_failed'), 'error'); return }
    parkTransferDraft('branch_transfer', user?.id, draftKey, t('stock_transfer'))
    onClose()
  }
  const closeGuard = useCloseGuard({ workKey: draftKey }, () => {
    if (saving || savingBulk) return
    if (!savedRun) draftFinishedRef.current = discardTransferDraft('branch_transfer', user?.id, draftKey)
    onClose()
  }, preserveAndMinimize)
  const requestClose = () => { if (!saving && !savingBulk) closeGuard.requestClose() }

  // Only set while a multi-request whole-branch move is running, so the
  // operator can see it is partway through rather than hung.
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null)
  const multiStockRequestRef = useRef(0)
  const multiProductsBranchRef = useRef('')
  // Set when Transfer entire branch was pressed before the branch listing had
  // been fetched; consumed once it lands, to open the confirm with real
  // numbers rather than guessing at them.
  const entireBranchAfterLoadRef = useRef(false)
  const transferBulkInFlightRef = useRef(false)

  // Keep camera results inside the transfer picker. Reset selected-only/full-
  // catalog presentation flags so the scanned code immediately becomes the
  // active branch-stock query without touching any page-level search field.
  const handleTransferProductScan = useCallback((value: string) => {
    const barcode = String(value || '').trim()
    if (!barcode) return
    setShowSelectedOnly(false)
    setShowAllProducts(false)
    setSearch(barcode)
  }, [])

  useEffect(() => {
    // Re-arm on mount, not just init-once: StrictMode's dev double-mount runs
    // this cleanup between the two mounts, and a `useRef(true)` that is never
    // set back leaves aliveRef false for the whole real lifetime -- every
    // fetch result (products, batches, bulk list) was then discarded and the
    // pickers sat on "Loading..." forever. Same mount/cleanup pair the other
    // aliveRef surfaces (Settings, AuditLog, Sales, ...) already use.
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      invalidateTrackedRequest(stockRequestRef)
      invalidateTrackedRequest(multiStockRequestRef)
      invalidateTrackedRequest(batchRequestRef)
      lotIntentRef.current++
    }
  }, [])

  // Stock can move in either direction between the one canonical Shop and
  // Warehouse. Other and same-role destinations stay visible but inert so a
  // stale or ambiguous branch list cannot create a stock-action identity.
  const hasCanonicalTransferPair = useMemo(
    () => branches.filter((branch) => branchRoleFromName(branch.name) === 'shop').length === 1
      && branches.filter((branch) => branchRoleFromName(branch.name) === 'warehouse').length === 1,
    [branches],
  )

  const selectedSourceBranch = useMemo(
    () => branches.find((branch) => String(branch.id) === String(fromBranch)) || null,
    [branches, fromBranch],
  )

  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('select_source') || 'Select source branch' },
    ...branches.map((branch) => ({
      value: branch.id,
      label: branch.name,
      disabled: !branchCanBeTransferSource(branch.name) || branch.is_active === false || branch.is_active === 0 || !hasCanonicalTransferPair,
    })),
  ], [branches, hasCanonicalTransferPair, t])

  const destinationBranchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('select_destination') || 'Select destination branch' },
    ...branches
      .filter((branch) => String(branch.id) !== String(fromBranch))
      .map((branch) => ({
        value: branch.id,
        label: branch.name,
        disabled: !branchCanBeTransferDestination(branch.name) || branch.is_active === false || branch.is_active === 0
          || !branchCanTransferBetween(selectedSourceBranch?.name, branch.name),
      })),
  ], [branches, fromBranch, selectedSourceBranch, t])

  const setTransferSource = useCallback((nextSource: string) => {
    setFromBranch(nextSource)
    const nextSourceBranch = branches.find((branch) => String(branch.id) === String(nextSource))
    const currentDestinationBranch = branches.find((branch) => String(branch.id) === String(toBranch))
    if (!branchCanTransferBetween(nextSourceBranch?.name, currentDestinationBranch?.name)) setToBranch('')
  }, [branches, toBranch])

  const requireCanonicalTransferDirection = useCallback((): boolean => {
    if (!canTransferStock) { notify(t('permission_denied') || 'Permission denied', 'error'); return false }
    const destinationBranch = branches.find((branch) => String(branch.id) === String(toBranch))
    if (hasCanonicalTransferPair && selectedSourceBranch?.is_active !== false && selectedSourceBranch?.is_active !== 0
      && destinationBranch?.is_active !== false && destinationBranch?.is_active !== 0
      && branchCanTransferBetween(selectedSourceBranch?.name, destinationBranch?.name)) return true
    notify(t('transfer_canonical_pair_only') || 'Transfers move stock only between Shop and Warehouse.', 'error')
    return false
  }, [branches, canTransferStock, hasCanonicalTransferPair, notify, selectedSourceBranch, t, toBranch])

  const invalidQuantityText = settings?.language === 'km'
    ? 'ចំនួនផ្ទេរត្រូវតែធំជាងសូន្យ។'
    : 'Transfer quantity must be greater than zero'

  /**
   * 3. Source Branch Sync
   * 3.1 Refresh product list each time source branch changes.
   */
  useEffect(() => {
    if (mode !== 'single') return undefined
    if (!fromBranch) {
      invalidateTrackedRequest(stockRequestRef)
      productsBranchRef.current = ''
      setLoadingProducts(false)
      setLoadingMoreProducts(false)
      setProducts([])
      setSingleStockPage(1)
      setSingleStockTotalPages(1)
      setSelectedProduct(null)
      setQuantity('')
      return undefined
    }

    const requestId = beginTrackedRequest(stockRequestRef)
    const branchChanged = productsBranchRef.current !== String(fromBranch)
    if (branchChanged) {
      setSelectedProduct(null)
      setQuantity('')
    }
    // Single-transfer used to fetch only the first 50 branch-stock rows and
    // search that local slice. Search now goes to D1, and the unsearched list
    // is explicitly pageable, so every positive-stock product is reachable.
    setProducts([])
    setSingleStockPage(1)
    setSingleStockTotalPages(1)
    setLoadingProducts(true)
    async function loadStock() {
      try {
        const stock = await withLoaderTimeout<unknown>(
          () => getTransferApi().getBranchStock(Number.parseInt(fromBranch, 10), {
            page: 1,
            pageSize: TRANSFER_STOCK_PAGE_SIZE,
            stockState: 'positive',
            ...(debouncedSearch.trim() ? { query: debouncedSearch.trim() } : {}),
          }),
          'Branch stock for transfer',
          TRANSFER_STOCK_LOAD_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
        const response = stock as TransferStockResponse
        productsBranchRef.current = String(fromBranch)
        setProducts(normalizeTransferStockRows(stock))
        setSingleStockPage(Number(response?.page || 1) || 1)
        setSingleStockTotalPages(Math.max(1, Number(response?.totalPages || 1) || 1))
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
        notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'error')
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
        setLoadingProducts(false)
      }
    }
    loadStock()

    return () => {
      invalidateTrackedRequest(stockRequestRef)
    }
  }, [fromBranch, mode, debouncedSearch])

  const loadMoreSingleProducts = async () => {
    if (!fromBranch || loadingProducts || loadingMoreProducts || singleStockPage >= singleStockTotalPages) return
    const nextPage = singleStockPage + 1
    const requestId = beginTrackedRequest(stockRequestRef)
    setLoadingMoreProducts(true)
    try {
      const stock = await withLoaderTimeout<unknown>(
        () => getTransferApi().getBranchStock(Number.parseInt(fromBranch, 10), {
          page: nextPage,
          pageSize: TRANSFER_STOCK_PAGE_SIZE,
          stockState: 'positive',
          ...(debouncedSearch.trim() ? { query: debouncedSearch.trim() } : {}),
        }),
        'More branch stock for transfer',
        TRANSFER_STOCK_LOAD_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
      const response = stock as TransferStockResponse
      const nextRows = normalizeTransferStockRows(stock)
      setProducts((current) => {
        const byId = new Map(current.map((product) => [String(product.id), product]))
        nextRows.forEach((product) => byId.set(String(product.id), product))
        return Array.from(byId.values())
      })
      setSingleStockPage(Number(response?.page || nextPage) || nextPage)
      setSingleStockTotalPages(Math.max(1, Number(response?.totalPages || singleStockTotalPages) || 1))
    } catch (error) {
      if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
      notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'error')
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(stockRequestRef, requestId)) setLoadingMoreProducts(false)
    }
  }

  /**
   * 3.1b Batch-tracking lookup -- refreshed alongside the product list
   * whenever the source branch changes (single mode only; the multi-select
   * flow doesn't pick batches -- see the batch/lot picker state comment
   * above). Drives whether a selected product even shows the picker below.
   */
  useEffect(() => {
    if (mode !== 'single' || !fromBranch) {
      setTrackedBatchProductIds(new Set())
      return undefined
    }
    let cancelled = false
    getTrackedBatchProductIds(Number.parseInt(fromBranch, 10))
      .then((res) => {
        if (cancelled) return
        setTrackedBatchProductIds(new Set((res?.productIds || []).map((id) => Number(id))))
      })
      .catch((error: unknown) => {
        // Do NOT collapse a failed lookup into "nothing is batch-tracked" --
        // that would drop the lot picker from a transfer that genuinely
        // needs one, moving stock without recording which lot left. Keep
        // whatever was last known and log the failure instead. Same
        // reasoning as POS.tsx's own tracked-ids effect.
        if (!cancelled) console.error('[TransferModal] batch tracking lookup failed:', error)
      })
    return () => {
      cancelled = true
    }
  }, [fromBranch, mode])

  /**
   * 3.1c Batch/lot list for the selected product -- only fetched when the
   * product is actually batch-tracked at this branch (3.1b's set). Clears
   * whenever the selection or branch changes so a stale lot never survives
   * onto a different product.
   */
  useEffect(() => {
    const productId = selectedProduct?.id
    if (!fromBranch || productId == null || !trackedBatchProductIds.has(Number(productId))) {
      invalidateTrackedRequest(batchRequestRef)
      setProductBatches([])
      setSelectedBatchId(null)
      setLoadingBatches(false)
      return undefined
    }

    const requestId = beginTrackedRequest(batchRequestRef)
    setSelectedBatchId(null)
    setLoadingBatches(true)
    async function loadBatches() {
      try {
        const res = await withLoaderTimeout<{ batches: ProductBatch[] }>(
          () => getProductBatches(productId as string | number, Number.parseInt(fromBranch, 10), true),
          'Product received-date records for transfer',
          TRANSFER_STOCK_LOAD_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(batchRequestRef, requestId)) return
        const loaded = Array.isArray(res?.batches) ? res.batches : []
        setProductBatches(loaded)
        if (batchSeedRef.current != null) {
          const seeded = loaded.find((batch) => Number(batch.id) === Number(batchSeedRef.current))
          if (seeded) setSelectedBatchId(seeded.id)
          batchSeedRef.current = null
        }
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(batchRequestRef, requestId)) return
        setProductBatches([])
        notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'error')
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(batchRequestRef, requestId)) return
        setLoadingBatches(false)
      }
    }
    loadBatches()

    return () => {
      invalidateTrackedRequest(batchRequestRef)
    }
  }, [selectedProduct, fromBranch, trackedBatchProductIds])

  /**
   * 3.2 The catalog stays closed until the operator searches or explicitly
   * asks for Select all. The first such action fetches the unpaged source-
   * branch stock once; subsequent searches filter that cached catalog.
   */
  useEffect(() => {
    if (mode !== 'multiple') return undefined
    if (!fromBranch) {
      invalidateTrackedRequest(multiStockRequestRef)
      multiProductsBranchRef.current = ''
      setLoadingMultiProducts(false)
      setMultiProducts([])
      setSelectedQuantities({})
      setShowAllProducts(false)
      entireBranchAfterLoadRef.current = false
      return undefined
    }
    const catalogRequested = Boolean(debouncedSearch.trim()) || showAllProducts || Object.keys(selectedQuantities).length > 0
    if (!catalogRequested) return undefined
    if (multiProductsBranchRef.current === String(fromBranch)) return undefined

    const requestId = beginTrackedRequest(multiStockRequestRef)
    setMultiProducts([])
    setLoadingMultiProducts(true)
    async function loadAllStock() {
      try {
        const stock = await withLoaderTimeout<unknown>(
          () => getTransferApi().getBranchStock(Number.parseInt(fromBranch, 10), {}),
          'Branch stock for bulk transfer',
          TRANSFER_STOCK_LOAD_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(multiStockRequestRef, requestId)) return
        multiProductsBranchRef.current = String(fromBranch)
        const normalized = normalizeTransferStockRows(stock)
        setMultiProducts(normalized)
        if (entireBranchAfterLoadRef.current) {
          entireBranchAfterLoadRef.current = false
          const everything = entireBranchItems(normalized)
          if (everything.length) {
            const lots = await expandEntireBranchLots(everything, normalized)
            if (lots) setPendingTransfer(buildPendingTransfer('entire_branch', lots))
          } else {
            notify(t('transfer_no_stock_products') || 'No products with stock in this branch', 'error')
          }
        }
      } catch (error) {
        // Disarm before the early return: a whole-branch intent must not
        // survive the load it was waiting on and fire against a later one.
        entireBranchAfterLoadRef.current = false
        if (!aliveRef.current || !isTrackedRequestCurrent(multiStockRequestRef, requestId)) return
        notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'error')
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(multiStockRequestRef, requestId)) return
        setLoadingMultiProducts(false)
      }
    }
    loadAllStock()

    return () => {
      invalidateTrackedRequest(multiStockRequestRef)
    }
  }, [debouncedSearch, fromBranch, mode, showAllProducts])

  // Switching source branch invalidates whatever was picked under the old
  // branch, in both modes -- a selection made against branch A's stock
  // levels has no meaning once fromBranch changes to B.
  const previousSourceRef = useRef(fromBranch)
  useEffect(() => {
    if (previousSourceRef.current === fromBranch) return
    previousSourceRef.current = fromBranch
    lotIntentRef.current++
    setPreparingLots(false)
    setSelectedLots({})
    setRowLots({})
    setPendingTransfer(null)
    setSelectedQuantities({})
    setShowSelectedOnly(false)
    setShowAllProducts(false)
    multiProductsBranchRef.current = ''
  }, [fromBranch])

  // An empty selection has nothing for the selected-only view to show --
  // drop back to the full list rather than an empty-looking picker.
  useEffect(() => {
    if (!Object.keys(selectedQuantities).length) setShowSelectedOnly(false)
  }, [selectedQuantities])

  /**
   * 4. Search Filter
   * 4.1 Keeps in-stock list visible when search is empty.
   */
  const filtered = useMemo(
    () => products.filter((product) => Number(product.branch_quantity || 0) > 0),
    [products],
  )

  /**
   * 4.2 Multi-mode search filter -- same rules as 4.1 (hide zero-stock rows
   * when search is empty, match name/sku/barcode when it isn't), sourced from the
   * unpaged multiProducts list instead of the paged single-mode one. Was a
   * literal `name.includes(query) || sku.includes(query)` -- same class of
   * "2Medium" miss the per-branch/single-mode search had (see backend's
   * buildBranchStockWhere comment): a stored "Medium (2)" never matched a
   * typed "2Medium"/"2 Medium" since this list is fetched unpaged and
   * filtered entirely client-side, with no server round-trip to catch it.
   * fuzzyTextMatches (utils/searchMatch.ts) is the same typo/conjoined-word/
   * reordering-tolerant matcher Inventory.tsx and POS.tsx already use for
   * their own in-memory re-filtering -- swapping to it here makes every
   * search surface in the app behave the same way. Also folded in `barcode`
   * (previously omitted from the haystack here even though the field is on
   * TransferProduct) -- the single-mode/server-side path searches
   * name+sku+barcode (see buildBranchStockWhere's PRODUCT_SEARCH_COLUMNS),
   * so leaving barcode out of this client-side path was the last place
   * this modal's two search paths disagreed on what "fully scoped" means.
   */
  const filteredMulti = useMemo(() => {
    const query = debouncedSearch.trim()
    let inStock = multiProducts.filter((product) => Number(product.branch_quantity || 0) > 0)
    if (showSelectedOnly) inStock = inStock.filter((product) => String(product.id) in selectedQuantities)
    if (!query && !showAllProducts) inStock = inStock.filter((product) => String(product.id) in selectedQuantities)
    if (!query) return inStock
    // Relevance, not catalogue order. This list is fetched UNPAGED with no
    // query (getBranchStock(branch, {}) above), so the server never ranked
    // it -- filtering alone left the closest match wherever the bulk read
    // happened to put it, which is the reported "likely result was at the
    // bottom". sortBySearchRelevance is the client mirror of the server
    // ordering contract (utils/searchMatch.ts), so this picker and the
    // single-mode server-backed one above now agree on what comes first.
    return sortBySearchRelevance(
      inStock.filter((product) => fuzzyTextMatches([product.name, product.sku, product.barcode].join(' '), query)),
      query,
    )
  }, [multiProducts, debouncedSearch, showAllProducts, showSelectedOnly, selectedQuantities])

  // Same name/cost/barcode grouping every other list surface in the
  // app applies (Products/Inventory/POS/Branches' own stock grid, via
  // utils/productGrouping.ts) -- previously this modal's multi-select list
  // was the one place that rendered every row flat regardless of whether
  // it shared a name with another row, so a same-name-different-branch
  // pair (which the import/transfer backend already merges into one
  // product) looked identical in this list to a same-name-different-price
  // "variant" pair (which stays two distinct products, grouped only for
  // display). group.rows is already branch-merged (see productGrouping.ts)
  // so branch-only duplicates collapse into one checkbox row here too.
  const groupedMulti = useMemo(
    () => buildProductGroups(
      filteredMulti as unknown as Parameters<typeof buildProductGroups>[0],
      undefined,
      // filteredMulti is relevance-ordered whenever a term is typed (see 4.2);
      // grouping must not re-sort that back to A-Z.
      { preserveInputOrder: Boolean(debouncedSearch.trim()) },
    ),
    [filteredMulti, debouncedSearch],
  )

  const selectedEntries = useMemo(
    () => Object.entries(selectedQuantities),
    [selectedQuantities],
  )
  const selectedCount = selectedEntries.length
  const allFilteredSelected = filteredMulti.length > 0
    && filteredMulti.every((product) => String(product.id) in selectedQuantities)

  const toggleProductSelected = (product: TransferProduct) => {
    setSelectedLots((current) => { const next = { ...current }; delete next[String(product.id)]; return next })
    setSelectedQuantities((current) => {
      const id = String(product.id)
      const next = { ...current }
      if (id in next) {
        delete next[id]
      } else {
        next[id] = String(product.branch_quantity ?? '')
      }
      return next
    })
  }

  const setProductQuantity = (productId: string | number, value: string) => {
    setSelectedQuantities((current) => ({ ...current, [String(productId)]: value }))
  }

  /**
   * Checks or clears the rows currently on screen -- nothing more. It does not
   * reveal the catalog and it is not how a whole branch is moved; those are
   * the Show all products toggle and Transfer entire branch respectively.
   * Splitting them is the fix: as one checkbox this silently meant "all" while
   * only ever submitting what the visible list happened to hold, capped at the
   * server's per-request limit.
   */
  const toggleSelectAllShown = () => {
    setSelectedLots((current) => { const next = { ...current }; filteredMulti.forEach((product) => { delete next[String(product.id)] }); return next })
    setSelectedQuantities((current) => {
      if (allFilteredSelected) {
        // Only clear the rows currently visible under the active search --
        // a selection made under a different search term stays intact.
        const next = { ...current }
        filteredMulti.forEach((product) => { delete next[String(product.id)] })
        return next
      }
      const next = { ...current }
      filteredMulti.forEach((product) => { next[String(product.id)] = String(product.branch_quantity ?? '') })
      return next
    })
  }

  const branchNameById = (value: string) => branches.find((branch) => String(branch.id) === String(value))?.name || ''

  // The compact review the operator reads before committing. Same four facts
  // for both scopes, so a whole-branch move is checked the same way a
  // three-row one is.
  const confirmReviewItems = (pending: PendingTransfer): ConfirmReviewItem[] => [
    { label: t('products') || 'Products', value: String(new Set(pending.items.map((item) => String(item.productId))).size) },
    { label: t('transfer_total_units') || 'Total units', value: String(pending.totalUnits) },
    { label: t('from_branch') || 'From Branch', value: pending.fromName },
    { label: t('to_branch') || 'To Branch', value: pending.toName },
    ...pending.items.map((item) => ({ label: item.productName || String(item.productId), value: `${item.batchLabel}: ${item.quantity}` })),
  ]

  const buildPendingTransfer = (scope: PendingTransfer['scope'], items: PendingTransferItem[]): PendingTransfer => ({
    scope,
    items,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    fromName: branchNameById(fromBranch) || t('source_branch') || 'source branch',
    toName: branchNameById(toBranch) || t('destination_branch') || 'destination branch',
    chunks: packTransferLots(items).length,
    fromBranch, toBranch, authority: captureActorReadScope('batches'),
  })

  /**
   * The transfer's documented cause, checked once for all three write paths
   * this modal has: the single-product transfer, the checked-rows transfer
   * and the whole-branch transfer.
   *
   * Every Worker route that moves stock now refuses a reasonless request
   * (branches.ts POST /transfer and /transfer-bulk, inventory.ts POST
   * /transfer and /move-row) -- the same rule Inventory.tsx's own transfer
   * button has always enforced in the browser. Raised here, once, so the
   * three entry points share one check instead of three copies that can
   * drift. Nothing is disabled and nothing typed is thrown away: the
   * operator is told what is missing and the form stays exactly as it was.
   */
  const requireTransferReason = (): boolean => {
    if (reason.trim()) return true
    notify(t('transfer_reason_required') || 'A transfer reason is required.', 'error')
    return false
  }

  /**
   * Moves every in-stock row out of the source branch -- the thing the old
   * Select all checkbox gestured at but never actually did.
   *
   * Built from the full branch listing, never from filteredMulti: an active
   * search or the selected-only view must not quietly shrink what "entire
   * branch" means. Nothing is written here; this only parks the confirm.
   */
  const handleTransferEntireBranch = async () => {
    if (savedRun || savingBulk || preparingLots || retryStorageError) return
    if (!fromBranch || !toBranch) {
      notify(t('select_transfer_branches') || 'Choose both source and destination branches.', 'error')
      return
    }
    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }
    if (!requireCanonicalTransferDirection()) return
    if (!requireTransferReason()) return
    // The listing is only fetched once something asks for it. Ask, and
    // re-enter through the ref once it lands, so the confirm can show real
    // counts instead of guessing at them.
    if (multiProductsBranchRef.current !== String(fromBranch)) {
      entireBranchAfterLoadRef.current = true
      setShowAllProducts(true)
      return
    }
    const everything = entireBranchItems(multiProducts)
    if (!everything.length) {
      notify(t('transfer_no_stock_products') || 'No products with stock in this branch', 'error')
      return
    }
    const lots = await expandEntireBranchLots(everything, multiProducts)
    if (lots) setPendingTransfer(buildPendingTransfer('entire_branch', lots))
  }

  // The Worker validates aggregate branch stock before an explicit lot's
  // stock. These ledgers can briefly disagree, so the UI must enforce both.
  // Automatic mode stays aggregate-bound and lets the Worker allocate FIFO.
  const selectedBatch = productBatches.find((batch) => batch.id === selectedBatchId) || null
  const hasBatchLots = !!selectedProduct && trackedBatchProductIds.has(Number(selectedProduct.id))
  const finiteStockAvailable = (value: unknown) => {
    if (typeof value !== 'number' && typeof value !== 'string') return 0
    const quantity = Number(value)
    return Number.isFinite(quantity) ? Math.max(0, quantity) : 0
  }
  const sourceBranchAvailable = finiteStockAvailable(selectedProduct?.branch_quantity)
  const selectedBatchAvailable = selectedBatch
    ? finiteStockAvailable(selectedBatch.quantity)
    : null
  const transferAvailable = selectedBatchAvailable == null
    ? sourceBranchAvailable
    : Math.min(selectedBatchAvailable, sourceBranchAvailable)

  /**
   * 5. Transfer Action
   * 5.1 Validate all inputs.
   * 5.2 Write transfer row via API.
   */
  const handleTransfer = async () => {
    if (savedRun || retryStorageError || !canTransferStock) return
    if (!fromBranch || !toBranch || !selectedProduct || !quantity) return

    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }
    if (!requireCanonicalTransferDirection()) return

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      notify(invalidQuantityText, 'error')
      return
    }

    if (qty > transferAvailable) {
      const message = (t('transfer_only_available') || 'Only {n} available').replace('{n}', String(transferAvailable))
      notify(`${message} ${selectedProduct.unit || ''}`.trim(), 'error')
      return
    }

    if (!requireTransferReason()) return

    const fromName = branches.find((branch) => String(branch.id) === String(fromBranch))?.name || t('source_branch') || 'source branch'
    const toName = branches.find((branch) => String(branch.id) === String(toBranch))?.name || t('destination_branch') || 'destination branch'
    const lot = selectedBatch
      ? ` ${t('transfer_selected_lot') || 'Selected received date'}: ${batchDisplayLabel({ id: selectedBatch.id, lot_code: (selectedBatch.lot_code as string) ?? null, received_at: (selectedBatch.received_at as string) ?? null, batch_number: (selectedBatch.batch_number as number) ?? null }, t('batch') || 'Received date')}.`
      : ` ${t('transfer_fifo_lot_notice') || 'Available received dates will be allocated FIFO.'}`
    if (!window.confirm((t('confirm_transfer_details') || 'Transfer {n} {unit} of "{name}" from {from} to {to}?')
      .replace('{n}', String(qty))
      .replace('{unit}', selectedProduct.unit || '')
      .replace('{name}', selectedProduct.name || '')
      .replace('{from}', fromName)
      .replace('{to}', toName) + lot)) return

    if (!beginSingleAction(transferInFlightRef, { blocked: saving })) return
    setSaving(true)
    try {
      const run = prepareTransferRun(user?.id, [{ bulk: false, body: {
        fromBranchId: Number.parseInt(fromBranch, 10),
        toBranchId: Number.parseInt(toBranch, 10),
        productId: selectedProduct.id,
        productName: selectedProduct.name || '',
        quantity: qty,
        reason,
        userId: user?.id,
        userName: user?.name,
        batchId: selectedBatchId,
      } }])
      saveTransferRun(user?.id, run)
      setSavedRun(run)
      let res: TransferResult = {}
      await executeTransferRun(run, (next) => {
        saveTransferRun(run.actorId, next)
        if (aliveRef.current && transferAuthorityRef.current.actorId === run.actorId) setSavedRun(next)
      }, async (request) => {
        if (!transferAuthorityRef.current.allowed || transferAuthorityRef.current.actorId !== run.actorId) throw new Error(t('permission_denied'))
        res = await transferStockRequest(request.body) as TransferResult
        return res
      })
      saveTransferRun(run.actorId, null)
      completeTransferDraft(run.actorId, draftKey)
      draftFinishedRef.current = true
      if (!aliveRef.current || transferAuthorityRef.current.actorId !== run.actorId) return
      setSavedRun(null)

      // The single-transfer endpoint returns the moved lot ({ destBatchId } or a
      // merge summary) with NO `success` flag -- a real failure is thrown by
      // apiFetch. Gating on `res?.success` treated every successful transfer as
      // a failure ("Transfer failed" while the stock had actually moved). Treat
      // a returned result as success unless the server explicitly says false --
      // the same shape the create/update checks already use.
      if (res?.success !== false) {
        const message = (t('transfer_success') || 'Transferred {n} {unit} of "{name}"')
          .replace('{n}', String(qty))
          .replace('{unit}', selectedProduct.unit || '')
          .replace('{name}', selectedProduct.name || '')
        // The destination may have redirected to a different, already-
        // existing identical product (see TransferResult.mergedIntoProductId's
        // comment) -- surface that so the operator isn't left wondering why
        // the product they selected doesn't show the new stock at the
        // destination branch.
        const finalMessage = res.mergedIntoProductName
          ? `${message} ${(t('transfer_merged_note') || '(merged into existing product "{name}")').replace('{name}', res.mergedIntoProductName)}`
          : message
        notify(finalMessage)
        onDone()
        return
      }

      // The Worker's direction refusal is the same sentence the greyed
      // branch select already shows, so it is read back out of the packs
      // rather than surfacing as the English the server happened to send.
      notify(localizeBranchRuleError(res?.error, t) || (t('transfer_failed') || 'Transfer failed'), 'error')
    } catch (error) {
      if (!aliveRef.current || transferAuthorityRef.current.actorId !== String(user?.id)) return
      notify(localizeBranchRuleError(getErrorMessage(error, t('transfer_failed') || 'Transfer failed'), t), 'error')
    } finally {
      finishSingleAction(transferInFlightRef)
      setSaving(false)
    }
  }

  /**
   * 5.3 Bulk transfer action -- same validate-then-submit shape as
   * handleTransfer, but builds an `items` array from every checked row
   * instead of a single selectedProduct. Client-side quantity/availability
   * checks mirror the backend's (branches.ts's POST /transfer-bulk) so bad
   * input is caught before the request goes out, but the backend re-checks
   * everything itself -- this is a UX shortcut, not the source of truth.
   */
  const handleBulkTransfer = () => {
    if (savedRun || savingBulk || retryStorageError) return
    if (!fromBranch || !toBranch) return
    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }
    if (!requireCanonicalTransferDirection()) return
    if (!selectedEntries.length) return
    if (!requireTransferReason()) return

    const productsById = new Map(multiProducts.map((product) => [String(product.id), product]))
    const items: PendingTransferItem[] = []
    for (const [productId, rawQuantity] of selectedEntries) {
      const product = productsById.get(productId)
      const qty = Number(rawQuantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        notify(`${product?.name || productId}: ${invalidQuantityText}`, 'error')
        return
      }
      if (!product || qty > finiteStockAvailable(product.branch_quantity)) {
        const message = (t('transfer_only_available') || 'Only {n} available').replace('{n}', String(finiteStockAvailable(product?.branch_quantity)))
        notify(`${product?.name || productId}: ${message} ${product?.unit || ''}`.trim(), 'error')
        return
      }
      const loaded = rowLots[productId]
      if (!loaded || loaded.error || loaded.branch !== fromBranch || !isActorReadScopeCurrent(loaded.authority)) { notify(t('transfer_pick_batch_first'), 'error'); return }
      try { items.push(selectedTransferLot(product, loaded.batches, selectedLots[productId], qty)) }
      catch { notify(`${product.name}: ${t('transfer_pick_batch_first')} / ${t('transfer_only_available').replace('{n}', String(loaded.batches.find((lot) => Number(lot.id) === selectedLots[productId])?.quantity || 0))}`, 'error'); return }
    }

    setPendingTransfer(buildPendingTransfer('selected', items))
  }

  /**
   * The one write path for both scopes, submitted in chunks of
   * TRANSFER_BULK_CHUNK_SIZE.
   *
   * Each chunk is a single POST /transfer-bulk and is atomic on its own (one
   * D1 db.batch()). Chunking is what makes a whole-branch move possible at
   * all, but it means a multi-chunk run is NOT one undoable step -- the
   * confirm dialog says so before the operator commits, and a stop partway
   * reports exactly how far it got. Retrying resumes the saved chunk and its
   * original request key; only confirmed chunks advance the checkpoint.
   *
   * New intent rechecks requireTransferReason() before locking, not only at the two call sites
   * that arm pendingTransfer synchronously (handleBulkTransfer,
   * handleTransferEntireBranch's already-loaded path). Transfer entire
   * branch has a THIRD, deferred path: when the branch listing hasn't
   * loaded yet, handleTransferEntireBranch checks the reason, then only
   * arms entireBranchAfterLoadRef and returns -- the actual
   * setPendingTransfer happens later, inside the load effect above, once
   * the fetch resolves. The reason field stays enabled the whole time that
   * fetch is in flight, so it can be cleared before the effect parks the
   * confirm dialog, and ConfirmDialog's own onConfirm never re-validates
   * anything -- it just calls this function. Checking here, in the one
   * actual write path, covers every arming site. A saved retry already has
   * its required reason frozen; an empty reopened form must not replace it.
   */
  const runPendingTransfer = async (pending: PendingTransfer | null) => {
    if (!canTransferStock || retryStorageError) return
    if (!savedRun && (!pending || !requireTransferReason() || !requireCanonicalTransferDirection())) return
    if (!savedRun && pending && (pending.fromBranch !== fromBranch || pending.toBranch !== toBranch || !isActorReadScopeCurrent(pending.authority))) { setPendingTransfer(null); return }
    if (!beginSingleAction(transferBulkInFlightRef, { blocked: savingBulk })) return
    setSavingBulk(true)
    try {
      let run = savedRun
      if (!run && pending) {
        const requests = []
        for (const items of packTransferLots(pending.items)) {
          requests.push({ bulk: true, body: {
            fromBranchId: Number.parseInt(fromBranch, 10), toBranchId: Number.parseInt(toBranch, 10),
            reason, items: items.map(({ productId, quantity, batchId }) => ({ productId, quantity, batchId })), userId: user?.id, userName: user?.name,
          } })
        }
        run = prepareTransferRun(user?.id, requests)
        // Persistence must succeed before the first request goes out.
        saveTransferRun(user?.id, run)
        setSavedRun(run)
      }
      if (!run || run.actorId !== String(user?.id)) return
      setPendingTransfer(null)
      setRetryError('')
      setChunkProgress({ done: run.next, total: run.requests.length })
      const completed = await executeTransferRun(run, (next) => {
        saveTransferRun(next.actorId, next)
        if (aliveRef.current && transferAuthorityRef.current.actorId === next.actorId) {
          setSavedRun(next)
          setChunkProgress({ done: next.next, total: next.requests.length })
        }
      }, (request) => {
        if (!transferAuthorityRef.current.allowed || transferAuthorityRef.current.actorId !== run.actorId) {
          throw new Error(t('permission_denied') || 'Permission denied')
        }
        return request.bulk ? transferStockBulkRequest(request.body) : transferStockRequest(request.body)
      })
      saveTransferRun(completed.actorId, null)
      completeTransferDraft(completed.actorId, draftKey)
      draftFinishedRef.current = true
      if (!aliveRef.current || transferAuthorityRef.current.actorId !== completed.actorId) return
      setSavedRun(null)
      const completedProducts = new Set(completed.requests.flatMap((request) => request.bulk
        ? (request.body.items as PendingTransferItem[]).map((item) => String(item.productId)) : [String(request.body.productId)])).size
      const message = (t('transfer_bulk_success') || 'Transferred {n} products').replace('{n}', String(completedProducts))
      notify(completed.merges > 0
        ? `${message} ${(t('transfer_bulk_merged_note') || '({n} merged into existing products)').replace('{n}', String(completed.merges))}`
        : message)
      onDone()
    } catch (error) {
      // A lost committed response retains the original chunk/key for receipt replay.
      if (!aliveRef.current || transferAuthorityRef.current.actorId !== String(user?.id)) return
      setRetryError(localizeBranchRuleError(getErrorMessage(error, t('transfer_bulk_failed') || 'Bulk transfer failed'), t))
    } finally {
      finishSingleAction(transferBulkInFlightRef)
      setSavingBulk(false)
      setChunkProgress(null)
    }
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={() => { if (!saving && !savingBulk) closeGuard.requestClose() }}>
      <div className="modal-panel-safe fade-in flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700 sm:p-5">
          <h2 className="min-w-0 truncate text-lg font-bold text-gray-900 dark:text-white">{t('stock_transfer') || 'Stock Transfer'}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <MinimizeButton onMinimize={preserveAndMinimize} tr={(key, fallback) => t(key) || fallback} disabled={saving || savingBulk || !canTransferStock} />
            <button
              type="button"
              onClick={requestClose}
              disabled={saving || savingBulk}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700"
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {savedRun || retryError || retryStorageError ? (
          <div role="status" className="m-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="min-w-0 break-words">{savedRun ? t('sale_bulk_pending') : retryError || retryStorageError}</p>
            {savedRun ? <>
              <p className="break-words text-xs">{t('from_branch')}: {branchNameById(String(savedRun.requests[0].body.fromBranchId))} → {branchNameById(String(savedRun.requests[0].body.toBranchId))} · {t('transfer_reason')}: {String(savedRun.requests[0].body.reason || '')}</p>
              <p className="text-xs">{t('transfer_chunk_progress').replace('{done}', String(savedRun.next)).replace('{total}', String(savedRun.requests.length))}</p>
              {retryError ? <p className="break-words text-xs">{savedRun.transferred > 0
                ? t('transfer_bulk_partial').replace('{done}', String(savedRun.transferred))
                  .replace('{total}', String(savedRun.requests.reduce((total, request) => total + (request.bulk ? (request.body.items as unknown[]).length : 1), 0)))
                  .replace('{reason}', retryError)
                : retryError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary min-h-10" disabled={saving || savingBulk || !canTransferStock || !!retryStorageError} onClick={() => { void runPendingTransfer(null) }}>{savingBulk ? t('saving') : t('retry')}</button>
              </div>
            </> : null}
          </div>
        ) : null}
        <fieldset disabled={saving || savingBulk || !!savedRun || !!retryStorageError || !canTransferStock || preparingLots}
          className={`modal-scroll min-w-0 space-y-4 p-4 sm:p-5 ${saving || savingBulk || savedRun || retryStorageError || !canTransferStock ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            <div>
              <label htmlFor="transfer-from-branch" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('from_branch') || 'From Branch'}
              </label>
              <AppSelect
                id="transfer-from-branch"
                name="from_branch"
                className="w-full"
                buttonClassName="w-full"
                value={fromBranch}
                options={branchOptions}
                onChange={setTransferSource}
                ariaLabel={t('from_branch') || 'From Branch'}
              />
              {hasCanonicalTransferPair ? (
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{t('transfer_canonical_pair_only') || 'Transfers move stock only between Shop and Warehouse.'}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="transfer-to-branch" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('to_branch') || 'To Branch'}
              </label>
              <AppSelect
                id="transfer-to-branch"
                name="to_branch"
                className="w-full"
                buttonClassName="w-full"
                value={toBranch}
                options={destinationBranchOptions}
                onChange={setToBranch}
                ariaLabel={t('to_branch') || 'To Branch'}
              />
            </div>
          </div>

          {fromBranch && mode === 'single' && !selectedProduct ? (
            <div>
              <label htmlFor="transfer-product-search" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <input
                  id="transfer-product-search"
                  name="transfer_product_search"
                  className="input min-w-0 flex-1"
                  placeholder={t('search_products_placeholder') || 'Search products'}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoFocus
                  autoComplete="off"
                />
                <ScanSearchButton
                  onDetected={handleTransferProductScan}
                  t={t}
                  title={t('scan_product_for_transfer') || 'Scan product for this transfer'}
                />
              </div>
              <div className="max-h-48 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                {loadingProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filtered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('no_data') || 'No data'}</p>
                ) : null}

                {buildProductGroups(filtered as never[], new Map(), { preserveInputOrder: true }).map((group) => {
                  const rows = (group.items || []) as unknown as TransferProduct[]
                  const lead = (group.leadProduct || rows[0]) as unknown as TransferProduct
                  const groupQuantity = rows.reduce((total, row) => total + (Number(row.branch_quantity) || 0), 0)
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => {
                        const sheetRows = sheetChoicesFor(rows, fromBranch, branchNameById(fromBranch))
                        setPicking({ product: { ...sheetRows[0], name: group.name }, rows: sheetRows })
                      }}
                      className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="scroll-x-clean text-sm font-medium text-gray-900 dark:text-white">{group.name}</span>
                        {rows.length > 1
                          ? <span className="ml-2 text-xs text-gray-400">{rows.length} {t('options') || 'Options'}</span>
                          : (lead?.sku ? <span className="ml-2 font-mono text-xs text-gray-400">{lead.sku}</span> : null)}
                      </div>
                      <span className={`shrink-0 text-sm font-bold ${groupQuantity > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {groupQuantity} {lead?.unit}
                      </span>
                    </button>
                  )
                })}
                {!loadingProducts && singleStockPage < singleStockTotalPages ? (
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 text-center text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                    disabled={loadingMoreProducts}
                    onClick={() => { void loadMoreSingleProducts() }}
                  >
                    {loadingMoreProducts ? `${t('loading') || 'Loading'}...` : (t('show_more') || 'Show more')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {picking && mode === 'single' ? (
            <ProductOptionSheet
              product={picking.product as never}
              choices={picking.rows as never[]}
              t={(key: string) => t(key) || key}
              fmtUSD={(value: number) => `$${Number(value || 0).toFixed(2)}`}
              // A transfer READS from the source branch, so every branch the
              // operation permits stays selectable here; the direction rule
              // is enforced on the two branch selects above and again on the
              // Worker.
              intent="stock"
              activeBranchId={fromBranch || null}
              trackedBatchProductIds={trackedBatchProductIds}
              pickLabel={t('select') || 'Select'}
              onClose={() => setPicking(null)}
              onPick={(product, selection) => {
                batchSeedRef.current = selection.batch?.batchId ?? null
                setSelectedProduct(product as unknown as TransferProduct)
                setQuantity('')
                setPicking(null)
              }}
            />
          ) : null}

          {selectedProduct && mode === 'single' ? (
            // Once a product is picked the search box + result list above
            // collapse away entirely (this panel replaces them) -- keeping
            // both stacked made the modal tall enough that quantity/reason sat
            // below the fold, reported as the selected area being "very bad
            // and large". "Change" clears the pick, restoring the list.
            <div className="space-y-2.5 rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="scroll-x-clean text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedProduct.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {t('available') || 'Available'}: <strong>{selectedProduct.branch_quantity} {selectedProduct.unit}</strong>
                  <button
                    type="button"
                    className="rounded-lg border border-blue-200 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
                    onClick={() => {
                      setSelectedProduct(null)
                      setQuantity('')
                    }}
                  >
                    {t('transfer_change_product') || 'Change'}
                  </button>
                </span>
              </div>

              {hasBatchLots ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('transfer_pick_batch_optional') || 'Received date (optional)'}
                  </label>
                  {loadingBatches ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                  ) : productBatches.length === 0 ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('transfer_no_batches') || 'No received dates with stock at this branch'}</p>
                  ) : (
                    <>
                      <div className="max-h-32 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                      <button
                        type="button"
                        onClick={() => setSelectedBatchId(null)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                          selectedBatchId == null
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        <span className="font-medium">{t('transfer_auto_fifo') || 'Automatic (FIFO)'}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{t('transfer_auto_fifo_hint') || 'Use all available received dates'}</span>
                      </button>
                      {productBatches.map((batch) => {
                        const batchOut = Number(batch.quantity || 0) <= 0
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            disabled={batchOut}
                            onClick={() => {
                              setSelectedBatchId(batch.id)
                            }}
                            className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              batch.id === selectedBatchId
                                ? 'bg-blue-100 dark:bg-blue-900/40'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            <span className="font-mono">{batchDisplayLabel({ id: batch.id, lot_code: (batch.lot_code as string) ?? null, received_at: (batch.received_at as string) ?? null, batch_number: (batch.batch_number as number) ?? null }, t('batch') || 'Received date')}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {batch.expiry_date ? `${t('expires') || 'exp'} ${batch.expiry_date} · ` : ''}
                              {batch.quantity} {selectedProduct.unit}
                            </span>
                          </button>
                        )
                      })}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t('transfer_optional_lot_hint') || 'Choose a specific received date only when needed. Otherwise, stock is allocated FIFO from available received dates.'}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {/* Quantity and reason share one row from sm up -- stacked they
                  pushed the panel (and the modal's footer) taller for no
                  gain; each label sits over its own field either way. */}
              <div className="grid gap-2.5 sm:grid-cols-[auto,minmax(0,1fr)]">
                <div>
                  <label htmlFor="transfer-quantity" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('quantity') || 'Quantity'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="transfer-quantity"
                      name="transfer_quantity"
                      className="input w-28"
                      type="number"
                      min="0.01"
                      max={transferAvailable}
                      step="any"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="0"
                      autoFocus
                      aria-invalid={quantity !== '' && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) ? 'true' : 'false'}
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">{selectedProduct.unit}</span>
                    <button
                      className="btn-secondary px-2 py-1.5 text-xs"
                      type="button"
                      onClick={() => setQuantity(String(transferAvailable))}
                    >
                      {t('all') || 'All'}
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <label htmlFor="transfer-reason" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('transfer_reason') || 'Transfer reason'} ({t('required') || 'Required'})
                  </label>
                  <input
                    id="transfer-reason"
                    name="transfer_reason"
                    className="input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t('transfer_stock_note_placeholder') || 'e.g. Restocking branch 2'}
                    aria-required="true"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {mode === 'multiple' ? (
            <div>
              <label htmlFor="transfer-product-search-multi" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <div className="sticky top-0 z-10 mb-2 flex min-w-0 items-center gap-2 bg-white pb-1 dark:bg-gray-800">
                <input
                  id="transfer-product-search-multi"
                  name="transfer_product_search_multi"
                  className="input min-w-0 flex-1"
                  placeholder={t('search_products_placeholder') || 'Search products'}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={!fromBranch}
                  autoFocus
                  autoComplete="off"
                />
                <ScanSearchButton
                  onDetected={handleTransferProductScan}
                  t={t}
                  title={t('scan_product_for_transfer') || 'Scan product for this transfer'}
                />
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                {/* Reveals the branch catalog. A view control, and nothing else. */}
                <button
                  type="button"
                  onClick={() => setShowAllProducts((current) => !current)}
                  aria-pressed={showAllProducts}
                  disabled={!fromBranch || loadingMultiProducts}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    showAllProducts
                      ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t('transfer_show_all_products') || 'Show all products'}
                </button>
                {/* Checks the rows on screen. Hidden until there are rows to check,
                    so it can never be read as "all products in the branch". */}
                {filteredMulti.length > 0 ? (
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllShown}
                      disabled={loadingMultiProducts}
                    />
                    {t('transfer_select_all_shown') || 'Select all shown'}
                  </label>
                ) : null}
                {selectedCount > 0 ? (
                  // The count doubles as a view toggle: tap to see ONLY the
                  // checked rows (review/adjust the whole picked set in one
                  // screen), tap again for the full list.
                  <button
                    type="button"
                    onClick={() => setShowSelectedOnly((current) => !current)}
                    aria-pressed={showSelectedOnly}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                      showSelectedOnly
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50'
                    }`}
                  >
                    {(t('transfer_selected_count') || '{n} selected').replace('{n}', String(selectedCount))}
                  </button>
                ) : null}
              </div>

              {/* Moves everything out of the source branch. Deliberately its
                  own full-width action, not a checkbox: it is the only control
                  here that writes, and it writes a lot. */}
              <button
                type="button"
                onClick={handleTransferEntireBranch}
                disabled={savingBulk || preparingLots || loadingMultiProducts || !fromBranch || !toBranch}
                className="mb-2 w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                {preparingLots ? t('loading') : t('transfer_entire_branch')}
              </button>

              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 sm:max-h-64 sm:overflow-auto dark:divide-gray-700 dark:border-gray-600">
                {loadingMultiProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filteredMulti.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">
                    {!fromBranch
                      ? (t('select_transfer_branches') || 'Choose both source and destination branches.')
                      : !debouncedSearch.trim() && !showAllProducts
                        ? (t('transfer_search_or_show_all') || 'Search products, or use Show all products to list the whole branch')
                        : (t('transfer_no_stock_products') || 'No products with stock in this branch')}
                  </p>
                ) : null}

                {filteredMulti.length === 0 ? null : groupedMulti.flatMap((group) => {
                  const rows = group.rows.map((row) => {
                    const product = row as unknown as TransferProduct
                    const id = String(product.id)
                    const checked = id in selectedQuantities
                    const rowQuantity = selectedQuantities[id] ?? ''
                    const loadedLots = rowLots[id]
                    const lotsReady = loadedLots?.branch === fromBranch && isActorReadScopeCurrent(loadedLots.authority)
                    const lots = lotsReady ? loadedLots.batches : []
                    const chosenLot = lots.find((lot) => Number(lot.id) === selectedLots[id])
                    return (
                      <div
                        key={product.id}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4 ${group.rows.length > 1 ? 'pl-6 sm:pl-8' : ''} ${checked ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProductSelected(product)}
                          aria-label={product.name}
                        />
                        <div className="min-w-0 flex-1 basis-[60%] sm:basis-auto">
                          <div className="scroll-x-clean text-sm font-medium text-gray-900 dark:text-white">{product.name}</div>
                          {product.sku ? <div className="break-all font-mono text-xs text-gray-400">{product.sku}</div> : null}
                        </div>
                        <span className="ml-auto shrink-0 text-xs text-gray-500 sm:ml-0 dark:text-gray-400">
                          {t('available') || 'Available'}: {product.branch_quantity} {product.unit}
                        </span>
                        {checked ? (
                          <input
                            type="number"
                            className="input w-20 shrink-0 px-2 py-1 text-sm"
                            min="0.01"
                            max={chosenLot ? Math.min(Number(product.branch_quantity), Number(chosenLot.quantity)) : 0}
                            disabled={!chosenLot}
                            step="any"
                            value={rowQuantity}
                            onChange={(event) => setProductQuantity(product.id, event.target.value)}
                            aria-label={`${t('quantity') || 'Quantity'} ${product.name}`}
                            aria-invalid={rowQuantity !== '' && (!Number.isFinite(Number(rowQuantity)) || Number(rowQuantity) <= 0) ? 'true' : 'false'}
                          />
                        ) : null}
                        {checked ? (
                          <div className="w-full pl-6">
                            <label htmlFor={`transfer-lot-${id}`} className="mb-1 block text-xs font-medium">{t('transfer_pick_batch')}</label>
                            <select id={`transfer-lot-${id}`} className="input w-full text-sm" value={chosenLot?.id ?? ''} disabled={!lotsReady || !!loadedLots?.error}
                              onChange={(event) => {
                                const batchId = Number(event.target.value)
                                const lot = lots.find((entry) => Number(entry.id) === batchId)
                                setSelectedLots((current) => ({ ...current, [id]: lot ? batchId : 0 }))
                                setProductQuantity(product.id, lot ? String(Math.min(Number(product.branch_quantity), Number(lot.quantity))) : '')
                              }}>
                              <option value="">{t('transfer_pick_batch_first')}</option>
                              {lots.map((lot) => <option key={lot.id} value={lot.id}>{batchDisplayLabel(lot, t('batch'))} · {lot.quantity} {product.unit}</option>)}
                            </select>
                            {!lotsReady ? <p className="text-xs">{t('loading')}</p> : loadedLots?.error || !lots.length ? <p role="alert" className="text-xs text-red-600">{loadedLots?.error || t('transfer_no_batches')}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                  // Same-name group with more than one distinct row (a real
                  // price/barcode/etc. variant, not just a branch
                  // duplicate -- those already collapsed via group.rows) --
                  // label it so the operator can tell these are variants of
                  // one product name, not unrelated separate products.
                  // group.rows.length === 1 renders with no header at all,
                  // same as before this change.
                  if (group.rows.length <= 1) return rows
                  return [
                    <div
                      key={`group-${group.key}`}
                      className="scroll-x-clean bg-gray-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-800/60"
                    >
                      {group.name} · {(t('transfer_group_variant_count') || '{n} variants').replace('{n}', String(group.rows.length))}
                    </div>,
                    ...rows,
                  ]
                })}
              </div>

              <div className="mt-3">
                <label htmlFor="transfer-reason-multi" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('transfer_reason') || 'Transfer reason'} ({t('required') || 'Required'})
                </label>
                <input
                  id="transfer-reason-multi"
                  name="transfer_reason_multi"
                  className="input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('transfer_bulk_note_placeholder') || 'e.g. Restocking branch 2'}
                  aria-required="true"
                />
              </div>
            </div>
          ) : null}
        </fieldset>

        <div className="flex gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:p-5">
          <button
            className="btn-primary flex-1"
            type="button"
            onClick={handleBulkTransfer}
            disabled={!canTransferStock || !!savedRun || !!retryStorageError || savingBulk || preparingLots || loadingMultiProducts || !fromBranch || !toBranch || selectedCount === 0}
          >
            {savingBulk
              ? (chunkProgress
                ? (t('transfer_chunk_progress') || 'Transfer {done} of {total}')
                  .replace('{done}', String(chunkProgress.done + 1))
                  .replace('{total}', String(chunkProgress.total))
                : (t('saving') || 'Saving...'))
              : `${t('transfer_bulk_button') || 'Transfer selected'}${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </button>
        </div>
      </div>

      {/* A run that takes more than one request is not one undoable step, and
          the operator has to be told that before committing, not after. */}
      {pendingTransfer && !savedRun ? (
        <ConfirmDialog
          title={pendingTransfer.scope === 'entire_branch'
            ? (t('transfer_entire_branch') || 'Transfer entire branch')
            : (t('confirm_transfer') || 'Confirm Transfer')}
          message={t('confirm_bulk_transfer_existing_lots')
            .replace('{products}', String(new Set(pendingTransfer.items.map((item) => String(item.productId))).size))
            .replace('{quantity}', String(pendingTransfer.totalUnits))
            .replace('{from}', pendingTransfer.fromName)
            .replace('{to}', pendingTransfer.toName)}
          items={confirmReviewItems(pendingTransfer)}
          note={pendingTransfer.chunks > 1
            ? (t('transfer_entire_branch_note') || 'Runs as {n} transfers, one after another. If one fails the earlier ones stay transferred -- run it again to move the rest.')
              .replace('{n}', String(pendingTransfer.chunks))
            : undefined}
          danger={pendingTransfer.scope === 'entire_branch'}
          working={savingBulk}
          workingLabel={chunkProgress
            ? (t('transfer_chunk_progress') || 'Transfer {done} of {total}')
              .replace('{done}', String(chunkProgress.done + 1))
              .replace('{total}', String(chunkProgress.total))
            : (t('saving') || 'Saving...')}
          confirmLabel={t('transfer') || 'Transfer'}
          onConfirm={() => { runPendingTransfer(pendingTransfer) }}
          onClose={() => { if (!savingBulk) setPendingTransfer(null) }}
          t={t}
        />
      ) : null}
      {/* S4-21: the shared discard prompt, not a local copy. */}
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>,
    document.body,
  )
}
