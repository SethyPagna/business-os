// Main Inventory page sub-components imported from sibling files.

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Zap from 'lucide-react/dist/esm/icons/zap.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { matchesSearchTermGroups } from '../../utils/searchMatch.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import { toggleMultiValue, isMultiActive, matchesMulti, parseMultiValues } from '../../utils/multiSelect'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import PaginationControls, { clampPage } from '../shared/PaginationControls'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
import { TOOLBAR_BUTTON_WIDTH, manageToolbarButtonClassName } from '../shared/toolbarButtonStyles'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
const ProductDetailModal = lazyRetry(() => import('./ProductDetailModal'), 'inventory-product-detail-modal') as any
const InventoryImportModal = lazyRetry(() => import('./InventoryImportModal'), 'inventory-import') as any
const InventoryMovementsSurface = lazyRetry(() => import('./InventoryMovementsSurface'), 'inventory-movements-surface') as any
const InventoryRfidSurface = lazyRetry(() => import('./InventoryRfidSurface'), 'inventory-rfid-surface') as any
const InventoryStockModals = lazyRetry(() => import('./InventoryStockModals'), 'inventory-stock-modals') as any
const FastStockInModal = lazyRetry(() => import('./FastStockInModal'), 'inventory-fast-stock-in-modal') as any
// F3 slice 2: the minimized-work chip's restore path (see
// utils/minimizedWork.ts -- event for a mounted host, pending for a
// fresh mount).
import { RESTORE_WORK_EVENT, consumePendingRestore, markRestoreHandled, minimizeWork } from '../../utils/minimizedWork.ts'
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'inventory-export-options') as any
const ManageBatchesModal = lazyRetry(() => import('./ManageBatchesModal'), 'inventory-manage-batches-modal') as any
const InventoryReasonManagerModal = lazyRetry(() => import('./InventoryReasonManagerModal'), 'inventory-reason-manager-modal') as any
const ProductHistoryPreviewModal = lazyRetry(() => import('./ProductHistoryPreviewModal'), 'inventory-product-history-preview-modal') as any
const ExportRangeDialog = lazyRetry(() => import('../shared/ExportRangeDialog'), 'inventory-export-range-dialog') as any

import { buildMovementGroups, getMovementGroupPage, movementColorClass, movementColorClassForRecord, movementGroupHaystack, translateMovementType } from './movementGroups'
import { buildStockHealthSegments } from './stockHealthSummary'
import StatsStrip, { statsPresetRange, type StatCardDef } from '../shared/StatsStrip.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker'
import { getSalesStatsStrip } from '../../api/salesTransport.ts'
import { getReturnsReport } from '../../api/returnsReadTransport.ts'

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
import { buildTimeActionSections, toggleIdSet } from '../../utils/groupedRecords.ts'
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

type InventoryUserOption = {
  id: InventoryId
  name?: string
  username?: string
}

type InventoryStats = LegacyInventoryRecord | null

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

const INVENTORY_USER_OPTIONS_TIMEOUT_MS = 8000
const INVENTORY_REASONS_TIMEOUT_MS = 8000
const INVENTORY_BRANCHES_TIMEOUT_MS = 8000
const INVENTORY_STATS_TIMEOUT_MS = 12000
const INVENTORY_MOVEMENTS_TIMEOUT_MS = 15000
const INVENTORY_RFID_TIMEOUT_MS = 8000
const INVENTORY_PRODUCT_DETAIL_TIMEOUT_MS = 10000
const INVENTORY_STOCK_MUTATION_TIMEOUT_MS = 12000

