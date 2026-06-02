import type { ComponentProps, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import Modal from '../shared/Modal'
import PageHeader from '../shared/PageHeader'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { useIsPageActive } from '../shared/pageActivity'
import BranchForm from './BranchForm'
import TransferModal from './TransferModal'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
  withLoaderTimeout,
} from '../../utils/loaders.ts'

/**
 * 1. Branches Page
 * 1.1 Purpose
 * - Manage branch records.
 * - Transfer inventory between branches.
 * - Review transfer history.
 */

const BRANCHES_LIST_TIMEOUT_MS = 10000
const BRANCHES_SUMMARY_TIMEOUT_MS = 10000
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

interface BranchSummary {
  branch_count?: number
  total_products?: number
  in_stock?: number
  low_stock?: number
  out_of_stock?: number
  stock_value_usd?: number | string
}

interface BranchStockProduct {
  id: string | number
  name?: string | null
  sku?: string | null
  unit?: string | null
  branch_quantity?: number | string | null
  low_stock_threshold?: number | string | null
  out_of_stock_threshold?: number | string | null
}

interface BranchStockSummary {
  total_products?: number | string
  total_product?: number | string
  in_stock_products?: number | string
  positive_products?: number | string
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
  getBranchSummary?: () => Promise<unknown>
  getTransfers: (params: Record<string, unknown>) => Promise<unknown>
  getBranchStock: (branchId: string | number, options: { page: number; pageSize: number; stockState: string }) => Promise<BranchStockState>
  updateBranch: (id: string | number, payload: BranchPayload) => Promise<BranchMutationResult>
  createBranch: (payload: BranchPayload) => Promise<BranchMutationResult>
  deleteBranch: (id: string | number, userId?: string | number, userName?: string) => Promise<BranchMutationResult>
}

