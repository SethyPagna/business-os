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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import { useApp } from '../../AppContext'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import FilterMenu from '../shared/FilterMenu'
import PaginationControls, { PAGE_SIZE_OPTIONS } from '../shared/PaginationControls'
import Modal from '../shared/Modal'
import { ProductImg, ProductImagePlaceholder } from './shared/primitives'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { fmtDateOnly } from '../../utils/formatters'

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
  special_price_usd?: number | string | null
  special_price_khr?: number | string | null
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeRows(payload: unknown): { items: ImageOnlyProduct[]; total: number } {
  if (Array.isArray(payload)) return { items: payload as ImageOnlyProduct[], total: payload.length }
  const record = (payload && typeof payload === 'object' ? payload : {}) as { items?: unknown; total?: unknown }
  const items = Array.isArray(record.items) ? (record.items as ImageOnlyProduct[]) : []
  const total = Number(record.total ?? items.length) || items.length
  return { items, total }
}

// Single hidden <input type=file>, reused across rows (one at a time) --
// avoids mounting 50+ file inputs on a page whose whole point is a long
// scrollable list. `capture: 'environment'` (Part 242) opens the device
// camera directly instead of the general gallery/file chooser, mirroring
// ProductForm.tsx's own addPhoto()/pickImageFiles(options) split.
function pickImageFile(options: { capture?: 'environment' } = {}): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (options.capture) input.setAttribute('capture', options.capture)
    input.style.position = 'fixed'
    input.style.top = '-1000px'
    input.style.opacity = '0'
    let settled = false
    const settle = (file: File | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus, true)
      input.remove()
      resolve(file)
    }
    const onFocus = () => {
      // Mirrors ProductForm.tsx's own pickImageFiles: if the picker closed
      // (window refocused) without a change event firing shortly after,
      // treat it as a cancel rather than hanging forever.
      window.setTimeout(() => { if (!input.files?.length) settle(null) }, 400)
    }
    input.addEventListener('change', () => settle(input.files?.[0] || null))
    window.addEventListener('focus', onFocus, true)
    document.body.appendChild(input)
    input.click()
  })
}

