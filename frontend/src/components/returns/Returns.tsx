import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Download from 'lucide-react/dist/esm/icons/download.js'
import { toggleMultiValue, isMultiActive, matchesMulti } from '../../utils/multiSelect'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import { buildProductSearchTerms } from '../../utils/searchTerms.ts'
import { matchesSearchTermGroups } from '../../utils/searchMatch.ts'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { fmtTime } from '../../utils/formatters'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import SortChip from '../shared/SortChip'
import { loadSortSpec, saveSortSpec, sortRecords, type SortField, type SortSpec } from '../../utils/listSort'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import InfoHint from '../shared/InfoHint.tsx'
import PaginationControls, { paginateItems } from '../shared/PaginationControls'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot } from '../../utils/historyHelpers.ts'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.ts'
import { createLongPressState, type LongPressState } from '../../utils/longPress.ts'
import { exportColumnLabel } from '../../utils/exportOptions.ts'
import { buildPeriodFilterOptions } from '../../utils/periodFilterOptions.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { pruneSelectionToVisibleIds } from '../../utils/rowSelection.ts'
import {
  getReturn as fetchReturnDetail,
  getReturns as fetchReturns,
  getReturnsReport,
} from '../../api/returnsReadTransport.ts'
import StatsStrip, { statsPresetRange, type StatCardDef } from '../shared/StatsStrip.tsx'
import type { DateTimeRange } from '../shared/DateTimeRangePicker'
import ReturnsListSurface from './ReturnsListSurface'
const ReturnDetailModal = lazyRetry(() => import('./ReturnDetailModal'), 'returns-detail-modal')
const EditReturnModal = lazyRetry(() => import('./EditReturnModal'), 'returns-edit-modal')
const NewReturnModal = lazyRetry(() => import('./NewReturnModal'), 'returns-new-modal')
const NewSupplierReturnModal = lazyRetry(() => import('./NewSupplierReturnModal'), 'returns-new-supplier-modal')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'returns-export-options')

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']
type ReturnsListSurfaceProps = ComponentProps<typeof ReturnsListSurface>
type ReturnsWriteTransportModule = typeof import('../../api/returnsTransport.ts')

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'
const RETURNS_LOAD_TIMEOUT_MS = 20000
const RETURNS_DETAIL_TIMEOUT_MS = 10000
const RETURNS_SNAPSHOT_TIMEOUT_MS = 10000
const RETURNS_HISTORY_RESTORE_TIMEOUT_MS = 15000

let returnsWriteTransportPromise: Promise<ReturnsWriteTransportModule> | null = null

function loadReturnsWriteTransport(): Promise<ReturnsWriteTransportModule> {
  if (!returnsWriteTransportPromise) returnsWriteTransportPromise = import('../../api/returnsTransport.ts')
  return returnsWriteTransportPromise
}

type ReturnScope = typeof CUSTOMER_SCOPE | typeof SUPPLIER_SCOPE
type ReturnGroupMode = 'time' | 'time+action'
type SortDirection = 'asc' | 'desc'

type TranslateFn = (key: string, fallbackEn?: string, fallbackKm?: string) => string

interface ReturnItem {
  sale_item_id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  quantity?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  return_to_stock?: boolean | null
  branch_id?: number | string | null
}

interface ReturnRow extends Record<string, unknown> {
  id: number | string
  return_number?: string | null
  return_scope?: string | null
  supplier_settlement?: string | null
  return_type?: string | null
  created_at?: string | null
  updated_at?: string | null
  receipt_number?: string | null
  cashier_name?: string | null
  customer_name?: string | null
  supplier_name?: string | null
  reason?: string | null
  notes?: string | null
  total_refund_usd?: number | string | null
  total_refund_khr?: number | string | null
  supplier_compensation_usd?: number | string | null
  supplier_loss_usd?: number | string | null
  status?: string | null
  branch_id?: number | string | null
  items?: ReturnItem[] | null
}

// The page's sort vocabulary (utils/listSort.ts) -- labels attached
// in-component. 'date' keeps the time-section pipeline; other fields flat.
const RETURN_SORT_FIELD_DEFS = [
  { id: 'date', kind: 'date' as const, get: (ret: ReturnRow) => ret?.created_at },
  { id: 'refund', kind: 'number' as const, get: (ret: ReturnRow) => ret?.total_refund_usd },
  { id: 'customer', kind: 'text' as const, get: (ret: ReturnRow) => ret?.customer_name || ret?.supplier_name },
  { id: 'processed_by', kind: 'text' as const, get: (ret: ReturnRow) => ret?.cashier_name },
  { id: 'type', kind: 'text' as const, get: (ret: ReturnRow) => ret?.return_type },
]

interface ReturnHistoryPayload extends Record<string, unknown> {
  reason: string
  return_type: string
  notes: string
  total_refund_usd: number | string
  total_refund_khr: number | string
  branch_id: number | string | null
  updated_at: string | null
  items: Array<{
    sale_item_id: number | string | null
    product_id: number | string | null
    product_name: string | null
    quantity: number | string
    applied_price_usd: number | string
    applied_price_khr: number | string
    cost_price_usd: number | string
    cost_price_khr: number | string
    return_to_stock: boolean
    branch_id: number | string | null
  }>
}

async function updateReturnRequest(id: number | string, payload: ReturnHistoryPayload): Promise<unknown> {
  const { updateReturn } = await loadReturnsWriteTransport()
  return updateReturn(id, payload)
}

interface ReturnMutation {
  kind?: string
  result?: ReturnRow | null
  previousSnapshot?: ReturnRow | null
  snapshot?: ReturnRow | null
  id?: number | string | null
}

interface ReturnGroup {
  id: string
  label: string
  ids: number[]
  items: ReturnRow[]
}

interface ReturnSection {
  id: string
  label: string
  ids: number[]
  groups: ReturnGroup[]
}

