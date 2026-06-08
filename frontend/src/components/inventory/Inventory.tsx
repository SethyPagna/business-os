// Main Inventory page sub-components imported from sibling files.

import { Fragment, Suspense, lazy, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import PaginationControls, { PAGE_SIZE_OPTIONS, clampPage } from '../shared/PaginationControls'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
const ProductDetailModal = lazy(() => import('./ProductDetailModal')) as any
const InventoryImportModal = lazy(() => import('./InventoryImportModal')) as any
const InventoryMovementsSurface = lazy(() => import('./InventoryMovementsSurface')) as any
const InventoryProductsSurface = lazy(() => import('./InventoryProductsSurface')) as any
const InventoryRfidSurface = lazy(() => import('./InventoryRfidSurface')) as any
const InventoryStockModals = lazy(() => import('./InventoryStockModals')) as any

const INVENTORY_HISTORY_READY_DELAY_MS = 1800

import { buildMovementGroups, getMovementGroupPage, movementGroupHaystack } from './movementGroups'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot } from '../../utils/historyHelpers.ts'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import { aggregateInitialOptions, buildInitialOptionsFromProducts } from '../../utils/initials.ts'
import { buildProductGroupSections } from '../../utils/productGrouping.ts'
import { buildBatchPreview } from '../../utils/productBatches.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { isApiVersionMismatchError } from '../../api/http.ts'
import type { QueryParams } from '../../api/query.ts'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
  withLoaderTimeout,
} from '../../utils/loaders.ts'

type LegacyInventoryRecord = Record<string, any>
type InventoryId = number | string
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string
type MoneyFormatter = (value: number) => string
type InventoryLoader<T = any> = () => Promise<T>

type InventoryProduct = LegacyInventoryRecord & {
  id?: InventoryId
  name?: string
  unit?: string
  parent_id?: InventoryId | null
  is_group?: boolean
  branch_stock?: LegacyInventoryRecord[]
}

type InventoryBranch = LegacyInventoryRecord & {
  id?: InventoryId
  name?: string
  is_default?: boolean
}

type InventoryMovement = LegacyInventoryRecord & {
  id?: InventoryId
  movement_type?: string
  quantity?: number
}

