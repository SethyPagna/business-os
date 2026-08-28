// Main Inventory page sub-components imported from sibling files.

import { Fragment, Suspense, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Zap from 'lucide-react/dist/esm/icons/zap.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import { APP_NAVIGATION_EVENT } from '../../app/pathRouting.ts'
import { fmtTime } from '../../utils/formatters'
import { calculateProductDiscount } from '../../utils/pricing.ts'
import { matchesSearchTermGroups } from '../../utils/searchMatch.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import AlphaIndexRail from '../shared/AlphaIndexRail'
import InfoHint from '../shared/InfoHint.tsx'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import { toggleMultiValue, toggleMultiValues, isMultiActive, matchesMulti, parseMultiValues } from '../../utils/multiSelect'
import { buildHierarchicalCategoryFilterOptions } from '../shared/CategoryFilterOptions.tsx'
import { buildAvailabilityFilterSection } from '../shared/AvailabilityFilterOptions.tsx'
import { buildIssuesFilterSection } from '../shared/IssuesFilterOptions.tsx'
import { buildSearchModeFilterSection } from '../shared/SearchModeFilterOptions.tsx'
import { buildPeriodFilterOptions } from '../../utils/periodFilterOptions.ts'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import PageSizeSelect from '../shared/PageSizeSelect'
import PaginationControls, { PAGE_SIZE_OPTIONS, clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
import { TOOLBAR_BUTTON_WIDTH, manageToolbarButtonClassName } from '../shared/toolbarButtonStyles'
import InventoryProductsSurface from './InventoryProductsSurface'
import { createLongPressHandlers, createLongPressState, consumeLongPressClick, type LongPressState } from '../../utils/longPress.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
const ProductDetailModal = lazyRetry(() => import('./ProductDetailModal'), 'inventory-product-detail-modal') as any
const InventoryImportModal = lazyRetry(() => import('./InventoryImportModal'), 'inventory-import') as any
const InventoryMovementsSurface = lazyRetry(() => import('./InventoryMovementsSurface'), 'inventory-movements-surface') as any
const InventoryRfidSurface = lazyRetry(() => import('./InventoryRfidSurface'), 'inventory-rfid-surface') as any
const InventoryStockModals = lazyRetry(() => import('./InventoryStockModals'), 'inventory-stock-modals') as any
const FastStockInModal = lazyRetry(() => import('./FastStockInModal'), 'inventory-fast-stock-in-modal') as any
const InventoryBatchModal = lazyRetry(() => import('./InventoryBatchModal'), 'inventory-batch-modal') as any
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'inventory-export-options') as any
const ManageBatchesModal = lazyRetry(() => import('./ManageBatchesModal'), 'inventory-manage-batches-modal') as any
const InventoryReasonManagerModal = lazyRetry(() => import('./InventoryReasonManagerModal'), 'inventory-reason-manager-modal') as any
const InventoryStatDetailModal = lazyRetry(() => import('./InventoryStatDetailModal'), 'inventory-stat-detail-modal') as any
const ProductHistoryPreviewModal = lazyRetry(() => import('./ProductHistoryPreviewModal'), 'inventory-product-history-preview-modal') as any
const InventoryProductsSurfaceView = InventoryProductsSurface as any

import { buildMovementGroups, getMovementGroupPage, movementColorClass, movementColorClassForRecord, movementGroupHaystack, translateMovementType } from './movementGroups'
import { buildStockHealthSegments } from './stockHealthSummary'

// Default quantity the Adjust-stock "Add" form starts with -- see
// InventoryStockModals.tsx's quick-pick chips (1 / this value / 5 / 10 /
// 20, deduplicated). A plain constant for now rather than a per-business
// setting; if a settings-driven default is wanted later, this is the one
// place to read it from.
const DEFAULT_ADD_QUANTITY = 1

// Same helper (and same UTC-day convention) as ReceiveBatchModal's default
// received date -- every entry point must agree on what "today" means.
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot } from '../../utils/historyHelpers.ts'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import { aggregateInitialOptions, buildInitialOptionsFromProducts, getInitialKey } from '../../utils/initials.ts'
import { buildProductCategorySections } from '../../utils/productGrouping.ts'
import { buildProductGroupPriceLabel, buildProductGroupSummaryParts } from '../products/helpers/productGroupViewHelpers.ts'
import { buildBatchPreview } from '../../utils/productBatches.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { pruneSelectionToVisibleIds } from '../../utils/rowSelection.ts'
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

// See InventoryStockModals.tsx's matching comment: one "Cost" field (not
// a separate cost + purchase price pair), and a pricingLocked toggle --
// locked (default) skips all of this and adds straight to the current
// row; unlocked lets the backend (resolveAddStockTarget) find-or-create
// the right row for genuinely different pricing.
type AdjustForm = {
  product_id?: InventoryId
  type: string
  quantity: InventoryFormValue
  reason: string
  branch_id: InventoryId | ''
  pricingLocked: boolean
  selling_price_usd: InventoryFormValue
  selling_price_khr: InventoryFormValue
  special_price_usd: InventoryFormValue
  special_price_khr: InventoryFormValue
  discount_enabled: boolean
  discount_type: string
  discount_percent: InventoryFormValue
  discount_amount_usd: InventoryFormValue
  cost_usd: InventoryFormValue
  cost_khr: InventoryFormValue
  barcode: string
  // D4 (11.28): real received date for stock recorded late -- see
  // InventoryStockModals.tsx's matching comment for when it's shown and
  // when it goes on the wire.
  received_date: string
  // Mirrors InventoryStockModals.tsx's own AdjustForm.batch_id -- see that
  // file's comment. Kept in sync as the same literal type ('' | 'new' | id).
  batch_id: InventoryId | ''
  // D5a: supplier attribution for the lot an add creates or fills --
  // mirrors InventoryStockModals.tsx's matching fields (the modal clears
  // both when an attributed lot is picked, so the payload builder here can
  // trust them; see its comment).
  supplier_id: number | ''
  supplier_name: string
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
  // Per-action gate (utils/permissionActions.ts) -- the same table the admin
  // permission editor renders, so a control's visibility here always matches
  // what an admin was shown when granting the tier.
  can: (permissionKey: string, actionKey: string) => boolean
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

function scheduleInventoryMetadataRead(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let idleId: number | null = null
  const timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(task, { timeout: INVENTORY_METADATA_IDLE_TIMEOUT_MS })
      return
    }
    task()
  }, INVENTORY_METADATA_READ_DELAY_MS)
  return () => {
    window.clearTimeout(timerId)
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId)
    }
  }
}

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
const INVENTORY_METADATA_READ_DELAY_MS = 120
const INVENTORY_METADATA_IDLE_TIMEOUT_MS = 800

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
  { value: 'all', labelKey: 'all', label: 'All', hintKey: 'inventory_section_all_hint', hint: 'Show inventory statistics, products, movements, and RFID tools together.' },
  { value: 'stats', labelKey: 'stats', label: 'Stats', hintKey: 'inventory_section_stats_hint', hint: 'Show only the inventory summary cards.' },
  { value: 'products', labelKey: 'products', label: 'Products', hintKey: 'inventory_section_products_hint', hint: 'Show product stock, values, and item-level controls.' },
  { value: 'movements', labelKey: 'movements', label: 'Movements', hintKey: 'inventory_section_movements_hint', hint: 'Show stock movement history and grouped movement filters.' },
  { value: 'rfid', labelKey: 'rfid', label: 'RFID', hintKey: 'inventory_section_rfid_hint', hint: 'Show branch-locked RFID tagging, stock count, search, exception, and session tools.' },
]

const RFID_SECTION_OPTIONS = [
  { value: 'overview', labelKey: 'rfid_section_overview', hintKey: 'rfid_section_overview_hint', label: 'Overview', hint: 'Show RFID status, branch lock state, reader readiness, and the pilot checklist.' },
  { value: 'tagging', labelKey: 'rfid_section_tagging', hintKey: 'rfid_section_tagging_hint', label: 'Tagging', hint: 'Link EPC/TID tags to products without changing the master stock ledger.' },
  { value: 'stock-count', labelKey: 'rfid_section_stock_count', hintKey: 'rfid_section_stock_count_hint', label: 'Stock Count', hint: 'Run a branch-locked scan session and compare RFID presence against barcode stock.' },
  { value: 'search', labelKey: 'rfid_section_search', hintKey: 'rfid_section_search_hint', label: 'Search', hint: 'Find a product or tag with the handheld reader and browser scan box.' },
  { value: 'exceptions', labelKey: 'rfid_section_exceptions', hintKey: 'rfid_section_exceptions_hint', label: 'Exceptions', hint: 'Review wrong-branch, unknown, missing, and extra tag detections before applying.' },
  { value: 'sessions', labelKey: 'rfid_section_sessions', hintKey: 'rfid_section_sessions_hint', label: 'Sessions', hint: 'Audit RFID scan sessions and manually apply approved results.' },
]

// E1 (Part 413): Inventory renders as sections of the Branches hub now --
// BranchesHubPage owns the chip row and passes the slice to show via
// hostSection; internal section changes (a product's "view history" jump,
// the Dashboard focus handoff) report back through onHostSectionChange so
// the hub's chips stay truthful. Standalone rendering (no props) keeps
// working exactly as before -- the internal SectionSwitcher only hides
// when a host is driving.
export type InventoryHostSection = 'stats' | 'products' | 'movements' | 'rfid'

