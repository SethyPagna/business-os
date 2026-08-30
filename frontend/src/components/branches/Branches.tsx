import type { ComponentProps, ReactNode } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { consumeLongPressClick, createLongPressHandlers, createLongPressState, type LongPressState } from '../../utils/longPress.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import Modal from '../shared/Modal'
import InfoHint from '../shared/InfoHint.tsx'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import FilterMenu from '../shared/FilterMenu'
import { useIsPageActive } from '../shared/pageActivity'
import BranchForm from './BranchForm'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { buildProductGroups } from '../../utils/productGrouping.ts'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import {
  createBranch as createBranchRequest,
  deleteBranch as deleteBranchRequest,
  getBranches as getBranchesRequest,
  getBranchStock as getBranchStockRequest,
  getTransfers as getTransfersRequest,
  updateBranch as updateBranchRequest,
} from '../../api/branchTransport.ts'

/**
 * 1. Branches Page
 * 1.1 Purpose
 * - Manage branch records.
 * - Transfer inventory between branches.
 * - Review transfer history.
 */

const BRANCHES_LIST_TIMEOUT_MS = 10000
const BRANCH_TRANSFERS_TIMEOUT_MS = 12000
const BRANCH_MUTATION_TIMEOUT_MS = 12000

type TranslateFunction = (key: string) => string | undefined
type NotifyFunction = (message: string, type?: string) => void
type BranchFlag = 0 | 1 | boolean
type BranchModal = 'form' | 'transfer' | null
type BranchTab = 'branches' | 'transfers'

interface AppUser {
  id?: string | number
  name?: string
}

interface AppContextValue {
  // Per-action gate (utils/permissionActions.ts) -- the same table the
  // admin permission editor renders, so a control's visibility here always
  // matches what an admin was shown when granting the tier.
  can: (permissionKey: string, actionKey: string) => boolean
  t: TranslateFunction
  user?: AppUser | null
  notify: NotifyFunction
  fmtUSD: (value: number) => string
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: unknown
  } | null
}

interface BranchRecord {
  id: string | number
  name?: string | null
  location?: string | null
  phone?: string | null
  manager?: string | null
  notes?: string | null
  is_default?: BranchFlag | null
  is_active?: BranchFlag | null
}

interface BranchFormPayload {
  name: string
  location: string
  phone: string
  manager: string
  notes: string
  is_default: BranchFlag | boolean
  is_active: BranchFlag | boolean
}

interface BranchPayload {
  name: string
  location: string
  phone: string
  manager: string
  notes: string
  is_default: BranchFlag
  is_active: BranchFlag
  userId?: string | number
  userName?: string
}

type BranchTransportPayload = BranchPayload & Record<string, unknown>

interface BranchStockProduct {
  id: string | number
  name?: string | null
  sku?: string | null
  unit?: string | null
  branch_quantity?: number | string | null
  low_stock_threshold?: number | string | null
  out_of_stock_threshold?: number | string | null
  [key: string]: unknown
}

interface BranchStockSummary {
  total_products?: number | string
  total_product?: number | string
  in_stock_products?: number | string
  positive_products?: number | string
  healthy_products?: number | string
  low_stock_products?: number | string
  out_of_stock_products?: number | string
  positive_value_usd?: number | string
  total_value_usd?: number | string
}

interface BranchStockPage {
  items?: BranchStockProduct[]
  page?: number | string
  pageSize?: number | string
  totalPages?: number | string
  stockState?: string
  summary?: BranchStockSummary
}

type BranchStockState = BranchStockProduct[] | BranchStockPage

interface StockTransfer {
  id: string | number
  product_name?: string | null
  created_at?: string | null
  quantity?: number | string | null
  from_branch_id?: string | number | null
  to_branch_id?: string | number | null
  from_name?: string | null
  to_name?: string | null
  note?: string | null
  user_name?: string | null
}

interface BranchMutationResult {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
  item?: { id?: unknown } | null
}

interface BranchApi {
  getBranches: () => Promise<unknown>
  getTransfers: (params: Record<string, unknown>) => Promise<unknown>
  getBranchStock: (branchId: string | number, options: { page: number; pageSize: number; stockState: string; query?: string }) => Promise<BranchStockState>
  updateBranch: (id: string | number, payload: BranchTransportPayload) => Promise<BranchMutationResult>
  createBranch: (payload: BranchTransportPayload) => Promise<BranchMutationResult>
  deleteBranch: (id: string | number, userId?: string | number, userName?: string) => Promise<BranchMutationResult>
}

interface BranchStatTileProps {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  color?: string
  sub?: ReactNode
  onClick?: () => void
}

interface StatDetail {
  title: ReactNode
  value: ReactNode
  detail: ReactNode
}

interface RestoredBranchEntry {
  originalId: string | number
  restoredId: number
}

type ActionHistoryProp = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue
const LazyTransferModal = lazyRetry(async () => ({ default: (await import('./TransferModal')).default }), 'branches-transfer-modal')
// D4b: the Branches per-branch stock view gets the SAME receive entry point
// Inventory has (11.28's "Branch batch views") -- the one shared modal, with
// this branch preselected, not a parallel form.
const LazyReceiveBatchModal = lazyRetry(async () => ({ default: (await import('../inventory/ReceiveBatchModal')).default }), 'branches-receive-batch-modal')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'branches-export-options')