type MovementMeta = {
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type InventoryReasonType = 'adjust' | 'transfer' | 'move'

type InventoryReason = {
  id: string
  type: InventoryReasonType
  label: string
}

type InventoryReasonGroups = Record<InventoryReasonType, InventoryReason[]>

type InventoryUserOption = {
  id: InventoryId
  name?: string
  username?: string
}

type InventoryStats = LegacyInventoryRecord | null
type ReturnStats = LegacyInventoryRecord | null

type InventoryFormValue = string | number

type AdjustForm = {
  product_id?: InventoryId
  type: string
  quantity: InventoryFormValue
  unit_cost_usd: InventoryFormValue
  unit_cost_khr: InventoryFormValue
  reason: string
  branch_id: InventoryId | ''
}

type MoveForm = {
  mode: string
  destination_product_id: InventoryId | ''
  destination_name: string
  quantity: InventoryFormValue
  branch_id: InventoryId | ''
  reason: string
  note: string
  selling_price_usd: string
  special_price_usd: string
  discount_enabled: boolean
  discount_type: string
  discount_percent: string
  discount_amount_usd: string
}

type TransferForm = {
  from_branch_id: InventoryId | ''
  to_branch_id: InventoryId | ''
  quantity: InventoryFormValue
  reason: string
}

type InventoryBatchLine = LegacyInventoryRecord & {
  product?: InventoryProduct
  productId: InventoryId
  action: string
  quantity: InventoryFormValue
  branch_id?: InventoryId | ''
  reason?: string
  note?: string
}

type InventoryBatch = {
  items: InventoryBatchLine[]
} | null

type StatDetail = {
  id: string
  label: ReactNode
  details?: Array<{ label?: ReactNode; value?: ReactNode; note?: ReactNode }>
  detailSections?: Array<{
    title?: ReactNode
    subtitle?: ReactNode
    rows?: Array<{ label?: ReactNode; value?: ReactNode; note?: ReactNode }>
  }>
} | null

type SectionOption = {
  value: string
  label: ReactNode
  hint?: string
}

type InventoryAppContext = {
  t: Translator
  user?: LegacyInventoryRecord | null
  notify: (message: string, type?: string) => void
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  usdSymbol: string
}

type InventorySyncContext = {
  syncChannel?: LegacyInventoryRecord | null
}

type InventoryApi = Record<string, any>
type BranchTransportModule = typeof import('../../api/branchTransport.ts')
type DashboardTransportModule = typeof import('../../api/dashboardTransport.ts')
type InventoryTransportModule = typeof import('../../api/inventoryTransport.ts')
type ProductReadTransportModule = typeof import('../../api/productReadTransport.ts')
type ReturnsReadTransportModule = typeof import('../../api/returnsReadTransport.ts')
type RfidTransportModule = typeof import('../../api/rfidTransport.ts')
type UserReadTransportModule = typeof import('../../api/userReadTransport.ts')
type InventoryWriteTransportModule = typeof import('../../api/inventoryWriteTransport.ts')
type InventoryExportModule = typeof import('./inventoryExport.ts')

type LoadOptions = {
  force?: boolean
}

let branchTransportPromise: Promise<BranchTransportModule> | null = null
let dashboardTransportPromise: Promise<DashboardTransportModule> | null = null
let inventoryTransportPromise: Promise<InventoryTransportModule> | null = null
let productReadTransportPromise: Promise<ProductReadTransportModule> | null = null
let returnsReadTransportPromise: Promise<ReturnsReadTransportModule> | null = null
let rfidTransportPromise: Promise<RfidTransportModule> | null = null
let userReadTransportPromise: Promise<UserReadTransportModule> | null = null
let inventoryWriteTransportPromise: Promise<InventoryWriteTransportModule> | null = null
let inventoryExportModulePromise: Promise<InventoryExportModule> | null = null

function loadBranchTransport(): Promise<BranchTransportModule> {
  if (!branchTransportPromise) branchTransportPromise = import('../../api/branchTransport.ts')
  return branchTransportPromise
}

function loadDashboardTransport(): Promise<DashboardTransportModule> {
  if (!dashboardTransportPromise) dashboardTransportPromise = import('../../api/dashboardTransport.ts')
  return dashboardTransportPromise
}

function loadInventoryTransport(): Promise<InventoryTransportModule> {
  if (!inventoryTransportPromise) inventoryTransportPromise = import('../../api/inventoryTransport.ts')
  return inventoryTransportPromise
}

function loadInventoryWriteTransport(): Promise<InventoryWriteTransportModule> {
  if (!inventoryWriteTransportPromise) inventoryWriteTransportPromise = import('../../api/inventoryWriteTransport.ts')
  return inventoryWriteTransportPromise
}

function loadProductReadTransport(): Promise<ProductReadTransportModule> {
  if (!productReadTransportPromise) productReadTransportPromise = import('../../api/productReadTransport.ts')
  return productReadTransportPromise
}

function loadReturnsReadTransport(): Promise<ReturnsReadTransportModule> {
  if (!returnsReadTransportPromise) returnsReadTransportPromise = import('../../api/returnsReadTransport.ts')
  return returnsReadTransportPromise
}

function loadRfidTransport(): Promise<RfidTransportModule> {
  if (!rfidTransportPromise) rfidTransportPromise = import('../../api/rfidTransport.ts')
  return rfidTransportPromise
}

function loadUserReadTransport(): Promise<UserReadTransportModule> {
  if (!userReadTransportPromise) userReadTransportPromise = import('../../api/userReadTransport.ts')
  return userReadTransportPromise
}

function loadInventoryExportModule(): Promise<InventoryExportModule> {
  if (!inventoryExportModulePromise) inventoryExportModulePromise = import('./inventoryExport.ts')
  return inventoryExportModulePromise
}

function getInventoryApi(): InventoryApi {
  return {
    getBranches: async () => (await loadBranchTransport()).getBranches(),
    getDashboard: async () => (await loadDashboardTransport()).getDashboard(),
    getInventoryBootstrap: async (params: QueryParams = {}) => (await loadInventoryTransport()).getInventoryBootstrap(params),
    getInventoryMovements: async (params: QueryParams = {}) => (await loadInventoryTransport()).getInventoryMovements(params),
    getInventoryReasons: async () => (await loadInventoryTransport()).getInventoryReasons(),
    getInventoryStats: async (params: QueryParams = {}) => (await loadInventoryTransport()).getInventoryStats(params),
    getProductsByIds: async (ids: unknown[] = [], params: QueryParams = {}) => (await loadProductReadTransport()).getProductsByIds(ids, params),
    getReturns: async (params: QueryParams = {}) => (await loadReturnsReadTransport()).getReturns(params),
    getRfidStatus: async (params: QueryParams = {}) => (await loadRfidTransport()).getRfidStatus(params),
    getUsers: async () => (await loadUserReadTransport()).getUsers(),
    saveInventoryReasons: async (items: unknown[] = []) => (await loadInventoryWriteTransport()).saveInventoryReasons(items),
    searchInventoryProducts: async (params: QueryParams = {}) => (await loadInventoryTransport()).searchInventoryProducts(params),
    adjustStock: async (payload: Record<string, unknown> = {}) => (await loadInventoryWriteTransport()).adjustStock(payload),
    moveStockRow: async (payload: Record<string, unknown> = {}) => (await loadInventoryWriteTransport()).moveStockRow(payload),
    transferInventoryStock: async (payload: Record<string, unknown> = {}) => (await loadInventoryWriteTransport()).transferInventoryStock(payload),
  }
}

const DASHBOARD_INVENTORY_FOCUS_KEY = 'bos:dashboard:inventory-focus'
const INVENTORY_USER_OPTIONS_TIMEOUT_MS = 8000
const INVENTORY_REASONS_TIMEOUT_MS = 8000
const INVENTORY_BRANCHES_TIMEOUT_MS = 8000
const INVENTORY_STATS_TIMEOUT_MS = 12000
const INVENTORY_PRODUCTS_TIMEOUT_MS = 12000
const INVENTORY_MOVEMENTS_TIMEOUT_MS = 15000
const INVENTORY_RFID_TIMEOUT_MS = 8000
const INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS = 10000
const INVENTORY_RETURNS_STATS_TIMEOUT_MS = 12000
const INVENTORY_DASHBOARD_STATS_TIMEOUT_MS = 12000
const INVENTORY_STOCK_MUTATION_TIMEOUT_MS = 12000

function reuseSetWhenUnchanged<T>(current: Set<T>, nextValues: T[] = []): Set<T> {
  const next = new Set(nextValues)
  if (next.size !== current.size) return next
  for (const value of current) {
    if (!next.has(value)) return next
  }
  return current
}

function normalizeFiniteIdsFrom<T>(items: T[] = [], getValue: (value: T) => unknown = (value) => value): number[] {
  return items.reduce((normalized, item) => {
    const id = Number(getValue(item))
    if (Number.isFinite(id)) normalized.push(id)
    return normalized
  }, [] as number[])
}

function normalizeFiniteIds(ids: unknown[] = []): number[] {
  return normalizeFiniteIdsFrom(ids)
}

function countActiveFlags(flags: unknown[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
}

function countSelectedIds(ids: InventoryId[] = [], selectedIds: Set<InventoryId> = new Set()): number {
  let count = 0
  for (const id of ids) {
    if (selectedIds.has(id)) count += 1
  }
  return count
}

function buildDestinationProductOptions(products: InventoryProduct[] = [], excludedProductId: InventoryId | undefined, placeholder: string): AppSelectOption[] {
  const excludedId = Number(excludedProductId)
  const options: AppSelectOption[] = [{ value: '', label: placeholder }]
  for (const product of products) {
    const id = Number(product?.id)
    if (Number.isFinite(excludedId) && id === excludedId) continue
    options.push({ value: String(product.id), label: product.name || String(product.id) })
  }
  return options
}

const INVENTORY_MOBILE_INITIAL_ITEM_LIMIT = 4

function limitInventorySectionsForMobile(sections: LegacyInventoryRecord[] = [], maxItems = INVENTORY_MOBILE_INITIAL_ITEM_LIMIT): LegacyInventoryRecord[] {
  const limit = Math.max(1, Number(maxItems || INVENTORY_MOBILE_INITIAL_ITEM_LIMIT))
  let remaining = limit
  const limitedSections = []
  for (const section of sections) {
    if (remaining <= 0) break
    const nextGroups = []
    for (const group of section?.groups || []) {
      if (remaining <= 0) break
      const groupItems = Array.isArray(group?.items) ? group.items : []
      if (!groupItems.length) continue
      const visibleItems = groupItems.slice(0, remaining)
      remaining -= visibleItems.length
      nextGroups.push({
        ...group,
        items: visibleItems,
      })
    }
    if (!nextGroups.length) continue
    limitedSections.push({
      ...section,
      groups: nextGroups,
    })
  }
  return limitedSections
}

function parseInventoryTimestamp(value: unknown): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalizedBase = raw.includes('T') ? raw : raw.replace(' ', 'T')
  let normalized = `${normalizedBase}Z`
  if (/Z$/i.test(normalizedBase)) normalized = normalizedBase
  else if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) normalized = normalizedBase
  else if (/[+-]\d{4}$/i.test(normalizedBase)) normalized = normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  else if (/[+-]\d{2}$/i.test(normalizedBase)) normalized = `${normalizedBase}:00`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function InventoryDiscountBadge({ product, fmtUSD, t }: { product: InventoryProduct; fmtUSD: MoneyFormatter; t: Translator }) {
  const promotion = calculateProductDiscount(product as any)
  if (!promotion.active) return null
  const label = product?.discount_label || (typeof t === 'function' ? (t('discounts') || 'Discounts') : 'Discounts')
  return (
    <span className="inline-flex max-w-[10rem] truncate rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60" title={`${label} ${fmtUSD(promotion.applied_price_usd || 0)}`}>
      {label} {fmtUSD(promotion.applied_price_usd || 0)}
    </span>
  )
}

function InventoryBatchPreview({
  product,
  branchId = 'all',
  t,
  compact = false,
}: {
  product: InventoryProduct
  branchId?: InventoryId | null
  t: Translator
  compact?: boolean
}) {
  const preview = buildBatchPreview(product as any, branchId ?? undefined, { limit: compact ? 2 : 3 })
  const label = (key: string, fallback: string) => (typeof t === 'function' ? (t(key) || fallback) : fallback)
  if (!preview.totalCount) return null
  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? 'mt-1' : 'mt-1.5'}`}>
      {preview.items.map((batch) => (
        <span
          key={`${product?.id || 'product'}-inv-batch-${batch.id || batch.batch_id}`}
          className="inline-flex max-w-[13rem] items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50"
          title={`${String(batch.lot_code || label('batch', 'Batch'))} / ${String(batch.expiry_date || label('no_expiry', 'No expiry'))} / ${String(batch.quantity ?? '')}`}
        >
          {String(batch.lot_code || label('batch', 'Batch'))} / {String(batch.expiry_date || label('no_expiry', 'No expiry'))} / {String(batch.quantity ?? '')}
        </span>
      ))}
      {preview.extraCount ? (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          +{preview.extraCount}
        </span>
      ) : null}
    </div>
  )
}

const RFID_INVENTORY_WORKFLOWS = [
  { id: 'receiving', labelKey: 'rfid_workflow_receiving', descriptionKey: 'rfid_workflow_receiving_desc', label: 'Receiving', description: 'Pair EPC tags to new stock, supplier lots, cartons, or individual products before adding inventory.' },
  { id: 'stock-count', labelKey: 'rfid_workflow_stock_count', descriptionKey: 'rfid_workflow_stock_count_desc', label: 'Stock count', description: 'Walk shelves with a reader, compare reads against on-hand stock, then approve counted differences.' },
  { id: 'transfer', labelKey: 'rfid_workflow_branch_transfer', descriptionKey: 'rfid_workflow_branch_transfer_desc', label: 'Branch transfer', description: 'Scan tags out of one branch and into another so transfer movements keep item identity.' },
  { id: 'pos-verify', labelKey: 'rfid_workflow_pos_verify', descriptionKey: 'rfid_workflow_pos_verify_desc', label: 'POS verify', description: 'Use doorway or counter reads to confirm sold items before bagging and reduce missed scans.' },
  { id: 'returns', labelKey: 'rfid_workflow_returns', descriptionKey: 'rfid_workflow_returns_desc', label: 'Returns', description: 'Validate returned tags against the original sale before restock, write-off, or supplier return.' },
]

const RFID_READER_REQUIREMENTS = [
  { id: 'gateway', key: 'rfid_requirement_gateway', text: 'RFID reader gateway must post reads with EPC / TID, antenna, branch, RSSI, and timestamp.' },
  { id: 'mapping', key: 'rfid_requirement_mapping', text: 'Each tag must be mapped to a product, variant, lot, carton, or serial-level unit before stock can change.' },
  { id: 'fallback', key: 'rfid_requirement_barcode_fallback', text: 'Barcode fallback remains available for products that are not tagged or when the reader is offline.' },
]

const INVENTORY_SECTION_OPTIONS = [
  { value: 'all', label: 'All', hint: 'Show inventory statistics, products, movements, and RFID tools together.' },
  { value: 'stats', label: 'Stats', hint: 'Show only the inventory summary cards.' },
  { value: 'products', label: 'Products', hint: 'Show product stock, values, and item-level controls.' },
  { value: 'movements', label: 'Movements', hint: 'Show stock movement history and grouped movement filters.' },
  { value: 'rfid', label: 'RFID', hint: 'Show branch-locked RFID tagging, stock count, search, exception, and session tools.' },
]

const RFID_SECTION_OPTIONS = [
  { value: 'overview', labelKey: 'rfid_section_overview', hintKey: 'rfid_section_overview_hint', label: 'Overview', hint: 'Show RFID status, branch lock state, reader readiness, and the pilot checklist.' },
  { value: 'tagging', labelKey: 'rfid_section_tagging', hintKey: 'rfid_section_tagging_hint', label: 'Tagging', hint: 'Link EPC/TID tags to products without changing the master stock ledger.' },
  { value: 'stock-count', labelKey: 'rfid_section_stock_count', hintKey: 'rfid_section_stock_count_hint', label: 'Stock Count', hint: 'Run a branch-locked scan session and compare RFID presence against barcode stock.' },
  { value: 'search', labelKey: 'rfid_section_search', hintKey: 'rfid_section_search_hint', label: 'Search', hint: 'Find a product or tag with the handheld reader and browser scan box.' },
  { value: 'exceptions', labelKey: 'rfid_section_exceptions', hintKey: 'rfid_section_exceptions_hint', label: 'Exceptions', hint: 'Review wrong-branch, unknown, missing, and extra tag detections before applying.' },
  { value: 'sessions', labelKey: 'rfid_section_sessions', hintKey: 'rfid_section_sessions_hint', label: 'Sessions', hint: 'Audit RFID scan sessions and manually apply approved results.' },
]

export default function Inventory() {
  const { t, user, notify, fmtUSD, fmtKHR, usdSymbol } = useApp() as InventoryAppContext
  const { syncChannel } = useSync() as InventorySyncContext
  const isActive = useIsPageActive('inventory')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const safeT = useCallback((key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key && !isBrokenLocalizedString(value) ? value : fallback
  }, [t])
  const tr = useCallback((key: string, fallbackEn = '', fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    if (isKhmer && !isBrokenLocalizedString(fallbackKm)) return fallbackKm
    return fallbackEn
  }, [isKhmer, t])
  const filterLabel = useCallback((key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : ''
    const normalized = String(value || '').trim().toLowerCase()
    if (!value || value === key || isBrokenLocalizedString(value)) return fallback
    if (normalized === 'back') return fallback
    return value
  }, [t])
  const [summary,       setSummary]       = useState<InventoryProduct[]>([])
  const [stockStats,    setStockStats]    = useState<InventoryStats>(null)
  const [stockStatsLoaded, setStockStatsLoaded] = useState(false)
  const [statsRefreshError, setStatsRefreshError] = useState('')
  const [movements,     setMovements]     = useState<InventoryMovement[]>([])
  const [movementsLoaded, setMovementsLoaded] = useState(false)
  const [movementMeta,  setMovementMeta]  = useState<MovementMeta>({ total: 0, page: 1, pageSize: 50, totalPages: 1 })
  const [branches,      setBranches]      = useState<InventoryBranch[]>([])
  const [returnStats,   setReturnStats]   = useState<ReturnStats>(null)
  const [taxDelivery,   setTaxDelivery]   = useState({ tax: 0, delivery: 0, deliveryCount: 0 })
  const [branchFilter,  setBranchFilter]  = useState('all')
  const [adjustModal,   setAdjustModal]   = useState<InventoryProduct | null>(null)
  const [adjustForm,    setAdjustForm]    = useState<AdjustForm>({ type:'add', quantity:1, unit_cost_usd:0, unit_cost_khr:0, reason:'', branch_id:'' })
  const [moveModal,     setMoveModal]     = useState<InventoryProduct | null>(null)
  const [moveForm,      setMoveForm]      = useState<MoveForm>({ mode: 'existing', destination_product_id: '', destination_name: '', quantity: 1, branch_id: '', reason: 'broken', note: '', selling_price_usd: '', special_price_usd: '', discount_enabled: false, discount_type: 'percent', discount_percent: '', discount_amount_usd: '' })
  const [transferModal, setTransferModal] = useState<InventoryProduct | null>(null)
  const [transferForm,  setTransferForm]  = useState<TransferForm>({ from_branch_id: '', to_branch_id: '', quantity: 1, reason: '' })
  const [search,        setSearch]        = useState('')
  const [searchMode, setSearchMode] = useState('AND') // 'AND' | 'OR'
  const deferredSearch = String(search || '').trim()
  const [brandFilter,   setBrandFilter]   = useState('all')
  const [stockFilter,   setStockFilter]   = useState('all')
  const [groupFilter,   setGroupFilter]   = useState('all') // all | group | standalone
  const [inventoryProductPage, setInventoryProductPage] = useState(1)
  const [inventoryProductPageSize, setInventoryProductPageSize] = useState(20)
  const [inventoryProductPageDraft, setInventoryProductPageDraft] = useState('1')
  const [inventoryProductTotal, setInventoryProductTotal] = useState(0)
  const [inventoryProductsLoaded, setInventoryProductsLoaded] = useState(false)
  const [initialInventoryDesktopRevealReady, setInitialInventoryDesktopRevealReady] = useState(false)
  const [initialInventoryMobileRevealReady, setInitialInventoryMobileRevealReady] = useState(false)
  const [initialInventoryMobileFullListReady, setInitialInventoryMobileFullListReady] = useState(false)
  const [isInventoryMobileViewport, setIsInventoryMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 640
  })
  const [inventoryInitialFilter, setInventoryInitialFilter] = useState('all')
  const [inventoryInitials, setInventoryInitials] = useState<LegacyInventoryRecord[]>([])
  const [cachedInventoryInitialOptions, setCachedInventoryInitialOptions] = useState<LegacyInventoryRecord[]>([])
  const [inventoryProductFilters, setInventoryProductFilters] = useState<{ brands: string[] }>({ brands: [] })
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(() => new Set())
  const [inventoryBatch, setInventoryBatch] = useState<InventoryBatch>(null)
  const [batchApplying, setBatchApplying] = useState(false)
  const [rfidStatus, setRfidStatus] = useState<LegacyInventoryRecord | null>(null)
  const [tab,           setTab]           = useState('products')
  const [inventorySection, setInventorySection] = useState('products')
  const [rfidSection, setRfidSection] = useState('all')
  const [movFilter,     setMovFilter]     = useState('all')
  const [movementUserFilter, setMovementUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState<InventoryUserOption[]>([])
  const [movementStartDate, setMovementStartDate] = useState('')
  const [movementEndDate, setMovementEndDate] = useState('')
  const [showMovementDateFilter, setShowMovementDateFilter] = useState(false)
  const [movementYearFilter, setMovementYearFilter] = useState('all')
  const [movementMonthFilter, setMovementMonthFilter] = useState('all')
  const [movementGroupMode, setMovementGroupMode] = useState('time')
  const [movementSortDirection, setMovementSortDirection] = useState('desc')
  const [selectedMovementIds, setSelectedMovementIds] = useState<Set<string>>(() => new Set())
  const [detailProduct, setDetailProduct] = useState<InventoryProduct | null>(null)
  const [expandedMovementGroups, setExpandedMovementGroups] = useState<Set<string>>(() => new Set())
  const [expandedMovementPages, setExpandedMovementPages] = useState<Record<string, number>>({})
  const [collapsedMovementSections, setCollapsedMovementSections] = useState<Set<string>>(() => new Set())
  const [collapsedInventorySections, setCollapsedInventorySections] = useState<Set<string>>(() => new Set())
  const [collapsedInventoryGroups, setCollapsedInventoryGroups] = useState<Set<string>>(() => new Set())
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [adjustSaving,  setAdjustSaving]  = useState(false)
  const [moveSaving,    setMoveSaving]    = useState(false)
  const [transferSaving, setTransferSaving] = useState(false)
  const [statDetail,    setStatDetail]    = useState<StatDetail>(null)
  const [showImport, setShowImport] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<{ open: boolean; type: InventoryReasonType }>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const movementSelectAllRef = useRef<HTMLInputElement | null>(null)
  const inventorySelectAllRef = useRef<HTMLInputElement | null>(null)
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const pendingLoadRef = useRef<{ silent: boolean; options?: LoadOptions } | null>(null)
  const latestLoadRef = useRef<((silent?: boolean, options?: LoadOptions) => Promise<void>) | null>(null)
  const inventoryReasonsLoadedRef = useRef(false)
  const inventoryReasonsPromiseRef = useRef<Promise<InventoryReason[]> | null>(null)
  const inventoryUsersLoadedRef = useRef(false)
  const inventoryUsersPromiseRef = useRef<Promise<InventoryUserOption[]> | null>(null)
  const adjustStockInFlightRef = useRef(false)
  const moveStockInFlightRef = useRef(false)
  const transferStockInFlightRef = useRef(false)
  const batchInventoryInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 10, notify, scope: 'inventory', enabled: historyReady })
  const runInventoryMutation = useCallback((loader: InventoryLoader, label: string): Promise<any> => (
    withLoaderTimeout(loader, label, INVENTORY_STOCK_MUTATION_TIMEOUT_MS)
  ), [])
  const movementTimeMode = useMemo(
    () => getTimeGroupingMode(movementYearFilter, movementMonthFilter),
    [movementMonthFilter, movementYearFilter],
  )
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    let permissions = user?.permissions || {}
    try {
      permissions = typeof permissions === 'string' ? JSON.parse(permissions || '{}') : permissions
    } catch {
      permissions = {}
    }
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])
  const branchesById = useMemo(() => new Map(
    (Array.isArray(branches) ? branches : []).map((branch) => [String(branch?.id), branch]),
  ), [branches])
  const defaultBranch = useMemo(() => (
    branches.find((branch) => branch.is_default) || branches[0] || null
  ), [branches])
  const defaultTransferDestinationBySourceId = useMemo(() => {
    const branchIds = (Array.isArray(branches) ? branches : [])
      .map((branch) => String(branch?.id || ''))
      .filter(Boolean)
    const firstBranchId = branchIds[0] || ''
    const secondBranchId = branchIds[1] || ''
    return new Map(branchIds.map((branchId) => [
      branchId,
      branchId !== firstBranchId ? firstBranchId : secondBranchId,
    ]))
  }, [branches])
  const summaryById = useMemo(() => new Map(
    (Array.isArray(summary) ? summary : []).map((product) => [Number(product?.id || 0), product]),
  ), [summary])
  const getBranchLabel = useCallback((branchId: InventoryId | null | undefined, fallback = '') => (
    branchesById.get(String(branchId))?.name || fallback || String(branchId || '')
  ), [branchesById])

  const rfidGatewayStatus = useMemo(() => {
    const branchName = branchFilter === 'all'
      ? (t('all_branches') || 'All branches')
      : getBranchLabel(branchFilter, `Branch ${branchFilter}`)
    return {
      connected: false,
      label: tr('rfid_not_connected', 'Not connected'),
      branchName,
      readerCount: Number(rfidStatus?.readerCount || 0),
      activeSession: rfidStatus?.activeSession?.id ? `${tr('rfid_session', 'Session')} #${rfidStatus.activeSession.id}` : tr('rfid_no_active_session', 'No active RFID session'),
      queuedReads: 0,
      unknownTags: Number(rfidStatus?.exceptionCount || 0),
      lastHeartbeat: rfidStatus?.tagCount ? `${rfidStatus.tagCount} ${tr('rfid_tags_linked', 'tags linked')}` : tr('rfid_no_reader_heartbeat', 'No reader heartbeat yet'),
    }
  }, [branchFilter, getBranchLabel, rfidStatus, t, tr])

  const rfidSectionOptions = useMemo(() => (
    RFID_SECTION_OPTIONS.map((option) => ({
      ...option,
      label: tr(option.labelKey, option.label),
      hint: tr(option.hintKey, option.hint),
    }))
  ), [tr])

  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])

  const needsStatsData = inventorySection === 'all' || inventorySection === 'stats'
  const needsProductSummary = inventorySection === 'products' || (inventorySection === 'all' && tab === 'products')
  const needsMovementData = inventorySection === 'movements' || (inventorySection === 'all' && tab === 'movements')
  const needsRfidData = inventorySection === 'rfid' || (inventorySection === 'all' && tab === 'rfid')

  const loadInventoryReasons = useCallback(async () => {
    try {
      const result = await withLoaderTimeout(
        () => getInventoryApi().getInventoryReasons?.() ?? Promise.resolve({ items: [] }),
        'Inventory reasons',
        INVENTORY_REASONS_TIMEOUT_MS,
      )
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      inventoryReasonsLoadedRef.current = true
      return items
    } catch {
      inventoryReasonsLoadedRef.current = false
      return inventoryReasons
    }
  }, [inventoryReasons])

  const ensureInventoryReasonsLoaded = useCallback(async () => {
    if (inventoryReasonsLoadedRef.current) return inventoryReasons
    if (inventoryReasonsPromiseRef.current) return inventoryReasonsPromiseRef.current
    const promise = loadInventoryReasons().finally(() => {
      inventoryReasonsPromiseRef.current = null
    })
    inventoryReasonsPromiseRef.current = promise
    return promise
  }, [inventoryReasons, loadInventoryReasons])

  const ensureInventoryUsersLoaded = useCallback(async () => {
    if (!isAdmin) return []
    if (inventoryUsersLoadedRef.current) return userOptions
    if (inventoryUsersPromiseRef.current) return inventoryUsersPromiseRef.current
    const promise = withLoaderTimeout(() => getInventoryApi().getUsers(), 'Inventory user filters', INVENTORY_USER_OPTIONS_TIMEOUT_MS)
      .then((rows) => {
        const nextRows = Array.isArray(rows) ? rows : []
        setUserOptions(nextRows)
        inventoryUsersLoadedRef.current = true
        return nextRows
      })
      .catch(() => {
        inventoryUsersLoadedRef.current = false
        return userOptions
      })
      .finally(() => {
        inventoryUsersPromiseRef.current = null
      })
    inventoryUsersPromiseRef.current = promise
    return promise
  }, [isAdmin, userOptions])

  const load = useCallback(async (silent = false, options: LoadOptions = {}) => {
    const force = !!options?.force
    if (loadPromiseRef.current && !force) {
      const currentPending = pendingLoadRef.current || { silent: true }
      currentPending.silent = currentPending.silent && silent
      pendingLoadRef.current = currentPending
      return loadPromiseRef.current
    }
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (!silent) {
        setLoadError(null)
        setLoading(true)
        if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
            setLoading(false)
            setLoadError(tr('inventory_load_slow', 'Inventory is taking longer than expected. Tap Refresh or revisit in a moment.'))
          }, 15000)
        }
      }
      const branchOpts = {
        ...(branchFilter !== 'all' ? { branchId: parseInt(branchFilter, 10) } : {}),
        ...(isAdmin && movementUserFilter !== 'all' ? { userId: movementUserFilter } : {}),
      }
      const productQuery = {
        ...branchOpts,
        page: inventoryProductPage,
        pageSize: inventoryProductPageSize,
        query: deferredSearch,
        searchMode,
        brand: brandFilter,
        stockState: stockFilter,
        groupState: groupFilter,
        initial: inventoryInitialFilter,
      }
      const statsQuery = {
        branchId: branchOpts.branchId,
        query: deferredSearch,
        searchMode,
        brand: brandFilter,
        stockState: stockFilter,
        groupState: groupFilter,
        initial: inventoryInitialFilter,
      }
      const canBootstrapProducts = needsProductSummary && !needsStatsData && !needsMovementData && !needsRfidData
      const loadInventoryBootstrap = () => withLoaderTimeout(
        () => {
          const inventoryApi = getInventoryApi()
          if (typeof inventoryApi.getInventoryBootstrap === 'function') {
            return inventoryApi.getInventoryBootstrap(productQuery)
          }
          return Promise.all([
            inventoryApi.getBranches(),
            inventoryApi.searchInventoryProducts(productQuery),
          ]).then(([branchesResult, productsResult]) => ({
            branches: branchesResult,
            products: productsResult,
          }))
        },
        'Inventory bootstrap',
        INVENTORY_PRODUCTS_TIMEOUT_MS,
      )
      try {
        const primaryLoaders = {
          ...(canBootstrapProducts ? {
            bootstrap: loadInventoryBootstrap,
          } : {
            branches: () => withLoaderTimeout(
              () => getInventoryApi().getBranches(),
              'Inventory branches',
              INVENTORY_BRANCHES_TIMEOUT_MS,
            ),
            ...(needsProductSummary ? {
              summary: () => withLoaderTimeout(
                () => getInventoryApi().searchInventoryProducts(productQuery),
                'Inventory products',
                INVENTORY_PRODUCTS_TIMEOUT_MS,
              ),
            } : {}),
          }),
          ...(needsStatsData ? {
            stats: () => withLoaderTimeout(
              () => getInventoryApi().getInventoryStats(statsQuery),
              'Inventory stats',
              INVENTORY_STATS_TIMEOUT_MS,
            ),
          } : {}),
          ...(needsMovementData ? {
            movements: () => withLoaderTimeout(
              () => getInventoryApi().getInventoryMovements({
                ...branchOpts,
                search: deferredSearch || undefined,
                searchMode,
                startDate: movementStartDate || undefined,
                endDate: movementEndDate || undefined,
                page: movementMeta.page,
                pageSize: movementMeta.pageSize,
              }),
              'Inventory movements',
              INVENTORY_MOVEMENTS_TIMEOUT_MS,
            ),
          } : {}),
          ...(needsRfidData ? {
            rfid: () => withLoaderTimeout(
              () => (getInventoryApi().getRfidStatus ? getInventoryApi().getRfidStatus(branchOpts).catch(() => null) : Promise.resolve(null)),
              'Inventory RFID status',
              INVENTORY_RFID_TIMEOUT_MS,
            ),
          } : {}),
        }
        const result = await settleLoaderMap(primaryLoaders) as LegacyInventoryRecord
        const bootstrapResult = result.values.bootstrap
        const sumResult = bootstrapResult && !Array.isArray(bootstrapResult)
          ? bootstrapResult.products
          : result.values.summary
        const statsResult = result.values.stats
        const sum = Array.isArray(sumResult) ? sumResult : (Array.isArray(sumResult?.items) ? sumResult.items : [])
        const movs = result.values.movements
        const rfid = result.values.rfid
        const brs = bootstrapResult && !Array.isArray(bootstrapResult)
          ? bootstrapResult.branches
          : result.values.branches

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const versionMismatchError = Object.values(result.errors || {}).find(isApiVersionMismatchError) as Error | undefined
        if (versionMismatchError) {
          setLoadError(versionMismatchError.message)
          throw versionMismatchError
        }
        if (needsProductSummary && Array.isArray(sum)) {
          setSummary(sum || [])
          setInventoryProductsLoaded(true)
          if (sumResult && !Array.isArray(sumResult)) {
            setInventoryProductTotal(Number(sumResult.total || 0))
            setInventoryProductPage(Number(sumResult.page || inventoryProductPage) || 1)
            setInventoryProductPageSize(Number(sumResult.pageSize || inventoryProductPageSize) || inventoryProductPageSize)
            if (Array.isArray(sumResult.initials)) {
              setInventoryInitials(sumResult.initials)
            }
            if (sumResult.filters && typeof sumResult.filters === 'object') {
              setInventoryProductFilters(sumResult.filters)
            }
          } else {
            setInventoryProductTotal(sum.length)
          }
        }
        if (needsStatsData && statsResult?.item) {
          setStockStats(statsResult.item)
          setStockStatsLoaded(true)
          setStatsRefreshError('')
        } else if (needsStatsData && loadedOnceRef.current) {
          setStatsRefreshError(tr('inventory_stats_refresh_failed', 'Inventory stats could not refresh. Showing the last confirmed values.'))
        }
        if (needsMovementData && Array.isArray(movs)) {
          setMovements(movs || [])
          setMovementsLoaded(true)
          setMovementMeta((current) => ({
            ...current,
            total: movs.length,
            totalPages: 1,
          }))
        } else if (needsMovementData && movs && typeof movs === 'object') {
          const total = Number(movs.total || 0)
          const pageSize = Number(movs.pageSize || movementMeta.pageSize) || movementMeta.pageSize
          const responsePage = Number(movs.page || movementMeta.page) || 1
          const totalPages = Number(movs.totalPages || 1) || 1
          const clampedPage = clampPage(responsePage, total, pageSize)
          if (clampedPage !== responsePage) {
            setMovementMeta({
              total,
              page: clampedPage,
              pageSize,
              totalPages,
            })
          } else {
            setMovements(Array.isArray(movs.items) ? movs.items : [])
            setMovementsLoaded(true)
            setMovementMeta({
              total,
              page: responsePage,
              pageSize,
              totalPages,
            })
          }
        }
        if (needsRfidData && rfid?.item) setRfidStatus(rfid.item)
        if (Array.isArray(brs)) setBranches(brs.filter((branch) => branch.is_active))
        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, 'Failed to load inventory'))
        }
        loadedOnceRef.current = true
        setLoadError(null)

        if (needsStatsData) {
          void settleLoaderMap({
            returns: () => withLoaderTimeout(
              () => getInventoryApi().getReturns({ scope: 'all' }),
              'Inventory returns stats',
              INVENTORY_RETURNS_STATS_TIMEOUT_MS,
            ),
            dashboard: () => withLoaderTimeout(
              () => getInventoryApi().getDashboard(),
              'Inventory dashboard stats',
              INVENTORY_DASHBOARD_STATS_TIMEOUT_MS,
            ),
          }).then((secondaryResult: LegacyInventoryRecord) => {
            if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
            const rets = secondaryResult.values.returns
            const dash = secondaryResult.values.dashboard
            if (dash && typeof dash === 'object') {
              setTaxDelivery({
                tax: dash.all_tax_usd || 0,
                delivery: dash.all_delivery_usd || 0,
                deliveryCount: dash.all_delivery_count || 0,
              })
            }
            if (Array.isArray(rets)) {
              const nextReturnStats = {
                count: 0,
                refund_usd: 0,
                refund_khr: 0,
                items: 0,
                restock: 0,
                supplier_count: 0,
                supplier_compensation_usd: 0,
                supplier_loss_usd: 0,
              }
              for (const ret of rets) {
                if ((ret.status || 'completed') === 'cancelled') continue
                if ((ret.return_scope || 'customer') === 'supplier') {
                  nextReturnStats.supplier_count += 1
                  nextReturnStats.supplier_compensation_usd += ret.supplier_compensation_usd || 0
                  nextReturnStats.supplier_loss_usd += ret.supplier_loss_usd || 0
                  continue
                }
                nextReturnStats.count += 1
                nextReturnStats.refund_usd += ret.total_refund_usd || 0
                nextReturnStats.refund_khr += ret.total_refund_khr || 0
                if ((ret.return_type || 'restock') === 'restock') nextReturnStats.restock += 1
                for (const item of ret.items || []) {
                  nextReturnStats.items += item.quantity || 0
                }
              }
              setReturnStats(nextReturnStats)
            }
          }).catch(() => {})
        }
      } catch (e: unknown) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = e instanceof Error ? e.message : 'Failed to load inventory'
        console.warn('[Inventory] load failed:', message)
        if (!silent && !loadedOnceRef.current) {
          setLoadError(message)
        } else if (!silent) {
          setLoadError(tr('inventory_refresh_failed', 'Inventory could not refresh right now. Showing the latest loaded data.'))
        }
      } finally {
        if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
        if (!silent && isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
      const pending = pendingLoadRef.current
      if (pending) {
        pendingLoadRef.current = null
        queueMicrotask(() => {
          const nextLoad = latestLoadRef.current || load
          nextLoad(Boolean(pending?.silent), { force: true }).catch(() => {})
        })
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [
    branchFilter,
    brandFilter,
    deferredSearch,
    groupFilter,
    inventoryInitialFilter,
    inventoryProductPage,
    inventoryProductPageSize,
    isAdmin,
    movementUserFilter,
    movementStartDate,
    movementEndDate,
    movementMeta.page,
    movementMeta.pageSize,
    needsMovementData,
    needsProductSummary,
    needsRfidData,
    needsStatsData,
    searchMode,
    stockFilter,
    tr,
  ])
  useEffect(() => {
    latestLoadRef.current = load
  }, [load])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      pendingLoadRef.current = null
      setLoading(false)
      return
    }
    load(loadedOnceRef.current)
  }, [isActive, load])
  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    const timer = window.setTimeout(() => {
      setHistoryReady(true)
    }, INVENTORY_HISTORY_READY_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    if (!raw) return
    try {
      const nextFocus = JSON.parse(raw)
      if (nextFocus?.section === 'products') setInventorySection('products')
      if (nextFocus?.tab === 'products') setTab('products')
      if (typeof nextFocus?.stockFilter === 'string' && nextFocus.stockFilter) {
        setStockFilter(nextFocus.stockFilter)
      }
    } catch {
      // Ignore malformed handoff payloads and keep the current view state.
    } finally {
      window.sessionStorage.removeItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    }
  }, [isActive])
  useEffect(() => {
    if (!isActive || reasonManager.open !== true) return
    void ensureInventoryReasonsLoaded()
  }, [ensureInventoryReasonsLoaded, isActive, reasonManager.open])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const ch = syncChannel.channel
    if (ch === 'inventory' || ch === 'products' || ch === 'sales' || ch === 'returns') load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await getInventoryApi().saveInventoryReasons?.(nextItems)
      const items = Array.isArray(result?.items) ? result.items as InventoryReason[] : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [])

  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])

  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(tr('rename_reason_prompt', 'Rename saved reason'), entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => item.id === entry.id ? { ...item, label: nextLabel.trim() } : item)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])

  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(tr('delete_saved_reason_confirm'))) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])
  useEffect(() => {
    const showingMovements = inventorySection === 'movements' || (inventorySection === 'all' && tab === 'movements')
    if (!isActive || !isAdmin || !showingMovements) return
    void ensureInventoryUsersLoaded()
  }, [ensureInventoryUsersLoaded, inventorySection, isActive, isAdmin, tab])
  useEffect(() => () => {
    if (loadWatchdogRef.current !== null) window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const getStockQty = useCallback((product?: InventoryProduct | null): number => {
    if (!product) return 0
    if (branchFilter !== 'all') return product.display_quantity ?? product.stock_quantity ?? 0
    return product.stock_quantity ?? 0
  }, [branchFilter])
  const parentProductIds = useMemo(() => new Set(
    summary
      .map((product) => Number(product?.parent_id || 0))
      .filter(Boolean),
  ), [summary])
  const adjustTargetOptions = useMemo(() => {
    if (!adjustModal) return []
    const selectedId = Number(adjustModal.id || 0)
    const familyRootId = Number(adjustModal.parent_id || selectedId)
    return summary.filter((product) => {
      const productId = Number(product?.id || 0)
      const parentId = Number(product?.parent_id || 0)
      return productId === selectedId || productId === familyRootId || parentId === familyRootId
    })
  }, [adjustModal, summary])
  const adjustTargetSelectOptions = useMemo(() => adjustTargetOptions.map((product) => ({
    value: String(product.id),
    label: `${product.name}${product.parent_id ? ' (Variant)' : product.is_group ? ' (Group)' : ''}`,
  })), [adjustTargetOptions])
  const branchSelectOptions = useMemo(() => branches.map((branch) => ({
    value: String(branch.id),
    label: branch.name || String(branch.id),
  })), [branches])
  const adjustBranchSelectOptions = useMemo(() => [
    { value: '', label: t('no_specific_branch') || 'No specific branch' },
    ...branchSelectOptions,
  ], [branchSelectOptions, t])
  const chooseBranchLabel = tr('choose_branch', 'Choose a branch')
  const transferSourceBranchOptions = useMemo(() => [
    { value: '', label: chooseBranchLabel },
    ...branches.map((branch) => {
      const branchQty = Number((transferModal?.branch_stock || []).find((item) => String(item.branch_id) === String(branch.id))?.quantity || 0)
      return { value: String(branch.id), label: `${branch.name || branch.id} (${branchQty})` }
    }),
  ], [branches, chooseBranchLabel, transferModal])
  const branchWithPlaceholderOptions = useMemo(() => [
    { value: '', label: chooseBranchLabel },
    ...branchSelectOptions,
  ], [branchSelectOptions, chooseBranchLabel])
  const moveReasonOptions = useMemo(() => [
    { value: '', label: t('reason') || 'Reason' },
    ...reasonsByType.move.map((entry) => ({ value: entry.label, label: entry.label })),
    { value: 'broken', label: tr('reason_broken', 'Broken') },
    { value: 'open', label: tr('reason_opened', 'Opened') },
    { value: 'loose', label: tr('reason_loose', 'Loose') },
    { value: 'discount', label: tr('reason_discount', 'Discount / promotion') },
    { value: 'special_price', label: tr('reason_special_price', 'Special price') },
    { value: 'other', label: t('other') || 'Other' },
  ], [reasonsByType.move, t, tr])
  const moveDestinationProductOptions = useMemo(
    () => moveModal
      ? buildDestinationProductOptions(summary, moveModal.id, tr('choose_destination_product', 'Choose a destination product row'))
      : [],
    [moveModal, summary, tr],
  )
  const adjustCurrentQuantity = adjustModal
    ? getStockQty(summaryById.get(Number(adjustForm.product_id || adjustModal.id)) || adjustModal)
    : 0

  const handleAdjust = async () => {
    if (adjustSaving) return
    const qty = parseFloat(String(adjustForm.quantity))
    if (!qty || qty <= 0) return notify('Invalid quantity', 'error')
    const selectedAdjustProduct = summaryById.get(Number(adjustForm.product_id || adjustModal?.id)) || adjustModal
    if (!selectedAdjustProduct) return notify('Select a product first', 'error')
    const previousSnapshot = cloneHistorySnapshot(selectedAdjustProduct)
    const numericBranchId = adjustForm.branch_id ? parseInt(String(adjustForm.branch_id), 10) : null
    const selectedBranchStockById = new Map(
      (selectedAdjustProduct?.branch_stock || []).map((entry) => [Number(entry?.branch_id || 0), entry]),
    )
    const selectedBranchStock = numericBranchId ? selectedBranchStockById.get(numericBranchId) : null
    const previousQuantity = numericBranchId
      ? Number(selectedBranchStock?.quantity || 0)
      : Number(getStockQty(selectedAdjustProduct) || 0)
    const adjustmentRequest = {
      productId: selectedAdjustProduct.id,
      productName: selectedAdjustProduct.name,
      type: adjustForm.type,
      quantity: qty,
      unitCostUsd: parseFloat(String(adjustForm.unit_cost_usd)) || 0,
      unitCostKhr: parseFloat(String(adjustForm.unit_cost_khr)) || 0,
      reason: adjustForm.reason || '',
      branchId: numericBranchId,
      userId: user?.id,
      userName: user?.name || user?.username,
    }
    if (adjustForm.type === 'remove') {
      if (numericBranchId) {
        const available = selectedBranchStock?.quantity || 0
        if (available <= 0) { notify(t('error')||'No stock in this branch to remove', 'error'); return }
        if (qty > available) { notify(`Cannot remove ${qty} - only ${available} available`, 'error'); return }
      } else {
        const totalQty = getStockQty(adjustModal)
        if (totalQty <= 0) { notify('No stock available to remove', 'error'); return }
        if (qty > totalQty) { notify(`Cannot remove ${qty} - only ${totalQty} available`, 'error'); return }
      }
    }
    const adjustConfirmLabel = adjustForm.type === 'set'
      ? tr('confirm_set_stock')
      : adjustForm.type === 'remove'
        ? tr('confirm_remove_stock')
        : tr('confirm_add_stock')
    if (!beginSingleAction(adjustStockInFlightRef, { blocked: adjustSaving })) return
    if (!window.confirm(adjustConfirmLabel)) {
      finishSingleAction(adjustStockInFlightRef)
      return
    }
    setAdjustSaving(true)
    try {
      const res = await runInventoryMutation(() => getInventoryApi().adjustStock(adjustmentRequest), 'Adjust inventory stock')
      if (res?.success) {
        actionHistory.pushAction({
          label: `Adjust stock for ${previousSnapshot?.name || adjustModal?.name || 'product'}`,
          undo: async () => {
            const inverseRequest = adjustmentRequest.type === 'set'
              ? { ...adjustmentRequest, type: 'set', quantity: previousQuantity, reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
              : adjustmentRequest.type === 'remove'
                ? { ...adjustmentRequest, type: 'add', reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
                : { ...adjustmentRequest, type: 'remove', reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
            const undoResult = await runInventoryMutation(() => getInventoryApi().adjustStock(inverseRequest), 'Undo inventory adjustment')
            if (!undoResult?.success) throw new Error(undoResult?.error || 'Failed to undo stock adjustment')
            await load(true)
          },
          redo: async () => {
            const redoResult = await runInventoryMutation(() => getInventoryApi().adjustStock({ ...adjustmentRequest, reason: `Redo: ${adjustmentRequest.reason || 'inventory adjustment'}` }), 'Redo inventory adjustment')
            if (!redoResult?.success) throw new Error(redoResult?.error || 'Failed to redo stock adjustment')
            await load(true)
          },
        })
        notify('Stock adjusted')
        setAdjustModal(null)
        await load(true)
      }
      else notify(res?.error || 'Adjustment failed', 'error')
    } catch (e: unknown) { notify(e instanceof Error ? e.message : 'Error', 'error') }
    finally {
      finishSingleAction(adjustStockInFlightRef)
      setAdjustSaving(false)
    }
  }

  const openAdjust = (p: InventoryProduct) => {
    void ensureInventoryReasonsLoaded()
    setAdjustModal(p)
    const defaultBranchId = defaultBranch?.id?.toString() || ''
    setAdjustForm({ product_id: p.id, type:'add', quantity:1, unit_cost_usd: p.purchase_price_usd || p.cost_price_usd || 0, unit_cost_khr: p.purchase_price_khr || 0, reason:'', branch_id: defaultBranchId })
  }

  const openMove = (p: InventoryProduct) => {
    void ensureInventoryReasonsLoaded()
    setMoveModal(p)
    const defaultBranchId = branchFilter !== 'all'
      ? String(branchFilter)
      : defaultBranch?.id?.toString() || ''
    setMoveForm({
      mode: 'existing',
      destination_product_id: '',
      destination_name: `${p.name} - ${tr('damaged', 'Damaged')}`,
      quantity: 1,
      branch_id: defaultBranchId,
      reason: 'broken',
      note: '',
      selling_price_usd: p.selling_price_usd || '',
      special_price_usd: p.special_price_usd || '',
      discount_enabled: false,
      discount_type: 'percent',
      discount_percent: '',
      discount_amount_usd: '',
    })
  }

  const openTransfer = (p: InventoryProduct) => {
    void ensureInventoryReasonsLoaded()
    const branchStock = Array.isArray(p?.branch_stock) ? p.branch_stock : []
    const firstStockBranch = branchStock.find((item: LegacyInventoryRecord) => Number(item?.quantity || 0) > 0)?.branch_id
    const defaultSourceId = branchFilter !== 'all'
      ? String(branchFilter)
      : String(firstStockBranch || defaultBranch?.id || '')
    const defaultDestinationId = String(
      defaultTransferDestinationBySourceId.get(defaultSourceId) || '',
    )
    setTransferModal(p)
    setTransferForm({
      from_branch_id: defaultSourceId,
      to_branch_id: defaultDestinationId !== defaultSourceId ? defaultDestinationId : '',
      quantity: 1,
      reason: '',
    })
  }

  const openMovementProductDetail = useCallback(async (movement: InventoryMovement) => {
    const productId = Number(movement?.product_id || 0)
    const current = productId ? summaryById.get(productId) : null
    if (current) {
      setDetailProduct(current)
      return
    }
    if (productId && getInventoryApi().getProductsByIds) {
      try {
        const result = await withLoaderTimeout(
          () => getInventoryApi().getProductsByIds([productId], { include: 'branch_stock,images,batches' }),
          'Inventory product detail',
          INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS,
        )
        const product = Array.isArray(result?.items) ? result.items[0] : null
        if (product) {
          setDetailProduct(product)
          return
        }
      } catch (_) {}
    }
    setDetailProduct({
      id: productId || movement?.id,
      name: movement?.product_name || t('product') || 'Product',
      stock_quantity: Number(movement?.quantity || 0),
      unit: movement?.unit || '',
      purchase_price_usd: Number(movement?.unit_cost_usd || 0),
      purchase_price_khr: Number(movement?.unit_cost_khr || 0),
      branch_stock: movement?.branch_id ? [{
        branch_id: movement.branch_id,
        branch_name: movement.branch_name || '',
        quantity: Number(movement.quantity || 0),
      }] : [],
    })
  }, [summaryById, t])

  const handleMoveStock = async () => {
    if (moveSaving || !moveModal) return
    const qty = parseFloat(String(moveForm.quantity))
    if (!qty || qty <= 0) return notify(tr('invalid_quantity', 'Invalid quantity'), 'error')
    const request = {
      sourceProductId: moveModal.id,
      destinationProductId: moveForm.mode === 'existing' ? Number(moveForm.destination_product_id || 0) : null,
      destinationProduct: moveForm.mode === 'new'
        ? {
            name: moveForm.destination_name,
            selling_price_usd: moveForm.selling_price_usd,
            special_price_usd: moveForm.special_price_usd,
            discount_enabled: moveForm.discount_enabled ? 1 : 0,
            discount_type: moveForm.discount_type,
            discount_percent: moveForm.discount_percent,
            discount_amount_usd: moveForm.discount_amount_usd,
          }
        : null,
      branchId: moveForm.branch_id || null,
      quantity: qty,
      reason: moveForm.reason || 'stock move',
      note: moveForm.note || '',
      userId: user?.id,
      userName: user?.name || user?.username,
    }
    if (moveForm.mode === 'existing' && !request.destinationProductId) {
      return notify(tr('choose_destination_product', 'Choose a destination product row.'), 'error')
    }
    if (moveForm.mode === 'new' && !String(moveForm.destination_name || '').trim()) {
      return notify(tr('name_required_alert', 'Name is required'), 'error')
    }
    const moveTargetLabel = moveForm.mode === 'existing'
      ? tr('existing_product', 'existing product')
      : String(moveForm.destination_name || '').trim()
    if (!beginSingleAction(moveStockInFlightRef, { blocked: moveSaving })) return
    if (!window.confirm(tr('confirm_move_stock'))) {
      finishSingleAction(moveStockInFlightRef)
      return
    }
    setMoveSaving(true)
    try {
      const result = await runInventoryMutation(() => getInventoryApi().moveStockRow(request), 'Move inventory stock')
      if (!result?.success) throw new Error(result?.error || tr('stock_move_failed', 'Stock move failed'))
      actionHistory.pushAction({
        label: `${tr('move_stock', 'Move stock')}: ${moveModal.name}`,
        undo: async () => {
          const undoResult = await runInventoryMutation(() => getInventoryApi().moveStockRow({
            sourceProductId: result.destinationProductId || request.destinationProductId,
            destinationProductId: request.sourceProductId,
            branchId: request.branchId,
            quantity: qty,
            reason: `Undo: ${request.reason}`,
          }), 'Undo inventory stock move')
          if (!undoResult?.success) throw new Error(undoResult?.error || tr('undo_failed', 'Undo failed'))
          await load(true)
        },
        redo: async () => {
          const redoResult = await runInventoryMutation(() => getInventoryApi().moveStockRow(request), 'Redo inventory stock move')
          if (!redoResult?.success) throw new Error(redoResult?.error || tr('redo_failed', 'Redo failed'))
          await load(true)
        },
      })
      notify(tr('stock_moved', 'Stock moved'))
      setMoveModal(null)
      await load(true)
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : tr('stock_move_failed', 'Stock move failed'), 'error')
    } finally {
      finishSingleAction(moveStockInFlightRef)
      setMoveSaving(false)
    }
  }

  const handleTransferStock = async () => {
    if (transferSaving || !transferModal) return
    const quantity = Number.parseFloat(String(transferForm.quantity))
    if (!transferForm.from_branch_id || !transferForm.to_branch_id) {
      notify(tr('select_transfer_branches', 'Choose both source and destination branches.'), 'error')
      return
    }
    if (transferForm.from_branch_id === transferForm.to_branch_id) {
      notify(tr('transfer_branch_must_differ', 'Source and destination branches must be different.'), 'error')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      notify(tr('invalid_quantity', 'Invalid quantity'), 'error')
      return
    }
    if (!String(transferForm.reason || '').trim()) {
      notify(tr('transfer_reason_required', 'A transfer reason is required.'), 'error')
      return
    }
    const fromBranch = branchesById.get(String(transferForm.from_branch_id))
    const toBranch = branchesById.get(String(transferForm.to_branch_id))
    if (!fromBranch || !toBranch) {
      notify(tr('select_transfer_branches', 'Choose both source and destination branches.'), 'error')
      return
    }
    if (!beginSingleAction(transferStockInFlightRef, { blocked: transferSaving })) return
    if (!window.confirm(tr('confirm_transfer_stock'))) {
      finishSingleAction(transferStockInFlightRef)
      return
    }

    setTransferSaving(true)
    try {
      const previousSnapshot = cloneHistorySnapshot(transferModal)
      const result = await runInventoryMutation(() => getInventoryApi().transferInventoryStock({
        productId: transferModal.id,
        fromBranchId: transferForm.from_branch_id,
        toBranchId: transferForm.to_branch_id,
        quantity,
        reason: transferForm.reason,
        userId: user?.id,
        userName: user?.name || user?.username,
      }), 'Transfer inventory stock')
      if (!result?.success) throw new Error(result?.error || tr('stock_transfer_failed', 'Stock transfer failed'))
      actionHistory.pushAction({
        label: `${tr('transfer', 'Transfer')}: ${transferModal.name}`,
        undo: async () => {
          const undoResult = await runInventoryMutation(() => getInventoryApi().transferInventoryStock({
            productId: transferModal.id,
            fromBranchId: transferForm.to_branch_id,
            toBranchId: transferForm.from_branch_id,
            quantity,
            reason: `Undo: ${transferForm.reason}`,
            userId: user?.id,
            userName: user?.name || user?.username,
          }), 'Undo inventory stock transfer')
          if (!undoResult?.success) throw new Error(undoResult?.error || tr('undo_failed', 'Undo failed'))
          await load(true)
        },
        redo: async () => {
          const redoResult = await runInventoryMutation(() => getInventoryApi().transferInventoryStock({
            productId: transferModal.id,
            fromBranchId: transferForm.from_branch_id,
            toBranchId: transferForm.to_branch_id,
            quantity,
            reason: `Redo: ${transferForm.reason}`,
            userId: user?.id,
            userName: user?.name || user?.username,
          }), 'Redo inventory stock transfer')
          if (!redoResult?.success) throw new Error(redoResult?.error || tr('redo_failed', 'Redo failed'))
          await load(true)
        },
      })
      notify(tr('stock_transferred', 'Stock transferred'))
      setTransferModal(null)
      await load(true)
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : tr('stock_transfer_failed', 'Stock transfer failed'), 'error')
    } finally {
      finishSingleAction(transferStockInFlightRef)
      setTransferSaving(false)
    }
  }

  // Search: comma-separated terms, AND/OR mode matching Products page behaviour
  const searchTerms: string[] = useMemo(() => (
    deferredSearch.trim()
      ? (deferredSearch.includes(',') ? deferredSearch.split(',') : deferredSearch.split(/\s+/))
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  ), [deferredSearch])

  const matchesSearch = useCallback((hay: string): boolean => {
    if (!searchTerms.length) return true
    return searchMode === 'AND'
      ? searchTerms.every(term => hay.includes(term))
      : searchTerms.some(term => hay.includes(term))
  }, [searchMode, searchTerms])

  const productHay = useCallback((p: InventoryProduct): string => (
    `${p.name} ${p.category||''} ${p.brand||''} ${p.supplier||''} ${p.sku||''} ${p.barcode||''} ${p.description||''} ${p.unit||''}`.toLowerCase()
  ), [])

  const movHay = useCallback((m: InventoryMovement): string => (
    `${m.product_name||''} ${m.branch_name||''} ${m.reason||''} ${m.user_name||''} ${m.movement_type||''} ${m.reference_id||''} ${m.lot_code||''} ${m.expiry_date||''} ${m.created_at||''}`.toLowerCase()
  ), [])

  const hasServerBackedProductSearch = !!searchTerms.length
  const filteredSummary = useMemo(() => summary.filter((p: InventoryProduct) => {
    if (!hasServerBackedProductSearch && !matchesSearch(productHay(p))) return false
    const normalizedBrandFilter = String(brandFilter || '').trim().replace(/\s+/g, ' ').toLowerCase()
    const normalizedProductBrand = String(p.brand || '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (normalizedBrandFilter !== 'all' && normalizedProductBrand !== normalizedBrandFilter) return false
    const isParent = Boolean(p.is_group || parentProductIds.has(Number(p.id)))
    const isVariant = Boolean(p.parent_id)
    const normalizedGroupFilter = String(groupFilter || 'all').toLowerCase()
    const isGroupedFamilyMember = isParent || isVariant
    if (['group', 'groups', 'grouped', 'parent', 'variant'].includes(normalizedGroupFilter) && !isGroupedFamilyMember) return false
    if (normalizedGroupFilter === 'standalone' && isGroupedFamilyMember) return false
    const qty = getStockQty(p)
    if (stockFilter === 'low')      return qty > 0 && qty <= p.low_stock_threshold
    if (stockFilter === 'out')      return qty <= (p.out_of_stock_threshold || 0)
    if (stockFilter === 'in_stock') return qty > (p.low_stock_threshold || 0)
    return true
  }), [brandFilter, groupFilter, hasServerBackedProductSearch, matchesSearch, parentProductIds, productHay, stockFilter, summary])

  const inventoryProductsById = useMemo(
    () => new Map(summary.map((product) => [Number(product?.id || 0), product])),
    [summary],
  )

  const inventoryProductSections = useMemo(
    () => buildProductGroupSections(filteredSummary, {
      productsById: inventoryProductsById,
      sortDirection: 'asc',
    }),
    [filteredSummary, inventoryProductsById],
  )

  const visibleInventoryProducts = useMemo(
    () => inventoryProductSections.flatMap((section) => section.items),
    [inventoryProductSections],
  )
  const visibleInventoryProductIds = useMemo<number[]>(
    () => visibleInventoryProducts.reduce((ids, product) => {
      const id = Number(product?.id)
      if (Number.isFinite(id)) ids.push(id)
      return ids
    }, [] as number[]),
    [visibleInventoryProducts],
  )
  const visibleInventoryProductsSignature = useMemo(
    () => visibleInventoryProductIds.join(','),
    [visibleInventoryProductIds],
  )
  const initialMobileInventorySections = useMemo(
    () => limitInventorySectionsForMobile(inventoryProductSections, INVENTORY_MOBILE_INITIAL_ITEM_LIMIT),
    [inventoryProductSections],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 639px)')
    const syncViewport = (event: MediaQueryList | MediaQueryListEvent) => {
      setIsInventoryMobileViewport(Boolean(event?.matches))
    }
    syncViewport(media)
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncViewport)
      return () => media.removeEventListener('change', syncViewport)
    }
    if (typeof media.addListener === 'function') {
      media.addListener(syncViewport)
      return () => media.removeListener(syncViewport)
    }
    return undefined
  }, [])

  useEffect(() => {
    if (initialInventoryDesktopRevealReady || loading) return
    if (!visibleInventoryProducts.length || loadError) {
      setInitialInventoryDesktopRevealReady(true)
      return
    }
    let cancelled = false
    let nestedFrame: number | null = null
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => {
        if (!cancelled) setInitialInventoryDesktopRevealReady(true)
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      if (nestedFrame !== null) window.cancelAnimationFrame(nestedFrame)
    }
  }, [initialInventoryDesktopRevealReady, loadError, loading, visibleInventoryProducts.length, visibleInventoryProductsSignature])

  useEffect(() => {
    if (initialInventoryMobileRevealReady) return
    const showingProductsForReveal = inventorySection === 'products' || (inventorySection === 'all' && tab === 'products')
    if (!showingProductsForReveal) {
      setInitialInventoryMobileRevealReady(true)
      return
    }
    if (showingProductsForReveal && !inventoryProductsLoaded && !loadError) return
    setInitialInventoryMobileRevealReady(true)
  }, [
    initialInventoryMobileRevealReady,
    inventoryProductsLoaded,
    inventorySection,
    loadError,
    tab,
  ])

  useLayoutEffect(() => {
    setInitialInventoryMobileFullListReady(false)
  }, [inventorySection, tab, visibleInventoryProductsSignature])

  useEffect(() => {
    const showingProductsForReveal = inventorySection === 'products' || (inventorySection === 'all' && tab === 'products')
    if (!isActive || !showingProductsForReveal || !initialInventoryMobileRevealReady || initialInventoryMobileFullListReady || !visibleInventoryProducts.length) return
    if (visibleInventoryProducts.length <= INVENTORY_MOBILE_INITIAL_ITEM_LIMIT) {
      setInitialInventoryMobileFullListReady(true)
      return
    }
    const timer = window.setTimeout(() => setInitialInventoryMobileFullListReady(true), 140)
    return () => window.clearTimeout(timer)
  }, [
    initialInventoryMobileFullListReady,
    initialInventoryMobileRevealReady,
    isActive,
    inventorySection,
    tab,
    visibleInventoryProducts.length,
    visibleInventoryProductsSignature,
  ])

  useEffect(() => {
    setInventoryProductPage(1)
  }, [branchFilter, brandFilter, deferredSearch, groupFilter, inventoryInitialFilter, searchMode, stockFilter, tab])

  useEffect(() => {
    setMovementMeta((current) => ({ ...current, page: 1 }))
    if (needsMovementData) setMovementsLoaded(false)
  }, [branchFilter, deferredSearch, movementEndDate, movementStartDate, movementUserFilter, needsMovementData, searchMode])

  useEffect(() => {
    if (!isActive || !loadedOnceRef.current || !needsProductSummary) return
    load(true, { force: true }).catch(() => {})
  }, [
    branchFilter,
    brandFilter,
    deferredSearch,
    groupFilter,
    inventoryInitialFilter,
    inventoryProductPage,
    inventoryProductPageSize,
    isActive,
    load,
    needsProductSummary,
    searchMode,
    stockFilter,
  ])

  useEffect(() => {
    if (!isActive || !loadedOnceRef.current || !needsMovementData) return
    load(true, { force: true }).catch(() => {})
  }, [
    branchFilter,
    deferredSearch,
    isActive,
    load,
    movementEndDate,
    movementMeta.page,
    movementMeta.pageSize,
    movementStartDate,
    movementUserFilter,
    needsMovementData,
    searchMode,
  ])

  useEffect(() => {
    const validIds = new Set(visibleInventoryProductIds)
    setSelectedProductIds((current) => reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id))))
  }, [visibleInventoryProductIds])

  useEffect(() => {
    if (!inventorySelectAllRef.current) return
    inventorySelectAllRef.current.indeterminate = selectedProductIds.size > 0 && selectedProductIds.size < visibleInventoryProducts.length
  }, [selectedProductIds.size, visibleInventoryProducts.length])

  const toggleSelectedProduct = useCallback((productId: InventoryId) => {
    const numericId = Number(productId)
    if (!Number.isFinite(numericId)) return
    setSelectedProductIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }, [])

  const toggleSelectAllProducts = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedProductIds(new Set())
      return
    }
    setSelectedProductIds(new Set(visibleInventoryProductIds))
  }, [visibleInventoryProductIds])

  const selectedProducts = useMemo<InventoryProduct[]>(
    () => visibleInventoryProducts.filter((product) => selectedProductIds.has(Number(product.id))) as InventoryProduct[],
    [selectedProductIds, visibleInventoryProducts],
  )
  const hasSelectedProducts = selectedProducts.length > 0

  const buildBatchDraft = useCallback((product: InventoryProduct): InventoryBatchLine => {
    const defaultBranchId = branchFilter !== 'all'
      ? String(branchFilter)
      : defaultBranch?.id?.toString() || ''
    const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock : []
    const firstStockBranch = branchStock.find((item: LegacyInventoryRecord) => Number(item?.quantity || 0) > 0)?.branch_id
    const defaultSourceId = branchFilter !== 'all'
      ? String(branchFilter)
      : String(firstStockBranch || defaultBranch?.id || '')
    const defaultDestinationId = String(
      defaultTransferDestinationBySourceId.get(defaultSourceId) || '',
    )
    return {
      id: Number(product.id),
      productId: Number(product.id),
      productName: product.name,
      unit: product.unit || '',
      quantity: '1',
      action: 'adjust',
      adjustType: 'add',
      branchId: defaultBranchId,
      fromBranchId: defaultSourceId,
      toBranchId: defaultDestinationId !== defaultSourceId ? defaultDestinationId : '',
      reason: '',
      note: '',
      moveMode: 'existing',
      destinationProductId: '',
      destinationName: `${product.name} - ${tr('damaged', 'Damaged')}`,
      sellingPriceUsd: product.selling_price_usd || '',
      specialPriceUsd: product.special_price_usd || '',
      discountEnabled: false,
      discountType: 'percent',
      discountPercent: '',
      discountAmountUsd: '',
      unitCostUsd: product.purchase_price_usd || product.cost_price_usd || 0,
      unitCostKhr: product.purchase_price_khr || 0,
      stockQty: getStockQty(product),
      error: '',
    }
  }, [branchFilter, defaultBranch, defaultTransferDestinationBySourceId, getStockQty, tr])

  const openInventoryBatchSession = useCallback(() => {
    if (!selectedProducts.length) return
    void ensureInventoryReasonsLoaded()
    setInventoryBatch({
      items: selectedProducts.map((product) => buildBatchDraft(product)),
    })
  }, [buildBatchDraft, ensureInventoryReasonsLoaded, selectedProducts])

  const updateInventoryBatchLine = useCallback((productId: InventoryId, patch: Partial<InventoryBatchLine>) => {
    setInventoryBatch((current) => {
      if (!current?.items?.length) return current
      return {
        ...current,
        items: current.items.map((item) => (
          Number(item.productId) === Number(productId)
            ? { ...item, ...patch, error: patch?.error ?? '' }
            : item
        )),
      }
    })
  }, [])

  const removeInventoryBatchLine = useCallback((productId: InventoryId) => {
    const numericId = Number(productId)
    setInventoryBatch((current) => {
      if (!current?.items?.length) return current
      const nextItems = current.items.filter((item) => Number(item.productId) !== numericId)
      return nextItems.length ? { ...current, items: nextItems } : null
    })
    setSelectedProductIds((current) => {
      const next = new Set(current)
      next.delete(numericId)
      return next
    })
  }, [])

  const applyInventoryBatchSession = useCallback(async () => {
    if (batchApplying || !inventoryBatch?.items?.length) return
    if (!beginSingleAction(batchInventoryInFlightRef, { blocked: batchApplying })) return
    if (!window.confirm(tr('confirm_apply_inventory_batch'))) {
      finishSingleAction(batchInventoryInFlightRef)
      return
    }
    setBatchApplying(true)
    try {
      const applyRun = await runConcurrentTasks(inventoryBatch.items, async (item: InventoryBatchLine) => {
        const quantity = Number.parseFloat(String(item.quantity))
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(tr('invalid_quantity', 'Invalid quantity'))
        }
        if (item.action === 'adjust') {
          const result = await runInventoryMutation(() => getInventoryApi().adjustStock({
            productId: item.productId,
            productName: item.productName,
            type: item.adjustType,
            quantity,
            reason: item.reason || tr('inventory_adjustment', 'Inventory adjustment'),
            branchId: item.branchId,
            unitCostUsd: item.unitCostUsd,
            unitCostKhr: item.unitCostKhr,
          }), 'Batch adjust inventory stock')
          if (!result?.success) throw new Error(result?.error || tr('adjust_failed', 'Adjustment failed'))
        } else if (item.action === 'transfer') {
          const result = await runInventoryMutation(() => getInventoryApi().transferInventoryStock({
            productId: item.productId,
            fromBranchId: item.fromBranchId,
            toBranchId: item.toBranchId,
            quantity,
            reason: item.reason,
          }), 'Batch transfer inventory stock')
          if (!result?.success) throw new Error(result?.error || tr('transfer_failed', 'Transfer failed'))
        } else if (item.action === 'move') {
          const request: LegacyInventoryRecord = {
            sourceProductId: item.productId,
            destinationProductId: item.moveMode === 'existing' ? Number(item.destinationProductId || 0) : null,
            branchId: item.branchId,
            quantity,
            reason: item.reason || 'broken',
            note: item.note || '',
          }
          if (item.moveMode === 'new') {
            request.destinationProduct = {
              name: item.destinationName,
              selling_price_usd: item.sellingPriceUsd,
              special_price_usd: item.specialPriceUsd,
              discount_enabled: !!item.discountEnabled,
              discount_type: item.discountType,
              discount_percent: item.discountPercent,
              discount_amount_usd: item.discountAmountUsd,
            }
          }
          const result = await runInventoryMutation(() => getInventoryApi().moveStockRow(request), 'Batch move inventory stock')
          if (!result?.success) throw new Error(result?.error || tr('stock_move_failed', 'Stock move failed'))
        }
      })
      const failedItems = applyRun.failures.map((entry: LegacyInventoryRecord) => ({
        ...(entry.item || {}),
        error: entry?.error?.message || tr('save_failed', 'Save failed'),
      }))
      const successCount = applyRun.successes.length
      await load(true)
      if (!failedItems.length) {
        setInventoryBatch(null)
        setSelectedProductIds(new Set())
        notify(
          successCount === 1
            ? tr('batch_inventory_done_one', 'Applied inventory update.')
            : tr('batch_inventory_done_many', `${successCount} inventory updates applied.`),
        )
        return
      }
      setInventoryBatch({ items: failedItems })
      setSelectedProductIds(new Set(normalizeFiniteIdsFrom(failedItems, (item) => item.productId)))
      notify(
        tr(
          'batch_inventory_partial_failure',
          `${successCount} applied, ${failedItems.length} need review.`,
        ),
        'warning',
      )
    } finally {
      finishSingleAction(batchInventoryInFlightRef)
      setBatchApplying(false)
    }
  }, [batchApplying, inventoryBatch, load, notify, runInventoryMutation, tr])

  const hasServerBackedMovementSearch = !!searchTerms.length
  const filteredMovements = useMemo(() => movements.filter(m => {
    if (movFilter !== 'all' && m.movement_type !== movFilter) return false
    return hasServerBackedMovementSearch ? true : matchesSearch(movHay(m))
  }), [hasServerBackedMovementSearch, matchesSearch, movFilter, movHay, movements])

  const groupedMovements = useMemo(() => {
    const groups = buildMovementGroups(filteredMovements)
    return hasServerBackedMovementSearch
      ? groups
      : groups.filter((group) => matchesSearch(movementGroupHaystack(group)))
  }, [filteredMovements, hasServerBackedMovementSearch, matchesSearch])

  const movementYears = useMemo(
    () => getAvailableYears(groupedMovements, (group) => group?.latest_at || group?.created_at),
    [groupedMovements],
  )

  const movementSections = useMemo(() => (
    buildTimeActionSections(groupedMovements, {
      getDate: (group) => group?.latest_at || group?.created_at,
      getItemId: (group) => group?.id,
      getActionKey: (group) => group?.movement_type || 'other',
      getActionLabel: (group) => group?.movementLabel || group?.movement_type || 'Other',
      year: movementYearFilter,
      month: movementMonthFilter,
      timeMode: movementTimeMode,
      groupMode: movementGroupMode,
      sortDirection: movementSortDirection,
    })
  ), [groupedMovements, movementGroupMode, movementMonthFilter, movementSortDirection, movementTimeMode, movementYearFilter])

  const visibleMovementGroups = useMemo(
    () => movementSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [movementSections],
  )
  const visibleMovementGroupIds = useMemo(
    () => new Set(visibleMovementGroups.map((group) => group.id)),
    [visibleMovementGroups],
  )

  const getMovementRecordCount = useCallback(
    (group: LegacyInventoryRecord) => Math.max(0, Number(group?.recordCount || group?.items?.length || 0)),
    [],
  )

  const getMovementActionGroupRecordCount = useCallback(
    (actionGroup: LegacyInventoryRecord) => (Array.isArray(actionGroup?.items)
      ? actionGroup.items.reduce((sum: number, group: LegacyInventoryRecord) => sum + getMovementRecordCount(group), 0)
      : 0),
    [getMovementRecordCount],
  )

  const getMovementSectionRecordCount = useCallback(
    (section: LegacyInventoryRecord) => (Array.isArray(section?.groups)
      ? section.groups.reduce((sum: number, actionGroup: LegacyInventoryRecord) => sum + getMovementActionGroupRecordCount(actionGroup), 0)
      : 0),
    [getMovementActionGroupRecordCount],
  )

  useEffect(() => {
    setExpandedMovementGroups((current) => {
      return reuseSetWhenUnchanged(current, [...current].filter((id) => visibleMovementGroupIds.has(id)))
    })
  }, [visibleMovementGroupIds])

  useEffect(() => {
    setExpandedMovementPages((current) => Object.fromEntries(
      Object.entries(current).filter(([groupId]) => visibleMovementGroupIds.has(groupId)),
    ))
  }, [visibleMovementGroupIds])

  useEffect(() => {
    setSelectedMovementIds((current) => reuseSetWhenUnchanged(current, [...current].filter((id) => visibleMovementGroupIds.has(id))))
  }, [visibleMovementGroupIds])

  useEffect(() => {
    if (!movementSelectAllRef.current) return
    movementSelectAllRef.current.indeterminate = selectedMovementIds.size > 0 && selectedMovementIds.size < visibleMovementGroups.length
  }, [selectedMovementIds.size, visibleMovementGroups.length])

  const toggleMovementGroup = useCallback((groupId: string) => {
    setExpandedMovementGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
    setExpandedMovementPages((current) => ({ ...current, [groupId]: current[groupId] || 1 }))
  }, [])

  const setExpandedMovementGroupPage = useCallback((groupId: string, page: number) => {
    setExpandedMovementPages((current) => ({ ...current, [groupId]: Math.max(1, Number(page || 1) || 1) }))
  }, [])

  const toggleMovementSelection = useCallback((groupId: string) => {
    setSelectedMovementIds((current) => toggleIdSet(current, [groupId], !current.has(groupId)))
  }, [])

  const toggleMovementScopeSelection = useCallback((ids: string[], checked: boolean) => {
    setSelectedMovementIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const toggleAllMovementSelection = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedMovementIds(new Set())
      return
    }
    setSelectedMovementIds(new Set(visibleMovementGroups.map((group) => group.id)))
  }, [visibleMovementGroups])

  const toggleMovementSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedMovementSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  useEffect(() => {
    setCollapsedMovementSections((current) => {
      const validIds = new Set(movementSections.map((section) => section.id))
      return reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id)))
    })
  }, [movementSections])

  const MOV_COLORS = {
    add:             'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    remove:          'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
    sale:            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    purchase:        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    return:          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    supplier_return: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
    return_reversal: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    adjust:          'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    adjustment:      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    set:             'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    writeoff:        'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
    transfer:        'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    row_move_in:     'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    row_move_out:    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  }

  // Stats from backend SQL already net out returned quantities and revenue.
  const visibleInventoryStats = useMemo(() => {
    const stats = {
      stockValueUsd: 0,
      lowStock: 0,
      outOfStock: 0,
      inStock: 0,
      netSoldQty: 0,
      revenueUsd: 0,
      cogsUsd: 0,
      storeDiscountUsd: 0,
      membershipDiscountUsd: 0,
    }
    for (const product of filteredSummary) {
      const qty = getStockQty(product)
      const outThreshold = product.out_of_stock_threshold || 0
      stats.stockValueUsd += product.stock_value_usd || 0
      if (qty > 0 && qty <= product.low_stock_threshold) stats.lowStock += 1
      if (qty <= outThreshold) stats.outOfStock += 1
      if (qty > outThreshold) stats.inStock += 1
      stats.netSoldQty += Math.max(0, product.qty_sold || 0)
      stats.revenueUsd += Math.max(0, product.revenue_usd || 0)
      stats.cogsUsd += Math.max(0, product.cogs_usd || 0)
      stats.storeDiscountUsd += Math.max(0, product.store_discount_usd || 0)
      stats.membershipDiscountUsd += Math.max(0, product.membership_discount_usd || 0)
    }
    return stats
  }, [filteredSummary, getStockQty])
  const visibleTotalValue = visibleInventoryStats.stockValueUsd
  const visibleLowStockCount = visibleInventoryStats.lowStock
  const visibleOutStockCount = visibleInventoryStats.outOfStock
  const totalValue = Number(stockStats?.stock_value_usd ?? visibleTotalValue)
  const lowStockCount = Number(stockStats?.low_stock ?? visibleLowStockCount)
  const outStockCount = Number(stockStats?.out_of_stock ?? visibleOutStockCount)
  const inStockCount = Number(stockStats?.in_stock ?? visibleInventoryStats.inStock)
  const totalProducts = Number(
    stockStats?.total_products
    ?? (inventoryProductsLoaded ? inventoryProductTotal : null)
    ?? summary.length,
  )
  const totalQtySold = Number(
    stockStats?.net_sold_qty
    ?? visibleInventoryStats.netSoldQty,
  )
  const totalRevenue = Number(
    stockStats?.revenue_usd
    ?? visibleInventoryStats.revenueUsd,
  )
  const totalCOGS = Number(
    stockStats?.cogs_usd
    ?? visibleInventoryStats.cogsUsd,
  )
  const totalStoreDiscounts = Number(
    stockStats?.store_discount_usd
    ?? visibleInventoryStats.storeDiscountUsd,
  )
  const totalMembershipDiscounts = Number(
    stockStats?.membership_discount_usd
    ?? visibleInventoryStats.membershipDiscountUsd,
  )
  const totalProfit   = totalRevenue - totalCOGS
  const inventoryProductSafePageSize = Math.max(1, Number(inventoryProductPageSize || PAGE_SIZE_OPTIONS[0]))
  const inventoryProductSafePage = clampPage(inventoryProductPage, totalProducts, inventoryProductSafePageSize)
  const inventoryProductTotalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalProducts || 0)) / inventoryProductSafePageSize))
  const inventoryProductStart = totalProducts ? (((inventoryProductSafePage - 1) * inventoryProductSafePageSize) + 1) : 0
  const inventoryProductEnd = totalProducts ? Math.min(totalProducts, inventoryProductSafePage * inventoryProductSafePageSize) : 0
  const inventoryProductSummaryLabel = totalProducts
    ? `${inventoryProductStart.toLocaleString()}-${inventoryProductEnd.toLocaleString()} / ${Number(totalProducts || 0).toLocaleString()}`
    : '0 / 0'
  const getInventoryGroupPriceLabel = useCallback((group: LegacyInventoryRecord) => {
    const min = Number(group?.minSellingPriceUsd || 0)
    const max = Number(group?.maxSellingPriceUsd || 0)
    if (group?.hasMultipleItems && min !== max) return `${fmtUSD(min)} - ${fmtUSD(max)}`
    return fmtUSD(max || min || 0)
  }, [fmtUSD])
  const getInventoryGroupSummaryParts = useCallback((group: LegacyInventoryRecord, { includeCount = true }: { includeCount?: boolean } = {}) => {
    const parts = [
      includeCount ? `${group?.items?.length || 0} ${(group?.items?.length || 0) === 1 ? (t('option') || 'option') : (t('options') || 'options')}` : null,
      `${group?.stockTotal || 0} ${(t('stock') || 'stock').toLowerCase()}`,
      getInventoryGroupPriceLabel(group),
    ]
    return parts.filter(Boolean) as string[]
  }, [getInventoryGroupPriceLabel, t])
  const inventoryControlLabels = useMemo(() => ({
    selected: tr('inventory_selected_count', `${selectedProducts.length} selected`),
    selectAll: `${tr('select_all', 'Select all')} (${visibleInventoryProducts.length})`,
    batch: tr('inventory_batch_session', 'Batch'),
    reasons: tr('saved_reasons', 'Reasons'),
  }), [selectedProducts.length, tr, visibleInventoryProducts.length])
  useEffect(() => {
    setCollapsedInventorySections((current) => {
      const validIds = new Set(inventoryProductSections.map((section) => section.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [inventoryProductSections])
  useEffect(() => {
    setCollapsedInventoryGroups((current) => {
      const validIds = new Set(inventoryProductSections.flatMap((section) => section.groups.map((group) => group.key)))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [inventoryProductSections])
  const isInventorySelectionScopeFullySelected = useCallback((ids: unknown[] = []) => {
    const normalized = normalizeFiniteIds(ids)
    return normalized.length > 0 && normalized.every((id) => selectedProductIds.has(id))
  }, [selectedProductIds])
  const isInventorySelectionScopePartiallySelected = useCallback((ids: unknown[] = []) => {
    const normalized = normalizeFiniteIds(ids)
    if (!normalized.length) return false
    const selectedCount = countSelectedIds(normalized, selectedProductIds)
    return selectedCount > 0 && selectedCount < normalized.length
  }, [selectedProductIds])
  const toggleInventorySelectionScope = useCallback((ids: unknown[] = [], checked: boolean) => {
    const normalized = normalizeFiniteIds(ids)
    setSelectedProductIds((current) => toggleIdSet(current, normalized, checked))
  }, [])
  const toggleInventorySection = useCallback((sectionId: string) => {
    setCollapsedInventorySections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])
  const toggleInventoryGroup = useCallback((groupKey: string) => {
    setCollapsedInventoryGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])
  useEffect(() => {
    setInventoryProductPageDraft(String(inventoryProductSafePage))
  }, [inventoryProductSafePage])
  const commitInventoryProductPageDraft = useCallback(() => {
    const parsed = Number.parseInt(String(inventoryProductPageDraft || '').trim(), 10)
    if (!Number.isFinite(parsed)) {
      setInventoryProductPageDraft(String(inventoryProductSafePage))
      return
    }
    const nextPage = Math.min(inventoryProductTotalPages, Math.max(1, parsed))
    setInventoryProductPage(nextPage)
    setInventoryProductPageDraft(String(nextPage))
  }, [inventoryProductPageDraft, inventoryProductSafePage, inventoryProductTotalPages])
  const cycleInventoryProductPageSize = useCallback(() => {
    const currentIndex = PAGE_SIZE_OPTIONS.findIndex((option) => Number(option) === Number(inventoryProductSafePageSize))
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % PAGE_SIZE_OPTIONS.length : 0
    setInventoryProductPageSize(PAGE_SIZE_OPTIONS[nextIndex])
    setInventoryProductPage(1)
  }, [inventoryProductSafePageSize])
  const inventoryThresholdFormulaText = tr('inventory_formula_thresholds', 'Low/Out counts are derived from stock thresholds')
  const inventoryStockValueFormulaText = tr('inventory_formula_stock_value', 'Stock value = positive quantity x effective cost for all matching stock, not just the visible page')
  const inventoryNetSoldFormulaText = tr('inventory_formula_net_sold', 'Net sold = sold quantity - returned quantity')
  const inventoryRevenueFormulaText = tr('inventory_formula_revenue', 'Revenue shown is net after discounts and refunds')
  const inventoryCogsFormulaText = tr('inventory_formula_cogs', 'COGS excludes quantities restored by restocked returns')
  const inventoryProfitFormulaText = tr('inventory_formula_profit', 'Profit = Revenue - COGS')
  const inventoryDiscountFormulaText = tr('inventory_formula_discounts', 'Discount totals show store-funded and membership-funded reductions allocated across sold items.')
  const inventoryFeesFormulaText = tr('inventory_formula_fees', 'Fees collected combines sales tax and delivery fees captured on completed sales.')
  const inventoryReturnsFormulaText = tr('inventory_formula_returns', 'Returns combines customer refunds and supplier return cases so you can review every recovery path together.')
  const statsValue = (value: ReactNode) => (stockStatsLoaded ? value : '...')
  const inventoryStatLabels = {
    products: safeT('products', safeT('products_total', 'Products')),
    lowStock: tr('low_stock', 'Low stock'),
    outOfStock: tr('out_of_stock', 'Out of stock'),
    stockValue: tr('stock_value', 'Stock value'),
    netSold: tr('net_sold', 'Net sold'),
    revenue: tr('revenue', 'Revenue'),
    discounts: tr('discounts_combined', 'Discounts'),
    cogs: tr('cogs', 'COGS'),
    grossProfit: tr('gross_profit', 'Gross Profit'),
    feesCollected: tr('fees_collected', 'Fees collected'),
    returns: tr('returns_combined', 'Returns'),
    afterReturns: tr('after_returns', 'After returns'),
    afterRefunds: tr('after_refunds', 'After refunds'),
    costOfGoodsSold: tr('cost_of_goods_sold', 'Cost of Goods Sold'),
    allocatedToProducts: tr('allocated_to_products', 'Allocated to sold products'),
    taxCollected: tr('tax_collected', 'Tax collected'),
    deliveryFees: tr('delivery_fees', 'Delivery fees'),
    transactions: tr('transactions', 'Transactions'),
    returnsCount: tr('returns_count', 'Returns'),
    refunded: tr('total_refunded', 'Refunded'),
    formula: tr('formula', 'Formula'),
    taxPlusDelivery: `${tr('tax_collected', 'Tax')} + ${tr('delivery_fees', 'Delivery')}`,
  }
  const lowShortLabel = tr('low_stock_short', 'Low')
  const outShortLabel = tr('out_of_stock_short', 'Out')
  const matchStockShortLabel = tr('matching_stock_short', 'Matching')
  const afterReturnsShortLabel = tr('after_returns_short', 'After ret.')
  const afterRefundsShortLabel = tr('after_refunds_short', 'After ref.')
  const storeDiscountShortLabel = tr('store_discounts_short', 'Store')
  const memberShortLabel = tr('membership_short', 'Mem')
  const taxShortLabel = tr('tax_short', 'Tax')
  const deliveryShortLabel = tr('delivery_short', 'Del')
  const customerShortLabel = tr('customer_returns_short', 'Cust')
  const supplierShortLabel = tr('supplier_returns_short', 'Supp')
  const marginShortLabel = tr('profit_margin_short', 'margin')
  const primaryStats = [
    {
      id: 'products',
      label: inventoryStatLabels.products,
      value: statsValue(totalProducts),
      cls: 'text-gray-800 dark:text-gray-200',
      sub: stockStatsLoaded
        ? `${lowStockCount} ${lowShortLabel} | ${outStockCount} ${outShortLabel}`
        : safeT('loading', 'Loading...'),
      details: [
        { label: inventoryStatLabels.products, value: totalProducts },
        { label: inventoryStatLabels.lowStock, value: lowStockCount },
        { label: inventoryStatLabels.outOfStock, value: outStockCount },
        { label: inventoryStatLabels.formula, value: inventoryThresholdFormulaText },
      ],
    },
    {
      id: 'stock-value',
      label: inventoryStatLabels.stockValue,
      value: statsValue(fmtUSD(totalValue)),
      cls: 'text-blue-700 dark:text-blue-300',
        sub: matchStockShortLabel,
      details: [
        { label: inventoryStatLabels.stockValue, value: fmtUSD(totalValue) },
        { label: inventoryStatLabels.products, value: totalProducts },
        { label: inventoryStatLabels.formula, value: inventoryStockValueFormulaText },
      ],
    },
    {
      id: 'net-sold',
      label: inventoryStatLabels.netSold,
      value: statsValue(totalQtySold),
      cls: 'text-purple-700 dark:text-purple-300',
        sub: afterReturnsShortLabel,
      details: [
        { label: inventoryStatLabels.netSold, value: totalQtySold },
        { label: inventoryStatLabels.returnsCount, value: returnStats?.count ?? 0 },
        { label: tr('items', 'Returned items'), value: returnStats?.items ?? 0 },
        { label: inventoryStatLabels.formula, value: inventoryNetSoldFormulaText },
      ],
    },
    {
      id: 'revenue',
      label: inventoryStatLabels.revenue,
      value: statsValue(fmtUSD(totalRevenue)),
      cls: 'text-emerald-600 dark:text-emerald-400',
        sub: afterRefundsShortLabel,
      details: [
        { label: inventoryStatLabels.revenue, value: fmtUSD(totalRevenue) },
        { label: inventoryStatLabels.refunded, value: fmtUSD(returnStats?.refund_usd || 0) },
        { label: inventoryStatLabels.formula, value: inventoryRevenueFormulaText },
      ],
    },
    {
      id: 'cogs',
      label: inventoryStatLabels.cogs,
      value: statsValue(fmtUSD(totalCOGS)),
      cls: 'text-orange-600 dark:text-orange-400',
      sub: inventoryStatLabels.costOfGoodsSold,
      details: [
        { label: inventoryStatLabels.cogs, value: fmtUSD(totalCOGS) },
        { label: inventoryStatLabels.formula, value: inventoryCogsFormulaText },
      ],
    },
    {
      id: 'gross-profit',
      label: inventoryStatLabels.grossProfit,
      value: statsValue(fmtUSD(totalProfit)),
      cls: totalProfit >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-red-600 dark:text-red-400',
      sub: totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}% ${marginShortLabel}` : marginShortLabel,
      details: [
        { label: inventoryStatLabels.grossProfit, value: fmtUSD(totalProfit) },
        { label: inventoryStatLabels.revenue, value: fmtUSD(totalRevenue) },
        { label: inventoryStatLabels.cogs, value: fmtUSD(totalCOGS) },
        { label: inventoryStatLabels.formula, value: inventoryProfitFormulaText },
      ],
    },
  ]
  const financeStats = [
    {
      id: 'discounts',
      label: inventoryStatLabels.discounts,
      value: statsValue(fmtUSD(totalStoreDiscounts + totalMembershipDiscounts)),
      cls: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-400',
        sub: `${storeDiscountShortLabel} ${fmtUSD(totalStoreDiscounts)} | ${memberShortLabel} ${fmtUSD(totalMembershipDiscounts)}`,
      detailSections: [
        {
          title: tr('discount_breakdown', 'Discount breakdown'),
          rows: [
            { label: tr('store_discounts', 'Store discounts'), value: fmtUSD(totalStoreDiscounts) },
            { label: tr('membership_discounts', 'Membership discounts'), value: fmtUSD(totalMembershipDiscounts) },
            { label: tr('discounts_total', 'Total discounts'), value: fmtUSD(totalStoreDiscounts + totalMembershipDiscounts) },
            { label: inventoryStatLabels.formula, value: inventoryDiscountFormulaText },
          ],
        },
      ],
    },
    {
      id: 'fees',
      label: inventoryStatLabels.feesCollected,
      value: fmtUSD((taxDelivery.tax || 0) + (taxDelivery.delivery || 0)),
      cls: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-400',
        sub: `${taxShortLabel} ${fmtUSD(taxDelivery.tax || 0)} | ${deliveryShortLabel} ${fmtUSD(taxDelivery.delivery || 0)}`,
      detailSections: [
        {
          title: tr('fees_breakdown', 'Fee breakdown'),
          rows: [
            { label: inventoryStatLabels.taxCollected, value: fmtUSD(taxDelivery.tax || 0) },
            { label: inventoryStatLabels.deliveryFees, value: fmtUSD(taxDelivery.delivery || 0) },
            { label: inventoryStatLabels.transactions, value: taxDelivery.deliveryCount || 0 },
            { label: inventoryStatLabels.formula, value: inventoryFeesFormulaText },
          ],
        },
      ],
    },
    {
      id: 'returns',
      label: inventoryStatLabels.returns,
      value: (returnStats?.count ?? 0) + (returnStats?.supplier_count ?? 0),
      cls: 'text-orange-600 dark:text-orange-400',
      border: 'border-orange-400',
        sub: `${returnStats?.count ?? 0} ${customerShortLabel} | ${returnStats?.supplier_count ?? 0} ${supplierShortLabel}`,
      detailSections: [
        {
          title: t('returns_count') || 'Customer returns',
          rows: [
            { label: inventoryStatLabels.returnsCount, value: returnStats?.count ?? 0 },
            { label: inventoryStatLabels.refunded, value: fmtUSD(returnStats?.refund_usd || 0) },
            { label: tr('items', 'Items'), value: returnStats?.items ?? 0 },
            { label: t('restocked_to_inventory') || 'Restocked', value: returnStats?.restock ?? 0 },
          ],
        },
        {
          title: t('supplier_returns') || 'Supplier returns',
          rows: [
            { label: t('supplier_returns') || 'Supplier returns', value: returnStats?.supplier_count ?? 0 },
            { label: t('supplier_compensation') || 'Compensation', value: fmtUSD(returnStats?.supplier_compensation_usd || 0) },
            { label: t('business_loss') || 'Business loss', value: fmtUSD(returnStats?.supplier_loss_usd || 0) },
            { label: t('formula') || 'Formula', value: inventoryReturnsFormulaText },
          ],
        },
      ],
    },
  ]
  const inventoryStatCards = useMemo<LegacyInventoryRecord[]>(
    () => [...primaryStats, ...financeStats],
    [financeStats, primaryStats],
  )
  const inventoryBrands = useMemo(() => (
    (Array.isArray(inventoryProductFilters.brands) && inventoryProductFilters.brands.length
      ? inventoryProductFilters.brands
      : [...new Set(summary.map((p) => String(p.brand || '').trim()).filter(Boolean))]
    ).sort((a, b) => a.localeCompare(b))
  ), [inventoryProductFilters.brands, summary])
  const apiInventoryInitialOptions = useMemo(
    () => aggregateInitialOptions(Array.isArray(inventoryInitials) ? inventoryInitials : []).filter((item) => (
      item?.type === 'latin' || item?.type === 'number' || item?.type === 'khmer'
    )),
    [inventoryInitials],
  )
  const derivedInventoryInitialOptions = useMemo(
    () => buildInitialOptionsFromProducts(Array.isArray(summary) ? summary : []),
    [summary],
  )
  const inventoryInitialOptions = useMemo(() => {
    if (apiInventoryInitialOptions.length) return apiInventoryInitialOptions
    if (derivedInventoryInitialOptions.length) return derivedInventoryInitialOptions
    return cachedInventoryInitialOptions
  }, [apiInventoryInitialOptions, cachedInventoryInitialOptions, derivedInventoryInitialOptions])
  useEffect(() => {
    if (apiInventoryInitialOptions.length) {
      setCachedInventoryInitialOptions((current) => {
        const serializedCurrent = JSON.stringify(current)
        const serializedNext = JSON.stringify(apiInventoryInitialOptions)
        return serializedCurrent === serializedNext ? current : apiInventoryInitialOptions
      })
      return
    }
    if (derivedInventoryInitialOptions.length) {
      setCachedInventoryInitialOptions((current) => {
        if (current.length) return current
        return derivedInventoryInitialOptions
      })
    }
  }, [apiInventoryInitialOptions, derivedInventoryInitialOptions])
  const selectedMovementGroups = useMemo(
    () => visibleMovementGroups.filter((group) => selectedMovementIds.has(group.id)),
    [selectedMovementIds, visibleMovementGroups],
  )
  const exportStamp = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const movementDateRangeLabel = useMemo(() => {
    const timestamps = visibleMovementGroups
      .map((group) => group.latest_at || group.items?.[0]?.created_at || '')
      .map((raw) => {
        return parseInventoryTimestamp(raw)
      })
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())
    if (!timestamps.length) {
      if (movementStartDate || movementEndDate) {
        return `${movementStartDate || '...'} - ${movementEndDate || '...'}`
      }
      if (movementYearFilter !== 'all' || movementMonthFilter !== 'all') {
        return `${movementYearFilter === 'all' ? 'All years' : movementYearFilter} / ${movementMonthFilter === 'all' ? 'All months' : movementMonthFilter}`
      }
      return 'All available movement dates'
    }
    return `${timestamps[0].toLocaleDateString()} - ${timestamps[timestamps.length - 1].toLocaleDateString()}`
  }, [movementEndDate, movementMonthFilter, movementStartDate, movementYearFilter, visibleMovementGroups])

  const visibleMovementQuantity = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.totalQuantity || 0), 0),
    [visibleMovementGroups],
  )
  const visibleMovementRecordCount = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.items?.length || group.recordCount || 0), 0),
    [visibleMovementGroups],
  )
  const buildInventoryExportScope = useCallback(() => ({
    branchFilter,
    brandFilter,
    exportStamp,
    filteredSummary,
    fmtUSD,
    getBranchLabel,
    getStockQty,
    inStockCount,
    lowStockCount,
    movFilter,
    movementDateRangeLabel,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementTimeMode,
    movementYearFilter,
    outStockCount,
    returnStats,
    search,
    stockFilter,
    tab,
    taxDelivery,
    totalCOGS,
    totalMembershipDiscounts,
    totalProducts,
    totalProfit,
    totalQtySold,
    totalRevenue,
    totalStoreDiscounts,
    totalValue,
    tr,
    visibleMovementGroups,
    visibleMovementQuantity,
    visibleMovementRecordCount,
  }), [
    branchFilter,
    brandFilter,
    exportStamp,
    filteredSummary,
    fmtUSD,
    getBranchLabel,
    getStockQty,
    inStockCount,
    lowStockCount,
    movFilter,
    movementDateRangeLabel,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementTimeMode,
    movementYearFilter,
    outStockCount,
    returnStats,
    search,
    stockFilter,
    tab,
    taxDelivery,
    totalCOGS,
    totalMembershipDiscounts,
    totalProducts,
    totalProfit,
    totalQtySold,
    totalRevenue,
    totalStoreDiscounts,
    totalValue,
    tr,
    visibleMovementGroups,
    visibleMovementQuantity,
    visibleMovementRecordCount,
  ])

  const exportMovementGroups = useCallback(async (groups: LegacyInventoryRecord[], filePrefix = 'inventory-movements') => {
    const exportModule = await loadInventoryExportModule()
    await exportModule.exportInventoryMovementGroups(buildInventoryExportScope(), groups, filePrefix)
  }, [buildInventoryExportScope])

  const exportInventorySummary = useCallback(async (productsToExport: InventoryProduct[] = filteredSummary, filePrefix = 'inventory') => {
    const exportModule = await loadInventoryExportModule()
    await exportModule.exportInventorySummary(buildInventoryExportScope(), productsToExport, filePrefix)
  }, [buildInventoryExportScope, filteredSummary])

  const exportInventoryStats = useCallback(async (filePrefix = 'inventory-stats') => {
    const exportModule = await loadInventoryExportModule()
    await exportModule.exportInventoryStats(buildInventoryExportScope(), filePrefix)
  }, [buildInventoryExportScope])

  const exportInventoryPackage = useCallback(async (mode = tab) => {
    const exportModule = await loadInventoryExportModule()
    await exportModule.exportInventoryPackage(buildInventoryExportScope(), mode)
  }, [buildInventoryExportScope, tab])

  const inventoryExportItems = useMemo<any[]>(() => {
    if (tab === 'movements') {
      return [
        { label: tr('export_full_inventory_package', 'Export full inventory package'), onClick: () => exportInventoryPackage('movements'), color: 'green' },
        { label: tr('export_inventory_stats', 'Export inventory stats and calculations'), onClick: () => exportInventoryStats('inventory-stats') },
        'divider',
        { label: tr('export_visible_movement_groups', `Export visible ${t('movements') || 'movements'}`), onClick: () => exportMovementGroups(visibleMovementGroups) },
        selectedMovementGroups.length ? { label: tr('export_selected_movement_groups', 'Export selected movement groups'), onClick: () => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected'), color: 'blue' } : null,
        movementYearFilter !== 'all' || movementMonthFilter !== 'all'
          ? { label: tr('export_filtered_time_range', 'Export filtered time range'), onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-filtered') }
          : null,
        branchFilter !== 'all'
          ? { label: tr('export_filtered_branch_movements', 'Export filtered branch movements'), onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-branch') }
          : null,
        movFilter !== 'all'
          ? { label: tr('export_filtered_activity_type', 'Export filtered activity type'), onClick: () => exportMovementGroups(visibleMovementGroups, `inventory-movements-${movFilter}`) }
          : null,
        'divider',
        { label: tr('export_inventory_summary', 'Export inventory summary'), onClick: () => exportInventorySummary(summary, 'inventory-summary') },
        { label: tr('export_low_stock_summary', 'Export low-stock summary'), onClick: () => exportInventorySummary(summary.filter((product) => {
          const qty = getStockQty(product)
          return qty > (product.out_of_stock_threshold || 0) && qty <= (product.low_stock_threshold || 10)
        }), 'inventory-low-stock') },
        { label: tr('export_out_of_stock_summary', 'Export out-of-stock summary'), onClick: () => exportInventorySummary(summary.filter((product) => getStockQty(product) <= (product.out_of_stock_threshold || 0)), 'inventory-out-of-stock') },
      ].filter(Boolean)
    }

    return [
      { label: tr('export_full_inventory_package', 'Export full inventory package'), onClick: () => exportInventoryPackage('products'), color: 'green' },
      { label: tr('export_inventory_stats', 'Export inventory stats and calculations'), onClick: () => exportInventoryStats('inventory-stats') },
      'divider',
      { label: tr('export_visible_products', 'Export visible products'), onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-visible') },
      branchFilter !== 'all'
        ? { label: tr('export_filtered_branch_products', 'Export filtered branch products'), onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-branch') }
        : null,
      stockFilter !== 'all'
        ? { label: tr('export_filtered_stock_state', 'Export filtered stock state'), onClick: () => exportInventorySummary(filteredSummary, `inventory-products-${stockFilter}`) }
        : null,
      brandFilter !== 'all'
        ? { label: tr('export_filtered_brand', 'Export filtered brand'), onClick: () => exportInventorySummary(filteredSummary, `inventory-products-brand`) }
        : null,
      { label: tr('export_full_inventory_summary', 'Export full inventory summary'), onClick: () => exportInventorySummary(summary, 'inventory-summary') },
      { label: tr('export_low_stock_summary', 'Export low-stock summary'), onClick: () => exportInventorySummary(summary.filter((product) => {
        const qty = getStockQty(product)
        return qty > (product.out_of_stock_threshold || 0) && qty <= (product.low_stock_threshold || 10)
      }), 'inventory-low-stock') },
      { label: tr('export_out_of_stock_summary', 'Export out-of-stock summary'), onClick: () => exportInventorySummary(summary.filter((product) => getStockQty(product) <= (product.out_of_stock_threshold || 0)), 'inventory-out-of-stock') },
    ].filter(Boolean)
  }, [
    branchFilter,
    brandFilter,
    exportInventoryPackage,
    exportInventoryStats,
    exportInventorySummary,
    exportMovementGroups,
    filteredSummary,
    movFilter,
    movementMonthFilter,
    movementYearFilter,
    selectedMovementGroups,
    summary,
    tab,
    t,
    visibleMovementGroups,
  ])

  const inventoryFilterSections = useMemo(() => {
    if (tab === 'rfid') {
      return [
        branches.length > 1 ? {
          id: 'branch',
          label: t('branch') || 'Branch',
          options: [
            { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
            ...branches.map((branch) => ({
              id: `branch-${branch.id}`,
              label: branch.name,
              active: branchFilter === String(branch.id),
              onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
            })),
          ],
        } : null,
      ].filter(Boolean)
    }

    if (tab === 'movements') {
      return [
        branches.length > 1 ? {
          id: 'branch',
          label: t('branch') || 'Branch',
          options: [
            { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
            ...branches.map((branch) => ({
              id: `branch-${branch.id}`,
              label: branch.name,
              active: branchFilter === String(branch.id),
              onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
            })),
          ],
        } : null,
        {
          id: 'movement-type',
          label: t('activity') || 'Activity',
          options: [
            { id: 'all', label: t('all_types') || 'All types', active: movFilter === 'all', onClick: () => setMovFilter('all') },
            ...([
              ['sale', t('sale') || 'Sale'],
              ['purchase', t('purchase') || 'Purchase'],
              ['return', t('returns') || 'Return'],
              ['return_reversal', t('return_type_writeoff') || 'Return reversal'],
              ['adjustment', t('adjustment') || 'Adjustment'],
              ['transfer', t('stock_transfer') || 'Transfer'],
            ] as [string, string][]).map(([value, label]) => ({
              id: value,
              label,
              active: movFilter === value,
              onClick: () => setMovFilter(movFilter === value ? 'all' : value),
            })),
          ],
        },
        isAdmin ? {
          id: 'movement-user',
          label: t('user') || 'User',
          render: ({ closeMenu }: { closeMenu: () => void }) => (
            <AppSelect
              value={movementUserFilter}
              onChange={(nextValue) => {
                setMovementUserFilter(nextValue || 'all')
                closeMenu()
              }}
              ariaLabel={t('user') || 'User'}
              className="w-full"
              buttonClassName="h-9 w-full rounded-xl px-3 py-1.5 text-sm"
              menuClassName="min-w-[10rem]"
              options={[
                { value: 'all', label: t('all_users') || 'All users' },
                ...userOptions.map((option) => {
                  const id = String(option?.id || '')
                  return id ? {
                    value: id,
                    label: option?.name || option?.username || `User ${id}`,
                  } : null
                }).filter(Boolean) as Array<{ value: string; label: string }>,
              ]}
            />
          ),
        } : null,
        {
          id: 'movement-year',
          label: 'Year',
          options: [
            { id: 'all', label: 'All years', active: movementYearFilter === 'all', onClick: () => { setMovementYearFilter('all'); setMovementMonthFilter('all') } },
            ...movementYears.map((year) => ({
              id: `year-${year}`,
              label: year,
              active: movementYearFilter === year,
              onClick: () => {
                const next = movementYearFilter === year ? 'all' : year
                setMovementYearFilter(next)
                if (next === 'all') setMovementMonthFilter('all')
              },
            })),
          ],
        },
        {
          id: 'movement-month',
          label: 'Month',
          options: [
            { id: 'all', label: 'All months', active: movementMonthFilter === 'all', onClick: () => setMovementMonthFilter('all') },
            ...Array.from({ length: 12 }, (_, index) => {
              const month = String(index + 1)
              const label = new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })
              return {
                id: `month-${month}`,
                label,
                active: movementMonthFilter === month,
                onClick: () => setMovementMonthFilter(movementMonthFilter === month ? 'all' : month),
              }
            }),
          ],
        },
        {
          id: 'movement-grouping',
          label: t('group_by') || 'Group by',
          options: [
            { id: 'time', label: t('group_by_time') || 'Time only', active: movementGroupMode === 'time', onClick: () => setMovementGroupMode('time') },
            { id: 'time-action', label: t('group_by_time_action') || 'Time + activity', active: movementGroupMode === 'time+action', onClick: () => setMovementGroupMode('time+action') },
          ],
        },
        {
          id: 'movement-sort',
          label: t('sort') || 'Sort',
          options: [
            { id: 'desc', label: t('newest_first') || 'Newest first', active: movementSortDirection === 'desc', onClick: () => setMovementSortDirection('desc') },
            { id: 'asc', label: t('oldest_first') || 'Oldest first', active: movementSortDirection === 'asc', onClick: () => setMovementSortDirection('asc') },
          ],
        },
      ].filter(Boolean)
    }

    return [
      branches.length > 1 ? {
        id: 'branch',
        label: t('branch') || 'Branch',
        render: ({ closeMenu }: { closeMenu: () => void }) => (
          <AppSelect
            value={branchFilter}
            onChange={(nextValue) => {
              setBranchFilter(nextValue || 'all')
              closeMenu()
            }}
            ariaLabel={t('branch') || 'Branch'}
            className="w-full"
            buttonClassName="w-full rounded-xl text-sm"
            options={[
              { value: 'all', label: t('all_branches') || 'All branches' },
              ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
            ]}
          />
        ),
      } : null,
      {
        id: 'group',
        label: t('groups') || 'Groups',
        render: ({ closeMenu }: { closeMenu: () => void }) => (
          <AppSelect
            value={groupFilter}
            onChange={(nextValue) => {
              setGroupFilter(nextValue || 'all')
              closeMenu()
            }}
            ariaLabel={t('groups') || 'Groups'}
            className="w-full"
            buttonClassName="w-full rounded-xl text-sm"
            options={[
              { value: 'all', label: t('all') || 'All' },
              { value: 'group', label: t('groups') || 'Groups' },
              { value: 'standalone', label: t('standalone') || 'Standalone' },
            ]}
          />
        ),
      },
      {
        id: 'stock',
        label: t('stock_status') || 'Stock',
        render: ({ closeMenu }: { closeMenu: () => void }) => (
          <AppSelect
            value={stockFilter}
            onChange={(nextValue) => {
              setStockFilter(nextValue || 'all')
              closeMenu()
            }}
            ariaLabel={t('stock_status') || 'Stock'}
            className="w-full"
            buttonClassName="w-full rounded-xl text-sm"
            options={[
              { value: 'all', label: t('all') || 'All' },
              { value: 'in_stock', label: t('in_stock') || 'In stock' },
              { value: 'low', label: t('low_stock') || 'Low stock' },
              { value: 'out', label: t('out_of_stock') || 'Out of stock' },
            ]}
          />
        ),
      },
      inventoryBrands.length ? {
        id: 'brand',
        label: filterLabel('brand', 'Brand'),
        render: ({ closeMenu }: { closeMenu: () => void }) => (
          <AppSelect
            value={brandFilter}
            onChange={(nextValue) => {
              setBrandFilter(nextValue || 'all')
              closeMenu()
            }}
            ariaLabel={filterLabel('brand', 'Brand')}
            className="w-full"
            buttonClassName="h-9 w-full rounded-xl px-3 py-1.5 text-sm"
            menuClassName="min-w-[12rem]"
            options={[
              { value: 'all', label: filterLabel('all_brands', 'All brands') },
              ...inventoryBrands.map((brand) => ({ value: brand, label: brand })),
            ]}
          />
        ),
      } : null,
    ].filter(Boolean)
  }, [
    branchFilter,
    branches,
    brandFilter,
    groupFilter,
    inventoryBrands,
    movFilter,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementUserFilter,
    movementYearFilter,
    movementYears,
    isAdmin,
    filterLabel,
    stockFilter,
    t,
    tab,
    tr,
    userOptions,
  ])

  const activeInventoryFilterCount = useMemo(() => {
    if (tab === 'rfid') {
      return countActiveFlags([
        branchFilter !== 'all',
      ])
    }

    if (tab === 'movements') {
      return countActiveFlags([
        branchFilter !== 'all',
        movFilter !== 'all',
        movementUserFilter !== 'all',
        movementYearFilter !== 'all',
        movementMonthFilter !== 'all',
        movementGroupMode !== 'time',
        movementSortDirection !== 'desc',
      ])
    }

    return countActiveFlags([
      branchFilter !== 'all',
      brandFilter !== 'all',
      groupFilter !== 'all',
      stockFilter !== 'all',
      inventoryInitialFilter !== 'all',
    ])
  }, [branchFilter, brandFilter, groupFilter, inventoryInitialFilter, movFilter, movementGroupMode, movementMonthFilter, movementSortDirection, movementUserFilter, movementYearFilter, stockFilter, tab])

  const clearInventoryFilters = useCallback(() => {
    setBranchFilter('all')
    setBrandFilter('all')
    setGroupFilter('all')
    setStockFilter('all')
    setInventoryInitialFilter('all')
    setMovFilter('all')
    setMovementUserFilter('all')
    setMovementYearFilter('all')
    setMovementMonthFilter('all')
    setMovementGroupMode('time')
    setMovementSortDirection('desc')
  }, [])

  const isMovementScopeFullySelected = useCallback(
    (ids = []) => ids.length > 0 && ids.every((id) => selectedMovementIds.has(id)),
    [selectedMovementIds],
  )

  const isMovementScopePartiallySelected = useCallback(
    (ids = []) => ids.some((id) => selectedMovementIds.has(id)) && !isMovementScopeFullySelected(ids),
    [isMovementScopeFullySelected, selectedMovementIds],
  )
  const showMovementActionGroups = movementGroupMode === 'time+action'
  const sectionStorageKey = 'business-os:inventory:section:v2'
  const showInventoryStats = inventorySection === 'all' || inventorySection === 'stats'
  const showInventorySections = inventorySection === 'all' || ['products', 'movements', 'rfid'].includes(inventorySection)
  const showInventoryTabs = inventorySection === 'all'
  const showProductsSection = showInventorySections && tab === 'products'
  const showMovementsSection = showInventorySections && tab === 'movements'
  const showRfidSection = showInventorySections && tab === 'rfid'
  const inventoryProductControlsRevealReady = isInventoryMobileViewport
    ? initialInventoryMobileRevealReady
    : initialInventoryDesktopRevealReady
  const shouldReserveInventoryInitialBar = showProductsSection && (
    !inventoryProductsLoaded
    || inventoryInitialOptions.length > 0
    || cachedInventoryInitialOptions.length > 0
  )
  const isMovementsFirstLoad = showMovementsSection && needsMovementData && !movementsLoaded
  const isProductsFirstLoad = showProductsSection && needsProductSummary && !inventoryProductsLoaded
  const selectInventorySection = (nextSection: string) => {
    setInventorySection(nextSection)
    if (['products', 'movements', 'rfid'].includes(nextSection)) setTab(nextSection)
  }

  if (loadError && !loading && !summary.length && !movements.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => load(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('inventory')}
          </h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setShowImport(true)}
              className="btn-secondary inline-flex min-w-[5.75rem] shrink-0 items-center justify-center whitespace-nowrap px-3 py-1.5 text-xs sm:min-w-[6.5rem] sm:text-sm"
              title={tr('import', 'Import')}
            >
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {tr('import', 'Import')}
            </span>
          </button>
          {showProductsSection ? (
            <ExportMenu
              label={tr('export', 'Export')}
              items={inventoryExportItems}
              compact
            />
          ) : null}
        </div>
      </div>

      <SectionSwitcher
        className="mb-3"
        label=""
        options={INVENTORY_SECTION_OPTIONS}
        value={inventorySection}
        onChange={selectInventorySection}
        storageKey={sectionStorageKey}
        shouldRestoreStoredValue={(storedValue) => storedValue !== 'all'}
      />

      <LoadingWatchdog
        loading={loading}
        timeoutMs={8000}
        showAfterMs={1200}
        label={t('loading') || 'Loading...'}
        details={tab === 'rfid' ? 'Checking RFID status, tag mappings, and inventory data.' : 'Loading products, stock, and movement summaries.'}
        onRetry={() => load(false)}
        className="mb-3"
      />

      {statsRefreshError ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {statsRefreshError}
        </div>
      ) : null}

      {showInventoryStats ? (
      <>
        <div className="mb-2 grid grid-cols-2 items-start gap-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8">
          {inventoryStatCards.map((stat) => (
            <button
              key={stat.id}
              type="button"
              className={`card flex min-h-[3.85rem] min-w-0 flex-col items-start self-start px-2.5 py-1.5 text-left transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/50 ${stat.border ? `border-l-2 ${stat.border}` : ''}`}
              onClick={() => setStatDetail(stat as StatDetail)}
            >
              <div className="mb-0.5 text-[10px] font-medium uppercase leading-4 tracking-[0.06em] text-gray-400">{stat.label}</div>
              <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-5 ${stat.cls}`}>{stat.value}</div>
              {stat.sub ? (
                <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9.5px] leading-3 text-gray-500 dark:text-gray-400">
                  {stat.sub}
                </div>
              ) : null}
            </button>
          ))}
      </div>
      </>
      ) : null}
      {showInventoryTabs ? (
      <div className="mb-4 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {([['products', t('products') || 'Products'], ['movements', t('movements') || 'Movements'], ['rfid', 'RFID']] as [string, string][]).map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab===id ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      ) : null}

      {/* Section */}
      {showInventorySections ? (
      <div className="mb-2 overflow-x-auto pb-1">
        <div className="flex min-w-[19.5rem] items-center gap-1.5 sm:min-w-0">
          <input
            id="inventory-search"
            name="inventory_search"
            autoComplete="off"
            aria-label="Inventory search"
            className="input min-w-0 flex-1 text-sm"
            placeholder={tab === 'products'
              ? `${t('search') || 'Search'} - separate terms with commas, then choose match mode`
              : tab === 'rfid'
                ? 'Search RFID sessions, EPC / TID, reader, or product mapping'
                : `${t('search') || 'Search'} ${t('movements') || 'Movements'}`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === 'products' && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-900">
              {['AND','OR'].map(m => (
                <button key={m}
                  onClick={() => setSearchMode(m)}
                  className={`min-w-[2.65rem] rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${searchMode===m ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {showMovementsSection ? (
            <FilterMenu
              label={t('filters') || 'Filters'}
              activeCount={activeInventoryFilterCount}
              sections={inventoryFilterSections}
              onClear={clearInventoryFilters}
              compact
            />
          ) : null}
        </div>
      </div>
      ) : null}
      {showInventorySections && !showMovementsSection ? (
      <div className="inventory-history-row mb-2 flex min-w-0 items-center gap-2">
        <ActionHistoryBar history={actionHistory} className="min-w-0 flex-1" />
        <FilterMenu
          label={t('filters') || 'Filters'}
          activeCount={activeInventoryFilterCount}
          sections={inventoryFilterSections}
          onClear={clearInventoryFilters}
          compact
        />
      </div>
      ) : null}

      {showInventorySections && !showProductsSection && (tab === 'rfid' || isMovementsFirstLoad) ? (
      <p className="text-xs text-gray-400 mb-2">
        {tab === 'rfid'
          ? `RFID inventory for ${rfidGatewayStatus.branchName} - reader gateway, tag mapping, sessions, and barcode fallback`
          : `${t('loading') || 'Loading'} ${t('movements') || 'movements'}...`}
      </p>
      ) : null}

      {/* Products */}
      {showProductsSection && (
        <>
          <div className="sticky top-2 z-30 mb-2 -mx-1 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/95 shadow-sm backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/25 sm:mx-0 sm:rounded-xl">
            <div className="relative px-2 py-2">
              <div className={inventoryProductControlsRevealReady ? '' : 'invisible'}>
                <div className="grid min-w-0 grid-cols-[minmax(5.7rem,1fr)_3.35rem_minmax(6.9rem,9.4rem)] items-center gap-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/85">
                  <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    {inventoryProductSummaryLabel}
                  </span>
                  <AppSelect
                    value={inventoryProductSafePageSize}
                    options={PAGE_SIZE_OPTIONS.map((size) => ({ value: size, label: size }))}
                    onChange={(nextValue) => {
                      setInventoryProductPageSize(Number(nextValue) || PAGE_SIZE_OPTIONS[0])
                      setInventoryProductPage(1)
                    }}
                    ariaLabel={`${t('per_page') || 'per page'} ${inventoryProductSafePageSize}`}
                    className="h-7 w-full min-w-0"
                    buttonClassName="h-7 w-full rounded-full px-2 py-0 pl-2 pr-1.5 text-[10px] font-semibold shadow-none"
                    menuClassName="min-w-[4rem]"
                    optionClassName="text-xs"
                  />
                  <div className="inline-flex h-7 min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                    <button
                      type="button"
                      className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                      disabled={inventoryProductSafePage <= 1}
                      onClick={() => setInventoryProductPage(inventoryProductSafePage - 1)}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={t('page') || 'Page'}
                      className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-center text-[10px] font-semibold text-slate-700 outline-none dark:text-slate-100"
                      value={inventoryProductPageDraft}
                      onChange={(event) => setInventoryProductPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                      onBlur={commitInventoryProductPageDraft}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitInventoryProductPageDraft()
                          event.currentTarget.blur()
                        } else if (event.key === 'Escape') {
                          setInventoryProductPageDraft(String(inventoryProductSafePage))
                          event.currentTarget.blur()
                        }
                      }}
                    />
                    <span className="pr-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                      / {inventoryProductTotalPages}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
                      disabled={inventoryProductSafePage >= inventoryProductTotalPages}
                      onClick={() => setInventoryProductPage(inventoryProductSafePage + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className={`mt-1.5 grid items-center gap-1.5 ${hasSelectedProducts ? 'grid-cols-[minmax(0,1fr)_4.25rem_4.6rem]' : 'grid-cols-1'}`}>
                  <label className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100">
                    <input
                      ref={inventorySelectAllRef}
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded"
                      checked={visibleInventoryProducts.length > 0 && selectedProductIds.size === visibleInventoryProducts.length}
                      onChange={(event) => toggleSelectAllProducts(event.target.checked)}
                    />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {hasSelectedProducts
                        ? inventoryControlLabels.selected
                        : inventoryControlLabels.selectAll}
                    </span>
                  </label>
                  {hasSelectedProducts ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-7 min-w-[4.25rem] shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:hover:border-slate-500 dark:hover:bg-slate-900"
                        disabled={!hasSelectedProducts}
                        onClick={openInventoryBatchSession}
                        title={tr(
                          'inventory_batch_hint',
                          'Select products, review each line in one session, then apply all stock changes together.',
                        )}
                        aria-label={inventoryControlLabels.batch}
                      >
                        {inventoryControlLabels.batch}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 min-w-[4.6rem] shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:hover:border-slate-500 dark:hover:bg-slate-900"
                        onClick={() => setReasonManager({ open: true, type: 'adjust' })}
                        title={inventoryControlLabels.reasons}
                        aria-label={inventoryControlLabels.reasons}
                      >
                        {inventoryControlLabels.reasons}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {!inventoryProductControlsRevealReady ? (
                <div className="pointer-events-none absolute inset-0 flex flex-col gap-1.5 px-2 py-2">
                  <div className="grid min-w-0 grid-cols-[minmax(5.7rem,1fr)_3.35rem_minmax(6.9rem,9.4rem)] items-center gap-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/85">
                    <div className="h-5 rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="h-7 rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="h-7 rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="grid grid-cols-1 items-center gap-1.5">
                    <div className="h-9 rounded-2xl border border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/85" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {shouldReserveInventoryInitialBar ? (
            <div className="mb-2 h-[42px]">
              {inventoryInitialOptions.length ? (
                <div className="flex h-full gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800">
                  <button
                    type="button"
                    className={`h-8 min-w-8 rounded-lg px-2 font-semibold ${inventoryInitialFilter === 'all' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                    onClick={() => setInventoryInitialFilter('all')}
                  >
                    {t('all') || 'All'}
                  </button>
                  {inventoryInitialOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`h-8 min-w-8 rounded-lg px-2 font-semibold ${inventoryInitialFilter === item.key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                      onClick={() => setInventoryInitialFilter(inventoryInitialFilter === item.key ? 'all' : item.key)}
                      title={`${item.label} (${item.count})`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center gap-1 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800">
                  <div className="h-8 min-w-[2.75rem] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/80" />
                  {Array.from({ length: 9 }, (_, index) => (
                    <div key={`inventory-initial-skeleton-${index}`} className="h-8 min-w-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/80" />
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">{tr('loading_inventory_products', 'Loading inventory products...', 'Loading inventory products...')}</div>}>
            <InventoryProductsSurface
              InventoryBatchPreview={InventoryBatchPreview}
              InventoryDiscountBadge={InventoryDiscountBadge}
              branchFilter={branchFilter}
              branches={branches}
              collapsedInventoryGroups={collapsedInventoryGroups}
              collapsedInventorySections={collapsedInventorySections}
              fmtKHR={fmtKHR}
              fmtUSD={fmtUSD}
              getInventoryGroupSummaryParts={getInventoryGroupSummaryParts}
              getStockQty={getStockQty}
              initialDesktopRevealReady={initialInventoryDesktopRevealReady}
              initialMobileFullListReady={initialInventoryMobileFullListReady}
              initialMobileRevealReady={initialInventoryMobileRevealReady}
              initialMobileInventorySections={initialMobileInventorySections}
              inventoryProductSections={inventoryProductSections}
              isInventorySelectionScopeFullySelected={isInventorySelectionScopeFullySelected}
              isInventorySelectionScopePartiallySelected={isInventorySelectionScopePartiallySelected}
              loading={loading && isProductsFirstLoad}
              openAdjust={openAdjust}
              selectedProductIds={selectedProductIds}
              setDetailProduct={setDetailProduct}
              showProductsSection={showProductsSection}
              t={t}
              toggleInventoryGroup={toggleInventoryGroup}
              toggleInventorySection={toggleInventorySection}
              toggleInventorySelectionScope={toggleInventorySelectionScope}
              toggleSelectedProduct={toggleSelectedProduct}
              visibleInventoryProducts={visibleInventoryProducts}
            />
          </Suspense>
        </>
      )}
      {/* Movements */}
      {showMovementsSection ? (
        <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">{tr('loading_inventory_movements', 'Loading inventory movements...', 'Loading inventory movements...')}</div>}>
          <InventoryMovementsSurface
            actionHistory={actionHistory}
            collapsedMovementSections={collapsedMovementSections}
            MOV_COLORS={MOV_COLORS}
            PaginationControls={PaginationControls}
            expandedMovementGroups={expandedMovementGroups}
            expandedMovementPages={expandedMovementPages}
            exportMovementGroups={exportMovementGroups}
            fmtTime={fmtTime}
            fmtUSD={fmtUSD}
            getMovementActionGroupRecordCount={getMovementActionGroupRecordCount}
            getMovementGroupPage={getMovementGroupPage}
            getMovementRecordCount={getMovementRecordCount}
            getMovementSectionRecordCount={getMovementSectionRecordCount}
            inventoryExportItems={inventoryExportItems}
            isMovementScopeFullySelected={isMovementScopeFullySelected}
            isMovementScopePartiallySelected={isMovementScopePartiallySelected}
            loading={(loading && !movementsLoaded) || isMovementsFirstLoad}
            movementDateRangeLabel={movementDateRangeLabel}
            movementEndDate={movementEndDate}
            movementMeta={movementMeta}
            movementSections={movementSections}
            movementSelectAllRef={movementSelectAllRef}
            movementStartDate={movementStartDate}
            openMovementProductDetail={openMovementProductDetail}
            selectedMovementGroups={selectedMovementGroups}
            selectedMovementIds={selectedMovementIds}
            setSelectedMovementIds={setSelectedMovementIds}
            setExpandedMovementGroupPage={setExpandedMovementGroupPage}
            setMovementEndDate={setMovementEndDate}
            setMovementMeta={setMovementMeta}
            setMovementStartDate={setMovementStartDate}
            setShowMovementDateFilter={setShowMovementDateFilter}
            showMovementActionGroups={showMovementActionGroups}
            showMovementDateFilter={showMovementDateFilter}
            t={t}
            toggleAllMovementSelection={toggleAllMovementSelection}
            toggleMovementGroup={toggleMovementGroup}
            toggleMovementScopeSelection={toggleMovementScopeSelection}
            toggleMovementSectionCollapsed={toggleMovementSectionCollapsed}
            toggleMovementSelection={toggleMovementSelection}
            tr={tr}
            visibleMovementGroups={visibleMovementGroups}
            visibleMovementQuantity={visibleMovementQuantity}
            visibleMovementRecordCount={visibleMovementRecordCount}
          />
        </Suspense>
      ) : null}

      {showRfidSection ? (
        <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">{tr('loading_inventory_rfid', 'Loading RFID tools...', 'Loading RFID tools...')}</div>}>
          <InventoryRfidSurface
            ClipboardList={ClipboardList}
            RFID_INVENTORY_WORKFLOWS={RFID_INVENTORY_WORKFLOWS}
            RFID_READER_REQUIREMENTS={RFID_READER_REQUIREMENTS}
            SectionSwitcher={SectionSwitcher}
            rfidGatewayStatus={rfidGatewayStatus}
            rfidSection={rfidSection}
            rfidSectionOptions={rfidSectionOptions}
            setRfidSection={setRfidSection}
            tr={tr}
          />
        </Suspense>
      ) : null}

      {/* Section */}
      {statDetail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setStatDetail(null)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{statDetail.label}</h2>
                <p className="text-xs text-gray-400 mt-1">{t('inventory') || 'Inventory'}</p>
              </div>
              <button onClick={() => setStatDetail(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-2">
              {Array.isArray(statDetail.detailSections) && statDetail.detailSections.length ? statDetail.detailSections.map((section, sectionIndex) => (
                <div key={`${statDetail.id}-section-${sectionIndex}`} className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="border-b border-gray-200 pb-2 dark:border-gray-700">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{section.title}</div>
                    {section.subtitle ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{section.subtitle}</div> : null}
                  </div>
                  {Array.isArray(section.rows) ? section.rows.map((row, rowIndex) => (
                    <div key={`${statDetail.id}-${sectionIndex}-${rowIndex}`} className="rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950/40">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                    </div>
                  )) : null}
                </div>
              )) : null}
              {Array.isArray(statDetail.details) && statDetail.details.length ? statDetail.details.map((row, index) => (
                <div key={`${statDetail.id}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                </div>
              )) : null}
            </div>
          </div>
        </div>
      )}

      {adjustModal || transferModal || moveModal ? (
        <Suspense fallback={null}>
          <InventoryStockModals
            adjustBranchSelectOptions={adjustBranchSelectOptions}
            adjustCurrentQuantity={adjustCurrentQuantity}
            adjustForm={adjustForm}
            adjustModal={adjustModal}
            adjustSaving={adjustSaving}
            adjustTargetOptions={adjustTargetOptions}
            adjustTargetSelectOptions={adjustTargetSelectOptions}
            branchCount={branches.length}
            branchSelectOptions={branchSelectOptions}
            branchWithPlaceholderOptions={branchWithPlaceholderOptions}
            getStockQty={getStockQty}
            moveDestinationProductOptions={moveDestinationProductOptions}
            moveForm={moveForm}
            moveModal={moveModal}
            moveReasonOptions={moveReasonOptions}
            moveSaving={moveSaving}
            onAdjust={handleAdjust}
            onCloseAdjust={() => setAdjustModal(null)}
            onCloseMove={() => setMoveModal(null)}
            onCloseTransfer={() => setTransferModal(null)}
            onMove={handleMoveStock}
            onTransfer={handleTransferStock}
            reasonsByType={reasonsByType}
            setAdjustForm={setAdjustForm}
            setMoveForm={setMoveForm}
            setReasonManager={setReasonManager}
            setTransferForm={setTransferForm}
            t={t}
            tr={tr}
            transferForm={transferForm}
            transferModal={transferModal}
            transferSaving={transferSaving}
            transferSourceBranchOptions={transferSourceBranchOptions}
            usdSymbol={usdSymbol}
          />
        </Suspense>
      ) : null}

      {reasonManager.open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setReasonManager((current) => ({ ...current, open: false }))}>
          <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('saved_reasons', 'Saved reasons')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{tr('saved_reasons_desc', 'Reuse common reasons for stock adjustments, transfers, and row moves.')}</div>
              </div>
              <button type="button" onClick={() => setReasonManager((current) => ({ ...current, open: false }))} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-4 p-4">
              <div className="grid grid-cols-3 gap-2">
                {(['adjust', 'transfer', 'move'] as InventoryReasonType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${reasonManager.type === type ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                    onClick={() => setReasonManager((current) => ({ ...current, type }))}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  value={reasonDraft}
                  onChange={(event) => setReasonDraft(event.target.value)}
                  placeholder={tr('new_reason_placeholder', 'Add a reusable reason')}
                  autoComplete="off"
                />
                <button type="button" className="btn-primary px-3 text-sm" onClick={addSavedReason} disabled={savingReasons || !reasonDraft.trim()}>
                  {t('add') || 'Add'}
                </button>
              </div>
              <div className="space-y-2">
                {reasonsByType[reasonManager.type]?.length ? reasonsByType[reasonManager.type].map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{entry.label}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30" onClick={() => renameSavedReason(entry)}>{t('edit') || 'Edit'}</button>
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30" onClick={() => deleteSavedReason(entry)}>{t('delete') || 'Delete'}</button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                    {tr('no_saved_reasons', 'No saved reasons yet for this workflow.')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {inventoryBatch?.items?.length ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !batchApplying && setInventoryBatch(null)}>
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-5xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('inventory_batch_session', 'Batch session')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">
                  {tr(
                    'inventory_batch_session_desc',
                    'Review each selected product, then apply all stock changes together.',
                  )}
                </div>
              </div>
              <button type="button" onClick={() => !batchApplying && setInventoryBatch(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" disabled={batchApplying}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              {inventoryBatch.items.map((item) => (
                <div key={item.productId} className="rounded-2xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {tr('current_stock', 'Current stock')} {item.stockQty} {item.unit || ''}
                      </div>
                      {item.error ? (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                          {item.error}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <AppSelect
                        value={item.action}
                        onChange={(nextValue) => updateInventoryBatchLine(item.productId, { action: nextValue, reason: '' })}
                        ariaLabel={t('action') || 'Action'}
                        className="w-32"
                        buttonClassName="h-8 w-full px-2 py-1 text-xs"
                        menuClassName="min-w-[9rem]"
                        optionClassName="text-xs"
                        options={[
                          { value: 'adjust', label: tr('adjust_stock', 'Adjust stock') },
                          { value: 'transfer', label: tr('transfer', 'Transfer') },
                          { value: 'move', label: tr('move_stock', 'Move stock') },
                        ]}
                      />
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30" onClick={() => removeInventoryBatchLine(item.productId)} disabled={batchApplying}>
                        {t('remove') || 'Remove'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-12">
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'}</span>
                      <input className="input text-sm" type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateInventoryBatchLine(item.productId, { quantity: event.target.value })} autoComplete="off" />
                    </label>

                    {item.action === 'adjust' ? (
                      <>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('action') || 'Action'}</span>
                          <AppSelect
                            value={item.adjustType}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { adjustType: nextValue })}
                            ariaLabel={t('action') || 'Action'}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[8rem]"
                            optionClassName="text-sm"
                            options={[
                              { value: 'add', label: t('add') || 'Add' },
                              { value: 'remove', label: t('remove') || 'Remove' },
                              { value: 'set', label: t('set') || 'Set' },
                            ]}
                          />
                        </label>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                          <AppSelect
                            value={item.branchId}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { branchId: nextValue })}
                            ariaLabel={t('branch') || 'Branch'}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[13rem]"
                            optionClassName="text-sm"
                            options={branchSelectOptions}
                          />
                        </label>
                      </>
                    ) : null}

                    {item.action === 'transfer' ? (
                      <>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch')}</span>
                          <AppSelect
                            value={item.fromBranchId}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { fromBranchId: nextValue })}
                            ariaLabel={tr('source_branch', 'Source branch')}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[13rem]"
                            optionClassName="text-sm"
                            options={branchWithPlaceholderOptions}
                          />
                        </label>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch')}</span>
                          <AppSelect
                            value={item.toBranchId}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { toBranchId: nextValue })}
                            ariaLabel={tr('destination_branch', 'Destination branch')}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[13rem]"
                            optionClassName="text-sm"
                            options={branchWithPlaceholderOptions}
                          />
                        </label>
                      </>
                    ) : null}

                    {item.action === 'move' ? (
                      <>
                        <div className="lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_row', 'Destination row')}</span>
                          <div className="flex gap-1">
                            <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'existing' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => updateInventoryBatchLine(item.productId, { moveMode: 'existing' })}>{tr('existing_row', 'Existing')}</button>
                            <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => updateInventoryBatchLine(item.productId, { moveMode: 'new' })}>{tr('new_row', 'New row')}</button>
                          </div>
                        </div>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                          <AppSelect
                            value={item.branchId}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { branchId: nextValue })}
                            ariaLabel={t('branch') || 'Branch'}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[13rem]"
                            optionClassName="text-sm"
                            options={branchSelectOptions}
                          />
                        </label>
                        {item.moveMode === 'existing' ? (
                          <label className="block lg:col-span-4">
                            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_product', 'Destination product row')}</span>
                            <AppSelect
                              value={item.destinationProductId}
                              onChange={(nextValue) => updateInventoryBatchLine(item.productId, { destinationProductId: nextValue })}
                              ariaLabel={tr('destination_product', 'Destination product row')}
                              className="w-full"
                              buttonClassName="h-10 w-full text-sm"
                              menuClassName="min-w-[16rem]"
                              optionClassName="text-sm"
                              options={buildDestinationProductOptions(summary, item.productId, tr('choose_destination_product', 'Choose a destination product row'))}
                            />
                          </label>
                        ) : (
                          <label className="block lg:col-span-4">
                            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('name') || 'Name'}</span>
                            <input className="input text-sm" value={item.destinationName} onChange={(event) => updateInventoryBatchLine(item.productId, { destinationName: event.target.value })} autoComplete="off" />
                          </label>
                        )}
                      </>
                    ) : null}

                    <label className="block lg:col-span-4">
                      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
                        <span>{t('reason') || 'Reason'}</span>
                        <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: item.action === 'move' ? 'move' : item.action === 'transfer' ? 'transfer' : 'adjust' })}>
                          {tr('manage_reasons', 'Manage reasons')}
                        </button>
                      </span>
                      <div className="space-y-2">
                        {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).length ? (
                          <div className="flex flex-wrap gap-1">
                            {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                                onClick={() => updateInventoryBatchLine(item.productId, { reason: entry.label })}
                              >
                                {entry.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {item.action === 'move' ? (
                          <AppSelect
                            value={item.reason || ''}
                            onChange={(nextValue) => updateInventoryBatchLine(item.productId, { reason: nextValue })}
                            ariaLabel={t('reason') || 'Reason'}
                            className="w-full"
                            buttonClassName="h-10 w-full text-sm"
                            menuClassName="min-w-[13rem]"
                            optionClassName="text-sm"
                            options={moveReasonOptions}
                          />
                        ) : (
                          <textarea className="input min-h-[80px] text-sm" value={item.reason} onChange={(event) => updateInventoryBatchLine(item.productId, { reason: event.target.value })} placeholder={t('reason') || 'Reason'} />
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {inventoryBatch.items.length} {t('products') || 'products'}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => setInventoryBatch(null)} disabled={batchApplying}>
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="button" className="btn-primary text-sm" onClick={applyInventoryBatchSession} disabled={batchApplying || !inventoryBatch.items.length}>
                  {batchApplying ? (t('saving') || 'Saving...') : tr('apply_changes', 'Apply changes')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showImport ? (
        <Suspense fallback={null}>
          <InventoryImportModal
            onClose={() => setShowImport(false)}
            onDone={() => {
              setShowImport(false)
              load()
            }}
          />
        </Suspense>
      ) : null}

      {detailProduct && (
        <Suspense fallback={null}>
          <ProductDetailModal
            product={detailProduct}
            onClose={() => setDetailProduct(null)}
            onAdjust={openAdjust}
            onTransfer={openTransfer}
            onMoveRow={openMove}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
            t={t}
          />
        </Suspense>
      )}
    </div>
  )
}
