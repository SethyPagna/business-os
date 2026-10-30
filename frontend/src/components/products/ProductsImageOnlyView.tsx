import ProductNameRail from '../shared/ProductNameRail'
// ProductsImageOnlyView
//
// Part 241: the rendered surface for a user whose ONE route into the
// Products page is the `products_image_only` restricted role (see
// AppContext.tsx's canAccessPage and permissionDefinitions.ts for how this
// role is granted, and cloudflare/src/lib/productWrites.ts /
// routes/products.ts for the server-side field restriction this view's
// data already arrives pre-shaped by). Deliberately separate from the full
// Products.tsx editor rather than a conditional inside it -- this role
// only ever sees id/name/selling_price_usd/selling_price_khr/image_path/
// updated_at per row (IMAGE_ONLY_VISIBLE_FIELDS), and can only ever write
// image_path (IMAGE_ONLY_WRITABLE_FIELDS). The backend enforces both of
// those independently of this component, so nothing here is a real
// security boundary -- it's just the UI shaped to match what this role can
// actually do, instead of showing (and then 403'ing on) controls for
// fields this role can't see or touch.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp, useLowStockConfig } from '../../AppContext'
import { effectiveLowStockThreshold } from '../../utils/lowStockSettings.ts'
import ProductsImageOnlyControls, { type ImageOnlyScope } from './ProductsImageOnlyControls'
import ScanMissNotice from '../shared/ScanMissNotice'
import { useScannedQuery } from '../shared/useScannedQuery.ts'
import { statsPresetRange, type DateTimeRange } from '../shared/statsStripPresets.ts'
import PaginationControls, { PAGE_SIZE_OPTIONS } from '../shared/PaginationControls'
import Modal from '../shared/Modal'
import { ProductImg, ProductImagePlaceholder } from './shared/primitives'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import { classifyScanMiss } from '../../utils/scanMiss.ts'
import { fmtDateOnly } from '../../utils/formatters'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { sortLotsForDisplay } from '../../utils/lotDisplayOrder.ts'
import { pickFiles } from '../../utils/filePicker.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import type { ImageOnlyProductSearchParams, ImageOnlyProductSearchPayload } from '../../api/productReadTransport.ts'

// Same lazyRetry pattern ProductForm.tsx already uses for this modal --
// keeps it out of this view's own (deliberately tiny, per Part 241) bundle
// chunk until a row's "Open Files" button is actually tapped.
const FilePickerModal = lazyRetry(() => import('../files/FilePickerModal'), 'products-image-only-file-picker-modal')

// Base fields (id/name/image_path/updated_at) are always present -- see
// productWrites.ts's IMAGE_ONLY_BASE_FIELDS. The rest (selling price,
// barcode, category, brand, stock) are each individually optional (Part
// 243: productWrites.ts's IMAGE_ONLY_OPTIONAL_FIELDS) -- the server only
// sends a given one of these when this user's role holds the matching
// products_image_only_show_* permission, so every field below is declared
// optional/possibly-absent rather than assuming presence.
interface ImageOnlyProduct {
  id: number
  name: string
  image_path?: string | null
  updated_at?: string
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  // No special_price_* here: the 2026-09-04 ruling deleted the "VIP" tier and
  // migration 0111 moved its values into wholesale_price_*, which is now the
  // one and only discounted tier this view can show.
  wholesale_price_usd?: number | string | null
  wholesale_price_khr?: number | string | null
  barcode?: string | null
  category?: string | null
  brand?: string | null
  stock_quantity?: number | string | null
  // K6: attached per-branch quantities -- present only when the
  // products_image_only_show_branch_stock grant allowlists the key.
  branch_stock?: Array<{ branch_id: number; branch_name?: string; quantity?: number }>

  low_stock_threshold?: number | string | null
  out_of_stock_threshold?: number | string | null
}

interface ImageOnlyApp {
  t: (key: string) => string
  notify: (message: string, tone?: string) => void
  hasPermission: (key: string) => boolean
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
}

const useImageOnlyApp = useApp as () => ImageOnlyApp

let readModulePromise: Promise<typeof import('../../api/productReadTransport.ts')> | null = null
let writeModulePromise: Promise<typeof import('../../api/productWriteTransport.ts')> | null = null
let uploadModulePromise: Promise<typeof import('../../api/productImageUploadTransport.ts')> | null = null

