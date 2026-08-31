// Products
// Main Products page; all sub-modals are imported from sibling files.

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import PackageSearch from 'lucide-react/dist/esm/icons/package-search.js'
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import Modal from '../shared/Modal'
import AlphaIndexRail from '../shared/AlphaIndexRail'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import FilterMenu from '../shared/FilterMenu'
import PortalMenu from '../shared/PortalMenu'
import AppSelect from '../shared/AppSelect'
import PageSizeSelect from '../shared/PageSizeSelect'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import PaginationControls, { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import { ProductImg, ProductImagePlaceholder } from './shared/primitives'
import ProductsListSurface, { ROW_TEXT_GUTTER } from './surfaces/ProductsListSurface'
import MergeDuplicatesReviewModal from './MergeDuplicatesReviewModal'
import type { MergeDuplicatesPreviewGroup } from './MergeDuplicatesReviewModal'
import ZeroQuantityCleanupModal from './ZeroQuantityCleanupModal'
import type { ZeroQuantityCandidate } from './ZeroQuantityCleanupModal'
import WireImagesReviewModal from './WireImagesReviewModal'
import type { WireImageChange, WireImagesPreview } from './WireImagesReviewModal'
import DeleteConfirmModal from './DeleteConfirmModal'
import { summarizeDeleteImpact } from '../../utils/deleteImpactSummary'
import ProductsHeaderActions from './surfaces/HeaderActions'
import {
  ProductBatchPreview,
  ProductDetailsCell,
  ProductDiscountBadge,
} from './surfaces/ProductRowParts'
import { useIsPageActive } from '../shared/pageActivity'
import { buildProductCategorySections } from '../../utils/productGrouping.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId, resolveCreatedHistorySnapshot } from '../../utils/historyHelpers.ts'
import { createProductHistoryRequestId, orderProductRestoreSnapshots } from './history/productHistoryHelpers.ts'
import { toggleIdSet } from '../../utils/recordFilters.ts'
import { aggregateInitialOptions, compareInitialKeys } from '../../utils/initials.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { createLongPressHandlers, createLongPressState, consumeLongPressClick } from '../../utils/longPress.ts'
import type { LongPressState } from '../../utils/longPress.ts'
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
  buildGroupThumbnailState, buildProductThumbnailState,
  normalizeProductGallery,
  updateProductLightboxIndex,
} from './helpers/productGalleryHelpers.ts'
import {
  buildProductSearchTerms,
  filterProductsForPage,
  getProductBranchQuantity,
} from './helpers/productFilterHelpers.ts'
import { parseProductSearchStockToken } from '../../utils/searchTerms.ts'
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
} from './helpers/productDisplayHelpers.ts'
import {
  buildProductExportScopes,
  buildProductFilterSections,
  countActiveProductFilters,
  isProductCategorySelected,
  toggleProductCategoryValues,
} from './helpers/productMenuHelpers.ts'
import { buildProductSupplierOptions } from './helpers/productSupplierOptions.ts'
import { buildHierarchicalCategoryFilterOptions } from '../shared/CategoryFilterOptions.tsx'
import { buildAvailabilityFilterSection } from '../shared/AvailabilityFilterOptions.tsx'
import { buildSearchModeFilterSection } from '../shared/SearchModeFilterOptions.tsx'
import { buildAutoMergedFilterSection } from './AutoMergedFilterOptions.tsx'
import { RESTORE_WORK_EVENT, consumePendingRestore, markRestoreHandled, minimizeWork } from '../../utils/minimizedWork.ts'
import { buildIssuesFilterSection } from '../shared/IssuesFilterOptions.tsx'
import { buildPromotionsFilterSection } from '../shared/PromotionsFilterOptions.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import type { BulkDeleteJobStatus } from '../../api/productWriteTransport.ts'
import { getPossiblySameProducts, mergePossiblySameProducts, dismissProductDuplicateCluster } from '../../api/productWriteTransport.ts'
import { buildExactDuplicateIndex, extractDuplicateClusters, findRowDuplicateInfo, type ExactDuplicateInfo } from '../../utils/exactDuplicateProducts.ts'
import DuplicateResolverControl from './DuplicateResolverControl.tsx'

const ManageCategoriesModal = lazyRetry(() => import('./lookups/ManageCategoriesModal'), 'products-manage-categories-modal')
// Part 241: the restricted image-only view, split out so the wrapper
// default export below never has to pull in the full ~3400-line editor's
// bundle for a user who will only ever see this lightweight surface.
const ProductsImageOnlyView = lazyRetry(() => import('./ProductsImageOnlyView.tsx'), 'products-image-only-view')
const StockChangeSection = lazyRetry(() => import('./StockChangeSection.tsx'), 'products-stock-change-section')
const ProductDuplicatesTab = lazyRetry(() => import('./ProductDuplicatesTab.tsx'), 'products-duplicates-tab')
const ManageBrandsModal = lazyRetry(() => import('./lookups/ManageBrandsModal'), 'products-manage-brands-modal')
const ManageUnitsModal = lazyRetry(() => import('./lookups/ManageUnitsModal'), 'products-manage-units-modal')
const ImportModeWizard = lazyRetry(() => import('./import/ImportModeWizard'), 'products-bulk-import-wizard')
const BulkAddStockModal = lazyRetry(() => import('./forms/BulkAddStockModal'), 'products-bulk-add-stock-modal')
// The Add button's merged "Add Stock" flow (user, Aug 31: "the fast stockin
// can also do one by one... can be merged into one Add stock function") --
// the shipment receiver covers a whole delivery AND a single product.
const FastStockInModal = lazyRetry(() => import('../inventory/FastStockInModal'), 'products-fast-stock-in-modal')
const VariantFormModal = lazyRetry(() => import('./forms/VariantFormModal'), 'products-variant-form-modal')
const ProductForm = lazyRetry(() => import('./forms/ProductForm'), 'products-product-form')
const ProductDetailModal = lazyRetry(() => import('./surfaces/ProductDetailModal'), 'products-product-detail-modal')
// Reused as-is from Inventory's own batches surface (see ManageBatchesModal.tsx)
// rather than duplicated -- the "click to view/manage batches" affordance the
// Products detail modal now opens onto is the same live-fetched, per-branch
// batch editor Inventory already ships, not a second copy of it.
const ManageBatchesModal = lazyRetry(() => import('../inventory/ManageBatchesModal'), 'products-manage-batches-modal')
const ImageGalleryLightbox = lazyRetry(() => import('../shared/ImageGalleryLightbox'), 'products-image-gallery-lightbox')
const ExportFieldsModal = lazyRetry(() => import('./ExportFieldsModal'), 'products-export-fields-modal')
const ActionHistoryBar = lazyRetry(() => import('../shared/ActionHistoryBar'), 'products-action-history-bar')

type EntityId = string | number
type Loader<T = unknown> = () => Promise<T>
type ProductWriteHelpers = typeof import('./helpers/productWriteHelpers.ts')
type NotificationTone = 'error' | 'info' | 'success' | 'warning' | string
type SearchMode = 'AND' | 'OR'
type ProductSortDirection = 'asc' | 'desc' | 'name_asc' | 'name_desc'
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
  // Present on rows produced by mergeSameDetailRows (utils/productGrouping.ts)
  // when 2+ raw product rows -- identical except for branch -- collapsed
  // into this one display row. Lists every real underlying product id so
  // selection/bulk actions on the merged row still act on all of them.
  __mergedProductIds?: EntityId[]
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

