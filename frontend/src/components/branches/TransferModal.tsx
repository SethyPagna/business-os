import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
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
} from '../../api/branchTransport.ts'
import { getProductBatches, getTrackedBatchProductIds } from '../../api/batchesTransport.ts'
import type { ProductBatch } from '../../api/batchesTransport.ts'
import { useDebouncedValue } from '../products/helpers/productPageHelpers.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import { buildProductGroups } from '../../utils/productGrouping.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

const TRANSFER_STOCK_LOAD_TIMEOUT_MS = 12000
const TRANSFER_STOCK_MUTATION_TIMEOUT_MS = 12000
const TRANSFER_STOCK_BULK_MUTATION_TIMEOUT_MS = 20000
const TRANSFER_SEARCH_DEBOUNCE_MS = 200
const TRANSFER_STOCK_PAGE_SIZE = 50

type TranslateFunction = (key: string) => string
type NotifyFunction = (message: string, type?: string) => void

type BranchOption = {
  id: string | number
  name: string
}

type TransferProduct = {
  id: string | number
  name?: string
  sku?: string
  barcode?: string
  unit?: string
  branch_quantity?: number | string
}

type TransferStockResponse = {
  items?: TransferProduct[]
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
    note: string
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
    note: string
    items: Array<{ productId: string | number; quantity: number }>
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
  const { t, settings } = useApp()

  /**
   * 2. UI State
   * 2.1 Form inputs and branch-scoped product cache.
   */
  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, TRANSFER_SEARCH_DEBOUNCE_MS)
  const [products, setProducts] = useState<TransferProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<TransferProduct | null>(null)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const stockRequestRef = useRef(0)
  const productsBranchRef = useRef('')
  const transferInFlightRef = useRef(false)
  const aliveRef = useRef(true)

  /**
   * 2.1b Batch/lot picker (single mode only) -- when the selected product
   * is batch-tracked at the source branch, the operator has to pick which
   * lot is moving (same "picker required" shape as POS's ProductDetailSheet)
   * instead of transferring an anonymous quantity off the product's total.
   * See branches.ts's POST /transfer batch-aware comment for what happens
   * server-side once a batchId is included.
   */
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const batchRequestRef = useRef(0)
  // Which product ids carry active batch/lot tracking at the source branch
  // (same source of truth POS's ProductDetailSheet uses --
  // getTrackedBatchProductIds -- so a product only forces the picker below
  // when it actually has batch stock to pick from at this branch).
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
  const [mode, setMode] = useState<TransferMode>('single')
  const [multiProducts, setMultiProducts] = useState<TransferProduct[]>([])
  const [loadingMultiProducts, setLoadingMultiProducts] = useState(false)
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({})
  const [savingBulk, setSavingBulk] = useState(false)
  const multiStockRequestRef = useRef(0)
  const multiProductsBranchRef = useRef('')
  const transferBulkInFlightRef = useRef(false)

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(stockRequestRef)
    invalidateTrackedRequest(multiStockRequestRef)
    invalidateTrackedRequest(batchRequestRef)
  }, [])

  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('select_source') || 'Select source branch' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ], [branches, t])

  const destinationBranchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('select_destination') || 'Select destination branch' },
    ...branches
      .filter((branch) => String(branch.id) !== String(fromBranch))
      .map((branch) => ({ value: branch.id, label: branch.name })),
  ], [branches, fromBranch, t])

  const invalidQuantityText = settings?.language === 'km'
    ? 'ចំនួនផ្ទេរត្រូវតែធំជាងសូន្យ។'
    : 'Transfer quantity must be greater than zero'

  /**
   * 3. Source Branch Sync
   * 3.1 Refresh product list each time source branch changes.
   */
  useEffect(() => {
    if (!fromBranch) {
      invalidateTrackedRequest(stockRequestRef)
      productsBranchRef.current = ''
      setLoadingProducts(false)
      setProducts([])
      setSelectedProduct(null)
      setQuantity('')
      return undefined
    }

    const requestId = beginTrackedRequest(stockRequestRef)
    if (productsBranchRef.current !== String(fromBranch)) {
      setProducts([])
      setSelectedProduct(null)
      setQuantity('')
    }
    setLoadingProducts(true)
    async function loadStock() {
      try {
        const stock = await withLoaderTimeout<unknown>(
          () => getTransferApi().getBranchStock(Number.parseInt(fromBranch, 10), { page: 1, pageSize: 50, stockState: 'positive' }),
          'Branch stock for transfer',
          TRANSFER_STOCK_LOAD_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
        productsBranchRef.current = String(fromBranch)
        setProducts(normalizeTransferStockRows(stock))
        setSelectedProduct(null)
        setQuantity('')
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(stockRequestRef, requestId)) return
        setSelectedProduct(null)
        setQuantity('')
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
  }, [fromBranch])

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
          'Product batches for transfer',
          TRANSFER_STOCK_LOAD_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(batchRequestRef, requestId)) return
        setProductBatches(Array.isArray(res?.batches) ? res.batches : [])
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
   * 3.2 Multi-mode source branch sync -- same idea as 3.1, but only runs
   * while multi mode is active, and fetches the unpaged listing instead of
   * a 50-row page (see the multiProducts state comment above for why).
   * Deliberately only triggers on the source branch or a switch *into*
   * multi mode, not on every render -- switching back to single mode
   * leaves the already-fetched list cached in state so flipping back and
   * forth doesn't re-fetch.
   */
  useEffect(() => {
    if (mode !== 'multiple') return undefined
    if (!fromBranch) {
      invalidateTrackedRequest(multiStockRequestRef)
      multiProductsBranchRef.current = ''
      setLoadingMultiProducts(false)
      setMultiProducts([])
      setSelectedQuantities({})
      return undefined
    }
    if (multiProductsBranchRef.current === String(fromBranch)) return undefined

    const requestId = beginTrackedRequest(multiStockRequestRef)
    setMultiProducts([])
    setSelectedQuantities({})
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
        setMultiProducts(normalizeTransferStockRows(stock))
      } catch (error) {
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
  }, [fromBranch, mode])

  // Switching source branch invalidates whatever was picked under the old
  // branch, in both modes -- a selection made against branch A's stock
  // levels has no meaning once fromBranch changes to B.
  useEffect(() => {
    setSelectedQuantities({})
  }, [fromBranch])

  /**
   * 4. Search Filter
   * 4.1 Keeps in-stock list visible when search is empty.
   */
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return products.filter((product) => Number(product.branch_quantity || 0) > 0)
    return products.filter((product) => {
      const name = String(product.name || '').toLowerCase()
      const sku = String(product.sku || '').toLowerCase()
      return name.includes(query) || sku.includes(query)
    })
  }, [products, search])

  /**
   * 4.2 Multi-mode search filter -- same rules as 4.1 (hide zero-stock rows
   * when search is empty, match name/sku when it isn't), sourced from the
   * unpaged multiProducts list instead of the paged single-mode one.
   */
  const filteredMulti = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    const inStock = multiProducts.filter((product) => Number(product.branch_quantity || 0) > 0)
    if (!query) return inStock
    return inStock.filter((product) => {
      const name = String(product.name || '').toLowerCase()
      const sku = String(product.sku || '').toLowerCase()
      return name.includes(query) || sku.includes(query)
    })
  }, [multiProducts, debouncedSearch])

  // Same name/cost/price/barcode grouping every other list surface in the
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
    () => buildProductGroups(filteredMulti as unknown as Parameters<typeof buildProductGroups>[0]),
    [filteredMulti],
  )

  const selectedEntries = useMemo(
    () => Object.entries(selectedQuantities).filter(([, value]) => value !== ''),
    [selectedQuantities],
  )
  const selectedCount = selectedEntries.length
  const allFilteredSelected = filteredMulti.length > 0
    && filteredMulti.every((product) => String(product.id) in selectedQuantities)

  const toggleProductSelected = (product: TransferProduct) => {
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

  const toggleSelectAllFiltered = () => {
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

  // Batch tracked and something is genuinely picked/pickable -- required
  // before a transfer of this product can submit, same "can't move an
  // anonymous quantity off a lot-tracked product" rule as POS's
  // ProductDetailSheet.
  const selectedBatch = productBatches.find((batch) => batch.id === selectedBatchId) || null
  const batchSelectionRequired = !!selectedProduct && trackedBatchProductIds.has(Number(selectedProduct.id))
  const transferAvailable = batchSelectionRequired
    ? Number(selectedBatch?.quantity || 0)
    : Number(selectedProduct?.branch_quantity || 0)

  /**
   * 5. Transfer Action
   * 5.1 Validate all inputs.
   * 5.2 Write transfer row via API.
   */
  const handleTransfer = async () => {
    if (!fromBranch || !toBranch || !selectedProduct || !quantity) return

    if (batchSelectionRequired && !selectedBatchId) {
      notify(t('transfer_pick_batch_first') || 'Pick a lot / batch first', 'error')
      return
    }

    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }

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

    if (!beginSingleAction(transferInFlightRef, { blocked: saving })) return
    setSaving(true)
    try {
      const res = await withLoaderTimeout<TransferResult>(() => getTransferApi().transferStock({
        fromBranchId: Number.parseInt(fromBranch, 10),
        toBranchId: Number.parseInt(toBranch, 10),
        productId: selectedProduct.id,
        productName: selectedProduct.name || '',
        quantity: qty,
        note,
        userId: user?.id,
        userName: user?.name,
        batchId: batchSelectionRequired ? selectedBatchId : null,
      }), 'Transfer branch stock', TRANSFER_STOCK_MUTATION_TIMEOUT_MS)

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

      notify(res?.error || (t('transfer_failed') || 'Transfer failed'), 'error')
    } catch (error) {
      notify(getErrorMessage(error, t('transfer_failed') || 'Transfer failed'), 'error')
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
  const handleBulkTransfer = async () => {
    if (!fromBranch || !toBranch) return
    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }
    if (!selectedEntries.length) return

    const productsById = new Map(multiProducts.map((product) => [String(product.id), product]))
    const items: Array<{ productId: string | number; quantity: number }> = []
    for (const [productId, rawQuantity] of selectedEntries) {
      const product = productsById.get(productId)
      const qty = Number(rawQuantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        notify(`${product?.name || productId}: ${invalidQuantityText}`, 'error')
        return
      }
      if (product && qty > Number(product.branch_quantity || 0)) {
        const message = (t('transfer_only_available') || 'Only {n} available').replace('{n}', String(product.branch_quantity))
        notify(`${product.name || productId}: ${message} ${product.unit || ''}`.trim(), 'error')
        return
      }
      items.push({ productId, quantity: qty })
    }

    if (!beginSingleAction(transferBulkInFlightRef, { blocked: savingBulk })) return
    setSavingBulk(true)
    try {
      const res = await withLoaderTimeout<TransferBulkResult>(() => getTransferApi().transferStockBulk({
        fromBranchId: Number.parseInt(fromBranch, 10),
        toBranchId: Number.parseInt(toBranch, 10),
        note,
        items,
        userId: user?.id,
        userName: user?.name,
      }), 'Bulk transfer branch stock', TRANSFER_STOCK_BULK_MUTATION_TIMEOUT_MS)

      if (res?.success !== false) {
        const message = (t('transfer_bulk_success') || 'Transferred {n} products').replace('{n}', String(res.transferredCount ?? items.length))
        // Same identity-match redirect as the single-item handler above,
        // just per-item -- summarize how many of this batch redirected
        // rather than naming each one (could be up to 200 items).
        const mergeCount = res.merges?.length ?? 0
        const finalMessage = mergeCount > 0
          ? `${message} ${(t('transfer_bulk_merged_note') || '({n} merged into existing products)').replace('{n}', String(mergeCount))}`
          : message
        notify(finalMessage)
        onDone()
        return
      }

      notify(res?.error || (t('transfer_bulk_failed') || 'Bulk transfer failed'), 'error')
    } catch (error) {
      notify(getErrorMessage(error, t('transfer_bulk_failed') || 'Bulk transfer failed'), 'error')
    } finally {
      finishSingleAction(transferBulkInFlightRef)
      setSavingBulk(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="fade-in flex max-h-modal-92 w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('stock_transfer') || 'Stock Transfer'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            aria-label={t('close') || 'Close'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          <div className="grid grid-cols-2 gap-3">
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
                onChange={setFromBranch}
                ariaLabel={t('from_branch') || 'From Branch'}
              />
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

          {fromBranch ? (
            <div className="flex gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/50" role="tablist" aria-label="Transfer mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'single'}
                onClick={() => setMode('single')}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'single'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {t('transfer_mode_single') || 'Single product'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'multiple'}
                onClick={() => setMode('multiple')}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === 'multiple'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {t('transfer_mode_multiple') || 'Multiple products'}
              </button>
            </div>
          ) : null}

          {fromBranch && mode === 'single' ? (
            <div>
              <label htmlFor="transfer-product-search" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <input
                id="transfer-product-search"
                name="transfer_product_search"
                className="input mb-2"
                placeholder={t('search_products_placeholder') || 'Search products'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="max-h-48 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                {loadingProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filtered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('no_data') || 'No data'}</p>
                ) : null}

                {filtered.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => {
                      setSelectedProduct(product)
                      setQuantity('')
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
                      selectedProduct?.id === product.id
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</span>
                      {product.sku ? <span className="ml-2 font-mono text-xs text-gray-400">{product.sku}</span> : null}
                    </div>
                    <span className={`text-sm font-bold ${Number(product.branch_quantity || 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {product.branch_quantity} {product.unit}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {selectedProduct && mode === 'single' ? (
            <div className="space-y-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-900/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedProduct.name}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t('available') || 'Available'}: <strong>{selectedProduct.branch_quantity} {selectedProduct.unit}</strong>
                </span>
              </div>

              {batchSelectionRequired ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('transfer_pick_batch') || 'Pick a lot / batch'}
                  </label>
                  {loadingBatches ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                  ) : productBatches.length === 0 ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('transfer_no_batches') || 'No lots with stock at this branch'}</p>
                  ) : (
                    <div className="max-h-32 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                      {productBatches.map((batch) => {
                        const batchOut = Number(batch.quantity || 0) <= 0
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            disabled={batchOut}
                            onClick={() => {
                              setSelectedBatchId(batch.id)
                              setQuantity('')
                            }}
                            className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              batch.id === selectedBatchId
                                ? 'bg-blue-100 dark:bg-blue-900/40'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            <span className="font-mono">{batchDisplayLabel({ id: batch.id, lot_code: (batch.lot_code as string) ?? null, received_at: (batch.received_at as string) ?? null, batch_number: (batch.batch_number as number) ?? null }, t('batch') || 'Batch')}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {batch.expiry_date ? `${t('expires') || 'exp'} ${batch.expiry_date} · ` : ''}
                              {batch.quantity} {selectedProduct.unit}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              <div>
                <label htmlFor="transfer-quantity" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('quantity') || 'Quantity'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="transfer-quantity"
                    name="transfer_quantity"
                    className="input w-40"
                    type="number"
                    min="0.01"
                    max={transferAvailable}
                    step="any"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="0"
                    autoFocus
                    disabled={batchSelectionRequired && !selectedBatchId}
                    aria-invalid={quantity !== '' && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) ? 'true' : 'false'}
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">{selectedProduct.unit}</span>
                  <button
                    className="btn-secondary px-2 py-1.5 text-xs"
                    type="button"
                    disabled={batchSelectionRequired && !selectedBatchId}
                    onClick={() => setQuantity(String(transferAvailable))}
                  >
                    {t('all') || 'All'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="transfer-note" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('transfer_note') || 'Transfer note'} ({t('optional') || 'Optional'})
                </label>
                <input
                  id="transfer-note"
                  name="transfer_note"
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('transfer_stock_note_placeholder') || 'e.g. Restocking branch 2'}
                />
              </div>
            </div>
          ) : null}

          {fromBranch && mode === 'multiple' ? (
            <div>
              <label htmlFor="transfer-product-search-multi" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <input
                id="transfer-product-search-multi"
                name="transfer_product_search_multi"
                className="input mb-2"
                placeholder={t('search_products_placeholder') || 'Search products'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  disabled={loadingMultiProducts || filteredMulti.length === 0}
                />
                {t('transfer_select_all') || 'Select all'}
                {selectedCount > 0 ? (
                  <span className="text-xs font-normal text-gray-400">
                    {(t('transfer_selected_count') || '{n} selected').replace('{n}', String(selectedCount))}
                  </span>
                ) : null}
              </label>

              <div className="max-h-64 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                {loadingMultiProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filteredMulti.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('transfer_no_stock_products') || 'No products with stock in this branch'}</p>
                ) : null}

                {filteredMulti.length === 0 ? null : groupedMulti.flatMap((group) => {
                  const rows = group.rows.map((row) => {
                    const product = row as unknown as TransferProduct
                    const id = String(product.id)
                    const checked = id in selectedQuantities
                    const rowQuantity = selectedQuantities[id] ?? ''
                    return (
                      <div
                        key={product.id}
                        className={`flex items-center gap-3 px-4 py-2.5 ${group.rows.length > 1 ? 'pl-8' : ''} ${checked ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProductSelected(product)}
                          aria-label={product.name}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{product.name}</div>
                          {product.sku ? <div className="truncate font-mono text-xs text-gray-400">{product.sku}</div> : null}
                        </div>
                        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                          {t('available') || 'Available'}: {product.branch_quantity} {product.unit}
                        </span>
                        {checked ? (
                          <input
                            type="number"
                            className="input w-20 shrink-0 px-2 py-1 text-sm"
                            min="0.01"
                            max={product.branch_quantity}
                            step="any"
                            value={rowQuantity}
                            onChange={(event) => setProductQuantity(product.id, event.target.value)}
                            aria-label={`${t('quantity') || 'Quantity'} ${product.name}`}
                            aria-invalid={rowQuantity !== '' && (!Number.isFinite(Number(rowQuantity)) || Number(rowQuantity) <= 0) ? 'true' : 'false'}
                          />
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
                      className="bg-gray-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-800/60"
                    >
                      {group.name} · {(t('transfer_group_variant_count') || '{n} variants').replace('{n}', String(group.rows.length))}
                    </div>,
                    ...rows,
                  ]
                })}
              </div>

              <div className="mt-3">
                <label htmlFor="transfer-note-multi" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('transfer_note') || 'Transfer note'} ({t('optional') || 'Optional'})
                </label>
                <input
                  id="transfer-note-multi"
                  name="transfer_note_multi"
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('transfer_bulk_note_placeholder') || 'e.g. Restocking branch 2'}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-gray-200 p-5 dark:border-gray-700">
          {mode === 'single' ? (
            <button
              className="btn-primary flex-1"
              type="button"
              onClick={handleTransfer}
              disabled={saving || loadingProducts || !fromBranch || !toBranch || !selectedProduct || !quantity || (batchSelectionRequired && !selectedBatchId)}
            >
              {saving ? (t('saving') || 'Saving...') : (t('stock_transfer') || 'Transfer')}
            </button>
          ) : (
            <button
              className="btn-primary flex-1"
              type="button"
              onClick={handleBulkTransfer}
              disabled={savingBulk || loadingMultiProducts || !fromBranch || !toBranch || selectedCount === 0}
            >
              {savingBulk
                ? (t('saving') || 'Saving...')
                : `${t('transfer_bulk_button') || 'Transfer selected'}${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            </button>
          )}
          <button className="btn-secondary" type="button" onClick={onClose} disabled={saving || savingBulk}>
            {t('cancel') || 'Cancel'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
