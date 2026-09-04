import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentProps } from 'react'
import { toggleMultiValue, isMultiActive } from '../../utils/multiSelect'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { fmtClock24 } from '../../utils/formatters'
import { getSaleReturnBlockReason } from '../../utils/saleReturnGuard.ts'
import type { SaleAmendmentRow } from '../../utils/saleAmendments.ts'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import { loadSortSpec, saveSortSpec, type SortField, type SortSpec } from '../../utils/listSort'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import type { SaleCancelPayload } from './CancelSaleModal'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { pruneSelectionToVisibleIds } from '../../utils/rowSelection.ts'
import { createLongPressState, type LongPressState } from '../../utils/longPress.ts'
import { buildTimeActionSections, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import { beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { getSales as fetchSales, getSalesStats as fetchSalesStats, getSalesStatsStrip } from '../../api/salesTransport.ts'
import { getFeesReport } from '../../api/feesTransport.ts'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import { EMPTY_DATE_TIME_RANGE, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getUsers as fetchUsers } from '../../api/userReadTransport.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
const Receipt = lazyRetry(() => import('../receipt/Receipt'), 'sales-receipt')
const SaleDetailModal = lazyRetry(() => import('./SaleDetailModal'), 'sales-sale-detail-modal')
const CancelSaleModal = lazyRetry(() => import('./CancelSaleModal'), 'sales-cancel-sale-modal')
// S4-2: the confirmation every sale status change now goes through -- it
// states the old status, the new one and what happens to stock, and carries
// the admin-only, lock-gated "Don't touch stock" option.
const SaleStatusConfirmModal = lazyRetry(() => import('./SaleStatusConfirmModal'), 'sales-status-confirm-modal')
const ExportModal = lazyRetry(() => import('./ExportModal'), 'sales-export-modal')
const SalesImportModal = lazyRetry(() => import('./SalesImportModal'), 'sales-import')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'sales-export-options')
// The SAME component the Returns section opens for "Add Return" -- opened
// here from a sale the user is already looking at, with the receipt number
// prefilled. No forked return logic lives in Sales.
const NewReturnModal = lazyRetry(() => import('../returns/NewReturnModal'), 'sales-new-return-modal')
import SalesListSurface from './SalesListSurface'
import { buildSalesImportRows, SALES_IMPORT_COLUMNS } from '../../utils/salesImportContract.ts'
import { exportColumnLabel } from '../../utils/exportOptions.ts'

const SALES_USER_OPTIONS_TIMEOUT_MS = 8000
const SALES_STATUS_MUTATION_TIMEOUT_MS = 12000
const SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS = 12000
// S4-24b: adding lines deducts stock and rewrites the sale's totals in one
// atomic batch -- a longer ceiling than a status flip, but still bounded so a
// stalled request cannot leave the cashier staring at a spinner.
const SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS = 20000

// S4-2: which statuses hold units OUT of stock -- the same set
// lib/saleTransitions.ts's heldQuantity() uses (STOCK_DEDUCTED_STATUSES
// plus the two return statuses). A transition moves stock only when it
// crosses this line, which is what the confirmation dialog states up front.
const STOCK_HOLDING_STATUSES = new Set(['completed', 'awaiting_delivery', 'partial_return', 'returned'])
const transitionMovesStock = (fromStatus: string, toStatus: string): boolean => (
  STOCK_HOLDING_STATUSES.has(String(fromStatus || 'completed')) !== STOCK_HOLDING_STATUSES.has(String(toStatus || 'completed'))
)

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void
type MoneyFormatter = (value: number | string) => string
type SalesGroupMode = 'time' | 'time+action'
type SortDirection = 'asc' | 'desc'

interface SaleItemRecord {
  id?: number | string
  product_id?: number | string
  branch_name?: string
  quantity?: number | string
  product_name?: string
  sku?: string
  barcode?: string
  [key: string]: unknown
}

interface SaleRecord extends Record<string, unknown> {
  id: number | string
  receipt_number?: string
  created_at?: string
  sale_status?: string
  // S4-2 (migration 0114): 1 when an admin deliberately changed this sale's
  // status without moving stock. The sale stays outside the stock ledger
  // from then on, so the confirmation says so instead of promising a
  // deduction that will not happen.
  stock_skipped?: number
  cashier_name?: string
  payment_method?: string
  notes?: string
  customer_name?: string
  customer_membership_number?: string
  customer_phone?: string
  customer_address?: string
  branch_name?: string
  items?: SaleItemRecord[] | string | null
  total_usd?: number
  total?: number
  total_khr?: number
  net_total_usd?: number
}

// The page's sort vocabulary (see utils/listSort.ts). Labels are attached
// in-component (they need `t`); ids/kinds/getters are static. 'date' keeps
// the existing time-section pipeline; every other field sorts flat.
const SALES_SORT_FIELD_DEFS = [
  { id: 'date', kind: 'date' as const, get: (sale: SaleRecord) => sale?.created_at },
  { id: 'total', kind: 'number' as const, get: (sale: SaleRecord) => sale?.total_usd ?? sale?.total },
  { id: 'customer', kind: 'text' as const, get: (sale: SaleRecord) => sale?.customer_name },
  { id: 'cashier', kind: 'text' as const, get: (sale: SaleRecord) => sale?.cashier_name },
  { id: 'status', kind: 'text' as const, get: (sale: SaleRecord) => sale?.sale_status },
  { id: 'receipt', kind: 'text' as const, get: (sale: SaleRecord) => sale?.receipt_number },
]

interface UserOption {
  id?: number | string | null
  name?: string | null
  username?: string | null
}

interface AppUser {
  id?: number | string | null
  name?: string | null
  username?: string | null
  role_code?: string | null
  permissions?: unknown
}

interface AppContextValue {
  t: TranslateFn
  settings?: { language?: string | null; [key: string]: unknown } | null
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  notify: NotifyFn
  user?: AppUser | null
  getPermissionTier: (key: string) => string
  can: (permissionKey: string, actionKey: string) => boolean
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string | null
    ts?: string | number | null
  } | null
}

interface SaleMembershipPayload extends Record<string, unknown> {
  membershipNumber?: string
  clearAssignment?: boolean
  userId?: number | string | null
  userName?: string | null
  device_name?: string
  device_tz?: string
}

interface SaleStatusEntry {
  id: number | string
  status: string
}

interface SaleItemAddition {
  product_id: number
  quantity: number
  applied_price_usd?: number
}

// S4-30: what the detail view asks the server to change, and the ledger rows
// it reads back. The request shape is the one salesTransport.amendSale sends;
// the row shape is migration 0115's, shared with utils/saleAmendments.ts so
// the renderer and the caller cannot drift.
interface SaleAmendmentRequest {
  kind: 'line_quantity_increased' | 'line_quantity_decreased' | 'line_removed' | 'line_replaced' | 'delivery_fee_changed'
  sale_item_id?: number
  quantity?: number
  delivery_fee_usd?: number
  replacement?: { product_id: number; quantity: number; applied_price_usd?: number; branch_id?: number | null }
  notes?: string
}

interface SalesApi {
  updateSaleStatus: (saleId: number | string, status: string, notes?: string, extra?: Record<string, unknown>) => Promise<unknown>
  attachSaleCustomer: (saleId: number | string, payload: SaleMembershipPayload) => Promise<unknown>
  addSaleItems: (saleId: number | string, items: SaleItemAddition[], notes?: string) => Promise<unknown>
  // S4-30: amend a recorded sale, and read its history.
  amendSale: (saleId: number | string, request: SaleAmendmentRequest) => Promise<unknown>
  getSaleAmendments: (saleId: number | string) => Promise<unknown>
}

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']
type SalesListSurfaceProps = ComponentProps<typeof SalesListSurface>

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function getSalesApi(): SalesApi {
  if (typeof window === 'undefined' || !window.api) throw new Error('Sales API is not available.')
  return window.api as SalesApi
}

function normalizeSaleRows(value: unknown): SaleRecord[] {
  if (Array.isArray(value)) return value as SaleRecord[]
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: SaleRecord[] }).items
  }
  return []
}

function normalizeUserOptions(value: unknown): UserOption[] {
  if (Array.isArray(value)) return value as UserOption[]
  return []
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isWriteConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && (
    (error as { conflict?: unknown }).conflict === true ||
    (error as { code?: unknown }).code === 'write_conflict'
  )
}

function normalizeFiniteIdsFrom<T = unknown>(items: T[] = [], getValue: (value: T) => unknown = (value) => value): number[] {
  return items.reduce<number[]>((normalized, item) => {
    const id = Number(getValue(item))
    if (Number.isFinite(id)) normalized.push(id)
    return normalized
  }, [])
}

function normalizeFiniteIds(ids: Array<number | string> = []): number[] {
  return normalizeFiniteIdsFrom(ids)
}

function countSelectedIds(ids: Array<number | string> = [], selectedIds: Set<number> = new Set()): number {
  let count = 0
  for (const id of ids) {
    if (selectedIds.has(Number(id))) count += 1
  }
  return count
}

function countActiveFlags(flags: boolean[] = []): number {
  let count = 0
  for (const flag of flags) {
    if (flag) count += 1
  }
  return count
}

function getSaleBranchLabel(sale: SaleRecord | null | undefined): string {
  if (sale?.branch_name) return sale.branch_name
  const itemBranchNames = [...new Set((Array.isArray(sale?.items) ? sale.items : []).map((item) => String(item?.branch_name || '')).filter(Boolean))]
  if (itemBranchNames.length === 1) return itemBranchNames[0]
  if (itemBranchNames.length > 1) return 'Multiple branches'
  return ''
}

function buildSaleExportRows(rows: SaleRecord[] = []): Array<Record<string, unknown>> {
  return buildSalesImportRows(rows.map((sale) => ({ ...sale, branch_name: getSaleBranchLabel(sale) })))
}