// `boolean` is in the index signature for the relative price-adjustment
// controls below (which fields to move, whether to skip unpriced products) --
// they are checkboxes, and coercing them to 'true'/'false' strings here
// would just move the parsing somewhere less obvious.
type BulkEditForm = Record<string, string | number | boolean | undefined> & {
  action?: string
  branchId?: EntityId | ''
  brand?: string
  category?: string
  low_stock_threshold?: string | number
  cost_price_khr?: string | number
  cost_price_usd?: string | number
  purchase_price_khr?: string | number
  purchase_price_usd?: string | number
  qty?: string | number
  selling_price_khr?: string | number
  selling_price_usd?: string | number
  special_price_khr?: string | number
  special_price_usd?: string | number
  supplier?: string
  unit?: string
  // Relative price adjustment (see runBulkProductPriceAdjustment).
  adjust_direction?: string
  adjust_amount?: string | number
  adjust_currency?: string
  adjust_selling?: boolean
  adjust_special?: boolean
  adjust_cost?: boolean
  adjust_skip_zero?: boolean
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
  pageSize?: number
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
  deleteProduct: (id: EntityId, reason?: string) => Promise<ProductApiResponse | undefined>
  startBulkDeleteJob: (ids: EntityId[], reason: string) => Promise<{ jobId: string; totalCount: number }>
  getBulkDeleteJobStatus: (jobId: string) => Promise<BulkDeleteJobStatus>
  cancelBulkDeleteJob: (jobId: string) => Promise<void>
  getBranches: () => Promise<BranchRecord[]>
  getCategories: () => Promise<LookupRecord[]>
  getProductFilters: (query?: Record<string, unknown>) => Promise<Partial<ProductFilterMeta> | undefined>
  getProductsByIds: (ids: number[], options?: Record<string, unknown>) => Promise<ProductRecord[]>
  getUnits: () => Promise<LookupRecord[]>
  mergeDuplicates: () => Promise<ProductApiResponse | undefined>
  previewMergeDuplicates: () => Promise<ProductApiResponse | undefined>
  previewZeroQuantityCandidates: (thresholdDays?: number) => Promise<ProductApiResponse | undefined>
  deleteZeroQuantityProducts: (ids: number[]) => Promise<ProductApiResponse | undefined>
  previewWireImages: () => Promise<ProductApiResponse | undefined>
  wireImages: (changes: WireImageChange[]) => Promise<ProductApiResponse | undefined>
  unwireImages: (productIds: number[]) => Promise<ProductApiResponse | undefined>
  searchProducts: (query: Record<string, unknown>) => Promise<ProductSearchResponse | ProductRecord[] | undefined>
  transferStock: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  updateProduct: (id: EntityId, payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
  uploadProductImage: (payload: Record<string, unknown>) => Promise<ProductApiResponse | undefined>
}

type ProductsAppContext = {
  // Per-action gate (utils/permissionActions.ts) -- the same table the
  // admin permission editor renders, so a button's visibility here always
  // matches what an admin was shown when they granted the tier.
  can: (permissionKey: string, actionKey: string) => boolean
  exchangeRate: number
  fmtKHR: (value: unknown) => string
  fmtUSD: (value: unknown) => string
  hasPermission: (key: string) => boolean
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
  rows: ProductRecord[]
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
  deleteProduct: async (id, reason) => toProductApiResponse(await (await loadProductWriteModule()).deleteProduct(id, reason)),
  startBulkDeleteJob: async (ids, reason) => (await loadProductWriteModule()).startBulkDeleteJob(ids as Array<string | number>, reason),
  getBulkDeleteJobStatus: async (jobId) => (await loadProductWriteModule()).getBulkDeleteJobStatus(jobId),
  cancelBulkDeleteJob: async (jobId) => { await (await loadProductWriteModule()).cancelBulkDeleteJob(jobId) },
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
  mergeDuplicates: async () => toProductApiResponse(await (await loadProductWriteModule()).mergeDuplicateProducts()),
  previewMergeDuplicates: async () => toProductApiResponse(await (await loadProductWriteModule()).previewMergeDuplicateProducts()),
  previewZeroQuantityCandidates: async (thresholdDays) => toProductApiResponse(await (await loadProductWriteModule()).previewZeroQuantityCandidates(thresholdDays)),
  deleteZeroQuantityProducts: async (ids) => toProductApiResponse(await (await loadProductWriteModule()).deleteZeroQuantityProducts(ids)),
  previewWireImages: async () => toProductApiResponse(await (await loadProductWriteModule()).previewWireProductImages()),
  wireImages: async (changes) => toProductApiResponse(await (await loadProductWriteModule()).wireProductImages(changes)),
  unwireImages: async (productIds) => toProductApiResponse(await (await loadProductWriteModule()).unwireProductImages(productIds)),
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
  // `.page-scroll` (see main.css) is the actual scrolling element for
  // every page in this app -- the page body is `flex:1` with its own
  // `overflow-y-auto`, not the window -- so scrolling `window` here was a
  // latent bug: it would silently do nothing on any layout where the
  // window itself doesn't scroll (which is every page). Never surfaced
  // before because this function's only caller (jumpToLetter) was wired
  // up but never actually rendered anywhere until this session. Walk up
  // to the real scroll container and adjust its scrollTop directly;
  // window.scrollTo kept only as a last-resort fallback if no such
  // ancestor is found.
  const scrollParent = node.closest('.page-scroll') as HTMLElement | null
  if (scrollParent) {
    const delta = node.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - offset
    scrollParent.scrollTo({ top: Math.max(0, scrollParent.scrollTop + delta), behavior: 'smooth' })
    return
  }
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


// Split (Part 241) into a thin wrapper + the pre-existing full editor, kept
// under its old name below and NOT exported directly anymore -- this is a
// routing decision only, nothing about ProductsFullEditor's own body
// changed. Safer than threading an image-only conditional through this
// component's ~3400-line hook chain (every hook here assumes full product
// shape/state); a completely separate lightweight view can't accidentally
// break on a field this restricted role never receives.
export default function Products() {
  const { hasPermission } = useProductsApp()
  // Mirrors AppContext.tsx's canAccessPage()/the backend's isImageOnlyUser()
  // shape: only the user whose ONE route into this page is
  // 'products_image_only' gets the restricted view. Anyone with real
  // `products` access renders the full editor exactly as before, even if
  // 'products_image_only' also happens to be set on their role --
  // `hasPermission('products')` covers both the 'full' and 'review' tiers
  // here (the tier value itself only matters once inside the full editor).
  const isImageOnlyUser = !hasPermission('products') && hasPermission('products_image_only')
  if (isImageOnlyUser) {
    return (
      <Suspense fallback={<div className="page-scroll flex flex-1 items-center justify-center p-8 text-gray-400">...</div>}>
        <ProductsImageOnlyView />
      </Suspense>
    )
  }
  return <ProductsFullEditor />
}

function ProductsFullEditor() {
  const { can, t, user, settings, notify, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useProductsApp()
  // Per-action gates for this page's toolbar. Resolved once here rather
  // than inline in the JSX so the header block below stays readable and
  // every control's rule is visible in one place. See
  // utils/permissionActions.ts for what each action maps to server-side.
  const canAddProduct = can('products', 'add')
  const canImportProducts = can('products', 'import')
  const canExportProducts = can('products', 'export')
  const canManageLookups = can('products', 'manage_lookups')
  const canMergeDuplicates = can('products', 'merge_duplicates')
  const canZeroQuantityCleanup = can('products', 'zero_qty_cleanup')
  // Same action the per-product image uploader is gated on: wiring photos
  // in bulk is the same authority as attaching one by hand, just applied
  // across the catalog. The backend gates /wire-images on exactly this
  // (getActionTier(user, 'products', 'image')), so hiding the entry for
  // anyone else keeps the menu honest instead of offering a 403.
  const canWireImages = can('products', 'image')
  // The Add menu's stock flows write through the Inventory adjust/receive
  // kernels, so they gate on the SAME action the Branches-page adjust and
  // fast stock-in check -- not on products:add.
  const canAdjustInventoryStock = can('inventory', 'adjust')
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
  // Comma-joined multi-value string (matches catFilter/brandFilter/
  // supplierFilter's shape), not a plain 'all'/single-value string --
  // several issue keys can be selected at once, OR'd together. See
  // IssuesFilterOptions.tsx and searchMatch.ts's ISSUE_STATE_KEYS.
  const [issueFilter, setIssueFilter] = useState('all')
  // G1 promo filter: '' /'all' | 'promoted' | 'discounted' | 'rules' | 'rule:<id>'
  const [promoFilter, setPromoFilter] = useState('all')
  // 9.2: 'all' | 'auto' -- server-side facet over auto_merged_count.
  const [mergedFilter, setMergedFilter] = useState('all')
  const [promotionRules, setPromotionRules] = useState<PromotionRule[]>([])
  const [createdDateFrom, setCreatedDateFrom] = useState('')
  const [createdDateTo, setCreatedDateTo] = useState('')
  // Y15: the page is chip-sectioned like Promotions -- a switcher in the
  // header flips between the product listing and the Stock Changes ledger,
  // which used to be a folded card at the bottom of the same scroll.
  const [activeProductSection, setActiveProductSection] = useState<'products' | 'stock_changes' | 'duplicates'>('products')
  // The Add menu's merged Add Stock flow (the shipment receiver). Add New
  // Product keeps the existing `modal === 'form'` path.
  const [addStockOpen, setAddStockOpen] = useState(false)
  // Dashboard stock-card drills land HERE now (the Branches hub's redundant
  // Products slice was removed, Aug 31): BranchesHubPage forwards the old
  // inventory-focus payload as this key, carrying the stock filter.
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem('bos:dashboard:products-focus')
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as { stockFilter?: unknown }
      const stockState = String(payload?.stockFilter || '')
      if (stockState === 'low' || stockState === 'out' || stockState === 'in_stock') {
        setStockFilter(stockState)
      }
      setActiveProductSection('products')
    } catch {
      // Malformed handoff -- keep the current view state.
    } finally {
      window.sessionStorage.removeItem('bos:dashboard:products-focus')
    }
  }, [isActive])
  const [productSortDirection, setProductSortDirection] = useState<ProductSortDirection>('name_asc')
  const [search,       setSearch]       = useState('')
  // AND/OR toggle restored (Aug 20 2026), reachable from inside the Filter
  // menu now instead of as a standalone button (see
  // buildSearchModeFilterSection / productFilterSections below). AND
  // stays the default.
  const [searchMode, setSearchMode] = useState<SearchMode>('AND')
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [productTotal, setProductTotal] = useState(0)
  const [productFilterMeta, setProductFilterMeta] = useState<ProductFilterMeta>({ brands: [], categories: [], suppliers: [], initials: [] })
  // Horizontal A-Z filter UI removed (Aug 19 2026) -- initialFilter locked
  // to 'all' (no letter narrows the list anymore). Left in place rather
  // than ripped out: it's still read by the backend query builder,
  // countActiveProductFilters, and several dependency arrays below, same
  // "keep the plumbing, drop the setter" treatment as searchMode in Part
  // 203 -- removing it fully would touch far more surface for the same
  // end result (no active initial-letter filter, ever).
  const [initialFilter] = useState('all')
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set())
  const [bulkEditOpen,   setBulkEditOpen]   = useState(false)
  const [exportFieldsOpen, setExportFieldsOpen] = useState(false)
  // Which scope (Selected/Filtered/Full) the export panel currently has
  // picked -- reset to the richest available scope each time the panel
  // opens (see the onExport handler below), same default-behavior-
  // preserving intent as ExportFieldsModal's own "every field group
  // checked by default".
  const [exportScopeId, setExportScopeId] = useState<string>('visible')
  const [bulkEditMode,   setBulkEditMode]   = useState<BulkEditMode>(null)
  const [bulkEditForm,   setBulkEditForm]   = useState<BulkEditForm>({})
  const [catFilter,    setCatFilter]    = useState<Set<string>>(new Set())
  const [brandFilter,  setBrandFilter]  = useState<Set<string>>(new Set())
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set())
  // Exact-match unit filter -- not exposed as its own dropdown UI (no ask
  // for one), only ever set programmatically by handleLookupReviewSelection
  // ("which products use this unit", from ManageUnitsModal). Replaces the
  // old behavior of stuffing the unit's name into the free-text `search`
  // box: now that PRODUCT_SEARCH_COLUMNS (cloudflare/src/lib/searchMatch.ts)
  // no longer includes 'unit' (search narrowed to name/sku/barcode per an
  // explicit request), that old approach would have silently emptied the
  // page. Sent to the server as the same `unit` query param
  // buildSearchFilters' generic brand/category/unit/supplier exact-match
  // loop (cloudflare/src/routes/products.ts) already reads.
  const [unitFilter,   setUnitFilter]   = useState<string>('')
  const [modal,        setModal]        = useState<ProductModalMode>(null)
  const [selected,     setSelected]     = useState<ProductRecord | null>(null)
  // 10.2 invariant: this is SET at every open (openProductFormTab and the
  // toolbar Add), never trusted from a previous open. The reported bug --
  // "Edit does not auto-move sections back to Details" -- was this value
  // surviving a save: Adjust Stock set 'stock', both save-success paths
  // closed the modal without resetting it, and the next Add/Edit that
  // didn't pass a tab opened on the stale Stock section.
  const [formInitialTab, setFormInitialTab] = useState<ProductFormTab>('basic')
  // F3 slice 2: a minimized add-product chip restores here -- create mode,
  // slice 1's draft repopulates the form.
  useEffect(() => {
    const open = () => { setSelected(null); setFormInitialTab('basic'); setModal('form') }
    if (consumePendingRestore('add_product')) open()
    const onRestore = (event: Event) => {
      if ((event as CustomEvent).detail?.kind !== 'add_product') return
      markRestoreHandled('add_product')
      open()
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [detailProduct,setDetailProduct]= useState<ProductRecord | null>(null)
  // `toModalProduct(selected)` used to be called inline in the ProductForm
  // JSX below -- a plain function returning a new object literal on every
  // render of Products.tsx, not just when `selected` itself changes. That
  // gave ProductForm's `product` prop a new identity on every background
  // re-render (notification polling, etc.) even while the edit form was
  // open and untouched, which cascaded into ProductForm's initialForm
  // useMemo -> its tab-reset effect -> silently snapping the active tab
  // back to Basic Info every few seconds. Memoizing here keyed on
  // `selected` (which only changes on real user actions -- see the
  // setSelected call sites above, none of them resync against a
  // background-refreshed products list) fixes that at the source.
  const modalProduct = useMemo(() => toModalProduct(selected), [selected])
  const [manageBatchesProduct, setManageBatchesProduct] = useState<ProductRecord | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [refreshingProducts, setRefreshingProducts] = useState(false)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [mergeDuplicatesBusy, setMergeDuplicatesBusy] = useState(false)
  const [mergeDuplicatesReviewOpen, setMergeDuplicatesReviewOpen] = useState(false)
  // Exact-duplicate (same real barcode + same name) flagging for the list
  // rows -- user spec item #3. Single source of truth is the server sweep
  // the Duplicates review tab already uses (see utils/exactDuplicateProducts).
  // dupResolverBusyKey holds the exact-duplicate group key currently merging/
  // dismissing so its row's buttons show a spinner without freezing the rest.
  const [duplicateClusters, setDuplicateClusters] = useState<unknown[]>([])
  const [dupResolverBusyKey, setDupResolverBusyKey] = useState<string | null>(null)
  const [zeroQuantityCleanupOpen, setZeroQuantityCleanupOpen] = useState(false)
  const [zeroQuantityCleanupBusy, setZeroQuantityCleanupBusy] = useState(false)
  const [wireImagesOpen, setWireImagesOpen] = useState(false)
  const [wireImagesBusy, setWireImagesBusy] = useState(false)
  // Pending delete confirmation (single or bulk) -- see DeleteConfirmModal
  // and handleDelete/handleBulkDelete below. `ids` holds whichever row(s)
  // are pending so the confirm button knows which delete to actually run;
  // the impact summary itself is computed lazily from these on open.
  const [pendingDelete, setPendingDelete] = useState<{ ids: EntityId[] } | null>(null)
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false)
  const [variantModal, setVariantModal] = useState<ProductRecord | null>(null)
  // Which group's title three-dot menu (add child row / add image) is
  // currently open, keyed by group.key -- see renderGroupActions below.
  // Aug 19 2026 ask.
  const [collapsedProductSections, setCollapsedProductSections] = useState<Set<string>>(() => new Set())
  const [collapsedProductGroups, setCollapsedProductGroups] = useState<Set<string>>(() => new Set())
  const [isProductFilterMenuOpen, setIsProductFilterMenuOpen] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const [filterMetaReady, setFilterMetaReady] = useState(false)
  const [auxOptionsReady, setAuxOptionsReady] = useState(false)
  const loadedOnceRef = useRef(false)
  const auxOptionsLoadedRef = useRef(false)
  const filterMetaLoadedRef = useRef(false)
  const filterMetaScopeRef = useRef('')
  const loadRequestRef = useRef(0)
  const auxOptionsRequestRef = useRef(0)
  const filterMetaRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const pendingLoadRef = useRef<{ silent: boolean } | null>(null)
  const latestLoadRef = useRef<((silent?: boolean) => Promise<void>) | null>(null)
  const productSaveInFlightRef = useRef(false)
  // A product a person just saved via the edit modal stays visible in the
  // current results even if a background/automatic refresh (a sync
  // broadcast from another tab, or the post-save reload the save flow
  // itself triggers) would otherwise re-fetch the page and find it no
  // longer matches the active filters -- e.g. its category changed to one
  // that isn't currently selected. Cleared only when the person actually
  // changes the search box themselves (see handleSearchInputChange below),
  // matching "stays until I search again" rather than "stays forever" or
  // "disappears on the very next silent refresh."
  const pinnedEditedProductsRef = useRef<Map<number, ProductRecord>>(new Map())
  const productDeleteInFlightRef = useRef(false)
  const bulkActionInFlightRef = useRef(false)
  const initializedCollapsedGroupKeysRef = useRef<Set<string>>(new Set())
  // One long-press timer/start-point slot per visible row, keyed by
  // product id -- see utils/longPress.ts for why this can't just be a
  // useRef *inside* renderDesktopProductRow/renderMobileProductCard
  // (they're called once per row from a .map(), not mounted as their
  // own components). Never explicitly pruned: it only ever holds a
  // handful of small plain objects for currently-rendered rows, and a
  // stale entry for a row that's scrolled out of view is inert (no
  // pending timer) until that row's id is pressed again, at which point
  // it's just reused.
  const longPressStateByRowIdRef = useRef<Map<number, LongPressState>>(new Map())
  const getLongPressState = useCallback((rowId: number): LongPressState => {
    const existing = longPressStateByRowIdRef.current.get(rowId)
    if (existing) return existing
    const created = createLongPressState()
    longPressStateByRowIdRef.current.set(rowId, created)
    return created
  }, [])
  const actionHistory = useActionHistory({ limit: 10, notify, scope: 'products', enabled: historyReady, user })
  const debouncedSearch = useDebouncedValue(search, 180)
  // "Searchable filter for special stock states" (progress.md backlog item
  // #2): a term like `stock:0` or `out of stock` inside the search box is
  // parsed out here and treated as if "Out of stock" had been picked from
  // the Filter menu -- stockFilterOverride only kicks in when the person
  // hasn't already picked a real stockFilter value themselves (dropdown
  // wins if both are set, rather than silently fighting each other).
  // cleanedSearchQuery has the token stripped so it's never sent to the
  // server as literal search text or re-matched against product names by
  // the client-side re-filter below.
  const parsedSearch = useMemo(() => parseProductSearchStockToken(debouncedSearch), [debouncedSearch])
  const cleanedSearchQuery = parsedSearch.cleanedQuery
  const effectiveStockState = stockFilter !== 'all' ? stockFilter : (parsedSearch.hasZeroStockToken ? 'out' : 'all')
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
          query: cleanedSearchQuery,
          searchMode,
          // No searchFields override here (was hard-coded to 'name', which
          // forced the server into a name-only LIKE clause and silently
          // dropped barcode/sku/brand/category/supplier/description/unit
          // matches -- see buildSearchFilters in cloudflare/src/routes/
          // products.ts). Omitting it lets the server do the same
          // multi-field match POS.tsx's query already gets by never
          // setting this param either.
          category: catFilter.size ? [...catFilter].join(',') : '',
          brand: brandFilter.size ? [...brandFilter].join(',') : '',
          supplier: supplierFilter.size ? [...supplierFilter].join(',') : '',
          // Exact-match unit filter -- see unitFilter's own declaration
          // comment for why this exists (the ManageUnitsModal "which
          // products use this unit" review flow no longer piggybacks on
          // free-text search).
          unit: unitFilter || '',
          branchId: branchFilter === 'all' ? '' : branchFilter,
          // Was forcing 'positive' (in-stock + low-stock, excluding
          // out-of-stock) here whenever a branch was selected and the
          // person hadn't actively picked a stock-status filter -- i.e.
          // "no filter" silently became "in-stock/low-stock only" the
          // moment a branch was chosen, even though 'all' is supposed to
          // mean everything. No such override exists for the pageSize/
          // sort/etc params, and Inventory.tsx's equivalent query passes
          // stockFilter straight through -- there's no reason branch
          // selection alone should change what "all" means here.
          stockState: effectiveStockState === 'all' ? '' : effectiveStockState,
          groupState: groupFilter === 'all' ? '' : groupFilter,
          initial: initialFilter === 'all' ? '' : initialFilter,
          // Real server-side "Created" filter -- scopes to products with at
          // least one batch received in this range (product_batches.received_at
          // via an EXISTS join, see buildSearchFilters in cloudflare/src/routes/
          // products.ts), replacing the old client-only year/month pill picker
          // that only re-filtered against product.created_at on the already-
          // fetched page (never sent to the server, never affected total/
          // pagination -- see progress.md's "Created section reworked to filter
          // by batch date" item for the full history).
          batchDateFrom: createdDateFrom || '',
          batchDateTo: createdDateTo || '',
          // "Issues" quick filter -- see buildIssueStateClauses in
          // cloudflare/src/lib/searchMatch.ts. Multi-value, OR'd.
          issueState: issueFilter === 'all' ? '' : issueFilter,
          // G1 promo filter -- server-side, so it holds across pagination.
          promo: promoFilter === 'all' ? '' : promoFilter,
          // 9.2 auto-merged facet -- same server-side contract as promo.
          merged: mergedFilter === 'all' ? '' : mergedFilter,
          sort: productSortDirection === 'asc' ? 'created_asc'
            : productSortDirection === 'name_asc' ? 'name_asc'
            : productSortDirection === 'name_desc' ? 'name_desc'
            : 'created_desc',
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
        const payloadPromotionRules = (productPayloadObject as Record<string, unknown> | null)?.promotion_rules
        if (Array.isArray(payloadPromotionRules)) setPromotionRules(payloadPromotionRules as PromotionRule[])
        const searchProvidedFilterMeta = isObjectRecord(productPayloadObject?.filters)
          || Array.isArray(productPayloadObject?.initials)

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const versionMismatchError = Object.values(result.errors || {}).find(isApiVersionMismatchError)
        if (versionMismatchError) {
          setLoadError(getErrorMessage(versionMismatchError, 'Product API version mismatch'))
          throw versionMismatchError
        }
        if (Array.isArray(prods)) {
          // Re-insert any pinned just-edited products the fresh server
          // page no longer contains (see pinnedEditedProductsRef's own
          // comment) -- keeps the row on screen with its saved data
          // instead of it silently vanishing from an in-progress review
          // pass before the person has searched again.
          if (pinnedEditedProductsRef.current.size) {
            const presentIds = new Set(prods.map((p) => Number(p.id)))
            const missingPinned = Array.from(pinnedEditedProductsRef.current.entries())
              .filter(([id]) => !presentIds.has(id))
              .map(([, snapshot]) => snapshot)
            setProducts(missingPinned.length ? [...prods, ...missingPinned] : prods)
          } else {
            setProducts(prods)
          }
        }
        setProductTotal(Number(productPayloadObject?.total ?? prods.length) || 0)
        // The server clamps pageSize server-side (see routes/products.ts's
        // clampInt(query.pageSize, 20, 1, 100)) and echoes back whatever it
        // actually used. Without reading that back, a custom page size
        // above the server's cap stayed shown in the selector forever even
        // though far fewer items were actually being returned per page --
        // productTotalPages was computed from the stale, too-large number,
        // so paging past the first couple of pages landed on results that
        // didn't match what the footer claimed. Inventory.tsx already does
        // this resync for its equivalent request.
        if (productPayloadObject?.pageSize != null) {
          const echoedPageSize = Number(productPayloadObject.pageSize)
          if (Number.isFinite(echoedPageSize) && echoedPageSize > 0 && echoedPageSize !== Number(productPageSize)) {
            setProductPageSize(echoedPageSize)
          }
        }
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
  }, [branchFilter, brandFilter, catFilter, cleanedSearchQuery, createdDateFrom, createdDateTo, effectiveStockState, groupFilter, initialFilter, issueFilter, mergedFilter, notify, productPage, productPageSize, productSortDirection, promoFilter, searchMode, supplierFilter, t, tr, unitFilter])

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
  const filterMetaScope = useMemo(() => JSON.stringify([
    branchFilter === 'all' ? '' : branchFilter,
    brandFilter.size ? [...brandFilter].sort().join(',') : '',
    catFilter.size ? [...catFilter].sort().join(',') : '',
    supplierFilter.size ? [...supplierFilter].sort().join(',') : '',
    stockFilter === 'all' ? '' : stockFilter,
    groupFilter === 'all' ? '' : groupFilter,
  ]), [branchFilter, brandFilter, catFilter, groupFilter, stockFilter, supplierFilter])
  useEffect(() => {
    if (filterMetaScopeRef.current === filterMetaScope) return
    filterMetaLoadedRef.current = false
    setFilterMetaReady(false)
    invalidateTrackedRequest(filterMetaRequestRef)
  }, [filterMetaScope])
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
    const filterMetaQuery = {
      branchId: branchFilter === 'all' ? '' : branchFilter,
      brand: brandFilter.size ? [...brandFilter].join(',') : '',
      category: catFilter.size ? [...catFilter].join(',') : '',
      supplier: supplierFilter.size ? [...supplierFilter].join(',') : '',
      stockState: stockFilter === 'all' ? '' : stockFilter,
      groupState: groupFilter === 'all' ? '' : groupFilter,
    }
    void withLoaderTimeout(() => productApi.getProductFilters(filterMetaQuery), 'Product filters', PRODUCTS_FILTER_META_TIMEOUT_MS).then((filters) => {
      filterMetaScopeRef.current = filterMetaScope
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
    } else if (['inventory', 'sales', 'returns'].includes(syncChannelName)) {
      // Stock-affecting events from other pages (POS sales, inventory
      // adjustments/transfers, customer/supplier returns) don't change the
      // filter meta (categories/units/branches/suppliers), only per-product
      // stock_quantity/branch_stock -- so just re-fetch the current page
      // silently, skipping the filter-meta invalidation above.
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

      if (selected?.id) {
        pinnedEditedProductsRef.current.set(Number(selected.id), { ...selected, ...data } as ProductRecord)
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

      // The write itself is now confirmed done -- tell the person right
      // away and close the form. Everything below this point (re-fetching
      // the canonical row for the undo/redo snapshot, pinning it in the
      // current view, refreshing the background list) is best-effort
      // enrichment, not part of whether the save succeeded. It used to sit
      // inside this same try block, so a transient failure in any of it
      // (most concretely, fetchProductsByIds racing an unrelated search
      // and getting cancelled -- see getProductsByIds's own comment) fell
      // into this function's catch and told the person their save had
      // failed when it hadn't. Wrapped separately below so that can't
      // happen again.
      const targetProductId = selected ? Number(selected.id || 0) : createdProductId
      notify(selected ? t('product_updated') || 'Product updated' : t('product_created') || 'Product created')
      setModal(null)
      setSelected(null)
      setDetailProduct(null)

      try {
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

        if (targetProductId && latestProductSnapshot) {
          pinnedEditedProductsRef.current.set(Number(targetProductId), latestProductSnapshot as ProductRecord)
        }

        await load(true)
      } catch (enrichErr) {
        // Save already succeeded and the person's already been told so --
        // this is just the undo/redo snapshot and/or background refresh
        // not completing (commonly a superseded-search abort, which is
        // expected and harmless). Log it for debugging, don't alarm the
        // person about a save that went through fine.
        console.warn('[handleSaveWithGallery] post-save refresh/snapshot skipped:', enrichErr)
      }
    } catch (e) {
      console.error('[handleSaveWithGallery] error:', e)
      notify(getErrorMessage(e, 'Failed to save product'), 'error')
    } finally {
      finishSingleAction(productSaveInFlightRef)
    }
  }

  // Opens DeleteConfirmModal for the bulk selection instead of running the
  // delete directly -- the actual delete logic moved to
  // runBulkDeleteConfirmed below, called once the modal's Delete button is
  // clicked. beginSingleAction's guard now happens at confirm time, not at
  // open time, so opening/cancelling the modal repeatedly can't leave the
  // in-flight ref stuck.
  const handleBulkDelete = () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    setPendingDelete({ ids: [...selectedVisibleIds] })
  }

  // Above this many selected rows, the per-id concurrent path above import
  // used for every bulk delete becomes the actual bottleneck this session's
  // 10k+ request was about -- see cloudflare/src/lib/bulkDeleteEngine.ts's
  // header. 300 lines up with D1_IMPORT_BATCH_CHUNK_SIZE (import's own
  // proven per-request chunk size) purely as a familiar reference point,
  // not a tuned threshold -- below it, the existing per-id flow's
  // in-browser progress and per-item undo/redo are worth keeping; above
  // it, a fire-and-poll job is the only path that stays fast and doesn't
  // risk the tab timing out or the person navigating away mid-delete.
  const BULK_DELETE_JOB_THRESHOLD = 300
  const [bulkDeleteJobStatus, setBulkDeleteJobStatus] = useState<BulkDeleteJobStatus | null>(null)

  const runBulkDeleteJobConfirmed = async (ids: EntityId[], reason: string) => {
    if (!beginSingleAction(bulkActionInFlightRef, { blocked: bulkActionBusy })) return
    setBulkActionBusy(true)
    setDeleteConfirmBusy(true)
    try {
      const { jobId, totalCount } = await productApi.startBulkDeleteJob(ids, reason)
      setBulkDeleteJobStatus({ id: jobId, status: 'pending', totalCount, processedCount: 0, failedCount: 0, lastError: null })
      // No per-item undo/redo for a job-path delete -- keeping 10k+
      // snapshots in memory (the whole point of runBulkDeleteConfirmed's
      // snapshotProductsByIds above, at this scale) defeats the purpose of
      // batching in the first place. The modal closes immediately; the job
      // keeps running server-side and the progress toast (rendered off
      // bulkDeleteJobStatus, near the bulk toolbar) tracks it to
      // completion even if this component unmounts, since it's a server
      // job either way, not something that needs Products.tsx open.
      setPendingDelete(null)
      notify(`Deleting ${totalCount.toLocaleString()} products in the background…`)
      let status = await productApi.getBulkDeleteJobStatus(jobId)
      while (status.status === 'pending' || status.status === 'processing') {
        setBulkDeleteJobStatus(status)
        await new Promise((resolve) => setTimeout(resolve, 1500))
        status = await productApi.getBulkDeleteJobStatus(jobId)
      }
      setBulkDeleteJobStatus(status)
      setSelectedIds(new Set())
      await load(true)
      if (status.status === 'cancelled') {
        notify(`Cancelled -- ${status.processedCount.toLocaleString()} of ${status.totalCount.toLocaleString()} were already deleted`, 'warning')
      } else if (status.status === 'failed') {
        notify(getErrorMessage(status.lastError, 'Bulk delete failed'), 'error')
      } else if (status.failedCount) {
        notify(`Deleted ${(status.processedCount - status.failedCount).toLocaleString()}, ${status.failedCount.toLocaleString()} failed`, 'warning')
      } else {
        notify(`${status.processedCount.toLocaleString()} products deleted`)
      }
    } catch (e) {
      notify(getErrorMessage(e, 'Failed to start bulk delete'), 'error')
    } finally {
      finishSingleAction(bulkActionInFlightRef)
      setBulkActionBusy(false)
      setDeleteConfirmBusy(false)
      setPendingDelete(null)
    }
  }

  const runBulkDeleteConfirmed = async (ids: EntityId[], reason: string) => {
    if (ids.length > BULK_DELETE_JOB_THRESHOLD) return runBulkDeleteJobConfirmed(ids, reason)
    if (!beginSingleAction(bulkActionInFlightRef, { blocked: bulkActionBusy })) return
    const snapshots = snapshotProductsByIds(ids)
    setBulkActionBusy(true)
    setDeleteConfirmBusy(true)
    try {
      const deletionRun = await runConcurrentTasks<EntityId, number>(ids, async (id: EntityId) => {
        const result = await runProductDeleteMutation(() => productApi.deleteProduct(id, reason), 'Delete product')
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
              const result = await runProductDeleteMutation(() => productApi.deleteProduct(id, reason), 'Re-delete product')
              if (result?.success === false) throw new Error(result.error || 'Failed to re-delete product')
            })
            if (redoRun.failures.length) throw new Error(getErrorMessage(redoRun.failures[0]?.error, 'Failed to re-delete product'))
            await load(true)
          },
        })
      }
      if (failed) notify(`Deleted ${done}, ${failed} failed`, 'warning')
      else notify(`${done} product${done > 1 ? 's' : ''} deleted`)
    } catch (e) {
      // Matches runSingleDeleteConfirmed's catch/notify pattern (see above).
      // Before this fix, an error outside the per-id runConcurrentTasks loop
      // itself -- e.g. load(true) failing after the deletes went through, or
      // summarizeProductRun/actionHistory.pushAction throwing -- had no catch
      // here at all and surfaced no toast, unlike the single-delete path.
      // That gap is the concrete "silent-skip" mismatch between the two UX
      // paths: per-item failures were always reported via the notify above,
      // but a non-per-item failure was previously swallowed silently.
      notify(getErrorMessage(e, 'Bulk delete failed'), 'error')
    } finally {
      finishSingleAction(bulkActionInFlightRef)
      setBulkActionBusy(false)
      setDeleteConfirmBusy(false)
      setPendingDelete(null)
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
        // Pin before the call, not after -- clearProductStockByIds already
        // awaits its own load(true) internally, so by the time this line
        // returns the refresh has already happened. Same pinning rationale
        // as runBulkProductUpdates above: zeroing stock is exactly what an
        // active stock-status filter (e.g. "In stock") would otherwise
        // immediately drop the row for.
        for (const snapshot of snapshots) {
          if (!snapshot?.id || !idsToClear.includes(Number(snapshot.id))) continue
          const zeroedBranchStock = Array.isArray(snapshot.branch_stock)
            ? snapshot.branch_stock.map((entry) => ({ ...entry, quantity: 0 }))
            : snapshot.branch_stock
          pinnedEditedProductsRef.current.set(Number(snapshot.id), {
            ...snapshot,
            stock_quantity: 0,
            branch_stock: zeroedBranchStock,
          } as ProductRecord)
        }
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

  // Opens DeleteConfirmModal for a single product instead of deleting
  // immediately -- actual delete moved to runSingleDeleteConfirmed below.
  const handleDelete = (p: ProductRecord) => {
    if (!beginSingleAction(productDeleteInFlightRef)) return
    setPendingDelete({ ids: [p.id as EntityId] })
  }

  const runSingleDeleteConfirmed = async (p: ProductRecord, reason: string) => {
    setDeleteConfirmBusy(true)
    try {
      const snapshot = cloneHistorySnapshot(p)
      await runProductDeleteMutation(() => productApi.deleteProduct(p.id || 0, reason), 'Delete product')
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
          const result = await runProductDeleteMutation(() => productApi.deleteProduct(targetId, reason), 'Delete product again')
          if (result?.success === false) throw new Error(result.error || 'Failed to delete product again')
          await load(true)
        },
      })
      notify('Product deleted')
      setDetailProduct(null)
    } catch(e) { notify(getErrorMessage(e, 'Failed'), 'error') }
    finally {
      finishSingleAction(productDeleteInFlightRef)
      setDeleteConfirmBusy(false)
      setPendingDelete(null)
    }
  }

  // Single entry point for DeleteConfirmModal's confirm button -- dispatches
  // to the single- or bulk-delete runner based on how many ids are pending,
  // since the two paths differ in their action-history label/notify text
  // and in clearing detailProduct (single only), not just quantity.
  const runPendingDeleteConfirmed = async (reason: string) => {
    const ids = pendingDelete?.ids || []
    if (!ids.length) return
    if (ids.length === 1) {
      const product = snapshotProductsByIds(ids)[0]
      if (product) await runSingleDeleteConfirmed(product, reason)
      else setPendingDelete(null)
      return
    }
    await runBulkDeleteConfirmed(ids, reason)
  }

  // Retroactive catalog cleanup (see routes/products.ts POST /merge-duplicates):
  // folds products that were already imported as separate rows -- identical
  // in every identity field except which branch's stock landed on which row
  // -- into a single row per group, tagging the move in inventory history
  // and the audit log rather than silently deleting anything. Opens the
  // detailed MergeDuplicatesReviewModal (safeguards/edge cases spelled out,
  // requires an explicit acknowledgement checkbox) instead of the old plain
  // window.confirm() -- see that component's own comment on why this isn't
  // a live preview of which products will merge yet.
  const openMergeDuplicatesReview = () => {
    if (mergeDuplicatesBusy) return
    setMergeDuplicatesReviewOpen(true)
  }

  // Feeds MergeDuplicatesReviewModal's real preview list -- calls the new
  // read-only GET /api/products/merge-duplicates/preview (see that route's
  // comment for why this is a separate GET rather than a dryRun flag on
  // the POST below). Left as a thin passthrough here rather than the
  // modal importing productWriteTransport.ts directly, same as every
  // other product mutation on this page going through `productApi` so
  // there's one place (the ProductApi type above) that has to know the
  // transport layer exists.
  const loadMergeDuplicatesPreview = async () => {
    const result = await productApi.previewMergeDuplicates() as {
      success?: boolean
      error?: string
      groupCount?: number
      duplicateProductCount?: number
      groups?: MergeDuplicatesPreviewGroup[]
    } | undefined
    if (result?.success === false) throw new Error(result.error || 'Failed to load merge preview')
    return {
      groupCount: Number(result?.groupCount || 0),
      duplicateProductCount: Number(result?.duplicateProductCount || 0),
      groups: Array.isArray(result?.groups) ? result.groups : [],
    }
  }

  const handleMergeDuplicates = async () => {
    if (mergeDuplicatesBusy) return
    setMergeDuplicatesBusy(true)
    try {
      const result = await productApi.mergeDuplicates() as { success?: boolean; mergedGroups?: number; mergedProducts?: number; error?: string } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to merge duplicate products')
      const mergedGroups = Number(result?.mergedGroups || 0)
      const mergedProducts = Number(result?.mergedProducts || 0)
      if (!mergedGroups) {
        notify(t('no_duplicate_products_found') || 'No duplicate products found')
      } else {
        notify(
          (t('merged_duplicate_products_summary') || 'Merged {products} duplicate product(s) into {groups} row(s)')
            .replace('{products}', String(mergedProducts))
            .replace('{groups}', String(mergedGroups)),
        )
        await load(true)
      }
    } catch (e) {
      notify(getErrorMessage(e, 'Failed'), 'error')
    } finally {
      setMergeDuplicatesReviewOpen(false)
      setMergeDuplicatesBusy(false)
    }
  }

  // --- Exact-duplicate (same barcode + same name) flagging for list rows ---
  // (user spec item #3). Reuses the SAME server sweep the Duplicates review
  // tab renders (GET /api/products/possible-duplicates) as the single source
  // of truth, refined to the members that also share a name. Refetch whenever
  // the loaded catalog's identity fields change -- any load() replaces
  // `products`, so a product edited/merged/deleted elsewhere updates the flags
  // without a manual refresh (the signature ignores unrelated churn so a
  // silent poll returning the same rows doesn't refetch). Gated by the same
  // permission as the Duplicates tab and the merge tool.
  const productDuplicateSignature = useMemo(
    () => (canMergeDuplicates
      ? products.map((p) => `${p.id}:${String(p.barcode ?? '')}:${String(p.name ?? '')}`).join('|')
      : ''),
    [products, canMergeDuplicates],
  )

  const refreshDuplicateClusters = useCallback(async () => {
    if (!canMergeDuplicates) { setDuplicateClusters([]); return }
    try {
      const payload = await getPossiblySameProducts()
      setDuplicateClusters(extractDuplicateClusters(payload))
    } catch {
      // Non-fatal: flags simply don't appear this pass. The Duplicates tab
      // stays the authoritative review surface and shows its own error.
    }
  }, [canMergeDuplicates])

  useEffect(() => {
    void refreshDuplicateClusters()
    // productDuplicateSignature is the intended trigger; refreshDuplicateClusters
    // is stable per canMergeDuplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productDuplicateSignature, refreshDuplicateClusters])

  const exactDuplicateIndex = useMemo(
    () => (canMergeDuplicates
      ? buildExactDuplicateIndex(extractDuplicateClusters(duplicateClusters))
      : new Map<number, ExactDuplicateInfo>()),
    [duplicateClusters, canMergeDuplicates],
  )

  // "Keep this": fold the OTHER members of this exact-duplicate group into the
  // chosen record (one pair per call, stopping on first failure so nothing
  // half-merges silently), then reload and re-sweep.
  const handleDuplicateKeepThis = useCallback(async (keepId: number, info: ExactDuplicateInfo) => {
    if (dupResolverBusyKey) return
    const others = info.members.filter((m) => Number(m.id) !== Number(keepId))
    if (!others.length) return
    setDupResolverBusyKey(info.key)
    try {
      for (const other of others) {
        await mergePossiblySameProducts(keepId, other.id)
      }
      notify(t('product_duplicate_merged') || 'Merged — stock, lots and images were carried onto the kept product')
      await load(true)
      await refreshDuplicateClusters()
    } catch (e) {
      notify(getErrorMessage(e, t('merge_duplicate_failed') || 'Could not merge these records'), 'error')
    } finally {
      setDupResolverBusyKey(null)
    }
  }, [dupResolverBusyKey, load, notify, refreshDuplicateClusters, t])

  // "Keep both": dismiss the barcode cluster (these are genuinely different
  // items), so the sweep stops flagging it -- the false-positive escape hatch.
  const handleDuplicateKeepBoth = useCallback(async (info: ExactDuplicateInfo) => {
    if (dupResolverBusyKey) return
    setDupResolverBusyKey(info.key)
    try {
      await dismissProductDuplicateCluster('barcode', info.barcode)
      notify(t('product_duplicate_kept_both') || 'Kept both — no longer flagged as duplicates')
      await refreshDuplicateClusters()
    } catch (e) {
      notify(getErrorMessage(e, t('dismiss_duplicate_failed') || 'Could not update this duplicate'), 'error')
    } finally {
      setDupResolverBusyKey(null)
    }
  }, [dupResolverBusyKey, notify, refreshDuplicateClusters, t])

  // Review-before-delete cleanup for products that have sat at 0 stock
  // across every branch for a while (progress.md part 91's spec, built
  // part 97). Same "thin passthrough through productApi" shape as the
  // merge-duplicates preview above -- the modal never talks to
  // productWriteTransport.ts directly.
  const openZeroQuantityCleanup = () => {
    if (zeroQuantityCleanupBusy) return
    setZeroQuantityCleanupOpen(true)
  }

  const loadZeroQuantityCandidates = async (thresholdDays?: number) => {
    const result = await productApi.previewZeroQuantityCandidates(thresholdDays) as {
      success?: boolean
      error?: string
      thresholdDays?: number
      checkedCount?: number
      totalCandidates?: number
      candidates?: ZeroQuantityCandidate[]
    } | undefined
    if (result?.success === false) throw new Error(result.error || 'Failed to load zero-quantity candidates')
    return {
      thresholdDays: Number(result?.thresholdDays ?? 30),
      checkedCount: Number(result?.checkedCount || 0),
      totalCandidates: Number(result?.totalCandidates || 0),
      candidates: Array.isArray(result?.candidates) ? result.candidates : [],
    }
  }

  const handleZeroQuantityDelete = async (ids: number[]) => {
    if (zeroQuantityCleanupBusy || !ids.length) return undefined
    setZeroQuantityCleanupBusy(true)
    try {
      const result = await productApi.deleteZeroQuantityProducts(ids) as {
        success?: boolean
        error?: string
        deletedCount?: number
        deletedIds?: number[]
        skipped?: Array<{ id: number; reason: string }>
      } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to remove products')
      const deletedCount = Number(result?.deletedCount || 0)
      if (deletedCount > 0) {
        notify(
          (t('zero_quantity_cleanup_deleted_summary') || 'Removed {count} product(s)').replace('{count}', String(deletedCount)),
        )
        await load(true)
      }
      return result
    } catch (e) {
      notify(getErrorMessage(e, 'Failed'), 'error')
      return undefined
    } finally {
      setZeroQuantityCleanupBusy(false)
    }
  }

  // Attach Library photos to products by filename (routes/products.ts's
  // /wire-images preview + apply). Same "thin passthrough through
  // productApi" shape as the two cleanups above -- the modal never talks
  // to productWriteTransport.ts directly.
  //
  // This is the recovery path for a delete-and-reimport: a products reset
  // clears each product's link to its photo but leaves every file in the
  // Library, so after re-importing this is what puts the photos back.
  const openWireImages = () => {
    if (wireImagesBusy) return
    setWireImagesOpen(true)
  }

  const loadWireImagesPreview = async (): Promise<WireImagesPreview> => {
    const result = await productApi.previewWireImages() as (WireImagesPreview & { success?: boolean; error?: string }) | undefined
    if (result?.success === false) throw new Error(result.error || 'Failed to match library images')
    return {
      changes: Array.isArray(result?.changes) ? result.changes : [],
      counts: {
        libraryImages: Number(result?.counts?.libraryImages || 0),
        matched: Number(result?.counts?.matched || 0),
        unmatched: Number(result?.counts?.unmatched || 0),
        ambiguous: Number(result?.counts?.ambiguous || 0),
        wouldChange: Number(result?.counts?.wouldChange || 0),
        wouldReplace: Number(result?.counts?.wouldReplace || 0),
      },
      unmatched: Array.isArray(result?.unmatched) ? result.unmatched : [],
      ambiguous: Array.isArray(result?.ambiguous) ? result.ambiguous : [],
    }
  }

  const handleWireImages = async (changes: WireImageChange[]) => {
    if (wireImagesBusy || !changes.length) return undefined
    setWireImagesBusy(true)
    try {
      const result = await productApi.wireImages(changes) as { success?: boolean; error?: string; updated?: number; imagesAttached?: number } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to attach images')
      if (Number(result?.updated || 0) > 0) await load(true)
      return result
    } catch (e) {
      notify(getErrorMessage(e, 'Failed'), 'error')
      return undefined
    } finally {
      setWireImagesBusy(false)
    }
  }

  const handleUnwireImages = async (productIds: number[]) => {
    if (wireImagesBusy || !productIds.length) return undefined
    setWireImagesBusy(true)
    try {
      const result = await productApi.unwireImages(productIds) as { success?: boolean; error?: string; cleared?: number } | undefined
      if (result?.success === false) throw new Error(result.error || 'Failed to detach images')
      if (Number(result?.cleared || 0) > 0) await load(true)
      return result
    } catch (e) {
      notify(getErrorMessage(e, 'Failed'), 'error')
      return undefined
    } finally {
      setWireImagesBusy(false)
    }
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
  const categoryOptions = useMemo(() => toLookupOptions(categories), [categories])
  // Category filter options: `categories` (the full lookup list, used for
  // category management) only loads lazily once the Filters panel is
  // opened, so on first open it's still empty and the Category section
  // vanished entirely while Brand/Supplier (sourced from productFilterMeta,
  // which loads eagerly with the product search) showed up immediately.
  // Falling back to productFilterMeta.categories -- already fetched by the
  // time products themselves are on screen -- keeps Category populated on
  // that same first render, same as Brand/Supplier; once the full lookup
  // list finishes loading it takes over (richer records, canonical order).
  const categoryFilterOptions = useMemo(
    () => (categories.length ? categories : (productFilterMeta.categories || []).map((name) => ({ name })))
      // Alphabetical by default, matching Brand (buildProductBrandOptions
      // already sorts) and Inventory's inventoryCategories -- previously
      // this rendered in whatever order the backend/lookup list happened
      // to return, which for the productFilterMeta fallback in particular
      // is just first-seen order across the current page of products, not
      // a stable or predictable ordering.
      .slice()
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))),
    [categories, productFilterMeta.categories],
  )
  // Hierarchical "Main - Sub" category filter rows: picking a bare
  // "Haircare" parent selects every real "Haircare - X" subcategory
  // alongside it, not just the flat "Haircare" value. Built here (a .tsx
  // file) rather than inside productMenuHelpers.ts because the row labels
  // are JSX -- that helper module's tests run under plain `node` with no
  // JSX transform, so it stays JSX-free and just accepts these pre-built
  // rows via `categoryOptions`. See components/shared/CategoryFilterOptions.tsx.
  const hierarchicalCategoryOptions = useMemo(
    () => buildHierarchicalCategoryFilterOptions({
      categoryNames: categoryFilterOptions.map((category) => String(category.name)),
      isSelected: (value) => isProductCategorySelected(catFilter, value),
      onToggle: (values, checked) => setCatFilter(toggleProductCategoryValues(catFilter, values, checked)),
      // Every row this builder produces always sets onClick, but the
      // shared FilterMenu.FilterOption type declares it optional (some
      // other FilterMenu consumers render disabled/actionless rows) --
      // productMenuHelpers.ts's local FilterOption keeps onClick required
      // since every option it builds has one, so this cast just bridges
      // that (accurate) narrowing at the boundary between the two files.
    }) as Array<{ id: string | number; label: ReactNode; title?: string; active?: boolean; onClick: () => void }>,
    [categoryFilterOptions, catFilter],
  )
  const unitOptions = useMemo(() => toLookupOptions(units), [units])
  const branchOptions = useMemo(() => toLookupOptions(branches), [branches])
  // {value,label} shape ManageBatchesModal's branch dropdown expects --
  // same construction Inventory.tsx uses for its own copy of this modal.
  const branchSelectOptions = useMemo(() => branches.map((branch) => ({
    value: String(branch.id),
    label: branch.name || String(branch.id),
  })), [branches])
  // Same fallback Inventory.tsx's own defaultBranch memo uses (is_default
  // flag, else first branch) -- ManageBatchesModal needs some branch
  // preselected on open, and this is the one other caller of that modal
  // already settled on.
  const defaultBranchId = useMemo(() => (
    String((branches.find((branch) => branch.is_default) || branches[0])?.id || '')
  ), [branches])
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

  // Search: comma-separated terms. Mode AND = all terms must match. Mode OR = any term matches.
  // Spaces within a term are treated as part of the search string (no space=AND split).
  // Built from `debouncedSearch` (180ms, same value driving the server
  // fetch below), not raw `search` -- previously this re-filtered the
  // visible list on every keystroke against whatever page was already
  // loaded, so typing made the grid visibly narrow one character at a
  // time before the matching server response replaced it (reported as
  // "search results render incrementally / one by one, should only show
  // once all results are in"). Tying it to the same debounced value the
  // fetch uses means the visible list now updates once, atomically, per
  // settled query -- either from this local re-filter (if the server
  // hasn't responded yet) or from the server payload itself, never both
  // as separate visible steps for the same keystroke.
  const searchTerms = useMemo(() => buildProductSearchTerms(cleanedSearchQuery), [cleanedSearchQuery])
  const filtered = useMemo(() => filterProductsForPage(products, {
    brandFilter,
    branchFilter,
    catFilter,
    groupFilter,
    issueFilter,
    parentProductIds,
    searchMode,
    searchTerms,
    stockFilter: effectiveStockState,
    supplierFilter,
  }), [brandFilter, branchFilter, catFilter, effectiveStockState, groupFilter, issueFilter, parentProductIds, products, searchMode, searchTerms, supplierFilter])

  // Name kept as "...Csv" for now (it's an internal identifier, not shown
  // to users -- see productMenuHelpers.ts's menu item labels, none of which
  // say "CSV") to keep this diff small, but the actual output is real
  // .xlsx: downloadXLSX writes barcode-shaped columns as Excel Text cells
  // and Khmer text as native UTF-8, so re-opening the export in Excel and
  // re-importing it never turns barcodes into scientific notation or Khmer
  // into '?' the way a plain CSV round-trip through Excel can. See
  // utils/xlsxExport.ts's header comment for the full explanation.
  // H1+X5 (Part 402): the format comes from ExportFieldsModal's new format
  // row (xlsx default -- the barcode-safe choice). PDF goes through the
  // shared print view; CSV exists for re-import/machine use.
  const exportProductsCsv = useCallback(async (rowsToExport = filtered, filePrefix = 'products', groups?: import('./helpers/productExport.ts').ExportFieldGroup[], branchId?: string, format: 'csv' | 'xlsx' | 'pdf' = 'xlsx') => {
    const { buildProductExportRows } = await import('./helpers/productExport.ts')
    const rows = buildProductExportRows(rowsToExport, { ...(groups ? { groups } : {}), ...(branchId ? { branchId } : {}) })
    const filename = `${filePrefix}-${new Date().toISOString().slice(0,10)}`
    if (format === 'csv') {
      const { downloadCSV } = await import('../../utils/csv.ts')
      downloadCSV(`${filename}.csv`, rows)
      return
    }
    if (format === 'pdf') {
      const { openPrintExport } = await import('../../utils/exportOptions.ts')
      const opened = openPrintExport({
        title: `${filePrefix} — ${new Date().toISOString().slice(0, 10)}`,
        subtitle: `${rows.length} ${t('records') || 'records'}`,
        headers: rows.length ? Object.keys(rows[0]) : [],
        rows,
      })
      if (!opened) notify(t('export_popup_blocked') || 'The print view was blocked -- allow pop-ups for this site and try again.', 'error')
      return
    }
    const { downloadXLSX } = await import('../../utils/xlsxExport.ts')
    downloadXLSX(`${filename}.xlsx`, rows)
  }, [filtered, notify, t])

  const productsById = useMemo(() => buildProductIdMap(products), [products])

  // Category-first sectioning (decided ask: category header first, A-Z
  // across categories, A-Z within each category, rail jumps by category
  // initial) -- replaces the old name-initial-letter sectioning here and
  // on Inventory.tsx. POS.tsx's own AlphaIndexRail is untouched -- that one
  // was never part of this ask, it stays name-initial.
  const productSections = useMemo<ProductSectionLike[]>(
    () => buildProductCategorySections(filtered, {
      productsById,
      sortDirection: productSortDirection,
      uncategorizedLabel: t('uncategorized') || 'Uncategorized',
    }) as unknown as ProductSectionLike[],
    [filtered, productSortDirection, productsById, t],
  )

  const allVisibleProducts = useMemo<ProductRecord[]>(
    () => productSections.flatMap((section) => section.items),
    [productSections],
  )

  useEffect(() => {
    setProductPage(1)
  }, [brandFilter, branchFilter, catFilter, createdDateFrom, createdDateTo, groupFilter, initialFilter, issueFilter, productSortDirection, search, searchMode, stockFilter, supplierFilter])

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
  // Selection mode (part 77 ask): no explicit on/off state -- the page is
  // "in select mode" exactly when something is selected. Entering it (via
  // long-press, or checking the header/group select-all box) and leaving
  // it (deselecting everything, including the last remaining checkbox)
  // both fall out of this for free, so there's no separate exit action to
  // keep in sync with the selection itself. Per-row/per-group checkboxes
  // only render while this is true (see renderDesktopProductRow/
  // renderMobileProductCard/ProductsListSurface) -- outside select mode a
  // plain click opens the product detail view instead ("click-to-view").
  const selectionModeActive = selectedIds.size > 0
  const {
    safePageSize: productSafePageSize,
    totalPages: productTotalPages,
    summaryLabel: productSummaryLabel,
  } = useMemo(() => buildProductPaginationState({
    page: productPage,
    total: productTotal,
    pageSize: productPageSize,
    fallbackPageSize: DEFAULT_PAGE_SIZE,
    pending: loading && !loadedOnceRef.current,
    pendingLabel: tr('loading', 'Loading'),
  }), [loading, productPage, productPageSize, productTotal, tr])

  // Self-heal an out-of-range page instead of showing a permanently empty
  // grid. `productPage` is what's actually sent to the server (see the load
  // effect's `page: productPage` above); `productTotalPages` is derived from
  // the *last successful* response. These normally move together because
  // every filter/sort/search change resets productPage to 1 -- but a
  // same-page action that shrinks the total (deleting the last item(s) on
  // the current page via single or bulk delete) does not go through that
  // reset path, since it's a `load(true)` refetch, not a filter change. Left
  // alone, that refetch would ask the server for a page past the new last
  // page, get back zero items, and leave the grid stuck empty even though
  // productSummaryLabel and the pagination pill display a clamped,
  // seemingly-correct "page 2 of 2" underneath it -- content and footer
  // disagreeing. Mirrors the equivalent clampPage effect used in Sales.tsx.
  useEffect(() => {
    if (productPage > productTotalPages) {
      setProductPage(productTotalPages)
    }
  }, [productPage, productTotalPages])

  // tr() does a plain key lookup with no template interpolation (see
  // AppContext.tsx's t()) -- the stored translation for this key is the
  // literal string "{count} selected" / Khmer equivalent, so the {count}
  // placeholder must be substituted by hand same as every other {count}-
  // templated key in this codebase (e.g. SalesImportModal.tsx's
  // rows_ready_count). Without this .replace call the label rendered
  // literally as "{count} selected" to every user, English or Khmer,
  // since both language files do have this key defined -- found while
  // auditing bulk-selection toolbars across pages for this session.
  const productSelectedLabel = tr('products_selected_count', `${selectedVisibleCount} selected`).replace('{count}', String(selectedVisibleCount))
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
    () => [...jumpTargetIdsByLetter.keys()].map((key) => String(key)).sort(compareInitialKeys),
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

  const toggleSelectionScope = useCallback((ids: EntityId[], checked: boolean) => {
    setSelectedIds((current) => toggleIdSet(current, ids, checked))
  }, [])

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
  // Scopes (Selected/Filtered/Full, at most 3) for the single Export panel
  // -- see ExportFieldsModal.tsx and productMenuHelpers.ts's
  // buildProductExportScopes for why this replaced the old flat menu-item
  // list (up to 9 near-duplicate "Export ..." rows in the Manage dropdown).
  const productExportScopes = useMemo(() => buildProductExportScopes({
    brandFilter,
    branchFilter,
    catFilter,
    createdDateFrom,
    createdDateTo,
    filtered,
    products,
    selectedProducts,
    stockFilter,
    supplierFilter,
    tr,
  }), [brandFilter, branchFilter, catFilter, createdDateFrom, createdDateTo, filtered, products, selectedProducts, stockFilter, supplierFilter, tr])

  const suppliers = useMemo(
    () => buildProductSupplierOptions(productFilterMeta.suppliers),
    [productFilterMeta.suppliers],
  )

  const activeFilters = countActiveProductFilters({
    brandFilter,
    branchFilter,
    catFilter,
    createdDateFrom,
    createdDateTo,
    groupFilter,
    initialFilter,
    issueFilter,
    productSortDirection,
    stockFilter,
    supplierFilter,
  }) + (searchMode === 'OR' ? 1 : 0)

  const clearAllFilters = useCallback(() => {
    setCatFilter(new Set())
    setBrandFilter(new Set())
    setBranchFilter('all')
    setSupplierFilter(new Set())
    setUnitFilter('')
    setStockFilter('all')
    setGroupFilter('all')
    setIssueFilter('all')
    setPromoFilter('all')
    setMergedFilter('all')
    // setInitialFilter('all') removed -- no setter exists anymore, and
    // initialFilter is permanently 'all' already (see its declaration).
    setCreatedDateFrom('')
    setCreatedDateTo('')
    // Name A-Z is the actual default sort for this page (see the initial
    // useState below) -- this previously reset to 'desc' (Newest first)
    // instead, so "clear filters" silently changed the sort order rather
    // than restoring the real default.
    setProductSortDirection('name_asc')
    setSearchMode('AND')
  }, [])

  const handleSearchInputChange = useCallback((value: string) => {
    // A fresh search is exactly the "search again" moment
    // pinnedEditedProductsRef's own comment refers to -- once the person
    // is intentionally re-querying, a just-edited product that no longer
    // matches should behave like any other non-matching row again.
    pinnedEditedProductsRef.current.clear()
    setSearch(value)
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
      setBrandFilter(new Set([value]))
      return
    }
    if (type === 'category') {
      setCatFilter(new Set([value]))
      return
    }
    if (type === 'unit') {
      // Was `setSearch(value)`, relying on 'unit' being in scope for the
      // free-text search box -- broke silently once PRODUCT_SEARCH_COLUMNS
      // (cloudflare/src/lib/searchMatch.ts) was narrowed to name/sku/
      // barcode only. Now uses its own exact-match filter (see unitFilter's
      // declaration comment), the same way the 'brand'/'category' branches
      // above already use brandFilter/catFilter instead of search text.
      setUnitFilter(value)
    }
  }, [clearAllFilters])

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
      // Same "stays visible until I search again" pinning handleSaveWithGallery
      // does for a single-row edit (see pinnedEditedProductsRef's own comment) --
      // a bulk edit that moves a product out of the active filters (e.g. bulk
      // category change while filtered to the old category) shouldn't make the
      // row vanish out from under a person mid-review. Only pin ids that
      // actually succeeded; a failed id keeps whatever's already in the list.
      const restoredSnapshotsForPin = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      for (const snapshot of restoredSnapshotsForPin) {
        if (!snapshot?.id) continue
        pinnedEditedProductsRef.current.set(Number(snapshot.id), { ...snapshot, ...nextUpdates } as ProductRecord)
      }
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

  // Relative price change ("add $1 to all of these"), as opposed to
  // runBulkProductUpdates above which writes the SAME value to every
  // selected row. Each product's new price depends on its own current one,
  // so the payload differs per row and this cannot reuse that function.
  //
  // The count in the confirmation is the number of products that will
  // ACTUALLY change, not the number selected -- the two differ whenever
  // "skip products priced 0" is on, or a decrease leaves a price already at
  // 0 untouched, and confirming "update 40 products" before changing 12
  // would be a lie.
  // P3: whole-catalog scope. Same direction/amount/field pickers as the
  // selection flow above it, but the WORK runs server-side (set-based
  // UPDATEs) with a preview count fetched first so the confirm can say the
  // real number -- and it says plainly that this scope has no undo.
  const runBulkPriceAdjustAllProducts = useCallback(async () => {
    if (bulkActionBusy) return
    const amount = Number(bulkEditForm.adjust_amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      notify(tr('bulk_price_amount_required', 'Enter a positive amount first'), 'warning')
      return
    }
    const currency = bulkEditForm.adjust_currency === 'khr' ? 'khr' : 'usd'
    const fields: string[] = []
    if (bulkEditForm.adjust_selling !== false) fields.push(`selling_price_${currency}`)
    if (bulkEditForm.adjust_special) fields.push(`special_price_${currency}`)
    if (bulkEditForm.adjust_cost) fields.push(`cost_price_${currency}`)
    if (!fields.length) {
      notify(tr('bulk_price_no_change', 'Nothing to change with those settings'), 'warning')
      return
    }
    const direction = bulkEditForm.adjust_direction === 'decrease' ? 'decrease' as const : 'increase' as const
    const payload = { direction, amount, fields, skip_zero: !!bulkEditForm.adjust_skip_zero }
    setBulkActionBusy(true)
    try {
      const { bulkPriceAdjustAllProducts } = await import('../../api/productWriteTransport.ts')
      const preview = await bulkPriceAdjustAllProducts({ ...payload, preview: true })
      const count = Number(preview?.count) || 0
      if (count === 0) {
        notify(tr('bulk_price_no_change', 'Nothing to change with those settings'), 'warning')
        return
      }
      const verb = direction === 'decrease' ? tr('bulk_price_decrease', 'Decrease') : tr('bulk_price_increase', 'Increase')
      const warning = tr('bulk_price_all_confirm', 'This runs on the WHOLE catalog and cannot be undone.')
      if (!window.confirm(`${verb} prices on ${count} products — ${warning}`)) return
      const result = await bulkPriceAdjustAllProducts(payload)
      if (result?.success === false || result?.error) throw new Error(String(result?.error || 'Bulk adjustment failed'))
      notify(`${tr('bulk_price_all_done', 'Adjusted prices across the catalog')}: ${Number(result?.changed) || count}`)
      await load(true)
    } catch (error) {
      notify(getErrorMessage(error, 'Bulk adjustment failed'), 'error')
    } finally {
      setBulkActionBusy(false)
    }
  }, [bulkActionBusy, bulkEditForm, notify, tr, load])

  const runBulkProductPriceAdjustment = useCallback(async () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    const {
      buildProductBulkPriceAdjustments,
      buildProductBulkUpdatePayload,
    } = await loadProductWriteHelpers()

    const fields: string[] = []
    if (bulkEditForm.adjust_selling !== false) {
      fields.push(bulkEditForm.adjust_currency === 'khr' ? 'selling_price_khr' : 'selling_price_usd')
    }
    if (bulkEditForm.adjust_special) {
      fields.push(bulkEditForm.adjust_currency === 'khr' ? 'special_price_khr' : 'special_price_usd')
    }
    if (bulkEditForm.adjust_cost) {
      fields.push(bulkEditForm.adjust_currency === 'khr' ? 'purchase_price_khr' : 'purchase_price_usd')
    }

    const selected = selectedVisibleIds
      .map((id) => productsById.get(Number(id)))
      .filter(Boolean) as ProductRecord[]

    const adjustments = buildProductBulkPriceAdjustments(selected, {
      direction: bulkEditForm.adjust_direction === 'decrease' ? 'decrease' : 'increase',
      amount: bulkEditForm.adjust_amount,
      fields: fields as never,
      skipZeroPriced: !!bulkEditForm.adjust_skip_zero,
    })

    if (!adjustments.length) {
      notify(tr('bulk_price_no_change', 'Nothing to change with those settings'), 'warning')
      return
    }
    const verb = bulkEditForm.adjust_direction === 'decrease'
      ? tr('bulk_price_decrease', 'Decrease')
      : tr('bulk_price_increase', 'Increase')
    if (!window.confirm(`${verb} prices on ${adjustments.length} product${adjustments.length === 1 ? '' : 's'}?`)) return

    const adjustedIds = adjustments.map((entry) => entry.id)
    const snapshots = snapshotProductsByIds(adjustedIds)
    setBulkActionBusy(true)
    let done = 0
    let failed = 0
    try {
      const updateRun = await runConcurrentTasks<{ id: number; updates: Record<string, unknown> }, number>(
        adjustments,
        async (entry: { id: number; updates: Record<string, unknown> }) => {
          const current = productsById.get(entry.id)
          const result = await runProductWriteMutation(
            () => productApi.updateProduct(
              entry.id,
              buildProductBulkUpdatePayload(entry.updates, current, { id: user?.id, name: user?.name }),
            ),
            'Bulk price adjustment',
          )
          if (result?.success === false) throw new Error(result.error || 'Failed to update product')
          return entry.id
        },
      )
      const { done: completedCount, failed: failedCount, failedIds } = summarizeProductRun(updateRun)
      done = completedCount
      failed = failedCount
      setSelectedIds(new Set(failedIds))
      setBulkEditMode(null)
      setBulkEditForm({})

      // Same pinning as the sibling bulk update: a price change can move a
      // row out of an active price-based filter, and it shouldn't vanish
      // mid-review.
      const updatesById = new Map(adjustments.map((entry) => [entry.id, entry.updates]))
      for (const snapshot of snapshots) {
        const snapshotId = Number(snapshot?.id || 0)
        if (!snapshotId || failedIds.includes(snapshotId)) continue
        pinnedEditedProductsRef.current.set(snapshotId, { ...snapshot, ...(updatesById.get(snapshotId) || {}) } as ProductRecord)
      }
      await load(true)

      const restoredSnapshots = snapshots.filter((snapshot) => !failedIds.includes(Number(snapshot?.id || 0)))
      if (done > 0 && restoredSnapshots.length) {
        actionHistory.pushAction({
          label: `${verb} prices on ${done} product${done === 1 ? '' : 's'}`,
          undo: () => restoreProductSnapshots(restoredSnapshots, 'Undo price adjustment'),
          redo: async () => {
            const redoRun = await runConcurrentTasks<ProductRecord, void>(restoredSnapshots, async (snapshot: ProductRecord) => {
              const snapshotId = Number(snapshot?.id || 0)
              const entryUpdates = updatesById.get(snapshotId)
              if (!snapshotId || !entryUpdates) return
              const current = productsById.get(snapshotId)
              const result = await runProductWriteMutation(
                () => productApi.updateProduct(
                  snapshotId,
                  buildProductBulkUpdatePayload(entryUpdates, current, { id: user?.id, name: user?.name }, snapshot?.updated_at),
                ),
                'Redo price adjustment',
              )
              if (result?.success === false) throw new Error(result.error || 'Failed to reapply price adjustment')
            })
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to reapply price adjustment'))
            await load(true)
          },
        })
      }
      notify(
        failed ? `Updated ${done} products, ${failed} failed` : `Updated ${done} products`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }, [actionHistory, bulkActionBusy, bulkEditForm, load, notify, productsById, restoreProductSnapshots, runProductWriteMutation, selectedVisibleIds, snapshotProductsByIds, tr, user?.id, user?.name])

  const productFilterSections = useMemo(() => buildProductFilterSections({
    availabilitySection: buildAvailabilityFilterSection({
      t,
      branches,
      stockFilter,
      setStockFilter,
      groupFilter,
      setGroupFilter,
      branchFilter,
      setBranchFilter,
    }),
    // Y13: the "Created" date filter is no longer a menu section -- it moved
    // to its own row directly below the search row (see the render below).
    // buildProductFilterSections treats createdSection as optional, so
    // omitting it here simply drops it from the menu.
    issuesSection: buildIssuesFilterSection({
      t,
      issueFilter,
      setIssueFilter,
    }),
    mergedSection: buildAutoMergedFilterSection({
      t,
      mergedFilter,
      setMergedFilter,
    }),
    promotionsSection: buildPromotionsFilterSection({
      t,
      promoFilter,
      setPromoFilter,
      promotionOptions: promotionRules.map((rule) => ({ id: rule.id, title: rule.title || ('#' + rule.id), rule_type: rule.rule_type })),
    }),
    searchModeSection: buildSearchModeFilterSection({
      t,
      searchMode,
      setSearchMode,
    }),
    branches,
    brandOptions,
    categories: categoryFilterOptions,
    categoryOptions: hierarchicalCategoryOptions,
    filters: {
      brandFilter,
      branchFilter,
      catFilter,
      createdDateFrom,
      createdDateTo,
      groupFilter,
      issueFilter,
      productSortDirection,
      stockFilter,
      supplierFilter,
    },
    isOpen: isProductFilterMenuOpen,
    setBrandFilter,
    setBranchFilter,
    setCatFilter,
    setGroupFilter,
    setProductSortDirection: (value: string) => setProductSortDirection(
      value === 'asc' || value === 'name_asc' || value === 'name_desc' ? value : 'desc',
    ),
    setStockFilter,
    setSupplierFilter,
    suppliers,
    t,
  }), [branches, brandFilter, branchFilter, brandOptions, catFilter, categoryFilterOptions, createdDateFrom, createdDateTo, groupFilter, hierarchicalCategoryOptions, isProductFilterMenuOpen, issueFilter, productSortDirection, searchMode, setSearchMode, stockFilter, supplierFilter, suppliers, t])

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
      costKhr,
      costUsd,
      qty,
      selectedBranchName,
      stockStatusTextClass,
    } = buildProductRowDisplayState(p, {
      branchFilter,
      branchNameById,
      catMap,
      exchangeRate,
      getBranchQty,
      getBranchSummaryLabel,
      getBrandColor,
      t,
      promotionRules,
    })
    const thumbnailState = buildProductThumbnailState(p)
    // A merged row (see mergeSameDetailRows) represents multiple real
    // product ids -- selecting/checking it needs to act on all of them
    // together, not just the lead id, or a bulk delete would silently
    // leave the other branch-duplicate rows behind. Falls back to the
    // single id for ordinary, unmerged rows.
    const rowScopeIds = p.__mergedProductIds?.length ? p.__mergedProductIds : [productId]
    const rowSelected = isSelectionScopeFullySelected(rowScopeIds)
    // Exact duplicate (same real barcode + same name, per the server sweep)?
    // If so, the row's normal click-to-detail "Manage/Product" flow is
    // suppressed (user spec item #3) -- the inline resolver below is the only
    // action until it's kept-one/kept-both.
    const dupInfo = findRowDuplicateInfo(exactDuplicateIndex, productId, rowScopeIds)
    // Long-press/click-hold enters select mode by selecting this row;
    // once select mode is active (selectionModeActive, derived from
    // selectedIds.size), the row's own onClick below toggles selection
    // directly and these handlers are skipped entirely (disabled), so a
    // plain click never has to wait out the hold once selecting is live.
    // Not a hook -- see utils/longPress.ts -- this row's persistent
    // timer slot comes from the shared Map keyed by product id.
    const rowLongPressState = getLongPressState(Number(productId))
    const longPress = createLongPressHandlers(rowLongPressState, {
      disabled: selectionModeActive,
      onLongPress: () => toggleSelectionScope(rowScopeIds, true),
      onClick: () => { if (!dupInfo) setDetailProduct(p) },
    })
    // The native `click` that follows this same press-release still
    // fires once selectionModeActive flips true and swaps this element's
    // onClick out from under it -- consumeLongPressClick() eats exactly
    // that one ghost click instead of letting it immediately toggle the
    // row back off. See utils/longPress.ts's own comment on
    // consumeLongPressClick for the full mechanism.
    const handleRowClick = () => {
      if (consumeLongPressClick(rowLongPressState)) return
      toggleSelectionScope(rowScopeIds, !rowSelected)
    }
    return (
      <tr
        key={productId}
        data-product-jump-id={productId}
        className={`table-row cursor-pointer select-none ${rowSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}
        onClick={selectionModeActive ? handleRowClick : undefined}
        {...(selectionModeActive ? {} : longPress)}
      >
        <td className={`${selectionModeActive ? 'px-2' : 'px-0'} py-2`} onClick={(e) => { e.stopPropagation(); if (selectionModeActive) toggleSelectionScope(rowScopeIds, !rowSelected) }}>
          {selectionModeActive ? (
            <input
              type="checkbox"
              className="rounded"
              checked={rowSelected}
              ref={(node) => {
                if (node) node.indeterminate = !rowSelected && isSelectionScopePartiallySelected(rowScopeIds)
              }}
              onChange={(event) => toggleSelectionScope(rowScopeIds, event.target.checked)}
            />
          ) : null}
        </td>
        {/* A grouped CHILD row shows no image.
            A name group is ONE product and carries ONE set of photos, drawn
            once on the group header by renderGroupThumbnail -- repeating it
            per child implies each row has its own, which is exactly the
            model the group replaced.
            renderMobileProductCard already did this; the desktop TABLE row
            did not, which is why the duplicate thumbnails and the resulting
            ragged left edge only appeared on large screens.
            The cell itself still renders (a <td> has to exist for the column
            to line up) -- it is the image inside that is dropped, so every
            child row's name starts at exactly the same x as the group
            title's. */}
        <td className="px-2 py-2">
          {indented ? null : thumbnailState.hasImage
            ? <ProductImg src={thumbnailState.thumbnail} alt={productName} className="h-14 w-14 rounded-lg bg-slate-50 object-contain p-0.5 cursor-zoom-in hover:ring-2 hover:ring-primary-400 dark:bg-slate-800" onClick={(e) => { e.stopPropagation(); openLightbox(thumbnailState.gallery, 0, productName) }}
                // Stopping only the CLICK left the row still opening its
                // detail flyout behind the lightbox: the row's long-press
                // handlers bind mousedown/touchstart (utils/longPress.ts),
                // which fire before click and drive their own onClick on
                // release. Tapping a thumbnail therefore opened the gallery
                // AND the detail at once. Stop the gesture at its start.
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()} />
            : <ProductImagePlaceholder className="h-14 w-14 rounded-lg" compact />}
        </td>
        {/* Name rail (col 3): child rows align EXACTLY with the group
            title -- no text indent. A child row leaves its image cell empty
            (see the image <td> above), and that empty image column is what
            visually sets the group title's thumbnail apart from its
            children, so an extra text indent on top would double the
            offset. The category band sits one column LEFT of this, on the
            image rail (see ProductsListSurface's geometry note). */}
        <td className={`${ROW_TEXT_GUTTER} py-2`}>
          {/* Name cell previously forced align-top on the <td> itself, so
              a row with no meta pills (the common case) sat pinned to the
              top of the row instead of vertically centered like every
              other cell (image, cost, selling, margin, stock all default-
              center) -- reported as the name reading "much higher" than
              the thumbnail next to it. Centering now happens on the whole
              block (pills + name together, via this wrapping flex column)
              instead of on the <td>, so a row WITH pills still stacks them
              above the name correctly, it just centers as one unit
              vertically within the row rather than pinning to the top. */}
          <div className="flex min-h-10 flex-col justify-center">
            {compactMeta.length ? (
              <div className="mb-1 flex max-w-[18rem] flex-wrap gap-1 lg:max-w-none lg:flex-nowrap lg:overflow-hidden">
                {compactMeta.map((item) => renderMetaPill(item ? {
                  key: String(item.key),
                  label: String(item.label || ''),
                  color: typeof item.color === 'string' ? item.color : undefined,
                  className: typeof item.className === 'string' ? item.className : undefined,
                } : null))}
              </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5">
              {/* Standalone rows (indented === false, i.e. not a child under
                  an expanded group) now match the group header's own title
                  weight (font-semibold) instead of font-medium, so a
                  standalone product reads as the same visual tier as a group
                  row rather than one step below it -- per the Aug 19 2026
                  ask. Child rows under a group keep font-medium, same as
                  before. */}
              <div {...getKhmerTextProps(productName, `min-w-0 break-words text-gray-900 dark:text-white ${indented ? 'font-medium' : 'font-semibold'}`)}>{productName}</div>
              {p.is_group ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">group</span> : null}
              {p.parent_id ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">variant</span> : null}
            </div>
            {dupInfo ? (
              <DuplicateResolverControl
                tr={tr}
                memberCount={dupInfo.members.length}
                busy={dupResolverBusyKey === dupInfo.key}
                disabled={!canMergeDuplicates}
                onKeepThis={() => void handleDuplicateKeepThis(Number(productId), dupInfo)}
                onKeepBoth={() => void handleDuplicateKeepBoth(dupInfo)}
              />
            ) : null}
          </div>
        </td>
        {/* border-l here (freed-up space between the Name and Details
            columns) instead of a whole new column -- per the Aug 19 2026
            ask for a divider before the details column. */}
        <td className="hidden border-l border-gray-100 px-3 py-2 align-top dark:border-gray-700 md:table-cell">
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
          <div className="font-medium text-red-700 dark:text-red-400">{fmtUSD(costUsd)}</div>
          {costKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(costKhr)}</div>}
        </td>
        <td className="px-3 py-2 text-right col-highlight-green">
          <div className="font-semibold text-green-700 dark:text-green-400">{fmtUSD(sellingUsd)}</div>
          {sellingKhr > 0 && <div className="text-xs text-gray-400">{fmtKHR(sellingKhr)}</div>}
          {specialUsd > 0 || specialKhr > 0 ? (
            <div className="mt-0.5 text-[10px] text-primary-600 dark:text-primary-400">
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
          {costUsd > 0 && sellingUsd > 0
            ? <div><div className={`font-medium text-xs ${marginUsd >= 0 ? 'text-primary-600' : 'text-yellow-600'}`}>{fmtUSD(marginUsd)}</div><div className="text-xs text-gray-400">{marginPct.toFixed(1)}%</div></div>
            : <span className="text-gray-300">N/A</span>}
        </td>
        <td className="px-3 py-2 text-right">
          {/* Stock status convention (this session): the qty+unit value
              itself is colored (red/yellow/green) instead of showing a
              separate "In"/"Low"/"Out" badge underneath -- the badge is
              still shown in the click-to-view-details panel (its own
              "Status" row, see ProductDetailModal.tsx), just not
              repeated here in the table. */}
          {/* Was a plain inline-flex div -- the unit chip (whitespace-nowrap,
              shrink-0) had nowhere to go but past the cell's right edge
              once the qty number plus a longer/Khmer unit name didn't both
              fit on one line ("stock qty overflowing its container" from
              the Aug 19 2026 ask). flex-wrap lets the chip drop to its own
              line inside the same right-aligned cell instead of spilling
              out of it. */}
          <div className={`flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 font-bold ${stockStatusTextClass}`}>
            <span>{String(qty || 0)}</span>
            {renderUnitChip(typeof p.unit === 'string' ? p.unit : undefined)}
          </div>
        </td>
      </tr>
    )
  }, [branchFilter, branchNameById, catMap, exchangeRate, fmtKHR, fmtUSD, getBranchQty, getBranchSummaryLabel, getBrandColor, getLongPressState, isSelectionScopeFullySelected, isSelectionScopePartiallySelected, openLightbox, promotionRules, renderMetaPill, renderUnitChip, selectionModeActive, t, toggleSelectionScope, tr, exactDuplicateIndex, dupResolverBusyKey, canMergeDuplicates, handleDuplicateKeepThis, handleDuplicateKeepBoth])

  const renderMobileProductCard = useCallback((p: ProductRecord, { indented = false }: { indented?: boolean } = {}) => {
    const productId = p.id ?? 0
    const productName = String(p.name || '')
    const brandName = String(p.brand || '')
    const barcode = String(p.barcode || '')
    const sellingUsd = Number(p.selling_price_usd || 0)
    const specialUsd = Number(p.special_price_usd || 0)
    const unitName = typeof p.unit === 'string' ? p.unit : undefined
    const {
      promotion,
      costUsd,
      qty,
      stockStatusTextClass,
    } = buildProductRowDisplayState(p, {
      branchFilter,
      exchangeRate,
      getBranchQty,
      t,
      promotionRules,
    })
    const thumbnailState = buildProductThumbnailState(p)
    const rowScopeIds = p.__mergedProductIds?.length ? p.__mergedProductIds : [productId]
    const rowSelected = isSelectionScopeFullySelected(rowScopeIds)
    // Exact duplicate? -> suppress click-to-detail, show the inline resolver
    // (same rule as renderDesktopProductRow; user spec item #3).
    const dupInfo = findRowDuplicateInfo(exactDuplicateIndex, productId, rowScopeIds)

    // Grouped child rows (indented) share the group's single merged card
    // (wrapper rendered by ProductsListSurface) instead of each getting its
    // own boxed "card" -- a thin top divider separates rows within the
    // group instead, matching Inventory's mobile grouped-row treatment
    // (InventoryProductsSurface.tsx) for parity between the two pages.
    // Ungrouped single products are untouched, still their own card.
    const rowClassName = indented
      ? `cursor-pointer select-none border-t border-gray-100 px-3 py-2.5 dark:border-gray-800 ${rowSelected ? 'ring-1 ring-primary-400 bg-primary-50/70 dark:bg-primary-900/20' : ''}`
      : `card cursor-pointer select-none px-3 py-2.5 ${rowSelected ? 'ring-1 ring-primary-400 bg-primary-50/70 dark:bg-primary-900/20' : ''}`

    // Same long-press/select-mode rules as renderDesktopProductRow -- see
    // its comment for the full reasoning. Not a hook; shares the same
    // per-row-id timer-slot Map (a row's product id is the same whether
    // it's rendered on the desktop table or here).
    const rowLongPressState = getLongPressState(Number(productId))
    const longPress = createLongPressHandlers(rowLongPressState, {
      disabled: selectionModeActive,
      onLongPress: () => toggleSelectionScope(rowScopeIds, true),
      onClick: () => { if (!dupInfo) setDetailProduct(p) },
    })
    // Same ghost-click guard as renderDesktopProductRow -- see its
    // comment and utils/longPress.ts's consumeLongPressClick for why
    // this is needed, not just belt-and-suspenders.
    const handleRowClick = () => {
      if (consumeLongPressClick(rowLongPressState)) return
      toggleSelectionScope(rowScopeIds, !rowSelected)
    }

    return (
      <div
        key={productId}
        data-product-jump-id={productId}
        className={rowClassName}
        onClick={selectionModeActive ? handleRowClick : undefined}
        {...(selectionModeActive ? {} : longPress)}
      >
        {/* No indent wrapper here anymore -- grouped (indented) rows already
            read as "part of the group" from the shared card/divider treatment
            above (see rowClassName just above: a plain top border between
            rows sharing one card, vs. a standalone product's own separate
            `card`). An extra left-padding indent on top of that was
            redundant, and it also meant a child row's text started to the
            right of the group title above it instead of lining up with it. */}
        <div className="flex items-start gap-3">
          {selectionModeActive ? (
            <input
              type="checkbox"
              className="rounded mt-1 flex-shrink-0 cursor-pointer"
              checked={rowSelected}
              ref={(node) => {
                if (node) node.indeterminate = !rowSelected && isSelectionScopePartiallySelected(rowScopeIds)
              }}
              onChange={(e) => { e.stopPropagation(); toggleSelectionScope(rowScopeIds, e.target.checked) }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          {/* Child rows under a group lose the image slot entirely now --
              not just a shrunk spacer -- per explicit follow-up direction
              on the Aug 19 2026 "Image 1" note (Part 208 had only shrunk
              this to a slim w-3 spacer; that still reserved dead space for
              an image that will never show here, since the group header's
              renderGroupThumbnail already shows one unified image for the
              whole name-group). Skipping the wrapper `<div>` outright
              (rather than rendering it empty) lets the parent's gap-3
              close the space up instead of leaving a gap-sized empty box. */}
          {indented ? null : (
            <div className="relative flex-shrink-0">
              {thumbnailState.hasImage
                ? <ProductImg src={thumbnailState.thumbnail} alt={productName} className="h-16 w-16 rounded-xl bg-slate-50 object-contain p-0.5 cursor-zoom-in dark:bg-slate-800" onClick={(e) => { e.stopPropagation(); openLightbox(thumbnailState.gallery, 0, productName) }}
                // Stopping only the CLICK left the row still opening its
                // detail flyout behind the lightbox: the row's long-press
                // handlers bind mousedown/touchstart (utils/longPress.ts),
                // which fire before click and drive their own onClick on
                // release. Tapping a thumbnail therefore opened the gallery
                // AND the detail at once. Stop the gesture at its start.
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()} />
                : <ProductImagePlaceholder className="h-16 w-16 rounded-xl" />}
              <ProductDiscountBadge product={p} promotion={promotion} fmtUSD={fmtUSD} label={tr('discounts', 'Discounts')} overlay />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div {...getKhmerTextProps(productName, 'truncate text-sm font-semibold text-gray-900 dark:text-white')} title={productName}>{productName}</div>
              </div>
              {/* Batch count rides the name row as a small YELLOW badge
                  (user, Aug 30: "add number of batches yellow next to the
                  standalone product rows and child rows"); the truncating
                  name above can never touch it. */}
              {Number((p as { batch_count?: number }).batch_count || 0) > 0 ? (
                <span
                  className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  title={`${Number((p as { batch_count?: number }).batch_count || 0)} ${t('batches') || 'batches'}`}
                >
                  {Number((p as { batch_count?: number }).batch_count || 0)}
                </span>
              ) : null}
            </div>
            {/* min-h matches one chip's height (text-[10px] line ~15px +
                py-0.5 = 19px) so a product with NO barcode/brand keeps the
                price/qty line at the same vertical spot as its neighbours
                instead of the row sliding up into the gap (user, Aug 30:
                "instead of moving the price and quantity row just keep it
                constant there"). */}
            <div className="mt-0.5 flex min-h-[1.1875rem] flex-wrap gap-1">
              {/* Small-screen default card shows the BARCODE here in place of
                  the category (user, Aug 29: "hide the category inside the
                  details ... replace the outside with barcode"). Category is
                  one tap away in the detail view; a scannable code is more
                  useful on the card face. Brand stays. */}
              {barcode ? (
                <span
                  className="inline-block max-w-[10rem] truncate rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  title={barcode}
                >
                  {barcode}
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
            {/* Price/stock lines moved in here, inside the same flex-1 column
                as the name/category/brand above it, instead of living as a
                sibling block with its own hand-tuned `pl-[5.35rem]` meant to
                eyeball-match the image width + gap. That fixed value didn't
                actually match the flex layout's real offset, so this line
                sat further right than the category/brand row above it. Being
                a normal child of the same column means it now lines up
                exactly, with no hardcoded offset to keep in sync by hand.

                ONE row, only one row (user, Aug 28 2026, with a screenshot
                of the two-row card): every price AND the stock qty share a
                single line. This SUPERSEDES the earlier "selling price
                should get its own row" split from the Aug-25 backlog --
                the user saw the split live and rejected it, so don't
                re-split without a fresh ask. Selling (green) leads and
                keeps its bigger weight so it still reads first; special/
                discount figures ride beside it; then cost (red) and the
                status-colored qty+unit, "|"-separated like before.
                flex-wrap stays purely as overflow protection for genuinely
                too-narrow cards -- the default render is one line. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              <span className="whitespace-nowrap font-semibold text-green-700 dark:text-green-400">{fmtUSD(sellingUsd)}</span>
              {specialUsd > 0 ? (
                // The VIP price (the special_price_* field -- labelled "VIP
                // Price" elsewhere, e.g. ProductDetailModal; the old hardcoded
                // "Special" here was a mislabel). On the small-screen default
                // card it shows as JUST the number, colour-coded (primary/blue)
                // with no text label -- the colour distinguishes it from selling
                // (green) and cost (red) on this compact one-line price row
                // (user, Aug 29 2026). A "|" separates it from the selling price
                // beside it, matching the cost/qty dividers on this same row
                // (user, Aug 31). The desktop table row keeps its own labelling.
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="whitespace-nowrap font-medium text-primary-700 dark:text-primary-400">
                    {fmtUSD(specialUsd)}
                  </span>
                </>
              ) : null}
              {promotion.active ? (
                <span className="whitespace-nowrap font-medium text-rose-600 dark:text-rose-300">
                  {String(p.discount_label || tr('discounts', 'Discounts'))} {fmtUSD(promotion.applied_price_usd)}
                </span>
              ) : null}
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="whitespace-nowrap text-red-600">{fmtUSD(costUsd)}</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              {/* Colored by stock status (red/yellow/green) instead of the
                  separate "In"/"Low"/"Out" badge this row used to show up
                  in its header line -- see stockStatusTextClass above. */}
              <span className={withKhmerTextClass(unitName, `inline-flex min-w-0 max-w-full items-center whitespace-nowrap font-medium ${stockStatusTextClass}`)}>{String(qty || 0)}{renderUnitChip(unitName)}</span>
            </div>
            <ProductBatchPreview product={p} branchId={branchFilter} tr={tr} compact />
            {dupInfo ? (
              <DuplicateResolverControl
                tr={tr}
                memberCount={dupInfo.members.length}
                busy={dupResolverBusyKey === dupInfo.key}
                disabled={!canMergeDuplicates}
                onKeepThis={() => void handleDuplicateKeepThis(Number(productId), dupInfo)}
                onKeepBoth={() => void handleDuplicateKeepBoth(dupInfo)}
              />
            ) : null}
          </div>
        </div>
      </div>
    )
  }, [branchFilter, catMap, exchangeRate, fmtUSD, getBranchQty, getBrandColor, getLongPressState, isSelectionScopeFullySelected, isSelectionScopePartiallySelected, openLightbox, promotionRules, renderUnitChip, selectionModeActive, t, toggleSelectionScope, tr, exactDuplicateIndex, dupResolverBusyKey, canMergeDuplicates, handleDuplicateKeepThis, handleDuplicateKeepBoth])

  // One unified thumbnail for a whole name-group (see the `indented`
  // branches just above, which omit each row's own image once a group
  // header is showing this instead). Shows the group's lead product's
  // image specifically -- not just whichever row in the group happens to
  // have one uploaded first. Previously this scanned every row in display
  // order and used the first with an image, which meant the header could
  // show a variant's photo instead of the lead product's, and which photo
  // showed up was liable to change just from reordering/adding variants.
  // Uploading is still done from the lead product's own edit form -- this
  // only changes which image the collapsed header reflects.
  // Mobile-first sizing (h-16 w-16, matching a standalone card's own
  // image -- see renderMobileProductCard; trimmed from h-20 on Aug 29 so the
  // card doesn't grow too tall on small screens) that adjusts at the
  // `sm:` breakpoint where the desktop table takes over (its row image is
  // the larger h-14 w-14, and this header sits inline next to the group
  // title/chevron rather than as its own block, so it stays a touch smaller
  // there at sm:h-12 sm:w-12 -- both enlarged from the previous tiny w-10/w-8
  // per user request that desktop thumbnails were too small).
  const renderGroupThumbnail = useCallback((group: { rows?: ProductRecord[]; leadProduct?: ProductRecord }) => {
    const state = buildGroupThumbnailState(group.rows, group.leadProduct)
    return state.hasImage
      ? <ProductImg src={state.thumbnail} alt={String(group.leadProduct?.name || group.rows?.[0]?.name || '')} className="h-16 w-16 rounded-xl bg-slate-50 object-contain p-0.5 cursor-zoom-in sm:h-12 sm:w-12 sm:rounded-lg dark:bg-slate-800" onClick={(event) => { event.stopPropagation(); openLightbox(state.gallery, 0, String(group.leadProduct?.name || group.rows?.[0]?.name || '')) }} />
      : <ProductImagePlaceholder className="h-16 w-16 rounded-xl sm:h-12 sm:w-12 sm:rounded-lg" compact />
  }, [openLightbox])

  // Group-title three-dot menu: "Add child row" (opens the variant modal,
  // same flow as the detail sheet's own Add Variant button) and "Add
  // image" (opens the lead product's edit form straight to the Basic Info
  // tab, where the image uploader lives). Per the Aug 19 2026 ask. Acts on
  // the group's leadProduct, same product renderGroupThumbnail already
  // draws its image from, so "add image" changes the same photo the group
  // header displays.
  // 11.3: press-and-hold on a group TITLE row to enter select mode with the
  // whole group selected -- the same long-press gesture the product rows
  // already use, which the group header was missing. Keyed in a distinct
  // (negative) id space so a group's hold-state never collides with a
  // product row's. The onClickCapture guard eats the follow-up "ghost"
  // click after a hold so the group does not also toggle expand/collapse:
  // once the hold fires, selectionModeActive flips and these handlers are
  // detached, so end() never resets `fired` and consumeLongPressClick can
  // swallow that one click (same mechanism the rows use).
  const bindGroupHold = useCallback((group: { anchorId?: string | number; ids?: Array<string | number> }): Record<string, unknown> => {
    const state = getLongPressState(-Number(group.anchorId ?? 0))
    const guard = {
      onClickCapture: (event: ReactMouseEvent) => {
        if (consumeLongPressClick(state)) { event.stopPropagation(); event.preventDefault() }
      },
    }
    if (selectionModeActive) return guard
    const handlers = createLongPressHandlers(state, {
      disabled: false,
      onLongPress: () => toggleSelectionScope((group.ids as Array<string | number>) || [], true),
      onClick: () => {},
    })
    return { ...handlers, ...guard }
  }, [getLongPressState, selectionModeActive, toggleSelectionScope])

  const renderGroupActions = useCallback((group: { key: string; leadProduct?: ProductRecord }) => {
    const lead = group.leadProduct
    if (!lead) return null
    return (
      <PortalMenu
        align="right"
        compact
        triggerWrapperClassName="shrink-0"
        trigger={<button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200" aria-label={tr('more_actions', 'More actions')}><MoreVertical className="h-4 w-4" /></button>}
        items={[
          !lead.parent_id && { label: tr('add_variant', 'Add variant'), icon: <Plus className="h-3.5 w-3.5" />, onClick: () => setVariantModal(lead) },
          { label: tr('add_image', 'Add image'), icon: <ImagePlus className="h-3.5 w-3.5" />, onClick: () => openProductFormTab(lead, 'basic') },
        ]}
      />
    )
  }, [openProductFormTab, tr])

  if (loadError && !loading && !products.length && !categories.length && !units.length && !branches.length) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">!</div>
      <p className="text-red-600 dark:text-red-400 font-medium">{loadError}</p>
      <button type="button" onClick={() => load(false)} className="btn-primary">Retry</button>
    </div>
  )

  // Top padding lives on the header row below, NOT on this page-scroll root:
  // a `pt` here would sit ABOVE the sticky search row's `top-0` anchor, so on
  // scroll a list row showed through the strip between the screen edge and the
  // pinned search bar (user, Aug 29: "search did not stick to the very top").
  // With the scroll container flush-topped, the search bar pins to the true
  // top and nothing bleeds above it.
  return (
    <div className="page-scroll px-3 pb-3 sm:px-6 sm:pb-6">
      {/* Page title + section switcher on the left; Manage / History / Add
          product on the right of the SAME row (Y15/Y16: the header actions
          join the section-chip row instead of getting their own toolbar
          row). Import and Export used to also render as their own buttons
          here (duplicating what Manage's dropdown already offered) and
          History used to sit separately in the search row below -- both
          folded into HeaderActions.tsx. */}
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 pt-3 sm:pt-6">
        {/* No page <h1> here: the section switcher below already labels the
            page ("Products" / "Stock Changes" / "Duplicates"), so a separate
            heading repeating "Products" was redundant on EVERY screen, not just
            phones (user, Aug 31: "product page still use title page in addition
            to the section ... remove that"). */}
        {/* Y15: section switcher (Products | Stock Changes), same pill
            pattern as the Promotions page. Stock Changes stops being a
            folded card at the bottom of the listing and becomes its own
            section reached from here. */}
        <div className="inline-flex shrink-0 rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setActiveProductSection('products')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeProductSection === 'products' ? 'bg-white text-primary-600 shadow dark:bg-gray-900' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {t('products') || 'Products'}
          </button>
          <button
            type="button"
            onClick={() => setActiveProductSection('stock_changes')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeProductSection === 'stock_changes' ? 'bg-white text-primary-600 shadow dark:bg-gray-900' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {tr('stock_change_ledger', 'Stock Changes', 'ការផ្លាស់ប្តូរស្តុក')}
          </button>
          {/* Duplicates review (possibly-same residue) -- same section-chip
              pattern, gated by the same permission as the merge tool since
              its actions are the same kind of merge. */}
          {canMergeDuplicates ? (
            <button
              type="button"
              onClick={() => setActiveProductSection('duplicates')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeProductSection === 'duplicates' ? 'bg-white text-primary-600 shadow dark:bg-gray-900' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              {tr('product_duplicates_section', 'Duplicates', 'ស្ទួន')}
            </button>
          ) : null}
        </div>
        <div className="w-full min-w-0 overflow-x-auto pb-1 sm:ml-auto sm:w-auto sm:flex-shrink-0 sm:pb-0">
          {/* Each handler is passed only when this role's tier actually
              permits the action -- HeaderActions drops any control whose
              handler is undefined (see its own comment). `can()` reads
              utils/permissionActions.ts, the same table the admin
              permission editor renders, so what's visible here always
              matches what an admin was shown when granting the tier.
              Previously every one of these buttons rendered
              unconditionally: Import/Merge/Cleanup/lookups all 403'd on
              click for a Review Required user, and Export -- which is
              built client-side and had no server route to check -- simply
              worked, despite the Products permission description stating
              it required Full Access. */}
          <ProductsHeaderActions
            onManageCats={canManageLookups ? ()=>setModal('cats') : undefined}
            onManageBrands={canManageLookups ? ()=>setModal('brands') : undefined}
            onManageUnits={canManageLookups ? ()=>setModal('units') : undefined}
            onImport={canImportProducts ? ()=>setModal('bulk') : undefined}
            onExport={canExportProducts ? () => {
              // Default to the richest scope available each time the
              // panel opens: Selected (if anything's checked) beats
              // Filtered (if filters are narrowing the list) beats the
              // plain visible/full list -- same "most likely to be what
              // was meant" ordering buildProductExportScopes returns.
              setExportScopeId(productExportScopes[0]?.id || 'visible')
              setExportFieldsOpen(true)
            } : undefined}
            /* Stock Changes section replaces the catalog "Add Product" button
               with its own "Adjust" menu (user, Aug 31) -> drop onAdd there;
               HeaderActions hides any undefined-handler control. */
            onAdd={canAddProduct && activeProductSection !== 'stock_changes' ? ()=>{setSelected(null);setFormInitialTab('basic');setModal('form')} : undefined}
            // The merged Add Stock flow rides the same Add menu. Hidden on
            // the Stock Changes section, which carries its own Adjust menu.
            onAddStock={canAdjustInventoryStock && activeProductSection !== 'stock_changes' ? () => setAddStockOpen(true) : undefined}
            onMergeDuplicates={canMergeDuplicates ? openMergeDuplicatesReview : undefined}
            onZeroQuantityCleanup={canZeroQuantityCleanup ? openZeroQuantityCleanup : undefined}
            onWireImages={canWireImages ? openWireImages : undefined}
            historySlot={historyReady ? (
              <Suspense fallback={<div className="h-9 min-w-0 flex-1 sm:flex-none sm:min-w-[6.5rem]" aria-hidden="true" />}>
                <ActionHistoryBar history={actionHistory} className="min-w-0 flex-1 sm:flex-none sm:min-w-[6.5rem]" showLabel t={t} />
              </Suspense>
            ) : (
              <div className="h-9 min-w-0 flex-1 sm:flex-none sm:min-w-[6.5rem]" aria-hidden="true" />
            )}
            t={t}
          />
        </div>
      </div>

      {/* Y15: everything below is the "products" listing section; the Stock
          Changes ledger renders as its own section (see the switcher above)
          instead of a folded card at the bottom of this same scroll. */}
      {activeProductSection === 'products' && (<>

      {/* Y20: the items-range / per-page / pages controls used to render as
          their own bar here (a whole row above the search). They now fold
          into the select-all row below, as the shared PaginationControls
          compact `rangeAsPageSize` pill -- one line: prev / editable page /
          the "1-20" range chip (which IS the per-page dropdown) / total
          pages / next. The second, compact copy still renders below the list
          (see the PaginationControls after ProductsListSurface). */}

      {/* The "Refreshing products..." state is already surfaced inside the
          list body itself (ProductsListSurface's empty/refreshing state,
          below the sticky header) -- this used to also render a second,
          redundant banner up here above the sticky search bar, so the same
          message showed twice on screen at once. Removed; keep only the
          one inside the list surface. */}

      {/* Y14: ONLY the search + filter row pins to the top of the page's
          scroll container while scrolling. The select-all / bulk-action bar
          used to sit inside this same sticky wrapper and pinned too, wasting
          a whole pinned row of height on large screens; it now sits below in
          normal flow and scrolls away. top-0 (was top-2): the old 0.5rem
          offset left a gap above the pinned row through which a category
          section header showed -- the background now meets the top edge.
          bg-gray-50/dark:bg-gray-900 matches #app-root's background (the
          page-scroll itself is transparent) so list rows scrolling
          underneath don't show through while this is stuck. */}
      {/* The "Created" batch-received-date range sits ABOVE the search row
          (user, Aug 30: "move the start and end date above the search
          function row") as a fit-to-content pill, not a stretched bar. */}
      <div className="sticky top-0 z-30 -mx-1 bg-gray-50/95 pb-2 pt-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        {/* The date-range row rides INSIDE the sticky wrapper now (user,
            Aug 31: "the search bar row and the date both can be pinned and
            stick so when scrolling it shows") -- both rows pin together. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-0.5">
          <DateTimeRangePicker
            t={t}
            showTime={false}
            value={{ startDate: createdDateFrom, endDate: createdDateTo, startTime: '', endTime: '' }}
            onChange={(range) => { setCreatedDateFrom(range.startDate); setCreatedDateTo(range.endDate) }}
          />
        </div>
        {/* Y13: a plain page-level search row (the folding "Search &
            Filters" SectionCard wrapper was removed). SearchInput's own
            `min-w-0 flex-1` default handles narrow-screen shrink; every
            other child here is shrink-0/icon-only. History moved to the
            header row (ProductsHeaderActions' historySlot); the AND/OR
            toggle was removed (Aug 19 2026), so searchMode stays 'AND'. */}
        <div className="flex items-center gap-1.5 px-0.5">
            <SearchInput
              id="products-search"
              name="products_search"
              value={search}
              onChange={handleSearchInputChange}
              placeholder={t('search_products_placeholder') || `${t('search') || 'Search'} products`}
              title={t('search_comma_tip') || 'Comma separates OR-groups \u00b7 space = AND within a group'}
              inputClassName="text-sm"
            />
            <ScanSearchButton onDetected={setSearch} t={t} />
            {/* AND/OR toggle removed (Aug 19 2026 UI request): matching
                ALL terms is now the only mode -- search always behaves as
                if this were locked to 'AND'. searchMode state/plumbing
                below is left in place (it's threaded through the search
                query builder, filter cache key, and dependency arrays) but
                its setter is never called anymore, so it stays 'AND'
                permanently; ripping the plumbing out entirely would touch
                far more surface for zero behavior change. */}
            {/* History moved up to the header row next to Manage/Add
                product (see ProductsHeaderActions' historySlot) -- it used
                to render here as its own icon-only button, disconnected
                from the other page-level actions and one more control
                competing for room in this already-busy search row. */}
            <FilterMenu
              label={t('filters') || 'Filters'}
              activeCount={activeFilters - (createdDateFrom ? 1 : 0) - (createdDateTo ? 1 : 0)}
              sections={productFilterSections}
              onClear={clearAllFilters}
              onOpenChange={setIsProductFilterMenuOpen}
              mobileIconOnly
            />
          </div>
      </div>

      {/* Pagination sits BELOW the search row (user, Aug 31: "page back and
          forth, items per page and pages ... below the search bar row", never
          between the date range and the search row). The matching compact
          pager stays at the end of the list. */}
      <div className="mb-2 flex justify-end px-0.5">
        <PaginationControls
          compact
          rangeAsPageSize
          editablePageSizeInput={false}
          page={productPage}
          pageSize={productSafePageSize}
          totalItems={productTotal}
          onPageChange={setProductPage}
          onPageSizeChange={(nextValue) => { setProductPageSize(nextValue); setProductPage(1) }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          t={t}
        />
      </div>

        {bulkDeleteJobStatus && (bulkDeleteJobStatus.status === 'pending' || bulkDeleteJobStatus.status === 'processing') && (
          <div className="bulk-toolbar mb-2 flex items-center gap-3 rounded-2xl border px-3 py-2 text-xs sm:rounded-xl">
            <span className="shrink-0 font-medium text-slate-700 dark:text-slate-100">
              Deleting {bulkDeleteJobStatus.processedCount.toLocaleString()} / {bulkDeleteJobStatus.totalCount.toLocaleString()}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-primary-600 transition-[width]"
                style={{ width: `${bulkDeleteJobStatus.totalCount ? Math.min(100, (bulkDeleteJobStatus.processedCount / bulkDeleteJobStatus.totalCount) * 100) : 0}%` }}
              />
            </div>
            <button
              className="shrink-0 text-slate-500 underline hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
              onClick={() => productApi.cancelBulkDeleteJob(bulkDeleteJobStatus.id).catch(() => {})}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Y14: select-all + bulk-action bar -- no longer pinned (it used to
            sit inside the sticky wrapper above). It scrolls away in normal
            flow while the search / filter row above stays pinned.
            Card chrome only WHILE selecting -- idle, this row holds nothing
            but the self-bordered pager pill, and boxing that again was the
            double-card look (Aug 30 report). */}
        {/* Bulk bar renders ONLY while selecting -- the pager moved up into
            the Created-date row, so idle this row costs zero height. */}
        <div className={hasSelected ? 'bulk-toolbar mb-2 overflow-hidden rounded-2xl border shadow-sm sm:rounded-xl' : 'hidden'}>
          <div className="px-2 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                {hasSelected ? (
                  <span className="inline-flex min-w-0 items-center overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100">
                    <span className="truncate whitespace-nowrap">{productSelectedLabel}</span>
                  </span>
                ) : null}
                {hasSelected ? (
                  <button
                    type="button"
                    disabled={bulkActionBusy}
                    onClick={handleBulkDelete}
                    className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border border-rose-200 bg-white px-2.5 text-[10px] font-semibold text-rose-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:bg-slate-950 dark:text-rose-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/20"
                  >
                    {productChipLabels.delete}
                  </button>
                ) : null}
            </div>
          </div>
          {hasSelected ? (
            <div className="border-t border-primary-100/80 px-3 py-2.5 dark:border-primary-900/40">
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
        </div>

      {/* Expanded bulk-edit panels -- intentionally OUTSIDE the sticky
          group above: these are full edit forms, not quick-glance controls,
          so they scroll away like any other page content instead of eating
          permanent screen space. Each now gets its own rounded card (was
          previously a border-t continuation of the sticky card above it). */}
      {hasSelected && bulkEditMode === 'info' && (
        <div className="mb-2 rounded-xl border border-primary-200 bg-white px-4 py-3 dark:border-primary-700 dark:bg-zinc-800">
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
        <div className="mb-2 rounded-xl border border-primary-200 bg-white px-4 py-3 dark:border-primary-700 dark:bg-zinc-800">
          <p className="text-xs text-gray-500 mb-2">Update pricing for <strong>{selectedVisibleCount}</strong> products</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500 block mb-1">Selling Price (USD)</label>
              <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Selling Price (KHR)</label>
              <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_khr??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_khr:e.target.value}))} placeholder="Leave blank to keep" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">VIP Price (USD)</label>
              <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.special_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,special_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
            <div><label className="text-xs text-gray-500 block mb-1">VIP Price (KHR)</label>
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

          {/* Relative adjustment, kept in the same panel as the absolute
              "set every price to X" fields above but visually separated,
              because the two are easy to confuse and one of them flattens a
              mixed catalogue to a single value. The wording states which is
              which rather than relying on the person inferring it. */}
          <div className="mt-4 border-t border-gray-200 pt-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              {tr('bulk_price_adjust_title', 'Or raise / lower prices by an amount')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">{tr('bulk_price_direction', 'Direction')}</label>
                <AppSelect
                  ariaLabel={tr('bulk_price_direction', 'Direction')}
                  className="text-xs"
                  value={String(bulkEditForm.adjust_direction || 'increase')}
                  options={[
                    { value: 'increase', label: tr('bulk_price_increase', 'Increase') },
                    { value: 'decrease', label: tr('bulk_price_decrease', 'Decrease') },
                  ]}
                  onChange={(value) => setBulkEditForm((f) => ({ ...f, adjust_direction: value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{tr('bulk_price_amount', 'Amount')}</label>
                <input
                  className="input w-24 py-1 text-xs"
                  type="number"
                  step="0.01"
                  min="0"
                  value={String(bulkEditForm.adjust_amount ?? '')}
                  onChange={(e) => setBulkEditForm((f) => ({ ...f, adjust_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{tr('currency', 'Currency')}</label>
                <AppSelect
                  ariaLabel={tr('currency', 'Currency')}
                  className="text-xs"
                  value={String(bulkEditForm.adjust_currency || 'usd')}
                  options={[
                    { value: 'usd', label: 'USD' },
                    { value: 'khr', label: 'KHR' },
                  ]}
                  onChange={(value) => setBulkEditForm((f) => ({ ...f, adjust_currency: value }))}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {([
                ['adjust_selling', tr('selling_price', 'Selling price'), true],
                ['adjust_special', tr('special_price', 'Special price'), false],
                ['adjust_cost', tr('cost_price', 'Cost price'), false],
              ] as const).map(([key, label, defaultOn]) => (
                <label key={key} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={bulkEditForm[key] === undefined ? defaultOn : !!bulkEditForm[key]}
                    onChange={(e) => setBulkEditForm((f) => ({ ...f, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={!!bulkEditForm.adjust_skip_zero}
                onChange={(e) => setBulkEditForm((f) => ({ ...f, adjust_skip_zero: e.target.checked }))}
              />
              {tr('bulk_price_skip_zero', 'Skip products priced 0 (not yet priced)')}
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                disabled={bulkActionBusy}
                className="btn-secondary px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                onClick={runBulkProductPriceAdjustment}
              >
                {tr('bulk_price_apply_adjustment', 'Apply adjustment')}
              </button>
              {/* P3: the explicit whole-system scope -- server-side set
                  UPDATEs with a true preview count; never materializes the
                  catalog's ids in the client, and has NO undo (stated in
                  the confirm). */}
              <button
                disabled={bulkActionBusy}
                className="rounded-lg border border-amber-300 px-4 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-600/50 dark:text-amber-300 dark:hover:bg-amber-900/20"
                onClick={runBulkPriceAdjustAllProducts}
              >
                {tr('bulk_price_apply_all', 'Apply to ALL products in the system…')}
              </button>
            </div>
          </div>
        </div>
      )}

      {hasSelected && bulkEditMode === 'stock' && (
        <div className="mb-2 rounded-xl border border-primary-200 bg-white px-4 py-3 dark:border-primary-700 dark:bg-zinc-800">
          <p className="text-xs text-gray-500 mb-2">Adjust stock for <strong>{selectedVisibleCount}</strong> products</p>
          <div className="flex gap-3 flex-wrap items-end">
            <div><label className="text-xs text-gray-500 block mb-1">Quantity</label>
              <input className="input text-xs py-1 w-24" type="number" min="0" value={bulkEditForm.qty??1} onChange={e=>setBulkEditForm(f=>({...f,qty:e.target.value}))} />
              {/* Same 1/5/10/20 quick-pick chips as InventoryStockModals.tsx's
                  Adjust modal and BranchStockAdjuster.tsx's per-branch rows --
                  this bulk panel was the one remaining Add/Remove/Set stock
                  flow still missing them. */}
              <div className="mt-1 flex flex-wrap gap-1">
                {[1, 5, 10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${Number(bulkEditForm.qty) === n ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}
                    onClick={() => setBulkEditForm(f => ({ ...f, qty: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Action</label>
              {/* Same border-2 / primary-50+primary-700 selected-state styling
                  as Inventory's Adjust-stock modal and the product edit
                  page's BranchStockAdjuster -- was previously a solid
                  blue-600 fill, its own separate look for the same
                  three-way choice. Recolored brass/primary Aug 24 2026. */}
              <div className="flex gap-1">
                {[['add', t('add') || 'Add'],['remove', t('remove') || 'Remove'],['set', `= ${t('set')||'Set'}`]].map(([v,l])=>(
                <button key={v} onClick={()=>setBulkEditForm(f=>({...f,action:v}))} className={`text-xs py-1.5 px-2.5 rounded-lg border-2 font-medium ${(bulkEditForm.action||'add')===v?'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300':'border-gray-200 dark:border-zinc-600 text-gray-600 dark:text-gray-300'}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={handleBulkAddStock}>Apply to {selectedVisibleCount} products</button>
        </div>
      )}

      {hasSelected && bulkEditMode === 'branch' && (
        <div className="mb-2 rounded-xl border border-primary-200 bg-white px-4 py-3 dark:border-primary-700 dark:bg-zinc-800">
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
      {/* A-Z filter row removed (Aug 19 2026 UI request): it narrowed the
          list to one letter, which duplicated what the list's own A/B/C...
          section headers already show, and it isn't needed to browse by
          letter -- the AlphaIndexRail below (fixed, vertical, near the
          sidebar) jumps to a section instead of hiding everything else.
          initialFilter/initialOptions plumbing removed with it below. */}

      <ProductsListSurface
        allVisibleProducts={allVisibleProducts}
        collapsedProductGroups={collapsedProductGroups}
        collapsedProductSections={collapsedProductSections}
        getGroupSummaryParts={getGroupSummaryParts}
        initialDesktopRevealReady={loadedOnceRef.current || !loading}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        allVisibleIds={visibleIds}
        loading={loading}
        productSections={productSections}
        productTotal={productTotal}
        productTotalLabel={productSummaryLabel}
        refreshingProducts={refreshingProducts}
        renderDesktopProductRow={renderDesktopProductRow}
        bindGroupHold={bindGroupHold}
        renderGroupActions={renderGroupActions}
        renderGroupThumbnail={renderGroupThumbnail}
        renderMobileProductCard={renderMobileProductCard}
        selectionModeActive={selectionModeActive}
        t={t}
        toggleProductGroup={toggleProductGroup}
        toggleProductSection={toggleProductSection}
        toggleSelectionScope={toggleSelectionScope}
        tr={tr}
        visibleProducts={visibleProducts}
      />

      <AlphaIndexRail letters={visibleLetters} onJump={jumpToLetter} label={t('jump_to_letter') || 'Jump to letter'} />

      {/* Second, non-sticky copy of pagination below the list -- same
          control, same state, just so paging through a long list doesn't
          require scrolling back up to the bar above the search row. */}
      <div className="mt-2 flex justify-center">
        <PaginationControls
          page={productPage}
          pageSize={productSafePageSize}
          totalItems={productTotal}
          onPageChange={setProductPage}
          onPageSizeChange={(nextValue) => { setProductPageSize(nextValue); setProductPage(1) }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          t={t}
          compact
          rangeAsPageSize
          editablePageSizeInput={false}
        />
      </div>

      </>)}

      {/* D1 (Part 415) / Y15: the user's Stock Change ledger -- every
          recorded stock action with its derived running balance. It used to
          be a folded "reports" card at the bottom of the products listing;
          it is now its own page section (reached from the header switcher),
          so it renders full instead of collapsed. It carries its own view
          switcher, search and date-range filter row, so only a one-line
          hint is added here. Read-only over existing movement history (its
          own lazy chunk, loaded when the section is first opened). Image-only
          users never reach this component at all (the Products() wrapper
          routes them to the restricted view), and the endpoint independently
          requires a real products/inventory tier. */}
      {activeProductSection === 'stock_changes' && (
        <div className="mt-1">
          {/* The one-line hint that used to sit here moved INTO the section,
              behind an InfoHint next to the total (density: instructions go
              into the info toolkit, not inline above the layout). */}
          <Suspense fallback={<div className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</div>}>
            <StockChangeSection t={t} />
          </Suspense>
        </div>
      )}

      {/* The Add menu's merged Add Stock flow (any section) -- the shipment
          receiver, which covers a whole delivery and a single product. */}
      {addStockOpen ? (
        <Suspense fallback={null}>
          <FastStockInModal
            branchOptions={branches.map((branch) => ({ value: String(branch.id), label: String(branch.name || branch.id) }))}
            defaultBranchId={null}
            tr={tr}
            notify={notify}
            onClose={() => setAddStockOpen(false)}
            onDone={() => { void load(true) }}
          />
        </Suspense>
      ) : null}

      {/* Duplicates review section -- mirrors the contacts Possible
          Duplicates panel for the product catalog. "Open" on a row jumps
          resolution happens IN PLACE via the tab's own edit float — it
          never navigates away (user, Aug 30). */}
      {activeProductSection === 'duplicates' && canMergeDuplicates && (
        <div className="mt-1">
          <Suspense fallback={<div className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</div>}>
            <ProductDuplicatesTab t={t} notify={notify} />
          </Suspense>
        </div>
      )}

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
            onAdjustStock={() => { setDetailProduct(null); openProductFormTab(detailProduct, 'stock') }}
            onClose={()=>setDetailProduct(null)}
            onImageClick={(src, gallery, startIndex = 0) => {
              const sourceGallery = buildProductLightboxGalleryInput(src, gallery)
              openLightbox(sourceGallery, startIndex, String(detailProduct?.name || ''))
            }}
            onManageBatches={() => setManageBatchesProduct(detailProduct)}
          />
        </Suspense>
      )}

      {manageBatchesProduct ? (
        <Suspense fallback={null}>
          <ManageBatchesModal
            product={manageBatchesProduct}
            branchSelectOptions={branchSelectOptions}
            defaultBranchId={defaultBranchId}
            notify={notify}
            onClose={() => setManageBatchesProduct(null)}
            onChanged={() => load(true)}
            t={t}
            tr={tr}
          />
        </Suspense>
      ) : null}

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
            initialAction={(bulkEditForm.action as 'add' | 'remove' | 'set' | undefined) || 'add'}
            initialQuantity={bulkEditForm.qty}
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
              // The modal's own mutation loop never refreshes the page
              // itself -- undo (restoreProductSnapshots) and redo
              // (addStockToProducts) both already end in `load(true)`,
              // but the *first* application of a bulk add had no
              // refresh at all, so the list kept showing pre-add
              // quantities until something unrelated (a re-search, a
              // filter change) happened to reload it. Not pinning the
              // affected rows here -- `branchId` can be '' ("Global (no
              // branch)"), which the server resolves to its own default
              // branch that isn't echoed back to this modal, the same
              // ambiguous-target case already left unpinned in
              // Inventory.tsx's adjust handler (Part 142) -- just the
              // refresh a successful mutation should always have had.
              if (done > 0) await load(true)
            }}
            t={t}
          />
        </Suspense>
      )}
      {modal==='form' && (
        <Suspense fallback={null}>
          <ProductForm
            product={modalProduct}
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
            onMinimize={!modalProduct ? (label: string) => {
              minimizeWork({ key: 'add-product', kind: 'add_product', pageId: 'products', label })
              setModal(null); setSelected(null); setFormInitialTab('basic')
            } : undefined}
            onDelete={selected ? () => { const target = selected; setModal(null); setSelected(null); setFormInitialTab('basic'); handleDelete(target) } : undefined}
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
          <ImportModeWizard onClose={()=>setModal(null)} onDone={() => { void load() }} t={t} products={products} branches={branchOptions} />
        </Suspense>
      )}
      {exportFieldsOpen && (
        <Suspense fallback={null}>
          <ExportFieldsModal
            rowCount={filtered.length}
            scopes={productExportScopes.map((scope) => ({ id: scope.id, label: scope.label, count: scope.count }))}
            selectedScopeId={exportScopeId}
            onScopeChange={setExportScopeId}
            onClose={() => setExportFieldsOpen(false)}
            onConfirm={(groups, format) => {
              setExportFieldsOpen(false)
              const scope = productExportScopes.find((s) => s.id === exportScopeId) || productExportScopes[0]
              // 'full' scope explicitly means "ignore filters" (see
              // buildProductExportScopes' own comment/label for it) -- the
              // branch filter is one of those filters, so Stock_Quantity
              // there should stay the real cross-branch aggregate, not one
              // branch's row. 'visible'/'selected' both respect the
              // current filters otherwise, so they should respect the
              // branch filter's own number too -- see
              // buildProductExportRows' branchId comment for why this
              // matters (an unscoped export while branch-filtered used to
              // write every OTHER branch's stock into Stock_Quantity too).
              const branchId = scope?.id !== 'full' && branchFilter !== 'all' ? branchFilter : undefined
              void exportProductsCsv(scope?.rows ?? filtered, scope?.filePrefix ?? 'products', groups, branchId)
            }}
            t={t}
          />
        </Suspense>
      )}
      {mergeDuplicatesReviewOpen && (
        <MergeDuplicatesReviewModal
          t={t}
          onClose={() => { if (!mergeDuplicatesBusy) setMergeDuplicatesReviewOpen(false) }}
          onConfirm={handleMergeDuplicates}
          onLoadPreview={loadMergeDuplicatesPreview}
          working={mergeDuplicatesBusy}
        />
      )}
      {zeroQuantityCleanupOpen && (
        <ZeroQuantityCleanupModal
          t={t}
          onClose={() => { if (!zeroQuantityCleanupBusy) setZeroQuantityCleanupOpen(false) }}
          onLoadPreview={loadZeroQuantityCandidates}
          onConfirmDelete={handleZeroQuantityDelete}
          working={zeroQuantityCleanupBusy}
        />
      )}
      {wireImagesOpen && (
        <WireImagesReviewModal
          t={t}
          onClose={() => { if (!wireImagesBusy) setWireImagesOpen(false) }}
          onLoadPreview={loadWireImagesPreview}
          onConfirmWire={handleWireImages}
          onUnwire={handleUnwireImages}
          working={wireImagesBusy}
        />
      )}
      {pendingDelete && pendingDelete.ids.length > 0 && (
        <DeleteConfirmModal
          t={t}
          onClose={() => {
            if (deleteConfirmBusy) return
            // Mirrors the old confirm()-cancel path: release whichever
            // in-flight guard was claimed when the modal was opened.
            if (pendingDelete.ids.length === 1) finishSingleAction(productDeleteInFlightRef)
            else finishSingleAction(bulkActionInFlightRef)
            setPendingDelete(null)
          }}
          onConfirm={runPendingDeleteConfirmed}
          summary={summarizeDeleteImpact(snapshotProductsByIds(pendingDelete.ids))}
          working={deleteConfirmBusy}
        />
      )}
    </div>
  )
}
