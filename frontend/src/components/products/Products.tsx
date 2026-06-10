// Products
// Main Products page; all sub-modals are imported from sibling files.

import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import PackageSearch from 'lucide-react/dist/esm/icons/package-search.js'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import Modal from '../shared/Modal'
import FilterMenu from '../shared/FilterMenu'
import AppSelect from '../shared/AppSelect'
import { PAGE_SIZE_OPTIONS } from '../shared/PaginationControls'
import { ProductImg, ProductImagePlaceholder } from './shared/primitives'
import ProductsListSurface from './surfaces/ProductsListSurface'
import ProductsHeaderActions from './surfaces/HeaderActions'
import {
  ProductBatchPreview,
  ProductDetailsCell,
  ProductDiscountBadge,
  ProductRowActions,
} from './surfaces/ProductRowParts'
import { useIsPageActive } from '../shared/pageActivity'
import { buildProductGroupSections } from '../../utils/productGrouping.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId, resolveCreatedHistorySnapshot } from '../../utils/historyHelpers.ts'
import { createProductHistoryRequestId, orderProductRestoreSnapshots } from './history/productHistoryHelpers.ts'
import { getAvailableYears, toggleIdSet } from '../../utils/recordFilters.ts'
import { aggregateInitialOptions, compareInitialKeys } from '../../utils/initials.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { isApiVersionMismatchError } from '../../api/http.ts'
import { getKhmerTextProps, withKhmerTextClass } from '../../utils/scriptTypography.ts'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { getContrastingTextColor } from '../../utils/color.ts'
import {
  CREATED_MONTH_OPTIONS,
  DEFAULT_META_PILL_COLOR,
  PRODUCTS_AUX_OPTIONS_TIMEOUT_MS,
  PRODUCTS_FILTER_META_TIMEOUT_MS,
  PRODUCTS_BY_ID_TIMEOUT_MS,
  PRODUCT_WRITE_MUTATION_TIMEOUT_MS,
  PRODUCT_DELETE_MUTATION_TIMEOUT_MS,
  PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS,
  PRODUCT_STOCK_MUTATION_TIMEOUT_MS,
} from './config/productPageConfig.ts'
import {
  normalizeBrandLookup,
  parseBrandColorMap,
  useDebouncedValue,
} from './helpers/productPageHelpers.ts'
import {
  buildProductLightboxGalleryInput,
  buildProductLightboxState,
  buildProductThumbnailState,
  normalizeProductGallery,
  updateProductLightboxIndex,
} from './helpers/productGalleryHelpers.ts'
import {
  buildProductSearchTerms,
  filterProductsForPage,
  getProductBranchQuantity,
} from './helpers/productFilterHelpers.ts'
import {
  buildJumpTargetIdsByLetter,
  buildParentProductIdSet,
  buildProductIdMap,
  buildProductPaginationState,
  buildSelectedProducts,
  buildSelectedVisibleIds,
  buildVisibleProductIds,
  isSelectionScopeFullySelected as isSelectionScopeFullySelectedHelper,
  isSelectionScopePartiallySelected as isSelectionScopePartiallySelectedHelper,
  normalizePositiveProductIds,
} from './helpers/productSelectionHelpers.ts'
import {
  buildProductGroupPriceLabel,
  buildProductGroupSummaryParts,
} from './helpers/productGroupViewHelpers.ts'
import {
  buildBranchNameByIdMap,
  buildNameLookupMap,
  buildProductRowDisplayState,
  buildProductBranchSummaryLabel,
  buildProductBrandOptions,
  getProductStockStatus,
} from './helpers/productDisplayHelpers.ts'
import {
  buildProductExportItems,
  buildProductFilterSections,
  countActiveProductFilters,
} from './helpers/productMenuHelpers.ts'
import { buildProductSupplierOptions } from './helpers/productSupplierOptions.ts'

const ManageCategoriesModal = lazy(() => import('./lookups/ManageCategoriesModal'))
const ManageBrandsModal = lazy(() => import('./lookups/ManageBrandsModal'))
const ManageUnitsModal = lazy(() => import('./lookups/ManageUnitsModal'))
const BulkImportModal = lazy(() => import('./import/BulkImportModal'))
const BulkAddStockModal = lazy(() => import('./forms/BulkAddStockModal'))
const VariantFormModal = lazy(() => import('./forms/VariantFormModal'))
const ProductForm = lazy(() => import('./forms/ProductForm'))
const ProductDetailModal = lazy(() => import('./surfaces/ProductDetailModal'))
const ImageGalleryLightbox = lazy(() => import('../shared/ImageGalleryLightbox'))
const ActionHistoryBar = lazy(() => import('../shared/ActionHistoryBar'))

type EntityId = string | number
type Loader<T = unknown> = () => Promise<T>
type ProductWriteHelpers = typeof import('./helpers/productWriteHelpers.ts')
type NotificationTone = 'error' | 'info' | 'success' | 'warning' | string
type SearchMode = 'AND' | 'OR'
type ProductSortDirection = 'asc' | 'desc'
type BulkEditMode = 'branch' | 'info' | 'pricing' | 'stock' | null
type ProductModalMode = 'brands' | 'bulk' | 'cats' | 'form' | 'units' | null
type ProductFormTab = 'basic' | 'pricing' | 'stock'

interface BranchStockRow {
  branch_id?: EntityId | null
  branch_name?: string
  quantity?: number | string | null
  [key: string]: unknown
}

interface ProductRecord {
  id?: EntityId
  name?: string
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  unit?: string
  supplier?: string
  description?: string
  parent_id?: EntityId | null
  image_path?: string | null
  image_gallery?: unknown[]
  branch_stock?: BranchStockRow[]
  stock_quantity?: number | string | null
  created_at?: string
  updated_at?: string
  purchase_price_usd?: number | string | null
  purchase_price_khr?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  special_price_usd?: number | string | null
  special_price_khr?: number | string | null
  low_stock_threshold?: number | string | null
  out_of_stock_threshold?: number | string | null
  is_active?: boolean | number | null
  is_group?: boolean | number | null
  [key: string]: unknown
}

interface LookupRecord {
  id?: EntityId
  name?: string
  color?: string
  [key: string]: unknown
}

interface BranchRecord extends LookupRecord {
  is_default?: boolean | number | null
}

type ProductFilterInitial = {
  count: number
  key: string
  label: string
  type?: string
}

type InitialOptionInput = {
  count?: unknown
  key?: unknown
  label?: unknown
  value?: unknown
}

type ProductFilterMeta = {
  brands: string[]
  categories: string[]
  suppliers: string[]
  initials: ProductFilterInitial[]
}

type BulkEditForm = Record<string, string | number | undefined> & {
  action?: string
  branchId?: EntityId | ''
  brand?: string
  category?: string
  low_stock_threshold?: string | number
  purchase_price_khr?: string | number
  purchase_price_usd?: string | number
  qty?: string | number
  selling_price_khr?: string | number
  selling_price_usd?: string | number
  special_price_khr?: string | number
  special_price_usd?: string | number
  supplier?: string
  unit?: string
}

type BulkAddModalState = {
  ids: number[]
  snapshots: ProductRecord[]
} | null

type RestoredProductEntry = {
  restoredId?: EntityId
  snapshot?: ProductRecord
}

type BulkAddStockResult = {
  branchId?: EntityId
  done?: number
  failed?: number
  failedIds?: EntityId[]
  quantity?: number | string
  updatedIds?: EntityId[]
}

type ProductLightboxState = {
  images: string[]
  index: number
  title: string
} | null

type VariantParentRecord = ProductRecord & {
  id: EntityId
  name: string
}

type ProductApiResponse = Record<string, unknown> & {
  data?: ProductRecord | null
  error?: string
  id?: EntityId
  item?: ProductRecord | null
  message?: string
  path?: string
  success?: boolean
}

type ProductSearchResponse = {
  filters?: Partial<ProductFilterMeta>
  initials?: unknown[]
  items?: ProductRecord[]
  total?: number
}

type ProductReadModule = typeof import('../../api/productReadTransport.ts')
type ProductWriteModule = typeof import('../../api/productWriteTransport.ts')
type LookupModule = typeof import('../../api/lookupTransport.ts')
type BranchModule = typeof import('../../api/branchTransport.ts')
type InventoryWriteModule = typeof import('../../api/inventoryWriteTransport.ts')
type ProductImageUploadModule = typeof import('../../api/productImageUploadTransport.ts')