interface AppContextValue {
  // Per-action gate (utils/permissionActions.ts) -- the same table the
  // admin permission editor renders, so a control's visibility here always
  // matches what an admin was shown when granting the tier.
  can: (permissionKey: string, actionKey: string) => boolean
  t: (key: string) => string
  fmtUSD: (value: number | string | null | undefined) => string
  fmtKHR: (value: number | string | null | undefined) => string
  notify: (message: string, type?: string) => void
  user?: {
    id?: unknown
    name?: unknown
    username?: unknown
    role_code?: unknown
    permissions?: unknown
  } | null
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: number | string
  } | null
}

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function normalizeScope(value: unknown): ReturnScope {
  return value === SUPPLIER_SCOPE ? SUPPLIER_SCOPE : CUSTOMER_SCOPE
}

function getReturnTypeKey(ret?: ReturnRow | null): string {
  const scope = normalizeScope(ret?.return_scope)
  if (scope === SUPPLIER_SCOPE) return String(ret?.supplier_settlement || 'refund').trim().toLowerCase() || 'refund'
  return String(ret?.return_type || 'manual').trim().toLowerCase() || 'manual'
}

function getReturnTypeLabel(ret: ReturnRow | null | undefined, tr: TranslateFn): string {
  const scope = normalizeScope(ret?.return_scope)
  if (scope === SUPPLIER_SCOPE) {
    return ret?.supplier_settlement || tr('settlement_refund', 'refund')
  }
  return ret?.return_type || tr('manual_return', 'manual')
}

function normalizeFiniteIdsFrom<T>(items: T[] = [], getValue: (value: T) => unknown = (value: T) => value): number[] {
  return items.reduce<number[]>((normalized, item) => {
    const id = Number(getValue(item))
    if (Number.isFinite(id)) normalized.push(id)
    return normalized
  }, [])
}

function normalizeFiniteIds(ids: unknown[] = []): number[] {
  return normalizeFiniteIdsFrom(ids)
}

