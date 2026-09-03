import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { fuzzyTextMatches, sortBySearchRelevance } from '../../utils/searchMatch.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import { buildProductGroups } from '../../utils/productGrouping.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'

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
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({})
  // Multi mode: view filter that narrows the (whole-catalog) list to just
  // the checked rows, so the picked set can be reviewed/adjusted in one
  // screen instead of hunting scattered highlighted rows through thousands.
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [savingBulk, setSavingBulk] = useState(false)
  const multiStockRequestRef = useRef(0)
  const multiProductsBranchRef = useRef('')
  const selectAllAfterLoadRef = useRef(false)
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
    }
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
      selectAllAfterLoadRef.current = false
      return undefined
    }
    const catalogRequested = Boolean(debouncedSearch.trim()) || showAllProducts
    if (!catalogRequested) return undefined
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
        const normalized = normalizeTransferStockRows(stock)
        setMultiProducts(normalized)
        if (selectAllAfterLoadRef.current) {
          selectAllAfterLoadRef.current = false
          setSelectedQuantities(Object.fromEntries(
            normalized
              .filter((product) => Number(product.branch_quantity || 0) > 0)
              .map((product) => [String(product.id), String(product.branch_quantity ?? '')]),
          ))
        }
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
  }, [debouncedSearch, fromBranch, mode, showAllProducts])

  // Switching source branch invalidates whatever was picked under the old
  // branch, in both modes -- a selection made against branch A's stock
  // levels has no meaning once fromBranch changes to B.
  useEffect(() => {
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
    if (!debouncedSearch.trim() && !showAllProducts) {
      setShowAllProducts(true)
      if (!multiProducts.length) {
        selectAllAfterLoadRef.current = true
        return
      }
      setSelectedQuantities(Object.fromEntries(
        multiProducts
          .filter((product) => Number(product.branch_quantity || 0) > 0)
          .map((product) => [String(product.id), String(product.branch_quantity ?? '')]),
      ))
      return
    }
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

  // A selected lot caps the request to that lot. With no selected lot, the
  // whole branch quantity is available and the server performs FIFO allocation.
  const selectedBatch = productBatches.find((batch) => batch.id === selectedBatchId) || null
  const hasBatchLots = !!selectedProduct && trackedBatchProductIds.has(Number(selectedProduct.id))
  const transferAvailable = selectedBatch
    ? Number(selectedBatch.quantity || 0)
    : Number(selectedProduct?.branch_quantity || 0)

  /**
   * 5. Transfer Action
   * 5.1 Validate all inputs.
   * 5.2 Write transfer row via API.
   */
  const handleTransfer = async () => {
    if (!fromBranch || !toBranch || !selectedProduct || !quantity) return

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

    const fromName = branches.find((branch) => String(branch.id) === String(fromBranch))?.name || t('source_branch') || 'source branch'
    const toName = branches.find((branch) => String(branch.id) === String(toBranch))?.name || t('destination_branch') || 'destination branch'
    const lot = selectedBatch
      ? ` ${t('transfer_selected_lot') || 'Selected lot'}: ${batchDisplayLabel({ id: selectedBatch.id, lot_code: (selectedBatch.lot_code as string) ?? null, received_at: (selectedBatch.received_at as string) ?? null, batch_number: (selectedBatch.batch_number as number) ?? null }, t('batch') || 'Batch')}.`
      : ` ${t('transfer_fifo_lot_notice') || 'Available lots will be allocated FIFO.'}`
    if (!window.confirm((t('confirm_transfer_details') || 'Transfer {n} {unit} of "{name}" from {from} to {to}?')
      .replace('{n}', String(qty))
      .replace('{unit}', selectedProduct.unit || '')
      .replace('{name}', selectedProduct.name || '')
      .replace('{from}', fromName)
      .replace('{to}', toName) + lot)) return

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
        batchId: selectedBatchId,
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

    const fromName = branches.find((branch) => String(branch.id) === String(fromBranch))?.name || t('source_branch') || 'source branch'
    const toName = branches.find((branch) => String(branch.id) === String(toBranch))?.name || t('destination_branch') || 'destination branch'
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
    if (!window.confirm((t('confirm_bulk_transfer_details') || 'Transfer {products} products ({quantity} total units) from {from} to {to}? Available lots will be allocated FIFO.')
      .replace('{products}', String(items.length))
      .replace('{quantity}', String(totalQuantity))
      .replace('{from}', fromName)
      .replace('{to}', toName))) return

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
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center">
      <div className="modal-panel-safe fade-in flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700 sm:p-5">
          <h2 className="min-w-0 truncate text-lg font-bold text-gray-900 dark:text-white">{t('stock_transfer') || 'Stock Transfer'}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="btn-primary min-h-9 max-w-28 truncate px-3 py-1.5 text-xs sm:hidden"
              type="button"
              onClick={handleBulkTransfer}
              disabled={savingBulk || loadingMultiProducts || !fromBranch || !toBranch || selectedCount === 0}
            >
              {saving || savingBulk ? (t('saving') || 'Saving...') : (t('transfer') || 'Transfer')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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

                {filtered.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => {
                      setSelectedProduct(product)
                      setQuantity('')
                    }}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</span>
                      {product.sku ? <span className="ml-2 font-mono text-xs text-gray-400">{product.sku}</span> : null}
                    </div>
                    <span className={`shrink-0 text-sm font-bold ${Number(product.branch_quantity || 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {product.branch_quantity} {product.unit}
                    </span>
                  </button>
                ))}
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

          {selectedProduct && mode === 'single' ? (
            // Once a product is picked the search box + result list above
            // collapse away entirely (this panel replaces them) -- keeping
            // both stacked made the modal tall enough that quantity/note sat
            // below the fold, reported as the selected area being "very bad
            // and large". "Change" clears the pick, restoring the list.
            <div className="space-y-2.5 rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedProduct.name}</span>
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
                    {t('transfer_pick_batch_optional') || 'Lot / batch (optional)'}
                  </label>
                  {loadingBatches ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                  ) : productBatches.length === 0 ? (
                    <p className="py-3 text-center text-sm text-gray-400">{t('transfer_no_batches') || 'No lots with stock at this branch'}</p>
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
                        <span className="text-xs text-gray-500 dark:text-gray-400">{t('transfer_auto_fifo_hint') || 'Use all available lots'}</span>
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
                            <span className="font-mono">{batchDisplayLabel({ id: batch.id, lot_code: (batch.lot_code as string) ?? null, received_at: (batch.received_at as string) ?? null, batch_number: (batch.batch_number as number) ?? null }, t('batch') || 'Batch')}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {batch.expiry_date ? `${t('expires') || 'exp'} ${batch.expiry_date} · ` : ''}
                              {batch.quantity} {selectedProduct.unit}
                            </span>
                          </button>
                        )
                      })}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t('transfer_optional_lot_hint') || 'Choose a specific lot only when needed. Otherwise, stock is allocated FIFO from available lots.'}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {/* Quantity and note share one row from sm up -- stacked they
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
            </div>
          ) : null}

          {fromBranch && mode === 'multiple' ? (
            <div>
              <label htmlFor="transfer-product-search-multi" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <input
                  id="transfer-product-search-multi"
                  name="transfer_product_search_multi"
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

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    disabled={loadingMultiProducts}
                  />
                  {t('transfer_select_all') || 'Select all'}
                </label>
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

              <div className="max-h-64 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                {loadingMultiProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filteredMulti.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">
                    {!debouncedSearch.trim() && !showAllProducts
                      ? (t('transfer_search_or_select_all') || 'Search products, or use Select all to show the full catalog')
                      : (t('transfer_no_stock_products') || 'No products with stock in this branch')}
                  </p>
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
                          <div className="whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-white">{product.name}</div>
                          {product.sku ? <div className="break-all font-mono text-xs text-gray-400">{product.sku}</div> : null}
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
                      className="whitespace-normal break-words bg-gray-50 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-800/60"
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

        <div className="hidden gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex sm:p-5">
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
          <button className="btn-secondary" type="button" onClick={onClose} disabled={saving || savingBulk}>
            {t('cancel') || 'Cancel'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