export default function Inventory({ hostSection, onHostSectionChange }: {
  hostSection?: InventoryHostSection
  onHostSectionChange?: (section: InventoryHostSection) => void
} = {}) {
  const { can, t, user, notify, fmtUSD, fmtKHR, usdSymbol } = useApp() as InventoryAppContext
  // Every stock-moving action here mutates live batch/stock state that could
  // go stale between a Review Required user's request and an admin's
  // approval, so routes/inventory.ts blocks them outright for that tier
  // rather than queueing them (POST /adjust, /transfer, /move-row and the
  // dated-stock-count routes all 403) -- see utils/permissionActions.ts.
  // Editing the saved reasons list is the one Inventory write that DOES
  // queue, so it is deliberately not gated here.
  const canAdjustStock = can('inventory', 'adjust')
  const canTransferStock = can('inventory', 'transfer')
  const { syncChannel } = useSync() as InventorySyncContext
  // E1: the standalone 'inventory' page id retired -- this component only
  // renders inside the Branches hub, so activity is "am I on the branches
  // page" (the same re-key AuditLog/Users/Backup/Returns/Fees got in E3/E4/E2).
  const isActive = useIsPageActive('branches')
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
  const [manageBatchesModal, setManageBatchesModal] = useState<InventoryProduct | null>(null)
  const [adjustForm,    setAdjustForm]    = useState<AdjustForm>({
    type: 'add', quantity: DEFAULT_ADD_QUANTITY, reason: '', branch_id: '',
    pricingLocked: true,
    selling_price_usd: '', selling_price_khr: '', special_price_usd: '', special_price_khr: '',
    discount_enabled: false, discount_type: 'percent', discount_percent: '', discount_amount_usd: '',
    cost_usd: 0, cost_khr: 0, barcode: '', batch_id: '', received_date: todayIsoDate(),
    supplier_id: '', supplier_name: '',
  })
  const [transferModal, setTransferModal] = useState<InventoryProduct | null>(null)
  const [transferForm,  setTransferForm]  = useState<TransferForm>({ from_branch_id: '', to_branch_id: '', quantity: 1, reason: '' })
  const [search,        setSearch]        = useState('')
  // AND/OR toggle restored (Aug 20 2026) -- no longer a standalone button
  // next to the search box (still gone, per the Aug 19 2026 UI request),
  // but reachable again from inside the Filter menu, via
  // buildSearchModeFilterSection (components/shared/SearchModeFilterOptions.tsx),
  // same as Products.tsx/POS.tsx. AND stays the default.
  const [searchMode, setSearchMode] = useState<'AND' | 'OR'>('AND')
  // Debounced (matches Products.tsx/POS.tsx's 180ms) rather than a plain
  // alias of `search` -- this used to fire a full bootstrap/products/stats/
  // movements re-fetch on every keystroke (no debounce at all on this page),
  // which is what actually caused the long-standing "search results render
  // incrementally / one at a time" report: the visible list was being
  // replaced mid-typing, once per character, not once the person paused.
  // `search` itself stays undebounced for the input's own `value` so typing
  // still feels instant; only the value driving network effects/pagination
  // resets below waits out the pause.
  const debouncedSearch = useDebouncedValue(search, 180)
  const deferredSearch = String(debouncedSearch || '').trim()
  const [brandFilter,   setBrandFilter]   = useState('all')
  // Comma-joined multi-value string (matches movementUserFilter/movFilter's
  // shape above), not a plain 'all'/single-category string -- lets the
  // Category filter menu below select several categories (or a whole
  // "Main - Sub" hierarchical group) at once. See utils/multiSelect.ts.
  const [catFilter,     setCatFilter]     = useState('all')
  const [stockFilter,   setStockFilter]   = useState('all')
  const [groupFilter,   setGroupFilter]   = useState('all') // all | group | standalone
  // Comma-joined multi-value string (matches catFilter's shape) -- several
  // issue keys can be selected at once, OR'd together. See
  // IssuesFilterOptions.tsx and searchMatch.ts's ISSUE_STATE_KEYS.
  const [issueFilter,   setIssueFilter]   = useState('all')
  const [inventoryProductPage, setInventoryProductPage] = useState(1)
  const [inventoryProductPageSize, setInventoryProductPageSize] = useState(DEFAULT_PAGE_SIZE)
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
  const [inventoryProductFilters, setInventoryProductFilters] = useState<{ brands: string[]; categories: string[] }>({ brands: [], categories: [] })
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(() => new Set())
  // Checkboxes/section-select-all only render once this is true, matching
  // Products.tsx's part-77/part-190 pattern: press-and-hold (long-press) a
  // row to enter select mode by selecting it, tap a row's checkbox to
  // toggle it directly once select mode is already active, and select mode
  // ends automatically once the last item is deselected. Previously
  // Inventory always rendered a checkbox on every row/section/group
  // regardless of whether anything was selected -- reported as "Inventory
  // page still using checkboxes" once Products moved to this pattern.
  const selectionModeActive = selectedProductIds.size > 0
  // One long-press timer/start-point slot per visible row, keyed by
  // product id -- same reasoning as Products.tsx's own
  // longPressStateByRowIdRef: InventoryProductsSurface renders a row once
  // per item inside a .map(), not as its own mounted component, so this
  // can't be a plain useRef living inside the row-render code itself. Kept
  // here (owned by Inventory.tsx, the parent) and handed down as a getter
  // so InventoryProductsSurface doesn't need its own separate copy.
  const longPressStateByRowIdRef = useRef<Map<number, LongPressState>>(new Map())
  const getInventoryLongPressState = useCallback((rowId: number): LongPressState => {
    const existing = longPressStateByRowIdRef.current.get(rowId)
    if (existing) return existing
    const created = createLongPressState()
    longPressStateByRowIdRef.current.set(rowId, created)
    return created
  }, [])
  const [inventoryBatch, setInventoryBatch] = useState<InventoryBatch>(null)
  const [batchApplying, setBatchApplying] = useState(false)
  const [rfidStatus, setRfidStatus] = useState<LegacyInventoryRecord | null>(null)
  const [tab,           setTab]           = useState<string>(hostSection && hostSection !== 'stats' ? hostSection : 'products')
  const [inventorySection, setInventorySection] = useState<string>(hostSection || 'products')
  // E1: the hub's chip is authoritative -- when it changes, re-slice. Runs
  // only on hostSection changes, so internal jumps (view-history, focus
  // handoff) still work between chip clicks; they report back through
  // onHostSectionChange instead of being overridden here.
  useEffect(() => {
    if (!hostSection) return
    setInventorySection(hostSection)
    if (hostSection !== 'stats') setTab(hostSection)
  }, [hostSection])
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
  const [historyPreview, setHistoryPreview] = useState<{
    product: InventoryProduct
    movements: Array<Record<string, any>> | null
    loading: boolean
    error: string | null
  } | null>(null)
  const [expandedMovementGroups, setExpandedMovementGroups] = useState<Set<string>>(() => new Set())
  const [expandedMovementPages, setExpandedMovementPages] = useState<Record<string, number>>({})
  const [collapsedMovementSections, setCollapsedMovementSections] = useState<Set<string>>(() => new Set())
  const [collapsedInventorySections, setCollapsedInventorySections] = useState<Set<string>>(() => new Set())
  const [collapsedInventoryGroups, setCollapsedInventoryGroups] = useState<Set<string>>(() => new Set())
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [adjustSaving,  setAdjustSaving]  = useState(false)
  const [transferSaving, setTransferSaving] = useState(false)
  const [statDetail,    setStatDetail]    = useState<StatDetail>(null)
  const [showImport, setShowImport] = useState(false)
  // F2 (Part 419): the fast per-shipment stock-in flow -- see
  // FastStockInModal.tsx; writes ride the same receive kernel as every
  // other add-stock surface.
  const [showFastStockIn, setShowFastStockIn] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<{ open: boolean; type: InventoryReasonType }>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const movementSelectAllRef = useRef<HTMLInputElement | null>(null)
  // Same "edited-but-filtered-out row stays visible until re-search" fix
  // Products.tsx already has (see its own pinnedEditedProductsRef comment,
  // parts 133/139) -- a silent load(true) after a stock adjust/transfer
  // would otherwise drop a row the person just changed if it no longer
  // matches the active filters (e.g. an out-of-stock filter after zeroing
  // a branch's quantity). Only populated for the two mutation paths where
  // the resulting branch_stock is fully computable client-side from the
  // request + previous snapshot (single-branch adjust; two-branch
  // transfer) -- deliberately NOT used for multi-batch auto-drain removals
  // or anything where the server's own stock math isn't a simple, known
  // delta, matching the same caution Products.tsx's handleBulkChangeBranch
  // note documents for its own unsafe-to-approximate case. Cleared when
  // the person changes the search box themselves (see handleSearchChange).
  const pinnedEditedInventoryRef = useRef<Map<number, InventoryProduct>>(new Map())
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef<number | null>(null)
  const inventoryMetadataCancelRef = useRef<(() => void) | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const pendingLoadRef = useRef<{ silent: boolean; options?: LoadOptions } | null>(null)
  const latestLoadRef = useRef<((silent?: boolean, options?: LoadOptions) => Promise<void>) | null>(null)
  const inventoryReasonsLoadedRef = useRef(false)
  const inventoryReasonsPromiseRef = useRef<Promise<InventoryReason[]> | null>(null)
  const inventoryUsersLoadedRef = useRef(false)
  const inventoryUsersPromiseRef = useRef<Promise<InventoryUserOption[]> | null>(null)
  const adjustStockInFlightRef = useRef(false)
  const transferStockInFlightRef = useRef(false)
  const batchInventoryInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 10, notify, scope: 'inventory', enabled: historyReady, user })
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
  const inventorySectionOptions = useMemo(() => (
    INVENTORY_SECTION_OPTIONS.map((option) => ({
      value: option.value,
      label: tr(option.labelKey, option.label),
      hint: tr(option.hintKey, option.hint),
    }))
  ), [tr])

  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])

  // Still used by InventoryBatchModal's per-line "move" action (a batch
  // session can write off/move individual lines) even though the old
  // standalone single-product Move Stock modal is gone -- unrelated
  // features that happened to share a reason type.
  const moveReasonOptions = useMemo(() => [
    { value: '', label: tr('choose_reason', 'Choose a reason') },
    ...reasonsByType.move.map((entry) => ({ value: entry.label, label: entry.label })),
  ], [reasonsByType.move, tr])

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
            setLoadError(tr('inventory_load_slow', 'Inventory is taking longer than expected. Tap Refresh or revisit in a moment.'))
          }, 15000)
        }
      }
      const branchOpts = {
        ...(branchFilter !== 'all' ? { branchId: parseInt(branchFilter, 10) } : {}),
        ...(isAdmin && movementUserFilter !== 'all' && parseMultiValues(movementUserFilter).length === 1
          ? { userId: parseMultiValues(movementUserFilter)[0] }
          : {}),
      }
      const productQuery = {
        ...branchOpts,
        page: inventoryProductPage,
        pageSize: inventoryProductPageSize,
        query: deferredSearch,
        searchMode,
        // No searchFields override (was hard-coded to 'name', which
        // forced a name-only match server-side -- see products.ts's
        // buildSearchFilters / this file's appendInventoryProductFilters
        // for the full field list this now searches instead).
        brand: brandFilter,
        category: catFilter,
        stockState: stockFilter,
        groupState: groupFilter,
        initial: inventoryInitialFilter,
        // "Issues" quick filter -- see buildIssueStateClauses in
        // cloudflare/src/lib/searchMatch.ts. Multi-value, OR'd.
        issueState: issueFilter === 'all' ? '' : issueFilter,
        // First load fetches initials/filters inline (single round trip) so the alphabet
        // bar is complete on first paint. Later loads (pagination/filtering/silent
        // refresh) keep this cheap and let the deferred metadata-only fetch refresh it.
        metadata: loadedOnceRef.current ? '0' : '1',
      }
      const statsQuery = {
        branchId: branchOpts.branchId,
        query: deferredSearch,
        searchMode,
        brand: brandFilter,
        category: catFilter,
        stockState: stockFilter,
        groupState: groupFilter,
        initial: inventoryInitialFilter,
        issueState: issueFilter === 'all' ? '' : issueFilter,
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
          // Re-insert any pinned just-adjusted/transferred rows the fresh
          // server page no longer contains -- see pinnedEditedInventoryRef's
          // own comment. Same shape as Products.tsx's identical re-insert
          // in its own load().
          if (pinnedEditedInventoryRef.current.size) {
            const presentIds = new Set(sum.map((p: InventoryProduct) => Number(p.id)))
            const missingPinned = Array.from(pinnedEditedInventoryRef.current.entries())
              .filter(([id]) => !presentIds.has(id))
              .map(([, snapshot]) => snapshot)
            setSummary(missingPinned.length ? [...sum, ...missingPinned] : sum)
          } else {
            setSummary(sum || [])
          }
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

        if (needsProductSummary && typeof window !== 'undefined' && productQuery.metadata !== '1') {
          if (inventoryMetadataCancelRef.current) inventoryMetadataCancelRef.current()
          const metadataQuery = {
            ...productQuery,
            page: 1,
            pageSize: 1,
            metadata: '1',
            metadataOnly: '1',
          }
          inventoryMetadataCancelRef.current = scheduleInventoryMetadataRead(() => {
            inventoryMetadataCancelRef.current = null
            void getInventoryApi().searchInventoryProducts(metadataQuery)
              .then((metadataResult: any) => {
                if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
                if (Array.isArray(metadataResult?.initials)) {
                  setInventoryInitials(metadataResult.initials)
                }
                if (metadataResult?.filters && typeof metadataResult.filters === 'object') {
                  setInventoryProductFilters(metadataResult.filters)
                }
              })
              .catch(() => {})
          })
        }

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
    catFilter,
    deferredSearch,
    groupFilter,
    inventoryInitialFilter,
    inventoryProductPage,
    inventoryProductPageSize,
    isAdmin,
    issueFilter,
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
        if (inventoryMetadataCancelRef.current) {
          inventoryMetadataCancelRef.current()
          inventoryMetadataCancelRef.current = null
        }
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
    setHistoryReady(true)
    return undefined
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive || typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(DASHBOARD_INVENTORY_FOCUS_KEY)
    if (!raw) return
    try {
      const nextFocus = JSON.parse(raw)
      if (nextFocus?.section === 'products') {
        setInventorySection('products')
        onHostSectionChange?.('products')
      }
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
  // Per-product notification click-to-focus: routes/notifications.ts's
  // inventory section sets `anchor: 'product-<id>'`, which AppContext's
  // navigateTo() turns into a `#product-<id>` URL hash before dispatching
  // APP_NAVIGATION_EVENT (see Users.tsx's identical `#devices` pattern for
  // precedent). This page can already be mounted when that navigation
  // happens, so check the hash on mount too, not just on the event.
  const [focusProductId, setFocusProductId] = useState<number | null>(null)
  useEffect(() => {
    if (!isActive) return undefined
    const applyHashFocus = () => {
      const match = /^#product-(\d+)$/.exec(window.location.hash)
      if (match) setFocusProductId(Number(match[1]))
    }
    applyHashFocus()
    window.addEventListener(APP_NAVIGATION_EVENT, applyHashFocus)
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, applyHashFocus)
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
      // Part 152: /reasons now queues under Review Required instead of
      // applying directly (`{ success: true, pending: true,
      // pendingActionId }`, no `items` field since nothing was actually
      // written yet). Previously `result?.items` being absent on ANY
      // unexpected response shape silently reset the visible list to
      // empty -- harmless before this route could return anything but a
      // full applied `{ items }`, but would have wiped the saved-reasons
      // list on every Review Required submission the moment this shipped.
      // Keep the current (optimistic) list on a pending response instead
      // of clearing it -- nothing changed server-side yet, so nothing
      // should visibly change client-side either.
      if (result?.pending) {
        notify(tr('reason_submitted_for_review', 'Submitted for review -- changes will appear once approved.'))
        return inventoryReasons
      }
      const items = Array.isArray(result?.items) ? result.items as InventoryReason[] : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons, notify, tr])

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
    if (inventoryMetadataCancelRef.current) {
      inventoryMetadataCancelRef.current()
      inventoryMetadataCancelRef.current = null
    }
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const getStockQty = useCallback((product?: InventoryProduct | null): number => {
    if (!product) return 0
    if (branchFilter !== 'all') return product.display_quantity ?? product.stock_quantity ?? 0
    return product.stock_quantity ?? 0
  }, [branchFilter])
  // Builds the pinned-row snapshot for pinnedEditedInventoryRef -- see that
  // ref's own comment for why only these two mutation shapes (a known set
  // of per-branch deltas) are safe to compute here rather than guessed at.
  // Mirrors the exact fields routes/inventory.ts's bootstrap/summary query
  // derives server-side: `stock_quantity` (real total across all branches)
  // and `display_quantity` (the currently-filtered branch's quantity, or
  // the same total when no branch filter is active -- see that route's
  // own `display_quantity` comment for the two query shapes this mirrors).
  const buildPinnedInventorySnapshot = useCallback((
    product: InventoryProduct,
    changes: { branchId: number; delta: number }[],
  ): InventoryProduct => {
    const branchStockById = new Map(
      (Array.isArray(product.branch_stock) ? product.branch_stock : [])
        .map((entry) => [Number(entry?.branch_id || 0), { ...entry }]),
    )
    let totalDelta = 0
    for (const { branchId, delta } of changes) {
      totalDelta += delta
      const existing = branchStockById.get(branchId)
      if (existing) {
        existing.quantity = Math.max(0, Number(existing.quantity || 0) + delta)
      } else if (delta > 0) {
        branchStockById.set(branchId, { branch_id: branchId, quantity: delta })
      }
    }
    const nextStockQuantity = Math.max(0, Number(product.stock_quantity || 0) + totalDelta)
    const filterBranchId = branchFilter !== 'all' ? Number(branchFilter) : null
    const nextDisplayQuantity = filterBranchId != null
      ? Number(branchStockById.get(filterBranchId)?.quantity ?? product.display_quantity ?? 0)
      : nextStockQuantity
    return {
      ...product,
      branch_stock: Array.from(branchStockById.values()),
      stock_quantity: nextStockQuantity,
      display_quantity: nextDisplayQuantity,
    }
  }, [branchFilter])
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
  const adjustCurrentQuantity = adjustModal
    ? getStockQty(summaryById.get(Number(adjustForm.product_id || adjustModal.id)) || adjustModal)
    : 0
  // Resolved against the *currently selected* adjust target (not just the
  // row the modal was opened from) so switching the "Adjust target" picker
  // (adjustTargetOptions.length > 1) updates the displayed locked price too
  // -- same resolution `adjustCurrentQuantity` above and `handleAdjust`'s
  // own `selectedAdjustProduct` already use, kept in sync with both rather
  // than reading `adjustForm`'s pre-filled-at-open-time price fields, which
  // never get refreshed on a target switch (those only matter once
  // unlocked, as edit-starting-point values, not as a display source).
  const adjustCurrentPricing = adjustModal
    ? (() => {
        const selected = summaryById.get(Number(adjustForm.product_id || adjustModal.id)) || adjustModal
        return {
          selling_price_usd: Number(selected?.selling_price_usd) || 0,
          selling_price_khr: Number(selected?.selling_price_khr) || 0,
        }
      })()
    : { selling_price_usd: 0, selling_price_khr: 0 }

  const handleAdjust = async () => {
    if (adjustSaving) return
    const qty = parseFloat(String(adjustForm.quantity))
    if (!qty || qty <= 0) return notify('Invalid quantity', 'error')
    // Mirrors the transfer form's own required-reason check just below, and
    // backs up routes/inventory.ts's /adjust hard requirement (added
    // alongside the unconditional batch-ledger routing) with a fast inline
    // error instead of letting the request round-trip to a 400.
    if (!String(adjustForm.reason || '').trim()) {
      notify(tr('adjust_reason_required', 'A reason is required for this stock adjustment.'), 'error')
      return
    }
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
    // Pricing only ever goes on the wire when it's genuinely unlocked --
    // locked (the default) is the fast add-to-this-row path, matching
    // this endpoint's behavior before the grouping feature existed.
    const unlockPricing = adjustForm.type === 'add' && !adjustForm.pricingLocked
    // Mandatory batch selection, every target incl. group containers --
    // D4b (matches InventoryStockModals.tsx's own `showBatchPicker`
    // derivation; an unlocked add always gets a fresh batch server-side so
    // there's nothing to require picking there). Checked client-side for a
    // fast error message; routes/inventory.ts's /adjust also accepts a
    // missing batchId on 'remove' from other callers (undo/redo, bulk
    // edits) without requiring one -- this validation is this form's own
    // rule, not the wire contract's.
    if (!unlockPricing && (adjustForm.type === 'add' || adjustForm.type === 'remove') && numericBranchId) {
      if (adjustForm.batch_id === '') { notify(tr('select_batch_required', 'Select a batch first'), 'error'); return }
      if (adjustForm.type === 'remove' && adjustForm.batch_id === 'new') { notify(tr('select_batch_required', 'Select a batch first'), 'error'); return }
    }
    const adjustmentRequest = {
      productId: selectedAdjustProduct.id,
      productName: selectedAdjustProduct.name,
      type: adjustForm.type,
      quantity: qty,
      reason: adjustForm.reason || '',
      branchId: numericBranchId,
      userId: user?.id,
      userName: user?.name || user?.username,
      unlockPricing,
      batchId: !unlockPricing && adjustForm.batch_id !== '' ? adjustForm.batch_id : undefined,
      // D4 (11.28): sent only when the date input was actually on screen
      // (InventoryStockModals.tsx's own visibility condition, recomputed
      // here) -- a value lingering from a hidden input must never re-date
      // some other kind of change. Group containers included since D4b.
      receivedDate: adjustForm.type === 'add'
          && (unlockPricing || (Boolean(numericBranchId) && adjustForm.batch_id === 'new'))
          && adjustForm.received_date
        ? String(adjustForm.received_date)
        : undefined,
      // D5a: sent only for adds, mirroring the picker's own visibility.
      // The modal already cleared these when an attributed lot was picked
      // (first attribution sticks), so what's here is what was on screen.
      supplierId: adjustForm.type === 'add' && adjustForm.supplier_id !== '' ? Number(adjustForm.supplier_id) : undefined,
      supplierName: adjustForm.type === 'add' && String(adjustForm.supplier_name || '').trim() !== '' ? String(adjustForm.supplier_name).trim() : undefined,
      pricing: unlockPricing ? {
        selling_price_usd: parseFloat(String(adjustForm.selling_price_usd)) || 0,
        selling_price_khr: parseFloat(String(adjustForm.selling_price_khr)) || 0,
        special_price_usd: parseFloat(String(adjustForm.special_price_usd)) || 0,
        special_price_khr: parseFloat(String(adjustForm.special_price_khr)) || 0,
        discount_enabled: !!adjustForm.discount_enabled,
        discount_type: adjustForm.discount_type,
        discount_percent: parseFloat(String(adjustForm.discount_percent)) || 0,
        discount_amount_usd: parseFloat(String(adjustForm.discount_amount_usd)) || 0,
        cost_usd: parseFloat(String(adjustForm.cost_usd)) || 0,
        cost_khr: parseFloat(String(adjustForm.cost_khr)) || 0,
        barcode: adjustForm.barcode || null,
      } : undefined,
    }
    if (adjustForm.type === 'remove') {
      if (numericBranchId) {
        const available = selectedBranchStock?.quantity || 0
        if (available <= 0) { notify(tr('no_stock_in_branch', 'No stock in this branch to remove'), 'error'); return }
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
      // Match the defensive pattern used elsewhere (BulkAddStockModal,
      // BranchStockAdjuster): treat an explicit `success: false` as failure,
      // not a missing/undefined field. A write that reaches this line
      // without throwing already succeeded server-side (the server route
      // now always sets `success: true`, but staying defensive here means a
      // future response-shape change can't silently reintroduce the
      // "succeeded but shows an error toast" bug).
      if (res?.success !== false) {
        // The inverse of a batch-scoped adjustment must target the *same*
        // batch the original one actually resolved to -- for a plain
        // pick this is just adjustmentRequest.batchId, but an 'add' with
        // batch_id 'new' didn't know which batch that'd be until the
        // server created it. `res.batchId` is that resolved id either
        // way (routes/inventory.ts's /adjust always echoes it back), so
        // undo/redo use it instead of blindly replaying the request's own
        // (possibly 'new') batchId.
        const resolvedBatchId = (res as { batchId?: number | null } | null)?.batchId ?? null
        const inverseBatchId = resolvedBatchId != null ? resolvedBatchId : adjustmentRequest.batchId
        // Pin only when the resolved branch/delta is fully known: a
        // specific branch was named (not the server's default-branch
        // fallback, since we can't see which branch that resolved to
        // without it echoing one back that matches what we asked for),
        // the mutation actually landed on the same row we started from
        // (not redirected to a newly-created sibling via unlockPricing),
        // and something actually changed (a same-value 'set' is a
        // real no-op server-side, nothing to pin).
        const adjustRes = res as { branchId?: number; movementType?: string; quantity?: number; productId?: number; createdSibling?: boolean } | null
        if (
          numericBranchId
          && adjustRes?.branchId === numericBranchId
          && adjustRes?.productId === selectedAdjustProduct.id
          && !adjustRes?.createdSibling
          && Number(adjustRes?.quantity) > 0
          && (adjustRes?.movementType === 'add' || adjustRes?.movementType === 'remove')
        ) {
          const delta = adjustRes.movementType === 'add' ? Number(adjustRes.quantity) : -Number(adjustRes.quantity)
          pinnedEditedInventoryRef.current.set(
            Number(selectedAdjustProduct.id),
            buildPinnedInventorySnapshot(selectedAdjustProduct, [{ branchId: numericBranchId, delta }]),
          )
        }
        actionHistory.pushAction({
          label: `Adjust stock for ${previousSnapshot?.name || adjustModal?.name || 'product'}`,
          undo: async () => {
            const inverseRequest = adjustmentRequest.type === 'set'
              ? { ...adjustmentRequest, type: 'set', quantity: previousQuantity, reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
              : adjustmentRequest.type === 'remove'
                ? { ...adjustmentRequest, type: 'add', batchId: inverseBatchId, unlockPricing: false, reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
                : { ...adjustmentRequest, type: 'remove', batchId: inverseBatchId, unlockPricing: false, reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
            const undoResult = await runInventoryMutation(() => getInventoryApi().adjustStock(inverseRequest), 'Undo inventory adjustment')
            if (undoResult?.success === false) throw new Error(undoResult?.error || 'Failed to undo stock adjustment')
            // Clear rather than recompute: a reverted row should follow
            // fresh server truth on the next load, not keep showing the
            // pre-undo pinned snapshot (which would be wrong if the
            // reverted row genuinely no longer matches the active
            // filters -- see pinnedEditedInventoryRef's own comment).
            pinnedEditedInventoryRef.current.delete(Number(selectedAdjustProduct.id))
            await load(true)
          },
          redo: async () => {
            const redoResult = await runInventoryMutation(() => getInventoryApi().adjustStock({ ...adjustmentRequest, batchId: inverseBatchId, reason: `Redo: ${adjustmentRequest.reason || 'inventory adjustment'}` }), 'Redo inventory adjustment')
            if (redoResult?.success === false) throw new Error(redoResult?.error || 'Failed to redo stock adjustment')
            pinnedEditedInventoryRef.current.delete(Number(selectedAdjustProduct.id))
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

  // A fresh search is exactly the "search again" moment
  // pinnedEditedInventoryRef's own comment refers to -- once the person is
  // intentionally re-querying, a just-adjusted/transferred row that no
  // longer matches should behave like any other non-matching row again.
  // Same pattern as Products.tsx's handleSearchInputChange.
  const handleSearchChange = useCallback((value: string) => {
    pinnedEditedInventoryRef.current.clear()
    setSearch(value)
  }, [])

  const openAdjust = (p: InventoryProduct) => {
    void ensureInventoryReasonsLoaded()
    setAdjustModal(p)
    const defaultBranchId = defaultBranch?.id?.toString() || ''
    // pricingLocked starts true (the fast "add to this row" path) --
    // these price/cost/discount fields only matter once the person
    // unlocks pricing, but are pre-filled from the current row so the
    // fields aren't blank if they do unlock.
    setAdjustForm({
      product_id: p.id,
      type: 'add',
      quantity: DEFAULT_ADD_QUANTITY,
      reason: '',
      branch_id: defaultBranchId,
      pricingLocked: true,
      selling_price_usd: p.selling_price_usd || 0,
      selling_price_khr: p.selling_price_khr || 0,
      special_price_usd: p.special_price_usd || 0,
      special_price_khr: p.special_price_khr || 0,
      discount_enabled: !!p.discount_enabled,
      discount_type: p.discount_type || 'percent',
      discount_percent: p.discount_percent || 0,
      discount_amount_usd: p.discount_amount_usd || 0,
      cost_usd: p.cost_price_usd || p.purchase_price_usd || 0,
      cost_khr: p.cost_price_khr || p.purchase_price_khr || 0,
      barcode: p.barcode || '',
      batch_id: '',
      // Reset to today on every open -- a historical date from the last
      // adjustment must never silently carry into the next one (same
      // stale-draft rule ReceiveBatchModal documents for its own date).
      received_date: todayIsoDate(),
      // D5a: same stale-value rule -- last adjustment's supplier must
      // never silently attribute the next lot.
      supplier_id: '', supplier_name: '',
    })
  }

  const openManageBatches = (p: InventoryProduct) => {
    setManageBatchesModal(p)
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

  // Reverse direction of openMovementProductDetail below: jump FROM the
  // product detail modal's "view stock history" row TO the Movements tab,
  // pre-filtered to just this product. Movements filtering already keys off
  // the shared `search` box (movHay includes product_name -- see matchesSearch
  // usage on filteredMovements), so reusing that same state here is enough to
  // scope the tab to this product with no separate filter plumbing needed.
  const openProductHistoryFromDetail = useCallback((product: InventoryProduct) => {
    const name = String(product?.name || '').trim()
    setDetailProduct(null)
    setHistoryPreview(null)
    setInventorySection('movements')
    setTab('movements')
    onHostSectionChange?.('movements')
    if (name) setSearch(name)
  }, [setSearch, onHostSectionChange])

  // Scoped preview of a single product's stock movements, opened from the
  // "View stock history" row in ProductDetailModal. Uses the precise
  // productId-scoped `/api/inventory/movements` query (landed part 39)
  // rather than the fuzzy name-based `search` filter openProductHistoryFromDetail
  // above still uses for the full Movements tab, so it can't under/over-match
  // a renamed or similarly-named product. Stacks on top of the still-open
  // detail modal instead of navigating away from it.
  const fetchProductHistoryPreview = useCallback(async (product: InventoryProduct) => {
    setHistoryPreview({ product, movements: null, loading: true, error: null })
    const productId = Number(product?.id || 0)
    try {
      const result = await withLoaderTimeout(
        () => getInventoryApi().getInventoryMovements({ productId, pageSize: 25 }),
        'Inventory product history preview',
        INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS,
      )
      const items = Array.isArray(result?.items) ? result.items : []
      setHistoryPreview({ product, movements: items, loading: false, error: null })
    } catch (error: unknown) {
      setHistoryPreview({
        product,
        movements: null,
        loading: false,
        error: error instanceof Error ? error.message : tr('history_load_failed', 'Failed to load stock history'),
      })
    }
  }, [tr])

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
      if (result?.success === false) throw new Error(result?.error || tr('stock_transfer_failed', 'Stock transfer failed'))
      // A transfer's from/to branches and quantity are exactly what this
      // form already validated and sent -- both branches are known and
      // named by the person, unlike adjust's default-branch fallback
      // case, so this is safe to pin unconditionally on success.
      pinnedEditedInventoryRef.current.set(
        Number(transferModal.id),
        buildPinnedInventorySnapshot(transferModal, [
          { branchId: Number(transferForm.from_branch_id), delta: -quantity },
          { branchId: Number(transferForm.to_branch_id), delta: quantity },
        ]),
      )
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
          if (undoResult?.success === false) throw new Error(undoResult?.error || tr('undo_failed', 'Undo failed'))
          // Same reasoning as the adjust undo/redo above: clear rather
          // than recompute, so a reverted row follows fresh server truth.
          pinnedEditedInventoryRef.current.delete(Number(transferModal.id))
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
          if (redoResult?.success === false) throw new Error(redoResult?.error || tr('redo_failed', 'Redo failed'))
          pinnedEditedInventoryRef.current.delete(Number(transferModal.id))
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

  // Routed through matchesSearchTermGroups (searchMatch.ts) for typo/
  // joiner/word-order/diacritic tolerance, same fix as Products.tsx's
  // filterProductsForPage -- this call itself is a no-op today per the
  // comment above productHay (hasServerBackedProductSearch gates it out
  // whenever searchTerms is non-empty), but matches server-side search
  // quality rather than silently regressing to a plain substring check
  // if that gating logic ever changes.
  const matchesSearch = useCallback((hay: string): boolean => (
    matchesSearchTermGroups(hay, searchTerms, searchMode)
  ), [searchMode, searchTerms])

  // Matches POS.tsx's own local haystack and the server's own
  // PRODUCT_SEARCH_COLUMNS (cloudflare/src/lib/searchMatch.ts) --
  // name/sku/barcode only. In practice this re-filter is a no-op today
  // (see hasServerBackedProductSearch below: it only runs when there ISN'T
  // a server-backed search, and an empty searchTerms list always passes
  // matchesSearch anyway), but keeping it correct rather than silently
  // wrong if that ever changes, and matches the same fix already made to
  // Products.tsx's filterProductsForPage/POS.tsx's own re-filter.
  const productHay = useCallback((p: InventoryProduct): string => (
    `${p.name||''} ${p.sku||''} ${p.barcode||''}`.toLowerCase()
  ), [])

  const movHay = useCallback((m: InventoryMovement): string => (
    `${m.product_name||''} ${m.branch_name||''} ${m.reason||''} ${m.user_name||''} ${m.movement_type||''} ${m.reference_id||''} ${m.lot_code||''} ${m.expiry_date||''} ${m.created_at||''}`.toLowerCase()
  ), [])

  const hasServerBackedProductSearch = !!searchTerms.length
  // groupFilter is intentionally NOT re-applied as an exclusionary check
  // here (same fix, same root cause, as productFilterHelpers.ts's
  // filterProductsForPage on the Products page, and originally POS.tsx's
  // visibleProductCards -- see either comment for the full incident
  // writeup). `summary` is only ever the current server page, but the
  // server's own groupState filter (appendInventoryProductFilters in
  // cloudflare/src/routes/inventory.ts) already scopes "grouped" across the
  // whole active catalog, including same-name rows with no is_group/
  // parent_id set. A client-side recheck using only this page's own
  // is_group/parent_id fields (the removed `parentProductIds` set) has no
  // way to see that broader relationship, so it would drop rows the server
  // had already confirmed were grouped -- exactly what caused the "Groups
  // filter not showing/refreshing" symptom this project's history already
  // root-caused once for POS; this page had the same latent bug, just not
  // yet reported.
  const filteredSummary = useMemo(() => summary.filter((p: InventoryProduct) => {
    if (!hasServerBackedProductSearch && !matchesSearch(productHay(p))) return false
    const normalizedBrandFilter = String(brandFilter || '').trim().replace(/\s+/g, ' ').toLowerCase()
    const normalizedProductBrand = String(p.brand || '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (normalizedBrandFilter !== 'all' && normalizedProductBrand !== normalizedBrandFilter) return false
    // Category -- new filter, same client-side-recheck shape as the
    // brand check above it (redundant with the server's own category
    // WHERE clause today, kept for the same reason productHay's widened
    // haystack above is). matchesMulti handles the comma-joined multi-
    // value shape (and the 'all' sentinel) the same way movFilter/
    // movementUserFilter already do elsewhere in this file.
    if (!matchesMulti(catFilter, p.category)) return false
    // "Issues" -- same scoped key set and OR semantics as
    // productFilterHelpers.ts's productHasIssue (Products.tsx) and
    // buildIssueStateClauses (searchMatch.ts); kept as a small local check
    // here rather than importing across pages, same reasoning as the
    // brand/category re-checks above it.
    if (issueFilter !== 'all' && issueFilter) {
      const issueKeys = parseMultiValues(issueFilter)
      const outThresholdForIssue = p.out_of_stock_threshold || 0
      const hasIssue = issueKeys.some((key) => {
        switch (key) {
          case 'out_of_stock': return getStockQty(p) <= outThresholdForIssue
          case 'no_image': return !String(p.image_path || '').trim()
          case 'no_barcode': return !String(p.barcode || '').trim()
          case 'no_category': return !String(p.category || '').trim()
          case 'no_price': return Number(p.selling_price_usd || 0) <= 0 && Number(p.selling_price_khr || 0) <= 0
          default: return false
        }
      })
      if (!hasIssue) return false
    }
    // 'in_stock' means positive stock (includes both low and healthy) --
    // 'healthy' is the stricter subset above the low-stock threshold. This
    // used to conflate the two (in_stock required qty above low_stock_
    // threshold, same bucket 'healthy' now covers), matching backend
    // semantics in routes/products.ts / routes/branches.ts.
    const qty = getStockQty(p)
    const outThreshold = p.out_of_stock_threshold || 0
    const lowThreshold = p.low_stock_threshold || 10
    if (stockFilter === 'low')      return qty > outThreshold && qty <= lowThreshold
    if (stockFilter === 'out')      return qty <= outThreshold
    if (stockFilter === 'in_stock') return qty > outThreshold
    if (stockFilter === 'healthy')  return qty > lowThreshold
    return true
  }), [brandFilter, catFilter, hasServerBackedProductSearch, issueFilter, matchesSearch, productHay, stockFilter, summary])

  const inventoryProductsById = useMemo(
    () => new Map(summary.map((product) => [Number(product?.id || 0), product])),
    [summary],
  )

  // Category-first sectioning, same decided ask as Products.tsx (see that
  // file's productSections comment): category header first A-Z, name A-Z
  // within category, rail jumps by category initial.
  const inventoryProductSections = useMemo(
    () => buildProductCategorySections(filteredSummary, {
      productsById: inventoryProductsById,
      sortDirection: 'asc',
      uncategorizedLabel: t('uncategorized') || 'Uncategorized',
    }),
    [filteredSummary, inventoryProductsById, t],
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

  // Vertical A-Z jump rail wiring (Aug 19 2026 UI request) -- same
  // replacement as Products.tsx's AlphaIndexRail: jump to a section
  // instead of filtering it. Unlike Products.tsx, Inventory never had any
  // jump-target plumbing to begin with (only the filter), so this is new:
  // maps each section's own letter label to its section id (already a
  // stable, unique `product-letter:${letter}` string from
  // buildProductGroupSections), and jumps by querying the
  // data-inventory-jump-id now rendered on each section header in
  // InventoryProductsSurface.tsx (both the desktop <tr> and mobile <div>
  // section headers).
  const inventoryJumpTargetIdsByLetter = useMemo(() => {
    const targets = new Map<string, string>()
    inventoryProductSections.forEach((section) => {
      if (collapsedInventorySections.has(section.id)) return
      // Key by the section label's own initial letter, not the raw label --
      // now that sections are category-named ("Perfume") rather than a bare
      // letter, this maps down to the rail's A-Z key ("P"). Sections arrive
      // pre-sorted A-Z, so the first section seen per initial is always the
      // alphabetically-earliest one; the `has()` guard keeps that one
      // instead of a later same-initial category overwriting it.
      const key = getInitialKey(section.label)
      if (targets.has(key)) return
      targets.set(key, section.id)
    })
    return targets
  }, [collapsedInventorySections, inventoryProductSections])
  const inventoryVisibleLetters = useMemo(
    () => [...inventoryJumpTargetIdsByLetter.keys()].sort((a, b) => a.localeCompare(b)),
    [inventoryJumpTargetIdsByLetter],
  )
  const jumpToInventoryLetter = useCallback((letter: string) => {
    const targetId = inventoryJumpTargetIdsByLetter.get(String(letter || '').toUpperCase())
    if (!targetId) return
    const node = document.querySelector(`[data-inventory-jump-id="${targetId}"]`)
    if (!(node instanceof HTMLElement)) return
    const scrollParent = node.closest('.page-scroll') as HTMLElement | null
    const offset = 96
    if (scrollParent) {
      const delta = node.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - offset
      scrollParent.scrollTo({ top: Math.max(0, scrollParent.scrollTop + delta), behavior: 'smooth' })
      return
    }
    const top = node.getBoundingClientRect().top + window.scrollY - offset
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [inventoryJumpTargetIdsByLetter])

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
    setInitialInventoryDesktopRevealReady(true)
    return undefined
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
    setInitialInventoryMobileFullListReady(true)
    return undefined
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
  }, [branchFilter, brandFilter, catFilter, deferredSearch, groupFilter, inventoryInitialFilter, issueFilter, searchMode, stockFilter, tab])

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
    catFilter,
    deferredSearch,
    groupFilter,
    inventoryInitialFilter,
    inventoryProductPage,
    inventoryProductPageSize,
    isActive,
    issueFilter,
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
    setSelectedProductIds((current) => pruneSelectionToVisibleIds(current, validIds))
  }, [visibleInventoryProductIds])

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
          if (result?.success === false) throw new Error(result?.error || tr('adjust_failed', 'Adjustment failed'))
        } else if (item.action === 'transfer') {
          const result = await runInventoryMutation(() => getInventoryApi().transferInventoryStock({
            productId: item.productId,
            fromBranchId: item.fromBranchId,
            toBranchId: item.toBranchId,
            quantity,
            reason: item.reason,
          }), 'Batch transfer inventory stock')
          if (result?.success === false) throw new Error(result?.error || tr('transfer_failed', 'Transfer failed'))
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
          if (result?.success === false) throw new Error(result?.error || tr('stock_move_failed', 'Stock move failed'))
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
            // Same missing-.replace('{count}', ...) bug as the two selected-
            // count labels above, found in the same audit pass -- the
            // stored translation is the literal string "{count} inventory
            // updates applied." in both en/km, so without this the toast
            // showed "{count}" verbatim instead of the actual number.
            : tr('batch_inventory_done_many', `${successCount} inventory updates applied.`).replace('{count}', String(successCount)),
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
    if (!matchesMulti(movFilter, m.movement_type)) return false
    if (!matchesMulti(movementUserFilter, m.user_id)) return false
    return hasServerBackedMovementSearch ? true : matchesSearch(movHay(m))
  }), [hasServerBackedMovementSearch, matchesSearch, movFilter, movementUserFilter, movHay, movements])

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
      getActionLabel: (group) => translateMovementType(group?.movement_type, t),
      year: movementYearFilter,
      month: movementMonthFilter,
      timeMode: movementTimeMode,
      groupMode: movementGroupMode,
      sortDirection: movementSortDirection,
    })
  ), [groupedMovements, movementGroupMode, movementMonthFilter, movementSortDirection, movementTimeMode, movementYearFilter, t])

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
    setExpandedMovementGroups((current) => pruneSelectionToVisibleIds(current, visibleMovementGroupIds))
  }, [visibleMovementGroupIds])

  useEffect(() => {
    setExpandedMovementPages((current) => Object.fromEntries(
      Object.entries(current).filter(([groupId]) => visibleMovementGroupIds.has(groupId)),
    ))
  }, [visibleMovementGroupIds])

  useEffect(() => {
    setSelectedMovementIds((current) => pruneSelectionToVisibleIds(current, visibleMovementGroupIds))
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
      return pruneSelectionToVisibleIds(current, validIds)
    })
  }, [movementSections])

  // Semantic color resolver for a grouped movement row -- see
  // movementColorClass's own doc comment in movementGroups.ts for the
  // red/green/yellow/gray rule this replaced the old 13-unrelated-colors
  // map with. A group's `signedQuantity` already carries the group's net
  // direction (all items in one group share the same movement_type, so
  // the sign is consistent across the whole group).
  const movementGroupColorClass = useCallback(
    (group: { movement_type?: unknown; signedQuantity?: number }) =>
      movementColorClass(group.movement_type, Number(group.signedQuantity || 0)),
    [],
  )

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
  // Strict subset of inStockCount (above the low-stock threshold, not just
  // above zero/out-of-stock) -- see familyStockStats.ts's own `healthy`
  // column comment for why this is now split out from in_stock rather than
  // being the same number. No client-side fallback needed the way the
  // other counts have one: this is a purely additive breakdown figure
  // (inStockCount - lowStockCount already gets you the same number), so a
  // stale/missing stockStats just means the "Healthy" line doesn't render
  // yet, not a wrong total anywhere else on the page.
  const healthyCount = Number(stockStats?.healthy ?? Math.max(0, inStockCount - lowStockCount))
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
  const inventoryProductSafePageSize = Math.max(1, Number(inventoryProductPageSize || DEFAULT_PAGE_SIZE))
  const inventoryProductSafePage = clampPage(inventoryProductPage, totalProducts, inventoryProductSafePageSize)
  const inventoryProductTotalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalProducts || 0)) / inventoryProductSafePageSize))

  // Same class of bug as Products.tsx (see the comment there): the backend's
  // /products bootstrap endpoint clamps `page` to [1, 100000], not to the
  // query's actual totalPages, and echoes the requested page straight back
  // (see cloudflare/src/routes/inventory.ts) -- so `setInventoryProductPage
  // (sumResult.page ...)` after a fetch never actually corrects anything.
  // Deleting/adjusting the last item(s) on the current page shrinks
  // totalProducts without any filter change to trigger a reset-to-1, so the
  // raw `inventoryProductPage` used in the fetch (below) can end up past
  // inventoryProductTotalPages and get stuck showing an empty grid under a
  // clamped-looking "page N of N" label. Self-heal it client-side instead.
  useEffect(() => {
    if (inventoryProductPage > inventoryProductTotalPages) {
      setInventoryProductPage(inventoryProductTotalPages)
    }
  }, [inventoryProductPage, inventoryProductTotalPages])

  const inventoryProductStart = totalProducts ? (((inventoryProductSafePage - 1) * inventoryProductSafePageSize) + 1) : 0
  const inventoryProductEnd = totalProducts ? Math.min(totalProducts, inventoryProductSafePage * inventoryProductSafePageSize) : 0
  const inventoryProductSummaryLabel = totalProducts
    ? `${inventoryProductStart.toLocaleString()}-${inventoryProductEnd.toLocaleString()} / ${Number(totalProducts || 0).toLocaleString()}`
    : (loading && needsProductSummary && !inventoryProductsLoaded ? tr('loading', 'Loading') : '0 / 0')
  // Both delegate to the same shared helper Products.tsx uses
  // (productGroupViewHelpers.ts) rather than reimplementing the min/max
  // price and count/stock/branches logic a second time -- this used to be
  // its own near-duplicate copy that had drifted to not include a branches
  // part at all.
  const getInventoryGroupPriceLabel = useCallback((group: LegacyInventoryRecord) => {
    return buildProductGroupPriceLabel(group, (value: unknown) => fmtUSD(Number(value)))
  }, [fmtUSD])
  const getInventoryGroupSummaryParts = useCallback((group: LegacyInventoryRecord, { includeCount = true }: { includeCount?: boolean } = {}) => {
    return buildProductGroupSummaryParts(group, {
      includeCount,
      t: (key: string) => t(key) || key,
      fmtUSD: (value: unknown) => fmtUSD(Number(value)),
    })
  }, [fmtUSD, t])
  const inventoryControlLabels = useMemo(() => ({
    // tr() is a plain key lookup, no {count} interpolation (see
    // AppContext.tsx's t()) -- the stored translation is the literal
    // string "{count} selected" in both en/km, so it must be substituted
    // by hand, same fix and same root cause as Products.tsx's identical
    // productSelectedLabel bug found in the same audit pass.
    selected: tr('inventory_selected_count', `${selectedProducts.length} selected`).replace('{count}', String(selectedProducts.length)),
    batch: tr('inventory_batch_session', 'Batch'),
    reasons: tr('saved_reasons', 'Reasons'),
  }), [selectedProducts.length, tr])
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
  const inventoryProfitFormulaText = tr('inventory_formula_profit', 'Profit = Revenue - COGS')
  const inventoryDiscountFormulaText = tr('inventory_formula_discounts', 'Discount totals show store-funded and membership-funded reductions allocated across sold items.')
  const inventoryFeesFormulaText = tr('inventory_formula_fees', 'Fees collected combines sales tax and delivery fees captured on completed sales.')
  const statsValue = (value: ReactNode) => (stockStatsLoaded ? value : '...')
  const inventoryStatLabels = {
    products: safeT('products', safeT('products_total', 'Products')),
    inStock: tr('in_stock', 'In stock'),
    healthy: tr('healthy_stock', 'Healthy'),
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
    taxPlusDelivery: `${tr('tax_collected', 'Tax')} + ${tr('delivery_fees', 'Delivery')}`,
  }
  const lowShortLabel = tr('low_stock_short', 'Low')
  const outShortLabel = tr('out_of_stock_short', 'Out')
  const healthyShortLabel = tr('healthy_stock_short', 'Healthy')
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
      info: `${tr('inventory_info_products', 'How many products you carry. A group of same-name items counts as ONE product here, the same way it appears as one row in the list below.')}

${inventoryThresholdFormulaText}`,
      value: statsValue(totalProducts),
      cls: 'text-gray-800 dark:text-gray-200',
      // 11.20: colour carries healthy/low/out here (green/amber/red counts),
      // not text labels -- the detail breakdown below keeps the names. The
      // label rides along as title/aria so colour is not the only cue.
      sub: stockStatsLoaded ? (
        <span className="inline-flex items-center gap-1">
          {buildStockHealthSegments(
            { healthy: healthyCount, low: lowStockCount, out: outStockCount },
            { healthy: healthyShortLabel, low: lowShortLabel, out: outShortLabel },
          ).map((seg, i) => (
            <span key={seg.key} className="inline-flex items-center gap-1">
              {i > 0 ? <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">·</span> : null}
              <span
                className={`font-semibold ${seg.colorClass}`}
                title={`${seg.count} ${seg.label}`}
                aria-label={`${seg.count} ${seg.label}`}
              >
                {seg.count}
              </span>
            </span>
          ))}
        </span>
      ) : safeT('loading', 'Loading...'),
      // Full breakdown, not just low/out -- total counts each product
      // group as one (getFamilyStockStats/paginateProductFamilies both
      // group by family root, matching the listing's own pagination), and
      // in-stock is split into its Healthy/Low subsets so this card
      // answers "how many, and in what shape" in one place instead of
      // needing the separate stock-status filter to see the split.
      details: [
        { label: inventoryStatLabels.products, value: totalProducts },
        { label: inventoryStatLabels.inStock, value: inStockCount },
        { label: inventoryStatLabels.healthy, value: healthyCount },
        { label: inventoryStatLabels.lowStock, value: lowStockCount },
        { label: inventoryStatLabels.outOfStock, value: outStockCount },
      ],
    },
    {
      id: 'stock-value',
      label: inventoryStatLabels.stockValue,
      info: `${tr('inventory_info_stock_value', 'What the stock you are holding right now cost you to buy. Not what it will sell for.')}

${inventoryStockValueFormulaText}`,
      value: statsValue(fmtUSD(totalValue)),
      cls: 'text-blue-700 dark:text-blue-300',
        sub: matchStockShortLabel,
      details: [
        { label: inventoryStatLabels.stockValue, value: fmtUSD(totalValue) },
        { label: inventoryStatLabels.products, value: totalProducts },
      ],
    },
    // Part 388 merges (user): the standalone COGS card held a single row --
    // it folds into Revenue; Net sold folds into Returns (below). Info text
    // now leads with the FORMULA carrying the real numbers, not prose only.
    {
      id: 'revenue',
      label: inventoryStatLabels.revenue,
      info: `${tr('inventory_info_revenue', 'Money taken from customers, after refunds are subtracted.')}

${inventoryStatLabels.revenue} ${fmtUSD(totalRevenue)} − ${inventoryStatLabels.refunded} ${fmtUSD(returnStats?.refund_usd || 0)} = ${fmtUSD(totalRevenue - (returnStats?.refund_usd || 0))}
${tr('gross_profit', 'Gross profit')} ${fmtUSD(totalRevenue - totalCOGS)} = ${inventoryStatLabels.revenue} ${fmtUSD(totalRevenue)} − ${inventoryStatLabels.cogs} ${fmtUSD(totalCOGS)}`,
      value: statsValue(fmtUSD(totalRevenue)),
      cls: 'text-emerald-600 dark:text-emerald-400',
        sub: afterRefundsShortLabel,
      details: [
        { label: inventoryStatLabels.revenue, value: fmtUSD(totalRevenue) },
        { label: inventoryStatLabels.refunded, value: fmtUSD(returnStats?.refund_usd || 0) },
        { label: inventoryStatLabels.cogs, value: fmtUSD(totalCOGS) },
        { label: `${tr('gross_profit', 'Gross profit')} (= ${inventoryStatLabels.revenue} − ${inventoryStatLabels.cogs})`, value: fmtUSD(totalRevenue - totalCOGS) },
      ],
    },
  ]
  const financeStats = [
    {
      id: 'discounts',
      label: inventoryStatLabels.discounts,
      info: `${tr('inventory_info_discounts', 'Money given away as discounts: shop discounts plus member points redeemed.')}

${inventoryDiscountFormulaText}`,
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
          ],
        },
      ],
    },
    {
      id: 'fees',
      label: inventoryStatLabels.feesCollected,
      info: `${tr('inventory_info_fees', 'Extra charges collected on top of the price: tax and delivery fees.')}

${inventoryFeesFormulaText}`,
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
          ],
        },
      ],
    },
    {
      id: 'returns',
      label: inventoryStatLabels.returns,
      // Part 388: Net sold lives here now (its old card merged in) -- the
      // formula IS the explanation, with the live numbers substituted.
      info: `${tr('inventory_info_returns', 'Items sent back: by customers to you, and by you to suppliers.')}

${inventoryStatLabels.netSold} ${totalQtySold} = ${tr('items_sold', 'Items sold')} ${totalQtySold + (returnStats?.items ?? 0)} − ${tr('items', 'Returned items')} ${returnStats?.items ?? 0}`,
      value: (returnStats?.count ?? 0) + (returnStats?.supplier_count ?? 0),
      cls: 'text-orange-600 dark:text-orange-400',
      border: 'border-orange-400',
        // 5.4 (one rule, both pages): each derived metric is card-visible
        // only on its home page -- Gross Profit's home is Dashboard (its
        // card there stays), Net Sold's home is HERE, so it must be
        // readable at card level, not only inside the drill. The sub line
        // is that card-level surface; the drill keeps the full formula.
        sub: `${inventoryStatLabels.netSold} ${totalQtySold} · ${returnStats?.count ?? 0} ${customerShortLabel} | ${returnStats?.supplier_count ?? 0} ${supplierShortLabel}`,
      detailSections: [
        {
          title: inventoryStatLabels.netSold,
          rows: [
            { label: tr('items_sold', 'Items sold'), value: totalQtySold + (returnStats?.items ?? 0) },
            { label: tr('items', 'Returned items'), value: returnStats?.items ?? 0 },
            { label: `${inventoryStatLabels.netSold} (= ${tr('items_sold', 'Items sold')} − ${tr('items', 'Returned items')})`, value: totalQtySold },
          ],
        },
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
  // New -- same derivation as inventoryBrands above (server metadata when
  // available, falling back to whatever's on the current page), for the
  // Category filter section this page previously didn't have at all.
  const inventoryCategories = useMemo(() => (
    (Array.isArray(inventoryProductFilters.categories) && inventoryProductFilters.categories.length
      ? inventoryProductFilters.categories
      : [...new Set(summary.map((p) => String(p.category || '').trim()).filter(Boolean))]
    ).sort((a, b) => a.localeCompare(b))
  ), [inventoryProductFilters.categories, summary])
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

  // H1+X5 (Part 405): the three list-style exports open the shared options
  // dialog (column chooser remembered per kind + CSV/Excel/PDF) with rows
  // from the module's own collectors -- one row shape per kind, whichever
  // path downloads. The zip package export below keeps its direct build.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string; rememberKey: string } | null>(null)
  const exportMovementGroups = useCallback(async (groups: LegacyInventoryRecord[], filePrefix = 'inventory-movements') => {
    const exportModule = await loadInventoryExportModule()
    setExportDialog({ rows: exportModule.collectInventoryMovementRows(groups), baseName: filePrefix, rememberKey: 'inventory-movements' })
  }, [])

  const exportInventorySummary = useCallback(async (productsToExport: InventoryProduct[] = filteredSummary, filePrefix = 'inventory') => {
    const exportModule = await loadInventoryExportModule()
    setExportDialog({ rows: exportModule.collectInventorySummaryRows(buildInventoryExportScope(), productsToExport), baseName: filePrefix, rememberKey: 'inventory-summary' })
  }, [buildInventoryExportScope, filteredSummary])

  const exportInventoryStats = useCallback(async (filePrefix = 'inventory-stats') => {
    const exportModule = await loadInventoryExportModule()
    setExportDialog({ rows: exportModule.collectInventoryStatsRows(buildInventoryExportScope()), baseName: filePrefix, rememberKey: 'inventory-stats' })
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
              active: isMultiActive(movFilter, value),
              onClick: () => setMovFilter(toggleMultiValue(movFilter, value)),
            })),
          ],
        },
        isAdmin ? {
          id: 'movement-user',
          label: t('user') || 'User',
          searchable: true,
          options: [
            { id: 'all', label: t('all_users') || 'All users', active: movementUserFilter === 'all', onClick: () => setMovementUserFilter('all') },
            ...userOptions.map((option) => {
              const id = String(option?.id || '')
              return id ? {
                id: `user-${id}`,
                label: option?.name || option?.username || `User ${id}`,
                active: isMultiActive(movementUserFilter, id),
                onClick: () => setMovementUserFilter(toggleMultiValue(movementUserFilter, id)),
              } : null
            }).filter(Boolean) as { id: string; label: string; active: boolean; onClick: () => void }[],
          ],
        } : null,
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
          searchable: true,
          options: [
            { id: 'desc', label: t('newest_first') || 'Newest first', active: movementSortDirection === 'desc', onClick: () => setMovementSortDirection('desc') },
            { id: 'asc', label: t('oldest_first') || 'Oldest first', active: movementSortDirection === 'asc', onClick: () => setMovementSortDirection('asc') },
            ...buildPeriodFilterOptions({
              yearFilter: movementYearFilter,
              setYearFilter: setMovementYearFilter,
              monthFilter: movementMonthFilter,
              setMonthFilter: setMovementMonthFilter,
              availableYears: movementYears,
              allTimeLabel: t('all_time') || 'All time',
            }),
          ],
        },
      ].filter(Boolean)
    }

    return [
      // Matches the Products menu principle (G1b, pinned in
      // productMenuHelpers.test.ts): everyday facets first — availability,
      // then category, then brand — with the diagnostic/mode controls
      // (Issues, AND/OR search mode) at the end.
      buildAvailabilityFilterSection({
        t,
        branches,
        stockFilter,
        setStockFilter,
        groupFilter,
        setGroupFilter,
        branchFilter,
        setBranchFilter,
      }),
      // Inventory previously had no Category filter section at all
      // (Products/POS both do), even though the underlying data always
      // had a category column. Multi-select + hierarchical "Main - Sub"
      // grouping, same shape/behavior as Products and POS -- see
      // components/shared/CategoryFilterOptions.tsx.
      inventoryCategories.length ? {
        id: 'category',
        label: filterLabel('category', 'Category'),
        searchable: true,
        options: [
          { id: 'category-all', label: filterLabel('all_categories', 'All categories'), active: catFilter === 'all', onClick: () => setCatFilter('all') },
          ...buildHierarchicalCategoryFilterOptions({
            categoryNames: inventoryCategories,
            isSelected: (value) => isMultiActive(catFilter, value, true),
            onToggle: (values, checked) => setCatFilter(toggleMultiValues(catFilter, values, checked)),
          }),
        ],
      } : null,
      inventoryBrands.length ? {
        id: 'brand',
        label: filterLabel('brand', 'Brand'),
        searchable: true,
        options: [
          { id: 'brand-all', label: filterLabel('all_brands', 'All brands'), active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
          ...inventoryBrands.map((brand) => ({
            id: `brand-${brand}`,
            label: brand,
            active: brandFilter === brand,
            onClick: () => setBrandFilter(brandFilter === brand ? 'all' : brand),
          })),
        ],
      } : null,
      buildIssuesFilterSection({
        t,
        issueFilter,
        setIssueFilter,
      }),
      buildSearchModeFilterSection({
        t,
        searchMode,
        setSearchMode,
      }),
    ].filter(Boolean)
  }, [
    branchFilter,
    branches,
    brandFilter,
    catFilter,
    groupFilter,
    inventoryBrands,
    inventoryCategories,
    issueFilter,
    movFilter,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementUserFilter,
    movementYearFilter,
    movementYears,
    searchMode,
    setSearchMode,
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
      catFilter !== 'all',
      groupFilter !== 'all',
      stockFilter !== 'all',
      issueFilter !== 'all',
      inventoryInitialFilter !== 'all',
      searchMode === 'OR',
    ])
  }, [branchFilter, brandFilter, catFilter, groupFilter, inventoryInitialFilter, issueFilter, movFilter, movementGroupMode, movementMonthFilter, movementSortDirection, movementUserFilter, movementYearFilter, searchMode, stockFilter, tab])

  const clearInventoryFilters = useCallback(() => {
    setBranchFilter('all')
    setBrandFilter('all')
    setCatFilter('all')
    setGroupFilter('all')
    setStockFilter('all')
    setIssueFilter('all')
    setInventoryInitialFilter('all')
    setMovFilter('all')
    setMovementUserFilter('all')
    setMovementYearFilter('all')
    setMovementMonthFilter('all')
    setMovementGroupMode('time')
    setMovementSortDirection('desc')
    setSearchMode('AND')
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
      {/* E1: when the Branches hub is driving (hostSection set), its chip
          row replaces this internal picker -- rendering both would be two
          competing section controls. Standalone use keeps it, including its
          remembered-section restore. */}
      {hostSection ? null : (
      <SectionSwitcher
        className="mb-3"
        label=""
        options={inventorySectionOptions}
        value={inventorySection}
        onChange={selectInventorySection}
        storageKey={sectionStorageKey}
        shouldRestoreStoredValue={(storedValue) => storedValue !== 'all'}
      />
      )}

      <LoadingWatchdog
        loading={loading && !isProductsFirstLoad && !isMovementsFirstLoad}
        timeoutMs={8000}
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
          {/* The card is a plain container with the clickable area INSIDE it,
              rather than the whole card being a <button>. InfoHint is itself a
              <button>, and a button nested in a button is invalid HTML -- the
              browser drops one of them, which silently breaks either the hint
              or the drill-down. The hint therefore sits as a sibling of the
              clickable region, in the corner, where it also cannot be hit by
              accident while reaching for the card. */}
          {inventoryStatCards.map((stat) => (
            <div
              key={stat.id}
              className={`card flex min-h-[3.5rem] min-w-0 flex-col items-start self-start px-2.5 py-1.5 text-left transition focus-within:ring-2 focus-within:ring-blue-200 hover:ring-2 hover:ring-blue-200 dark:focus-within:ring-blue-800/50 dark:hover:ring-blue-800/50 ${stat.border ? `border-l-2 ${stat.border}` : ''}`}
            >
              <div className="flex w-full min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase leading-4 tracking-[0.06em] text-gray-400">{stat.label}</div>
                {stat.info ? (
                  <InfoHint
                    className="shrink-0"
                    label={`${String(stat.label)} - ${tr('what_this_means', 'what this means')}`}
                    text={String(stat.info)}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className="flex min-w-0 max-w-full flex-col items-start text-left"
                onClick={() => setStatDetail(stat as StatDetail)}
              >
                <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-5 ${stat.cls}`}>{stat.value}</div>
                {stat.sub ? (
                  <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9.5px] leading-3 text-gray-500 dark:text-gray-400">
                    {stat.sub}
                  </div>
                ) : null}
              </button>
            </div>
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

      {/* Merged toolbar row: Import/Export/History each take an equal share
          of the row's full width (flex-1 on all three, not just History)
          with labels always visible -- previously only History grew to fill
          the row while Import/Export stayed icon-sized, and growing
          History's wrapper alone didn't help either since the small icon
          button inside it didn't stretch, so the row rendered as a cluster
          of small squares on the left with a large empty gap to the right.
          Kept above the search row (rather than below it) so Import/Export/
          History are the first thing in the flow, with search/filter
          directly underneath. */}
      {/* Manage (Import + Export folded into one dropdown, same pattern
          Products.tsx uses) / History -- History before Manage, matching
          Products' ordering. Export items only apply to the Products tab
          (Movements/RFID don't have exportable rows the same way), so
          they're only added to the menu when showProductsSection is true;
          Import stays available regardless of tab. */}
      {showInventorySections ? (
      <div className="inventory-history-row mb-2 flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory} className="min-w-0 flex-1" showLabel t={t} />
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName={`min-w-0 ${TOOLBAR_BUTTON_WIDTH}`}
          menuClassName="max-h-[70vh] overflow-auto"
          trigger={(
            <button
              type="button"
              // Was a fully hand-rolled border/bg/hover color set -- the
              // only "Manage" trigger in the app NOT using the shared
              // .btn-secondary look (Products/Sales both do), and it also
              // had no desktop width cap (`w-full` inside an uncapped
              // `flex-1` wrapper), so it stretched wider than every other
              // page's Manage button on large screens. Switched to the
              // same shared class + sizing (Aug 23 2026, "History/Manage/
              // Product button sizing on large screens").
              className={`w-full ${manageToolbarButtonClassName}`}
              aria-haspopup="true"
              aria-label={tr('manage', 'Manage')}
              title={tr('manage', 'Manage')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr('manage', 'Manage')}</span>
            </button>
          )}
          items={([
            { label: tr('import', 'Import'), onClick: () => setShowImport(true), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
            { label: tr('fast_stockin_title', 'Fast stock-in'), onClick: () => setShowFastStockIn(true), color: 'green', icon: <Zap className="h-4 w-4 shrink-0" /> },
            ...(showProductsSection
              ? [
                'divider' as const,
                ...(inventoryExportItems || [])
                  .filter((item): item is PortalMenuItem => Boolean(item))
                  .map((item) => (item === 'divider' ? item : { ...item, icon: item.icon ?? <Upload className="h-4 w-4 shrink-0" /> })),
              ]
              : []),
          ] as PortalMenuItem[])}
        />
      </div>
      ) : null}

      {/* Items-per-page / page-number bar for the Products tab -- deliberately
          NOT part of the sticky group below (Aug 11 2026 UI-polish request:
          pin search / select-all / bulk-action bar on scroll, but leave
          pagination out of it so it scrolls away normally). Used to be
          bundled into the same sticky card as select-all below it; split
          out so toggling page size or jumping pages doesn't require a
          control that's permanently glued to the top of the screen -- same
          split Products.tsx uses, kept in sync here for parity. */}
      {showProductsSection ? (
        <div className="relative mb-2 -mx-1 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 sm:mx-0">
          <div className={inventoryProductControlsRevealReady ? '' : 'invisible'}>
            <div className="grid min-w-0 grid-cols-[minmax(5.2rem,1fr)_minmax(6.4rem,7.6rem)_minmax(6.9rem,9.4rem)] items-center gap-1.5">
              <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {inventoryProductSummaryLabel}
              </span>
              <div className="flex min-w-0 items-center gap-1">
              <PageSizeSelect
                value={inventoryProductSafePageSize}
                options={PAGE_SIZE_OPTIONS}
                onChange={(nextValue) => {
                  setInventoryProductPageSize(nextValue)
                  setInventoryProductPage(1)
                }}
                // Matches routes/inventory.ts's clampInt(query.pageSize,
                // 20, 1, 100) for the product-search endpoint this
                // control drives -- see the matching note on
                // Products.tsx's PageSizeSelect.
                maxValue={100}
                ariaLabel={`${t('per_page') || 'per page'} ${inventoryProductSafePageSize}`}
                className="h-7 w-full min-w-0"
                buttonClassName="h-7 w-full rounded-full px-2 py-0 pl-2 pr-1.5 text-[10px] font-semibold shadow-none"
                menuClassName="min-w-[9rem]"
                optionClassName="text-xs"
              />
              </div>
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
          </div>
          {!inventoryProductControlsRevealReady ? (
            <div className="pointer-events-none absolute inset-0 flex items-center px-2 py-1.5">
              <div className="grid w-full min-w-0 grid-cols-[minmax(5.7rem,1fr)_3.35rem_minmax(6.9rem,9.4rem)] items-center gap-1.5">
                <div className="h-5 rounded-full bg-slate-100 dark:bg-slate-800" />
                <div className="h-7 rounded-full bg-slate-100 dark:bg-slate-800" />
                <div className="h-7 rounded-full bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Search bar, select-all, and bulk-action bar all pin to the top of
          the page's scroll container while scrolling (same Aug 11 2026
          request as the pagination note above, now consistent with
          Products.tsx's layout). Grouped into ONE sticky wrapper, rather
          than independently-sticky siblings, so there's no need to
          hand-compute a per-element `top` offset to stack them without
          overlapping. The search row itself is shared across every
          Inventory tab (Products/Movements/RFID all filter through the
          same box); the select-all/bulk-action card underneath only
          renders for the Products tab, same as before. */}
      {showInventorySections ? (
      <div className="sticky top-2 z-30 -mx-1 space-y-2 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        {/* Search row: search input + (products) AND/OR toggle + icon-only
            Filter. Filter placement is consistent across every tab,
            matching the Sales/Returns pattern. Same overflow fix as
            Products.tsx's identical row -- see that file's comment for
            the full reasoning: a hard min-w-[19.5rem] row floor forced a
            horizontal scrollbar on narrow screens instead of letting
            SearchInput's own `min-w-0 flex-1` do the shrinking it already
            supports, since every other child here is already shrink-0. */}
        <div className="pt-1">
          <div className="flex items-center gap-1.5">
            <SearchInput
              id="inventory-search"
              name="inventory_search"
              ariaLabel="Inventory search"
              value={search}
              onChange={handleSearchChange}
              placeholder={tab === 'products'
                ? tr('search_terms_placeholder', 'Search divide by comma, any order: name, barcode, SKU')
                : tab === 'rfid'
                  ? tr('search_rfid_placeholder', 'Search RFID sessions, EPC / TID, reader, or product mapping')
                  : `${t('search') || 'Search'} ${t('movements') || 'Movements'}`}
              className="min-w-[3.5rem] flex-1"
              inputClassName="text-sm"
            />
            {tab === 'products' && (
              <ScanSearchButton onDetected={setSearch} t={(key: string) => t(key) || key} />
            )}
            {/* AND/OR toggle removed (Aug 19 2026 UI request) -- search is
                always 'AND' now, same change as Products.tsx/POS.tsx. */}
            <FilterMenu
              label={t('filters') || 'Filters'}
              activeCount={activeInventoryFilterCount}
              sections={inventoryFilterSections}
              onClear={clearInventoryFilters}
              mobileIconOnly
            />
          </div>
        </div>

        {/* 11.2 (B6): the standing "Select all (N)" toolbar control is gone.
            The bulk toolbar only exists while something IS selected (enter
            select mode by long-pressing a row); select-all lives on the
            desktop table's column-header checkbox, and mobile keeps its
            per-section checkboxes. */}
        {showProductsSection && hasSelectedProducts ? (
          <div className="bulk-toolbar relative overflow-hidden rounded-2xl border shadow-sm sm:rounded-xl">
            <div>
              <div className="px-2 py-2">
                <div className="grid items-center gap-1.5 grid-cols-[minmax(0,1fr)_4.25rem_4.6rem]">
                  <span className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {inventoryControlLabels.selected}
                    </span>
                  </span>
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
            </div>
          </div>
        ) : null}
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
          {/* Horizontal A-Z filter bar removed (Aug 19 2026 UI request) --
              same change as Products.tsx: replaced with the vertical
              AlphaIndexRail rendered further down, which jumps to a
              section instead of narrowing the list to one letter.
              shouldReserveInventoryInitialBar / inventoryInitialOptions /
              cachedInventoryInitialOptions and their loading-skeleton
              reservation removed with it -- nothing else in this file
              referenced them. */}
          <InventoryProductsSurfaceView
            InventoryBatchPreview={InventoryBatchPreview}
            InventoryDiscountBadge={InventoryDiscountBadge}
            branchFilter={branchFilter}
            branches={branches}
            collapsedInventoryGroups={collapsedInventoryGroups}
            collapsedInventorySections={collapsedInventorySections}
            fmtKHR={fmtKHR}
            fmtUSD={fmtUSD}
            focusProductId={focusProductId}
            onFocusHandled={() => setFocusProductId(null)}
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
            openAdjust={canAdjustStock ? openAdjust : undefined}
            selectedProductIds={selectedProductIds}
            selectionModeActive={selectionModeActive}
            selectAllChecked={visibleInventoryProducts.length > 0 && selectedProductIds.size === visibleInventoryProducts.length}
            selectAllIndeterminate={selectedProductIds.size > 0 && selectedProductIds.size < visibleInventoryProducts.length}
            onToggleSelectAll={toggleSelectAllProducts}
            getInventoryLongPressState={getInventoryLongPressState}
            setDetailProduct={setDetailProduct}
            showProductsSection={showProductsSection}
            t={t}
            toggleInventoryGroup={toggleInventoryGroup}
            toggleInventorySection={toggleInventorySection}
            toggleInventorySelectionScope={toggleInventorySelectionScope}
            toggleSelectedProduct={toggleSelectedProduct}
            visibleInventoryProducts={visibleInventoryProducts}
          />
          <AlphaIndexRail letters={inventoryVisibleLetters} onJump={jumpToInventoryLetter} label={t('jump_to_letter') || 'Jump to letter'} />
        </>
      )}
      {/* Movements */}
      {showMovementsSection ? (
        <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-8 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">{tr('loading_inventory_movements', 'Loading inventory movements...', 'Loading inventory movements...')}</div>}>
          <InventoryMovementsSurface
            actionHistory={actionHistory}
            collapsedMovementSections={collapsedMovementSections}
            movementColorClass={movementGroupColorClass}
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

      {statDetail ? (
        <Suspense fallback={null}>
          <InventoryStatDetailModal
            onClose={() => setStatDetail(null)}
            statDetail={statDetail}
            t={t}
          />
        </Suspense>
      ) : null}

      {adjustModal || transferModal ? (
        <Suspense fallback={null}>
          <InventoryStockModals
            adjustBranchSelectOptions={adjustBranchSelectOptions}
            adjustCurrentPricing={adjustCurrentPricing}
            adjustCurrentQuantity={adjustCurrentQuantity}
            adjustForm={adjustForm}
            adjustModal={adjustModal}
            adjustSaving={adjustSaving}
            adjustTargetOptions={adjustTargetOptions}
            adjustTargetSelectOptions={adjustTargetSelectOptions}
            branchCount={branches.length}
            branchSelectOptions={branchSelectOptions}
            branchWithPlaceholderOptions={branchWithPlaceholderOptions}
            defaultAddQuantity={DEFAULT_ADD_QUANTITY}
            fmtKHR={fmtKHR}
            fmtUSD={fmtUSD}
            getStockQty={getStockQty}
            onAdjust={handleAdjust}
            onCloseAdjust={() => setAdjustModal(null)}
            onCloseTransfer={() => setTransferModal(null)}
            onTransfer={handleTransferStock}
            reasonsByType={reasonsByType}
            setAdjustForm={setAdjustForm}
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
        <Suspense fallback={null}>
          <InventoryReasonManagerModal
            addSavedReason={addSavedReason}
            deleteSavedReason={deleteSavedReason}
            reasonDraft={reasonDraft}
            reasonManager={reasonManager}
            reasonsByType={reasonsByType}
            renameSavedReason={renameSavedReason}
            savingReasons={savingReasons}
            setReasonDraft={setReasonDraft}
            setReasonManager={setReasonManager}
            t={t}
            tr={tr}
          />
        </Suspense>
      ) : null}

      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey={exportDialog.rememberKey}
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}

      {inventoryBatch?.items?.length ? (
        <Suspense fallback={null}>
          <InventoryBatchModal
            batchApplying={batchApplying}
            branchSelectOptions={branchSelectOptions}
            branchWithPlaceholderOptions={branchWithPlaceholderOptions}
            inventoryBatch={inventoryBatch}
            moveReasonOptions={moveReasonOptions}
            onApply={applyInventoryBatchSession}
            onClose={() => setInventoryBatch(null)}
            onRemoveLine={removeInventoryBatchLine}
            onUpdateLine={updateInventoryBatchLine}
            reasonsByType={reasonsByType}
            setReasonManager={setReasonManager}
            summary={summary}
            t={t}
            tr={tr}
          />
        </Suspense>
      ) : null}

      {manageBatchesModal ? (
        <Suspense fallback={null}>
          <ManageBatchesModal
            product={manageBatchesModal}
            branchSelectOptions={branchSelectOptions}
            defaultBranchId={defaultBranch?.id?.toString() || ''}
            notify={notify}
            onClose={() => setManageBatchesModal(null)}
            onChanged={() => load(true)}
            t={t}
            tr={tr}
          />
        </Suspense>
      ) : null}

      {showFastStockIn ? (
        <Suspense fallback={null}>
          <FastStockInModal
            branchOptions={branchSelectOptions}
            defaultBranchId={branchFilter !== 'all' ? branchFilter : null}
            tr={tr}
            notify={notify}
            onClose={() => setShowFastStockIn(false)}
            onDone={() => load(false)}
          />
        </Suspense>
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
            onAdjust={canAdjustStock ? openAdjust : undefined}
            onTransfer={canTransferStock ? openTransfer : undefined}
            onViewHistory={fetchProductHistoryPreview}
            onManageBatches={openManageBatches}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
            t={t}
          />
        </Suspense>
      )}

      {historyPreview && (
        <Suspense fallback={null}>
          <ProductHistoryPreviewModal
            state={historyPreview}
            onClose={() => setHistoryPreview(null)}
            onRetry={fetchProductHistoryPreview}
            onViewFullHistory={openProductHistoryFromDetail}
            fmtTime={fmtTime}
            movementColorClass={movementColorClassForRecord}
            t={t}
          />
        </Suspense>
      )}
    </div>
  )
}