function countSelectedIds(ids: number[] = [], selectedIds: Set<number> = new Set()): number {
  let count = 0
  for (const id of ids) {
    if (selectedIds.has(id)) count += 1
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

function toNumericAmount(value: number | string | null | undefined): number {
  const numericValue = Number(value || 0)
  return Number.isFinite(numericValue) ? numericValue : 0
}

// H1+X5 (Part 402): the dialog's column list derives from this builder's own
// keys, so chooser and file can never disagree.
export const RETURN_EXPORT_KEYS = [
  'Return_Number', 'Scope', 'Date', 'Receipt', 'Customer', 'Supplier', 'Reason',
  'Type', 'Settlement', 'Refund_USD', 'Compensation_USD', 'Business_Loss_USD', 'Status',
] as const

function exportReturnRows(rows: ReturnRow[] = [], tr: TranslateFn): Array<Record<string, unknown>> {
  return rows.map((ret) => ({
    Return_Number: ret.return_number || '',
    Scope: normalizeScope(ret.return_scope),
    Date: ret.created_at || '',
    Receipt: ret.receipt_number || '',
    Customer: ret.customer_name || '',
    Supplier: ret.supplier_name || '',
    Reason: ret.reason || '',
    Type: getReturnTypeLabel(ret, tr),
    Settlement: ret.supplier_settlement || '',
    Refund_USD: ret.total_refund_usd || 0,
    Compensation_USD: ret.supplier_compensation_usd || 0,
    Business_Loss_USD: ret.supplier_loss_usd || 0,
    Status: ret.status || 'completed',
  }))
}

function getInitialReturnPageSize(): number {
  return 50
}


export default function Returns() {
  const { can, t, fmtUSD, fmtKHR, notify, user } = useApp()
  // Editing a return reverses and re-applies batch restocking against live
  // stock, so routes/returns.ts blocks it outright for the Review Required
  // tier (PATCH /:id) rather than queueing it -- see utils/permissionActions.ts.
  // Without this check the Edit button rendered for a review-tier user and
  // returned 403 on click. Creating a return is deliberately NOT gated here:
  // that tier is allowed to create directly, and the route has no extra check.
  const canEditReturn = can('returns', 'edit')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const cleanFallback = useCallback((fallbackEn: string, fallbackKm?: string): string => {
    const candidate = fallbackKm || fallbackEn
    return isBrokenLocalizedString(String(candidate || '')) ? fallbackEn : candidate
  }, [])
  const tr = useCallback<TranslateFn>((key, fallbackEn = key, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? cleanFallback(fallbackEn, fallbackKm) : fallbackEn
  }, [cleanFallback, isKhmer, t])
  const { syncChannel } = useSync()
  // E2: Returns renders as a SECTION of the Sales hub now -- activity is
  // 'am I on the sales page', same re-key AuditLog/Users/Backup got in E3/E4.
  const isActive = useIsPageActive('sales')
  const [scope, setScope] = useState<ReturnScope>(CUSTOMER_SCOPE)
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  // 11.1/11.2 (B6): same selection model as Products/Inventory/Sales --
  // checkboxes only exist while something is selected; long-press a
  // row/card to enter select mode; the desktop column-header checkbox is
  // select-all. Ends automatically once the last item is deselected.
  const selectionModeActive = selectedIds.size > 0
  const returnLongPressStateByRowIdRef = useRef<Map<number, LongPressState>>(new Map())
  const getReturnLongPressState = useCallback((rowId: number): LongPressState => {
    const existing = returnLongPressStateByRowIdRef.current.get(rowId)
    if (existing) return existing
    const created = createLongPressState()
    returnLongPressStateByRowIdRef.current.set(rowId, created)
    return created
  }, [])
  const [detailRet, setDetailRet] = useState<ReturnRow | null>(null)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editRet, setEditRet] = useState<ReturnRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [returnGroupMode, setReturnGroupMode] = useState<ReturnGroupMode>('time')
  // Unified sort (listSort.ts + SortChip): see Sales.tsx's mirror of this.
  const [returnSortSpec, setReturnSortSpec] = useState<SortSpec>(() => loadSortSpec(
    'returns:sort',
    { field: 'date', direction: 'desc' },
    RETURN_SORT_FIELD_DEFS as unknown as ReadonlyArray<SortField<unknown>>,
  ))
  useEffect(() => { saveSortSpec('returns:sort', returnSortSpec) }, [returnSortSpec])
  const returnSortDirection: SortDirection = returnSortSpec.field === 'date' ? returnSortSpec.direction : 'desc'
  const [returnPage, setReturnPage] = useState(1)
  const [returnPageSize, setReturnPageSize] = useState(() => getInitialReturnPageSize())
  const [collapsedReturnSections, setCollapsedReturnSections] = useState<Set<string>>(() => new Set())
  const [isReturnsFilterMenuOpen, setIsReturnsFilterMenuOpen] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const loadedOnceRef = useRef(false)
  const returnsRequestRef = useRef(0)
  const editRequestRef = useRef(0)
  const historyRestoreInFlightRef = useRef(false)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const loadWatchdogRef = useRef<number | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const actionHistory = useActionHistory({ limit: 8, notify, scope: 'returns', enabled: historyReady, user })
  // Same fix as Sales.tsx's debouncedSearch (see that file's comment for
  // the full "two different cadences" bug this replaces) -- found here
  // while rewriting routes/returns.ts's search in this same session, same
  // useDeferredValue-for-local-filter + separate-hand-rolled-350ms-debounce-
  // for-the-fetch pattern, not something specific to Sales.
  const debouncedSearch = useDebouncedValue(search, 180)
  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const returnsDateRange = useMemo(() => {
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
    if (loadWatchdogRef.current != null) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const loadReturns = useCallback(async (silent = false): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(returnsRequestRef)
    const promise = (async () => {
      if (!silent) {
        setLoading(true)
        setLoadError(null)
        clearLoadWatchdog()
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
            setLoadError(tr('returns_load_slow', 'Returns are taking longer than expected. Tap Refresh or revisit in a moment.', 'ការបង្វិលត្រឡប់កំពុងចំណាយពេលយូរជាងដែលរំពឹងទុក។ សូមចុចស្រស់ថ្មី ឬត្រឡប់មកវិញបន្តិចទៀត។'))
          }, 15000)
        }
      }
      try {
        const params = {
          scope,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...returnsDateRange,
        }
        const result = await withLoaderTimeout(() => fetchReturns(params), 'Returns', RETURNS_LOAD_TIMEOUT_MS)
        if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
        setRows(Array.isArray(result) ? result as ReturnRow[] : [])
        loadedOnceRef.current = true
        setLoadError(null)
      } catch (error: unknown) {
        if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
        const errorMessage = error instanceof Error ? error.message : ''
        console.error('[Returns] load failed:', errorMessage || error)
        if (!silent && !loadedOnceRef.current) {
          setLoadError(errorMessage || tr('returns_load_failed', 'Failed to load returns', 'មិនអាចផ្ទុកការបង្វិលត្រឡប់បានទេ'))
        } else if (!silent) {
          setLoadError(tr('returns_refresh_failed', 'Returns could not refresh right now. Showing the latest loaded data.', 'មិនអាចធ្វើបច្ចុប្បន្នភាពការបង្វិលត្រឡប់បានទេ។ កំពុងបង្ហាញទិន្នន័យចុងក្រោយដែលបានផ្ទុក។'))
        }
      } finally {
        clearLoadWatchdog()
        if (isTrackedRequestCurrent(returnsRequestRef, requestId) && !silent) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [clearLoadWatchdog, debouncedSearch, returnsDateRange, scope, tr])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      clearLoadWatchdog()
      invalidateTrackedRequest(returnsRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return undefined
    }
    loadReturns(loadedOnceRef.current)
    return () => {
      clearLoadWatchdog()
      invalidateTrackedRequest(returnsRequestRef)
      loadPromiseRef.current = null
    }
  }, [clearLoadWatchdog, isActive, loadReturns])

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
    if (['returns', 'sales', 'inventory', 'products'].includes(syncChannel.channel)) {
      loadReturns(true)
    }
  }, [isActive, loadReturns, syncChannel?.channel, syncChannel?.ts])

  // The foldable stats strip (shared StatsStrip, app-wide stats pattern):
  // range-scoped (default TODAY), scope-aware -- customer returns show
  // refunds + type mix, supplier cases show compensation vs business loss.
  // Fold breakdowns come from GET /api/returns/report (same kernel the
  // Reports hub reads, so figures always agree).
  type ReturnsStripRow = { count?: number; refund_usd?: number; compensation_usd?: number; loss_usd?: number }
  type ReturnsStripPayload = {
    totals?: ReturnsStripRow
    by_reason?: Array<ReturnsStripRow & { reason?: string }>
    by_type?: Array<ReturnsStripRow & { return_type?: string }>
  }
  const [stripRange, setStripRange] = useState<DateTimeRange>(() => statsPresetRange('today'))
  const [stripData, setStripData] = useState<ReturnsStripPayload | null>(null)
  const [stripLoading, setStripLoading] = useState(false)
  const stripRequestRef = useRef(0)
  const loadStatsStrip = useCallback(async (): Promise<void> => {
    if (!isActive || !stripRange.startDate || !stripRange.endDate) return
    const requestId = ++stripRequestRef.current
    setStripLoading(true)
    try {
      const result = await getReturnsReport({ startDate: stripRange.startDate, endDate: stripRange.endDate, scope })
      if (stripRequestRef.current !== requestId) return
      setStripData((result || {}) as ReturnsStripPayload)
    } catch {
      if (stripRequestRef.current !== requestId) return
      setStripData(null)
    } finally {
      if (stripRequestRef.current === requestId) setStripLoading(false)
    }
  }, [isActive, scope, stripRange.endDate, stripRange.startDate])
  useEffect(() => { void loadStatsStrip() }, [loadStatsStrip])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'returns') void loadStatsStrip()
  }, [isActive, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])

  const stripCards = useMemo<StatCardDef[]>(() => {
    const totals = stripData?.totals || {}
    const byType = stripData?.by_type || []
    const byReason = (stripData?.by_reason || []).slice(0, 8)
    const count = Number(totals.count) || 0
    const typeLabel = (value: string): string => (
      value === 'restock' ? tr('restocked', 'Restocked')
        : value === 'writeoff' ? tr('written_off', 'Written Off')
          : value === 'refund' ? tr('refund_only', 'Refund Only')
            : value === 'credit' ? tr('supplier_credit', 'Credit')
              : value || '—'
    )
    if (scope === SUPPLIER_SCOPE) {
      return [
        {
          key: 'cases',
          label: tr('return_to_supplier', 'Return to Supplier'),
          value: String(count),
          hint: tr('stats_supplier_cases_hint', 'How many cases you sent back to a supplier in the range, broken down by what happened to the goods.'),
          details: byType.map((row) => ({ label: typeLabel(String(row.return_type || '')), value: String(Number(row.count) || 0) })),
        },
        {
          key: 'compensation',
          label: tr('supplier_compensation', 'Compensation'),
          value: fmtUSD(Number(totals.compensation_usd) || 0),
          tone: 'ok',
          hint: tr('stats_supplier_compensation_hint', 'Money or credit the supplier gave back for goods you returned, broken down by reason.'),
          details: byReason.map((row) => ({ label: String(row.reason || '—'), value: fmtUSD(Number(row.compensation_usd) || 0) })),
        },
        {
          key: 'loss',
          label: tr('business_loss', 'Business loss'),
          value: fmtUSD(Number(totals.loss_usd) || 0),
          tone: (Number(totals.loss_usd) || 0) > 0 ? 'crit' : undefined,
          hint: tr('stats_business_loss_hint', 'What the returned goods cost you that the supplier did NOT cover — money the shop absorbs, broken down by reason.'),
          details: byReason.map((row) => ({ label: String(row.reason || '—'), value: fmtUSD(Number(row.loss_usd) || 0), tone: (Number(row.loss_usd) || 0) > 0 ? ('crit' as const) : undefined })),
        },
      ]
    }
    return [
      {
        key: 'returns',
        label: tr('returns', 'Returns'),
        value: String(count),
        hint: tr('stats_returns_count_hint', 'Customer returns created in the range (cancelled excluded). The breakdown shows what happened to the goods: restocked, written off, or refund-only.'),
        details: byType.map((row) => ({
          label: typeLabel(String(row.return_type || '')),
          value: `${Number(row.count) || 0} · ${fmtUSD(Number(row.refund_usd) || 0)}`,
        })),
      },
      {
        key: 'refunded',
        label: tr('total_refunded', 'Total Refunded'),
        value: fmtUSD(Number(totals.refund_usd) || 0),
        tone: (Number(totals.refund_usd) || 0) > 0 ? 'warn' : undefined,
        hint: tr('stats_total_refunded_hint', 'Money paid back to customers across the range, broken down by return reason.'),
        details: byReason.map((row) => ({
          label: String(row.reason || '—'),
          value: `${Number(row.count) || 0} · ${fmtUSD(Number(row.refund_usd) || 0)}`,
        })),
      },
    ]
  }, [fmtUSD, scope, stripData, tr])

  const handleOpenEdit = async (ret: ReturnRow): Promise<void> => {
    const requestId = beginTrackedRequest(editRequestRef)
    const retScope = normalizeScope(ret?.return_scope)
    if (retScope !== CUSTOMER_SCOPE) {
      notify(tr('supplier_return_edit_not_supported', 'Supplier returns cannot be edited from this form yet.'), 'info')
      return
    }
    setDetailRet(null)
    try {
      const fresh = await withLoaderTimeout(
        () => fetchReturnDetail(ret.id),
        'Return details',
        RETURNS_DETAIL_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(editRequestRef, requestId)) return
      setEditRet((fresh || ret) as ReturnRow)
    } catch {
      if (!isTrackedRequestCurrent(editRequestRef, requestId)) return
      setEditRet(ret)
    }
  }

  const buildReturnHistoryPayload = useCallback((snapshot: ReturnRow): ReturnHistoryPayload => {
    if (!snapshot?.id) throw new Error('Return snapshot is missing an id')
    return {
      reason: snapshot.reason || '',
      return_type: snapshot.return_type || 'restock',
      notes: snapshot.notes || '',
      total_refund_usd: snapshot.total_refund_usd || 0,
      total_refund_khr: snapshot.total_refund_khr || 0,
      branch_id: snapshot.branch_id || null,
      updated_at: snapshot.updated_at || null,
      items: (Array.isArray(snapshot.items) ? snapshot.items : []).map((item) => ({
        sale_item_id: item.sale_item_id || null,
        product_id: item.product_id || null,
        product_name: item.product_name || null,
        quantity: item.quantity || 0,
        applied_price_usd: item.applied_price_usd || 0,
        applied_price_khr: item.applied_price_khr || 0,
        cost_price_usd: item.cost_price_usd || 0,
        cost_price_khr: item.cost_price_khr || 0,
        return_to_stock: item.return_to_stock !== false,
        branch_id: item.branch_id || snapshot.branch_id || null,
      })),
    }
  }, [])

  const fetchReturnSnapshot = useCallback(async (returnId: number | string | null | undefined, fallback: ReturnRow | null = null): Promise<ReturnRow | null> => {
    const numericId = Number(returnId || 0)
    if (!numericId) return cloneHistorySnapshot(fallback || null) as ReturnRow | null
    try {
      const latest = await withLoaderTimeout(
        () => fetchReturnDetail(numericId),
        'Return snapshot',
        RETURNS_SNAPSHOT_TIMEOUT_MS,
      )
      return cloneHistorySnapshot((latest as ReturnRow | null) || fallback || null) as ReturnRow | null
    } catch {
      return cloneHistorySnapshot(fallback || null) as ReturnRow | null
    }
  }, [])

  const restoreReturnSnapshot = useCallback(async (snapshot: ReturnRow, historyReason?: string): Promise<void> => {
    if (!snapshot?.id) throw new Error('Return snapshot is unavailable.')
    if (!beginSingleAction(historyRestoreInFlightRef)) return
    try {
      await withLoaderTimeout(
        () => updateReturnRequest(snapshot.id as number | string, {
          ...buildReturnHistoryPayload(snapshot),
          notes: historyReason || snapshot.notes || '',
        }),
        'Restore return snapshot',
        RETURNS_HISTORY_RESTORE_TIMEOUT_MS,
      )
      await loadReturns(true)
    } finally {
      finishSingleAction(historyRestoreInFlightRef)
    }
  }, [buildReturnHistoryPayload, loadReturns])

  const handleReturnMutationSuccess = useCallback(async (mutation: ReturnMutation): Promise<void> => {
    const kind = String(mutation?.kind || '')
    const result = mutation?.result || null
    const previousSnapshot = cloneHistorySnapshot(mutation?.previousSnapshot || null) as ReturnRow | null
    const createdId = Number(result?.id || mutation?.id || 0)
    const effectiveId = createdId || Number(previousSnapshot?.id || 0)
    const latestSnapshot = effectiveId
      ? await fetchReturnSnapshot(effectiveId, mutation?.snapshot || previousSnapshot || result)
      : null

    await loadReturns(true)

    if (kind === 'edit' && previousSnapshot?.id && latestSnapshot?.id) {
      const returnLabel = latestSnapshot.return_number || previousSnapshot.return_number || `#${latestSnapshot.id}`
      actionHistory.pushAction({
        label: `Edit return ${returnLabel}`,
        entity: 'return',
        entity_id: latestSnapshot.id,
        scope: 'returns',
        undo: () => restoreReturnSnapshot(previousSnapshot, 'Undo return edit'),
        redo: () => restoreReturnSnapshot(latestSnapshot, 'Redo return edit'),
      })
      return
    }

    if (latestSnapshot?.id) {
      const returnLabel = latestSnapshot.return_number || `#${latestSnapshot.id}`
      actionHistory.pushAction({
        label: kind === 'supplier-create'
          ? `Create supplier return ${returnLabel}`
          : `Create return ${returnLabel}`,
        entity: kind === 'supplier-create' ? 'supplier_return' : 'return',
        entity_id: latestSnapshot.id,
        scope: 'returns',
      })
    }
  }, [actionHistory, fetchReturnSnapshot, loadReturns, restoreReturnSnapshot])

  const availableYears = useMemo(
    () => getAvailableYears(rows, (ret) => ret?.created_at),
    [rows],
  )

  const typeOptions = useMemo(() => {
    const options = new Map<string, string>()
    rows.forEach((ret) => {
      const key = getReturnTypeKey(ret)
      if (!key) return
      options.set(key, getReturnTypeLabel(ret, tr))
    })
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [rows, tr])

  // Comma-separated groups, same syntax/tokenizer Sales.tsx now uses
  // (buildProductSearchTerms) and the same syntax routes/returns.ts parses
  // server-side (tokenizeSearchTermGroups) -- built from `debouncedSearch`,
  // not raw `search`, so this local re-filter settles on the same cadence
  // as the server fetch above (see debouncedSearch's own comment for the
  // bug this fixes).
  const searchTerms = useMemo(() => buildProductSearchTerms(debouncedSearch), [debouncedSearch])
  // Search-only filter (no type) so the scope stat tiles below always show
  // true totals across every return type, regardless of which type is
  // currently selected -- `filtered` (which also applies typeFilter) drives
  // the visible/paginated list, but using it for the tiles too meant
  // picking e.g. "Written Off" made every other tile (Restocked, Refund
  // Only, even Total Refunded) collapse to just the writeoff subset, since
  // rows for other types were no longer present to sum.
  //
  // Mirrors routes/returns.ts's search as closely as this page's
  // already-loaded data allows: every flat return-level column it searches,
  // plus the return's own numeric id (matching the server's CAST(r.id AS
  // TEXT) fix), plus each line item's product_name. Deliberately NOT
  // sku/barcode/brand -- same reason as Sales.tsx's own local haystack:
  // those live on products, joined in only inside the server's own search
  // query, not present on the ReturnItem shape this page already has
  // loaded -- so a sku/barcode/brand search still narrows correctly once
  // the debounced server response lands, it just can't narrow the local
  // pre-response preview the same way a return number or product name can.
  const buildReturnHaystack = (ret: ReturnRow) => {
    const items = Array.isArray(ret.items) ? ret.items : []
    const itemHaystack = items.map((item) => item?.product_name || '').join(' ')
    return [
      String(ret.id ?? ''),
      ret.return_number,
      ret.receipt_number,
      ret.cashier_name,
      ret.customer_name,
      ret.supplier_name,
      ret.reason,
      ret.return_type,
      ret.supplier_settlement,
      itemHaystack,
    ].join(' ')
  }
  const searchFiltered = useMemo(() => {
    if (!searchTerms.length) return rows
    return rows.filter((ret) => matchesSearchTermGroups(buildReturnHaystack(ret), searchTerms, 'AND'))
  }, [rows, searchTerms])
  const filtered = useMemo(() => rows.filter((ret) => {
    if (!matchesMulti(typeFilter, getReturnTypeKey(ret))) return false
    if (!searchTerms.length) return true
    return matchesSearchTermGroups(buildReturnHaystack(ret), searchTerms, 'AND')
  }), [rows, searchTerms, typeFilter])

  const returnSortFields = useMemo<SortField<ReturnRow>[]>(() => {
    const labels: Record<string, string> = {
      date: tr('sort_by_date', 'Date'),
      refund: tr('sort_by_refund', 'Refund'),
      customer: tr('customer', 'Customer'),
      processed_by: tr('processed_by', 'Processed by'),
      type: tr('type', 'Type'),
    }
    return RETURN_SORT_FIELD_DEFS.map((field) => ({ ...field, label: labels[field.id] || field.id }))
  }, [tr])

  const buildSortedReturnSection = useCallback((items: ReturnRow[]): ReturnSection[] => {
    const label = returnSortFields.find((field) => field.id === returnSortSpec.field)?.label || ''
    const ids = items.map((ret) => Number(ret?.id)).filter((id) => Number.isFinite(id))
    return [{
      id: 'sorted',
      label,
      ids,
      items,
      groups: [{ id: 'sorted:all', actionKey: 'all', label, ids, items, sortTime: 0, synthetic: true }],
    }] as unknown as ReturnSection[]
  }, [returnSortFields, returnSortSpec.field])

  const allReturnSections = useMemo<ReturnSection[]>(() => returnSortSpec.field !== 'date'
    ? buildSortedReturnSection(sortRecords(filtered, returnSortSpec, returnSortFields))
    : buildTimeActionSections(filtered, {
      getDate: (ret) => ret?.created_at,
      getItemId: (ret) => Number(ret?.id),
      getActionKey: (ret) => getReturnTypeKey(ret),
      getActionLabel: (ret) => getReturnTypeLabel(ret, tr),
      year: yearFilter,
      month: monthFilter,
      timeMode,
      groupMode: returnGroupMode,
      sortDirection: returnSortDirection,
    }), [buildSortedReturnSection, filtered, monthFilter, returnGroupMode, returnSortDirection, returnSortFields, returnSortSpec, timeMode, tr, yearFilter])

  useEffect(() => {
    setReturnPage(1)
  }, [debouncedSearch, monthFilter, returnGroupMode, returnSortSpec, scope, typeFilter, yearFilter])

  const allVisibleReturns = useMemo(
    () => allReturnSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [allReturnSections],
  )

  const pagedReturns = useMemo(
    () => paginateItems(allVisibleReturns, returnPage, returnPageSize),
    [allVisibleReturns, returnPage, returnPageSize],
  )

  const returnSections = useMemo<ReturnSection[]>(() => returnSortSpec.field !== 'date'
    // Already flat-sorted upstream; the page slice keeps that order.
    ? buildSortedReturnSection(pagedReturns)
    : buildTimeActionSections(pagedReturns, {
      getDate: (ret) => ret?.created_at,
      getItemId: (ret) => Number(ret?.id),
      getActionKey: (ret) => getReturnTypeKey(ret),
      getActionLabel: (ret) => getReturnTypeLabel(ret, tr),
      year: yearFilter,
      month: monthFilter,
      timeMode,
      groupMode: returnGroupMode,
      sortDirection: returnSortDirection,
    }), [buildSortedReturnSection, monthFilter, pagedReturns, returnGroupMode, returnSortDirection, returnSortSpec.field, timeMode, tr, yearFilter])

  const visibleReturns = useMemo(
    () => returnSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [returnSections],
  )

  const visibleIds = useMemo(
    () => normalizeFiniteIdsFrom(visibleReturns, (ret) => ret.id),
    [visibleReturns],
  )

  useEffect(() => {
    const validIds = new Set(visibleIds)
    setSelectedIds((current) => pruneSelectionToVisibleIds(current, validIds))
  }, [visibleIds])

  useEffect(() => {
    const validIds = new Set(returnSections.map((section) => section.id))
    setCollapsedReturnSections((current) => pruneSelectionToVisibleIds(current, validIds))
  }, [returnSections])

  const selectedReturns = useMemo(
    () => visibleReturns.filter((ret) => selectedIds.has(Number(ret.id))),
    [selectedIds, visibleReturns],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleIds.length
  }, [selectedIds.size, visibleIds.length])

  const toggleSelected = useCallback((returnId: ReturnRow['id']) => {
    const numericId = Number(returnId)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }, [])

  const toggleSelectAll = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(visibleIds))
  }, [visibleIds])

  const toggleSelectionScope = useCallback((ids: unknown[], checked: boolean) => {
    const normalized = normalizeFiniteIds(ids)
    setSelectedIds((current) => toggleIdSet(current, normalized, checked))
  }, [])

  const toggleReturnSection = useCallback((sectionId: string) => {
    setCollapsedReturnSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const isSelectionScopeFullySelected = useCallback(
    (ids: number[] = []) => {
      const normalized = normalizeFiniteIds(ids)
      return normalized.length > 0 && countSelectedIds(normalized, selectedIds) === normalized.length
    },
    [selectedIds],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids: number[] = []) => {
      const normalized = normalizeFiniteIds(ids)
      const selectedCount = countSelectedIds(normalized, selectedIds)
      return selectedCount > 0 && selectedCount < normalized.length
    },
    [selectedIds],
  )

  // Per-scope row split for the export menu. The old per-scope stat sums
  // moved to the range-driven StatsStrip above (server-computed via
  // /api/returns/report), so only the rows themselves are needed here.
  const returnScopeSummary = useMemo(() => {
    const summary: { customerRows: ReturnRow[]; supplierRows: ReturnRow[] } = { customerRows: [], supplierRows: [] }
    for (const ret of searchFiltered) {
      if (normalizeScope(ret.return_scope) === SUPPLIER_SCOPE) summary.supplierRows.push(ret)
      else summary.customerRows.push(ret)
    }
    return summary
  }, [searchFiltered])

  const { customerRows, supplierRows } = returnScopeSummary

  // H1+X5 (Part 402): exports open the shared options dialog (column
  // chooser remembered per page + CSV/Excel/PDF) instead of a fixed xlsx.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  const exportVisible = useCallback(async (rowsToExport: ReturnRow[] = visibleReturns, prefix = 'returns-visible') => {
    if (!rowsToExport.length) {
      notify(tr('no_data_to_export', 'No data to export'), 'error')
      return
    }
    setExportDialog({ rows: exportReturnRows(rowsToExport, tr), baseName: prefix })
  }, [notify, tr, visibleReturns])

  const exportSelected = useCallback(async () => {
    if (!selectedReturns.length) return
    await exportVisible(selectedReturns, 'returns-selected')
  }, [exportVisible, selectedReturns])

  const exportItems = useMemo(() => ([
    { label: tr('export_visible_returns', 'Export visible returns', 'នាំចេញការត្រឡប់ដែលកំពុងបង្ហាញ'), onClick: () => exportVisible(visibleReturns, `returns-${scope}`) },
    selectedReturns.length ? { label: tr('export_selected_returns', 'Export selected returns', 'នាំចេញការត្រឡប់ដែលបានជ្រើស'), onClick: exportSelected, color: 'blue' } : null,
    typeFilter !== 'all' ? { label: tr('export_filtered_type', `Export ${typeOptions.find(([id]) => id === typeFilter)?.[1] || typeFilter}`, `នាំចេញតាមប្រភេទ ${typeOptions.find(([id]) => id === typeFilter)?.[1] || typeFilter}`), onClick: () => exportVisible(filtered, `returns-${typeFilter}`) } : null,
    yearFilter !== 'all' || monthFilter !== 'all' ? { label: tr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportVisible(filtered, 'returns-filtered') } : null,
    scope !== CUSTOMER_SCOPE
      ? { label: tr('export_supplier_returns', 'Export supplier returns', 'នាំចេញការត្រឡប់ទៅអ្នកផ្គត់ផ្គង់'), onClick: () => exportVisible(supplierRows, 'returns-supplier') }
      : { label: tr('export_customer_returns', 'Export customer returns', 'នាំចេញការត្រឡប់ពីអតិថិជន'), onClick: () => exportVisible(customerRows, 'returns-customer') },
  ].filter(Boolean)), [customerRows, exportSelected, exportVisible, filtered, monthFilter, scope, selectedReturns.length, supplierRows, tr, typeFilter, typeOptions, visibleReturns, yearFilter])

  const filterSections = useMemo(() => {
    if (!isReturnsFilterMenuOpen) return []
    return [
      {
        id: 'scope',
        label: tr('scope', 'Scope'),
        options: [
          { id: CUSTOMER_SCOPE, label: tr('customer_returns', 'Customer Returns'), active: scope === CUSTOMER_SCOPE, onClick: () => setScope(CUSTOMER_SCOPE) },
          { id: SUPPLIER_SCOPE, label: tr('supplier_returns', 'Supplier Returns'), active: scope === SUPPLIER_SCOPE, onClick: () => setScope(SUPPLIER_SCOPE) },
        ],
      },
      {
        id: 'type',
        label: tr('type', 'Type'),
        options: [
          { id: 'all', label: tr('all_types', 'All types'), active: typeFilter === 'all', onClick: () => setTypeFilter('all') },
          ...typeOptions.map(([id, label]) => ({
            id,
            label,
            active: isMultiActive(typeFilter, id),
            onClick: () => setTypeFilter(toggleMultiValue(typeFilter, id)),
          })),
        ],
      },
      {
        id: 'grouping',
        label: tr('group_by', 'Group by'),
        options: [
          { id: 'time', label: tr('group_by_time', 'Time only'), active: returnGroupMode === 'time', onClick: () => setReturnGroupMode('time') },
          { id: 'time-action', label: tr('group_by_time_action', 'Time + type'), active: returnGroupMode === 'time+action', onClick: () => setReturnGroupMode('time+action') },
        ],
      },
      // Sorting moved onto the visible SortChip (unified listSort method);
      // this section keeps only the period narrowing it always bundled.
      {
        id: 'period',
        label: tr('period', 'Period'),
        searchable: true,
        options: buildPeriodFilterOptions({
          yearFilter, setYearFilter, monthFilter, setMonthFilter, availableYears,
          allTimeLabel: tr('all_time', 'All time'),
        }),
      },
    ]
  }, [availableYears, isReturnsFilterMenuOpen, monthFilter, returnGroupMode, scope, tr, typeFilter, typeOptions, yearFilter])

  // Scope (customer vs supplier) is a VIEW, not a filter: it's a mandatory
  // one-of-two with no neutral "all", so being on the supplier view must
  // not light up "Filters (1)" -- and Clear must not teleport the user
  // back to the customer view (see FilterMenu onClear below).
  const activeFilterCount = useMemo(
    () => countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', typeFilter !== 'all', returnGroupMode !== 'time']),
    [monthFilter, returnGroupMode, typeFilter, yearFilter],
  )
  const showReturnActionGroups = returnGroupMode === 'time+action'

  const renderAmount = (ret: ReturnRow): ReactNode => {
    const retScope = normalizeScope(ret.return_scope)
    if (retScope === SUPPLIER_SCOPE) {
      return (
        <div className="text-right">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUSD(ret.supplier_compensation_usd || 0)}</div>
          <div className="text-xs text-rose-500">{tr('business_loss', 'Business loss')}: {fmtUSD(ret.supplier_loss_usd || 0)}</div>
        </div>
      )
    }
    return <span className="font-semibold text-gray-900 dark:text-white">{fmtUSD(ret.total_refund_usd || 0)}</span>
  }

  if (loadError && !loading && !rows.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => loadReturns(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      {selectedReturns.length > 0 ? (
        <div className="bulk-toolbar mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{selectedReturns.length} {tr('selected', 'Selected')}</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={exportSelected}>{tr('export_selected', 'Export selected')}</button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set())}>
            {tr('clear', 'Clear')}
          </button>
        </div>
      ) : null}

      {/* The foldable stats strip (shared StatsStrip, the app-wide stats
          pattern) replaces the per-scope tile grids: range-scoped mini
          cards (default today) whose folds carry the by-type / by-reason
          breakdowns from /api/returns/report. Type filtering stayed where
          it also already lived — the Filters menu's type section. */}
      <StatsStrip
        className="mb-3"
        cards={stripCards}
        loading={stripLoading}
        t={t}
        range={stripRange}
        onRangeChange={setStripRange}
        // Export + History are SECONDARY controls (Part 548): Returns has
        // only 2-3 stat cards, so when the strip is open they merge into
        // the STATS row's spare width rather than the date row ("if stats
        // are not many like only two ... just merge with the stats").
        rangeActions={(
          <>
            <ExportMenu label={tr('export', 'Export')} items={exportItems} triggerClassName="h-8 px-2.5 text-xs" />
            <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} t={t} className="min-w-0" />
          </>
        )}
        actions={(
          // The PRIMARY add action: explicit, always-visible label ("make
          // add button clear... add return", Part 548 — the label used to
          // vanish below the sm breakpoint, leaving a bare icon).
          scope === SUPPLIER_SCOPE ? (
            <button onClick={() => setShowSupplierForm(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700" aria-label={tr('add_supplier_return', 'Add Supplier Return')}>
              <Undo2 className="h-3.5 w-3.5 shrink-0" />
              <span>{tr('add_supplier_return', 'Add Supplier Return')}</span>
            </button>
          ) : (
            <button onClick={() => setShowCustomerForm(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700" aria-label={tr('add_return', 'Add Return')}>
              <Undo2 className="h-3.5 w-3.5 shrink-0" />
              <span>{tr('add_return', 'Add Return')}</span>
            </button>
          )
        )}
      />


      {/* Search + filter pin to the top of the page's scroll container while
          scrolling -- same `sticky top-2` treatment as Products/Inventory/
          Sales (Aug 11 2026 UI-polish request; this page was flagged as
          sharing the pattern but not yet wrapped). Returns has no top-level
          select-all/bulk-action row at this spot to include -- selection
          lives per-section inside ReturnsListSurface, and the "N selected"
          banner above the stat cards already has its own fixed position
          above them -- so only the search+filter row needs the wrapper. */}
      <div className="sticky top-2 z-30 -mx-1 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SearchInput
            id="returns-search"
            name="returns_search"
            value={search}
            onChange={setSearch}
            placeholder={tr('search_returns_placeholder', 'Search divide by comma, any order: return ID, return number, receipt, customer, product name, barcode/sku, brand')}
          />
          {/* Placeholder above already advertises barcode/sku as a
              searchable field -- same capability Products.tsx/Inventory.tsx/
              POS.tsx expose a camera-scan shortcut for. Added here (and to
              Sales.tsx) to match; same onDetected={setSearch} wiring. */}
          <ScanSearchButton onDetected={setSearch} t={(key: string) => t(key) || key} />
          <SortChip
            spec={returnSortSpec}
            fields={returnSortFields}
            onChange={setReturnSortSpec}
            label={tr('sort', 'Sort')}
          />
          <FilterMenu
            label={tr('filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={filterSections}
            onOpenChange={setIsReturnsFilterMenuOpen}
            onClear={() => {
              setYearFilter('all')
              setMonthFilter('all')
              setTypeFilter('all')
              setReturnGroupMode('time')
              setReturnSortSpec({ field: 'date', direction: 'desc' })
            }}
            compact
          />
        </div>
      </div>

      <p className="mb-2 text-xs text-gray-400">{tr('tap_to_view_details', 'Tap a record to view details.')}</p>

      <div className="mb-3 flex justify-center">
        <PaginationControls
          compact
          rangeAsPageSize
          page={returnPage}
          pageSize={returnPageSize}
          totalItems={allVisibleReturns.length}
          label={tr('returns_count', 'returns')}
          t={t}
          onPageChange={setReturnPage}
          onPageSizeChange={(size) => {
            setReturnPageSize(size)
            setReturnPage(1)
          }}
        />
      </div>
      <ReturnsListSurface
        collapsedReturnSections={collapsedReturnSections}
        CUSTOMER_SCOPE={CUSTOMER_SCOPE}
        filtered={filtered as ReturnsListSurfaceProps['filtered']}
        fmtTime={fmtTime}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        loading={loading}
        normalizeScope={normalizeScope}
        renderAmount={renderAmount as ReturnsListSurfaceProps['renderAmount']}
        returnSections={returnSections as ReturnsListSurfaceProps['returnSections']}
        scope={scope}
        selectAllRef={selectAllRef as ReturnsListSurfaceProps['selectAllRef']}
        selectedIds={selectedIds}
        selectionModeActive={selectionModeActive}
        getReturnLongPressState={getReturnLongPressState}
        setDetailRet={(ret) => setDetailRet(ret as ReturnRow)}
        showReturnActionGroups={showReturnActionGroups}
        SUPPLIER_SCOPE={SUPPLIER_SCOPE}
        t={t}
        toggleReturnSection={toggleReturnSection}
        toggleSelected={toggleSelected}
        toggleSelectAll={toggleSelectAll}
        toggleSelectionScope={toggleSelectionScope}
        tr={tr}
        visibleIds={visibleIds}
      />

      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={RETURN_EXPORT_KEYS.map((key) => ({ key, label: exportColumnLabel(key) }))}
            rows={exportDialog.rows}
            rememberKey="returns"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}

      {detailRet ? (
        <Suspense fallback={null}>
          <ReturnDetailModal
            ret={detailRet}
            onClose={() => setDetailRet(null)}
            onEdit={canEditReturn && normalizeScope(detailRet.return_scope) === CUSTOMER_SCOPE ? () => handleOpenEdit(detailRet) : undefined}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
          />
        </Suspense>
      ) : null}

      {editRet ? (
        <Suspense fallback={null}>
          <EditReturnModal
            ret={editRet}
            onClose={() => setEditRet(null)}
            onSuccess={(result) => handleReturnMutationSuccess({
              kind: 'edit',
              result: result as ReturnRow,
              previousSnapshot: editRet,
            })}
            fmtUSD={fmtUSD}
            notify={notify}
          />
        </Suspense>
      ) : null}

      {showCustomerForm ? (
        <Suspense fallback={null}>
          <NewReturnModal
            onClose={() => setShowCustomerForm(false)}
            onSuccess={(result) => handleReturnMutationSuccess({ kind: 'create', result: result as ReturnRow })}
            fmtUSD={fmtUSD}
            notify={notify}
          />
        </Suspense>
      ) : null}

      {showSupplierForm ? (
        <Suspense fallback={null}>
          <NewSupplierReturnModal
            onClose={() => setShowSupplierForm(false)}
            onSuccess={(result) => handleReturnMutationSuccess({ kind: 'supplier-create', result: result as ReturnRow })}
            notify={notify}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