function loadReadModule() {
  readModulePromise ||= import('../../api/productReadTransport.ts')
  return readModulePromise
}
function loadWriteModule() {
  writeModulePromise ||= import('../../api/productWriteTransport.ts')
  return writeModulePromise
}
function loadUploadModule() {
  uploadModulePromise ||= import('../../api/productImageUploadTransport.ts')
  return uploadModulePromise
}

// The photo a row has just been given, shown from its local object URL while it uploads. A failed one stays on
// the row with its file so Retry sends the same photo again instead of asking the person to pick it twice.
interface RowPhoto {
  token: number
  file: File
  url: string
  status: 'uploading' | 'failed'
  error: string
  // Set once the upload itself succeeded, so a Retry after a failed product save does not upload the file twice.
  path: string
}

function previewUrlFor(file: File): string {
  try {
    return URL.createObjectURL(file)
  } catch {
    return ''
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeRows(payload: unknown): { items: ImageOnlyProduct[]; total: number; facets: ImageOnlyFacets } {
  if (Array.isArray(payload)) return { items: payload as ImageOnlyProduct[], total: payload.length, facets: { categories: [], brands: [] } }
  const record = (payload && typeof payload === 'object' ? payload : {}) as Partial<Pick<ImageOnlyProductSearchPayload, 'items' | 'total' | 'facets'>>
  const items = Array.isArray(record.items) ? (record.items as ImageOnlyProduct[]) : []
  const total = Number(record.total ?? items.length) || items.length
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [])
  return { items, total, facets: { categories: list(record.facets?.categories), brands: list(record.facets?.brands) } }
}

interface ImageOnlyFacets { categories: string[]; brands: string[] }

// The stock a row may show. A row the server sent WITHOUT stock_quantity (or with null) has an unknown stock, not a
// zero one: Number(missing || 0) painted such rows as a red "Stock: 0" and told the person a product was out.
function stockReading(raw: unknown, lowStockConfig: Parameters<typeof effectiveLowStockThreshold>[0], product: ImageOnlyProduct): { qty: number | null; tone: string } {
  const qty = raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw)
  if (qty === null) return { qty, tone: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700' }
  const tone = qty <= Number(product.out_of_stock_threshold ?? 0)
    ? 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/60'
    : qty <= effectiveLowStockThreshold(lowStockConfig, product.low_stock_threshold)
      ? 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60'
      : 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/60'
  return { qty, tone }
}

export default function ProductsImageOnlyView() {
  const { t, notify, hasPermission, fmtUSD, fmtKHR } = useImageOnlyApp()
  // Settings > Stock Alerts -- the image grid and its details flyout are
  // coloured by the same number as the table view of the same catalog.
  const lowStockConfig = useLowStockConfig()
  // Which optional fields this specific role has been granted (Part 243) --
  // the server already only sends the fields it's granted (see
  // productWrites.ts's computeImageOnlyVisibleFields), so these flags just
  // decide whether this view bothers rendering a row/column for a field
  // that, for a role without the grant, will simply never be present on
  // `product` anyway. Kept as plain booleans (not memoized) since
  // hasPermission() itself is already a cheap map lookup.
  const showPrice = hasPermission('products_image_only_show_price')
  // showVip is gone with the tier: the 2026-09-04 ruling deleted the "VIP"
  // price outright (it was always the wholesale price under a wrong name), so
  // `products_image_only_show_vip` no longer exists as a permission either.
  // Wholesale shows in the DETAIL panel only (not the card list), matching the
  // "wholesale only in click-to-view detail" preference and keeping the card
  // compact.
  const showWholesale = hasPermission('products_image_only_show_wholesale')
  const showBarcode = hasPermission('products_image_only_show_barcode')
  const showCategory = hasPermission('products_image_only_show_category')
  const showBrand = hasPermission('products_image_only_show_brand')
  const showStock = hasPermission('products_image_only_show_stock')
  // K6 (Part 387): per-branch quantities ride the row's attached
  // branch_stock array (server allowlists the key on this grant); lots come
  // from GET /api/batches per branch, fetched lazily when the detail opens.
  const showBranchStock = hasPermission('products_image_only_show_branch_stock')
  const showBatches = hasPermission('products_image_only_show_batches')
  const [items, setItems] = useState<ImageOnlyProduct[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  // Same 180 ms the full Products editor waits before searching; every
  // keystroke used to send its own request (G39 5.1). G37 made the same fix
  // independently: one request per settled query, and the shared
  // products:search abort group drops a superseded one in flight.
  const debouncedSearch = useDebouncedValue(search, 180)
  // Default scope: all time, every stock state, name A-Z. Nothing but the page is sent for it, so the unfiltered
  // list is the same request it always was.
  const [range, setRange] = useState<DateTimeRange>(() => statsPresetRange('all'))
  const [scope, setScope] = useState<ImageOnlyScope>({ stockState: '', category: '', brand: '', sort: 'name_asc' })
  const [facets, setFacets] = useState<ImageOnlyFacets>({ categories: [], brands: [] })
  const [page, setPage] = useState(1)
  // Back to page 1 in the same render ANY part of the scope changes (search text, dates, a filter, the sort), so
  // the narrowed list is one request rather than one for the old page and one for page 1.
  const scopeKey = JSON.stringify([debouncedSearch, range.startDate, range.endDate, scope.stockState, scope.category, scope.brand, scope.sort])
  const [pageScope, setPageScope] = useState(scopeKey)
  if (pageScope !== scopeKey) {
    setPageScope(scopeKey)
    setPage(1)
  }
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The search text the rows on screen answer, so a scan's "no such barcode" waits for its own page.
  const [answeredSearch, setAnsweredSearch] = useState<string | null>(null)
  const { scannedCode, markScanned } = useScannedQuery(search)
  const applyScan = useCallback((code: string) => {
    markScanned(code)
    setSearch(code)
  }, [markScanned])
  // Which row's image save is in flight, if any -- used to disable that
  // row's upload actions so a second tap can't fire a second upload+save
  // before the first one lands (same class of bug as the full editor's
  // Save-button-during-upload race, see ProductForm.tsx's saveForm guard).
  const [savingId, setSavingId] = useState<number | null>(null)
  const savingRef = useRef(false)
  const queuedSavesRef = useRef<Array<{ product: ImageOnlyProduct; task: () => Promise<void> }>>([])
  // Per-row local previews and their upload state (see RowPhoto). The ref is the source of truth for the async
  // upload callbacks; the state only drives rendering.
  const [rowPhotos, setRowPhotos] = useState<Record<number, RowPhoto>>({})
  const rowPhotosRef = useRef<Record<number, RowPhoto>>({})
  const rowPhotoTokenRef = useRef(0)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      for (const photo of Object.values(rowPhotosRef.current)) if (photo.url) URL.revokeObjectURL(photo.url)
      rowPhotosRef.current = {}
    }
  }, [])
  // A failed photo lives only in this view's memory, so leaving the page would drop it silently: the navigation guard asks first.
  useEffect(() => registerDirtyWork({
    key: 'products-image-only-failed-photos',
    pageId: 'products',
    label: t('image_upload_failed') || 'Image upload failed',
    isDirty: () => Object.values(rowPhotosRef.current).some((photo) => photo.status === 'failed'),
    discard: () => {
      for (const [productId, photo] of Object.entries(rowPhotosRef.current)) if (photo.status === 'failed') setRowPhoto(Number(productId), null)
    },
  }), [t])
  // Which row's "choose an existing library file" picker is open, if any --
  // a single shared FilePickerModal instance (same "one at a time" reasoning
  // as the hidden file input above), targeted at whichever row opened it.
  const [libraryPickerProductId, setLibraryPickerProductId] = useState<number | null>(null)
  // User-reported gap: "the image-only permission for products page for
  // products should be able to click to view details also... because in
  // small screens it gets cut '...' click to view details only show what
  // is allowed in permission." The name/meta line is truncated with
  // `truncate` for the compact list row, and there was previously no way
  // to see the un-truncated value at all. This just opens a small modal
  // with whatever fields the server already sent for this role (the same
  // IMAGE_ONLY_VISIBLE_FIELDS-restricted `product` object the row itself
  // renders from) -- no new data fetch, no new permission surface, purely
  // a way to read the full value of what's already on screen.
  const [detailsProduct, setDetailsProduct] = useState<ImageOnlyProduct | null>(null)
  // K6: lots for the open detail, one flat list across the row's branches
  // ('loading' | 'error' | rows). Only ever fetched when the grant exists.
  type DetailBatchRow = { id: number; lotCode: string | null; receivedAt: string | null; expiryDate: string | null; batchNumber: number | null; quantity: number; branchName: string }
  const [detailBatches, setDetailBatches] = useState<'loading' | 'error' | DetailBatchRow[]>([])
  useEffect(() => {
    if (!detailsProduct || !showBatches) { setDetailBatches([]); return }
    const branches = Array.isArray(detailsProduct.branch_stock) ? detailsProduct.branch_stock : []
    if (!branches.length) { setDetailBatches([]); return }
    let alive = true
    setDetailBatches('loading')
    Promise.all(branches.map(async (branch) => {
      const { getProductBatches } = await import('../../api/batchesTransport.ts')
      const result = await getProductBatches(Number(detailsProduct.id), branch.branch_id)
      return (result?.batches || []).map((batch) => ({
        id: batch.id,
        lotCode: batch.lot_code,
        receivedAt: batch.received_at,
        expiryDate: batch.expiry_date,
        batchNumber: batch.batch_number,
        quantity: Number(batch.quantity || 0),
        branchName: branch.branch_name || String(branch.branch_id),
      }))
    }))
      .then((lists) => { if (alive) setDetailBatches(sortLotsForDisplay(lists.flat().map((row) => ({ ...row, lot_code: row.lotCode, received_at: row.receivedAt, batch_number: row.batchNumber, expiry_date: row.expiryDate })))) })
      .catch(() => { if (alive) setDetailBatches('error') })
    return () => { alive = false }
  }, [detailsProduct, showBatches])
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const module = await loadReadModule()
      // Only a filter this role holds the grant for is ever sent: the server answers an ungranted one with 403
      // image_only_filter_hidden. Empty values are dropped by the transport, so the default scope adds nothing.
      const params: ImageOnlyProductSearchParams = { q: debouncedSearch, page, pageSize }
      if (showBatches && range.startDate) params.startDate = range.startDate
      if (showBatches && range.endDate) params.endDate = range.endDate
      if (showStock && scope.stockState) params.stockState = scope.stockState
      if (showCategory && scope.category) params.category = scope.category
      if (showBrand && scope.brand) params.brand = scope.brand
      if (scope.sort === 'name_desc') params.sort = scope.sort
      const payload = await module.searchProducts(params)
      if (requestIdRef.current !== requestId) return
      const { items: rows, total: rowTotal, facets: rowFacets } = normalizeRows(payload)
      setItems(rows)
      setTotal(rowTotal)
      setFacets(rowFacets)
      setAnsweredSearch(debouncedSearch)
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setLoadError(getErrorMessage(error, t('load_failed') || 'Failed to load products'))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [debouncedSearch, page, pageSize, range.startDate, range.endDate, scope, showBatches, showStock, showCategory, showBrand, t])

  useEffect(() => { load() }, [load])

  // This role has no search index, so a filter that may hide the barcode leaves the empty list unexplained (plain
  // empty state); with none on, an empty answer to a scan means no product has it. It cannot create products.
  const filtersActive = Boolean((showBatches && (range.startDate || range.endDate))
    || (showStock && scope.stockState) || (showCategory && scope.category) || (showBrand && scope.brand))
  const scanMiss = classifyScanMiss({
    scannedCode,
    answered: !loading && answeredSearch === scannedCode && debouncedSearch === scannedCode,
    listEmpty: items.length === 0,
    filtersActive,
    inCatalog: null,
  })

  // Shared by all three upload paths (choose file / take photo / pick from
  // library) -- each just needs to arrive at a public path, then this does
  // the one write every path has in common. Kept as the single place that
  // sends the image_path-only payload, so isImageOnlyWritePayload's "only
  // this one field" server-side rule can't drift between paths.
  async function saveImagePath(product: ImageOnlyProduct, path: string) {
    const writeModule = await loadWriteModule()
    const result = await writeModule.updateProduct(product.id, { image_path: path }) as { success?: boolean; error?: string; item?: ImageOnlyProduct } | undefined
    if (result?.success === false) throw new Error(result.error || 'Failed to save image')
    setItems((current) => current.map((row) => (
      row.id === product.id ? { ...row, image_path: result?.item?.image_path ?? path, updated_at: result?.item?.updated_at ?? row.updated_at } : row
    )))
    notify(t('product_updated') || 'Product updated')
  }

  // One row saves at a time. A photo that reaches the picker after its focus fallback gave up (Android returns the
  // camera shot that way) waits its turn here instead of being dropped.
  async function saveRow(product: ImageOnlyProduct, task: () => Promise<void>) {
    if (savingRef.current) {
      queuedSavesRef.current.push({ product, task })
      return
    }
    savingRef.current = true
    setSavingId(product.id)
    try {
      await task()
    } catch (error) {
      notify(getErrorMessage(error, t('failed') || 'Failed to save image'), 'error')
    } finally {
      savingRef.current = false
      setSavingId(null)
      const next = queuedSavesRef.current.shift()
      if (next) void saveRow(next.product, next.task)
    }
  }

  async function uploadProductPhoto(product: ImageOnlyProduct, file: File): Promise<string> {
    const uploadModule = await loadUploadModule()
    const uploaded = await uploadModule.uploadProductImage({
      file,
      fileName: file.name || 'product.jpg',
      productId: product.id,
      productName: product.name,
    }) as { public_path?: string; path?: string; asset?: { public_path?: string } } | undefined
    const path = uploaded?.public_path || uploaded?.path || uploaded?.asset?.public_path || ''
    if (!path) throw new Error(t('image_upload_failed') || 'Image upload failed')
    return path
  }

  // Replaces (or clears) a row's photo. The previous object URL is released here, in the one place every swap goes
  // through, so a replaced, discarded, uploaded or unmounted photo cannot leak its blob.
  function setRowPhoto(productId: number, next: RowPhoto | null) {
    const current = rowPhotosRef.current[productId]
    if (current?.url && current.url !== next?.url) URL.revokeObjectURL(current.url)
    const map = { ...rowPhotosRef.current }
    if (next) map[productId] = next
    else delete map[productId]
    rowPhotosRef.current = map
    if (aliveRef.current) setRowPhotos(map)
  }

  // Uploads the row's photo and links it to the product. It handles its own failure (the row shows an inline
  // alert with Retry), so saveRow's generic error toast never doubles it.
  async function uploadRowPhoto(product: ImageOnlyProduct, token: number) {
    const photo = rowPhotosRef.current[product.id]
    if (!photo || photo.token !== token) return
    try {
      let { path } = photo
      if (!path) {
        path = await uploadProductPhoto(product, photo.file)
        const live = rowPhotosRef.current[product.id]
        if (live?.token === token) rowPhotosRef.current = { ...rowPhotosRef.current, [product.id]: { ...live, path } }
      }
      await saveImagePath(product, path)
      if (rowPhotosRef.current[product.id]?.token === token) setRowPhoto(product.id, null)
    } catch (error) {
      const live = rowPhotosRef.current[product.id]
      if (live?.token === token) setRowPhoto(product.id, { ...live, status: 'failed', error: getErrorMessage(error, t('image_upload_failed') || 'Image upload failed') })
    }
  }

  function stageRowPhoto(product: ImageOnlyProduct, file: File) {
    const token = rowPhotoTokenRef.current + 1
    rowPhotoTokenRef.current = token
    setRowPhoto(product.id, { token, file, url: previewUrlFor(file), status: 'uploading', error: '', path: '' })
    void saveRow(product, () => uploadRowPhoto(product, token))
  }

  function retryRowPhoto(product: ImageOnlyProduct) {
    const photo = rowPhotosRef.current[product.id]
    if (!photo || photo.status !== 'failed') return
    setRowPhoto(product.id, { ...photo, status: 'uploading', error: '' })
    void saveRow(product, () => uploadRowPhoto(product, photo.token))
  }

  async function handlePickAndSave(product: ImageOnlyProduct, options: { capture?: 'environment' } = {}) {
    if (savingRef.current) return
    const [file] = await pickFiles({ ...options, onLateChange: ([late]) => stageRowPhoto(product, late) })
    if (file) stageRowPhoto(product, file)
  }

  async function handleLibrarySelect(product: ImageOnlyProduct, publicPath: string) {
    setLibraryPickerProductId(null)
    if (savingRef.current || !publicPath) return
    await saveRow(product, () => saveImagePath(product, publicPath))
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <ProductsImageOnlyControls
        showBatches={showBatches}
        showStock={showStock}
        showCategory={showCategory}
        showBrand={showBrand}
        range={range}
        onRangeChange={setRange}
        search={search}
        onSearchChange={setSearch}
        onScan={applyScan}
        scope={scope}
        onScopeChange={(patch) => setScope((current) => ({ ...current, ...patch }))}
        categories={facets.categories}
        brands={facets.brands}
        t={t}
      />

      {loadError ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <p className="text-red-600 dark:text-red-400">{loadError}</p>
          <button type="button" className="btn-primary" onClick={load}>{t('retry') || 'Retry'}</button>
        </div>
      ) : (
        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={`skeleton-${index}`} className="card animate-pulse p-3">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            ))
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              {scanMiss ? <ScanMissNotice miss={scanMiss} t={t} /> : (t('no_data') || 'No products found')}
            </div>
          ) : items.map((product) => {
            const photo = rowPhotos[product.id]
            // A photo waiting its turn behind another row's save is just as busy as the row being saved.
            const isSaving = savingId === product.id || photo?.status === 'uploading'
            // Meta line -- only the fields this role was actually granted
            // (Part 243) ever have a value to show; anything not granted
            // is simply absent on `product` (server-enforced), so this
            // naturally renders nothing for an ungranted field rather than
            // needing its own separate empty-state.
            // Barcode is pulled OUT of this joined run onto its own line
            // below (user, Aug 29: "show barcode outside") -- an identifier a
            // grey "code · category · brand" blur made hard to read/scan.
            const metaParts: string[] = []
            if (showCategory && product.category) metaParts.push(String(product.category))
            if (showBrand && product.brand) metaParts.push(String(product.brand))
            // Stock deliberately does NOT join metaParts any more: a bare
            // number in a grey run of text says nothing about whether the
            // number is a problem. It renders as its own coloured pill below.
            const { qty: stockQty, tone: stockTone } = stockReading(product.stock_quantity, lowStockConfig, product)
            return (
              // UI polish (this session): a saving row now gets a visible
              // ring + its thumbnail dims under a centered spinner, instead
              // of only a small text line below the name -- makes which
              // row is mid-upload obvious at a glance in a long scrollable
              // list, same "ring on the row that's active" affordance
              // ManageBatchesModal.tsx and other card lists in this app
              // already use elsewhere. Buttons keep their own disabled
              // state (already correct) but now visibly dim too, instead
              // of just losing pointer events with no visual change.
              <div
                key={product.id}
                className={`card flex flex-wrap items-center gap-3 p-3 transition-shadow ${
                  isSaving ? 'ring-2 ring-blue-400/60 dark:ring-blue-500/50' : 'hover:shadow-md'
                }`}
              >
                <div className="relative h-14 w-14 shrink-0">
                  {photo?.url ? (
                    // The photo just chosen, from its local copy, so the row answers the tap before the upload finishes.
                    <img
                      src={photo.url}
                      alt={product.name}
                      className={`h-14 w-14 rounded-xl object-cover ${photo.status === 'failed' ? 'ring-2 ring-red-400 dark:ring-red-500' : ''}`}
                      onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
                    />
                  ) : product.image_path ? (
                    <ProductImg src={product.image_path} alt={product.name} className="h-14 w-14 rounded-xl object-cover" />
                  ) : (
                    <ProductImagePlaceholder className="h-14 w-14 rounded-xl" />
                  )}
                  {isSaving ? (
                    <div
                      role="status"
                      aria-label={t('uploading') || 'Uploading...'}
                      className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40"
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setDetailsProduct(product)}
                  title={t('view_details') || 'Click to view details'}
                >
                  {/* Product names wrap into two lines; the shared rail keeps the remaining text reachable. */}
                  <p className="min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100"><ProductNameRail name={String((product.name) ?? '')} /></p>
                  {showPrice ? (
                    // Named, not a bare figure. A number on its own next to a
                    // product could as easily be cost or a promotional price;
                    // this role has no other pricing on screen to infer from.
                    <p className="detail-scroll-text text-xs text-gray-500 dark:text-gray-400">
                      <span className="text-gray-400 dark:text-gray-500">{t('selling_price') || 'Selling price'}: </span>
                      {fmtUSD(product.selling_price_usd)}
                      {Number(product.selling_price_khr || 0) > 0 ? ` · ${fmtKHR(product.selling_price_khr)}` : ''}
                    </p>
                  ) : null}
                  {/* The VIP price row is deleted (2026-09-04 ruling). The card
                      list deliberately gains no wholesale row in its place --
                      wholesale stays detail-panel-only so the card stays
                      compact, which is the pre-existing showWholesale rule. */}
                  {showBarcode && product.barcode ? (
                    <p className="break-all font-mono text-[11px] text-gray-600 dark:text-gray-300" title={String(product.barcode)}>
                      {product.barcode}
                    </p>
                  ) : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {(showCategory || showBrand) && metaParts.length > 0 ? (
                      <span className="detail-scroll-text text-xs text-gray-400 dark:text-gray-500">{metaParts.join(' · ')}</span>
                    ) : null}
                    {showStock ? (
                      <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${stockTone}`}>
                        {t('stock') || 'Stock'}: {stockQty ?? '—'}
                      </span>
                    ) : null}
                  </div>
                  {isSaving ? (
                    <p className="text-xs text-blue-500 dark:text-blue-400">{t('uploading') || 'Uploading...'}</p>
                  ) : null}
                </button>
                {/* Three upload paths, matching the full ProductForm editor's
                    Choose File / Take Photo / Open Files row (Part 242) --
                    this role previously only had the plain file picker.
                    Explicit disabled: styling added this session (this
                    class was previously relying on the browser's own
                    default disabled look, which is barely visible against
                    btn-secondary's own background). */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 p-2 text-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => handlePickAndSave(product)}
                    disabled={isSaving}
                    title={t('choose_file') || 'Choose File'}
                    aria-label={t('choose_file') || 'Choose File'}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 p-2 text-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => handlePickAndSave(product, { capture: 'environment' })}
                    disabled={isSaving}
                    title={t('take_photo') || 'Take Photo'}
                    aria-label={t('take_photo') || 'Take Photo'}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 p-2 text-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setLibraryPickerProductId(product.id)}
                    disabled={isSaving}
                    title={t('open_files') || t('files') || 'Open Files'}
                    aria-label={t('open_files') || t('files') || 'Open Files'}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
                {photo?.status === 'failed' ? (
                  // Inline, never a native popup: the reason, the way to try the same photo again, and the way to
                  // give it up. The line wraps and grows with the text, so Khmer is not clipped.
                  <div className="flex basis-full items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 dark:border-red-900/40 dark:bg-red-950/30">
                    <p role="alert" className="min-w-0 flex-1 break-words text-xs leading-relaxed text-red-700 dark:text-red-300">{photo.error}</p>
                    {/* Icon-only 44 px targets (owner button policy); the words are the tooltip and the aria-label. */}
                    <button
                      type="button"
                      className="btn-secondary flex h-11 w-11 shrink-0 items-center justify-center p-0"
                      onClick={() => retryRowPhoto(product)}
                      title={t('retry') || 'Retry'}
                      aria-label={t('retry') || 'Retry'}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-secondary flex h-11 w-11 shrink-0 items-center justify-center p-0"
                      onClick={() => setRowPhoto(product.id, null)}
                      title={t('discard') || 'Discard'}
                      aria-label={t('discard') || 'Discard'}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex justify-center">
        <PaginationControls
          compact
          rangeAsPageSize
          page={page}
          pageSize={pageSize}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          t={t}
        />
      </div>

      {libraryPickerProductId !== null ? (
        <Suspense fallback={null}>
          <FilePickerModal
            open
            mediaType="image"
            title={t('choose_product_image') || 'Choose product image'}
            onClose={() => setLibraryPickerProductId(null)}
            onSelect={(publicPath: string) => {
              const product = items.find((row) => row.id === libraryPickerProductId)
              if (product) void handleLibrarySelect(product, publicPath)
              else setLibraryPickerProductId(null)
            }}
          />
        </Suspense>
      ) : null}

      {detailsProduct ? (
        <Modal title={detailsProduct.name} onClose={() => setDetailsProduct(null)} size="sm" keyboard unsavedChanges="read-only">
          <div className="flex flex-col gap-4">
            <div className="flex justify-center">
              {detailsProduct.image_path ? (
                <ProductImg src={detailsProduct.image_path} alt={detailsProduct.name} className="h-40 w-40 rounded-xl object-cover" />
              ) : (
                <ProductImagePlaceholder className="h-40 w-40 rounded-xl" />
              )}
            </div>
            {/* Only ever shows a row for a field this role was actually
                granted (same showX flags the list row already gates on) --
                a field the server never sent stays absent here too, same
                "no separate empty state needed" reasoning as metaParts
                above. */}
            <dl className="divide-y divide-gray-100 text-sm dark:divide-slate-700">
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-gray-500 dark:text-gray-400">{t('name') || 'Name'}</dt>
                <dd className="text-right font-medium text-gray-800 dark:text-gray-100">{detailsProduct.name}</dd>
              </div>
              {showPrice ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('selling_price') || 'Selling price'}</dt>
                  <dd className="text-right text-gray-800 dark:text-gray-100">
                    {fmtUSD(detailsProduct.selling_price_usd)}
                    {Number(detailsProduct.selling_price_khr || 0) > 0 ? ` · ${fmtKHR(detailsProduct.selling_price_khr)}` : ''}
                  </dd>
                </div>
              ) : null}
              {/* The VIP row that stood here is deleted (2026-09-04 ruling):
                  wholesale, immediately below, is now the only discounted tier
                  and already carries the values the VIP row used to show. */}
              {showWholesale &&(Number(detailsProduct.wholesale_price_usd || 0) > 0 || Number(detailsProduct.wholesale_price_khr || 0) > 0) ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('wholesale_price') || 'Wholesale price'}</dt>
                  <dd className="text-right text-indigo-700 dark:text-indigo-300">
                    {fmtUSD(detailsProduct.wholesale_price_usd)}
                    {Number(detailsProduct.wholesale_price_khr || 0) > 0 ? ` · ${fmtKHR(detailsProduct.wholesale_price_khr)}` : ''}
                  </dd>
                </div>
              ) : null}
              {showBarcode && detailsProduct.barcode ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('barcode') || 'Barcode'}</dt>
                  <dd className="text-right text-gray-800 dark:text-gray-100">{detailsProduct.barcode}</dd>
                </div>
              ) : null}
              {showCategory && detailsProduct.category ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('category') || 'Category'}</dt>
                  <dd className="text-right text-gray-800 dark:text-gray-100">{detailsProduct.category}</dd>
                </div>
              ) : null}
              {showBrand && detailsProduct.brand ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('brand') || 'Brand'}</dt>
                  <dd className="text-right text-gray-800 dark:text-gray-100">{detailsProduct.brand}</dd>
                </div>
              ) : null}
              {showStock ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('stock') || 'Stock'}</dt>
                  <dd className="text-right">
                    {(() => {
                      const { qty, tone } = stockReading(detailsProduct.stock_quantity, lowStockConfig, detailsProduct)
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>{qty ?? '—'}</span>
                      )
                    })()}
                  </dd>
                </div>
              ) : null}
              {/* K6: per-branch quantities -- present only when the grant
                  put branch_stock on the row (server allowlist). */}
              {showBranchStock && Array.isArray(detailsProduct.branch_stock) ? (
                detailsProduct.branch_stock.map((entry) => (
                  <div key={`branch-${entry.branch_id}`} className="flex justify-between gap-3 py-2">
                    <dt className="text-gray-500 dark:text-gray-400">{entry.branch_name || `${t('branch') || 'Branch'} ${entry.branch_id}`}</dt>
                    <dd className="text-right text-gray-800 dark:text-gray-100">{Number(entry.quantity || 0)}</dd>
                  </div>
                ))
              ) : null}
            </dl>
            {/* K6: the lot view -- read-only list per branch, fetched when
                the detail opened (see the loader effect). Money terms are
                stripped SERVER-side for this grant. */}
            {showBatches ? (
              <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('batches') || 'Received dates'}</div>
                {detailBatches === 'loading' ? (
                  <div className="py-2 text-xs text-gray-400">{t('loading') || 'Loading...'}</div>
                ) : detailBatches === 'error' ? (
                  <div className="py-2 text-xs text-amber-600 dark:text-amber-300">{t('batches_load_failed') || 'Could not load received dates.'}</div>
                ) : !Array.isArray(detailBatches) || detailBatches.length === 0 ? (
                  <div className="py-2 text-xs text-gray-400">{t('no_batches_yet') || 'No received dates recorded.'}</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-slate-700">
                    {detailBatches.map((batch) => (
                      <div key={`${batch.branchName}-${batch.id}`} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                        <span className="min-w-0 detail-scroll-text text-gray-700 dark:text-gray-200">
                          {/* Z1a: a lot reads as its received DATE. Rendering
                              `batch.lotCode` verbatim printed the raw MMDDYYYY
                              code ("08242026") next to real dd/mm/yyyy dates --
                              exactly what batchDisplayLabel exists to prevent. */}
                          {batchDisplayLabel({ id: batch.id, lot_code: batch.lotCode, received_at: batch.receivedAt, batch_number: batch.batchNumber }, t('batch') || 'Received date')}
                          {batch.expiryDate ? <span className="ml-1 text-gray-400">exp {fmtDateOnly(batch.expiryDate)}</span> : null}
                        </span>
                        <span className="flex-shrink-0 text-gray-500 dark:text-gray-400">{batch.branchName}: {Number(batch.quantity || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" className="btn-secondary text-sm" onClick={() => setDetailsProduct(null)}>
                {t('close') || 'Close'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