export default function Sales({ embedded = false }: { embedded?: boolean }) {
  const { t, settings, fmtUSD, fmtKHR, notify, user, can } = useApp()
  // Part 557 slice 2: 'sales' is a view-tier section. A View-only grant reads
  // the list/stats/reports/export but every write (cancel, change status, edit
  // customer, import) is hidden here and refused by the backend. Full only.
  const canChangeSaleStatus = can('sales', 'status')
  const canChangeSaleCustomer = can('sales', 'customer')
  // S4-24b: adding goods to a recorded sale is its own grant -- it moves
  // stock and raises what the customer owes, so it is not covered by the
  // section tier and is not the same act as changing a status. The Worker
  // enforces the identical `sales -> add_items` action at Full tier; this
  // client check only decides whether the surface is offered at all.
  const canAddSaleItems = can('sales', 'add_items')
  // S4-30: amending is deliberately a SEPARATE grant from add_items. Adding a
  // forgotten item and taking one back off a paid sale are different levels of
  // trust, and a shop may well want to give one without the other. The Worker
  // enforces the identical `sales -> amend` action at Full tier; this client
  // check only decides whether the controls are offered at all.
  const canAmendSales = can('sales', 'amend')
  const canImportSales = can('sales', 'import')
  const canExportSales = can('sales', 'export')
  const canViewFees = can('fees', 'view')
  // Returning straight from the receipt is still a RETURNS write, so it is
  // gated on the returns section's own create action -- the same
  // `returns:add` grant behind the Returns page's Add Return button and the
  // same one routes/returns.ts enforces on POST /api/returns.
  const canAddReturn = can('returns', 'add')
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('sales')
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [salesFiltersOpen, setSalesFiltersOpen] = useState(false)
  const [userOptionsLoaded, setUserOptionsLoaded] = useState(false)
  // ONE date scope for the whole page (user, Aug 31: "drive list + stats
  // together"): the Start→End range row above the search bar drives BOTH the
  // stats strip AND the receipts list — there is no separate hidden Period
  // filter. Receipts initially show all time; quick ranges are chosen inside
  // the opened date/time picker rather than silently pre-filtering to Today.
  const [stripRange, setStripRange] = useState<DateTimeRange>(() => ({ ...EMPTY_DATE_TIME_RANGE }))
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  // The by-day report moved out to its own top-level Reports hub section
  // (ReportsHub.tsx); Sales now shows only the receipts list.
  // 11.1/11.2 (B6): same selection model as Products/Inventory -- checkboxes
  // only exist while something is selected; a long-press on a row/card
  // enters select mode; the desktop column-header checkbox is select-all.
  // Ends automatically once the last item is deselected.
  const selectionModeActive = selectedIds.size > 0
  // One long-press slot per visible row, keyed by sale id -- same reasoning
  // as Products.tsx/Inventory.tsx: SalesListSurface renders rows inside a
  // .map(), not as mounted components, so the mutable state lives here.
  const saleLongPressStateByRowIdRef = useRef<Map<number, LongPressState>>(new Map())
  const getSaleLongPressState = useCallback((rowId: number): LongPressState => {
    const existing = saleLongPressStateByRowIdRef.current.get(rowId)
    if (existing) return existing
    const created = createLongPressState()
    saleLongPressStateByRowIdRef.current.set(rowId, created)
    return created
  }, [])
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null)
  // The sale a Return was started for, from the detail modal or the receipt
  // view. Holds the sale itself so the prefill can fall back to its id when
  // a legacy row carries no receipt number.
  const [returnForSale, setReturnForSale] = useState<SaleRecord | null>(null)
  const [detailSale, setDetailSale] = useState<SaleRecord | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bulkStatusSaving, setBulkStatusSaving] = useState('')
  // Cancel dialog (Part 383): who is being cancelled and how the confirm
  // routes -- 'single' feeds handleStatusChange with the collected
  // reason/fee payload, 'bulk' feeds handleBulkStatusUpdate.
  const [cancelPrompt, setCancelPrompt] = useState<
    | { mode: 'single'; saleId: number; notes: string; recordHistory: boolean; label: string }
    | { mode: 'bulk'; count: number }
    | null
  >(null)
  const [cancelSaving, setCancelSaving] = useState(false)
  // S4-2 status confirmation: what is about to change, before it changes.
  // 'single' re-enters handleStatusChange with confirmed=true, 'bulk' does
  // the same for handleBulkStatusUpdate. `skipStock` (admin + unlock) rides
  // back as the request's skip_stock flag.
  const [statusPrompt, setStatusPrompt] = useState<
    | { mode: 'single'; saleId: number; newStatus: string; notes: string; recordHistory: boolean; label: string; fromLabel: string; movesStock: boolean; alreadySkipped: boolean }
    | { mode: 'bulk'; nextStatus: string; count: number; label: string; fromLabel: string; mixed: boolean; movesStock: boolean; alreadySkipped: boolean }
    | null
  >(null)
  const [statusConfirmSaving, setStatusConfirmSaving] = useState(false)
  // Group-by dropped (user, Aug 31: "the group by seems a bit redundant
  // with the arrange by") — the list always groups by day; sorting by a
  // non-date field flattens it. Kept as a const so the grouping pipeline
  // below reads unchanged.
  const salesGroupMode: SalesGroupMode = 'time'
  // Unified sort (listSort.ts): field + direction, folded into the Filters
  // menu (Part 549), persisted per page. When the field is 'date' the
  // existing time-section pipeline runs unchanged; any other field renders
  // a flat sorted list (time grouping has no meaning under a by-total
  // ordering).
  const [salesSortSpec, setSalesSortSpec] = useState<SortSpec>(() => loadSortSpec(
    'sales:sort',
    { field: 'date', direction: 'desc' },
    SALES_SORT_FIELD_DEFS as unknown as ReadonlyArray<SortField<unknown>>,
  ))
  useEffect(() => { saveSortSpec('sales:sort', salesSortSpec) }, [salesSortSpec])
  const salesSortDirection: SortDirection = salesSortSpec.field === 'date' ? salesSortSpec.direction : 'desc'
  const [salesPage, setSalesPage] = useState(1)
  const [salesPageSize, setSalesPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [collapsedSalesSections, setCollapsedSalesSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const salesStatsRequestRef = useRef(0)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  // A filter/search change can arrive while the initial Sales request is
  // still in flight. Returning that older promise without scheduling the
  // newer query leaves the new text visible but only re-filters the stale
  // first page locally (historical receipts outside that page show "No data
  // found"). Products already uses the same one-slot trailing-load pattern:
  // coalesce bursts, then run once more with the latest callback/filters.
  const pendingLoadRef = useRef<{ silent: boolean } | null>(null)
  const latestLoadRef = useRef<((silent?: boolean) => Promise<void>) | null>(null)
  const loadWatchdogRef = useRef<number | undefined>(undefined)
  const statusActionRef = useRef<Set<string>>(new Set())
  const membershipActionRef = useRef<Set<string>>(new Set())
  const bulkStatusInFlightRef = useRef(false)
  const aliveRef = useRef(true)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })
  // 180ms, matching Products.tsx/POS.tsx/Inventory.tsx's shared canonical
  // debounce -- this used to be two separate values (a useDeferredValue of
  // the raw search string driving the local re-filter, plus an independent
  // hand-rolled 350ms setState-in-a-useEffect debounce driving the server
  // fetch below), which produced the same "renders incrementally / narrows
  // then gets replaced" symptom Part 107 fixed on Products/POS: the local
  // list narrowed on ~every keystroke while the server response that
  // actually replaced it landed on a completely different, longer cadence.
  // One debounced value for both call sites closes that gap here too.
  const debouncedSearch = useDebouncedValue(search, 180)
  // Sales organize by DAY always (user, Aug 30: "for date in sales …
  // do date by year month and day") — the day label is the full
  // dd/mm/yyyy, so year+month+day all read off every section header
  // instead of the old bare-year buckets.
  const timeGroupingMode = 'day' as const
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    let permissions: Record<string, unknown> = {}
    try {
      permissions = typeof user?.permissions === 'string'
        ? JSON.parse(user.permissions || '{}') as Record<string, unknown>
        : (user?.permissions && typeof user.permissions === 'object' ? user.permissions as Record<string, unknown> : {})
    } catch {
      permissions = {}
    }
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])

  const cleanFallback = useCallback((fallbackEn: string, fallbackKm?: string) => {
    const candidate = fallbackKm || fallbackEn
    return isBrokenLocalizedString(String(candidate || '')) ? fallbackEn : candidate
  }, [])
  const translateOr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return settings?.language === 'km' ? cleanFallback(fallbackEn, fallbackKm) : fallbackEn
  }, [cleanFallback, settings?.language, t])
  // The list, its unbounded stats aggregate, and the strip all read this ONE
  // range now — so the receipts shown, the footer count, and the strip cards
  // always describe the same window.
  const salesDateRange = useMemo(() => {
    const startDate = String(stripRange.startDate || '').trim()
    const endDate = String(stripRange.endDate || '').trim()
    const startTime = String(stripRange.startTime || '').trim()
    const endTime = String(stripRange.endTime || '').trim()
    const out: { startDate?: string; endDate?: string; startTime?: string; endTime?: string } = {}
    if (startDate) out.startDate = startDate
    if (endDate) out.endDate = endDate
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      out.startTime = startTime
      out.endTime = endTime
    }
    return out
  }, [stripRange.endDate, stripRange.endTime, stripRange.startDate, stripRange.startTime])

  const clearLoadWatchdog = useCallback(() => {
    window.clearTimeout(loadWatchdogRef.current)
    loadWatchdogRef.current = undefined
  }, [])

  const loadSales = useCallback(async (silent = false): Promise<void> => {
    if (loadPromiseRef.current) {
      const pending = pendingLoadRef.current || { silent: true }
      pending.silent = pending.silent && silent
      pendingLoadRef.current = pending
      return loadPromiseRef.current
    }
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (!silent && aliveRef.current) {
        setLoading(true)
        setLoadError(null)
        clearLoadWatchdog()
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
            setLoadError(translateOr('sales_load_slow', 'Sales are taking longer than expected. Tap Refresh or revisit the page in a moment.'))
          }, 15000)
        }
      }
      try {
        const params = {
          ...(isAdmin && userFilter !== 'all' ? { userId: userFilter } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...salesDateRange,
          page: salesPage,
          limit: salesPageSize,
          sortBy: salesSortSpec.field,
          sortDir: salesSortSpec.direction,
        }
        const result = await withLoaderTimeout(() => fetchSales(params), 'Sales', 20000)
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const rows = normalizeSaleRows(result)
        if (rows.length || Array.isArray(result)) {
          setSales(rows)
          loadedOnceRef.current = true
          setLoadError(null)
        }
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
        console.error('[Sales] load failed:', getErrorMessage(error, 'Unknown sales load error'))
        if (!silent && !loadedOnceRef.current) {
          setLoadError(getErrorMessage(error, translateOr('sales_load_failed', 'Failed to load sales')))
        } else if (!silent) {
          setLoadError(translateOr('sales_refresh_failed', 'Sales could not refresh right now. Showing the latest loaded data.'))
        }
      } finally {
        clearLoadWatchdog()
        if (!silent && aliveRef.current && isTrackedRequestCurrent(loadRequestRef, requestId)) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
      const pending = pendingLoadRef.current
      if (pending) {
        pendingLoadRef.current = null
        queueMicrotask(() => {
          const nextLoad = latestLoadRef.current || loadSales
          nextLoad(Boolean(pending.silent)).catch(() => {})
        })
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [clearLoadWatchdog, debouncedSearch, isAdmin, salesDateRange, salesPage, salesPageSize, salesSortSpec.direction, salesSortSpec.field, statusFilter, translateOr, userFilter])

  useEffect(() => {
    latestLoadRef.current = loadSales
  }, [loadSales])

  // Unbounded revenue/count aggregate (see routes/sales.ts's /stats) --
  // `sales` above is capped at the list endpoint's page limit, so the
  // header figures below read from this instead of reducing over `sales`
  // directly once a filtered range has more matching rows than that cap.
  const [salesStats, setSalesStats] = useState<{ revenue_usd: number; pending_revenue_usd: number; total_count: number; revenue_count: number; truncated_in_list: boolean } | null>(null)

  // Z3a: the summary aggregate must refresh whenever a sale's status changes,
  // not only when a filter changes. Extracted into a callable so the sync
  // effect below (fired on 'sales'/'returns' events, which every status
  // mutation + return dispatches) can refetch it in lockstep with the row
  // list -- previously it went stale (a cancelled sale kept counting toward
  // the "N sales | $revenue" header until a filter change forced a refetch).
  const loadSalesStats = useCallback(async (): Promise<void> => {
    if (!isActive) return
    const requestId = beginTrackedRequest(salesStatsRequestRef)
    const params = {
      ...(isAdmin && userFilter !== 'all' ? { userId: userFilter } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...salesDateRange,
    }
    try {
      const result = await fetchSalesStats(params)
      if (!aliveRef.current || !isTrackedRequestCurrent(salesStatsRequestRef, requestId)) return
      const row = (result || {}) as Record<string, unknown>
      setSalesStats({
        revenue_usd: Number(row.revenue_usd) || 0,
        pending_revenue_usd: Number(row.pending_revenue_usd) || 0,
        total_count: Number(row.total_count) || 0,
        revenue_count: Number(row.revenue_count) || 0,
        truncated_in_list: Boolean(row.truncated_in_list),
      })
    } catch {
      if (!aliveRef.current || !isTrackedRequestCurrent(salesStatsRequestRef, requestId)) return
      setSalesStats(null)
    }
  }, [debouncedSearch, isActive, isAdmin, salesDateRange, statusFilter, userFilter])

  useEffect(() => {
    let cancelled = false
    void loadSalesStats().then(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [loadSalesStats])

  // The foldable stats strip (shared StatsStrip): range-scoped figures with
  // per-card breakdowns. It reads the SAME `stripRange` the list reads
  // (declared near the top), so the strip and the list always describe the
  // one date window — no second, independent range.
  type SalesStripPayload = {
    totals?: Record<string, number>
    by_payment?: Array<{ payment_method?: string; tx_count?: number; collected_usd?: number; total_usd?: number }>
    by_status?: Array<{ sale_status?: string; count?: number; total_usd?: number }>
    returns?: { count?: number; refund_usd?: number }
  }
  type FeesStripPayload = {
    totals?: { count?: number; amount_usd?: number; amount_khr?: number }
    by_type?: Array<{ fee_type?: string; count?: number; amount_usd?: number; amount_khr?: number }>
  }
  const [stripData, setStripData] = useState<SalesStripPayload | null>(null)
  const [feeStripData, setFeeStripData] = useState<FeesStripPayload | null>(null)
  const [stripLoading, setStripLoading] = useState(false)
  const stripRequestRef = useRef(0)
  const loadStatsStrip = useCallback(async (): Promise<void> => {
    if (!isActive) return
    if (!stripRange.startDate || !stripRange.endDate) {
      setStripData(null)
      setFeeStripData(null)
      setStripLoading(false)
      return
    }
    const requestId = beginTrackedRequest(stripRequestRef)
    setStripLoading(true)
    try {
      const [result, fees] = await Promise.all([
        getSalesStatsStrip({
          startDate: stripRange.startDate,
          endDate: stripRange.endDate,
          startTime: stripRange.startTime,
          endTime: stripRange.endTime,
        }),
        canViewFees
          ? getFeesReport({ startDate: stripRange.startDate, endDate: stripRange.endDate })
          : Promise.resolve(null),
      ])
      if (!aliveRef.current || !isTrackedRequestCurrent(stripRequestRef, requestId)) return
      setStripData((result || {}) as SalesStripPayload)
      setFeeStripData((fees || null) as FeesStripPayload | null)
    } catch {
      if (!aliveRef.current || !isTrackedRequestCurrent(stripRequestRef, requestId)) return
      setStripData(null)
      setFeeStripData(null)
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(stripRequestRef, requestId)) setStripLoading(false)
    }
  }, [canViewFees, isActive, stripRange.endDate, stripRange.endTime, stripRange.startDate, stripRange.startTime])
  useEffect(() => { void loadStatsStrip() }, [loadStatsStrip])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      invalidateTrackedRequest(salesStatsRequestRef)
      loadPromiseRef.current = null
      pendingLoadRef.current = null
      setLoading(false)
      return
    }
    aliveRef.current = true
    loadSales(loadedOnceRef.current)
  }, [clearLoadWatchdog, isActive, loadSales])

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
    if (!isActive || !syncChannel?.channel) return
    // Sales rows/reports expose current linked customer, courier, cashier and
    // product metadata in addition to immutable receipt snapshots. Those
    // reference routes broadcast their own channels, so refresh on the full
    // dependency set instead of waiting for the next sale mutation.
    if (['sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings'].includes(syncChannel.channel)) {
      if (syncChannel.channel === 'users') setUserOptionsLoaded(false)
      loadSales(true)
      void loadSalesStats() // Z3a: keep the summary aggregate in lockstep with the rows
      void loadStatsStrip() // the range strip counts the same events
    }
  }, [isActive, loadSales, loadSalesStats, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])
  useEffect(() => {
    if (!isActive || !isAdmin || !salesFiltersOpen || userOptionsLoaded) return
    let cancelled = false
    withLoaderTimeout(() => fetchUsers(), 'Sales user filters', SALES_USER_OPTIONS_TIMEOUT_MS)
      .then((rows) => {
        if (cancelled) return
        setUserOptions(normalizeUserOptions(rows))
        setUserOptionsLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setUserOptionsLoaded(false)
      })
    return () => {
      cancelled = true
    }
  }, [isActive, isAdmin, salesFiltersOpen, userOptionsLoaded])
  useEffect(() => () => {
    aliveRef.current = false
    clearLoadWatchdog()
    invalidateTrackedRequest(loadRequestRef)
    invalidateTrackedRequest(salesStatsRequestRef)
    loadPromiseRef.current = null
    pendingLoadRef.current = null
  }, [clearLoadWatchdog])

  const runSaleStatusMutation = useCallback((saleId: number | string, nextStatus: string, notes?: string, extra?: SaleCancelPayload | Record<string, unknown> | null) => (
    withLoaderTimeout(
      () => getSalesApi().updateSaleStatus(saleId, nextStatus, notes, extra || undefined),
      'Update sale status',
      SALES_STATUS_MUTATION_TIMEOUT_MS,
    )
  ), [])

  const runSaleMembershipMutation = useCallback((saleId: number | string, payload: SaleMembershipPayload) => (
    withLoaderTimeout(
      () => getSalesApi().attachSaleCustomer(saleId, payload),
      'Attach sale membership',
      SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS,
    )
  ), [])

  // `extra` also carries the Y10 payment payload when SaleDetailModal
  // completes an awaiting-payment sale (payment_method/amount_paid_*).
  const handleStatusChange = async (saleId: number | string, newStatus: string, notes = '', recordHistory = true, extra: SaleCancelPayload | Record<string, unknown> | null = null, confirmed = false): Promise<boolean> => {
    // View-only (Part 557): status changes are Full-Access only. The backend
    // already refuses these through sales.status, so this matching client
    // guard also honors a Full role whose one action was switched off.
    if (!canChangeSaleStatus) {
      notify?.(translateOr('perm_view_only_action', 'View only: you do not have permission to change sales.'), 'error')
      return false
    }
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    const previousSale = sales.find((entry) => Number(entry?.id || 0) === numericId)
    const previousStatus = previousSale?.sale_status || 'completed'
    // Cancelling needs its reason (+ optional lost fee) -- the backend
    // refuses without one. First entry opens the dialog; the dialog calls
    // back in with `extra` filled. Undo (recordHistory=false, back to the
    // previous status) is an UN-cancel and needs no reason; redo carries
    // the original extra through its closure.
    if (newStatus === 'cancelled' && previousStatus !== 'cancelled' && !extra) {
      setCancelPrompt({
        mode: 'single',
        saleId: numericId,
        notes,
        recordHistory,
        label: String(previousSale?.receipt_number || `#${numericId}`),
      })
      return false
    }
    // S4-2: the confirmation is a real dialog now, not window.confirm --
    // it has to show the old status and the new one, and carry the
    // admin-only "Don't touch stock" lock. Same shape as the cancel prompt
    // above: first entry opens it and returns, the dialog calls back with
    // confirmed=true (and skip_stock folded into `extra` when the admin
    // unlocked and ticked it). An undo/redo replay (recordHistory=false)
    // and the already-collected cancel payload skip the dialog, exactly as
    // the old window.confirm did.
    if (recordHistory && !extra && !confirmed) {
      setStatusPrompt({
        mode: 'single',
        saleId: numericId,
        newStatus,
        notes,
        recordHistory,
        label: String(previousSale?.receipt_number || `#${numericId}`),
        fromLabel: getStatusLabel(previousStatus, t),
        movesStock: transitionMovesStock(previousStatus, newStatus),
        alreadySkipped: Number(previousSale?.stock_skipped || 0) === 1,
      })
      return false
    }
    const actionKey = String(numericId)
    if (!beginKeyedAction(statusActionRef, actionKey)) return false
    try {
      await runSaleStatusMutation(saleId, newStatus, notes, extra)
      notify(`${t('status_updated') || 'Status updated'}: ${getStatusLabel(newStatus, t)}`)
      await loadSales(true)
      void loadSalesStats() // Z3a: refresh the summary aggregate immediately, not only via the sync round-trip
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      if (recordHistory && previousSale && previousStatus !== newStatus) {
        actionHistory.pushAction({
          label: `Update sale ${previousSale.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}`,
          undo: () => handleStatusChange(saleId, previousStatus, 'Undo sale status update', false),
          redo: () => handleStatusChange(saleId, newStatus, notes || 'Redo sale status update', false, extra),
        })
      }
      return true
    } catch (error) {
      if (isWriteConflict(error)) {
        await loadSales()
        return false
      }
      notify(`Failed to update status: ${getErrorMessage(error, String(error || 'Unknown error'))}`, 'error')
      return false
    } finally {
      finishKeyedAction(statusActionRef, actionKey)
    }
  }

  // S4-24b: add product lines to a sale that already exists. The server does
  // all the deciding (which statuses accept a line, how much stock moves,
  // which lots, what the new totals are) and records its own undoable
  // action_history row with a REAL payload, so there is deliberately no
  // pushAction here: a client-side entry would be a duplicate row whose undo
  // closure dies on reload, while the server row's Undo survives it. The
  // history bar is refreshed so that row appears immediately.
  const handleAddSaleItems = async (saleId: number | string, items: SaleItemAddition[]): Promise<boolean> => {
    if (!canAddSaleItems) {
      notify?.(translateOr('perm_view_only_action', 'View only: you do not have permission to change sales.'), 'error')
      return false
    }
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId) || !items.length) return false
    try {
      const result = await withLoaderTimeout(
        () => getSalesApi().addSaleItems(saleId, items, ''),
        'Add items to sale',
        SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS,
      ) as { addedLines?: number; stockMoved?: boolean } | null
      const added = Number(result?.addedLines || items.length)
      // The outcome names what actually happened to STOCK, because that is
      // the part a shopkeeper cannot see from the receipt.
      notify(
        result?.stockMoved
          ? (translateOr('sale_items_added_stock', 'Added {n} item(s) to the sale and took them out of stock.') || '').replace('{n}', String(added))
          : (translateOr('sale_items_added_no_stock', 'Added {n} item(s) to the sale. Stock moves when the sale is completed.') || '').replace('{n}', String(added)),
      )
      await loadSales(true)
      void loadSalesStats()
      actionHistory.refreshServerItems()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      return true
    } catch (error) {
      if (isWriteConflict(error)) {
        await loadSales()
        return false
      }
      notify(
        `${translateOr('sale_items_add_failed', 'Could not add the items')}: ${getErrorMessage(error, String(error || 'Unknown error'))}`,
        'error',
      )
      return false
    }
  }

  // S4-30: amend a recorded sale. Like handleAddSaleItems above, the server
  // records its OWN audit trail -- an append-only ledger entry inside the same
  // atomic batch as the change -- so there is deliberately no pushAction here:
  // a client-side history entry would be a second, weaker record of the same
  // act, and its undo closure would die on reload.
  const handleAmendSale = async (saleId: number | string, request: SaleAmendmentRequest): Promise<boolean> => {
    if (!canAmendSales) {
      notify?.(translateOr('perm_view_only_action', 'View only: you do not have permission to change sales.'), 'error')
      return false
    }
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    try {
      const result = await withLoaderTimeout(
        () => getSalesApi().amendSale(saleId, request),
        'Amend sale',
        SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS,
      ) as { stockMoved?: boolean; unitsMoved?: number; stockSkipped?: boolean } | null
      // The outcome names what actually happened to STOCK, because that is the
      // part a shopkeeper cannot see from the receipt -- and a stock-skipped
      // sale says so explicitly rather than looking like a silent no-op.
      const units = Math.abs(Number(result?.unitsMoved) || 0)
      notify(
        result?.stockSkipped
          ? translateOr('sale_amended_no_stock_skipped', 'Sale updated. This sale was completed without moving stock, so stock was left alone.')
          : units > 0
            ? (translateOr('sale_amended_stock', 'Sale updated, and {n} unit(s) moved in stock.') || '').replace('{n}', String(units))
            : translateOr('sale_amended', 'Sale updated.'),
      )
      await loadSales(true)
      void loadSalesStats()
      actionHistory.refreshServerItems()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      return true
    } catch (error) {
      if (isWriteConflict(error)) {
        await loadSales()
        return false
      }
      notify(
        `${translateOr('sale_amend_failed', 'Could not update the sale')}: ${getErrorMessage(error, String(error || 'Unknown error'))}`,
        'error',
      )
      return false
    }
  }

  /**
   * The sale's amendment history, for the detail view's audit trail.
   *
   * Returns NULL when the history could not be fetched, and an empty array
   * only when the server really said there is none. The modal renders those
   * two differently on purpose: "could not load the history" and "this sale
   * was never amended" are opposite answers, and quietly showing the second
   * for the first would be the exact silent gap this feature exists to close.
   */
  const loadSaleAmendments = async (saleId: number | string): Promise<SaleAmendmentRow[] | null> => {
    try {
      const result = await getSalesApi().getSaleAmendments(saleId) as { entries?: SaleAmendmentRow[] } | null
      return Array.isArray(result?.entries) ? result.entries : []
    } catch {
      return null
    }
  }

  const handleAttachMembership = async (saleId: number | string, membershipNumber: string): Promise<boolean> => {
    // View-only (Part 557): linking a membership edits the sale's customer,
    // which the backend gates behind Full sales.customer access; refuse
    // client-side too, including an explicit action-off override.
    if (!canChangeSaleCustomer) {
      notify?.(translateOr('perm_view_only_action', 'View only: you do not have permission to change sales.'), 'error')
      return false
    }
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    const actionKey = String(numericId)
    if (!beginKeyedAction(membershipActionRef, actionKey)) return false
    const previousSale = sales.find((entry) => Number(entry?.id || 0) === numericId)
    const previousMembershipNumber = String(previousSale?.customer_membership_number || '').trim()
    const nextMembershipNumber = String(membershipNumber || '').trim()
    try {
      const device = getClientDeviceInfo()
      await runSaleMembershipMutation(saleId, {
        membershipNumber: nextMembershipNumber,
        userId: user?.id || null,
        userName: user?.name || null,
        device_name: device.deviceName || '',
        device_tz: device.deviceTz || '',
      })
      notify(translateOr('membership_attached_to_sale', 'Membership linked to sale'))
      await loadSales()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      if (previousSale && previousMembershipNumber.toLowerCase() !== nextMembershipNumber.toLowerCase()) {
        actionHistory.pushAction({
          label: `Link membership on sale ${previousSale.receipt_number || numericId}`,
          undo: async () => {
            const deviceInfo = getClientDeviceInfo()
            const payload = previousMembershipNumber
              ? {
                  membershipNumber: previousMembershipNumber,
                  userId: user?.id || null,
                  userName: user?.name || null,
                  device_name: deviceInfo.deviceName || '',
                  device_tz: deviceInfo.deviceTz || '',
                }
              : {
                  clearAssignment: true,
                  userId: user?.id || null,
                  userName: user?.name || null,
                  device_name: deviceInfo.deviceName || '',
                  device_tz: deviceInfo.deviceTz || '',
                }
            await runSaleMembershipMutation(saleId, payload)
            await loadSales(true)
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
          },
          redo: async () => {
            const deviceInfo = getClientDeviceInfo()
            await runSaleMembershipMutation(saleId, {
              membershipNumber: nextMembershipNumber,
              userId: user?.id || null,
              userName: user?.name || null,
              device_name: deviceInfo.deviceName || '',
              device_tz: deviceInfo.deviceTz || '',
            })
            await loadSales(true)
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
          },
        })
      }
      return true
    } catch (error) {
      if (isWriteConflict(error)) {
        await loadSales()
        return false
      }
      notify(getErrorMessage(error, translateOr('failed_to_attach_membership', 'Failed to link membership')), 'error')
      return false
    } finally {
      finishKeyedAction(membershipActionRef, actionKey)
    }
  }

  // "also has the returns button right in the sales receipt directly in
  // addition to being in returns section" (user, Sep 3 2026). Both receipt
  // surfaces -- the detail modal and the printable receipt view -- hand the
  // sale to the SAME returns/NewReturnModal the Returns section opens, with
  // the receipt number prefilled. Falls back to the sale id, which that
  // flow's own lookup accepts too.
  const startReturnForSale = useCallback((sale: SaleRecord | null): void => {
    if (!sale) return
    setDetailSale(null)
    setReturnForSale(sale)
  }, [])
  const returnBlockedReasonFor = useCallback((sale: SaleRecord | null): string => {
    const reason = getSaleReturnBlockReason(sale as { sale_status?: string | null; items?: unknown } | null)
    if (reason === 'cancelled') return translateOr('return_blocked_cancelled_sale', 'This sale was cancelled, so there is nothing to return.', 'ការលក់នេះត្រូវបានបោះបង់ ដូច្នេះគ្មានអ្វីត្រូវប្រគល់មកវិញទេ។')
    if (reason === 'fully_returned') return translateOr('return_blocked_fully_returned', 'Every item on this sale has already been returned.', 'ទំនិញទាំងអស់ក្នុងការលក់នេះ ត្រូវបានប្រគល់មកវិញរួចហើយ។')
    return ''
  }, [translateOr])

  // Search, status, date, cashier, sorting, and pagination are authoritative
  // on the server. Re-filtering a server page here used a different search
  // vocabulary (it cannot see current product brand/barcode joins) and could
  // hide valid rows that the database had deliberately returned.
  const filtered = sales

  const salesSortFields = useMemo<SortField<SaleRecord>[]>(() => {
    const labels: Record<string, string> = {
      date: translateOr('sort_by_date', 'Date', 'កាលបរិច្ឆេទ'),
      total: translateOr('sort_by_total', 'Total', 'សរុប'),
      customer: translateOr('customer', 'Customer', 'អតិថិជន'),
      cashier: translateOr('cashier', 'Cashier', 'អ្នកគិតលុយ'),
      status: translateOr('status', 'Status', 'ស្ថានភាព'),
      receipt: translateOr('receipt_number', 'Receipt #', 'លេខវិក្កយបត្រ'),
    }
    return SALES_SORT_FIELD_DEFS.map((field) => ({ ...field, label: labels[field.id] || field.id }))
  }, [translateOr])

  // Flat single-section shape (structurally what buildTimeActionSections
  // returns) for non-date sorts, where time grouping has no meaning.
  const buildSortedSection = useCallback((items: SaleRecord[]) => {
    const label = salesSortFields.find((field) => field.id === salesSortSpec.field)?.label || ''
    const ids = items.map((sale) => Number(sale?.id)).filter((id) => Number.isFinite(id))
    return [{
      id: 'sorted',
      label,
      ids,
      items,
      groups: [{ id: 'sorted:all', actionKey: 'all', label, ids, items, sortTime: 0, synthetic: true }],
    }]
  }, [salesSortFields, salesSortSpec.field])

  const allSalesSections = useMemo(
    () => salesSortSpec.field !== 'date'
      ? buildSortedSection(filtered)
      : buildTimeActionSections(filtered, {
        getDate: (sale) => sale?.created_at,
        getItemId: (sale) => Number(sale?.id),
        getActionKey: (sale) => sale?.sale_status || 'completed',
        getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
        // All-time day grouping: the actual date narrowing happens
        // server-side via salesDateRange, so the client grouper is never
        // asked to also filter by year/month (that Period picker is gone).
        year: 'all',
        month: 'all',
        timeMode: timeGroupingMode,
        groupMode: salesGroupMode,
        sortDirection: salesSortDirection,
      }),
    [buildSortedSection, filtered, salesGroupMode, salesSortDirection, salesSortFields, salesSortSpec, t, timeGroupingMode],
  )

  const allVisibleSales = useMemo(
    () => allSalesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [allSalesSections],
  )

  useEffect(() => {
    setSalesPage(1)
  }, [stripRange.startDate, stripRange.endDate, stripRange.startTime, stripRange.endTime, salesPageSize, salesSortSpec, search, statusFilter, userFilter])

  const totalSalesCount = salesStats?.total_count ?? allVisibleSales.length

  useEffect(() => {
    setSalesPage((current) => clampPage(current, totalSalesCount, salesPageSize))
  }, [salesPageSize, totalSalesCount])

  // GET /api/sales already returns exactly this database page. Slicing it a
  // second time made page 2 empty and was the original reason history beyond
  // the first server cap could never be reached.
  const pagedSales = allVisibleSales

  const salesSections = useMemo(
    () => salesSortSpec.field !== 'date'
      // Already flat-sorted upstream; the page slice keeps that order.
      ? buildSortedSection(pagedSales)
      : buildTimeActionSections(pagedSales, {
        getDate: (sale) => sale?.created_at,
        getItemId: (sale) => Number(sale?.id),
        getActionKey: (sale) => sale?.sale_status || 'completed',
        getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
        year: 'all',
        month: 'all',
        timeMode: timeGroupingMode,
        groupMode: salesGroupMode,
        sortDirection: salesSortDirection,
      }),
    [buildSortedSection, pagedSales, salesGroupMode, salesSortDirection, salesSortSpec.field, t, timeGroupingMode],
  )

  const visibleSales = useMemo(
    () => salesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [salesSections],
  )

  // Keep an already-open detail/print surface attached to the refreshed row
  // by stable sale id. Reference broadcasts can update cashier/customer/
  // courier/payment display fields while the modal is open; retaining the
  // object captured on the original click would leave that nested surface
  // stale even though the list behind it had refreshed correctly.
  useEffect(() => {
    const refreshOpen = (current: SaleRecord | null): SaleRecord | null => {
      if (!current) return current
      return visibleSales.find((sale) => Number(sale.id) === Number(current.id)) || current
    }
    setDetailSale(refreshOpen)
    setSelectedSale(refreshOpen)
  }, [visibleSales])

  const filteredIds = useMemo(
    () => normalizeFiniteIdsFrom(visibleSales, (sale) => sale.id),
    [visibleSales],
  )

  useEffect(() => {
    const validIds = new Set<number>(filteredIds)
    setSelectedIds((current) => pruneSelectionToVisibleIds(current, validIds))
  }, [filteredIds])

  useEffect(() => {
    const validIds = new Set<string>(salesSections.map((section) => section.id))
    setCollapsedSalesSections((current) => pruneSelectionToVisibleIds(current, validIds))
  }, [salesSections])

  const selectedSales = useMemo(
    () => visibleSales.filter((sale) => selectedIds.has(Number(sale.id))),
    [selectedIds, visibleSales],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredIds.length
  }, [filteredIds.length, selectedIds.size])

  const stripCards = useMemo<StatCardDef[]>(() => {
    const totals = (stripData?.totals || {}) as Record<string, number>
    const byStatus = stripData?.by_status || []
    const byPayment = stripData?.by_payment || []
    const stripReturns = stripData?.returns || {}
    const txCount = Number(totals.tx_count) || 0
    const revenueUsd = Number(totals.revenue_usd) || 0
    const returnCount = Number(stripReturns.count) || 0
    const refundUsd = Number(stripReturns.refund_usd) || 0
    const cogsUsd = Number(totals.cost_usd) || 0
    const profitUsd = Number(totals.profit_usd) || 0
    const storeDeliveryUsd = Number(totals.store_delivery_usd) || 0
    const feeTotals = feeStripData?.totals || {}
    const expensesUsd = Number(feeTotals.amount_usd) || 0
    const expensesKhr = Number(feeTotals.amount_khr) || 0
    const expenseValue = [
      expensesUsd > 0 ? fmtUSD(expensesUsd) : '',
      expensesKhr > 0 ? fmtKHR(expensesKhr) : '',
    ].filter(Boolean).join(' · ') || fmtUSD(0)
    const topPayment = byPayment[0]
    const cards: StatCardDef[] = [
      {
        key: 'sales',
        label: t('sales') || 'Sales',
        value: String(txCount),
        sub: txCount > 0 ? `${translateOr('stats_avg_sale', 'avg')} ${fmtUSD(Number(totals.avg_order_usd) || 0)}` : undefined,
        hint: translateOr('stats_sales_hint', 'Completed and delivery sales in the range (cancelled and awaiting-payment excluded from money figures). The breakdown counts every status, including those two.'),
        details: byStatus.map((row) => ({
          label: getStatusLabel(String(row.sale_status || 'completed'), t),
          value: `${Number(row.count) || 0} · ${fmtUSD(Number(row.total_usd) || 0)}`,
        })),
      },
      {
        key: 'revenue',
        label: t('revenue') || 'Revenue',
        value: fmtUSD(revenueUsd),
        tone: 'accent',
        hint: translateOr('stats_revenue_hint', 'Net revenue = gross sales minus store and membership discounts (before tax and delivery). Collected = what actually changed hands including tax and customer-paid delivery.'),
        details: [
          { label: translateOr('stats_gross', 'Gross sales'), value: fmtUSD(Number(totals.gross_sales_usd) || 0) },
          { label: translateOr('stats_store_discount', 'Store discount'), value: fmtUSD(Number(totals.store_discount_usd) || 0), tone: 'warn' as const },
          { label: translateOr('stats_member_discount', 'Member discount'), value: fmtUSD(Number(totals.membership_discount_usd) || 0), tone: 'warn' as const },
          { label: translateOr('stats_tax', 'Tax'), value: fmtUSD(Number(totals.tax_usd) || 0) },
          { label: translateOr('stats_delivery_fees', 'Delivery fees'), value: fmtUSD(Number(totals.delivery_usd) || 0) },
          { label: translateOr('stats_collected', 'Collected'), value: fmtUSD(Number(totals.collected_total_usd) || 0), tone: 'ok' as const },
        ],
      },
      {
        key: 'cogs',
        label: t('cogs') || 'COGS',
        value: fmtUSD(cogsUsd),
        tone: cogsUsd > 0 ? ('warn' as const) : undefined,
        hint: translateOr('stats_cogs_hint', 'Cost of the products sold in this range, using the recorded cost on each sale line.'),
        details: [
          { label: t('cogs') || 'COGS', value: fmtUSD(cogsUsd) },
          { label: t('revenue') || 'Revenue', value: fmtUSD(revenueUsd) },
          { label: t('gross_profit') || 'Gross profit', value: fmtUSD(profitUsd), tone: profitUsd < 0 ? ('crit' as const) : ('ok' as const) },
        ],
      },
      {
        key: 'profit',
        label: t('gross_profit') || 'Gross Profit',
        value: fmtUSD(profitUsd),
        tone: profitUsd < 0 ? ('crit' as const) : ('ok' as const),
        sub: revenueUsd > 0 ? `${((profitUsd / revenueUsd) * 100).toFixed(1)}% ${translateOr('profit_margin_short', 'margin')}` : undefined,
        hint: translateOr('stats_profit_hint', 'Gross profit = net revenue − COGS − store-paid delivery.'),
        details: [
          { label: t('revenue') || 'Revenue', value: fmtUSD(revenueUsd) },
          { label: t('cogs') || 'COGS', value: fmtUSD(cogsUsd), tone: 'warn' as const },
          { label: translateOr('store_paid_delivery', 'Store-paid delivery'), value: fmtUSD(storeDeliveryUsd), tone: storeDeliveryUsd > 0 ? ('warn' as const) : undefined },
          { label: t('gross_profit') || 'Gross profit', value: fmtUSD(profitUsd), tone: profitUsd < 0 ? ('crit' as const) : ('ok' as const) },
        ],
      },
      {
        key: 'payments',
        label: translateOr('stats_payments', 'Payments'),
        value: topPayment ? String(topPayment.payment_method || 'Unknown') : '—',
        sub: topPayment ? `${Number(topPayment.tx_count) || 0} · ${fmtUSD(Number(topPayment.collected_usd) || 0)}` : undefined,
        hint: translateOr('stats_payments_hint', 'Money collected per payment method, including customer-paid delivery fees. The card shows the top method for the range.'),
        details: byPayment.map((row) => ({
          label: String(row.payment_method || 'Unknown'),
          value: `${Number(row.tx_count) || 0} · ${fmtUSD(Number((row as Record<string, unknown>).collected_usd) || 0)}`,
        })),
      },
      {
        key: 'returns',
        label: t('returns') || 'Returns',
        value: String(returnCount),
        sub: returnCount > 0 ? fmtUSD(refundUsd) : undefined,
        tone: returnCount > 0 ? ('warn' as const) : undefined,
        hint: translateOr('stats_returns_hint', 'Customer returns created in the range (cancelled returns excluded). Refunds here are not subtracted from the Revenue card — Revenue matches the Dashboard for the same range.'),
        details: [
          { label: t('returns') || 'Returns', value: String(returnCount) },
          { label: translateOr('stats_refunded', 'Refunded'), value: fmtUSD(refundUsd), tone: returnCount > 0 ? ('crit' as const) : undefined },
        ],
      },
    ]
    if (canViewFees) {
      cards.push({
        key: 'expenses',
        label: t('fees') || 'Expenses',
        value: expenseValue,
        tone: expensesUsd > 0 || expensesKhr > 0 ? ('warn' as const) : undefined,
        hint: translateOr('stats_expenses_hint', 'Expenses booked by date in this range. They are kept separate from gross profit so the accounting basis stays explicit.'),
        details: (feeStripData?.by_type || []).map((row) => ({
          label: String(row.fee_type || 'Other'),
          value: [
            Number(row.amount_usd) > 0 ? fmtUSD(Number(row.amount_usd)) : '',
            Number(row.amount_khr) > 0 ? fmtKHR(Number(row.amount_khr)) : '',
          ].filter(Boolean).join(' · ') || fmtUSD(0),
          tone: 'warn' as const,
        })),
      })
    }
    return cards
  }, [canViewFees, feeStripData, fmtKHR, fmtUSD, stripData, t, translateOr])

  // A sale "counts" toward the headline figures only when it contributes to
  // the money shown: cancelled and awaiting-payment sales are excluded from
  // revenue, so they must be excluded from the "N sales" count too (user,
  // Aug 31: "count only what the money counts"). Those rows still render in
  // the list — they just don't inflate the count.
  const isCountedSale = useCallback((sale: SaleRecord) => !['cancelled', 'awaiting_payment'].includes(String(sale?.sale_status || 'completed')), [])

  const revenue = salesStats
    ? salesStats.revenue_usd
    : filtered.filter(isCountedSale).reduce((sum, sale) => sum + (sale.net_total_usd ?? sale.total_usd ?? 0), 0)

  // The headline count must reconcile with `revenue`: count only the sales
  // that contribute to it, so the footer never reads "12 sales | $67.47" when
  // only 6 of those 12 produced the $67.47.
  const revenueCount = salesStats?.revenue_count
    ?? filtered.filter(isCountedSale).length

  const toggleSelected = (saleId: number | string) => {
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set<number>())
      return
    }
    setSelectedIds(new Set<number>(filteredIds))
  }

  const toggleSelectionScope = useCallback((ids: Array<number | string>, checked: boolean) => {
    const normalized = normalizeFiniteIds(ids)
    setSelectedIds((current) => toggleIdSet(current, normalized, checked))
  }, [])

  const toggleSalesSection = useCallback((sectionId: string) => {
    setCollapsedSalesSections((current) => {
      const next = new Set<string>(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const isSelectionScopeFullySelected = useCallback(
    (ids: Array<number | string> = []) => {
      const normalized = normalizeFiniteIds(ids)
      return normalized.length > 0 && countSelectedIds(normalized, selectedIds) === normalized.length
    },
    [selectedIds],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids: Array<number | string> = []) => {
      const normalized = normalizeFiniteIds(ids)
      const selectedCount = countSelectedIds(normalized, selectedIds)
      return selectedCount > 0 && selectedCount < normalized.length
    },
    [selectedIds],
  )

  // H1+X5 (Part 401): every export scope opens the shared options dialog
  // (column chooser remembered per page, CSV / Excel / PDF) instead of an
  // immediate fixed-column download. Rows are built to the sales contract
  // ONCE when the dialog opens, so the chooser lists exactly the columns
  // the file will carry (incl. C4's staff-only actual delivery cost).
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  const openExportOptions = useCallback((scopeRows: SaleRecord[], baseName: string) => {
    if (!canExportSales) {
      notify(translateOr('perm_view_only_action', 'You do not have permission to export sales.'), 'error')
      return
    }
    if (!scopeRows.length) {
      notify(t('no_data_to_export') || 'No data to export', 'error')
      return
    }
    setExportDialog({ rows: buildSaleExportRows(scopeRows), baseName })
  }, [canExportSales, notify, t, translateOr])

  const handleExportSelected = useCallback(() => {
    openExportOptions(selectedSales, 'sales-selected')
  }, [openExportOptions, selectedSales])

  const applySaleStatusEntries = useCallback(async (entries: SaleStatusEntry[] = [], notes = '', extra: SaleCancelPayload | Record<string, unknown> | null = null) => {
    const statusRun = await runConcurrentTasks<SaleStatusEntry, number>(entries, async (entry: SaleStatusEntry) => {
      const saleId = Number(entry?.id || 0)
      const nextStatus = String(entry?.status || '').trim()
      if (!saleId || !nextStatus) throw new Error('Invalid sale status entry')
      // The cancel payload only belongs on entries that actually cancel --
      // a mixed undo batch (back to varied previous statuses) must not
      // send a reason with an un-cancel.
      await runSaleStatusMutation(saleId, nextStatus, notes, nextStatus === 'cancelled' ? extra : null)
      return saleId
    })
    const failedIds = statusRun.failures
      .map((entry: { item?: SaleStatusEntry }) => Number(entry.item?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)
    const updatedIds = statusRun.successes
      .map((entry: { value?: number; item?: SaleStatusEntry }) => Number(entry.value || entry.item?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)

    await loadSales(true)
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))

    return {
      done: updatedIds.length,
      failed: failedIds.length,
      failedIds,
      updatedIds,
    }
  }, [loadSales, runSaleStatusMutation])

  const handleBulkStatusUpdate = async (nextStatus: string, extra: SaleCancelPayload | Record<string, unknown> | null = null, confirmed = false) => {
    // View-only (Part 557): bulk status writes share sales.status with single
    // status changes, including the per-action override.
    if (!canChangeSaleStatus) {
      notify?.(translateOr('perm_view_only_action', 'View only: you do not have permission to change sales.'), 'error')
      return
    }
    if (!selectedSales.length || !beginSingleAction(bulkStatusInFlightRef, { blocked: !!bulkStatusSaving })) return
    // Bulk-cancel needs the shared reason first -- one dialog for the
    // whole batch (lost fees stay per-sale and are not offered here).
    if (nextStatus === 'cancelled' && !extra) {
      finishSingleAction(bulkStatusInFlightRef)
      setCancelPrompt({ mode: 'bulk', count: selectedSales.length })
      return
    }
    // S4-2: a BULK status flip is exactly what deducted 9 already-counted
    // units on Sep 3 2026 -- it used to apply the moment the button was
    // pressed, with no confirmation at all. It now goes through the same
    // dialog as a single change, which states the before/after and offers
    // the admin-only "Don't touch stock" lock for the whole batch.
    if (!confirmed && !extra) {
      const distinctStatuses = Array.from(new Set(selectedSales.map((sale) => String(sale.sale_status || 'completed'))))
      finishSingleAction(bulkStatusInFlightRef)
      setStatusPrompt({
        mode: 'bulk',
        nextStatus,
        count: selectedSales.length,
        label: translateOr('sale_status_confirm_count', '{n} sales', 'ការលក់ {n}').replace('{n}', String(selectedSales.length)),
        fromLabel: distinctStatuses.map((status) => getStatusLabel(status, t)).join(', '),
        mixed: distinctStatuses.length > 1,
        // "Can this batch move stock at all" -- true if ANY selected sale's
        // own transition crosses the held() line.
        movesStock: distinctStatuses.some((status) => transitionMovesStock(status, nextStatus)),
        // Only meaningful when the whole batch is already outside the stock
        // ledger; a mixed batch still moves stock for the rest.
        alreadySkipped: selectedSales.length > 0 && selectedSales.every((sale) => Number(sale.stock_skipped || 0) === 1),
      })
      return
    }
    const previousStatuses = selectedSales.map((sale) => ({
      id: Number(sale.id),
      status: sale.sale_status || 'completed',
    }))
    setBulkStatusSaving(nextStatus)
    try {
      const nextEntries = previousStatuses.map((entry) => ({ id: entry.id, status: nextStatus }))
      const { done, failed, failedIds, updatedIds } = await applySaleStatusEntries(nextEntries, '', extra)
      setSelectedIds(new Set<number>(failedIds))
      const undoEntries = previousStatuses.filter((entry) => updatedIds.includes(entry.id))
      if (done > 0 && undoEntries.length) {
        actionHistory.pushAction({
          label: `Update ${done} sale${done === 1 ? '' : 's'} to ${getStatusLabel(nextStatus, t)}`,
          undo: () => applySaleStatusEntries(undoEntries, 'Undo bulk sale status update'),
          redo: () => applySaleStatusEntries(undoEntries.map((entry) => ({ id: entry.id, status: nextStatus })), 'Redo bulk sale status update', extra),
        })
      }
      notify(
        failed
          ? `Updated ${done} sales, ${failed} failed.`
          : `Updated ${done} sale${done === 1 ? '' : 's'} to ${getStatusLabel(nextStatus, t)}.`,
        failed ? 'warning' : 'success',
      )
    } finally {
      finishSingleAction(bulkStatusInFlightRef)
      setBulkStatusSaving('')
    }
  }

  const exportVisibleSales = useCallback(async (rows: SaleRecord[] = filtered, filePrefix = 'sales-visible') => {
    openExportOptions(rows, filePrefix)
  }, [filtered, openExportOptions])

  const salesExportItems = useMemo<Array<PortalMenuItem | null | false>>(() => canExportSales ? ([
    { label: translateOr('export_visible_sales', 'Export visible sales', 'នាំចេញការលក់ដែលកំពុងបង្ហាញ'), onClick: () => exportVisibleSales(filtered, 'sales-visible') },
    selectedSales.length ? { label: translateOr('export_selected_sales', 'Export selected sales', 'នាំចេញការលក់ដែលបានជ្រើស'), onClick: handleExportSelected, color: 'blue' } : null,
    statusFilter !== 'all' ? { label: translateOr('export_filtered_status', `Export ${getStatusLabel(statusFilter, t)}`, `នាំចេញតាមស្ថានភាព ${getStatusLabel(statusFilter, t)}`), onClick: () => exportVisibleSales(filtered, `sales-${statusFilter}`) } : null,
    (stripRange.startDate || stripRange.endDate) ? { label: translateOr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportVisibleSales(filtered, 'sales-filtered') } : null,
    'divider',
    { label: translateOr('export_detailed_sales_report', 'Detailed sales report', 'របាយការណ៍លម្អិតការលក់'), onClick: () => setShowExport(true), color: 'green' },
  ].filter(Boolean) as Array<PortalMenuItem | null | false>) : [], [canExportSales, exportVisibleSales, filtered, handleExportSelected, stripRange.startDate, stripRange.endDate, selectedSales.length, statusFilter, t, translateOr])

  const salesFilterSections = useMemo(() => ([
    {
      id: 'status',
      label: t('status') || 'Status',
      options: [
        { id: 'all', label: t('all_statuses') || 'All statuses', active: statusFilter === 'all', onClick: () => setStatusFilter('all') },
        ...ALL_STATUSES.map((status) => ({
          id: status,
          label: getStatusLabel(status, t),
          active: isMultiActive(statusFilter, status),
          onClick: () => setStatusFilter(toggleMultiValue(statusFilter, status)),
        })),
      ],
    },
    isAdmin ? {
      id: 'user',
      label: t('user') || 'User',
      searchable: true,
      options: [
        { id: 'all', label: t('all_users') || 'All users', active: userFilter === 'all', onClick: () => setUserFilter('all') },
        ...userOptions.map((option) => {
          const id = String(option?.id || '')
          return {
            id: `user-${id}`,
            label: option?.name || option?.username || `User ${id}`,
            active: isMultiActive(userFilter, id),
            onClick: () => setUserFilter(toggleMultiValue(userFilter, id)),
          }
        }).filter((option) => option.id !== 'user-'),
      ],
    } : null,
    // Sort folds INTO this menu (user, Aug 31: "the arrange by can be
    // folded into filter menu") — the toolbar keeps only Search + Scan +
    // Filters. Date/Total are the two meaningful orderings; Cashier stays a
    // FILTER (the 'user' section above), never a sort ("same for cashier").
    {
      id: 'sort',
      label: translateOr('sort', 'Sort', 'តម្រៀប'),
      options: [
        { id: 'date-desc', label: translateOr('sort_newest_first', 'Newest first', 'ថ្មីៗមុន'), active: salesSortSpec.field === 'date' && salesSortSpec.direction === 'desc', onClick: () => setSalesSortSpec({ field: 'date', direction: 'desc' }) },
        { id: 'date-asc', label: translateOr('sort_oldest_first', 'Oldest first', 'ចាស់ៗមុន'), active: salesSortSpec.field === 'date' && salesSortSpec.direction === 'asc', onClick: () => setSalesSortSpec({ field: 'date', direction: 'asc' }) },
        { id: 'total-desc', label: translateOr('sort_total_high', 'Total: high → low', 'សរុប៖ ច្រើន → តិច'), active: salesSortSpec.field === 'total' && salesSortSpec.direction === 'desc', onClick: () => setSalesSortSpec({ field: 'total', direction: 'desc' }) },
        { id: 'total-asc', label: translateOr('sort_total_low', 'Total: low → high', 'សរុប៖ តិច → ច្រើន'), active: salesSortSpec.field === 'total' && salesSortSpec.direction === 'asc', onClick: () => setSalesSortSpec({ field: 'total', direction: 'asc' }) },
      ],
    },
    // The Period date filter is gone from this menu: the Start→End range row
    // above the search bar (StatsRangeRow → stripRange) is the single date
    // scope now and drives the list directly, so a second date control here
    // would just be a way to disagree with it (user, Aug 31).
  ].filter(Boolean)), [isAdmin, salesSortSpec, statusFilter, t, translateOr, userFilter, userOptions])

  const activeSalesFilterCount = useMemo(
    () => countActiveFlags([statusFilter !== 'all', userFilter !== 'all', !(salesSortSpec.field === 'date' && salesSortSpec.direction === 'desc')]),
    [salesSortSpec.direction, salesSortSpec.field, statusFilter, userFilter],
  )
  // Group-by-status is gone (Part 549) — the list always groups by day.
  const showSalesActionGroups = false

  if (selectedSale) {
    return (
      <Suspense fallback={null}>
        <Receipt
          sale={selectedSale}
          settings={settings || undefined}
          onClose={() => setSelectedSale(null)}
          // The receipt view is a full-screen replacement for this page, so
          // starting a return has to leave it first -- the return modal
          // renders in the list tree below.
          onReturn={canAddReturn ? () => { setSelectedSale(null); startReturnForSale(selectedSale) } : undefined}
          returnLabel={t('return') || 'Return'}
          returnDisabledReason={returnBlockedReasonFor(selectedSale)}
        />
      </Suspense>
    )
  }
  if (loadError && !loading && !sales.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => loadSales(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className={`${embedded ? '' : 'page-scroll '}flex flex-col px-3 pb-3 pt-0 sm:px-6 sm:pb-6 sm:pt-0`}>
      {/* Import/Manage/History action row. The Sales daily/reports view moved
          out to its own top-level Reports hub section (ReportsHub.tsx), so
          Sales now shows only the receipts list. Import/Export each take an
          equal share of the row (flex-1); Manage folds Import + Export into
          one dropdown (same pattern Products.tsx uses), History before Manage,
          matching Products' ordering. */}
      {/* The stats strip leads the page: range row (with History + the ONE
          Manage menu folding Import/Export — "export history and stats can
          be in one manage button") then the mini stat cards. The old
          standalone action row and the centered pagination row are gone;
          the pager now rides the sticky search row below. */}
      <StatsStrip
        // Keep a clear visual breath after the Sales hub's section tabs;
        // without this, the first stats row reads as part of the title row.
        className="mt-3 mb-4"
        cards={stripCards}
        loading={stripLoading}
        t={t}
        // No `summary` beside the Stats chip on Sales: the outside "N sales ·
        // $revenue" duplicated the strip's own Sales + Revenue cards (user,
        // Aug 31: "the outside stats is redundant with the stat in the stat
        // button"). Open the Stats chip to see the same figures.
        // History + Manage are SECONDARY controls that stay on the Stats-chip
        // row whether the strip is folded or open — expanding the strip no
        // longer relocates them (user, Aug 31).
        rangeActions={(
          <>
            {/* dense: pin History to a true 32px so it matches the h-8 Manage
                button beside it on the Stats row (btn-secondary's 40px
                min-height would otherwise make it taller). */}
            <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} t={t} className="min-w-0" dense />
            {canImportSales || canExportSales ? <LazyPortalMenu
              align="auto"
              menuClassName="max-h-[70vh] overflow-auto"
              trigger={(
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                  aria-haspopup="true"
                  aria-label={translateOr('manage', 'Manage')}
                  title={translateOr('manage', 'Manage')}
                >
                  <Settings2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{translateOr('manage', 'Manage')}</span>
                </button>
              )}
              items={([
                // Import writes sales, so it is Full-Access only (Part 557);
                // Export stays a read and is always offered.
                ...(canImportSales
                  ? [
                      { label: translateOr('import', 'Import'), onClick: () => setShowImport(true), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
                      'divider' as const,
                    ]
                  : []),
                ...(salesExportItems || [])
                  .filter((item): item is PortalMenuItem => Boolean(item))
                  .map((item) => (item === 'divider' ? item : { ...item, icon: item.icon ?? <Upload className="h-4 w-4 shrink-0" /> })),
              ] as PortalMenuItem[])}
            /> : null}
          </>
        )}
      />

      {/* Search bar and bulk-action bar pin to the top of the page's scroll
          container while scrolling (Aug 11 2026 UI-polish request, same
          treatment as Products.tsx/Inventory.tsx). Grouped into ONE sticky
          wrapper so there's no need to hand-compute a per-element `top`
          offset to stack them without overlapping -- previously the
          bulk-action bar was independently sticky below a non-sticky
          search row, which pinned the bar but let the search box scroll
          away. Pagination now lives above this group instead of below it,
          matching Products/Inventory's order. */}
      <div className="sticky top-0 z-30 -mx-1 space-y-1.5 bg-gray-50/95 pb-2 pt-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        {/* The Start→End range that scopes the stats strip above now leads
            this pinned toolbar as its own row, directly above the search bar
            (user, Aug 31: "fish out the start date and end date from the stats
            button ... right above the search bar row"). Same range state
            (stripRange) still feeds the strip's cards. */}
        <StatsRangeRow className="pt-1" range={stripRange} onRangeChange={setStripRange} t={t} showTime />
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            id="sales-search"
            name="sales_search"
            value={search}
            onChange={setSearch}
            placeholder={t('search_sales_placeholder') || 'Search divide by comma, any order: receipt number, customer name, products name, barcode/sku, brand, mem id'}
            ariaLabel={t('search') || 'Search sales'}
          />
          {/* Placeholder above already advertises barcode/sku as a
              searchable field -- same capability Products.tsx/Inventory.tsx/
              POS.tsx expose a camera-scan shortcut for. Added here (and to
              Returns.tsx) to match; same onDetected={setSearch} wiring. */}
          <ScanSearchButton onDetected={setSearch} t={(key: string) => t(key) || key} />
          {/* Sort folded into the Filters menu (Part 549) — the toolbar is
              just Search + Scan + Filters now. */}
          <FilterMenu
            label={t('filters') || 'Filters'}
            activeCount={activeSalesFilterCount}
            sections={salesFilterSections}
            onOpenChange={setSalesFiltersOpen}
            onClear={() => {
              setStatusFilter('all')
              setUserFilter('all')
              setSalesSortSpec({ field: 'date', direction: 'desc' })
            }}
            mobileIconOnly
          />
        </div>

      </div>

      {selectedSales.length > 0 ? (
          <div className="bulk-toolbar mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm shadow-sm">
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{selectedSales.length}</span>
            {canExportSales ? <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={handleExportSelected}>{translateOr('export', 'Export')}</button> : null}
            {/* Bulk status writes are Full-Access only (Part 557): View-only
                keeps selection for Export, but the status buttons are hidden. */}
            {canChangeSaleStatus ? (
              <>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('completed')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'completed' ? translateOr('saving', 'Saving...') : translateOr('done', 'Done')}</button>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('awaiting_delivery')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'awaiting_delivery' ? translateOr('saving', 'Saving...') : translateOr('pos_delivery', 'Delivery')}</button>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('cancelled')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'cancelled' ? translateOr('saving', 'Saving...') : translateOr('cancel', 'Cancel')}</button>
              </>
            ) : null}
            <button type="button" className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700/60 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set<number>())}>
              {translateOr('clear', 'Clear')}
            </button>
          </div>
        ) : null}

      {/* Pagination on its own row directly BELOW the search row (user,
          Aug 31: "page back and forth ... below the search bar row"), matching
          Returns/Fees in this hub — never on the date row or the search row
          itself. The list's own footer keeps its pager too. */}
      <div className="mb-3 flex justify-center">
        <PaginationControls
          compact
          rangeAsPageSize
          page={salesPage}
          pageSize={salesPageSize}
          totalItems={totalSalesCount}
          label={t('sales') || 'sales'}
          t={t}
          onPageChange={setSalesPage}
          onPageSizeChange={(size) => {
            setSalesPageSize(size)
            setSalesPage(1)
          }}
        />
      </div>


      <SalesListSurface
        collapsedSalesSections={collapsedSalesSections}
        filtered={filtered}
        filteredIds={filteredIds}
        fmtKHR={fmtKHR}
        // Each section already carries the calendar date. Keep row timestamps
        // to the business-time clock; the clicked detail modal still shows
        // the complete date and time via fmtTime.
        fmtTime={fmtClock24}
        fmtUSD={fmtUSD}
        getSaleBranchLabel={getSaleBranchLabel as SalesListSurfaceProps['getSaleBranchLabel']}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        loading={loading}
        revenue={revenue}
        revenueCount={revenueCount}
        isCountedSale={isCountedSale as SalesListSurfaceProps['isCountedSale']}
        salesSections={salesSections as SalesListSurfaceProps['salesSections']}
        selectAllRef={selectAllRef as SalesListSurfaceProps['selectAllRef']}
        selectedIds={selectedIds}
        selectionModeActive={selectionModeActive}
        getSaleLongPressState={getSaleLongPressState}
        setDetailSale={(sale) => setDetailSale(sale as SaleRecord)}
        setSelectedSale={(sale) => setSelectedSale(sale as SaleRecord)}
        showSalesActionGroups={showSalesActionGroups}
        t={t}
        toggleSalesSection={toggleSalesSection}
        toggleSelected={toggleSelected}
        toggleSelectAll={toggleSelectAll}
        toggleSelectionScope={toggleSelectionScope}
      />

      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={SALES_IMPORT_COLUMNS.map((key) => ({ key, label: exportColumnLabel(key) }))}
            rows={exportDialog.rows}
            rememberKey="sales"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}

      {detailSale ? (
        <Suspense fallback={null}>
          <SaleDetailModal
            sale={detailSale}
            settings={settings}
            onClose={() => setDetailSale(null)}
            // View-only (Part 557): omit the write callbacks so the modal hides
            // its status buttons and membership form entirely.
            onStatusChange={canChangeSaleStatus ? handleStatusChange : undefined}
            onAttachMembership={canChangeSaleCustomer ? handleAttachMembership : undefined}
            // Same hide-by-omission gate as the other write callbacks: without
            // `sales:add_items` the prop is absent and the whole Add-items
            // section never renders.
            onAddItems={canAddSaleItems ? handleAddSaleItems : undefined}
            // Hide-by-omission, the same gate every other write callback on
            // this modal uses. The HISTORY read is not gated here -- anyone who
            // can open the sale can see how it got that way (the Worker
            // gates it on read access), so it is passed unconditionally.
            onAmend={canAmendSales ? handleAmendSale : undefined}
            onLoadAmendments={loadSaleAmendments}
            onPrint={(sale) => setSelectedSale(sale as SaleRecord)}
            // Gated exactly like the write callbacks above: without
            // `returns:add` the prop is omitted and the action never renders.
            onReturn={canAddReturn ? (sale) => startReturnForSale(sale as SaleRecord) : undefined}
            t={t}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
          />
        </Suspense>
      ) : null}

      {returnForSale ? (
        <Suspense fallback={null}>
          <NewReturnModal
            initialReceiptQuery={returnForSale.receipt_number || String(returnForSale.id || '')}
            onClose={() => setReturnForSale(null)}
            onSuccess={async () => {
              // NewReturnModal already raises its own success notice (it is
              // the one that knows whether a replacement sale was created),
              // so this only has to refresh what the return changed.
              setReturnForSale(null)
              await loadSales(true)
              void loadSalesStats()
              window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
              window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
              window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
            }}
            fmtUSD={fmtUSD}
            notify={notify as (message: string, kind?: string) => void}
          />
        </Suspense>
      ) : null}

      {statusPrompt ? (
        <Suspense fallback={null}>
          <SaleStatusConfirmModal
            label={statusPrompt.label}
            fromLabel={statusPrompt.fromLabel}
            toLabel={getStatusLabel(statusPrompt.mode === 'single' ? statusPrompt.newStatus : statusPrompt.nextStatus, t)}
            mixed={statusPrompt.mode === 'bulk' ? statusPrompt.mixed : false}
            movesStock={statusPrompt.movesStock}
            // Admin only, both here and in the Worker (isAdminControlUser).
            canSkipStock={isAdmin}
            alreadySkipped={statusPrompt.alreadySkipped}
            saving={statusConfirmSaving}
            onClose={() => { if (!statusConfirmSaving) setStatusPrompt(null) }}
            onConfirm={async (skipStock) => {
              if (!statusPrompt || statusConfirmSaving) return
              // skip_stock only ever leaves here when an admin unlocked and
              // ticked it; the Worker refuses it for anyone else with a 403
              // rather than quietly performing a stock-moving transition.
              const skipExtra = skipStock ? { skip_stock: true } : null
              setStatusConfirmSaving(true)
              try {
                if (statusPrompt.mode === 'single') {
                  await handleStatusChange(statusPrompt.saleId, statusPrompt.newStatus, statusPrompt.notes, statusPrompt.recordHistory, skipExtra, true)
                } else {
                  await handleBulkStatusUpdate(statusPrompt.nextStatus, skipExtra, true)
                }
                setStatusPrompt(null)
              } finally {
                setStatusConfirmSaving(false)
              }
            }}
            t={t}
          />
        </Suspense>
      ) : null}

      {cancelPrompt ? (
        <Suspense fallback={null}>
          <CancelSaleModal
            label={cancelPrompt.mode === 'single'
              ? cancelPrompt.label
              : translateOr('cancel_sales_count', `${cancelPrompt.count} sales`, `ការលក់ ${cancelPrompt.count}`)}
            bulk={cancelPrompt.mode === 'bulk'}
            saving={cancelSaving}
            onClose={() => { if (!cancelSaving) setCancelPrompt(null) }}
            onConfirm={async (payload) => {
              if (!cancelPrompt || cancelSaving) return
              setCancelSaving(true)
              try {
                if (cancelPrompt.mode === 'single') {
                  await handleStatusChange(cancelPrompt.saleId, 'cancelled', cancelPrompt.notes, cancelPrompt.recordHistory, payload)
                } else {
                  await handleBulkStatusUpdate('cancelled', payload)
                }
                setCancelPrompt(null)
              } finally {
                setCancelSaving(false)
              }
            }}
            t={t}
          />
        </Suspense>
      ) : null}

      {showExport && canExportSales ? (
        <Suspense fallback={null}>
          <ExportModal onClose={() => setShowExport(false)} t={t} fmtUSD={fmtUSD} />
        </Suspense>
      ) : null}

      {showImport && canImportSales ? (
        <Suspense fallback={null}>
          <SalesImportModal
            onClose={() => setShowImport(false)}
            onDone={() => {
              setShowImport(false)
              loadSales()
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