interface BranchStatTileProps {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  color?: string
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

function getBranchApi(): BranchApi {
  return (window as unknown as { api: BranchApi }).api
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

function BranchStatTile({ label, value, detail, color = 'text-slate-700 dark:text-slate-100', onClick }: BranchStatTileProps) {
  return (
    <button
      type="button"
      className="min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-blue-900 dark:hover:bg-blue-950/20"
      title={String(detail || label || '')}
      onClick={onClick}
    >
      <div className="truncate text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 sm:text-[11px]">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-bold leading-tight sm:text-base ${color}`}>{value}</div>
    </button>
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
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function Branches() {
  const { t, user, notify, fmtUSD } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('branches')
  const branchApi = useMemo(() => getBranchApi(), [])

  /**
   * 2. Page State
   * 2.1 Branch + transfer data sources.
   * 2.2 UI selection/expansion state.
   */
  const [branches, setBranches] = useState<BranchRecord[]>([])
  const [branchSummary, setBranchSummary] = useState<BranchSummary | null>(null)
  const [tab, setTab] = useState<BranchTab>('branches')
  const [modal, setModal] = useState<BranchModal>(null)
  const [selected, setSelected] = useState<BranchRecord | null>(null)
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [branchStocks, setBranchStocks] = useState<Record<string | number, BranchStockState>>({})
  const [expandedBranch, setExpandedBranch] = useState<string | number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [statDetail, setStatDetail] = useState<StatDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<unknown> | null>(null)
  const loadPromiseModeRef = useRef('')
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 3, notify })

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
          setLoading(false)
          setLoadError(t('branches_load_slow') || 'Branches are taking longer than expected. Tap Retry or revisit in a moment.')
        }, 15_000)
      }

      try {
        const tasks: Record<string, () => Promise<unknown>> = {
          branches: () => withLoaderTimeout(
            () => branchApi.getBranches(),
            'Branches list',
            BRANCHES_LIST_TIMEOUT_MS,
          ),
          branchSummary: () => withLoaderTimeout(
            () => branchApi.getBranchSummary?.(),
            'Branch summary',
            BRANCHES_SUMMARY_TIMEOUT_MS,
          ).catch(() => null),
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
        if (result.values.branchSummary && typeof result.values.branchSummary === 'object') setBranchSummary(result.values.branchSummary as BranchSummary)
        if (Array.isArray(result.values.transfers)) setTransfers(result.values.transfers.filter(isTransferRecord))

        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, t('failed_to_load_data') || 'Failed to load data'))
        }

        loadedOnceRef.current = true
        setLoadError(null)
        return result
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
        const message = getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data')
        if (!silent && !loadedOnceRef.current) {
          setLoadError(message)
        } else if (!silent) {
          setLoadError(t('branches_refresh_failed') || 'Branches could not refresh right now. Showing the latest loaded data.')
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
  }, [branchApi, notify, t, tab])

  useEffect(() => {
    if (!isActive) {
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
  }, [])

  /**
   * 4. Derived State
   */
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches])
  const transferBranchOptions = useMemo(
    () => activeBranches.map((branch) => ({ id: branch.id, name: branch.name || `Branch ${branch.id}` })),
    [activeBranches],
  )
  const selectedCount = selectedIds.size
  const openStatDetail = useCallback((title: ReactNode, value: ReactNode, detail: ReactNode) => {
    setStatDetail({ title, value, detail })
  }, [])

  const buildBranchPayload = useCallback((branch: Partial<BranchRecord> = {}): BranchPayload => ({
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
    if (expandedBranch === branchId) {
      setExpandedBranch(null)
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
        notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'warning')
        return
      }
    }
    setExpandedBranch(branchId)
  }

  const loadMoreBranchStock = async (branchId: string | number) => {
    const current = branchStocks[branchId]
    if (!current || Array.isArray(current)) return
    const nextPage = Number(current.page || 1) + 1
    if (nextPage > Number(current.totalPages || 1)) return
    try {
      const stock = await withLoaderTimeout(
        () => branchApi.getBranchStock(branchId, {
          page: nextPage,
          pageSize: Number(current.pageSize || 20) || 20,
          stockState: current.stockState || 'positive',
        }),
        'More branch stock',
        12000,
      )
      const nextStockPage: BranchStockPage = Array.isArray(stock) ? { items: stock } : stock
      setBranchStocks((prev) => ({
        ...prev,
        [branchId]: {
          ...nextStockPage,
          items: [...(current.items || []), ...(nextStockPage.items || [])],
        },
      }))
    } catch (error) {
      notify(getErrorMessage(error, t('failed_to_load_data') || 'Failed to load data'), 'warning')
    }
  }

  /**
   * 6. CRUD Actions
   */
  const handleSaveBranch = async (form: BranchPayload) => {
    if (!beginSingleAction(saveInFlightRef)) return
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
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
            if (!result?.success) throw new Error(result?.error || 'Failed to undo branch creation')
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
      notify(selected ? (t('branch_updated') || 'Branch updated') : (t('branch_created') || 'Branch created'))
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
      if (!res?.success) {
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
          if (!result?.success) throw new Error(result?.error || 'Failed to delete branch again')
          await load()
        },
      })
      notify(t('branch_deleted') || 'Branch deleted')
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
      notify(t('cannot_delete_default_branch') || 'Cannot delete default branch', 'error')
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
        if (!result?.success) throw new Error(result?.error || 'Failed to delete branch')
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
              if (!result?.success) throw new Error(result?.error || 'Failed to re-delete branch')
            })
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete branch'))
            await load()
          },
        })
      }
      if (failed > 0) {
        notify((t('bulk_delete_partial_fail') || '{n} branch(es) could not be deleted.').replace('{n}', String(failed)), 'error')
        return
      }
      notify((t('bulk_deleted_count') || '{n} branch(es) deleted').replace('{n}', String(toDelete.length)))
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

  const toggleSelectAll = () => {
    if (selectedCount === branches.length && branches.length > 0) {
      setSelectedIds(new Set<string | number>())
      return
    }
    setSelectedIds(new Set<string | number>(branches.map((branch) => branch.id)))
  }

  return (
    <div className="page-scroll flex min-h-0 flex-col p-3 sm:p-6">
      <PageHeader
        icon={Building2}
        tone="blue"
        title={t('branches') || 'Branches'}
        subtitle={t('branch_default_hint') || 'Manage locations, transfer stock between branches, and review movement history from one place.'}
        className="mb-4"
        stackOnMobile={false}
        actionsClassName="self-start pl-2 sm:pl-0"
        actions={(
          <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {selectedCount > 0 ? (
            <button className="btn-danger flex-shrink-0 text-sm" onClick={handleBulkDelete} disabled={bulkDeleteBusy}>
              <Trash2 className="h-4 w-4" />
              <span>{(t('delete') || 'Delete')} ({selectedCount})</span>
            </button>
          ) : null}
          <button className="btn-secondary flex-shrink-0 px-3 py-1.5 text-xs sm:text-sm" onClick={() => setModal('transfer')}>
            <ArrowRightLeft className="h-4 w-4" />
            <span>{t('transfer') || 'Transfer'}</span>
          </button>
          <button className="btn-primary flex-shrink-0 px-3 py-1.5 text-xs sm:text-sm" onClick={() => { setSelected(null); setModal('form') }}>
            <Plus className="h-4 w-4" />
            <span>{t('add_branch') || 'Add Branch'}</span>
          </button>
        </div>
        )}
      />

      <ActionHistoryBar history={actionHistory as unknown as ActionHistoryProp} className="mb-4" />

      {branchSummary ? (
        <div className="mb-4 grid grid-cols-3 gap-1.5 sm:gap-2 xl:grid-cols-6">
          {[
            { key: 'branches', label: t('branches_short') || t('branches') || 'Branches', value: branchSummary.branch_count ?? activeBranches.length, color: 'text-blue-600 dark:text-blue-300', detail: t('branch_stat_branches_detail') || 'Active branch locations available for stock review and transfer.' },
            { key: 'items', label: t('items_short') || 'Items', value: branchSummary.total_products || 0, color: 'text-slate-700 dark:text-slate-100', detail: t('branch_stat_products_detail') || 'Unique products counted across branch stock records.' },
            { key: 'in-stock', label: t('in_stock_short') || 'In', value: branchSummary.in_stock || 0, color: 'text-emerald-600 dark:text-emerald-300', detail: t('branch_stat_in_stock_detail') || 'Products with positive stock in at least one branch.' },
            { key: 'low-stock', label: t('low_stock_short') || 'Low', value: branchSummary.low_stock || 0, color: 'text-amber-600 dark:text-amber-300', detail: t('branch_stat_low_stock_detail') || 'Products at or below their low stock threshold.' },
            { key: 'out-stock', label: t('out_of_stock_short') || 'Out', value: branchSummary.out_of_stock || 0, color: 'text-red-600 dark:text-red-300', detail: t('branch_stat_out_stock_detail') || 'Products at or below their out of stock threshold.' },
            { key: 'value', label: t('stock_value_short') || 'Value', value: fmtUSD(Number(branchSummary.stock_value_usd || 0)), color: 'text-cyan-600 dark:text-cyan-300', detail: t('branch_stat_value_detail') || 'Estimated stock value using available branch stock and product cost.' },
          ].map(({ key, label, value, color, detail }) => (
            <BranchStatTile
              key={key}
              label={label}
              value={value}
              color={color}
              detail={detail}
              onClick={() => openStatDetail(label, value, detail)}
            />
          ))}
        </div>
      ) : null}

      {loadError && !loading && !branches.length && !transfers.length ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold">{t('page_load_warning') || 'Page could not finish loading'}</div>
          <div className="mt-1">{loadError}</div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            onClick={() => load(false)}
          >
            {t('retry') || 'Retry'}
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'branches' as BranchTab, label: t('branches') || 'Branches' },
          { id: 'transfers' as BranchTab, label: t('transfer_history') || 'Transfer History' },
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

      {tab === 'branches' ? (
        <div className="space-y-3">
          {loading && !branches.length ? (
            <div className="space-y-3" aria-hidden="true">
              {[0, 1].map((index) => (
                <div key={`branch-loading-${index}`} className="card p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
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

          {!loading && branches.length > 0 ? (
            <div className="flex items-center gap-3 px-2">
              <input
                id="branches-select-all"
                name="branches_select_all"
                aria-label="Select all branches"
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={selectedCount === branches.length && branches.length > 0}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = selectedCount > 0 && selectedCount < branches.length
                  }
                }}
                onChange={toggleSelectAll}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : `${t('select_all') || 'Select all'} (${branches.length})`}
              </span>
            </div>
          ) : null}

          {!loading && branches.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p>{t('no_data') || 'No data'}</p>
            </div>
          ) : null}

          {branches.map((branch) => {
            const isExpanded = expandedBranch === branch.id
            const stockState = branchStocks[branch.id] || null
            const stockRows = Array.isArray(stockState) ? stockState : (Array.isArray(stockState?.items) ? stockState.items : [])
            const inStock = stockRows.filter((product) => Number(product.branch_quantity || 0) > 0)
            const stockSummary = !Array.isArray(stockState) ? stockState?.summary || {} : {}
            const totalProducts = Number(stockSummary.total_products ?? stockSummary.total_product ?? stockRows.length)
            const stockCount = Number(stockSummary.in_stock_products ?? stockSummary.positive_products ?? inStock.length)
            const lowStockCount = Number(stockSummary.low_stock_products ?? 0)
            const outStockCount = Number(stockSummary.out_of_stock_products ?? 0)
            const totalValue = Number(stockSummary.positive_value_usd ?? stockSummary.total_value_usd ?? 0)

            return (
              <div key={branch.id} className={`card overflow-hidden transition-all ${selectedIds.has(branch.id) ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}>
                <div className="p-3 sm:p-4">
                  <div className="flex items-start gap-2">
                    <input
                      id={`branch-select-${branch.id}`}
                      name={`branch_select_${branch.id}`}
                      aria-label={`Select branch ${branch.name}`}
                      type="checkbox"
                      className="mt-1 h-4 w-4 flex-shrink-0 rounded"
                      checked={selectedIds.has(branch.id)}
                      onChange={() => toggleSelect(branch.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-base font-bold text-gray-900 dark:text-white">{branch.name}</span>
                            {branch.is_default ? <span className="badge-blue text-xs">{t('default_branch') || 'Default'}</span> : null}
                            {branch.is_active
                              ? <span className="badge-green text-xs">{t('active') || 'Active'}</span>
                              : <span className="badge-red text-xs">{t('inactive') || 'Inactive'}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-gray-500 dark:text-gray-400">
                            {branch.location ? <span>{branch.location}</span> : null}
                            {branch.phone ? <span>{branch.phone}</span> : null}
                            {branch.manager ? <span>{branch.manager}</span> : null}
                          </div>
                          {branch.notes ? <p className="mt-0.5 truncate text-xs text-gray-400">{branch.notes}</p> : null}
                        </div>
                        <div className="flex max-w-full flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1">
                          <button onClick={() => loadBranchStock(branch.id)} className="btn-secondary flex-shrink-0 px-2.5 py-1 text-xs">
                            <Warehouse className="h-3.5 w-3.5" />
                            <span>{isExpanded ? (t('hide_stock') || 'Hide Stock') : (t('stock') || 'Stock')}</span>
                          </button>
                          <button onClick={() => { setSelected(branch); setModal('form') }} className="btn-secondary flex-shrink-0 px-2.5 py-1 text-xs">
                            <Pencil className="h-3.5 w-3.5" />
                            <span>{t('edit') || 'Edit'}</span>
                          </button>
                          {!branch.is_default ? (
                            <button onClick={() => handleDelete(branch)} className="btn-danger flex-shrink-0 px-2.5 py-1 text-xs">
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>{t('delete') || 'Delete'}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
                          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid w-full min-w-0 grid-cols-3 gap-1.5 sm:max-w-3xl sm:gap-2 lg:grid-cols-5">
                              {[
                                { key: 'total', label: t('total_short') || 'Total', value: totalProducts, color: 'text-gray-900 dark:text-white', detail: t('branch_stock_total_detail') || 'All products returned by this branch stock view.' },
                                { key: 'in', label: t('in_stock_short') || 'In', value: stockCount, color: 'text-green-600 dark:text-green-300', detail: t('branch_stock_in_detail') || 'Products with positive quantity in this branch.' },
                                { key: 'low', label: t('low_stock_short') || 'Low', value: lowStockCount, color: 'text-amber-600 dark:text-amber-300', detail: t('branch_stock_low_detail') || 'Products in this branch at or below low stock threshold.' },
                                { key: 'out', label: t('out_of_stock_short') || 'Out', value: outStockCount, color: 'text-red-600 dark:text-red-300', detail: t('branch_stock_out_detail') || 'Products in this branch at or below out of stock threshold.' },
                                { key: 'value', label: t('stock_value_short') || 'Value', value: fmtUSD(totalValue), color: 'text-blue-600 dark:text-blue-300', detail: t('branch_stock_value_detail') || 'Estimated value for positive branch stock.' },
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
                              {(t('branch_stock_count') || '{n} products in stock').replace('{n}', String(stockCount))}
                              {' | '}
                              {t('branch_stock_value') || 'Value'}: <span className="text-blue-600">{fmtUSD(totalValue)}</span>
                            </span>
                            <button onClick={() => setModal('transfer')} className="text-xs text-blue-500 hover:underline">
                              {t('transfer_stock_link') || 'Transfer stock'}
                            </button>
                          </div>

                          {inStock.length === 0 ? (
                            <p className="rounded-lg bg-gray-50 py-4 text-center text-sm text-gray-400 dark:bg-gray-700/30">
                              {t('no_branch_stock') || 'No stock in this branch. Use Transfer or Adjust Stock to add items.'}
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                                {inStock.map((product) => (
                                  <div
                                    key={product.id}
                                    className={`rounded-lg border p-2.5 text-xs ${
                                      Number(product.branch_quantity || 0) <= Number(product.out_of_stock_threshold || 0)
                                        ? 'border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/20'
                                        : Number(product.branch_quantity || 0) <= Number(product.low_stock_threshold || 10)
                                          ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'
                                          : 'border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/30'
                                    }`}
                                  >
                                    <div className="mb-0.5 truncate font-medium text-gray-800 dark:text-gray-200">{product.name}</div>
                                    <div
                                      className={`text-sm font-bold ${
                                        Number(product.branch_quantity || 0) <= Number(product.out_of_stock_threshold || 0)
                                          ? 'text-red-600'
                                          : Number(product.branch_quantity || 0) <= Number(product.low_stock_threshold || 10)
                                            ? 'text-yellow-600'
                                            : 'text-green-600'
                                      }`}
                                    >
                                      {product.branch_quantity} {product.unit}
                                    </div>
                                    {product.sku ? <div className="truncate font-mono text-gray-400">{product.sku}</div> : null}
                                  </div>
                                ))}
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
              <div className="card py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</div>
            ) : transfers.length === 0 ? (
              <div className="card py-10 text-center text-gray-400">{t('no_data') || 'No data'}</div>
            ) : transfers.map((transfer) => (
              <div key={transfer.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{transfer.product_name}</div>
                    <div className="mt-1 text-xs text-gray-400">{formatTransferDate(transfer.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{transfer.quantity}</div>
                    <div className="text-[10px] text-gray-400">{t('quantity') || 'Qty'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="badge-red text-xs">{transfer.from_name || 'N/A'}</span>
                  <span className="badge-green text-xs">{transfer.to_name || 'N/A'}</span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <td className="px-4 py-2.5 text-xs text-gray-500">{transfer.note || '-'}</td>
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
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date') || 'Date'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('product_name') || 'Product'}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('from_branch') || 'From'}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('to_branch') || 'To'}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity') || 'Qty'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('transfer_note') || 'Note'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('user') || 'User'}</th>
                </tr>
              </thead>
              <tbody>
                {loading && !transfers.length ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</td></tr>
                ) : transfers.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
                ) : transfers.map((transfer) => (
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
            {(t('transfers_count') || '{n} transfers').replace('{n}', String(transfers.length))}
          </div>
        </div>
        </>
      ) : null}

      {modal === 'form' ? (
        <Modal title={selected ? `${t('edit_branch') || 'Edit Branch'}: ${selected.name}` : `+ ${t('add_branch') || 'Add Branch'}`} onClose={() => setModal(null)}>
          <BranchForm branch={selected} onSave={handleSaveBranch} onClose={() => setModal(null)} />
        </Modal>
      ) : null}

      {modal === 'transfer' ? (
        <TransferModal
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
                {t('close') || 'Close'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
