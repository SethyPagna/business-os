import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentProps } from 'react'
import { toggleMultiValue, isMultiActive, matchesMulti } from '../../utils/multiSelect'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import { buildProductSearchTerms } from '../../utils/searchTerms.ts'
import { matchesSearchTermGroups } from '../../utils/searchMatch.ts'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { fmtTime } from '../../utils/formatters'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import PaginationControls, { clampPage, paginateItems, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import type { SaleCancelPayload } from './CancelSaleModal'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { pruneSelectionToVisibleIds } from '../../utils/rowSelection.ts'
import { createLongPressState, type LongPressState } from '../../utils/longPress.ts'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import { buildPeriodFilterOptions } from '../../utils/periodFilterOptions.ts'
import { beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { getSales as fetchSales, getSalesStats as fetchSalesStats } from '../../api/salesTransport.ts'
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
const ExportModal = lazyRetry(() => import('./ExportModal'), 'sales-export-modal')
const SalesImportModal = lazyRetry(() => import('./SalesImportModal'), 'sales-import')
const SalesDailyReport = lazyRetry(() => import('./SalesDailyReport'), 'sales-daily-report')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'sales-export-options')
import SalesListSurface from './SalesListSurface'
import { TOOLBAR_BUTTON_WIDTH, manageToolbarButtonClassName } from '../shared/toolbarButtonStyles'
import { buildSalesImportRows, SALES_IMPORT_COLUMNS } from '../../utils/salesImportContract.ts'
import { exportColumnLabel } from '../../utils/exportOptions.ts'

const SALES_USER_OPTIONS_TIMEOUT_MS = 8000
const SALES_STATUS_MUTATION_TIMEOUT_MS = 12000
const SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS = 12000

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

interface SalesApi {
  updateSaleStatus: (saleId: number | string, status: string, notes?: string, extra?: Record<string, unknown>) => Promise<unknown>
  attachSaleCustomer: (saleId: number | string, payload: SaleMembershipPayload) => Promise<unknown>
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

export default function Sales() {
  const { t, settings, fmtUSD, fmtKHR, notify, user } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('sales')
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [salesFiltersOpen, setSalesFiltersOpen] = useState(false)
  const [userOptionsLoaded, setUserOptionsLoaded] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  // X2 (Part 395): the page has two views -- the receipts list, and the
  // by-day report (range-scoped day rows, click a day for its breakdown).
  const [salesView, setSalesView] = useState<'receipts' | 'daily'>('receipts')
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
  const [salesGroupMode, setSalesGroupMode] = useState<SalesGroupMode>('time')
  const [salesSortDirection, setSalesSortDirection] = useState<SortDirection>('desc')
  const [salesPage, setSalesPage] = useState(1)
  const [salesPageSize, setSalesPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [collapsedSalesSections, setCollapsedSalesSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
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
  const timeGroupingMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
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
  const salesDateRange = useMemo(() => {
    if (yearFilter === 'all') return {}
    const year = Number(yearFilter)
    if (!Number.isFinite(year)) return {}
    const month = monthFilter !== 'all' ? Number(monthFilter) : null
    if (month && Number.isFinite(month)) {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 0))
      return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      }
    }
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    }
  }, [monthFilter, yearFilter])

  const clearLoadWatchdog = useCallback(() => {
    window.clearTimeout(loadWatchdogRef.current)
    loadWatchdogRef.current = undefined
  }, [])

  const loadSales = useCallback(async (silent = false): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
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
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [clearLoadWatchdog, debouncedSearch, isAdmin, salesDateRange, statusFilter, translateOr, userFilter])

  // Unbounded revenue/count aggregate (see routes/sales.ts's /stats) --
  // `sales` above is capped at the list endpoint's page limit, so the
  // header figures below read from this instead of reducing over `sales`
  // directly once a filtered range has more matching rows than that cap.
  const [salesStats, setSalesStats] = useState<{ revenue_usd: number; pending_revenue_usd: number; total_count: number; truncated_in_list: boolean } | null>(null)

  // Z3a: the summary aggregate must refresh whenever a sale's status changes,
  // not only when a filter changes. Extracted into a callable so the sync
  // effect below (fired on 'sales'/'returns' events, which every status
  // mutation + return dispatches) can refetch it in lockstep with the row
  // list -- previously it went stale (a cancelled sale kept counting toward
  // the "N sales | $revenue" header until a filter change forced a refetch).
  const loadSalesStats = useCallback(async (): Promise<void> => {
    if (!isActive) return
    const params = {
      ...(isAdmin && userFilter !== 'all' ? { userId: userFilter } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...salesDateRange,
    }
    try {
      const result = await fetchSalesStats(params)
      const row = (result || {}) as Record<string, unknown>
      setSalesStats({
        revenue_usd: Number(row.revenue_usd) || 0,
        pending_revenue_usd: Number(row.pending_revenue_usd) || 0,
        total_count: Number(row.total_count) || 0,
        truncated_in_list: Boolean(row.truncated_in_list),
      })
    } catch {
      setSalesStats(null)
    }
  }, [debouncedSearch, isActive, isAdmin, salesDateRange, statusFilter, userFilter])

  useEffect(() => {
    let cancelled = false
    void loadSalesStats().then(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [loadSalesStats])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
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
    if (syncChannel.channel === 'sales' || syncChannel.channel === 'returns') {
      loadSales(true)
      void loadSalesStats() // Z3a: keep the summary aggregate in lockstep with the rows
    }
  }, [isActive, loadSales, loadSalesStats, syncChannel?.channel, syncChannel?.ts])
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
    loadPromiseRef.current = null
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
  const handleStatusChange = async (saleId: number | string, newStatus: string, notes = '', recordHistory = true, extra: SaleCancelPayload | Record<string, unknown> | null = null): Promise<boolean> => {
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
    const actionKey = String(numericId)
    if (!beginKeyedAction(statusActionRef, actionKey)) return false
    if (recordHistory && !extra) {
      const warningText = ['cancelled', 'awaiting_payment', 'completed', 'awaiting_delivery'].includes(newStatus)
        ? translateOr('confirm_sale_status_change_stock', `Change sale ${previousSale?.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}? This can change stock totals.`)
        : translateOr('confirm_sale_status_change', `Change sale ${previousSale?.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}?`)
      if (!window.confirm(warningText)) {
        finishKeyedAction(statusActionRef, actionKey)
        return false
      }
    }
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

  const handleAttachMembership = async (saleId: number | string, membershipNumber: string): Promise<boolean> => {
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

  const availableYears = useMemo(
    () => getAvailableYears(sales, (sale) => sale?.created_at),
    [sales],
  )

  // Comma-separated groups, same syntax/tokenizer Products.tsx/POS.tsx use
  // (buildProductSearchTerms) and the same syntax routes/sales.ts's
  // buildSalesSearchWhere now parses server-side (tokenizeSearchTermGroups)
  // -- built from `debouncedSearch`, not raw `search`, so this local
  // re-filter settles on the same cadence as the server fetch below (see
  // debouncedSearch's own comment for the bug this fixes).
  const searchTerms = useMemo(() => buildProductSearchTerms(debouncedSearch), [debouncedSearch])
  // Year/month narrowing happens downstream in buildTimeActionSections (see
  // allSalesSections below, which is given `year`/`month` directly) -- this
  // filter only ever checks status and search text, so monthFilter/
  // yearFilter were never read here. Keeping them out of the dependency
  // list avoids recomputing (and reallocating) this array on every date
  // filter change for no behavioral difference.
  const filtered = useMemo(() => sales.filter((sale) => {
    if (!matchesMulti(statusFilter, sale.sale_status || 'completed')) return false
    if (!searchTerms.length) return true
    // Mirrors routes/sales.ts's buildSalesSearchWhere as closely as this
    // page's already-loaded data allows: every flat sale-level column it
    // searches (now including customer_phone, missing from this haystack
    // before even though the server already searched it -- a pre-existing
    // gap, not something this session's backend change introduced) plus
    // each line item's product_name/sku. Deliberately NOT barcode/brand --
    // GET /api/sales only returns raw sale_items columns to the client
    // (see SaleItemRecord), and neither column lives on sale_items itself
    // (both are snapshotted on products, joined in only inside the
    // server's own search query) -- so a barcode/brand search still
    // narrows correctly once the debounced server response lands, it just
    // can't narrow the *local* pre-response preview the same way a
    // receipt number or product name can. Same fuzzy/typo/diacritic/
    // alias-aware matcher (matchesSearchTermGroups) Products.tsx/POS.tsx/
    // Inventory.tsx already use, AND-only (no searchMode toggle exists on
    // this page yet, matching the server's own AND default).
    const items = Array.isArray(sale.items) ? sale.items : []
    const itemHaystack = items.map((item) => `${item?.product_name || ''} ${item?.sku || ''}`).join(' ')
    const haystack = `${sale.receipt_number || ''} ${sale.cashier_name || ''} ${sale.customer_name || ''} ${sale.customer_phone || ''} ${sale.payment_method || ''} ${sale.notes || ''} ${sale.customer_membership_number || ''} ${getSaleBranchLabel(sale) || ''} ${itemHaystack}`
    return matchesSearchTermGroups(haystack, searchTerms, 'AND')
  }), [sales, searchTerms, statusFilter])

  const allSalesSections = useMemo(
    () => buildTimeActionSections(filtered, {
      getDate: (sale) => sale?.created_at,
      getItemId: (sale) => Number(sale?.id),
      getActionKey: (sale) => sale?.sale_status || 'completed',
      getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
      year: yearFilter,
      month: monthFilter,
      timeMode: timeGroupingMode,
      groupMode: salesGroupMode,
      sortDirection: salesSortDirection,
    }),
    [filtered, monthFilter, salesGroupMode, salesSortDirection, t, timeGroupingMode, yearFilter],
  )

  const allVisibleSales = useMemo(
    () => allSalesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [allSalesSections],
  )

  useEffect(() => {
    setSalesPage(1)
  }, [monthFilter, salesGroupMode, salesPageSize, salesSortDirection, search, statusFilter, userFilter, yearFilter])

  useEffect(() => {
    setSalesPage((current) => clampPage(current, allVisibleSales.length, salesPageSize))
  }, [allVisibleSales.length, salesPageSize])

  const pagedSales = useMemo(
    () => paginateItems(allVisibleSales, salesPage, salesPageSize),
    [allVisibleSales, salesPage, salesPageSize],
  )

  const salesSections = useMemo(
    () => buildTimeActionSections(pagedSales, {
      getDate: (sale) => sale?.created_at,
      getItemId: (sale) => Number(sale?.id),
      getActionKey: (sale) => sale?.sale_status || 'completed',
      getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
      year: yearFilter,
      month: monthFilter,
      timeMode: timeGroupingMode,
      groupMode: salesGroupMode,
      sortDirection: salesSortDirection,
    }),
    [monthFilter, pagedSales, salesGroupMode, salesSortDirection, t, timeGroupingMode, yearFilter],
  )

  const visibleSales = useMemo(
    () => salesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [salesSections],
  )

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

  const revenue = salesStats
    ? salesStats.revenue_usd
    : filtered
        .filter((sale) => !['cancelled', 'awaiting_payment'].includes(sale.sale_status || 'completed'))
        .reduce((sum, sale) => sum + (sale.net_total_usd ?? sale.total_usd ?? 0), 0)

  const pendingRevenue = salesStats
    ? salesStats.pending_revenue_usd
    : filtered
        .filter((sale) => (sale.sale_status || 'completed') === 'awaiting_payment')
        .reduce((sum, sale) => sum + (sale.total_usd || 0), 0)

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
    if (!scopeRows.length) {
      notify(t('no_data_to_export') || 'No data to export', 'error')
      return
    }
    setExportDialog({ rows: buildSaleExportRows(scopeRows), baseName })
  }, [notify, t])

  const handleExportSelected = useCallback(() => {
    openExportOptions(selectedSales, 'sales-selected')
  }, [openExportOptions, selectedSales])

  const applySaleStatusEntries = useCallback(async (entries: SaleStatusEntry[] = [], notes = '', extra: SaleCancelPayload | null = null) => {
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

  const handleBulkStatusUpdate = async (nextStatus: string, extra: SaleCancelPayload | null = null) => {
    if (!selectedSales.length || !beginSingleAction(bulkStatusInFlightRef, { blocked: !!bulkStatusSaving })) return
    // Bulk-cancel needs the shared reason first -- one dialog for the
    // whole batch (lost fees stay per-sale and are not offered here).
    if (nextStatus === 'cancelled' && !extra) {
      finishSingleAction(bulkStatusInFlightRef)
      setCancelPrompt({ mode: 'bulk', count: selectedSales.length })
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

  const salesExportItems = useMemo<Array<PortalMenuItem | null | false>>(() => ([
    { label: translateOr('export_visible_sales', 'Export visible sales', 'នាំចេញការលក់ដែលកំពុងបង្ហាញ'), onClick: () => exportVisibleSales(filtered, 'sales-visible') },
    selectedSales.length ? { label: translateOr('export_selected_sales', 'Export selected sales', 'នាំចេញការលក់ដែលបានជ្រើស'), onClick: handleExportSelected, color: 'blue' } : null,
    statusFilter !== 'all' ? { label: translateOr('export_filtered_status', `Export ${getStatusLabel(statusFilter, t)}`, `នាំចេញតាមស្ថានភាព ${getStatusLabel(statusFilter, t)}`), onClick: () => exportVisibleSales(filtered, `sales-${statusFilter}`) } : null,
    yearFilter !== 'all' || monthFilter !== 'all' ? { label: translateOr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportVisibleSales(filtered, 'sales-filtered') } : null,
    'divider',
    { label: translateOr('export_detailed_sales_report', 'Detailed sales report', 'របាយការណ៍លម្អិតការលក់'), onClick: () => setShowExport(true), color: 'green' },
  ].filter(Boolean) as Array<PortalMenuItem | null | false>), [exportVisibleSales, filtered, handleExportSelected, monthFilter, selectedSales.length, statusFilter, t, translateOr, yearFilter])

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
    {
      id: 'grouping',
      label: translateOr('group_by', 'Group by', 'ដាក់ជាក្រុមតាម'),
      options: [
        { id: 'time', label: translateOr('group_by_time', 'Time only', 'ពេលវេលាប៉ុណ្ណោះ'), active: salesGroupMode === 'time', onClick: () => setSalesGroupMode('time') },
        { id: 'time-action', label: translateOr('group_by_time_action', 'Time + status', 'ពេលវេលា + ស្ថានភាព'), active: salesGroupMode === 'time+action', onClick: () => setSalesGroupMode('time+action') },
      ],
    },
    {
      id: 'sort',
      label: translateOr('sort', 'Sort', 'តម្រៀប'),
      searchable: true,
      options: [
        { id: 'desc', label: translateOr('newest_first', 'Newest first', 'ថ្មីបំផុតមុន'), active: salesSortDirection === 'desc', onClick: () => setSalesSortDirection('desc') },
        { id: 'asc', label: translateOr('oldest_first', 'Oldest first', 'ចាស់បំផុតមុន'), active: salesSortDirection === 'asc', onClick: () => setSalesSortDirection('asc') },
        ...buildPeriodFilterOptions({
          yearFilter, setYearFilter, monthFilter, setMonthFilter, availableYears,
          allTimeLabel: translateOr('all_time', 'All time', 'គ្រប់ពេលវេលា'),
        }),
      ],
    },
  ].filter(Boolean)), [availableYears, isAdmin, monthFilter, salesGroupMode, salesSortDirection, statusFilter, t, translateOr, userFilter, userOptions, yearFilter])

  const activeSalesFilterCount = useMemo(
    () => countActiveFlags([statusFilter !== 'all', userFilter !== 'all', yearFilter !== 'all', monthFilter !== 'all', salesGroupMode !== 'time', salesSortDirection !== 'desc']),
    [monthFilter, salesGroupMode, salesSortDirection, statusFilter, userFilter, yearFilter],
  )
  const showSalesActionGroups = salesGroupMode === 'time+action'

  if (selectedSale) {
    return (
      <Suspense fallback={null}>
        <Receipt sale={selectedSale} settings={settings || undefined} onClose={() => setSelectedSale(null)} />
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
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      {/* Merged toolbar row: Import/Export/History each take an equal share
          of the row's full width (flex-1 on all three, labels always
          visible) instead of icon-only buttons clustered on the left with
          dead space to the right -- same treatment as Inventory's toolbar.
          Kept above the search row (rather than below it) so the actions
          people reach for on page load -- Import, Export, History -- are
          the first thing in the flow, with search/filter right underneath. */}
      {/* Manage (Import + Export folded into one dropdown, same pattern
          Products.tsx uses) / History -- History before Manage, matching
          Products' ordering. */}
      <div className="mb-3 flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} t={t} className="min-w-0 flex-1" showLabel />
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName={`min-w-0 ${TOOLBAR_BUTTON_WIDTH}`}
          menuClassName="max-h-[70vh] overflow-auto"
          trigger={(
            <button
              type="button"
              // Was a hardcoded solid-blue button -- the only "Manage"
              // trigger in the app styled that way (Products.tsx/
              // HeaderActions.tsx and Inventory.tsx both use the shared
              // .btn-secondary white-card look for the identical action).
              // The blue read as a primary/destructive-adjacent call to
              // action next to History and confused people expecting the
              // same neutral affordance as every other page. Switched to
              // the shared class so Manage looks like Manage everywhere.
              // Now also pulls the actual sizing from
              // shared/toolbarButtonStyles.ts instead of its own
              // `w-full` (no desktop cap) -- this button used to keep
              // stretching to fill the row on large screens instead of
              // settling to Products' Manage button's compact width
              // (Aug 23 2026, "History/Manage/Product button sizing on
              // large screens").
              className={`w-full ${manageToolbarButtonClassName}`}
              aria-haspopup="true"
              aria-label={translateOr('manage', 'Manage')}
              title={translateOr('manage', 'Manage')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{translateOr('manage', 'Manage')}</span>
            </button>
          )}
          items={([
            { label: translateOr('import', 'Import'), onClick: () => setShowImport(true), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
            'divider' as const,
            ...(salesExportItems || [])
              .filter((item): item is PortalMenuItem => Boolean(item))
              .map((item) => (item === 'divider' ? item : { ...item, icon: item.icon ?? <Upload className="h-4 w-4 shrink-0" /> })),
          ] as PortalMenuItem[])}
        />
      </div>

      {/* X2: Receipts | Daily report view switch. The daily view carries its
          own range/time scope and totals, so the list-only chrome (search,
          filters, pagination, stats bar, bulk toolbar) hides with the list
          instead of sitting there doing nothing. */}
      <div className="mb-2 inline-flex rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          className={`rounded-[10px] px-3 py-1.5 transition ${salesView === 'receipts' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
          onClick={() => setSalesView('receipts')}
        >
          {t('receipts') || 'Receipts'}
        </button>
        <button
          type="button"
          className={`rounded-[10px] px-3 py-1.5 transition ${salesView === 'daily' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
          onClick={() => setSalesView('daily')}
        >
          {t('daily_report') || 'Daily report'}
        </button>
      </div>

      {salesView === 'daily' ? (
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <SalesDailyReport t={t} fmtUSD={fmtUSD} active />
        </Suspense>
      ) : null}

      {salesView === 'receipts' ? (
      <div className="mb-2 flex justify-end">
        <PaginationControls
          compact
          rangeAsPageSize
          page={salesPage}
          pageSize={salesPageSize}
          totalItems={allVisibleSales.length}
          label={t('sales') || 'sales'}
          t={t}
          onPageChange={setSalesPage}
          onPageSizeChange={(size) => {
            setSalesPageSize(size)
            setSalesPage(1)
          }}
        />
      </div>
      ) : null}

      {/* Search bar and bulk-action bar pin to the top of the page's scroll
          container while scrolling (Aug 11 2026 UI-polish request, same
          treatment as Products.tsx/Inventory.tsx). Grouped into ONE sticky
          wrapper so there's no need to hand-compute a per-element `top`
          offset to stack them without overlapping -- previously the
          bulk-action bar was independently sticky below a non-sticky
          search row, which pinned the bar but let the search box scroll
          away. Pagination now lives above this group instead of below it,
          matching Products/Inventory's order. */}
      {salesView === 'receipts' ? (
      <div className="sticky top-2 z-30 -mx-1 space-y-2 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex flex-wrap items-center gap-2 pt-1">
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
          <FilterMenu
            label={t('filters') || 'Filters'}
            activeCount={activeSalesFilterCount}
            sections={salesFilterSections}
            onOpenChange={setSalesFiltersOpen}
            onClear={() => {
              setStatusFilter('all')
              setUserFilter('all')
              setYearFilter('all')
              setMonthFilter('all')
              setSalesGroupMode('time')
              setSalesSortDirection('desc')
            }}
            mobileIconOnly
          />
        </div>

        {selectedSales.length > 0 ? (
          <div className="bulk-toolbar flex flex-wrap items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm shadow-sm">
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{selectedSales.length}</span>
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={handleExportSelected}>{translateOr('export', 'Export')}</button>
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('completed')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'completed' ? translateOr('saving', 'Saving...') : translateOr('done', 'Done')}</button>
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('awaiting_delivery')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'awaiting_delivery' ? translateOr('saving', 'Saving...') : translateOr('pos_delivery', 'Delivery')}</button>
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('cancelled')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'cancelled' ? translateOr('saving', 'Saving...') : translateOr('cancel', 'Cancel')}</button>
            <button type="button" className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700/60 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set<number>())}>
              {translateOr('clear', 'Clear')}
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {salesView === 'receipts' && filtered.length > 0 ? (
        <div className="mb-3 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-blue-50 px-4 py-2 text-sm dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{salesStats ? salesStats.total_count : filtered.length} {t('sales') || 'sales'}</span>
          <span className="text-gray-400">|</span>
          <span className="font-semibold text-blue-700 dark:text-blue-300">{fmtUSD(revenue)} {t('revenue')}</span>
          {salesStats?.truncated_in_list ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-gray-400 text-xs" title={t('sales_list_truncated_title') || 'More sales match this filter than are shown in the list below; totals above still cover all of them.'}>
                {t('sales_list_truncated') || 'showing a partial list'}
              </span>
            </>
          ) : null}
          {statusFilter === 'all' ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-green-600 dark:text-green-400">{filtered.filter((sale) => (sale.sale_status || 'completed') === 'completed').length} {t('summary_completed') || 'completed'}</span>
            </>
          ) : null}
          {pendingRevenue > 0 ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-yellow-600 dark:text-yellow-400" title={t('awaiting_payment_title') || 'Awaiting Payment not yet counted as revenue'}>
                {fmtUSD(pendingRevenue)} {t('summary_on_hold') || 'on hold'}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <p className="mb-2 text-xs text-gray-400">{t('click_for_details') || 'Click a row for details'}</p>

      {salesView === 'receipts' ? (
      <SalesListSurface
        collapsedSalesSections={collapsedSalesSections}
        filtered={filtered}
        filteredIds={filteredIds}
        fmtKHR={fmtKHR}
        fmtTime={fmtTime}
        fmtUSD={fmtUSD}
        getSaleBranchLabel={getSaleBranchLabel as SalesListSurfaceProps['getSaleBranchLabel']}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        loading={loading}
        revenue={revenue}
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
      ) : null}

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
            onStatusChange={handleStatusChange}
            onAttachMembership={handleAttachMembership}
            onPrint={(sale) => setSelectedSale(sale as SaleRecord)}
            t={t}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
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

      {showExport ? (
        <Suspense fallback={null}>
          <ExportModal onClose={() => setShowExport(false)} t={t} fmtUSD={fmtUSD} />
        </Suspense>
      ) : null}

      {showImport ? (
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