type ProductApi = {
  adjustStock: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  createProduct: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  deleteProduct: (id: EntityId, userId?: EntityId, userName?: string | null) => Promise<ProductApiResponse | undefined>
  getBranches: () => Promise<BranchRecord[]>
  getCategories: () => Promise<LookupRecord[]>
  getProductFilters: (query?: Record<string, unknown>) => Promise<Partial<ProductFilterMeta> | undefined>
  getProductsByIds: (ids: number[], options?: Record<string, unknown>) => Promise<ProductRecord[]>
  getUnits: () => Promise<LookupRecord[]>
  searchProducts: (query: Record<string, unknown>) => Promise<ProductSearchResponse | ProductRecord[] | undefined>
  transferStock: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  updateProduct: (id: EntityId, payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  uploadProductImage: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
}

type ProductsAppContext = {
  exchangeRate: number
  fmtKHR: (value: unknown) => string
  fmtUSD: (value: unknown) => string
  khrSymbol: string
  notify: (message: string, tone?: NotificationTone) => void
  settings: Record<string, unknown>
  t: (key: string) => string
  usdSymbol: string
  user: { id?: EntityId; name?: string } | null
}

type ProductsSyncContext = {
  syncChannel?: {
    channel?: string
    reason?: string
    source?: string
    ts?: number
  } | null
}

type ProductGroupLike = {
  anchorId?: EntityId
  hasMultipleItems: boolean
  ids: EntityId[]
  items: ProductRecord[]
  key: string
  name: string
  stockTotal?: number
}

type ProductSectionLike = {
  groups: ProductGroupLike[]
  id: string
  ids: EntityId[]
  items: ProductRecord[]
  label: string
}

const useProductsApp = useApp as () => ProductsAppContext
const useProductsSync = useSync as () => ProductsSyncContext

let productReadModulePromise: Promise<ProductReadModule> | null = null
let productWriteModulePromise: Promise<ProductWriteModule> | null = null
let lookupModulePromise: Promise<LookupModule> | null = null
let branchModulePromise: Promise<BranchModule> | null = null
let inventoryWriteModulePromise: Promise<InventoryWriteModule> | null = null
let productImageUploadModulePromise: Promise<ProductImageUploadModule> | null = null

function loadProductReadModule(): Promise<ProductReadModule> {
  if (!productReadModulePromise) productReadModulePromise = import('../../api/productReadTransport.ts')
  return productReadModulePromise
}

function loadProductWriteModule(): Promise<ProductWriteModule> {
  if (!productWriteModulePromise) productWriteModulePromise = import('../../api/productWriteTransport.ts')
  return productWriteModulePromise
}

function loadLookupModule(): Promise<LookupModule> {
  if (!lookupModulePromise) lookupModulePromise = import('../../api/lookupTransport.ts')
  return lookupModulePromise
}

function loadBranchModule(): Promise<BranchModule> {
  if (!branchModulePromise) branchModulePromise = import('../../api/branchTransport.ts')
  return branchModulePromise
}

function loadInventoryWriteModule(): Promise<InventoryWriteModule> {
  if (!inventoryWriteModulePromise) inventoryWriteModulePromise = import('../../api/inventoryWriteTransport.ts')
  return inventoryWriteModulePromise
}

function loadProductImageUploadModule(): Promise<ProductImageUploadModule> {
  if (!productImageUploadModulePromise) productImageUploadModulePromise = import('../../api/productImageUploadTransport.ts')
  return productImageUploadModulePromise
}

const productApi: ProductApi = {
  adjustStock: async (payload) => toProductApiResponse(await (await loadInventoryWriteModule()).adjustStock(payload)),
  createProduct: async (payload) => toProductApiResponse(await (await loadProductWriteModule()).createProduct(payload)),
  deleteProduct: async (id) => toProductApiResponse(await (await loadProductWriteModule()).deleteProduct(id)),
  getBranches: async () => (await (await loadBranchModule()).getBranches()) as BranchRecord[],
  getCategories: async () => (await (await loadLookupModule()).getCategories()) as LookupRecord[],
  getProductFilters: async (query = {}) => {
    const module = await loadProductReadModule()
    return (await module.getProductFilters(query as Parameters<ProductReadModule['getProductFilters']>[0])) as Partial<ProductFilterMeta>
  },
  getProductsByIds: async (ids, options = {}) => {
    const module = await loadProductReadModule()
    const result = await module.getProductsByIds(ids, options as Parameters<ProductReadModule['getProductsByIds']>[1])
    if (Array.isArray(result)) return result as ProductRecord[]
    if (isObjectRecord(result) && Array.isArray(result.items)) return result.items as ProductRecord[]
    return []
  },
  getUnits: async () => (await (await loadLookupModule()).getUnits()) as LookupRecord[],
  searchProducts: async (query) => {
    const module = await loadProductReadModule()
    return (await module.searchProducts(query as Parameters<ProductReadModule['searchProducts']>[0])) as ProductSearchResponse | ProductRecord[]
  },
  transferStock: async (payload) => toProductApiResponse(await (await loadBranchModule()).transferStock(payload)),
  updateProduct: async (id, payload) => toProductApiResponse(await (await loadProductWriteModule()).updateProduct(id, payload)),
  uploadProductImage: async (payload) => toProductApiResponse(await (await loadProductImageUploadModule()).uploadProductImage(payload)),
}

function getProductApi(): ProductApi {
  return productApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toProductApiResponse(value: unknown): ProductApiResponse {
  return isObjectRecord(value) ? value : {}
}

function scrollNodeWithOffset(node: HTMLElement | null, offset = 96): void {
  if (!node) return
  const top = node.getBoundingClientRect().top + window.scrollY - offset
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

let productWriteHelpersPromise: Promise<ProductWriteHelpers> | null = null

function loadProductWriteHelpers(): Promise<ProductWriteHelpers> {
  productWriteHelpersPromise ||= import('./helpers/productWriteHelpers.ts')
  return productWriteHelpersPromise
}

function summarizeProductRun(run: { failures?: { item?: unknown }[]; successes?: { item?: unknown }[] } = {}) {
  const updatedIds = (run.successes || [])
    .map((entry) => Number(entry?.item))
    .filter((id) => Number.isFinite(id) && id > 0)
  const failedIds = (run.failures || [])
    .map((entry) => Number(entry?.item))
    .filter((id) => Number.isFinite(id) && id > 0)
  return {
    done: updatedIds.length,
    failed: failedIds.length,
    failedIds,
    updatedIds,
  }
}

function aggregateProductInitials(rows: unknown): ProductFilterInitial[] {
  const source = Array.isArray(rows) ? rows.filter(isObjectRecord) : []
  return aggregateInitialOptions(source as InitialOptionInput[])
}

function toLookupOptions<T extends LookupRecord>(items: T[]): Array<T & { id: EntityId; name: string }> {
  return items
    .filter((item) => item?.id !== undefined && item?.id !== null && String(item?.name || '').trim())
    .map((item) => ({ ...item, id: item.id as EntityId, name: String(item.name) }))
}

function toModalProduct(product: ProductRecord | null): ProductRecord | null {
  if (!product) return null
  return {
    ...product,
    id: product.id ?? 0,
    name: String(product.name || ''),
    image_path: product.image_path || undefined,
    stock_quantity: Number(product.stock_quantity || 0),
    selling_price_usd: Number(product.selling_price_usd || 0),
  }
}

function toVariantParentProduct(product: ProductRecord | null): VariantParentRecord | null {
  const normalized = toModalProduct(product)
  if (!normalized?.id || !normalized.name) return null
  return { ...normalized, id: normalized.id, name: String(normalized.name) }
}

function toLightboxState(value: ReturnType<typeof updateProductLightboxIndex>, fallback: ProductLightboxState): ProductLightboxState {
  if (!value || !Array.isArray(value.images) || !value.images.length) return null
  return {
    images: value.images,
    index: Number(value.index || 0),
    title: String(value.title || fallback?.title || ''),
  }
}


export default function Products() {
  const { t, user, settings, notify, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useProductsApp()
  const { syncChannel } = useProductsSync()
  const productApi = getProductApi()
  const isActive = useIsPageActive('products')
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelReason = String(syncChannel?.reason || '')
  const syncChannelSource = String(syncChannel?.source || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const cleanFallback = useCallback((fallbackEn: string, fallbackKm?: string) => {
    const candidate = fallbackKm || fallbackEn
    return isBrokenLocalizedString(candidate)
      ? fallbackEn
      : candidate
  }, [])
  const tr = useCallback((key: string, fallbackEn = key, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    return isKhmer ? cleanFallback(fallbackEn, fallbackKm) : fallbackEn
  }, [cleanFallback, isKhmer, t])
  const [products,     setProducts]     = useState<ProductRecord[]>([])
  const [categories,   setCategories]   = useState<LookupRecord[]>([])
  const [units,        setUnits]        = useState<LookupRecord[]>([])
  const [branches,     setBranches]     = useState<BranchRecord[]>([])
  const [branchFilter, setBranchFilter] = useState('all')
  const [stockFilter,  setStockFilter]  = useState('all') // all | in_stock | low | out
  const [groupFilter, setGroupFilter] = useState('all') // all | group | standalone
  const [createdYearFilter, setCreatedYearFilter] = useState('all')
  const [createdMonthFilter, setCreatedMonthFilter] = useState('all')
  const [productSortDirection, setProductSortDirection] = useState<ProductSortDirection>('desc')
  const [search,       setSearch]       = useState('')
  const [searchMode,   setSearchMode]   = useState<SearchMode>('AND') // 'AND' | 'OR'
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(20)
  const [productPageDraft, setProductPageDraft] = useState('1')
  const [productTotal, setProductTotal] = useState(0)
  const [productFilterMeta, setProductFilterMeta] = useState<ProductFilterMeta>({ brands: [], categories: [], suppliers: [], initials: [] })
  const [initialFilter, setInitialFilter] = useState('all')
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set())
  const [bulkEditOpen,   setBulkEditOpen]   = useState(false)
  const [bulkEditMode,   setBulkEditMode]   = useState<BulkEditMode>(null)
  const [bulkEditForm,   setBulkEditForm]   = useState<BulkEditForm>({})
  const [catFilter,    setCatFilter]    = useState('all')
  const [brandFilter,  setBrandFilter]  = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [modal,        setModal]        = useState<ProductModalMode>(null)
  const [selected,     setSelected]     = useState<ProductRecord | null>(null)
  const [formInitialTab, setFormInitialTab] = useState<ProductFormTab>('basic')
  const [detailProduct,setDetailProduct]= useState<ProductRecord | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [refreshingProducts, setRefreshingProducts] = useState(false)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [variantModal, setVariantModal] = useState<ProductRecord | null>(null)
  const [collapsedProductSections, setCollapsedProductSections] = useState<Set<string>>(() => new Set())
  const [collapsedProductGroups, setCollapsedProductGroups] = useState<Set<string>>(() => new Set())
  const [isProductFilterMenuOpen, setIsProductFilterMenuOpen] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [filterMetaReady, setFilterMetaReady] = useState(false)
  const [auxOptionsReady, setAuxOptionsReady] = useState(false)
  const loadedOnceRef = useRef(false)
  const auxOptionsLoadedRef = useRef(false)
  const filterMetaLoadedRef = useRef(false)
  const loadRequestRef = useRef(0)
  const auxOptionsRequestRef = useRef(0)
  const filterMetaRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const pendingLoadRef = useRef<{ silent: boolean } | null>(null)
  const latestLoadRef = useRef<((silent?: boolean) => Promise<void>) | null>(null)
  const productSaveInFlightRef = useRef(false)
  const productDeleteInFlightRef = useRef(false)
  const bulkActionInFlightRef = useRef(false)
  const desktopSelectAllRef = useRef<HTMLInputElement | null>(null)
  const mobileSelectAllRef = useRef<HTMLInputElement | null>(null)
  const initializedCollapsedGroupKeysRef = useRef<Set<string>>(new Set())
  const actionHistory = useActionHistory({ limit: 10, notify, scope: 'products', enabled: historyReady, user })
  const debouncedSearch = useDebouncedValue(search, 180)
  const runProductWriteMutation = useCallback(<T,>(loader: Loader<T>, label: string, timeoutMs = PRODUCT_WRITE_MUTATION_TIMEOUT_MS): Promise<T> => (
    withLoaderTimeout(loader, label, timeoutMs)
  ), [])
  const runProductDeleteMutation = useCallback(<T,>(loader: Loader<T>, label: string): Promise<T> => (
    withLoaderTimeout(loader, label, PRODUCT_DELETE_MUTATION_TIMEOUT_MS)
  ), [])
  const runProductStockMutation = useCallback(<T,>(loader: Loader<T>, label: string): Promise<T> => (
    withLoaderTimeout(loader, label, PRODUCT_STOCK_MUTATION_TIMEOUT_MS)
  ), [])

  const load = useCallback(async (silent = false) => {
    if (loadPromiseRef.current) {
      const currentPending = pendingLoadRef.current || { silent: true }
      currentPending.silent = currentPending.silent && silent
      pendingLoadRef.current = currentPending
      return loadPromiseRef.current
    }
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
      const firstLoad = !loadedOnceRef.current
      if (!silent || firstLoad) {
        setLoadError(null)
        if (firstLoad) setLoading(true)
        else setRefreshingProducts(true)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          if (firstLoad) setLoading(false)
          setRefreshingProducts(false)
          setLoadError(tr('products_load_slow', 'Products are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 10000)
      } else {
        setRefreshingProducts(true)
      }
      try {
        const productQuery = {
          page: productPage,
          pageSize: productPageSize,
          query: debouncedSearch,
          searchMode,
          category: catFilter === 'all' ? '' : catFilter,
          brand: brandFilter === 'all' ? '' : brandFilter,
          supplier: supplierFilter === 'all' ? '' : supplierFilter,
          branchId: branchFilter === 'all' ? '' : branchFilter,
          stockState: stockFilter === 'all' && branchFilter !== 'all' ? 'positive' : (stockFilter === 'all' ? '' : stockFilter),
          groupState: groupFilter === 'all' ? '' : groupFilter,
          initial: initialFilter === 'all' ? '' : initialFilter,
          sort: productSortDirection === 'asc' ? 'created_asc' : 'created_desc',
          include: 'branch_stock,images,batches',
        }
        const result = await settleLoaderMap({
          products: () => productApi.searchProducts(productQuery),
        })
        const rawProductPayload = result.values.products
        const productPayload = Array.isArray(rawProductPayload)
          ? rawProductPayload
          : (isObjectRecord(rawProductPayload) ? rawProductPayload as ProductSearchResponse : {})
        const productPayloadObject = Array.isArray(productPayload) ? null : productPayload
        const prods = Array.isArray(productPayloadObject?.items)
          ? productPayloadObject.items
          : (Array.isArray(productPayload) ? productPayload : [])
        const searchFilters = productPayloadObject?.filters || {}
        const searchProvidedFilterMeta = isObjectRecord(productPayloadObject?.filters)
          || Array.isArray(productPayloadObject?.initials)

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const versionMismatchError = Object.values(result.errors || {}).find(isApiVersionMismatchError)
        if (versionMismatchError) {
          setLoadError(getErrorMessage(versionMismatchError, 'Product API version mismatch'))
          throw versionMismatchError
        }
        if (Array.isArray(prods)) setProducts(prods)
        setProductTotal(Number(productPayloadObject?.total ?? prods.length) || 0)
        setProductFilterMeta((previous) => {
          const hasPreviousMeta = Array.isArray(previous?.brands) && previous.brands.length
            || Array.isArray(previous?.categories) && previous.categories.length
            || Array.isArray(previous?.suppliers) && previous.suppliers.length
            || Array.isArray(previous?.initials) && previous.initials.length
          if (hasPreviousMeta) return previous
          return {
            brands: Array.isArray(searchFilters?.brands) ? searchFilters.brands : [],
            categories: Array.isArray(searchFilters?.categories) ? searchFilters.categories : [],
            suppliers: Array.isArray(searchFilters?.suppliers) ? searchFilters.suppliers : [],
            initials: aggregateProductInitials(searchFilters?.initials || productPayloadObject?.initials || []),
          }
        })
        if (searchProvidedFilterMeta) {
          filterMetaLoadedRef.current = true
          setFilterMetaReady(false)
          invalidateTrackedRequest(filterMetaRequestRef)
        }

        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, tr('products_load_failed', 'Failed to load products')))
        }
        loadedOnceRef.current = true
        setLoadError(null)

        if (result.hasErrors && !silent) {
          notify(t('products_partial_load') || 'Some product data is still catching up. The page will keep refreshing as data arrives.', 'warning')
        }
      } catch (e) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const nextMessage = getErrorMessage(e, tr('products_load_failed', 'Failed to load products'))
        if (!loadedOnceRef.current) {
          setLoadError(nextMessage)
          notify(nextMessage, 'error')
        } else if (!silent) {
          notify(tr('products_refresh_failed', 'Unable to refresh products right now. Showing the latest loaded data.'), 'warning')
        }
      } finally {
        if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setLoading(false)
        setRefreshingProducts(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
      const pending = pendingLoadRef.current
      if (pending) {
        pendingLoadRef.current = null
        queueMicrotask(() => {
          const nextLoad = latestLoadRef.current || load
          nextLoad(Boolean(pending.silent)).catch(() => {})
        })
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [branchFilter, brandFilter, catFilter, debouncedSearch, groupFilter, initialFilter, notify, productPage, productPageSize, productSortDirection, searchMode, stockFilter, supplierFilter, t, tr])

  useEffect(() => {
    latestLoadRef.current = load
  }, [load])

  const fetchProductsByIds = useCallback(async (ids: EntityId[] = []): Promise<ProductRecord[]> => {
    const uniqueIds = Array.from(new Set(
      (ids || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    )).slice(0, 100)
    if (!uniqueIds.length) return []
    const payload = await withLoaderTimeout(
      () => productApi.getProductsByIds(uniqueIds, { include: 'branch_stock,images,batches' }),
      'Products by id',
      PRODUCTS_BY_ID_TIMEOUT_MS,
    )
    return Array.isArray(payload) ? payload : []
  }, [])

  const loadAuxOptions = useCallback(async (label = 'Product auxiliary options') => {
    if (auxOptionsLoadedRef.current) return
    const requestId = beginTrackedRequest(auxOptionsRequestRef)
    const auxResult = await settleLoaderMap({
      categories: () => withLoaderTimeout(() => productApi.getCategories(), 'Product categories', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS),
      units: () => withLoaderTimeout(() => productApi.getUnits(), 'Product units', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS),
      branches: () => withLoaderTimeout(() => productApi.getBranches(), 'Product branches', PRODUCTS_AUX_OPTIONS_TIMEOUT_MS),
    })
    if (!isTrackedRequestCurrent(auxOptionsRequestRef, requestId)) return
    const cats = auxResult.values.categories
    const unitList = auxResult.values.units
    const brs = auxResult.values.branches
    if (Array.isArray(cats)) setCategories(cats)
    if (Array.isArray(unitList)) setUnits(unitList)
    if (Array.isArray(brs)) setBranches((brs || []).filter((branch) => branch.is_active))
    if (Array.isArray(cats) || Array.isArray(unitList) || Array.isArray(brs)) {
      auxOptionsLoadedRef.current = true
    }
    if (auxResult.hasErrors) {
      console.warn(`[Products] ${label} partially failed:`, getFirstLoaderError(auxResult.errors, 'option load failed'))
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      setFilterMetaReady(false)
      setAuxOptionsReady(false)
      if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      invalidateTrackedRequest(auxOptionsRequestRef)
      invalidateTrackedRequest(filterMetaRequestRef)
      loadPromiseRef.current = null
      pendingLoadRef.current = null
      setLoading(false)
      return
    }
    const silent = loadedOnceRef.current
    load(silent)
  }, [isActive, load])
  useEffect(() => {
    if (!isActive) {
      setAuxOptionsReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading || auxOptionsLoadedRef.current) return undefined
    setAuxOptionsReady(true)
    return undefined
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive || auxOptionsLoadedRef.current) return
    const optionUiOpen = isProductFilterMenuOpen
      || Boolean(bulkEditMode)
      || modal === 'form'
      || modal === 'bulk'
      || modal === 'cats'
      || modal === 'units'
    if (optionUiOpen) setAuxOptionsReady(true)
  }, [bulkEditMode, isActive, isProductFilterMenuOpen, modal])
  useEffect(() => {
    if (!isActive || !auxOptionsReady || auxOptionsLoadedRef.current) return
    void loadAuxOptions('Product auxiliary options').catch(() => {})
  }, [auxOptionsReady, isActive, loadAuxOptions])
  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    setHistoryReady(true)
    return undefined
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive) {
      setFilterMetaReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading || filterMetaLoadedRef.current) return undefined
    setFilterMetaReady(true)
    return undefined
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive || !filterMetaReady || filterMetaLoadedRef.current) return
    filterMetaLoadedRef.current = true
    const requestId = beginTrackedRequest(filterMetaRequestRef)
    void withLoaderTimeout(() => productApi.getProductFilters({}), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS).then((filters) => {
      if (!isTrackedRequestCurrent(filterMetaRequestRef, requestId)) return
      setProductFilterMeta({
        brands: Array.isArray(filters?.brands) ? filters.brands : [],
        categories: Array.isArray(filters?.categories) ? filters.categories : [],
        suppliers: Array.isArray(filters?.suppliers) ? filters.suppliers : [],
        initials: aggregateProductInitials(filters?.initials || []),
      })
    }).catch(() => {})
  }, [filterMetaReady, isActive])
  useEffect(() => {
    if (!isActive || !syncChannelTs) return
    if (syncChannelReason === 'cache-refresh') {
      const sourceTable = syncChannelSource.split(':')[0]
      if (['products', 'categories', 'units', 'branches', 'suppliers', 'settings'].includes(sourceTable)) return
    }
    if (['products', 'categories', 'units', 'branches', 'suppliers', 'settings'].includes(syncChannelName)) {
      filterMetaLoadedRef.current = false
      setFilterMetaReady(false)
      invalidateTrackedRequest(filterMetaRequestRef)
      if (['categories', 'units', 'branches', 'settings'].includes(syncChannelName)) {
        auxOptionsLoadedRef.current = false
        setAuxOptionsReady(false)
        invalidateTrackedRequest(auxOptionsRequestRef)
      }
      load(true)
    }
  }, [isActive, load, syncChannelName, syncChannelReason, syncChannelSource, syncChannelTs])
  useEffect(() => () => {
    if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    invalidateTrackedRequest(auxOptionsRequestRef)
    invalidateTrackedRequest(filterMetaRequestRef)
    loadPromiseRef.current = null
    pendingLoadRef.current = null
  }, [])

  const handleSave = async (form: ProductRecord) => {
    if (!form.name?.trim()) return notify(t('name') + ' required', 'error')
    if (!beginSingleAction(productSaveInFlightRef)) return
    try {
      const data = { ...form, userId: user?.id, userName: user?.name }

      if (!selected) {
        const res = await runProductWriteMutation(() => productApi.createProduct(data), 'Create product')
        if (!res?.success) return notify(res?.error || 'Failed to create product', 'error')
      } else {
        const res = await runProductWriteMutation(() => productApi.updateProduct(selected.id || 0, data), 'Update product')
        if (res?.success === false) return notify(res.error || 'Failed to update product', 'error')
      }

      notify(selected ? t('product_updated') || 'Product updated' : t('product_created') || 'Product created')
      setModal(null); setSelected(null); setDetailProduct(null); load()
    } catch(e) {
      console.error('[handleSave] error:', e)
      notify(getErrorMessage(e, 'Failed to save product'), 'error')
    } finally {
      finishSingleAction(productSaveInFlightRef)
    }
  }

  const uploadGalleryImages = async (productId: EntityId | null | undefined, gallery: unknown[] = []): Promise<string[]> => {
    const next: string[] = []
    for (const entry of normalizeProductGallery(gallery)) {
      if (!entry.startsWith('data:image/')) {
        next.push(entry)
        continue
      }
      const ext = entry.startsWith('data:image/png')
        ? '.png'
        : entry.startsWith('data:image/webp')
          ? '.webp'
          : entry.startsWith('data:image/gif')
            ? '.gif'
            : '.jpg'
      const fileName = `product_${productId || 'new'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
      const uploaded = await runProductWriteMutation(
        () => productApi.uploadProductImage({ productId, filePath: entry, fileName }),
        'Upload product image',
        PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS,
      )
      if (!uploaded?.path) throw new Error(uploaded?.error || 'Image upload failed')
      next.push(uploaded.path)
    }
    return normalizeProductGallery(next)
  }

  const handleSaveWithGallery = async (form: ProductRecord) => {
    if (!form.name?.trim()) return notify(t('name') + ' required', 'error')
    if (!beginSingleAction(productSaveInFlightRef)) return
    try {
      const previousSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const galleryInput = normalizeProductGallery(form.image_gallery, form.image_path || null)
      const uploadedGallery = await uploadGalleryImages(selected?.id || null, galleryInput)
      const createClientRequestId = !selected
        ? `product_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : ''
      const payload = {
        ...form,
        image_gallery: uploadedGallery,
        image_path: uploadedGallery[0] || null,
        client_request_id: createClientRequestId || form.client_request_id || undefined,
        userId: user?.id,
        userName: user?.name,
      }
      let createdProductId = 0

      if (!selected) {
        const res = await runProductWriteMutation(() => productApi.createProduct(payload), 'Create product')
        if (!res?.success) return notify(res?.error || 'Failed to create product', 'error')
        createdProductId = extractHistoryResultId(res)
      } else {
        const res = await runProductWriteMutation(() => productApi.updateProduct(selected.id || 0, payload), 'Update product')
        if (res?.success === false) return notify(res.error || 'Failed to update product', 'error')
      }

      const targetProductId = selected ? Number(selected.id || 0) : createdProductId
      const latestProducts = await fetchProductsByIds([targetProductId])
      const latestProductsById = buildProductIdMap(latestProducts || [])
      const latestProductSnapshot = selected
        ? cloneHistorySnapshot(
            latestProductsById.get(targetProductId)
            || { ...payload, id: targetProductId },
          )
        : resolveCreatedHistorySnapshot({
            result: { id: createdProductId },
            latestItems: latestProducts,
            clientRequestId: createClientRequestId,
            fallbackSnapshot: { ...payload, id: createdProductId },
          }).snapshot

      if (previousSnapshot && targetProductId) {
        actionHistory.pushAction({
          label: `Edit product ${previousSnapshot.name || latestProductSnapshot.name || ''}`.trim(),
          undo: () => restoreProductSnapshots([previousSnapshot], 'Undo product edit'),
          redo: () => restoreProductSnapshots([latestProductSnapshot], 'Redo product edit'),
        })
      } else if (latestProductSnapshot?.id) {
        pushCreatedProductHistory(latestProductSnapshot, `Add product ${latestProductSnapshot.name || ''}`.trim())
      }

      notify(selected ? t('product_updated') || 'Product updated' : t('product_created') || 'Product created')
      setModal(null)
      setSelected(null)
      setDetailProduct(null)
      await load(true)
    } catch (e) {
      console.error('[handleSaveWithGallery] error:', e)
      notify(getErrorMessage(e, 'Failed to save product'), 'error')
    } finally {
      finishSingleAction(productSaveInFlightRef)
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    if (!beginSingleAction(bulkActionInFlightRef, { blocked: bulkActionBusy })) return
    if (!confirm(`Delete ${selectedVisibleCount} product${selectedVisibleCount > 1 ? 's' : ''}? This cannot be undone.`)) {
      finishSingleAction(bulkActionInFlightRef)
      return
    }
    const snapshots = snapshotProductsByIds(selectedVisibleIds)
    setBulkActionBusy(true)
    try {
      const deletionRun = await runConcurrentTasks<EntityId, number>(selectedVisibleIds, async (id: EntityId) => {
        const result = await runProductDeleteMutation(() => productApi.deleteProduct(id), 'Delete product')
        if (result?.success === false) throw new Error(result.error || 'Failed to delete product')
        return Number(id)
      })
      const { done, failed, failedIds } = summarizeProductRun(deletionRun)
      setSelectedIds(new Set(failedIds))
      await load(true)
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (done > 0 && deletedSnapshots.length) {
        let restoredEntries: RestoredProductEntry[] = []
        actionHistory.pushAction({
          label: `Delete ${done} product${done === 1 ? '' : 's'}`,
          undo: async () => {
            restoredEntries = await restoreDeletedProducts(deletedSnapshots, 'Undo product delete')
          },
          redo: async () => {
            const idsToDelete = restoredEntries.length
              ? normalizePositiveProductIds(restoredEntries, (entry) => entry.restoredId)
              : normalizePositiveProductIds(deletedSnapshots, (snapshot) => snapshot.id)
            const redoRun = await runConcurrentTasks<EntityId, void>(idsToDelete, async (id: EntityId) => {
              const result = await runProductDeleteMutation(() => productApi.deleteProduct(id), 'Re-delete product')
              if (result?.success === false) throw new Error(result.error || 'Failed to re-delete product')
            })
            if (redoRun.failures.length) throw new Error(getErrorMessage(redoRun.failures[0]?.error, 'Failed to re-delete product'))
            await load(true)
          },
        })
      }
      if (failed) notify(`Deleted ${done}, ${failed} failed`, 'warning')
      else notify(`${done} product${done > 1 ? 's' : ''} deleted`)
    } finally {
      finishSingleAction(bulkActionInFlightRef)
      setBulkActionBusy(false)
    }
  }

  const handleBulkOutOfStock = async () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    if (!confirm(`Set ${selectedVisibleCount} product(s) to out-of-stock (quantity = 0)?`)) return
    const snapshots = snapshotProductsByIds(selectedVisibleIds)
    setBulkActionBusy(true)
    const failedIds: number[] = []
    let done = 0
    let failed = 0
    try {
      const idsToClear: number[] = []
      for (const id of selectedVisibleIds) {
        try {
          idsToClear.push(Number(id))
          done++
        } catch {
          failed++
          failedIds.push(Number(id))
        }
      }
      if (idsToClear.length) {
        await clearProductStockByIds(idsToClear, 'Bulk set out of stock')
      }
      setSelectedIds(new Set(failedIds))
      const affectedSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (done > 0 && affectedSnapshots.length) {
        const affectedIds = normalizePositiveProductIds(affectedSnapshots, (snapshot) => snapshot.id)
        actionHistory.pushAction({
          label: `Set ${done} product${done === 1 ? '' : 's'} out of stock`,
          undo: () => restoreProductSnapshots(affectedSnapshots, 'Undo out-of-stock action'),
          redo: () => clearProductStockByIds(affectedIds, 'Redo out-of-stock action'),
        })
      }
      notify(
        failed
          ? `${done} product(s) set to out-of-stock, ${failed} failed`
          : `${done} product(s) set to out-of-stock`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }

  const handleBulkChangeBranch = async (branchId: EntityId) => {
    if (!selectedVisibleIds.length || !branchId || bulkActionBusy) return
    const branch = branchesById.get(String(branchId))
    if (!branch) return
    if (!confirm(`Move stock of ${selectedVisibleCount} product(s) to "${branch.name}"?`)) return
    const snapshots = snapshotProductsByIds(selectedVisibleIds)
    setBulkActionBusy(true)
    try {
      const { done, failed, failedIds, updatedIds } = await moveProductsToBranch(selectedVisibleIds, branchId, 'Bulk branch change')
      setSelectedIds(new Set(failedIds))
      const restoredSnapshots = snapshots.filter((snapshot) => updatedIds.includes(Number(snapshot?.id || 0)))
      if (done > 0 && restoredSnapshots.length) {
        actionHistory.pushAction({
          label: `Move ${done} product${done === 1 ? '' : 's'} to ${branch.name}`,
          undo: () => restoreProductSnapshots(restoredSnapshots, 'Undo branch move'),
          redo: () => moveProductsToBranch(updatedIds, branchId, 'Redo bulk branch change'),
        })
      }
      notify(
        failed
          ? `${done} product(s) moved to "${branch.name}", ${failed} failed`
          : `${done} product(s) branch updated to "${branch.name}"`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }

  const [bulkAddModal, setBulkAddModal] = useState<BulkAddModalState>(null)
  const handleBulkAddStock = () => {
    if (!selectedVisibleIds.length) return
    setBulkAddModal({
      ids: [...selectedVisibleIds],
      snapshots: snapshotProductsByIds(selectedVisibleIds),
    })
  }

  const toggleSelect = (id: EntityId) => setSelectedIds((prev) => {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return prev
    const n = new Set(prev)
    n.has(numericId) ? n.delete(numericId) : n.add(numericId)
    return n
  })
  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(visibleIds))
  }
  const handleDelete = async (p: ProductRecord) => {
    if (!beginSingleAction(productDeleteInFlightRef)) return
    if (!confirm(`${t('confirm_delete')} "${p.name}"?`)) {
      finishSingleAction(productDeleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(p)
      await runProductDeleteMutation(() => productApi.deleteProduct(p.id || 0, user?.id, user?.name), 'Delete product')
      await load(true)
      let restoredEntries: RestoredProductEntry[] = []
      actionHistory.pushAction({
        label: `Delete product ${snapshot.name || ''}`.trim(),
        undo: async () => {
          restoredEntries = await restoreDeletedProducts([snapshot], 'Undo product delete')
        },
        redo: async () => {
          const targetId = Number(restoredEntries[0]?.restoredId || snapshot.id || 0)
          if (!targetId) return
          const result = await runProductDeleteMutation(() => productApi.deleteProduct(targetId), 'Delete product again')
          if (result?.success === false) throw new Error(result.error || 'Failed to delete product again')
          await load(true)
        },
      })
      notify('Product deleted')
      setDetailProduct(null)
    } catch(e) { notify(getErrorMessage(e, 'Failed'), 'error') }
    finally { finishSingleAction(productDeleteInFlightRef) }
  }

  const catMap = useMemo<Record<string, LookupRecord>>(() => buildNameLookupMap(categories), [categories])
  const unitMap = useMemo<Record<string, LookupRecord>>(() => buildNameLookupMap(units), [units])
  const brandOptions = useMemo(
    () => buildProductBrandOptions(productFilterMeta.brands, String(settings?.product_brand_options || '[]')),
    [productFilterMeta.brands, settings?.product_brand_options],
  )
  const brandColorMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(
      Object.entries(parseBrandColorMap(settings?.product_brand_color_map))
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    [settings?.product_brand_color_map],
  )
  const branchNameById = useMemo(() => buildBranchNameByIdMap(branches), [branches])
  const branchesById = useMemo(() => new Map((Array.isArray(branches) ? branches : []).map((branch) => [String(branch?.id), branch])), [branches])
  const [lightbox, setLightbox] = useState<ProductLightboxState>(null)
  const availableCreatedYears = useMemo(
    () => getAvailableYears(products, (product) => product?.created_at),
    [products],
  )
  const categoryOptions = useMemo(() => toLookupOptions(categories), [categories])
  const unitOptions = useMemo(() => toLookupOptions(units), [units])
  const branchOptions = useMemo(() => toLookupOptions(branches), [branches])
  const getBrandColor = useCallback(
    (brandName: unknown): string => brandColorMap[normalizeBrandLookup(brandName)] || '',
    [brandColorMap],
  )
  const getBranchSummaryLabel = useCallback(
    (product: Record<string, unknown>): string => buildProductBranchSummaryLabel(product, branchNameById),
    [branchNameById],
  )
  const renderMetaPill = useCallback((item: { className?: string; color?: string; key: string; label?: unknown } | null) => {
    if (!item?.label) return null
    const label = String(item.label)
    const color = item.color || DEFAULT_META_PILL_COLOR
    if (item.color) {
      return (
        <span
          key={item.key}
          {...getKhmerTextProps(label, 'max-w-[10rem] truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold')}
          style={{ background: color, color: getContrastingTextColor(color) }}
          title={label}
        >
          {label}
        </span>
      )
    }
    return (
      <span
        key={item.key}
        {...getKhmerTextProps(label, `max-w-[10rem] truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${item.className || 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`)}
        title={label}
      >
        {label}
      </span>
    )
  }, [])
  const renderUnitChip = (unitName: string | undefined) => {
    if (!unitName) return null
    const color = unitMap[unitName]?.color
    if (!color) return <span {...getKhmerTextProps(unitName, 'ml-1 shrink-0 whitespace-nowrap text-xs font-normal text-gray-400')}>{unitName}</span>
    return (
      <span
        {...getKhmerTextProps(unitName, 'ml-1 inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold')}
        style={{ background: color, color: getContrastingTextColor(color) }}
      >
        {unitName}
      </span>
    )
  }

  const openLightbox = (gallery: unknown, startIndex = 0, title = '') => {
    const nextLightbox = buildProductLightboxState(gallery, startIndex, title)
    if (nextLightbox) setLightbox(nextLightbox)
  }

  const getBranchQty = useCallback((product: Record<string, unknown>, branchId: unknown) => getProductBranchQuantity(product, branchId), [])
  const parentProductIds = useMemo(() => buildParentProductIdSet(products), [products])
  const getStockBadge = (p: ProductRecord) => {
    const status = getProductStockStatus(p, { branchFilter, getBranchQty })
    if (status === 'out_of_stock') return <span className="badge-red">{t('out_of_stock')}</span>
    if (status === 'low_stock') return <span className="badge-yellow">{t('low_stock')}</span>
    return <span className="badge-green">{t('in_stock')}</span>
  }

  // Search: comma-separated terms. Mode AND = all terms must match. Mode OR = any term matches.
  // Spaces within a term are treated as part of the search string (no space=AND split).
  const searchTerms = useMemo(() => buildProductSearchTerms(search), [search])
  const filtered = useMemo(() => filterProductsForPage(products, {
    brandFilter,
    branchFilter,
    catFilter,
    createdMonthFilter,
    createdYearFilter,
    groupFilter,
    parentProductIds,
    searchMode,
    searchTerms,
    stockFilter,
    supplierFilter,
  }), [brandFilter, branchFilter, catFilter, createdMonthFilter, createdYearFilter, groupFilter, parentProductIds, products, searchMode, searchTerms, stockFilter, supplierFilter])

  const exportProductsCsv = useCallback(async (rowsToExport = filtered, filePrefix = 'products') => {
    const [{ downloadCSV }, { buildProductExportRows }] = await Promise.all([
      import('../../utils/csv.ts'),
      import('./helpers/productExport.ts'),
    ])
    downloadCSV(`${filePrefix}-${new Date().toISOString().slice(0,10)}.csv`, buildProductExportRows(rowsToExport))
  }, [filtered])

  const productsById = useMemo(() => buildProductIdMap(products), [products])

  const productSections = useMemo<ProductSectionLike[]>(
    () => buildProductGroupSections(filtered, {
      productsById,
      sortDirection: productSortDirection,
    }) as unknown as ProductSectionLike[],
    [filtered, productSortDirection, productsById],
  )

  const allVisibleProducts = useMemo<ProductRecord[]>(
    () => productSections.flatMap((section) => section.items),
    [productSections],
  )

  useEffect(() => {
    setProductPage(1)
  }, [brandFilter, branchFilter, catFilter, createdMonthFilter, createdYearFilter, groupFilter, initialFilter, productSortDirection, search, searchMode, stockFilter, supplierFilter])

  const visibleProducts = useMemo<ProductRecord[]>(
    () => allVisibleProducts,
    [allVisibleProducts],
  )

  const visibleIds = useMemo(() => buildVisibleProductIds(visibleProducts), [visibleProducts])
  const visibleIdsSignature = useMemo(() => visibleIds.join(','), [visibleIds])
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIdsSignature])
  const selectedVisibleIds = useMemo(
    () => buildSelectedVisibleIds(selectedIds, visibleIds).map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    [selectedIds, visibleIds],
  )
  const selectedVisibleIdsSet = useMemo(
    () => new Set(selectedVisibleIds),
    [selectedVisibleIds],
  )
  const selectedVisibleCount = selectedVisibleIds.length
  const {
    safePage: productSafePage,
    safePageSize: productSafePageSize,
    totalPages: productTotalPages,
    summaryLabel: productSummaryLabel,
  } = useMemo(() => buildProductPaginationState({
    page: productPage,
    total: productTotal,
    pageSize: productPageSize,
    fallbackPageSize: PAGE_SIZE_OPTIONS[0],
  }), [productPage, productPageSize, productTotal])
  const productSelectAllLabel = `${t('select_all') || 'Select all'} (${visibleProducts.length})`
  const productSelectedLabel = tr('products_selected_count', `${selectedVisibleCount} selected`)
  const productChipLabels = useMemo(() => ({
    info: tr('basic_info_short', 'Info'),
    pricing: tr('pricing_short', 'Price'),
    stock: tr('stock_short', 'Stock'),
    branch: tr('branch_short', 'Branch'),
    out: tr('out_short', 'Out'),
    delete: tr('delete_short', 'Delete'),
  }), [tr])
  const selectedProducts = useMemo(
    () => buildSelectedProducts(visibleProducts, selectedVisibleIdsSet),
    [selectedVisibleIdsSet, visibleProducts],
  )
  const jumpTargetIdsByLetter = useMemo(
    () => buildJumpTargetIdsByLetter(productSections as unknown as Parameters<typeof buildJumpTargetIdsByLetter>[0], collapsedProductSections),
    [collapsedProductSections, productSections],
  )
  const visibleLetters = useMemo(
    () => [...jumpTargetIdsByLetter.keys()].sort(compareInitialKeys),
    [jumpTargetIdsByLetter],
  )
  const hasSelected = selectedVisibleCount > 0

  useEffect(() => {
    if (!hasSelected) {
      setBulkEditMode(null)
      setBulkEditOpen(false)
    }
  }, [hasSelected])

  useEffect(() => {
    setCollapsedProductSections((current) => {
      const validIds = new Set(productSections.map((section) => section.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [productSections])

  useEffect(() => {
    setCollapsedProductGroups((current) => {
      const validIds = new Set(productSections.flatMap((section) => section.groups.map((group) => group.key)))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      let changed = next.size !== current.size
      initializedCollapsedGroupKeysRef.current = new Set(
        [...initializedCollapsedGroupKeysRef.current].filter((id) => validIds.has(id)),
      )

      productSections.forEach((section) => {
        section.groups.forEach((group) => {
          if (!group?.hasMultipleItems) return
          if (initializedCollapsedGroupKeysRef.current.has(group.key)) return
          initializedCollapsedGroupKeysRef.current.add(group.key)
          next.add(group.key)
          changed = true
        })
      })

      return changed ? next : current
    })
  }, [productSections])

  useEffect(() => {
    const indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length
    if (desktopSelectAllRef.current) desktopSelectAllRef.current.indeterminate = indeterminate
    if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = indeterminate
  }, [selectedVisibleCount, visibleIds.length])

  useEffect(() => {
    setProductPageDraft(String(productSafePage))
  }, [productSafePage])

  const toggleSelectionScope = useCallback((ids: EntityId[], checked: boolean) => {
    setSelectedIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const commitProductPageDraft = useCallback(() => {
    const parsed = Number.parseInt(String(productPageDraft || '').trim(), 10)
    if (!Number.isFinite(parsed)) {
      setProductPageDraft(String(productSafePage))
      return
    }
    const nextPage = Math.min(productTotalPages, Math.max(1, parsed))
    setProductPage(nextPage)
    setProductPageDraft(String(nextPage))
  }, [productPageDraft, productSafePage, productTotalPages])

  const cycleProductPageSize = useCallback(() => {
    const currentIndex = PAGE_SIZE_OPTIONS.findIndex((option) => Number(option) === Number(productSafePageSize))
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % PAGE_SIZE_OPTIONS.length : 0
    setProductPageSize(PAGE_SIZE_OPTIONS[nextIndex])
    setProductPage(1)
  }, [productSafePageSize])

  const isSelectionScopeFullySelected = useCallback(
    (ids: EntityId[] = []) => isSelectionScopeFullySelectedHelper(ids, selectedVisibleIdsSet),
    [selectedVisibleIdsSet],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids: EntityId[] = []) => isSelectionScopePartiallySelectedHelper(ids, selectedVisibleIdsSet),
    [selectedVisibleIdsSet],
  )
  const isProductSelected = useCallback(
    (id: EntityId) => selectedVisibleIdsSet.has(Number(id)),
    [selectedVisibleIdsSet],
  )

  const productExportItems = useMemo(() => buildProductExportItems({
    brandFilter,
    branchFilter,
    catFilter,
    createdMonthFilter,
    createdYearFilter,
    exportProductsCsv,
    filtered,
    products,
    selectedProducts,
    stockFilter,
    supplierFilter,
    tr,
  }), [brandFilter, branchFilter, catFilter, createdMonthFilter, createdYearFilter, exportProductsCsv, filtered, products, selectedProducts, stockFilter, supplierFilter, tr])

  const suppliers = useMemo(
    () => buildProductSupplierOptions(productFilterMeta.suppliers),
    [productFilterMeta.suppliers],
  )

  const activeFilters = countActiveProductFilters({
    brandFilter,
    branchFilter,
    catFilter,
    createdMonthFilter,
    createdYearFilter,
    groupFilter,
    initialFilter,
    productSortDirection,
    stockFilter,
    supplierFilter,
  })

  const clearAllFilters = useCallback(() => {
    setCatFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setSupplierFilter('all')
    setStockFilter('all')
    setGroupFilter('all')
    setInitialFilter('all')
    setCreatedYearFilter('all')
    setCreatedMonthFilter('all')
    setProductSortDirection('desc')
  }, [])

  const handleLookupReviewSelection = useCallback((selection: { type?: unknown; value?: unknown }) => {
    const type = String(selection?.type || '').toLowerCase()
    const value = String(selection?.value || '').trim()
    if (!value) return
    clearAllFilters()
    setSearch('')
    setModal(null)
    setProductPage(1)
    if (type === 'brand') {
      setBrandFilter(value)
      return
    }
    if (type === 'category') {
      setCatFilter(value)
      return
    }
    if (type === 'unit') {
      setSearch(value)
    }
  }, [clearAllFilters])

  const initialOptions = useMemo(
    () => aggregateProductInitials(productFilterMeta.initials || []),
    [productFilterMeta.initials],
  )

  const toggleProductSection = useCallback((sectionId: string) => {
    setCollapsedProductSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const toggleProductGroup = useCallback((groupKey: string) => {
    setCollapsedProductGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  const jumpToLetter = useCallback((letter: string) => {
    const targetId = jumpTargetIdsByLetter.get(String(letter || '').toUpperCase())
    if (!targetId) return
    const nodes = Array.from(document.querySelectorAll(`[data-product-jump-id="${targetId}"]`))
    const node = nodes.find((entry) => entry.getClientRects().length > 0) || nodes[0]
    scrollNodeWithOffset(node instanceof HTMLElement ? node : null)
  }, [jumpTargetIdsByLetter])

  const getGroupPriceLabel = useCallback((group: ProductGroupLike) => {
    return buildProductGroupPriceLabel(group, fmtUSD)
  }, [fmtUSD])

  const getGroupSummaryParts = useCallback((group: ProductGroupLike, { includeCount = true }: { includeCount?: boolean } = {}) => {
    return buildProductGroupSummaryParts(group, { includeCount, t: (key: string) => t(key) || key, fmtUSD })
  }, [fmtUSD, t])

  const snapshotProductsByIds = useCallback((ids: EntityId[] = []): ProductRecord[] => (
    products
      .filter((product) => ids.includes(Number(product?.id || 0)))
      .map((product) => JSON.parse(JSON.stringify(product)) as ProductRecord)
  ), [products])

  const buildProductWritePayload = useCallback(async (snapshot: ProductRecord = {}) => (
    (await loadProductWriteHelpers()).buildProductWritePayload(snapshot, { id: user?.id, name: user?.name })
  ), [user?.id, user?.name])

  const restoreProductBranchStock = useCallback(async (productId: EntityId, snapshot: ProductRecord, currentProduct: ProductRecord, reason: string) => {
    const {
      buildProductBranchStockAdjustments,
      buildProductStockAdjustmentPayload,
    } = await loadProductWriteHelpers()
    const adjustments = buildProductBranchStockAdjustments(snapshot, currentProduct)
    const syncRun = await runConcurrentTasks(adjustments, async ({ branchId, type, quantity }: { branchId: EntityId; type: string; quantity: unknown }) => {
      await runProductStockMutation(
        () => productApi.adjustStock(buildProductStockAdjustmentPayload(snapshot, {
          productId,
          productName: snapshot?.name || currentProduct?.name || '',
          type,
          quantity,
          branchId,
          reason,
          user: { id: user?.id, name: user?.name },
        })),
        'Restore product branch stock',
      )
    })
    if (syncRun.failures.length) throw (syncRun.failures[0]?.error || new Error('Failed to restore branch stock'))
  }, [runProductStockMutation, user?.id, user?.name])

  const restoreProductSnapshots = useCallback(async (snapshots: ProductRecord[] = [], reason = 'Restore products') => {
    if (!snapshots.length) return
    const latestProducts = await fetchProductsByIds(normalizePositiveProductIds(snapshots, (snapshot) => snapshot?.id))
    const latestMap = new Map((latestProducts || []).map((product) => [Number(product?.id || 0), product]))
    const restoreRun = await runConcurrentTasks<ProductRecord, void>(snapshots, async (snapshot: ProductRecord) => {
      const productId = Number(snapshot?.id || 0)
      const currentProduct = latestMap.get(productId)
      if (!currentProduct) return
      const payload = await buildProductWritePayload(snapshot)
      await runProductWriteMutation(() => productApi.updateProduct(productId, payload), 'Restore product')
      await restoreProductBranchStock(productId, snapshot, currentProduct, reason)
    })
    if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore products'))
    await load(true)
  }, [buildProductWritePayload, fetchProductsByIds, load, restoreProductBranchStock, runProductWriteMutation])

  const restoreDeletedProducts = useCallback(async (snapshots: ProductRecord[] = [], reason = 'Restore deleted products'): Promise<RestoredProductEntry[]> => {
    if (!snapshots.length) return []
    const {
      buildDeletedProductIdSet,
      getDefaultProductRestoreBranchId,
      getPreferredProductRestoreBranchId,
      resolveRestoredProductParentId,
    } = await loadProductWriteHelpers()
    const defaultBranchId = getDefaultProductRestoreBranchId(branches)
    const restored: RestoredProductEntry[] = []
    const orderedSnapshots = orderProductRestoreSnapshots(snapshots)
    const restoredIdMap = new Map<number, number>()
    const deletedIdSet = buildDeletedProductIdSet(orderedSnapshots)
    for (const snapshot of orderedSnapshots) {
      const preferredBranchId = getPreferredProductRestoreBranchId(snapshot, defaultBranchId)
      const resolvedParentId = resolveRestoredProductParentId(snapshot, deletedIdSet, restoredIdMap)
      const restoredPayload = await buildProductWritePayload({
        ...snapshot,
        parent_id: resolvedParentId || null,
      })
      const createPayload = {
        ...restoredPayload,
        client_request_id: createProductHistoryRequestId('product_restore'),
        branch_id: preferredBranchId || defaultBranchId || '',
        stock_quantity: 0,
      }
      const result = await runProductWriteMutation(() => productApi.createProduct(createPayload), 'Restore deleted product')
      const restoredId = Number(result?.id || result?.data?.id || 0)
      if (!restoredId) throw new Error(result?.error || 'Failed to restore deleted product')
      const snapshotId = Number(snapshot?.id || 0)
      if (snapshotId > 0) restoredIdMap.set(snapshotId, restoredId)
      restored.push({ snapshot, restoredId })
    }
    const latestProducts = await fetchProductsByIds(normalizePositiveProductIds(restored, (entry) => entry.restoredId))
    const latestMap = new Map((latestProducts || []).map((product) => [Number(product?.id || 0), product]))
    const stockRestoreRun = await runConcurrentTasks<RestoredProductEntry, void>(restored, async (entry: RestoredProductEntry) => {
      if (!entry.restoredId || !entry.snapshot) return
      const currentProduct = latestMap.get(Number(entry.restoredId))
      await restoreProductBranchStock(entry.restoredId, entry.snapshot, currentProduct || { branch_stock: [] }, reason)
    })
    if (stockRestoreRun.failures.length) throw (stockRestoreRun.failures[0]?.error || new Error('Failed to restore deleted product stock'))
    await load(true)
    return restored
  }, [branches, buildProductWritePayload, fetchProductsByIds, load, restoreProductBranchStock, runProductWriteMutation])

  const pushCreatedProductHistory = useCallback((snapshot: ProductRecord, label = '') => {
    const baseSnapshot = cloneHistorySnapshot(snapshot)
    let activeCreatedProductId = Number(baseSnapshot?.id || 0)
    if (!activeCreatedProductId) return false
    let restoredEntries: RestoredProductEntry[] = []
    actionHistory.pushAction({
      label: label || `Add product ${baseSnapshot?.name || ''}`.trim(),
      undo: async () => {
        const result = await runProductDeleteMutation(() => productApi.deleteProduct(activeCreatedProductId), 'Undo product creation')
        if (result?.success === false) throw new Error(result.error || 'Failed to undo product creation')
        await load(true)
      },
      redo: async () => {
        restoredEntries = await restoreDeletedProducts([baseSnapshot], 'Redo product create')
        activeCreatedProductId = Number(restoredEntries[0]?.restoredId || activeCreatedProductId)
      },
    })
    return true
  }, [actionHistory, load, restoreDeletedProducts, runProductDeleteMutation])

  const handleVariantDone = useCallback(async (payload: { createdProductId?: EntityId; snapshot?: ProductRecord } = {}) => {
    setVariantModal(null)
    const createdProductId = Number(payload?.createdProductId || 0)
    const latestProducts = await fetchProductsByIds([createdProductId])
    const latestProductsById = buildProductIdMap(latestProducts || [])
    const latestVariantSnapshot = cloneHistorySnapshot(
      latestProductsById.get(createdProductId)
      || { ...(payload?.snapshot || {}), id: createdProductId },
    )
    if (latestVariantSnapshot?.id) {
      pushCreatedProductHistory(latestVariantSnapshot, `Add variant ${latestVariantSnapshot.name || ''}`.trim())
    }
    await load(true)
  }, [fetchProductsByIds, load, pushCreatedProductHistory])

  const openProductFormTab = useCallback((product: ProductRecord, tab: ProductFormTab = 'basic') => {
    setSelected(product)
    setFormInitialTab(tab)
    setModal('form')
  }, [])

  const clearProductStockByIds = useCallback(async (productIds: EntityId[] = [], reason = 'Set products out of stock') => {
    if (!productIds.length) return
    const {
      buildProductClearStockAdjustments,
      buildProductStockAdjustmentPayload,
    } = await loadProductWriteHelpers()
    const latestProducts = await fetchProductsByIds(productIds)
    const latestMap = new Map((latestProducts || []).map((product) => [Number(product?.id || 0), product]))
    const clearRun = await runConcurrentTasks<EntityId, void>(productIds, async (productId: EntityId) => {
      const currentProduct = latestMap.get(Number(productId))
      if (!currentProduct) return
      const adjustments = buildProductClearStockAdjustments(currentProduct)
      const branchRun = await runConcurrentTasks(adjustments, async (adjustment: { branchId: EntityId; quantity: unknown; unitCostUsd?: unknown; unitCostKhr?: unknown }) => {
        await runProductStockMutation(
          () => productApi.adjustStock(buildProductStockAdjustmentPayload(currentProduct, {
            productId,
            type: 'remove',
            quantity: adjustment.quantity,
            branchId: adjustment.branchId,
            unitCostUsd: adjustment.unitCostUsd,
            unitCostKhr: adjustment.unitCostKhr,
            reason,
            user: { id: user?.id, name: user?.name },
          })),
          'Clear product stock',
        )
      })
      if (branchRun.failures.length) throw (branchRun.failures[0]?.error || new Error('Failed to clear branch stock'))
    })
    if (clearRun.failures.length) throw (clearRun.failures[0]?.error || new Error('Failed to clear product stock'))
    await load(true)
  }, [fetchProductsByIds, load, user?.id, user?.name])

  const addStockToProducts = useCallback(async (productIds: EntityId[] = [], quantity: unknown, branchId: unknown, reason = 'Bulk add stock') => {
    const amount = Number(quantity || 0)
    const numericBranchId = Number(branchId || 0)
    if (!productIds.length || !Number.isFinite(amount) || amount <= 0) {
      return { done: 0, failed: 0, failedIds: [], updatedIds: [] }
    }
    const { buildProductStockAdjustmentPayload } = await loadProductWriteHelpers()

    const latestProducts = await fetchProductsByIds(productIds)
    const latestMap = new Map((latestProducts || []).map((product) => [Number(product?.id || 0), product]))

    const addRun = await runConcurrentTasks<EntityId, number>(productIds, async (productId: EntityId) => {
      const currentProduct = latestMap.get(Number(productId))
      if (!currentProduct) {
        throw new Error('Product not found')
      }
      await runProductStockMutation(
        () => productApi.adjustStock(buildProductStockAdjustmentPayload(currentProduct, {
          productId,
          type: 'add',
          quantity: amount,
          branchId: Number.isFinite(numericBranchId) && numericBranchId > 0 ? numericBranchId : null,
          reason,
          user: { id: user?.id, name: user?.name },
        })),
        'Bulk add product stock',
      )
      return Number(productId)
    })
    const summary = summarizeProductRun(addRun)

    await load(true)
    return summary
  }, [fetchProductsByIds, load, runProductStockMutation, user?.id, user?.name])

  const moveProductsToBranch = useCallback(async (productIds: EntityId[] = [], branchId: unknown, reason = 'Bulk branch change') => {
    const numericBranchId = Number(branchId || 0)
    if (!productIds.length || !Number.isFinite(numericBranchId) || numericBranchId <= 0) {
      return { done: 0, failed: 0, failedIds: [], updatedIds: [] }
    }
    const {
      buildProductBranchMovePlan,
      buildProductStockAdjustmentPayload,
      buildProductTransferStockPayload,
    } = await loadProductWriteHelpers()

    const latestProducts = await fetchProductsByIds(productIds)
    const latestMap = new Map((latestProducts || []).map((product) => [Number(product?.id || 0), product]))

    const moveRun = await runConcurrentTasks<EntityId, number>(productIds, async (productId: EntityId) => {
      const product = latestMap.get(Number(productId))
      if (!product) {
        throw new Error('Product not found')
      }
      const movePlan = buildProductBranchMovePlan(product, numericBranchId)
      if (movePlan?.action === 'transfer') {
        await runProductStockMutation(
          () => productApi.transferStock(buildProductTransferStockPayload(product, movePlan, {
            productId,
            reason,
            user: { id: user?.id, name: user?.name },
          })),
          'Move product branch stock',
        )
      } else if (movePlan?.action === 'initialize') {
        await runProductStockMutation(
          () => productApi.adjustStock(buildProductStockAdjustmentPayload(product, {
            productId,
            type: 'add',
            quantity: 0,
            branchId: movePlan.branchId,
            reason,
            user: { id: user?.id, name: user?.name },
          })),
          'Initialize product branch stock',
        )
      }
      return Number(productId)
    })
    const summary = summarizeProductRun(moveRun)

    await load(true)
    return summary
  }, [fetchProductsByIds, load, runProductStockMutation, user?.id, user?.name])

  const runBulkProductUpdates = useCallback(async (updates: Record<string, unknown>) => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    const {
      buildDefinedProductUpdates,
      buildProductBulkUpdatePayload,
    } = await loadProductWriteHelpers()
    const nextUpdates = buildDefinedProductUpdates(updates)
    if (!Object.keys(nextUpdates).length) {
      notify('No changes specified', 'warning')
      return
    }
    if (!window.confirm(`Do you want to update ${selectedVisibleCount} product${selectedVisibleCount === 1 ? '' : 's'}?`)) return
    const snapshots = snapshotProductsByIds(selectedVisibleIds)
    setBulkActionBusy(true)
    let done = 0
    let failed = 0
    try {
      const updateRun = await runConcurrentTasks<EntityId, number>(selectedVisibleIds, async (id: EntityId) => {
        const current = productsById.get(Number(id))
        const result = await runProductWriteMutation(
          () => productApi.updateProduct(
            id,
            buildProductBulkUpdatePayload(nextUpdates, current, { id: user?.id, name: user?.name }),
          ),
          'Bulk update product',
        )
        if (result?.success === false) throw new Error(result.error || 'Failed to update product')
        return Number(id)
      })
      const { done: completedCount, failed: failedCount, failedIds } = summarizeProductRun(updateRun)
      done = completedCount
      failed = failedCount
      setSelectedIds(new Set(failedIds))
      setBulkEditMode(null)
      setBulkEditForm({})
      await load(true)
      const restoredSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (done > 0 && restoredSnapshots.length) {
        actionHistory.pushAction({
          label: `Update ${done} product${done === 1 ? '' : 's'}`,
          undo: () => restoreProductSnapshots(restoredSnapshots, 'Undo product bulk update'),
          redo: async () => {
            const redoRun = await runConcurrentTasks<ProductRecord, void>(restoredSnapshots, async (snapshot: ProductRecord) => {
              if (!snapshot.id) return
              const snapshotId = snapshot.id
              const current = productsById.get(Number(snapshotId))
              const result = await runProductWriteMutation(
                () => productApi.updateProduct(
                  snapshotId,
                  buildProductBulkUpdatePayload(nextUpdates, current, { id: user?.id, name: user?.name }, snapshot?.updated_at),
                ),
                'Redo product bulk update',
              )
              if (result?.success === false) throw new Error(result.error || 'Failed to reapply product update')
            })
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to reapply product update'))
            await load(true)
          },
        })
      }
      notify(
        failed
          ? `Updated ${done} products, ${failed} failed`
          : `Updated ${done} products`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }, [actionHistory, bulkActionBusy, load, notify, productsById, restoreProductSnapshots, runProductWriteMutation, selectedVisibleCount, selectedVisibleIds, snapshotProductsByIds, user?.id, user?.name])

  const productFilterSections = useMemo(() => buildProductFilterSections({
    availableCreatedYears,
    branches,
    brandOptions,
    categories,
    filters: {
      brandFilter,
      branchFilter,
      catFilter,
      createdMonthFilter,
      createdYearFilter,
      groupFilter,
      productSortDirection,
      stockFilter,
      supplierFilter,
    },
    isOpen: isProductFilterMenuOpen,
    monthOptions: [...CREATED_MONTH_OPTIONS],
    setBrandFilter,
    setBranchFilter,
    setCatFilter,
    setCreatedMonthFilter,
    setCreatedYearFilter,
    setGroupFilter,
    setProductSortDirection: (value: string) => setProductSortDirection(value === 'asc' ? 'asc' : 'desc'),
    setStockFilter,
    setSupplierFilter,
    suppliers,
    t,
  }), [availableCreatedYears, branches, brandFilter, brandOptions, catFilter, categories, createdMonthFilter, createdYearFilter, groupFilter, isProductFilterMenuOpen, productSortDirection, stockFilter, supplierFilter, suppliers, t])

  const renderDesktopProductRow = useCallback((p: ProductRecord, { indented = false }: { indented?: boolean } = {}) => {
    const productId = p.id ?? 0
    const productName = String(p.name || '')
    const sellingUsd = Number(p.selling_price_usd || 0)
    const sellingKhr = Number(p.selling_price_khr || 0)
    const specialUsd = Number(p.special_price_usd || 0)
    const specialKhr = Number(p.special_price_khr || 0)
    const {
      branchSummaryLabel,
      compactMeta,
      marginPct,
      marginUsd,
      promotion,
      purchaseKhr,
      purchaseUsd,
      qty,
      selectedBranchName,
    } = buildProductRowDisplayState(p, {
      branchFilter,
      branchNameById,
      catMap,
      exchangeRate,
      getBranchQty,
      getBranchSummaryLabel,
      getBrandColor,
      t,
    })
    const thumbnailState = buildProductThumbnailState(p)
    return (
      <tr
        key={productId}
        data-product-jump-id={productId}
        className={`table-row cursor-pointer ${isProductSelected(productId) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
        onClick={() => setDetailProduct(p)}
      >
        <td className={`px-3 py-2 w-8 ${indented ? 'pl-6' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelect(productId) }}>
          <input type="checkbox" className="rounded" checked={isProductSelected(productId)} onChange={() => toggleSelect(productId)} />
        </td>
        <td className="px-3 py-2">
          {thumbnailState.hasImage
            ? <ProductImg src={thumbnailState.thumbnail} alt={productName} className="w-10 h-10 rounded-lg object-cover cursor-zoom-in hover:ring-2 hover:ring-blue-400" onClick={(e) => { e.stopPropagation(); openLightbox(thumbnailState.gallery, 0, productName) }} />
            : <ProductImagePlaceholder className="h-10 w-10 rounded-lg" compact />}
        </td>
        <td className="px-3 py-2 align-top">
          {compactMeta.length ? (
            <div className="mb-1 flex max-w-[18rem] flex-wrap gap-1">
              {compactMeta.map((item) => renderMetaPill(item ? {
                key: String(item.key),
                label: String(item.label || ''),
                color: typeof item.color === 'string' ? item.color : undefined,
              } : null))}
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5">
            <div {...getKhmerTextProps(productName, 'min-w-0 break-words font-medium text-gray-900 dark:text-white')}>{productName}</div>
            {p.is_group ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">group</span> : null}
            {p.parent_id ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">variant</span> : null}
          </div>
        </td>
        <td className="hidden px-3 py-2 align-top md:table-cell">
          <ProductDetailsCell
            product={p}
            promotion={promotion}
            branchLabel={String(branchSummaryLabel || '')}
            selectedBranchName={selectedBranchName ? String(selectedBranchName) : ''}
            selectedBranchId={branchFilter}
            renderMetaPill={renderMetaPill}
            tr={tr}
            fmtUSD={fmtUSD}
          />
        </td>
        <td className="px-3 py-2 text-right col-highlight-red">
          <div className="font-medium text-red-700 dark:text-red-400">{fmtUSD(purchaseUsd)}</div>
          {purchaseKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(purchaseKhr)}</div>}
        </td>
        <td className="px-3 py-2 text-right col-highlight-green">
          <div className="font-semibold text-green-700 dark:text-green-400">{fmtUSD(sellingUsd)}</div>
          {sellingKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(sellingKhr)}</div>}
          {specialUsd > 0 || specialKhr > 0 ? (
            <div className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
              Special {fmtUSD(specialUsd || sellingUsd)}
              {specialKhr > 0 ? ` / ${fmtKHR(specialKhr)}` : ''}
            </div>
          ) : null}
          {promotion.active ? (
            <div className="mt-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300">
              {String(p.discount_label || tr('discounts', 'Discounts'))} {fmtUSD(promotion.applied_price_usd)}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right hidden lg:table-cell">
          {purchaseUsd > 0 && sellingUsd > 0
            ? <div><div className={`font-medium text-xs ${marginUsd >= 0 ? 'text-blue-600' : 'text-yellow-600'}`}>{fmtUSD(marginUsd)}</div><div className="text-xs text-gray-400">{marginPct.toFixed(1)}%</div></div>
            : <span className="text-gray-300">N/A</span>}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="font-bold text-gray-900 dark:text-white">
            {String(qty || 0)}
            {renderUnitChip(typeof p.unit === 'string' ? p.unit : undefined)}
          </div>
        </td>
        <td className="px-3 py-2 text-center">{getStockBadge(p)}</td>
        <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <ProductRowActions
            onDetails={() => setDetailProduct(p)}
            onEdit={() => openProductFormTab(p, 'basic')}
            onDelete={() => handleDelete(p)}
            onAddVariant={!p.parent_id ? () => setVariantModal(p) : undefined}
            onDiscount={() => openProductFormTab(p, 'pricing')}
            onAdjustStock={() => openProductFormTab(p, 'stock')}
            t={t}
          />
        </td>
      </tr>
    )
  }, [branchFilter, branchNameById, catMap, exchangeRate, fmtKHR, fmtUSD, getBranchQty, getBranchSummaryLabel, getBrandColor, getStockBadge, handleDelete, isProductSelected, openLightbox, openProductFormTab, renderMetaPill, renderUnitChip, t, tr])

  const renderMobileProductCard = useCallback((p: ProductRecord, { indented = false }: { indented?: boolean } = {}) => {
    const productId = p.id ?? 0
    const productName = String(p.name || '')
    const categoryName = String(p.category || '')
    const brandName = String(p.brand || '')
    const sellingUsd = Number(p.selling_price_usd || 0)
    const specialUsd = Number(p.special_price_usd || 0)
    const unitName = typeof p.unit === 'string' ? p.unit : undefined
    const {
      mobileStatusClass,
      mobileStatusLabel,
      promotion,
      purchaseUsd,
      qty,
    } = buildProductRowDisplayState(p, {
      branchFilter,
      exchangeRate,
      getBranchQty,
      t,
    })
    const thumbnailState = buildProductThumbnailState(p)

    return (
      <div
        key={productId}
        data-product-jump-id={productId}
        className={`card cursor-pointer px-3 py-2.5 ${isProductSelected(productId) ? 'ring-1 ring-blue-400 bg-blue-50/70 dark:bg-blue-900/20' : ''} ${indented ? 'ml-3 border-l-4 border-l-slate-200 dark:border-l-slate-700' : ''}`}
        onClick={() => setDetailProduct(p)}
      >
        <div className="flex items-start gap-3">
          <input type="checkbox" className="rounded mt-1 flex-shrink-0 cursor-pointer" checked={isProductSelected(productId)} onChange={(e) => { e.stopPropagation(); toggleSelect(productId) }} onClick={(e) => e.stopPropagation()} />
          <div className="relative flex-shrink-0">
            {thumbnailState.hasImage
              ? <ProductImg src={thumbnailState.thumbnail} alt={productName} className="w-14 h-14 rounded-xl object-cover cursor-zoom-in" onClick={(e) => { e.stopPropagation(); openLightbox(thumbnailState.gallery, 0, productName) }} />
              : <ProductImagePlaceholder className="h-14 w-14 rounded-xl" />}
            <ProductDiscountBadge product={p} promotion={promotion} fmtUSD={fmtUSD} label={tr('discounts', 'Discounts')} overlay />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div {...getKhmerTextProps(productName, 'truncate text-sm font-semibold text-gray-900 dark:text-white')}>{productName}</div>
              </div>
              <div className="flex shrink-0 items-start gap-1.5">
                <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${mobileStatusClass}`}>
                  {mobileStatusLabel}
                </span>
                <span onClick={(event) => event.stopPropagation()}>
                  <ProductRowActions
                    onDetails={() => setDetailProduct(p)}
                    onEdit={() => openProductFormTab(p, 'basic')}
                    onDelete={() => handleDelete(p)}
                    onAddVariant={!p.parent_id ? () => setVariantModal(p) : undefined}
                    onDiscount={() => openProductFormTab(p, 'pricing')}
                    onAdjustStock={() => openProductFormTab(p, 'stock')}
                    t={t}
                  />
                </span>
              </div>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {categoryName ? (
                <span
                  className="inline-block max-w-[8rem] truncate rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{
                    background: catMap[categoryName]?.color || '#6b7280',
                    color: getContrastingTextColor(catMap[categoryName]?.color || '#6b7280'),
                  }}
                  title={categoryName}
                >
                  {categoryName}
                </span>
              ) : null}
              {brandName ? (
                <span
                  className={`inline-block max-w-[8rem] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getBrandColor(brandName) ? '' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  style={getBrandColor(brandName) ? {
                    background: getBrandColor(brandName),
                    color: getContrastingTextColor(getBrandColor(brandName)),
                  } : undefined}
                  title={brandName}
                >
                  {brandName}
                </span>
              ) : null}
            </div>
            <ProductBatchPreview product={p} branchId={branchFilter} tr={tr} compact />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[5.35rem] text-[11px]">
              <span className="whitespace-nowrap text-red-600">{fmtUSD(purchaseUsd)}</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="whitespace-nowrap text-green-700">{fmtUSD(sellingUsd)}</span>
              {specialUsd > 0 ? (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="whitespace-nowrap text-blue-700 dark:text-blue-400">{fmtUSD(specialUsd)}</span>
                </>
              ) : null}
              {promotion.active ? (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="whitespace-nowrap text-rose-600 dark:text-rose-300">{fmtUSD(promotion.applied_price_usd)}</span>
                </>
              ) : null}
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className={withKhmerTextClass(unitName, 'inline-flex min-w-0 max-w-full items-center whitespace-nowrap text-gray-500')}>{String(qty || 0)}{renderUnitChip(unitName)}</span>
        </div>
      </div>
    )
  }, [branchFilter, catMap, exchangeRate, fmtUSD, getBranchQty, getBrandColor, handleDelete, isProductSelected, openLightbox, openProductFormTab, renderUnitChip, t, tr])

  if (loadError && !loading && !products.length && !categories.length && !units.length && !branches.length) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">!</div>
      <p className="text-red-600 dark:text-red-400 font-medium">{loadError}</p>
      <button type="button" onClick={() => load(false)} className="btn-primary">Retry</button>
    </div>
  )

  return (
    <div className="page-scroll p-3 sm:p-6">
      {/* Single-row header: compact on mobile, expanded on desktop. */}
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h1 className="mr-1 flex min-w-0 flex-1 items-center gap-2 truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          <PackageSearch className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{t('products')}</span>
        </h1>
        <div className="w-full min-w-0 overflow-x-auto pb-1 sm:ml-auto sm:w-auto sm:flex-shrink-0 sm:pb-0">
          <ProductsHeaderActions
            onManageCats={()=>setModal('cats')}
            onManageBrands={()=>setModal('brands')}
            onManageUnits={()=>setModal('units')}
            onImport={()=>setModal('bulk')}
            onExport={() => exportProductsCsv(filtered)}
            exportMenuItems={productExportItems}
            onAdd={()=>{setSelected(null);setModal('form')}}
            t={t}
          />
        </div>
      </div>

      {/* Search row */}
      <div className="mb-3 overflow-x-auto pb-1">
        <div className="flex min-w-[19.5rem] items-center gap-1.5 sm:min-w-0">
          <input
            className="input min-w-0 flex-1 text-sm"
            placeholder={t('search_products_placeholder') || `${t('search') || 'Search'} products`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-900">
            {(['AND', 'OR'] as SearchMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSearchMode(mode)}
                className={`min-w-[2.65rem] rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${searchMode === mode ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 flex min-w-0 items-center gap-2">
        {historyReady ? (
          <Suspense fallback={<div className="min-w-0 flex-1" aria-hidden="true" />}>
            <ActionHistoryBar history={actionHistory} className="mb-0 min-w-0 flex-1" />
          </Suspense>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden="true" />
        )}
        <FilterMenu
          label={t('filters') || 'Filters'}
          activeCount={activeFilters}
          sections={productFilterSections}
          onClear={clearAllFilters}
          onOpenChange={setIsProductFilterMenuOpen}
          compact
        />
      </div>

      {refreshingProducts && !loading ? (
        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          {tr('products_refreshing', 'Refreshing products...')}
        </div>
      ) : null}

      <div className="sticky top-2 z-30 mb-2 -mx-1 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/95 shadow-sm backdrop-blur dark:border-blue-700 dark:bg-blue-900/40 sm:mx-0 sm:rounded-xl">
        <div className="px-2 py-2">
          <div className="grid min-w-0 grid-cols-[minmax(5.7rem,1fr)_3.35rem_minmax(6.9rem,9.4rem)] items-center gap-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/85">
            <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {productSummaryLabel}
            </span>
            <AppSelect
              value={productSafePageSize}
              options={PAGE_SIZE_OPTIONS.map((size) => ({ value: size, label: size }))}
              onChange={(nextValue) => {
                setProductPageSize(Number(nextValue) || PAGE_SIZE_OPTIONS[0])
                setProductPage(1)
              }}
              ariaLabel={`${t('per_page') || 'per page'} ${productSafePageSize}`}
              className="h-7 w-full min-w-0"
              buttonClassName="h-7 w-full rounded-full px-2 py-0 pl-2 pr-1.5 text-[10px] font-semibold shadow-none"
              menuClassName="min-w-[4rem]"
              optionClassName="text-xs"
            />
            <div className="inline-flex h-7 min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
              <button
                type="button"
                className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={productSafePage <= 1}
                onClick={() => setProductPage(productSafePage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <input
                type="text"
                inputMode="numeric"
                aria-label={t('page') || 'Page'}
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-center text-[10px] font-semibold text-slate-700 outline-none dark:text-slate-100"
                value={productPageDraft}
                onChange={(event) => setProductPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                onBlur={commitProductPageDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                      event.preventDefault()
                      commitProductPageDraft()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      setProductPageDraft(String(productSafePage))
                      event.currentTarget.blur()
                  }
                }}
              />
              <span className="pr-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                / {productTotalPages}
              </span>
              <button
                type="button"
                className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={productSafePage >= productTotalPages}
                onClick={() => setProductPage(productSafePage + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className={`mt-1.5 grid items-center gap-1.5 ${hasSelected ? 'grid-cols-[minmax(0,1fr)_4.9rem]' : 'grid-cols-1'}`}>
              <label className="inline-flex min-w-0 items-center gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded"
                  checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
                  ref={mobileSelectAllRef}
                  onChange={(event) => toggleSelectAll(event.target.checked)}
                />
                <span className="truncate whitespace-nowrap">
                  {hasSelected
                    ? productSelectedLabel
                    : productSelectAllLabel}
                </span>
              </label>
              {hasSelected ? (
                <button
                  type="button"
                  disabled={bulkActionBusy}
                  onClick={handleBulkDelete}
                  className="inline-flex h-8 min-w-[4.8rem] shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border border-rose-200 bg-white px-2.5 text-[10px] font-semibold text-rose-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:bg-slate-950 dark:text-rose-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/20"
                >
                  {productChipLabels.delete}
                </button>
              ) : null}
          </div>
        </div>
        {hasSelected ? (
          <div className="border-t border-blue-100/80 px-3 py-2.5 dark:border-blue-900/40">
            <div className="grid grid-cols-5 gap-1">
              {[
                { id: 'info', label: productChipLabels.info },
                { id: 'pricing', label: productChipLabels.pricing },
                { id: 'stock', label: productChipLabels.stock },
                { id: 'branch', label: productChipLabels.branch },
                { id: 'out', label: productChipLabels.out, onClick: handleBulkOutOfStock },
              ].map(opt => (
                <button key={opt.id}
                  disabled={bulkActionBusy || !hasSelected}
                  onClick={() => {
                    if (typeof opt.onClick === 'function') {
                      opt.onClick()
                      return
                    }
                    setBulkEditMode(bulkEditMode === opt.id ? null : opt.id as BulkEditMode); setBulkEditOpen(true); setBulkEditForm({})
                  }}
                  className={`inline-flex h-8 min-w-0 items-center justify-center overflow-hidden rounded-xl border px-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${bulkEditMode===opt.id ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:hover:border-slate-500 dark:hover:bg-slate-900'}`}>
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Expanded edit panel */}
        {hasSelected && bulkEditMode === 'info' && (
          <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
            <p className="text-xs text-gray-500 mb-2">Update basic info for <strong>{selectedVisibleCount}</strong> products</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div><label className="text-xs text-gray-500 block mb-1">Category</label>
                <AppSelect
                  value={bulkEditForm.category || ''}
                  onChange={(nextValue) => setBulkEditForm(f => ({ ...f, category: nextValue }))}
                  ariaLabel="Category"
                  className="w-full"
                  buttonClassName="min-h-8 w-full rounded-xl py-1 text-xs"
                  optionClassName="text-xs"
                  options={[
                    { value: '', label: 'Keep current' },
                    ...categories
                      .map(c => String(c.name || '').trim())
                      .filter(Boolean)
                      .map(name => ({ value: name, label: name })),
                  ]}
                />
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Unit</label>
                <AppSelect
                  value={bulkEditForm.unit || ''}
                  onChange={(nextValue) => setBulkEditForm(f => ({ ...f, unit: nextValue }))}
                  ariaLabel="Unit"
                  className="w-full"
                  buttonClassName="min-h-8 w-full rounded-xl py-1 text-xs"
                  optionClassName="text-xs"
                  options={[
                    { value: '', label: 'Keep current' },
                    ...units
                      .map(u => String(u.name || '').trim())
                      .filter(Boolean)
                      .map(name => ({ value: name, label: name })),
                  ]}
                />
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Supplier</label>
                <input className="input text-xs py-1" value={bulkEditForm.supplier||''} onChange={e=>setBulkEditForm(f=>({...f,supplier:e.target.value}))} placeholder="Leave blank to keep" />
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">{t('brand')||'Brand'}</label>
                <input className="input text-xs py-1" value={bulkEditForm.brand||''} onChange={e=>setBulkEditForm(f=>({...f,brand:e.target.value}))} placeholder="Leave blank to keep" />
              </div>
              <div className="flex gap-2 items-center mt-1">
                <label className="text-xs text-gray-500">Low Stock Threshold</label>
                <input className="input text-xs py-1 w-20" type="number" min="0" value={bulkEditForm.low_stock_threshold??''} onChange={e=>setBulkEditForm(f=>({...f,low_stock_threshold:e.target.value}))} placeholder="Keep" />
              </div>
            </div>
            <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={async () => {
              const { buildProductBulkInfoUpdates } = await loadProductWriteHelpers()
              await runBulkProductUpdates(buildProductBulkInfoUpdates(bulkEditForm))
            }}>Apply to {selectedVisibleCount} products</button>
          </div>
        )}

            {hasSelected && bulkEditMode === 'pricing' && (
              <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
                <p className="text-xs text-gray-500 mb-2">Update pricing for <strong>{selectedVisibleCount}</strong> products</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs text-gray-500 block mb-1">Selling Price (USD)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Selling Price (KHR)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_khr??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_khr:e.target.value}))} placeholder="Leave blank to keep" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Special Price (USD)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.special_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,special_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Special Price (KHR)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.special_price_khr??''} onChange={e=>setBulkEditForm(f=>({...f,special_price_khr:e.target.value}))} placeholder="Leave blank to keep" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Purchase Price (USD)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.purchase_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,purchase_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Purchase Price (KHR)</label>
                    <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.purchase_price_khr??''} onChange={e=>setBulkEditForm(f=>({...f,purchase_price_khr:e.target.value}))} placeholder="Leave blank to keep" /></div>
                </div>
                <p className="text-xs text-gray-400 mt-1">KHR prices will auto-calculate at current exchange rate</p>
                <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={async () => {
                  const { buildProductBulkPricingUpdates } = await loadProductWriteHelpers()
                  await runBulkProductUpdates(buildProductBulkPricingUpdates(bulkEditForm))
                }}>Apply to {selectedVisibleCount} products</button>
              </div>
            )}

          {hasSelected && bulkEditMode === 'stock' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Adjust stock for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="flex gap-3 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">Quantity</label>
                  <input className="input text-xs py-1 w-24" type="number" min="0" value={bulkEditForm.qty??1} onChange={e=>setBulkEditForm(f=>({...f,qty:e.target.value}))} /></div>
                <div><label className="text-xs text-gray-500 block mb-1">Action</label>
                  <div className="flex gap-1">
                    {[['add', t('add') || 'Add'],['remove', t('remove') || 'Remove'],['set', `= ${t('set')||'Set'}`]].map(([v,l])=>(
                    <button key={v} onClick={()=>setBulkEditForm(f=>({...f,action:v}))} className={`text-xs py-1.5 px-2.5 rounded-lg border font-medium ${(bulkEditForm.action||'add')===v?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-zinc-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-zinc-600'}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={handleBulkAddStock}>Apply to {selectedVisibleCount} products</button>
            </div>
          )}

          {hasSelected && bulkEditMode === 'branch' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Move stock to a branch for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">Target Branch</label>
                  <AppSelect
                    value={bulkEditForm.branchId || ''}
                    onChange={(nextValue) => setBulkEditForm(f => ({ ...f, branchId: nextValue }))}
                    ariaLabel="Target Branch"
                    className="w-full min-w-[10rem]"
                    buttonClassName="min-h-8 w-full rounded-xl py-1 text-xs"
                    optionClassName="text-xs"
                    options={[
                      { value: '', label: 'Select branch' },
                      ...branches
                        .filter(b => b.id != null && b.name)
                        .map(b => ({ value: b.id as string | number, label: String(b.name) })),
                    ]}
                  />
                </div>
                <button disabled={bulkActionBusy} className="btn-primary px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { if (bulkEditForm.branchId) { handleBulkChangeBranch(bulkEditForm.branchId) } else notify('Select a branch first','error') }}>Move Stock</button>
              </div>
            </div>
          )}
      </div>
      <div className={`mb-2 flex min-h-10 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/85 p-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900/75 ${initialOptions.length ? '' : 'invisible'}`}>
          <button
            type="button"
            className={`min-h-8 shrink-0 rounded-lg px-2.5 font-semibold ${initialFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            onClick={() => setInitialFilter('all')}
          >
            {t('all') || 'All'}
          </button>
          {initialOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`min-h-8 shrink-0 rounded-lg px-2 font-semibold ${initialFilter === item.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
              onClick={() => setInitialFilter(initialFilter === item.key ? 'all' : item.key)}
              title={`${item.label} (${item.count})`}
            >
              <span>{item.label}</span>
              <span className="ml-1 text-[10px] opacity-65">{item.count}</span>
            </button>
          ))}
        </div>

      <ProductsListSurface
        allVisibleProducts={allVisibleProducts}
        collapsedProductGroups={collapsedProductGroups}
        collapsedProductSections={collapsedProductSections}
        desktopSelectAllRef={desktopSelectAllRef}
        getGroupSummaryParts={getGroupSummaryParts}
        initialDesktopRevealReady={loadedOnceRef.current || !loading}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        loading={loading}
        productSections={productSections}
        productTotal={productTotal}
        refreshingProducts={refreshingProducts}
        renderDesktopProductRow={renderDesktopProductRow}
        renderMobileProductCard={renderMobileProductCard}
        selectedVisibleCount={selectedVisibleCount}
        t={t}
        toggleProductGroup={toggleProductGroup}
        toggleProductSection={toggleProductSection}
        toggleSelectAll={toggleSelectAll}
        toggleSelectionScope={toggleSelectionScope}
        tr={tr}
        visibleIds={visibleIds}
        visibleProducts={visibleProducts}
      />

      {/* Product detail modal */}
      {detailProduct && (
        <Suspense fallback={null}>
          <ProductDetailModal
            p={{
              ...detailProduct,
              name: String(detailProduct.name || ''),
              stock_quantity: Number(detailProduct.stock_quantity || 0),
              selling_price_usd: Number(detailProduct.selling_price_usd || 0),
              image_path: detailProduct.image_path || undefined,
            }}
            catMap={catMap}
            unitMap={unitMap}
            brandColorMap={brandColorMap}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
            t={t}
            onEdit={()=>{setDetailProduct(null);openProductFormTab(detailProduct, 'basic')}}
            onAddVariant={!detailProduct.parent_id ? () => { setVariantModal(detailProduct); setDetailProduct(null) } : undefined}
            onDiscount={() => { setDetailProduct(null); openProductFormTab(detailProduct, 'pricing') }}
            onAdjustStock={() => { setDetailProduct(null); openProductFormTab(detailProduct, 'stock') }}
            onDelete={()=>handleDelete(detailProduct)}
            onClose={()=>setDetailProduct(null)}
            onImageClick={(src, gallery, startIndex = 0) => {
              const sourceGallery = buildProductLightboxGalleryInput(src, gallery)
              openLightbox(sourceGallery, startIndex, String(detailProduct?.name || ''))
            }}
          />
        </Suspense>
      )}

      {lightbox && lightbox.images?.length ? (
        <Suspense fallback={null}>
          <ImageGalleryLightbox
            open={!!(lightbox && lightbox.images?.length)}
            title={lightbox?.title || detailProduct?.name || t('products')}
            images={lightbox?.images || []}
            index={lightbox?.index || 0}
            onClose={() => setLightbox(null)}
            onIndexChange={(index) => setLightbox((curr) => toLightboxState(updateProductLightboxIndex(curr, index), curr))}
            labels={{
              prev: t('prev') || 'Prev',
              next: t('next') || 'Next',
              imageCount: '{current}/{total}',
              dotsLabel: 'Image {current} of {total}',
            }}
          />
        </Suspense>
      ) : null}

      {bulkAddModal && (
        <Suspense fallback={null}>
          <BulkAddStockModal
            productIds={bulkAddModal.ids}
            products={products.map((product) => ({
              ...product,
              id: product.id ?? 0,
              name: String(product.name || ''),
              purchase_price_usd: Number(product.purchase_price_usd || 0),
              purchase_price_khr: Number(product.purchase_price_khr || 0),
            }))}
            branches={branchOptions}
            user={user}
            onClose={() => setBulkAddModal(null)}
            onDone={async ({ quantity, branchId, updatedIds = [], failedIds = [], failed = 0, done = 0 }: BulkAddStockResult) => {
              const numericQuantity = Number(quantity || 0)
              const successfulIds = normalizePositiveProductIds(updatedIds)
              const restoredSnapshots = (bulkAddModal?.snapshots || []).filter((snapshot) => successfulIds.includes(Number(snapshot?.id || 0)))
              setBulkAddModal(null)
              setSelectedIds(new Set(normalizePositiveProductIds(failedIds)))
              if (done > 0 && restoredSnapshots.length && numericQuantity > 0) {
                actionHistory.pushAction({
                  label: `Add stock to ${done} product${done === 1 ? '' : 's'}`,
                  undo: () => restoreProductSnapshots(restoredSnapshots, 'Undo bulk add stock'),
                  redo: () => addStockToProducts(successfulIds, numericQuantity, branchId, 'Redo bulk add stock'),
                })
              }
              notify(
                failed
                  ? `Added stock to ${done} product(s), ${failed} failed`
                  : `Added stock to ${done} product${done === 1 ? '' : 's'}`,
                failed ? 'warning' : 'success',
              )
            }}
            t={t}
          />
        </Suspense>
      )}
      {modal==='form' && (
        <Suspense fallback={null}>
          <ProductForm
            product={toModalProduct(selected)}
            categories={categoryOptions}
            units={unitOptions}
            branches={branchOptions}
            brandOptions={brandOptions}
            groupCandidates={products.map((product) => ({
              id: product.id,
              name: String(product.name || ''),
              parent_id: product.parent_id || null,
            }))}
            initialTab={formInitialTab}
            onSave={(payload) => handleSaveWithGallery((payload || {}) as unknown as ProductRecord)}
            onClose={()=>{setModal(null);setSelected(null);setFormInitialTab('basic')}}
            t={t}
            usdSymbol={usdSymbol}
            khrSymbol={khrSymbol}
            exchangeRate={exchangeRate}
            user={user}
          />
        </Suspense>
      )}
      {variantModal && (
        <Suspense fallback={null}>
          <VariantFormModal
            parent={toVariantParentProduct(variantModal)!}
            units={unitOptions}
            branches={branchOptions}
            user={user}
            onClose={()=>setVariantModal(null)}
            onDone={handleVariantDone}
            t={t}
            usdSymbol={usdSymbol}
          />
        </Suspense>
      )}
      {modal==='cats' && (
        <Suspense fallback={null}>
          <ManageCategoriesModal onClose={()=>{setModal(null);load()}} onReviewSelection={handleLookupReviewSelection} t={t} />
        </Suspense>
      )}
      {modal==='brands' && (
        <Suspense fallback={null}>
          <ManageBrandsModal onClose={()=>setModal(null)} onDone={load} onReviewSelection={handleLookupReviewSelection} user={user} t={t} />
        </Suspense>
      )}
      {modal==='units' && (
        <Suspense fallback={null}>
          <ManageUnitsModal onClose={()=>{setModal(null);load()}} onReviewSelection={handleLookupReviewSelection} t={t} />
        </Suspense>
      )}
      {modal==='bulk' && (
        <Suspense fallback={null}>
          <BulkImportModal onClose={()=>setModal(null)} onDone={() => { void load() }} t={t} />
        </Suspense>
      )}
    </div>
  )
}