function countActiveFlags(flags: unknown[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
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

export default function Inventory({ hostSection, onHostSectionChange, embedded = false }: {
  hostSection?: InventoryHostSection
  onHostSectionChange?: (section: InventoryHostSection) => void
  // `embedded`: render inline (no own `page-scroll` root) so a host can flow
  // this section directly above/below another in ONE shared scroll -- used by
  // the Branches hub's merged "Stats & Branches" view so the stats cards sit
  // right on top of the branch list with no capped-pane gap between them.
  embedded?: boolean
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
  const [stockStats,    setStockStats]    = useState<InventoryStats>(null)
  const [stockStatsLoaded, setStockStatsLoaded] = useState(false)
  const [statsRefreshError, setStatsRefreshError] = useState('')
  const [movements,     setMovements]     = useState<InventoryMovement[]>([])
  const [movementsLoaded, setMovementsLoaded] = useState(false)
  const [movementMeta,  setMovementMeta]  = useState<MovementMeta>({ total: 0, page: 1, pageSize: 50, totalPages: 1 })
  const [branches,      setBranches]      = useState<InventoryBranch[]>([])
  // Range-scoped money figures for the foldable stats strip (shared
  // StatsStrip, app-wide pattern; default TODAY). These replace the old
  // all-time client-side sums (getReturns({scope:'all'}) walked EVERY
  // return row into the browser just to add them up): the sales kernel
  // (/api/sales/stats-strip) and /api/returns/report answer the same
  // questions server-side for exactly the picked range, agreeing with the
  // Dashboard and Reports for the same dates.
  type InventoryStripKernel = { totals?: Record<string, number> }
  type InventoryStripReturns = { totals?: { count?: number; refund_usd?: number; compensation_usd?: number; loss_usd?: number }; by_type?: Array<{ return_type?: string; count?: number }> }
  const [stripRange, setStripRange] = useState<DateTimeRange>(() => statsPresetRange('today'))
  const [stripKernel, setStripKernel] = useState<InventoryStripKernel | null>(null)
  const [stripCustomerReturns, setStripCustomerReturns] = useState<InventoryStripReturns | null>(null)
  const [stripSupplierReturns, setStripSupplierReturns] = useState<InventoryStripReturns | null>(null)
  const [stripLoading, setStripLoading] = useState(false)
  const stripRequestRef = useRef(0)
  const loadStatsStrip = useCallback(async (): Promise<void> => {
    if (!isActive || !stripRange.startDate || !stripRange.endDate) return
    const requestId = ++stripRequestRef.current
    setStripLoading(true)
    const dates = { startDate: stripRange.startDate, endDate: stripRange.endDate }
    try {
      const [kernel, customer, supplier] = await Promise.all([
        getSalesStatsStrip(dates).catch(() => null),
        getReturnsReport({ ...dates, scope: 'customer' }).catch(() => null),
        getReturnsReport({ ...dates, scope: 'supplier' }).catch(() => null),
      ])
      if (stripRequestRef.current !== requestId) return
      setStripKernel((kernel || null) as InventoryStripKernel | null)
      setStripCustomerReturns((customer || null) as InventoryStripReturns | null)
      setStripSupplierReturns((supplier || null) as InventoryStripReturns | null)
    } finally {
      if (stripRequestRef.current === requestId) setStripLoading(false)
    }
  }, [isActive, stripRange.endDate, stripRange.startDate])
  useEffect(() => { void loadStatsStrip() }, [loadStatsStrip])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (['sales', 'returns', 'inventory'].includes(syncChannel.channel)) void loadStatsStrip()
  }, [isActive, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])
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
  const [movementStartDate, setMovementStartDate] = useState(() => todayDateTimeRange().startDate)
  const [movementEndDate, setMovementEndDate] = useState(() => todayDateTimeRange().endDate)
  // The Start → End range picker is the ONE date control on Movements now
  // (user, Aug 31: "remove [All time]; the date is default, and start date
  // and end date for customizing which is for many sections and pages
  // already") -- the old "Custom range" toggle + year/month period filter
  // (with its "All time" option) are gone with their state.
  //
  // Checkboxes on movement rows only render in an explicit Select mode
  // (user, Aug 31: "the check box can be removed... show only in select
  // mode") -- same principle as the products surface's selectionModeActive.
  const [movementSelectMode, setMovementSelectMode] = useState(false)
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
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [adjustSaving,  setAdjustSaving]  = useState(false)
  const [transferSaving, setTransferSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  // F2 (Part 419): the fast per-shipment stock-in flow -- see
  // FastStockInModal.tsx; writes ride the same receive kernel as every
  // other add-stock surface.
  const [showFastStockIn, setShowFastStockIn] = useState(false)
  useEffect(() => {
    if (consumePendingRestore('fast_stockin')) setShowFastStockIn(true)
    const onRestore = (event: Event) => {
      if ((event as CustomEvent).detail?.kind !== 'fast_stockin') return
      markRestoreHandled('fast_stockin')
      setShowFastStockIn(true)
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
  }, [])
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<{ open: boolean; type: InventoryReasonType }>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const movementSelectAllRef = useRef<HTMLInputElement | null>(null)
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
  const actionHistory = useActionHistory({ limit: 10, notify, scope: 'inventory', enabled: historyReady, user })
  const runInventoryMutation = useCallback((loader: InventoryLoader, label: string): Promise<any> => (
    withLoaderTimeout(loader, label, INVENTORY_STOCK_MUTATION_TIMEOUT_MS)
  ), [])
  // DAY sections always (user, Aug 31: "the date can be moved as group
  // wrap... show only time for rows") -- the date lives once on each day's
  // divider header, so rows need only their clock time.
  const movementTimeMode = 'day'
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

  const needsStatsData = inventorySection === 'all' || inventorySection === 'stats'
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
      const statsQuery = {
        branchId: branchOpts.branchId,
        query: deferredSearch,
        searchMode,
      }
      try {
        const primaryLoaders = {
          branches: () => withLoaderTimeout(
            () => getInventoryApi().getBranches(),
            'Inventory branches',
            INVENTORY_BRANCHES_TIMEOUT_MS,
          ),
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
        const statsResult = result.values.stats
        const movs = result.values.movements
        const rfid = result.values.rfid
        const brs = result.values.branches

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const versionMismatchError = Object.values(result.errors || {}).find(isApiVersionMismatchError) as Error | undefined
        if (versionMismatchError) {
          setLoadError(versionMismatchError.message)
          throw versionMismatchError
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

        // (The old needsStatsData secondary fetch -- getReturns({scope:'all'})
        // summed client-side plus the dashboard summary for tax/delivery --
        // is gone: the range-driven stats strip reads those figures
        // server-side via /api/sales/stats-strip and /api/returns/report.)
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
    deferredSearch,
    isAdmin,
    movementUserFilter,
    movementStartDate,
    movementEndDate,
    movementMeta.page,
    movementMeta.pageSize,
    needsMovementData,
    needsRfidData,
    needsStatsData,
    searchMode,
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
  // Single adjust target: the product the modal was opened from. The
  // variant-family switcher went with the products catalog -- the Products
  // page's own StockAdjustModal is the multi-product entry point now.
  const adjustTargetOptions = useMemo(() => (adjustModal ? [adjustModal] : []), [adjustModal])
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
  const adjustCurrentQuantity = adjustModal ? getStockQty(adjustModal) : 0
  // Resolved against the *currently selected* adjust target (not just the
  // row the modal was opened from) so switching the "Adjust target" picker
  // (adjustTargetOptions.length > 1) updates the displayed locked price too
  // -- same resolution `adjustCurrentQuantity` above and `handleAdjust`'s
  // own `selectedAdjustProduct` already use, kept in sync with both rather
  // than reading `adjustForm`'s pre-filled-at-open-time price fields, which
  // never get refreshed on a target switch (those only matter once
  // unlocked, as edit-starting-point values, not as a display source).
  const adjustCurrentPricing = adjustModal
    ? {
        selling_price_usd: Number(adjustModal?.selling_price_usd) || 0,
        selling_price_khr: Number(adjustModal?.selling_price_khr) || 0,
      }
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
    const selectedAdjustProduct = adjustModal
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
            await load(true)
          },
          redo: async () => {
            const redoResult = await runInventoryMutation(() => getInventoryApi().adjustStock({ ...adjustmentRequest, batchId: inverseBatchId, reason: `Redo: ${adjustmentRequest.reason || 'inventory adjustment'}` }), 'Redo inventory adjustment')
            if (redoResult?.success === false) throw new Error(redoResult?.error || 'Failed to redo stock adjustment')
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
  }, [t])


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

  const movHay = useCallback((m: InventoryMovement): string => (
    `${m.product_name||''} ${m.branch_name||''} ${m.reason||''} ${m.user_name||''} ${m.movement_type||''} ${m.reference_id||''} ${m.lot_code||''} ${m.expiry_date||''} ${m.created_at||''}`.toLowerCase()
  ), [])



  useEffect(() => {
    setMovementMeta((current) => ({ ...current, page: 1 }))
    if (needsMovementData) setMovementsLoaded(false)
  }, [branchFilter, deferredSearch, movementEndDate, movementStartDate, movementUserFilter, needsMovementData, searchMode])

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

  const movementSections = useMemo(() => (
    buildTimeActionSections(groupedMovements, {
      getDate: (group) => group?.latest_at || group?.created_at,
      getItemId: (group) => group?.id,
      getActionKey: (group) => group?.movement_type || 'other',
      getActionLabel: (group) => translateMovementType(group?.movement_type, t),
      timeMode: movementTimeMode,
      groupMode: movementGroupMode,
      sortDirection: movementSortDirection,
    })
  ), [groupedMovements, movementGroupMode, movementSortDirection, movementTimeMode, t])

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
  const totalValue = Number(stockStats?.stock_value_usd || 0)
  const lowStockCount = Number(stockStats?.low_stock || 0)
  const outStockCount = Number(stockStats?.out_of_stock || 0)
  const inStockCount = Number(stockStats?.in_stock || 0)
  // Strict subset of inStockCount (above the low-stock threshold, not just
  // above zero/out-of-stock) -- see familyStockStats.ts's own `healthy`
  // column comment for why this is now split out from in_stock rather than
  // being the same number. No client-side fallback needed the way the
  // other counts have one: this is a purely additive breakdown figure
  // (inStockCount - lowStockCount already gets you the same number), so a
  // stale/missing stockStats just means the "Healthy" line doesn't render
  // yet, not a wrong total anywhere else on the page.
  const healthyCount = Number(stockStats?.healthy ?? Math.max(0, inStockCount - lowStockCount))
  const totalProducts = Number(stockStats?.total_products || 0)

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
  const inventoryThresholdFormulaText = tr('inventory_formula_thresholds', 'Low/Out counts are derived from stock thresholds')
  const inventoryStockValueFormulaText = tr('inventory_formula_stock_value', 'Stock value = positive quantity x effective cost for all matching stock, not just the visible page')
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
  const taxShortLabel = tr('tax_short', 'Tax')
  const deliveryShortLabel = tr('delivery_short', 'Del')
  const customerShortLabel = tr('customer_returns_short', 'Cust')
  const supplierShortLabel = tr('supplier_returns_short', 'Supp')
  const marginShortLabel = tr('profit_margin_short', 'margin')
  // Range-scoped money figures for the strip (the sales kernel + the two
  // returns-report scopes; see loadStatsStrip). Stock-state cards keep
  // reading stockStats -- shelf counts are "as of now", not range-scoped.
  const kernelTotals = (stripKernel?.totals || {}) as Record<string, number>
  const stripMoney = (value: number): string => (stripLoading ? '···' : fmtUSD(value))
  const stripCount = (value: number): string => (stripLoading ? '···' : String(value))
  const stripRevenue = Number(kernelTotals.revenue_usd) || 0
  const stripCogs = Number(kernelTotals.cost_usd) || 0
  const stripProfit = Number(kernelTotals.profit_usd) || 0
  const stripGross = Number(kernelTotals.gross_sales_usd) || 0
  const stripStoreDiscount = Number(kernelTotals.store_discount_usd) || 0
  const stripMemberDiscount = Number(kernelTotals.membership_discount_usd) || 0
  const stripTax = Number(kernelTotals.tax_usd) || 0
  const stripDeliveryFees = Number(kernelTotals.delivery_usd) || 0
  const stripDeliveryCount = Number(kernelTotals.delivery_sale_count) || 0
  const custReturnTotals = stripCustomerReturns?.totals || {}
  const suppReturnTotals = stripSupplierReturns?.totals || {}
  const stripCustomerReturnCount = Number(custReturnTotals.count) || 0
  const stripRefunded = Number(custReturnTotals.refund_usd) || 0
  const stripRestocked = Number((stripCustomerReturns?.by_type || []).find((row) => String(row.return_type || 'restock') === 'restock')?.count) || 0
  const stripSupplierReturnCount = Number(suppReturnTotals.count) || 0
  const stripSupplierLoss = Number(suppReturnTotals.loss_usd) || 0
  const stripCards: StatCardDef[] = [
    {
      key: 'products',
      label: String(inventoryStatLabels.products),
      hint: `${tr('inventory_info_products', 'How many products you carry. A group of same-name items counts as ONE product here, the same way it appears as one row in the list below.')}

${inventoryThresholdFormulaText}`,
      value: statsValue(totalProducts),
      // 11.20: colour carries healthy/low/out here (green/amber/red counts),
      // not text labels -- the fold keeps the names. The label rides along
      // as title/aria so colour is not the only cue.
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
      details: [
        { label: String(inventoryStatLabels.products), value: totalProducts },
        { label: String(inventoryStatLabels.inStock), value: inStockCount },
        { label: String(inventoryStatLabels.healthy), value: healthyCount },
        { label: String(inventoryStatLabels.lowStock), value: lowStockCount, tone: lowStockCount > 0 ? 'warn' : undefined },
        { label: String(inventoryStatLabels.outOfStock), value: outStockCount, tone: outStockCount > 0 ? 'crit' : undefined },
      ],
    },
    {
      key: 'stock-value',
      label: String(inventoryStatLabels.stockValue),
      hint: `${tr('inventory_info_stock_value', 'What the stock you are holding right now cost you to buy. Not what it will sell for.')}

${inventoryStockValueFormulaText}`,
      value: statsValue(fmtUSD(totalValue)),
      tone: 'accent',
      sub: matchStockShortLabel,
      details: [
        { label: String(inventoryStatLabels.stockValue), value: fmtUSD(totalValue) },
        { label: tr('avg_value_per_product', 'Avg value / product'), value: fmtUSD(totalProducts > 0 ? totalValue / totalProducts : 0) },
        { label: String(inventoryStatLabels.lowStock), value: lowStockCount, tone: lowStockCount > 0 ? 'warn' : undefined },
        { label: String(inventoryStatLabels.outOfStock), value: outStockCount, tone: outStockCount > 0 ? 'crit' : undefined },
      ],
    },
    {
      key: 'revenue',
      label: String(inventoryStatLabels.revenue),
      // Z10 (user, Aug 29 -- "follow dashboard, keeps them separate"): Revenue
      // is net of discounts, BEFORE refunds, exactly like the Dashboard; now
      // computed by the SAME salesAnalytics kernel over the strip's range.
      hint: `${tr('inventory_info_revenue', 'Money kept from sales: gross sales minus discounts. Refunds are shown separately in Returns.')}

${tr('gross_profit', 'Gross profit')} = ${String(inventoryStatLabels.revenue)} − ${String(inventoryStatLabels.cogs)}`,
      value: stripMoney(stripRevenue),
      tone: 'ok',
      sub: stripLoading ? undefined : `${tr('gross_profit', 'Gross profit')} ${fmtUSD(stripProfit)}`,
      details: [
        { label: tr('stats_gross', 'Gross sales'), value: fmtUSD(stripGross) },
        { label: String(inventoryStatLabels.revenue), value: fmtUSD(stripRevenue) },
        { label: String(inventoryStatLabels.cogs), value: fmtUSD(stripCogs) },
        { label: tr('gross_profit', 'Gross profit'), value: fmtUSD(stripProfit), tone: 'ok' },
        { label: marginShortLabel, value: stripRevenue > 0 ? `${((stripProfit / stripRevenue) * 100).toFixed(1)}%` : '—' },
      ],
    },
  ]
  stripCards.push(
    {
      key: 'discounts',
      label: String(inventoryStatLabels.discounts),
      hint: `${tr('inventory_info_discounts', 'Money given away as discounts: shop discounts plus member points redeemed.')}

${inventoryDiscountFormulaText}`,
      value: stripMoney(stripStoreDiscount + stripMemberDiscount),
      tone: (stripStoreDiscount + stripMemberDiscount) > 0 ? 'warn' : undefined,
      details: [
        { label: tr('store_discounts', 'Store discounts'), value: fmtUSD(stripStoreDiscount) },
        { label: tr('membership_discounts', 'Membership discounts'), value: fmtUSD(stripMemberDiscount) },
        { label: tr('discounts_total', 'Total discounts'), value: fmtUSD(stripStoreDiscount + stripMemberDiscount) },
        // Discount rate = total discounts / gross -- mirrors Dashboard.
        { label: tr('discount_rate', 'Discount rate'), value: `${stripGross > 0 ? (((stripStoreDiscount + stripMemberDiscount) / stripGross) * 100).toFixed(1) : '0.0'}%` },
      ],
    },
    {
      key: 'fees',
      label: String(inventoryStatLabels.feesCollected),
      hint: `${tr('inventory_info_fees', 'Extra charges collected on top of the price: tax and delivery fees.')}

${inventoryFeesFormulaText}`,
      value: stripMoney(stripTax + stripDeliveryFees),
      sub: stripLoading ? undefined : `${taxShortLabel} ${fmtUSD(stripTax)} | ${deliveryShortLabel} ${fmtUSD(stripDeliveryFees)}`,
      details: [
        { label: String(inventoryStatLabels.taxCollected), value: fmtUSD(stripTax) },
        { label: String(inventoryStatLabels.deliveryFees), value: fmtUSD(stripDeliveryFees) },
        { label: tr('deliveries', 'Deliveries'), value: stripDeliveryCount },
      ],
    },
    {
      key: 'returns',
      label: String(inventoryStatLabels.returns),
      hint: tr('inventory_info_returns', 'Items sent back: by customers to you, and by you to suppliers.'),
      value: stripCount(stripCustomerReturnCount + stripSupplierReturnCount),
      tone: (stripCustomerReturnCount + stripSupplierReturnCount) > 0 ? 'warn' : undefined,
      sub: stripLoading ? undefined : `${stripCustomerReturnCount} ${customerShortLabel} | ${stripSupplierReturnCount} ${supplierShortLabel}`,
      details: [
        { label: tr('customer_returns', 'Customer returns'), value: stripCustomerReturnCount },
        { label: String(inventoryStatLabels.refunded), value: fmtUSD(stripRefunded), tone: stripRefunded > 0 ? 'crit' : undefined },
        { label: t('restocked_to_inventory') || 'Restocked', value: stripRestocked },
        { label: `${t('supplier_returns') || 'Supplier returns'} (${stripSupplierReturnCount})`, value: fmtUSD(stripSupplierLoss), tone: stripSupplierLoss > 0 ? 'crit' : undefined },
      ],
    },
  )
  const selectedMovementGroups = useMemo(
    () => visibleMovementGroups.filter((group) => selectedMovementIds.has(group.id)),
    [selectedMovementIds, visibleMovementGroups],
  )
  const visibleMovementQuantity = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.totalQuantity || 0), 0),
    [visibleMovementGroups],
  )
  const visibleMovementRecordCount = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.items?.length || group.recordCount || 0), 0),
    [visibleMovementGroups],
  )
  // H1+X5 (Part 405): movement exports open the shared options dialog
  // (column chooser remembered per kind + CSV/Excel/PDF) with rows from the
  // export module's collector. The old products-catalog exports (summary /
  // low-stock / out-of-stock / full package / stats) left with the products
  // slice -- the Products PAGE owns catalog exports, and the Stats &
  // Branches section carries its own ranged stats export now. They were
  // also quietly exporting EMPTY rows from this tab (the catalog was never
  // loaded here) -- removing beats silently exporting nothing.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string; rememberKey: string } | null>(null)
  const exportMovementGroups = useCallback(async (groups: LegacyInventoryRecord[], filePrefix = 'inventory-movements') => {
    const exportModule = await loadInventoryExportModule()
    setExportDialog({ rows: exportModule.collectInventoryMovementRows(groups), baseName: filePrefix, rememberKey: 'inventory-movements' })
  }, [])

  // Ranged movement export (user, Aug 31: "do the date range for all the
  // exports... it will default shows that start/end date, but you can
  // edit"): the Export click opens a Start→End prompt seeded with the
  // page's own range. Unchanged range exports exactly the visible groups;
  // an edited range fetches that window server-side (the /movements
  // endpoint accepts pageSize up to 50k) and applies the same activity/user
  // filters the visible list applies.
  const [movementExportRange, setMovementExportRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const runRangedMovementExport = useCallback(async (range: { startDate: string; endDate: string }) => {
    const sameRange = (range.startDate || '') === (movementStartDate || '') && (range.endDate || '') === (movementEndDate || '')
    if (sameRange) {
      await exportMovementGroups(visibleMovementGroups, 'inventory-movements')
      return
    }
    const result = await withLoaderTimeout(
      () => getInventoryApi().getInventoryMovements({
        ...(branchFilter !== 'all' ? { branchId: parseInt(branchFilter, 10) } : {}),
        search: deferredSearch || undefined,
        searchMode,
        startDate: range.startDate || undefined,
        endDate: range.endDate || undefined,
        page: 1,
        pageSize: 20000,
      }),
      'Inventory movements export',
      INVENTORY_MOVEMENTS_TIMEOUT_MS,
    ) as { items?: InventoryMovement[]; total?: number } | InventoryMovement[]
    const items = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : [])
    const total = Array.isArray(result) ? items.length : Number(result?.total || items.length)
    if (total > items.length) {
      // No silent caps -- say exactly how much of the range made it out.
      notify(tr('export_truncated', `Export capped at ${items.length} of ${total} records — narrow the range for the rest.`), 'warning')
    }
    const filtered = items.filter((m) => matchesMulti(movFilter, m.movement_type) && matchesMulti(movementUserFilter, m.user_id))
    await exportMovementGroups(buildMovementGroups(filtered), 'inventory-movements-range')
  }, [branchFilter, deferredSearch, exportMovementGroups, movFilter, movementEndDate, movementStartDate, movementUserFilter, notify, searchMode, tr, visibleMovementGroups])

  // Ranged stats export for the Stats & Branches section (user, Aug 31:
  // "make sure the branch section has the export for these as well and can
  // range the date start and end date to choose as well"): a compact CSV of
  // the section's own numbers, fetched fresh for the chosen range (kernel +
  // returns reports -- the same reads the strip itself uses). The shelf
  // figures (products / stock value / low / out) come from the live
  // stockStats and are labelled as current-state, not range-scoped.
  const [statsExportRange, setStatsExportRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const runRangedStatsExport = useCallback(async (range: { startDate: string; endDate: string }) => {
    const startDate = range.startDate || stripRange.startDate || ''
    const endDate = range.endDate || stripRange.endDate || ''
    const dates = { startDate, endDate }
    const [kernel, customer, supplier] = await Promise.all([
      getSalesStatsStrip(dates).catch(() => null),
      getReturnsReport({ ...dates, scope: 'customer' }).catch(() => null),
      getReturnsReport({ ...dates, scope: 'supplier' }).catch(() => null),
    ]) as Array<Record<string, any> | null>
    const totals = (kernel?.totals || {}) as Record<string, number>
    const cust = (customer?.totals || {}) as Record<string, number>
    const supp = (supplier?.totals || {}) as Record<string, number>
    const { downloadCSV } = await import('../../utils/csv.ts')
    downloadCSV(`inventory-stats-${startDate || 'all'}-${endDate || 'all'}.csv`, [
      { metric: 'range_start', value: startDate || 'all' },
      { metric: 'range_end', value: endDate || 'all' },
      { metric: 'products_current', value: totalProducts },
      { metric: 'in_stock_current', value: inStockCount },
      { metric: 'low_stock_current', value: lowStockCount },
      { metric: 'out_of_stock_current', value: outStockCount },
      { metric: 'stock_value_usd_current', value: totalValue },
      { metric: 'revenue_usd', value: Number(totals.revenue_usd) || 0 },
      { metric: 'cogs_usd', value: Number(totals.cost_usd) || 0 },
      { metric: 'profit_usd', value: Number(totals.profit_usd) || 0 },
      { metric: 'gross_sales_usd', value: Number(totals.gross_sales_usd) || 0 },
      { metric: 'store_discount_usd', value: Number(totals.store_discount_usd) || 0 },
      { metric: 'membership_discount_usd', value: Number(totals.membership_discount_usd) || 0 },
      { metric: 'tax_usd', value: Number(totals.tax_usd) || 0 },
      { metric: 'delivery_usd', value: Number(totals.delivery_usd) || 0 },
      { metric: 'delivery_sale_count', value: Number(totals.delivery_sale_count) || 0 },
      { metric: 'customer_returns', value: Number(cust.count) || 0 },
      { metric: 'customer_refund_usd', value: Number(cust.refund_usd) || 0 },
      { metric: 'supplier_returns', value: Number(supp.count) || 0 },
      { metric: 'supplier_loss_usd', value: Number(supp.loss_usd) || 0 },
    ])
  }, [inStockCount, lowStockCount, outStockCount, stripRange.endDate, stripRange.startDate, totalProducts, totalValue])

  const inventoryExportItems = useMemo<any[]>(() => {
    if (tab !== 'movements') return []
    return [
      {
        label: tr('export_movements_range', `Export ${t('movements') || 'movements'}…`),
        onClick: () => setMovementExportRange({ startDate: movementStartDate, endDate: movementEndDate }),
        color: 'green',
      },
      selectedMovementGroups.length
        ? { label: tr('export_selected_movement_groups', 'Export selected movement groups'), onClick: () => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected'), color: 'blue' }
        : null,
    ].filter(Boolean)
  }, [exportMovementGroups, movementEndDate, movementStartDate, selectedMovementGroups, tab, t, tr])

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
          // Sort only -- the year/month period options (and their default
          // "All time" pick, which surfaced as a chip next to the Filters
          // trigger) are gone (user, Aug 31: "remove that, the date is
          // default, and start date and end date for customizing which is
          // for many sections and pages already"): the toolbar's Start → End
          // range picker is the one date control.
          id: 'movement-sort',
          label: t('sort') || 'Sort',
          options: [
            { id: 'desc', label: t('newest_first') || 'Newest first', active: movementSortDirection === 'desc', onClick: () => setMovementSortDirection('desc') },
            { id: 'asc', label: t('oldest_first') || 'Oldest first', active: movementSortDirection === 'asc', onClick: () => setMovementSortDirection('asc') },
          ],
        },
      ].filter(Boolean)
    }

    // The products tab is gone (the Products PAGE owns the catalog) --
    // there is no default facet set left.
    return []
  }, [
    branchFilter,
    branches,
    movFilter,
    movementGroupMode,
    movementSortDirection,
    movementUserFilter,
    isAdmin,
    t,
    tab,
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
        movementGroupMode !== 'time',
        movementSortDirection !== 'desc',
      ])
    }

    return 0
  }, [branchFilter, movFilter, movementGroupMode, movementSortDirection, movementUserFilter, tab])

  const clearInventoryFilters = useCallback(() => {
    setBranchFilter('all')
    setMovFilter('all')
    setMovementUserFilter('all')
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
  const toggleMovementSelectMode = useCallback(() => {
    setMovementSelectMode((current) => !current)
  }, [])
  // Leaving Select mode drops the selection with it -- a hidden selection
  // that still drives the "N selected" export state would be a trap.
  useEffect(() => {
    if (!movementSelectMode) setSelectedMovementIds(new Set())
  }, [movementSelectMode])
  const showMovementActionGroups = movementGroupMode === 'time+action'
  const sectionStorageKey = 'business-os:inventory:section:v2'
  const showInventoryStats = inventorySection === 'all' || inventorySection === 'stats'
  const showInventorySections = inventorySection === 'all' || ['products', 'movements', 'rfid'].includes(inventorySection)
  const showInventoryTabs = inventorySection === 'all'
  const showMovementsSection = showInventorySections && tab === 'movements'
  const showRfidSection = showInventorySections && tab === 'rfid'
  const isMovementsFirstLoad = showMovementsSection && needsMovementData && !movementsLoaded
  const selectInventorySection = (nextSection: string) => {
    setInventorySection(nextSection)
    if (['products', 'movements', 'rfid'].includes(nextSection)) setTab(nextSection)
  }

  if (loadError && !loading && !movements.length) {
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
    <div className={embedded ? 'px-3 pt-3 pb-1 sm:px-6 sm:pt-6 sm:pb-2' : 'page-scroll p-3 sm:p-6'}>
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
        loading={loading && !isMovementsFirstLoad}
        timeoutMs={8000}
        label={t('loading') || 'Loading...'}
        details={tab === 'rfid' ? 'Checking RFID status, tag mappings, and inventory data.' : 'Loading stock stats and movement summaries.'}
        onRetry={() => load(false)}
        className="mb-3"
      />

      {statsRefreshError ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {statsRefreshError}
        </div>
      ) : null}

      {showInventoryStats ? (
        // The foldable stats strip (shared StatsStrip, the app-wide stats
        // pattern) replaces the 8-card grid + its drill-down modal: tapping
        // a card folds its breakdown open INLINE. Shelf-state cards
        // (Products, Stock value) read the filter-scoped stockStats; the
        // money cards are range-scoped (default today) via the sales
        // kernel + returns report, agreeing with Dashboard/Reports.
        //
        // The Start→End range that scopes those money cards now leads as its
        // OWN row directly above the strip (user, Aug 31: "fish out the start
        // date and end date from the stats button ... the start and end date
        // will also apply to it"). Inventory's stats sit on their own top-level
        // section chip, so there's no search bar here for the date row to sit
        // above — it leads the section instead, driving the same stripRange.
        <div className="mb-2 space-y-1.5">
          <StatsRangeRow
            range={stripRange} onRangeChange={setStripRange}
            t={t}
            actions={(
              // Ranged stats export -- the dialog opens seeded with the
              // section's own Start → End range (user, Aug 31).
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setStatsExportRange({ startDate: stripRange.startDate || '', endDate: stripRange.endDate || '' })}
                title={tr('export', 'Export')}
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                {tr('export', 'Export')}
              </button>
            )}
          />
          <StatsStrip
            cards={stripCards}
            t={t}
          />
        </div>
      ) : null}
      {showInventoryTabs ? (
      <div className="mb-4 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {([['movements', t('movements') || 'Movements'], ['rfid', 'RFID']] as [string, string][]).map(([id,label]) => (
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
            // Import = Upload (data INTO the app), Export = Download -- same
            // icon convention as HeaderActions; these two were swapped.
            { label: tr('import', 'Import'), onClick: () => setShowImport(true), color: 'blue', icon: <Upload className="h-4 w-4 shrink-0" /> },
            { label: tr('fast_stockin_title', 'Fast stock-in'), onClick: () => setShowFastStockIn(true), color: 'green', icon: <Zap className="h-4 w-4 shrink-0" /> },
          ] as PortalMenuItem[])}
        />
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
              placeholder={tab === 'rfid'
                ? tr('search_rfid_placeholder', 'Search RFID sessions, EPC / TID, reader, or product mapping')
                : `${t('search') || 'Search'} ${t('movements') || 'Movements'}`}
              className="min-w-[3.5rem] flex-1"
              inputClassName="text-sm"
            />
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

      </div>
      ) : null}

      {showInventorySections && (tab === 'rfid' || isMovementsFirstLoad) ? (
      <p className="text-xs text-gray-400 mb-2">
        {tab === 'rfid'
          ? `RFID inventory for ${rfidGatewayStatus.branchName} - reader gateway, tag mapping, sessions, and barcode fallback`
          : `${t('loading') || 'Loading'} ${t('movements') || 'movements'}...`}
      </p>
      ) : null}

      {/* The products LIST section is gone (user, Aug 31: "the products
          section of inventory page can then be removed") -- the Products
          PAGE carries the catalog now. What stays here is everything the
          Movements section still needs: the per-product detail modal (with
          its stock-history preview), the complete adjust/transfer/batches
          modals it opens, and the movement exports. */}
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
            movementEndDate={movementEndDate}
            movementMeta={movementMeta}
            movementSections={movementSections}
            movementSelectAllRef={movementSelectAllRef}
            movementSelectMode={movementSelectMode}
            movementStartDate={movementStartDate}
            onToggleMovementSelectMode={toggleMovementSelectMode}
            openMovementProductDetail={openMovementProductDetail}
            selectedMovementGroups={selectedMovementGroups}
            selectedMovementIds={selectedMovementIds}
            setSelectedMovementIds={setSelectedMovementIds}
            setExpandedMovementGroupPage={setExpandedMovementGroupPage}
            setMovementEndDate={setMovementEndDate}
            setMovementMeta={setMovementMeta}
            setMovementStartDate={setMovementStartDate}
            showMovementActionGroups={showMovementActionGroups}
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
            onMinimize={(label: string) => minimizeWork({ key: 'fast-stockin', kind: 'fast_stockin', pageId: 'branches', label })}
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

      {/* Ranged export prompts -- each opens seeded with its surface's own
          Start → End range (user, Aug 31: "do the date range for all the
          exports"). */}
      {movementExportRange ? (
        <Suspense fallback={null}>
          <ExportRangeDialog
            initial={movementExportRange}
            title={`${tr('export', 'Export')} — ${t('movements') || 'Movements'}`}
            t={t}
            onClose={() => setMovementExportRange(null)}
            onExport={runRangedMovementExport}
          />
        </Suspense>
      ) : null}
      {statsExportRange ? (
        <Suspense fallback={null}>
          <ExportRangeDialog
            initial={statsExportRange}
            title={`${tr('export', 'Export')} — ${tr('stats', 'Stats')}`}
            t={t}
            onClose={() => setStatsExportRange(null)}
            onExport={runRangedStatsExport}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