function getBranchApi(): BranchApi {
  return {
    getBranches: getBranchesRequest,
    getTransfers: () => getTransfersRequest(),
    getBranchStock: (branchId, options) => getBranchStockRequest(branchId, options) as Promise<BranchStockState>,
    updateBranch: (id, payload) => updateBranchRequest(id, payload) as Promise<BranchMutationResult>,
    createBranch: (payload) => createBranchRequest(payload) as Promise<BranchMutationResult>,
    deleteBranch: (id, userId, userName) => deleteBranchRequest(id, userId ?? null, userName ?? null) as Promise<BranchMutationResult>,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isBranchRecord(value: unknown): value is BranchRecord {
  return !!value && typeof value === 'object' && 'id' in value
}

function isTransferRecord(value: unknown): value is StockTransfer {
  return !!value && typeof value === 'object' && 'id' in value
}

function BranchStatTile({ label, value, detail, color = 'text-slate-700 dark:text-slate-100', sub, onClick }: BranchStatTileProps) {
  const detailText = String(detail || '')
  // The explanation used to be a `title` attribute, i.e. the browser's own
  // black tooltip: unreadable on touch (no hover), unstyleable, and slow to
  // appear. It now goes through the shared InfoHint, which opens on hover AND
  // tap. The tile becomes a container with the clickable region inside it,
  // because InfoHint is a <button> and a button nested in a button is invalid
  // HTML -- the browser drops one, silently breaking either the hint or the
  // drill-down.
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-left shadow-sm transition focus-within:ring-2 focus-within:ring-blue-500/30 hover:border-blue-200 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-blue-900 dark:hover:bg-blue-950/20">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 sm:text-[11px]">{label}</div>
        {detailText ? <InfoHint className="shrink-0" label={String(label || '')} text={detailText} /> : null}
      </div>
      <button type="button" className="block w-full min-w-0 text-left focus:outline-none" onClick={onClick}>
        <div className={`truncate text-sm font-bold leading-tight sm:text-base ${color}`}>{value}</div>
        {sub ? <div className="mt-0.5 min-w-0 truncate text-[9.5px] leading-3 text-gray-500 dark:text-gray-400">{sub}</div> : null}
      </button>
    </div>
  )
}

/**
 * 1.2 Shared format helper for transfer timestamps.
 */
function formatTransferDate(rawValue: string | null | undefined): string {
  if (!rawValue) return 'N/A'
  const iso = rawValue.includes('T') || rawValue.endsWith('Z')
    ? rawValue
    : `${rawValue.replace(' ', 'T')}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function Branches({ embedded = false }: { embedded?: boolean } = {}) {
  const { can, t, user, notify, fmtUSD } = useApp()
  // Transferring stock moves real quantities against live state, so
  // routes/branches.ts blocks it outright for the Review Required tier
  // (POST /transfer and /transfer-bulk) instead of queueing it -- see
  // utils/permissionActions.ts. Add/edit/delete DO queue for that tier, so
  // they stay available; only transfer is withheld.
  const canTransferStock = can('branches', 'transfer')
  // Same grant Inventory's own adjust/receive affordances check, because
  // POST /api/batches sits behind 'inventory' server-side -- a button the
  // server would 403 is worse than no button.
  const canReceiveStock = can('inventory', 'adjust')
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('branches')
  const branchApi = useMemo(() => getBranchApi(), [])
  const tr = useCallback((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])

  /**
   * 2. Page State
   * 2.1 Branch + transfer data sources.
   * 2.2 UI selection/expansion state.
   */
  const [branches, setBranches] = useState<BranchRecord[]>([])
  const [tab, setTab] = useState<BranchTab>('branches')
  const [modal, setModal] = useState<BranchModal>(null)
  const [selected, setSelected] = useState<BranchRecord | null>(null)
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [branchStocks, setBranchStocks] = useState<Record<string | number, BranchStockState>>({})
  // Per-branch product search (user, Aug 30): sits between the mini stat
  // tiles and the product grid inside an expanded branch. Server-backed --
  // the paged stock endpoint already filters on `query` (name/sku/barcode/
  // brand/category), so matches aren't limited to the rows already loaded.
  const [branchStockSearch, setBranchStockSearch] = useState<Record<string, string>>({})
  const branchSearchTimersRef = useRef<Map<string, number>>(new Map())
  // D4b receive entry point: which product card's "receive" was clicked,
  // and into which branch (preselected in the shared modal).
  const [receiveTarget, setReceiveTarget] = useState<{ product: BranchStockProduct; branchId: string } | null>(null)
  // A Set (not a single value) so more than one branch card can be open at
  // once -- was accordion-style (opening one silently closed any other),
  // reported as "can only open one branch at a time, should allow checking
  // all branches like collapse/expand".
  const [expandedBranches, setExpandedBranches] = useState<Set<string | number>>(() => new Set())
  // Collapse state for the "wrap" product-group headers inside a branch's
  // stock grid (name/rows/qty title, click to expand/collapse the variant
  // cards below it) -- keyed `${branchId}:${group.key}` since more than one
  // branch card can be expanded at once and each has its own independent
  // set of groups. New groups default to expanded (not in this set), same
  // convention as Products.tsx's collapsedProductGroups.
  const [collapsedBranchGroups, setCollapsedBranchGroups] = useState<Set<string>>(() => new Set())
  const toggleBranchGroup = useCallback((groupToggleKey: string) => {
    setCollapsedBranchGroups((current) => {
      const next = new Set(current)
      if (next.has(groupToggleKey)) next.delete(groupToggleKey)
      else next.add(groupToggleKey)
      return next
    })
  }, [])
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [branchStatusFilter, setBranchStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [transferFromFilter, setTransferFromFilter] = useState<string>('all')
  const [transferToFilter, setTransferToFilter] = useState<string>('all')
  const [statDetail, setStatDetail] = useState<StatDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [historyReady, setHistoryReady] = useState(false)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<unknown> | null>(null)
  const loadPromiseModeRef = useRef('')
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })

  /**
   * 3. Data Loading
   * 3.1 Fetch branches + transfer history.
   */
  const load = useCallback(async (silent = loadedOnceRef.current) => {
    const requestedMode = tab === 'transfers' ? 'transfers' : 'branches'
    if (loadPromiseRef.current) {
      if (requestedMode !== 'transfers' || loadPromiseModeRef.current === 'transfers') {
        return loadPromiseRef.current
      }
      await loadPromiseRef.current.catch(() => null)
    }
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError(null)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoadError(tr('branches_load_slow', 'Branches are taking longer than expected. Tap Retry or revisit in a moment.'))
        }, 15_000)
      }

      try {
        const tasks: Record<string, () => Promise<unknown>> = {
          branches: () => withLoaderTimeout(
            () => branchApi.getBranches(),
            'Branches list',
            BRANCHES_LIST_TIMEOUT_MS,
          ),
        }
        if (tab === 'transfers') {
          tasks.transfers = () => withLoaderTimeout(
            () => branchApi.getTransfers({}),
            'Branch transfers',
            BRANCH_TRANSFERS_TIMEOUT_MS,
          )
        }
        const result = await settleLoaderMap(tasks)

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
        if (Array.isArray(result.values.branches)) setBranches(result.values.branches.filter(isBranchRecord))
        if (Array.isArray(result.values.transfers)) setTransfers(result.values.transfers.filter(isTransferRecord))

        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, tr('failed_to_load_data', 'Failed to load data')))
        }

        loadedOnceRef.current = true
        setLoadError(null)
        return result
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
        const message = getErrorMessage(error, tr('failed_to_load_data', 'Failed to load data'))
        if (!silent && !loadedOnceRef.current) {
          setLoadError(message)
        } else if (!silent) {
          setLoadError(tr('branches_refresh_failed', 'Branches could not refresh right now. Showing the latest loaded data.'))
          notify(message, 'warning')
        }
        return null
      } finally {
        if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
        if (isTrackedRequestCurrent(loadRequestRef, requestId)) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
        loadPromiseModeRef.current = ''
      }
    })
    loadPromiseRef.current = wrappedPromise
    loadPromiseModeRef.current = requestedMode
    return wrappedPromise
  }, [branchApi, notify, tr, tab])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      loadPromiseModeRef.current = ''
      setLoading(false)
      return
    }
    const shouldSilentLoad = loadedOnceRef.current && !(tab === 'transfers' && !transfers.length)
    void load(shouldSilentLoad)
  }, [isActive, load, tab, transfers.length])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    setHistoryReady(true)
    return undefined
  }, [isActive, loading])

  /**
   * 3.2 Sync refresh hooks.
   * - Branch changes.
   * - Product changes (stock movement can affect branch views).
   */
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const channel = syncChannel.channel
    if (channel === 'branches' || channel === 'products' || channel === 'inventory') void load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    if (loadWatchdogRef.current) window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
    branchSearchTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    branchSearchTimersRef.current.clear()
  }, [])

  /**
   * 4. Derived State
   */
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches])
  const transferBranchOptions = useMemo(
    () => activeBranches.map((branch) => ({ id: branch.id, name: branch.name || `Branch ${branch.id}` })),
    [activeBranches],
  )
  // ReceiveBatchModal's AppSelect option shape ({value,label}), distinct
  // from TransferModal's ({id,name}) above.
  const receiveBranchSelectOptions = useMemo(
    () => activeBranches.map((branch) => ({ value: String(branch.id), label: branch.name || `Branch ${branch.id}` })),
    [activeBranches],
  )
  const visibleBranches = useMemo(() => branches.filter((branch) => (
    branchStatusFilter === 'all' ? true : branchStatusFilter === 'active' ? Boolean(branch.is_active) : !branch.is_active
  )), [branches, branchStatusFilter])
  const visibleTransfers = useMemo(() => transfers.filter((transferItem) => (
    (transferFromFilter === 'all' || String(transferItem.from_branch_id ?? '') === transferFromFilter)
    && (transferToFilter === 'all' || String(transferItem.to_branch_id ?? '') === transferToFilter)
  )), [transfers, transferFromFilter, transferToFilter])
  const branchFilterActiveCount = (branchStatusFilter !== 'all' ? 1 : 0)
    + (transferFromFilter !== 'all' ? 1 : 0) + (transferToFilter !== 'all' ? 1 : 0)
  const branchFilterSections = useMemo(() => (
    tab === 'branches'
      ? [{
          id: 'status',
          label: tr('status', 'Status'),
          options: [
            { id: 'all', label: tr('all', 'All'), active: branchStatusFilter === 'all', onClick: () => setBranchStatusFilter('all') },
            { id: 'active', label: tr('active', 'Active'), active: branchStatusFilter === 'active', onClick: () => setBranchStatusFilter('active') },
            { id: 'inactive', label: tr('inactive', 'Inactive'), active: branchStatusFilter === 'inactive', onClick: () => setBranchStatusFilter('inactive') },
          ],
        }]
      : [
          {
            id: 'from',
            label: tr('from_branch', 'From'),
            searchable: true,
            options: [
              { id: 'all', label: tr('all', 'All'), active: transferFromFilter === 'all', onClick: () => setTransferFromFilter('all') },
              ...transferBranchOptions.map((branch) => ({
                id: branch.id,
                label: branch.name,
                active: transferFromFilter === String(branch.id),
                onClick: () => setTransferFromFilter(String(branch.id)),
              })),
            ],
          },
          {
            id: 'to',
            label: tr('to_branch', 'To'),
            searchable: true,
            options: [
              { id: 'all', label: tr('all', 'All'), active: transferToFilter === 'all', onClick: () => setTransferToFilter('all') },
              ...transferBranchOptions.map((branch) => ({
                id: branch.id,
                label: branch.name,
                active: transferToFilter === String(branch.id),
                onClick: () => setTransferToFilter(String(branch.id)),
              })),
            ],
          },
        ]
  ), [tab, branchStatusFilter, transferFromFilter, transferToFilter, transferBranchOptions, tr])
  const clearBranchFilters = useCallback(() => {
    setBranchStatusFilter('all')
    setTransferFromFilter('all')
    setTransferToFilter('all')
  }, [])
  const selectedCount = selectedIds.size
  useEffect(() => {
    // Drop any selected id that the current status filter has hidden, so a
    // selection made under one filter (or via select-all) can never reach
    // bulk-delete for a branch the user isn't currently looking at.
    const validIds = new Set(visibleBranches.map((branch) => branch.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleBranches])
  const openStatDetail = useCallback((title: ReactNode, value: ReactNode, detail: ReactNode) => {
    setStatDetail({ title, value, detail })
  }, [])

  const buildBranchPayload = useCallback((branch: Partial<BranchRecord> = {}): BranchTransportPayload => ({
    name: branch.name || '',
    location: branch.location || '',
    phone: branch.phone || '',
    manager: branch.manager || '',
    notes: branch.notes || '',
    is_default: branch.is_default ? 1 : 0,
    is_active: branch.is_active ?? 1,
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

  const runBranchMutation = useCallback((loader: () => Promise<BranchMutationResult>, label: string) => (
    withLoaderTimeout(loader, label, BRANCH_MUTATION_TIMEOUT_MS)
  ), [])

  /**
   * 5. Branch Stock Expansion
   * 5.1 Lazy-load stock per branch on first open.
   */
  const loadBranchStock = async (branchId: string | number) => {
    if (expandedBranches.has(branchId)) {
      setExpandedBranches((prev) => {
        const next = new Set(prev)
        next.delete(branchId)
        return next
      })
      return
    }
    if (!branchStocks[branchId]) {
      try {
        const stock = await withLoaderTimeout(
          () => branchApi.getBranchStock(branchId, { page: 1, pageSize: 20, stockState: 'positive' }),
          'Branch stock',
          12000,
        )
        setBranchStocks((prev) => ({ ...prev, [branchId]: stock }))
      } catch (error) {
        notify(getErrorMessage(error, tr('failed_to_load_data', 'Failed to load data')), 'warning')
        return
      }
    }
    setExpandedBranches((prev) => new Set(prev).add(branchId))
  }

  const getBranchStockQuery = (branchId: string | number): string => (branchStockSearch[String(branchId)] ?? '').trim()

  const loadMoreBranchStock = async (branchId: string | number) => {
    const current = branchStocks[branchId]
    if (!current || Array.isArray(current)) return
    const nextPage = Number(current.page || 1) + 1
    if (nextPage > Number(current.totalPages || 1)) return
    const activeQuery = getBranchStockQuery(branchId)
    try {
      const stock = await withLoaderTimeout(
        () => branchApi.getBranchStock(branchId, {
          page: nextPage,
          pageSize: Number(current.pageSize || 20) || 20,
          stockState: current.stockState || 'positive',
          // Keep the active search on later pages, or "Show more" would
          // silently switch back to the unfiltered listing mid-scroll.
          ...(activeQuery ? { query: activeQuery } : {}),
        }),
        'More branch stock',
        12000,
      )
      const nextStockPage: BranchStockPage = Array.isArray(stock) ? { items: stock } : stock
      setBranchStocks((prev) => ({
        ...prev,
        [branchId]: {
          ...nextStockPage,
          // The stat tiles stay branch-wide during a search (see
          // runBranchStockSearch), so keep whichever summary is displayed
          // rather than adopting the query-filtered one from this page.
          summary: current.summary ?? nextStockPage.summary,
          items: [...(current.items || []), ...(nextStockPage.items || [])],
        },
      }))
    } catch (error) {
      notify(getErrorMessage(error, tr('failed_to_load_data', 'Failed to load data')), 'warning')
    }
  }

  // Debounced per-branch search: refetch page 1 with the query. The mini
  // stat tiles deliberately KEEP the branch-wide summary while a search is
  // active -- the endpoint recomputes its summary under the query filter,
  // which would make "Total 17" flicker to "Total 2" as someone types.
  const runBranchStockSearch = async (branchId: string | number, rawQuery: string) => {
    const query = rawQuery.trim()
    try {
      const stock = await withLoaderTimeout(
        () => branchApi.getBranchStock(branchId, { page: 1, pageSize: 20, stockState: 'positive', ...(query ? { query } : {}) }),
        'Branch stock search',
        12000,
      )
      setBranchStocks((prev) => {
        const previous = prev[branchId]
        const previousSummary = previous && !Array.isArray(previous) ? previous.summary : undefined
        const next: BranchStockState = Array.isArray(stock) || !query || !previousSummary
          ? stock
          : { ...stock, summary: previousSummary }
        return { ...prev, [branchId]: next }
      })
    } catch (error) {
      notify(getErrorMessage(error, tr('failed_to_load_data', 'Failed to load data')), 'warning')
    }
  }

  const handleBranchStockSearchChange = (branchId: string | number, value: string) => {
    const key = String(branchId)
    setBranchStockSearch((prev) => ({ ...prev, [key]: value }))
    const timers = branchSearchTimersRef.current
    const existing = timers.get(key)
    if (existing) window.clearTimeout(existing)
    timers.set(key, window.setTimeout(() => {
      timers.delete(key)
      void runBranchStockSearch(branchId, value)
    }, 350))
  }

  // Refetch page 1 of one branch's stock in place (section stays expanded)
  // -- used after a receive so the new quantity shows without collapsing
  // or nuking every other branch's cache the way the transfer path does.
  const refreshBranchStock = async (branchId: string | number) => {
    // Post-receive refresh routes through the search-aware fetch so an
    // active per-branch search survives receiving stock into that branch.
    await runBranchStockSearch(branchId, getBranchStockQuery(branchId))
  }

  /**
   * 6. CRUD Actions
   */
  const handleSaveBranch = async (form: BranchFormPayload) => {
    if (!beginSingleAction(saveInFlightRef)) return
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload: BranchTransportPayload = {
        ...form,
        is_default: form.is_default ? 1 : 0,
        is_active: form.is_active ? 1 : 0,
        userId: user?.id,
        userName: user?.name,
      }
      const res = selected
        ? await runBranchMutation(() => branchApi.updateBranch(selected.id, payload), 'Update branch')
        : await runBranchMutation(() => branchApi.createBranch(payload), 'Create branch')
      if (res?.success === false) {
        notify(res.error || 'Failed to save branch', 'error')
        return
      }
      let createdBranchId = extractHistoryResultId(res)
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit branch ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          // Declarative payloads (K1): the server's 'branch.update' applier can
          // replay a branch edit by itself, so undo/redo survive a page reload
          // where these closures are gone. undo restores the pre-edit fields,
          // redo the post-edit fields. When the server applies it (response
          // applied:true) the hook calls `refresh` instead of the closure, so
          // there is no redundant/conflicting second write; when it does not
          // (older server), the closures below run exactly as before.
          undo_payload: { applier: 'branch.update', id: selected.id, fields: buildBranchPayload(existingSnapshot) },
          redo_payload: { applier: 'branch.update', id: selected.id, fields: buildBranchPayload(nextSnapshot) },
          refresh: async () => { await load() },
          undo: async () => {
            const result = await runBranchMutation(
              () => branchApi.updateBranch(existingSnapshot.id, buildBranchPayload(existingSnapshot)),
              'Undo branch edit',
            )
            if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
            await load()
          },
          redo: async () => {
            const result = await runBranchMutation(
              () => branchApi.updateBranch(nextSnapshot.id, buildBranchPayload(nextSnapshot)),
              'Redo branch edit',
            )
            if (result?.success === false) throw new Error(result.error || 'Failed to reapply branch changes')
            await load()
          },
        })
      } else if (createdBranchId > 0) {
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdBranchId })
        actionHistory.pushAction({
          label: `Add branch ${createdSnapshot.name || ''}`.trim(),
          undo: async () => {
            const result = await runBranchMutation(
              () => branchApi.deleteBranch(createdBranchId, user?.id, user?.name),
              'Undo branch create',
            )
            if (result?.success === false) throw new Error(result?.error || 'Failed to undo branch creation')
            await load()
          },
          redo: async () => {
            const result = await runBranchMutation(
              () => branchApi.createBranch(buildBranchPayload(createdSnapshot)),
              'Redo branch create',
            )
            if (result?.success === false) throw new Error(result.error || 'Failed to recreate branch')
            createdBranchId = extractHistoryResultId(result)
            await load()
          },
        })
      }
      notify(selected ? tr('branch_updated', 'Branch updated') : tr('branch_created', 'Branch created'))
      setModal(null)
      setSelected(null)
      await load()
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to save branch'), 'error')
    } finally {
      finishSingleAction(saveInFlightRef)
    }
  }

  const handleDelete = async (branch: BranchRecord) => {
    if (!beginSingleAction(deleteInFlightRef)) return
    if (!window.confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(branch)
      const res = await runBranchMutation(
        () => branchApi.deleteBranch(branch.id, user?.id, user?.name),
        'Delete branch',
      )
      // deleteBranch's direct (non-review) success returns {} with no `success`
      // flag; a real failure is thrown. Gating on `!res?.success` showed "Cannot
      // delete branch" on a delete that actually succeeded. Only an explicit
      // success:false is a failure here.
      if (res?.success === false) {
        notify(res?.error || 'Cannot delete branch', 'error')
        return
      }
      let restoredBranchId = 0
      actionHistory.pushAction({
        label: `Delete branch ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const result = await runBranchMutation(
            () => branchApi.createBranch(buildBranchPayload(snapshot)),
            'Undo branch delete',
          )
          if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
          restoredBranchId = extractHistoryResultId(result)
          await load()
        },
        redo: async () => {
          const targetId = restoredBranchId || Number(snapshot.id || 0)
          if (!targetId) return
          const result = await runBranchMutation(
            () => branchApi.deleteBranch(targetId, user?.id, user?.name),
            'Redo branch delete',
          )
          if (result?.success === false) throw new Error(result?.error || 'Failed to delete branch again')
          await load()
        },
      })
      notify(tr('branch_deleted', 'Branch deleted'))
      await load()
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete branch'), 'error')
    } finally {
      finishSingleAction(deleteInFlightRef)
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedCount) return
    if (!beginSingleAction(bulkDeleteInFlightRef, { blocked: bulkDeleteBusy })) return
    const toDelete = branches.filter((branch) => selectedIds.has(branch.id) && !branch.is_default)
    if (!toDelete.length) {
      finishSingleAction(bulkDeleteInFlightRef)
      notify(tr('cannot_delete_default_branch', 'Cannot delete default branch'), 'error')
      return
    }
    if (!window.confirm(`Delete ${toDelete.length} branch(es)? This cannot be undone.`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }

    setBulkDeleteBusy(true)
    try {
      const deletedSnapshots = toDelete.map((branch) => ({ ...branch }))
      const deleteRun = await runConcurrentTasks<BranchRecord, number>(toDelete, async (branch: BranchRecord) => {
        const result = await runBranchMutation(
          () => branchApi.deleteBranch(branch.id, user?.id, user?.name),
          'Bulk delete branches',
        )
        if (result?.success === false) throw new Error(result?.error || 'Failed to delete branch')
        return Number(branch.id || 0)
      })
      const failedIds = deleteRun.failures
        .map((entry) => Number(entry.item?.id || 0))
        .filter((id) => Number.isFinite(id) && id > 0)
      const failed = failedIds.length
      setSelectedIds(new Set(failedIds))
      await load()
      const restoredSnapshots = deletedSnapshots.filter((branch) => !failedIds.includes(Number(branch?.id || 0)))
      if (restoredSnapshots.length) {
        let restoredEntries: RestoredBranchEntry[] = []
        actionHistory.pushAction({
          label: `Delete ${restoredSnapshots.length} branch${restoredSnapshots.length === 1 ? '' : 'es'}`,
          undo: async () => {
            const restoreRun = await runConcurrentTasks<BranchRecord, RestoredBranchEntry>(restoredSnapshots, async (snapshot: BranchRecord) => {
              const result = await runBranchMutation(() => branchApi.createBranch({
                name: snapshot.name || '',
                location: snapshot.location || '',
                phone: snapshot.phone || '',
                manager: snapshot.manager || '',
                notes: snapshot.notes || '',
                is_default: snapshot.is_default ? 1 : 0,
                is_active: snapshot.is_active ?? 1,
                userId: user?.id,
                userName: user?.name,
              }), 'Restore deleted branches')
              if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
              return { originalId: snapshot.id, restoredId: Number(result?.id || result?.data?.id || 0) }
            })
            if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore branch'))
            restoredEntries = restoreRun.successes.map((entry) => entry.value)
            await load()
          },
          redo: async () => {
            const idsToDelete = restoredEntries.length
              ? restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
              : restoredSnapshots.map((snapshot) => Number(snapshot.id || 0)).filter((id) => id > 0)
            const redoRun = await runConcurrentTasks<number, void>(idsToDelete, async (branchId: number) => {
              const result = await runBranchMutation(
                () => branchApi.deleteBranch(branchId, user?.id, user?.name),
                'Redo bulk branch delete',
              )
              if (result?.success === false) throw new Error(result?.error || 'Failed to re-delete branch')
            })
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete branch'))
            await load()
          },
        })
      }
      if (failed > 0) {
        notify(tr('bulk_delete_partial_fail', '{n} branch(es) could not be deleted.').replace('{n}', String(failed)), 'error')
        return
      }
      notify(tr('bulk_deleted_count', '{n} branch(es) deleted').replace('{n}', String(toDelete.length)))
    } finally {
      finishSingleAction(bulkDeleteInFlightRef)
      setBulkDeleteBusy(false)
    }
  }

  /**
   * 7. Selection Utilities
   */
  const toggleSelect = (id: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set<string | number>(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // H1+X5 (Part 403): per-branch stock export -- the unpaged
  // GET /branches/:id/stock (no query params) returns EVERY product with
  // its quantity for that branch in one response, so no page loop; one
  // fetch per active branch, flattened into Branch-per-row records for the
  // shared options dialog.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  const [branchExportLoading, setBranchExportLoading] = useState(false)
  const openBranchStockExport = useCallback(async () => {
    if (branchExportLoading) return
    setBranchExportLoading(true)
    try {
      const rows: Array<Record<string, unknown>> = []
      for (const branch of branches) {
        const stock = await getBranchStockRequest(branch.id, {}) as Array<Record<string, unknown>> | null
        for (const product of Array.isArray(stock) ? stock : []) {
          const quantity = Number(product.branch_quantity || 0)
          const costUsd = Number(product.purchase_price_usd || 0)
          rows.push({
            Branch: branch.name || `Branch ${branch.id}`,
            Product: product.name || '',
            SKU: product.sku || '',
            Unit: product.unit || '',
            Quantity: quantity,
            Selling_USD: Number(product.selling_price_usd || 0),
            Cost_USD: costUsd,
            Stock_Value_USD: Math.round(quantity * costUsd * 100) / 100,
          })
        }
      }
      if (!rows.length) {
        notify(tr('no_data_to_export', 'No data to export'), 'error')
        return
      }
      setExportDialog({ rows, baseName: 'branch-stock' })
    } catch (error) {
      notify(error instanceof Error && error.message ? error.message : tr('export_failed', 'Export failed.'), 'error')
    } finally {
      setBranchExportLoading(false)
    }
  }, [branchExportLoading, branches, notify, tr])

  // 11.1/11.2 (B6): same selection model as the table pages -- checkboxes
  // only exist while something is selected, entered by long-pressing a
  // branch card. Branches is a card list with no column header, so the
  // select-all checkbox lives on the list-top row that only renders in
  // select mode (the card list's equivalent of the table header).
  const selectionModeActive = selectedIds.size > 0
  const branchLongPressStateByIdRef = useRef<Map<string | number, LongPressState>>(new Map())
  const getBranchLongPressState = (branchId: string | number): LongPressState => {
    const existing = branchLongPressStateByIdRef.current.get(branchId)
    if (existing) return existing
    const created = createLongPressState()
    branchLongPressStateByIdRef.current.set(branchId, created)
    return created
  }

  const toggleSelectAll = () => {
    // Scope select-all to the currently *visible* (filtered) branches, not the
    // full unfiltered list — otherwise selecting-all under an active status
    // filter silently selects branches the user can't see on screen, and a
    // subsequent bulk delete removes rows the filter had hidden from view.
    if (selectedCount === visibleBranches.length && visibleBranches.length > 0) {
      setSelectedIds(new Set<string | number>())
      return
    }
    setSelectedIds(new Set<string | number>(visibleBranches.map((branch) => branch.id)))
  }

  return (
    <div className={`flex min-h-0 flex-col ${embedded ? 'flex-1 px-3 pb-3 pt-1 sm:px-6 sm:pb-6 sm:pt-2' : 'page-scroll p-3 sm:p-6'}`}>
      {/* The aggregate Branches / Items / Value stat cards that used to sit
          here (above the Branches / Transfer History tabs) were removed
          (user, Aug 29: "remove the stats above the branches/transfers
          section"). The per-branch stat tiles inside each expanded branch
          below are kept, and the Inventory-moved "Stats" hub section is kept. */}

      {loadError && !loading && !branches.length && !transfers.length ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold">{tr('page_load_warning', 'Page could not finish loading')}</div>
          <div className="mt-1">{loadError}</div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            onClick={() => load(false)}
          >
            {tr('retry', 'Retry')}
          </button>
        </div>
      ) : null}

      {/* Toolbar + tabs/filter both pin to the top of the page's scroll
          container together -- same `sticky top-2` treatment as
          Products/Inventory/Sales/Returns (Aug 11 2026 UI-polish request),
          extended (Aug 13 2026) to cover the toolbar row too. These used
          to be two separate blocks with only the tabs row sticky; the
          toolbar (History/Transfer/Add Branch/Delete) sat in normal flow
          just above it, so scrolling down -- e.g. after expanding a
          branch's stock list, exactly what the reported screenshot
          showed -- slid that whole row up and under the sticky tabs bar,
          leaving Add Branch (and the rest) hidden/unreachable behind it
          rather than staying reachable like the rest of the page's sticky
          toolbars. Merging them into one sticky unit keeps every button
          on-screen and tappable regardless of scroll position. The
          select-all row below stays non-sticky and un-moved -- it only
          renders inside the 'branches' tab (conditional on
          `visibleBranches.length`), the 'transfers' tab has no equivalent,
          and pulling a tab-conditional row up into this always-rendered
          wrapper would change its behavior, not just its position. */}
      <div className="sticky top-2 z-30 -mx-1 mb-4 space-y-3 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        {/* Merged toolbar row. On phones (user-reported "buttons on each
            other"): four equal flex-1 buttons gave History only ~1/4 of a
            narrow row, and its nowrap "History" label overflowed its box into
            Transfer -- so History and Add Branch (the two labelled controls)
            stay flex-1 while Transfer and Export collapse to compact icon-only
            buttons (flex-none, label hidden below sm), freeing the width
            History needs. From sm up all four go back to equal-share flex-1
            with labels. Bulk-delete stays a fixed-width contextual button
            (only shown once something's selected), a rare high-stakes action
            rather than a fixed toolbar control. */}
        <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pt-1">
          <ActionHistoryBar history={actionHistory as unknown as ActionHistoryProp} t={t} className="min-w-0 flex-1" showLabel />
          {selectedCount > 0 ? (
            <button className="btn-danger flex-shrink-0 text-sm" onClick={handleBulkDelete} disabled={bulkDeleteBusy}>
              <Trash2 className="h-4 w-4" />
              <span>{tr('delete', 'Delete')} ({selectedCount})</span>
            </button>
          ) : null}
          {canTransferStock ? (
            <button
              className="inline-flex h-9 min-w-9 flex-none items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300 sm:flex-1 sm:text-sm"
              onClick={() => setModal('transfer')}
              title={tr('transfer', 'Transfer')}
              aria-label={tr('transfer', 'Transfer')}
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">{tr('transfer', 'Transfer')}</span>
            </button>
          ) : null}
          {/* H1+X5 (Part 403): Branches had NO export at all -- this one
              covers H1's "per-branch stock" spec through the shared options
              dialog (Excel/CSV/PDF + column chooser). */}
          <button
            className="inline-flex h-9 min-w-9 flex-none items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-500 dark:hover:bg-slate-700/80 dark:hover:text-emerald-300 sm:flex-1 sm:text-sm"
            onClick={() => { void openBranchStockExport() }}
            disabled={branchExportLoading}
            title={tr('export_branch_stock', 'Export per-branch stock')}
            aria-label={tr('export_branch_stock', 'Export per-branch stock')}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="hidden truncate sm:inline">{branchExportLoading ? tr('exporting', 'Exporting…') : tr('export', 'Export')}</span>
          </button>
          <button
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 hover:border-blue-800 sm:text-sm"
            onClick={() => { setSelected(null); setModal('form') }}
            title={tr('add_branch', 'Add Branch')}
            aria-label={tr('add_branch', 'Add Branch')}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr('add_branch', 'Add Branch')}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pt-1 dark:border-gray-700">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'branches' as BranchTab, label: tr('branches', 'Branches') },
              { id: 'transfers' as BranchTab, label: tr('transfer_history', 'Transfer History') },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-1">
            <FilterMenu
              label={tr('filters', 'Filters')}
              activeCount={branchFilterActiveCount}
              sections={branchFilterSections}
              onClear={branchFilterActiveCount > 0 ? clearBranchFilters : null}
              compact
            />
          </div>
        </div>
      </div>

      {tab === 'branches' ? (
        <div className="space-y-3">
          {loading && !branches.length ? (
            <div className="space-y-3" aria-hidden="true">
              {[0, 1].map((index) => (
                <div key={`branch-loading-${index}`} className="card p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-5 w-40 max-w-[70%] rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-3 w-52 max-w-[85%] rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="h-3 w-36 max-w-[60%] rounded bg-slate-100 dark:bg-slate-800" />
                    </div>
                    <div className="h-7 w-20 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* 11.2 (B6): no standing "Select all (N)" control -- this row only
              exists in select mode, where its checkbox is the select-all. */}
          {!loading && visibleBranches.length > 0 && selectionModeActive ? (
            <div className="flex items-center gap-3 px-2">
              <input
                id="branches-select-all"
                name="branches_select_all"
                aria-label="Select all branches"
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={selectedCount === visibleBranches.length && visibleBranches.length > 0}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = selectedCount > 0 && selectedCount < visibleBranches.length
                  }
                }}
                onChange={toggleSelectAll}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {`${selectedCount} selected`}
              </span>
            </div>
          ) : null}

          {!loading && branches.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p>{tr('no_data', 'No data')}</p>
            </div>
          ) : null}

          {!loading && branches.length > 0 && visibleBranches.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p>{tr('no_filter_matches', 'No branches match the current filter')}</p>
            </div>
          ) : null}

          {visibleBranches.map((branch) => {
            const isExpanded = expandedBranches.has(branch.id)
            const stockState = branchStocks[branch.id] || null
            const stockRows = Array.isArray(stockState) ? stockState : (Array.isArray(stockState?.items) ? stockState.items : [])
            const inStock = stockRows.filter((product) => Number(product.branch_quantity || 0) > 0)
            const stockSummary = !Array.isArray(stockState) ? stockState?.summary || {} : {}
            const totalProducts = Number(stockSummary.total_products ?? stockSummary.total_product ?? stockRows.length)
            // `in_stock_products` (routes/branches.ts) is already the
            // combined healthy+low figure -- only fall back to the row-based
            // `positive_products`/`inStock.length` counts when the family-
            // aware summary hasn't loaded at all, never add low on top of it.
            const stockCount = Number(stockSummary.in_stock_products ?? stockSummary.positive_products ?? inStock.length)
            const healthyCount = Number(stockSummary.healthy_products ?? 0)
            const lowStockCount = Number(stockSummary.low_stock_products ?? 0)
            const outStockCount = Number(stockSummary.out_of_stock_products ?? 0)
            const totalValue = Number(stockSummary.positive_value_usd ?? stockSummary.total_value_usd ?? 0)

            const cardLongPressState = getBranchLongPressState(branch.id)
            const cardLongPress = createLongPressHandlers(cardLongPressState, {
              disabled: selectionModeActive,
              onLongPress: () => {
                if (!selectedIds.has(branch.id)) toggleSelect(branch.id)
              },
              // No onClick: a plain tap on the card keeps hitting whatever
              // inner control it landed on (expand, manage, transfer).
            })
            return (
              <div
                key={branch.id}
                className={`card select-none overflow-hidden transition-all ${selectedIds.has(branch.id) ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}
                {...(selectionModeActive ? {} : cardLongPress)}
                // The ghost click that follows a fired long-press would land
                // on an inner control (e.g. the expand button) -- swallow it
                // in the capture phase so entering select mode doesn't also
                // toggle whatever sat under the finger.
                onClickCapture={(event) => {
                  if (consumeLongPressClick(cardLongPressState)) {
                    event.preventDefault()
                    event.stopPropagation()
                  }
                }}
              >
                <div className="p-3 sm:p-4">
                  <div className="flex items-start gap-2">
                    {selectionModeActive ? (
                    <input
                      id={`branch-select-${branch.id}`}
                      name={`branch_select_${branch.id}`}
                      aria-label={`Select branch ${branch.name}`}
                      type="checkbox"
                      className="mt-1 h-4 w-4 flex-shrink-0 rounded"
                      checked={selectedIds.has(branch.id)}
                      onChange={() => toggleSelect(branch.id)}
                    />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        {/* The whole name/details block is now the click
                            target for expanding/collapsing the stock
                            section below, not just the small 28px Warehouse
                            icon button in the toolbar to the right -- a much
                            more forgiving tap target for something people
                            reach for constantly, plus a chevron so the
                            row's expand/collapse affordance is visible at a
                            glance (same ChevronDown/ChevronRight pattern
                            already used for the collapsible transfer groups
                            further down this file). The Warehouse icon
                            button stays as a second, equally valid way to
                            trigger the same toggle -- both call the same
                            loadBranchStock, so there's no risk of the two
                            controls disagreeing about the section's state. */}
                        <button
                          type="button"
                          onClick={() => loadBranchStock(branch.id)}
                          className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                          aria-expanded={isExpanded}
                          title={isExpanded ? tr('hide_stock', 'Hide Stock') : tr('stock', 'Stock')}
                        >
                          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
                              : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />}
                            <span className="text-base font-bold text-gray-900 dark:text-white">{branch.name}</span>
                            {branch.is_default ? <span className="badge-blue text-xs">{tr('default_branch', 'Default')}</span> : null}
                            {branch.is_active
                              ? <span className="badge-green text-xs">{tr('active', 'Active')}</span>
                              : <span className="badge-red text-xs">{tr('inactive', 'Inactive')}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0 pl-5 text-xs text-gray-500 dark:text-gray-400">
                            {branch.location ? <span>{branch.location}</span> : null}
                            {branch.phone ? <span>{branch.phone}</span> : null}
                            {branch.manager ? <span>{branch.manager}</span> : null}
                          </div>
                          {branch.notes ? <p className="mt-0.5 truncate pl-5 text-xs text-gray-400">{branch.notes}</p> : null}
                        </button>
                        <div className="flex max-w-full flex-shrink-0 items-center gap-1 overflow-x-auto pb-1">
                          <button
                            onClick={() => loadBranchStock(branch.id)}
                            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                            title={isExpanded ? tr('hide_stock', 'Hide Stock') : tr('stock', 'Stock')}
                            aria-label={isExpanded ? tr('hide_stock', 'Hide Stock') : tr('stock', 'Stock')}
                          >
                            <Warehouse className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => { setSelected(branch); setModal('form') }}
                            className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                            title={tr('edit', 'Edit')}
                            aria-label={tr('edit', 'Edit')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {!branch.is_default ? (
                            <button
                              onClick={() => handleDelete(branch)}
                              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
                              title={tr('delete', 'Delete')}
                              aria-label={tr('delete', 'Delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
                          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid w-full min-w-0 grid-cols-3 gap-1.5 sm:max-w-3xl sm:gap-2 lg:grid-cols-6">
                              {[
                                { key: 'total', label: tr('total_short', 'Total'), value: totalProducts, color: 'text-gray-900 dark:text-white', detail: tr('branch_stock_total_detail', 'All products returned by this branch stock view (one per product group, matching the listing).') },
                                // `stockCount` is already the combined healthy+low figure
                                // (in_stock_products) -- adding lowStockCount on top of it
                                // double-counted every low-stock product here too.
                                { key: 'in', label: tr('in_stock_short', 'In Stock'), value: stockCount, color: 'text-green-600 dark:text-green-300', detail: tr('branch_stock_in_detail', 'Products in this branch with positive stock (includes both healthy and low stock; {n} of these are healthy, above the low stock threshold).').replace('{n}', String(healthyCount)) },
                                { key: 'healthy', label: tr('healthy_stock_short', 'Healthy'), value: healthyCount, color: 'text-teal-600 dark:text-teal-300', detail: tr('branch_stock_healthy_detail', 'Products in this branch above their low stock threshold (a strict subset of In Stock).') },
                                { key: 'low', label: tr('low_stock_short', 'Low'), value: lowStockCount, color: 'text-amber-600 dark:text-amber-300', detail: tr('branch_stock_low_detail', 'Products in this branch at or below low stock threshold.') },
                                { key: 'out', label: tr('out_of_stock_short', 'Out'), value: outStockCount, color: 'text-red-600 dark:text-red-300', detail: tr('branch_stock_out_detail', 'Products in this branch at or below out of stock threshold.') },
                                { key: 'value', label: tr('stock_value_short', 'Value'), value: fmtUSD(totalValue), color: 'text-blue-600 dark:text-blue-300', detail: tr('branch_stock_value_detail', 'Estimated value for positive branch stock.') },
                              ].map(({ key, label, value, color, detail }) => (
                                <BranchStatTile
                                  key={`${branch.id}-${key}`}
                                  label={label}
                                  value={value}
                                  color={color}
                                  detail={detail}
                                  onClick={() => openStatDetail(label, value, `${branch.name}: ${detail}`)}
                                />
                              ))}
                            </div>
                            <span className="hidden text-sm font-semibold text-gray-700 dark:text-gray-300">
                              {tr('branch_stock_count', '{n} products in stock').replace('{n}', String(stockCount))}
                              {' | '}
                              {tr('branch_stock_value', 'Value')}: <span className="text-blue-600">{fmtUSD(totalValue)}</span>
                            </span>
                            <button onClick={() => setModal('transfer')} disabled={!canTransferStock} className="text-xs text-blue-500 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:disabled:text-slate-500">
                              {tr('transfer_stock_link', 'Transfer stock')}
                            </button>
                          </div>

                          {/* Per-branch product search (user, Aug 30: "search
                              function ... above the each branch['s products] and
                              below the mini sections") -- server-backed, so it
                              finds products beyond the 20 rows already loaded. */}
                          <div className="mb-2">
                            <input
                              id={`branch-stock-search-${branch.id}`}
                              name={`branch_stock_search_${branch.id}`}
                              type="search"
                              className="input h-9 w-full text-sm sm:max-w-xs"
                              placeholder={tr('branch_stock_search_placeholder', 'Search products in this branch')}
                              aria-label={`${tr('branch_stock_search_placeholder', 'Search products in this branch')} — ${branch.name || ''}`}
                              value={branchStockSearch[String(branch.id)] ?? ''}
                              onChange={(event) => handleBranchStockSearchChange(branch.id, event.target.value)}
                            />
                          </div>

                          {inStock.length === 0 ? (
                            <p className="rounded-lg bg-gray-50 py-4 text-center text-sm text-gray-400 dark:bg-gray-700/30">
                              {getBranchStockQuery(branch.id)
                                ? tr('branch_stock_search_no_matches', 'No products in this branch match the search.')
                                : tr('no_branch_stock', 'No stock in this branch. Use Transfer or Adjust Stock to add items.')}
                            </p>
                          ) : (
                            <>
                              {/* One column on phones, wider row-cards after: the row layout
                                  (name left, qty right) needs the width; 4-5 skinny columns
                                  truncated every real product name. */}
                              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                                {buildProductGroups(inStock).flatMap((group) => {
                                  const cards = group.rows.map((row) => {
                                    const product = row as unknown as BranchStockProduct
                                    // Neutral surface + a thin colored left edge and colored qty,
                                    // replacing the old solid red/yellow card fills -- with real
                                    // catalog data most rows are low-stock, so the grid rendered
                                    // as a wall of loud yellow/red blocks (reported as the expanded
                                    // branch's product info looking "very ugly"). One row per card:
                                    // name+SKU left, qty right, receive at the edge.
                                    const cardQty = Number(product.branch_quantity || 0)
                                    const stockTone = cardQty <= Number(product.out_of_stock_threshold || 0)
                                      ? 'out'
                                      : cardQty <= Number(product.low_stock_threshold || 10) ? 'low' : 'ok'
                                    return (
                                    <div
                                      key={product.id}
                                      className={`flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 border-l-4 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
                                        stockTone === 'out'
                                          ? 'border-l-red-400 dark:border-l-red-500'
                                          : stockTone === 'low'
                                            ? 'border-l-amber-400 dark:border-l-amber-500'
                                            : 'border-l-emerald-400 dark:border-l-emerald-500'
                                      }`}
                                    >
                                      {/* Qty sits right AFTER the name (user, Aug 30: "much
                                          spaces between the name and stock quantity") -- the
                                          name block no longer stretches (no flex-1), only the
                                          receive button floats to the card edge (ml-auto). */}
                                      <div className="min-w-0">
                                        <div className="truncate font-medium text-gray-800 dark:text-gray-200">{product.name}</div>
                                        {product.sku ? <div className="truncate font-mono text-[10px] leading-tight text-gray-400">{product.sku}</div> : null}
                                      </div>
                                      <span
                                        className={`shrink-0 whitespace-nowrap text-sm font-bold tabular-nums ${
                                          stockTone === 'out' ? 'text-red-600 dark:text-red-400' : stockTone === 'low' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                                        }`}
                                      >
                                        {product.branch_quantity} {product.unit}
                                      </span>
                                      {/* D4b: receive stock into THIS branch from right here --
                                          the same shared ReceiveBatchModal (batch picker +
                                          received date) every other entry point uses. */}
                                      {canReceiveStock ? (
                                        <button
                                          type="button"
                                          className="ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/40 dark:hover:text-blue-300"
                                          title={tr('receive_batch', 'Receive Batch')}
                                          aria-label={`${tr('receive_batch', 'Receive Batch')} — ${product.name || ''}`}
                                          onClick={() => setReceiveTarget({ product, branchId: String(branch.id) })}
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                    )
                                  })
                                  // Grouped products (same name, different branch/price/barcode/etc.)
                                  // get a full-width wrapping title row above their variant cards --
                                  // "wrap title with rows below" -- instead of each variant looking
                                  // like an unrelated standalone product. `col-span-full` makes this
                                  // header break onto its own row in the surrounding CSS grid without
                                  // disturbing the packed layout of standalone (non-grouped) cards.
                                  // Clicking the title collapses/expands the cards below it, so a
                                  // branch with many same-name variants doesn't turn into a wall of
                                  // near-identical cards -- same "click title to expand" convention
                                  // as the Products/Inventory group headers.
                                  if (group.rows.length <= 1) return cards
                                  const groupToggleKey = `${branch.id}:${group.key}`
                                  const groupCollapsed = collapsedBranchGroups.has(groupToggleKey)
                                  const qtyTotal = group.rows.reduce((sum, row) => sum + Number((row as unknown as BranchStockProduct).branch_quantity || 0), 0)
                                  const groupUnit = String((group.rows[0] as unknown as BranchStockProduct)?.unit || '')
                                  return [
                                    <button
                                      type="button"
                                      key={`${group.key}-header`}
                                      onClick={() => toggleBranchGroup(groupToggleKey)}
                                      className="col-span-full flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-left text-xs transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                                    >
                                      {groupCollapsed ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />}
                                      <span className="truncate font-semibold text-slate-700 dark:text-slate-200">{group.name}</span>
                                      <span className="flex-shrink-0 rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                        {group.rows.length}
                                      </span>
                                      <span className="flex-shrink-0 truncate text-[10px] text-slate-500 dark:text-slate-400">
                                        {qtyTotal} {groupUnit}
                                      </span>
                                    </button>,
                                    ...(groupCollapsed ? [] : cards),
                                  ]
                                })}
                              </div>
                              {!Array.isArray(stockState) && Number(stockState.page || 1) < Number(stockState.totalPages || 1) ? (
                                <div className="mt-3 flex justify-center">
                                  <button type="button" onClick={() => loadMoreBranchStock(branch.id)} className="btn-secondary px-3 py-1.5 text-xs">
                                    Show more stock
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {tab === 'transfers' ? (
        <>
          <div className="space-y-2 sm:hidden">
            {loading && !transfers.length ? (
              <div className="card py-10 text-center text-gray-400">{tr('loading', 'Loading...')}</div>
            ) : transfers.length === 0 ? (
              <div className="card py-10 text-center text-gray-400">{tr('no_data', 'No data')}</div>
            ) : visibleTransfers.length === 0 ? (
              <div className="card py-10 text-center text-gray-400">{tr('no_filter_matches', 'No transfers match the current filter')}</div>
            ) : visibleTransfers.map((transfer) => (
              <div key={transfer.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{transfer.product_name}</div>
                    <div className="mt-1 text-xs text-gray-400">{formatTransferDate(transfer.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{transfer.quantity}</div>
                    <div className="text-[10px] text-gray-400">{tr('quantity', 'Qty')}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="badge-red text-xs">{transfer.from_name || 'N/A'}</span>
                  <span className="badge-green text-xs">{transfer.to_name || 'N/A'}</span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <div>{transfer.note || '-'}</div>
                  <div>{transfer.user_name || 'N/A'}</div>
                </div>
              </div>
            ))}
          </div>

        <div className="card hidden flex-col sm:flex">
          <div className="overflow-x-auto">
            <table className="table-bordered w-full text-sm" style={{ minWidth: 640 }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('date', 'Date')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('product_name', 'Product')}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('from_branch', 'From')}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('to_branch', 'To')}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('transfer_note', 'Note')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('user', 'User')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && !transfers.length ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{tr('loading', 'Loading...')}</td></tr>
                ) : transfers.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{tr('no_data', 'No data')}</td></tr>
                ) : visibleTransfers.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{tr('no_filter_matches', 'No transfers match the current filter')}</td></tr>
                ) : visibleTransfers.map((transfer) => (
                  <tr key={transfer.id} className="table-row">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-400">{formatTransferDate(transfer.created_at)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{transfer.product_name}</td>
                    <td className="px-4 py-2.5"><span className="badge-red text-xs">{transfer.from_name || 'N/A'}</span></td>
                    <td className="px-4 py-2.5"><span className="badge-green text-xs">{transfer.to_name || 'N/A'}</span></td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-white">{transfer.quantity}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{transfer.note || '-'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{transfer.user_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
            {tr('transfers_count', '{n} transfers').replace('{n}', String(visibleTransfers.length))}
          </div>
        </div>
        </>
      ) : null}

      {modal === 'form' ? (
        <Modal title={selected ? `${tr('edit_branch', 'Edit Branch')}: ${selected.name}` : `+ ${tr('add_branch', 'Add Branch')}`} onClose={() => setModal(null)}>
          <BranchForm branch={selected} onSave={handleSaveBranch} onClose={() => setModal(null)} />
        </Modal>
      ) : null}

      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey="branches"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}
      {modal === 'transfer' ? (
        <Suspense fallback={null}>
          <LazyTransferModal
            branches={transferBranchOptions}
            onClose={() => setModal(null)}
            onDone={() => {
              setModal(null)
              load()
              setBranchStocks({})
            }}
            user={user || undefined}
            notify={notify}
          />
        </Suspense>
      ) : null}
      {receiveTarget ? (
        <Suspense fallback={null}>
          <LazyReceiveBatchModal
            product={{ id: receiveTarget.product.id, name: receiveTarget.product.name || '', unit: receiveTarget.product.unit || '' }}
            branchSelectOptions={receiveBranchSelectOptions}
            defaultBranchId={receiveTarget.branchId}
            notify={notify}
            onClose={() => setReceiveTarget(null)}
            onReceived={() => {
              const branchId = receiveTarget.branchId
              setReceiveTarget(null)
              void refreshBranchStock(branchId)
            }}
            t={t}
            tr={(key: string, fallbackEn = '', _fallbackKm = fallbackEn) => tr(key, fallbackEn)}
          />
        </Suspense>
      ) : null}

      {statDetail ? (
        <Modal title={statDetail.title} onClose={() => setStatDetail(null)}>
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/70">
              <div className="text-xs font-semibold uppercase text-slate-400">{statDetail.title}</div>
              <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{statDetail.value}</div>
            </div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{statDetail.detail}</p>
            <div className="flex justify-end">
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setStatDetail(null)}>
                {tr('close', 'Close')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