export default function ProductsImageOnlyView() {
  const { t, notify, hasPermission, fmtUSD, fmtKHR } = useImageOnlyApp()
  // Which optional fields this specific role has been granted (Part 243) --
  // the server already only sends the fields it's granted (see
  // productWrites.ts's computeImageOnlyVisibleFields), so these flags just
  // decide whether this view bothers rendering a row/column for a field
  // that, for a role without the grant, will simply never be present on
  // `product` anyway. Kept as plain booleans (not memoized) since
  // hasPermission() itself is already a cheap map lookup.
  const showPrice = hasPermission('products_image_only_show_price')
  const showVip = hasPermission('products_image_only_show_vip')
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Which row's image save is in flight, if any -- used to disable that
  // row's upload actions so a second tap can't fire a second upload+save
  // before the first one lands (same class of bug as the full editor's
  // Save-button-during-upload race, see ProductForm.tsx's saveForm guard).
  const [savingId, setSavingId] = useState<number | null>(null)
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
  type DetailBatchRow = { id: number; lotCode: string | null; expiryDate: string | null; batchNumber: number | null; quantity: number; branchName: string }
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
        expiryDate: batch.expiry_date,
        batchNumber: batch.batch_number,
        quantity: Number(batch.quantity || 0),
        branchName: branch.branch_name || String(branch.branch_id),
      }))
    }))
      .then((lists) => { if (alive) setDetailBatches(lists.flat()) })
      .catch(() => { if (alive) setDetailBatches('error') })
    return () => { alive = false }
  }, [detailsProduct, showBatches])
  // Filter dimensions are offered ONLY where this role may already see the
  // value on the row itself. Offering a category filter to someone without
  // category visibility would hand them the whole taxonomy through the
  // filter list -- precisely the data the permission withholds.
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [filterOptions, setFilterOptions] = useState<{ categories: string[]; brands: string[] }>({ categories: [], brands: [] })
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!showCategory && !showBrand) return
    let cancelled = false
    void (async () => {
      try {
        const module = await import('../../api/productReadTransport.ts')
        const raw = await module.getProductFilters({}) as { categories?: unknown; brands?: unknown }
        if (cancelled) return
        const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [])
        setFilterOptions({ categories: list(raw?.categories), brands: list(raw?.brands) })
      } catch {
        // A missing filter list is not worth an error banner on a page whose
        // job is uploading photos -- the menu simply does not appear.
      }
    })()
    return () => { cancelled = true }
  }, [showCategory, showBrand])

  const activeFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (brandFilter !== 'all' ? 1 : 0)
  const clearFilters = useCallback(() => {
    setCategoryFilter('all')
    setBrandFilter('all')
    setPage(1)
  }, [])

  const filterSections = useMemo(() => {
    const sections = []
    if (showCategory && filterOptions.categories.length) {
      sections.push({
        id: 'category',
        label: t('category') || 'Category',
        options: [
          { id: 'all', label: t('all') || 'All', active: categoryFilter === 'all', onClick: () => { setCategoryFilter('all'); setPage(1) } },
          ...filterOptions.categories.map((value) => ({
            id: value,
            label: value,
            active: categoryFilter === value,
            onClick: () => { setCategoryFilter(value); setPage(1) },
          })),
        ],
      })
    }
    if (showBrand && filterOptions.brands.length) {
      sections.push({
        id: 'brand',
        label: t('brand') || 'Brand',
        options: [
          { id: 'all', label: t('all') || 'All', active: brandFilter === 'all', onClick: () => { setBrandFilter('all'); setPage(1) } },
          ...filterOptions.brands.map((value) => ({
            id: value,
            label: value,
            active: brandFilter === value,
            onClick: () => { setBrandFilter(value); setPage(1) },
          })),
        ],
      })
    }
    return sections
  }, [showCategory, showBrand, filterOptions, categoryFilter, brandFilter, t])

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const module = await loadReadModule()
      const payload = await module.searchProducts({
        q: search,
        page,
        pageSize,
        category: categoryFilter === 'all' ? '' : categoryFilter,
        brand: brandFilter === 'all' ? '' : brandFilter,
      })
      if (requestIdRef.current !== requestId) return
      const { items: rows, total: rowTotal } = normalizeRows(payload)
      setItems(rows)
      setTotal(rowTotal)
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setLoadError(getErrorMessage(error, t('load_failed') || 'Failed to load products'))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [search, page, pageSize, t])

  useEffect(() => { load() }, [load])

  // Reset to page 1 whenever the search text changes, same as the full
  // editor -- otherwise a narrowed search could land on a page past the
  // end of its own (smaller) result set.
  useEffect(() => { setPage(1) }, [search])

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

  async function handlePickAndSave(product: ImageOnlyProduct, options: { capture?: 'environment' } = {}) {
    if (savingId !== null) return
    const file = await pickImageFile(options)
    if (!file) return
    setSavingId(product.id)
    try {
      const uploadModule = await loadUploadModule()
      const uploaded = await uploadModule.uploadProductImage({
        file,
        fileName: file.name || 'product.jpg',
        productId: product.id,
        productName: product.name,
      }) as { public_path?: string; path?: string; asset?: { public_path?: string } } | undefined
      const path = uploaded?.public_path || uploaded?.path || uploaded?.asset?.public_path || ''
      if (!path) throw new Error('Image upload failed')
      await saveImagePath(product, path)
    } catch (error) {
      notify(getErrorMessage(error, t('failed') || 'Failed to save image'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleLibrarySelect(product: ImageOnlyProduct, publicPath: string) {
    setLibraryPickerProductId(null)
    if (savingId !== null || !publicPath) return
    setSavingId(product.id)
    try {
      await saveImagePath(product, publicPath)
    } catch (error) {
      notify(getErrorMessage(error, t('failed') || 'Failed to save image'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('products') || 'Products'}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('products_image_only_hint') || 'You can update product photos here. Other fields are managed elsewhere.'}
        </p>
      </div>

      <div className="mb-3 flex items-center gap-1.5 sm:gap-2">
        <SearchInput
          id="products-image-only-search"
          value={search}
          onChange={setSearch}
          placeholder={t('search') || 'Search'}
        />
        {/* Labelled, not icon-only. In a row of small square controls a bare
            camera icon is easy to miss, and a scanner nobody finds is the
            same as not having one -- this is the button people reach for
            mid-scan. */}
        <ScanSearchButton onDetected={setSearch} t={t} showLabel />
        {/* Only offered for the dimensions this role may actually see. A
            category filter for someone not granted category visibility would
            hand them the whole taxonomy through the filter list -- the exact
            data the permission withholds on the row itself.

            `compact`, and deliberately NOT mobileIconOnly: the label stays on
            phones too, because an unlabelled icon is the thing people miss.
            Compactness is bought with padding and type size instead, so the
            search box keeps the room it needs. */}
        {filterSections.length ? (
          <FilterMenu
            label={t('filter') || 'Filter'}
            activeCount={activeFilterCount}
            sections={filterSections}
            onClear={activeFilterCount ? clearFilters : null}
            compact
          />
        ) : null}
      </div>

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
            <div className="py-10 text-center text-gray-400">{t('no_data') || 'No products found'}</div>
          ) : items.map((product) => {
            const isSaving = savingId === product.id
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
            const stockQty = Number(product.stock_quantity || 0)
            const stockTone = stockQty <= Number(product.out_of_stock_threshold ?? 0)
              ? 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/60'
              : stockQty <= Number(product.low_stock_threshold ?? 10)
                ? 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60'
                : 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/60'
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
                className={`card flex items-center gap-3 p-3 transition-shadow ${
                  isSaving ? 'ring-2 ring-blue-400/60 dark:ring-blue-500/50' : 'hover:shadow-md'
                }`}
              >
                <div className="relative h-14 w-14 shrink-0">
                  {product.image_path ? (
                    <ProductImg src={product.image_path} alt={product.name} className="h-14 w-14 rounded-xl object-cover" />
                  ) : (
                    <ProductImagePlaceholder className="h-14 w-14 rounded-xl" />
                  )}
                  {isSaving ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
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
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{product.name}</p>
                  {showPrice ? (
                    // Named, not a bare figure. A number on its own next to a
                    // product could as easily be cost or a promotional price;
                    // this role has no other pricing on screen to infer from.
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      <span className="text-gray-400 dark:text-gray-500">{t('selling_price') || 'Selling price'}: </span>
                      {fmtUSD(product.selling_price_usd)}
                      {Number(product.selling_price_khr || 0) > 0 ? ` · ${fmtKHR(product.selling_price_khr)}` : ''}
                    </p>
                  ) : null}
                  {showVip && (Number(product.special_price_usd || 0) > 0 || Number(product.special_price_khr || 0) > 0) ? (
                    <p className="truncate text-xs text-emerald-600 dark:text-emerald-400">
                      <span className="text-gray-400 dark:text-gray-500">{t('special_price') || 'VIP price'}: </span>
                      {fmtUSD(product.special_price_usd)}
                      {Number(product.special_price_khr || 0) > 0 ? ` · ${fmtKHR(product.special_price_khr)}` : ''}
                    </p>
                  ) : null}
                  {showBarcode && product.barcode ? (
                    <p className="truncate font-mono text-[11px] text-gray-600 dark:text-gray-300" title={String(product.barcode)}>
                      {product.barcode}
                    </p>
                  ) : null}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {(showCategory || showBrand) && metaParts.length > 0 ? (
                      <span className="truncate text-xs text-gray-400 dark:text-gray-500">{metaParts.join(' · ')}</span>
                    ) : null}
                    {showStock ? (
                      <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${stockTone}`}>
                        {t('stock') || 'Stock'}: {stockQty}
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
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3">
        <PaginationControls
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
        <Modal title={detailsProduct.name} onClose={() => setDetailsProduct(null)} size="sm">
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
              {showVip && (Number(detailsProduct.special_price_usd || 0) > 0 || Number(detailsProduct.special_price_khr || 0) > 0) ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-gray-500 dark:text-gray-400">{t('special_price') || 'VIP price'}</dt>
                  <dd className="text-right text-emerald-700 dark:text-emerald-300">
                    {fmtUSD(detailsProduct.special_price_usd)}
                    {Number(detailsProduct.special_price_khr || 0) > 0 ? ` · ${fmtKHR(detailsProduct.special_price_khr)}` : ''}
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
                      const qty = Number(detailsProduct.stock_quantity || 0)
                      const tone = qty <= Number(detailsProduct.out_of_stock_threshold ?? 0)
                        ? 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900/60'
                        : qty <= Number(detailsProduct.low_stock_threshold ?? 10)
                          ? 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60'
                          : 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/60'
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>{qty}</span>
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
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('batches') || 'Batches'}</div>
                {detailBatches === 'loading' ? (
                  <div className="py-2 text-xs text-gray-400">{t('loading') || 'Loading...'}</div>
                ) : detailBatches === 'error' ? (
                  <div className="py-2 text-xs text-amber-600 dark:text-amber-300">{t('batches_load_failed') || 'Could not load batches.'}</div>
                ) : !Array.isArray(detailBatches) || detailBatches.length === 0 ? (
                  <div className="py-2 text-xs text-gray-400">{t('no_batches_yet') || 'No batches recorded.'}</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-slate-700">
                    {detailBatches.map((batch) => (
                      <div key={`${batch.branchName}-${batch.id}`} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                        <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                          {batch.lotCode || `#${batch.batchNumber ?? batch.id}`}
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
