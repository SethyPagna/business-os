import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeeBranchOption } from './FeeForm.tsx'

type BranchModule = typeof import('../../api/branchTransport.ts')
let branchModulePromise: Promise<BranchModule> | null = null
function loadBranchModule(): Promise<BranchModule> {
  if (!branchModulePromise) branchModulePromise = import('../../api/branchTransport.ts')
  return branchModulePromise
}
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Tags from 'lucide-react/dist/esm/icons/tags.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import Modal from '../shared/Modal'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import SearchInput from '../shared/SearchInput'
import FilterMenu, { type FilterOption } from '../shared/FilterMenu'
import PaginationControls, { DEFAULT_PAGE_SIZE, clampPage } from '../shared/PaginationControls'
import PagerActionRow from '../shared/PagerActionRow.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginKeyedAction, finishKeyedAction } from '../../utils/actionGuards.ts'
import { isWriteConflictError } from '../../api/http.ts'
import {
  createFee as createFeeRequest,
  deleteFee as deleteFeeRequest,
  getFee as getFeeRequest,
  getAllFeesForExport,
  getFees as getFeesRequest,
  getFeesReport,
  updateFee as updateFeeRequest,
  type FeeListResult,
  type FeePayload,
  type FeeRecord,
  type FeeType,
} from '../../api/feesTransport.ts'
import FeeForm, { FEE_TYPE_OPTIONS, feeFormDraftBaseKey, feeFormWorkKey } from './FeeForm.tsx'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import ShiftHistoryModal from '../shifts/ShiftHistoryModal.tsx'
import ExportMenu from '../shared/ExportMenu.tsx'
import SectionExportAction from '../shared/SectionExportAction.tsx'
import { makeReportMoneyFormatter } from '../../utils/reportMoney.ts'
import { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker'
import { fmtClock24 } from '../../utils/formatters.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import {
  RESTORE_WORK_EVENT,
  consumePendingRestore,
  markRestoreHandled,
  minimizeWork,
  reparkDeniedRestore,
  type MinimizedWorkEntry,
} from '../../utils/minimizedWork.ts'
import { flushPendingWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'

const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'fees-export-options')
const ExpenseLabelManagerModal = lazyRetry(() => import('./ExpenseLabelManagerModal'), 'expense-label-manager-modal')

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: unknown, type?: string, duration?: number) => void

interface FeesAppContextValue {
  // Tier-aware read (utils/permissions.ts). Fees needs the TIER rather than
  // a per-action boolean, because nothing here is blocked -- it needs to
  // know whether a delete will queue, not whether it is allowed.
  getPermissionTier: (key: string) => string
  can: (permissionKey: string, actionKey: string) => boolean
  t: TranslateFn
  notify: NotifyFn
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
  khrToUsd: (value: unknown) => number
  usdToKhr: (value: unknown) => number
  displayCurrency: string
  user?: { id?: number | string | null } | null
}

interface FeesSyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: unknown
  } | null
}

const useApp = useAppHook as unknown as () => FeesAppContextValue
const useSync = useSyncHook as unknown as () => FeesSyncContextValue

// Standalone Fees page -- manual-entry fee records (tax, delivery, change,
// other) that can optionally be matched to a sale but survive independently
// of it (cloudflare/src/routes/fees.ts). Gated behind the dedicated `fees`
// permission at the route/nav level (App.tsx/AppContext.tsx/
// navigationConfig.ts); nothing further to check inside this component
// itself, same as every other permission-gated page in this app.
//
// No local/offline mirror and no undo/redo history -- fees aren't part of
// the POS checkout critical path, so a failed save while offline just
// surfaces as a normal error (see feesTransport.ts's own note on this).

const FEES_LOAD_TIMEOUT_MS = 12000
const FEES_MUTATION_TIMEOUT_MS = 12000

type FeeModal = 'detail' | 'form' | null
type FeeTypeFilter = FeeType | 'all'

type ExpenseDeleteOperation = {
  canDelete: () => boolean
  confirmDelete: () => boolean
  begin: () => boolean
  remove: () => Promise<unknown>
  onStart: () => void
  onSuccess: () => Promise<void>
  onError: (error: unknown) => void
  onFinish: () => void
}

export async function performExpenseDelete(operation: ExpenseDeleteOperation): Promise<boolean> {
  if (!operation.canDelete()) return false
  if (!operation.confirmDelete()) return false
  if (!operation.canDelete()) return false
  if (!operation.begin()) return false
  operation.onStart()
  try {
    await operation.remove()
    await operation.onSuccess()
    return true
  } catch (error) {
    operation.onError(error)
    return false
  } finally {
    operation.onFinish()
  }
}


function formatFeeDate(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  // dd/mm/yyyy, day-first (Sep 4 2026).
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getFullYear()}`
}

export function groupFeesByDate(rows: readonly FeeRecord[]): Array<{ date: string; rows: FeeRecord[] }> {
  const groups: Array<{ date: string; rows: FeeRecord[] }> = []
  for (const row of rows) {
    const date = String(row.fee_date || '')
    const current = groups[groups.length - 1]
    if (!current || current.date !== date) groups.push({ date, rows: [row] })
    else current.rows.push(row)
  }
  return groups
}

export function feeTypeToneClass(type: string): string {
  switch (type) {
    case 'delivery': return 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
    case 'tax': return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
    case 'change': return 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
    case 'expense': return 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
    default: return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  }
}

const EMPTY_RESULT: FeeListResult = { fees: [], total: 0, limit: DEFAULT_PAGE_SIZE, offset: 0, summary: [] }

export function buildFeeExportRows(rows: FeeRecord[], feeTypeLabel: (type: string) => string): Array<Record<string, unknown>> {
  return rows.map((fee) => ({
    date: fee.fee_date || '',
    type: feeTypeLabel(fee.fee_type),
    label: fee.label || '',
    amount_usd: Number(fee.amount_usd) || 0,
    amount_khr: Number(fee.amount_khr) || 0,
    sale_receipt: fee.sale_receipt_number || '',
    branch: fee.branch_name || '',
    notes: fee.notes || '',
    created_by: fee.created_by_name || '',
    created_at: fee.created_at || '',
  }))
}

export default function FeesPage({ embedded = false }: { embedded?: boolean }) {
  const { can, getPermissionTier, t, notify, fmtUSD, fmtKHR, khrToUsd, usdToKhr, displayCurrency, user } = useApp()
  // Display-currency-aware money formatter (see utils/reportMoney.ts) —
  // honors the display_currency setting without touching stored data.
  const fmtMoney = useMemo(
    () => makeReportMoneyFormatter({ displayCurrency, fmtUSD, fmtKHR, khrToUsd, usdToKhr }),
    [displayCurrency, fmtUSD, fmtKHR, khrToUsd, usdToKhr],
  )
  // Fees is the one section where NOTHING is blocked for the Review
  // Required tier -- add and edit apply directly, and delete goes to the
  // approval queue rather than 403ing (routes/fees.ts's
  // maybeQueueForReview). So hiding controls here, the way Products /
  // Inventory / Branches / Returns / Contacts do, would be wrong: the
  // person genuinely can press every one of them.
  //
  // What they need instead is to know that deleting will not take effect
  // immediately. Labelling the outcome is the whole job on this page.
  const feesNeedsApproval = getPermissionTier('fees') === 'review'
  const canAddFee = can('fees', 'add')
  const canEditFee = can('fees', 'edit')
  const canDeleteFee = can('fees', 'delete')
  const canExportFee = can('fees', 'export')
  const canEditFeeRef = useRef(canEditFee)
  const canDeleteFeeRef = useRef(canDeleteFee)
  const canExportFeeRef = useRef(canExportFee)
  canEditFeeRef.current = canEditFee
  canDeleteFeeRef.current = canDeleteFee
  canExportFeeRef.current = canExportFee
  const { syncChannel } = useSync()
  // E2: Fees renders as a SECTION of the Sales hub now (see Returns.tsx's
  // matching re-key note).
  const isActive = useIsPageActive('sales')
  const tr = useCallback((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])

  const [result, setResult] = useState<FeeListResult>(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<FeeTypeFilter>('all')
  // ONE date scope for the whole page (user, Aug 31: "drive list + stats
  // together"): the Start→End range row above the search bar drives BOTH the
  // stats strip AND the expenses list — there is no separate Filters-menu date
  // range that could disagree with it. Starts all-time; presets are inside
  // the shared date/time picker. (Strip data state is declared further down.)
  const [stripRange, setStripRange] = useState<DateTimeRange>(() => todayDateTimeRange())
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<FeeBranchOption[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  const [modal, setModal] = useState<FeeModal>(null)
  const [selected, setSelected] = useState<FeeRecord | null>(null)
  const [feeFormLocked, setFeeFormLocked] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  const [showLabelManager, setShowLabelManager] = useState(false)

  const loadRequestRef = useRef(0)
  const deleteActionRef = useRef<Set<string>>(new Set())
  const exportInFlightRef = useRef(false)

  useEffect(() => {
    if (!canExportFee) setExportDialog(null)
    if (!canEditFee) setShowLabelManager(false)
  }, [canEditFee, canExportFee])

  const load = useCallback(async (silent = false) => {
    const requestId = beginTrackedRequest(loadRequestRef)
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const response = await withLoaderTimeout(
        () => getFeesRequest({
          search: search.trim() || undefined,
          fee_type: typeFilter !== 'all' ? typeFilter : undefined,
          from: stripRange.startDate || undefined,
          to: stripRange.endDate || undefined,
          branch_id: branchFilter || undefined,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        'fees:list',
        FEES_LOAD_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const nextResult = response || EMPTY_RESULT
      const nextPage = clampPage(page, nextResult.total, pageSize)
      if (nextPage !== page) {
        // A filtered or deleted final page can disappear between requests.
        // Correct the controlled page before accepting its now-empty rows;
        // the page change triggers one request at the valid offset.
        setPage(nextPage)
        return
      }
      setResult(nextResult)
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setLoadError(error instanceof Error ? error.message : String(error || ''))
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) {
        setLoading(false)
        setHasLoadedOnce(true)
      }
    }
  }, [search, typeFilter, stripRange.startDate, stripRange.endDate, branchFilter, page, pageSize])

  useEffect(() => {
    if (!isActive) return
    void load()
  }, [isActive, load])

  // Reset to page 1 whenever a filter changes underneath an existing page
  // position, so a narrowed result set never lands on an empty out-of-range
  // page.
  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, stripRange.startDate, stripRange.endDate, branchFilter])

  // Branch list for the filter dropdown -- loaded once, independent of
  // isActive/load() so the filter menu has options even before the fees
  // list itself has loaded. Failure here just leaves the branch filter
  // empty (search/type/date filters remain fully usable).
  useEffect(() => {
    let cancelled = false
    loadBranchModule()
      .then((mod) => mod.getBranches())
      .then((rows) => {
        if (cancelled) return
        setBranches(((rows || []) as FeeBranchOption[]).filter((row) => row.is_active !== false))
      })
      .catch(() => { if (!cancelled) setBranches([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'fees') void load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  // The foldable stats strip (shared StatsStrip, app-wide stats pattern):
  // range-scoped (all-time by default) with per-card fold breakdowns from
  // GET /api/fees/report -- by type, and the range's busiest days.
  type FeesStripPayload = {
    totals?: { count?: number; amount_usd?: number; amount_khr?: number }
    days?: Array<{ date?: string; count?: number; amount_usd?: number; amount_khr?: number }>
    by_type?: Array<{ fee_type?: string; count?: number; amount_usd?: number; amount_khr?: number }>
    by_category?: Array<{ label?: string; fee_type?: string; count?: number; amount_usd?: number; amount_khr?: number }>
  }
  const [stripData, setStripData] = useState<FeesStripPayload | null>(null)
  const [stripLoading, setStripLoading] = useState(false)
  const stripRequestRef = useRef(0)
  const loadStatsStrip = useCallback(async (): Promise<void> => {
    if (!isActive) return
    const requestId = ++stripRequestRef.current
    setStripLoading(true)
    try {
      const result = await getFeesReport({
        ...(stripRange.startDate ? { startDate: stripRange.startDate } : {}),
        ...(stripRange.endDate ? { endDate: stripRange.endDate } : {}),
        ...(branchFilter ? { branchId: branchFilter } : {}),
      })
      if (stripRequestRef.current !== requestId) return
      setStripData((result || {}) as FeesStripPayload)
    } catch {
      if (stripRequestRef.current !== requestId) return
      setStripData(null)
    } finally {
      if (stripRequestRef.current === requestId) setStripLoading(false)
    }
  }, [branchFilter, isActive, stripRange.endDate, stripRange.startDate])
  useEffect(() => { void loadStatsStrip() }, [loadStatsStrip])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'fees') void loadStatsStrip()
  }, [isActive, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])

  const stripCards = useMemo<StatCardDef[]>(() => {
    const totals = stripData?.totals || {}
    const byType = stripData?.by_type || []
    const byCategory = stripData?.by_category || []
    const days = stripData?.days || []
    const count = Number(totals.count) || 0
    const amountUsd = Number(totals.amount_usd) || 0
    const amountKhr = Number(totals.amount_khr) || 0
    return [
      {
        key: 'fees',
        label: tr('fees', 'Expenses'),
        value: String(count),
        hint: tr('stats_fees_hint', 'Expense records dated inside the range. The breakdown shows how many of each type.'),
        details: byType.map((row) => {
          const type = String(row.fee_type || '')
          const option = FEE_TYPE_OPTIONS.find((candidate) => candidate.value === type)
          return {
            label: option ? (t(option.labelKey) || option.fallback) : (type || '—'),
            value: `${Number(row.count) || 0} · ${fmtMoney(Number(row.amount_usd) || 0, Number(row.amount_khr) || 0)}`,
          }
        }),
      },
      {
        key: 'categories',
        label: tr('expense_categories', 'Categories'),
        value: String(byCategory.length),
        hint: tr('expense_categories_hint', 'Saved expense labels in this range, grouped without changing their source wording.'),
        details: byCategory.slice(0, 12).map((row) => ({
          label: row.label || tr('unlabeled', 'Unlabeled'),
          value: `${Number(row.count) || 0} · ${fmtMoney(Number(row.amount_usd) || 0, Number(row.amount_khr) || 0)}`,
        })),
      },
      {
        key: 'total',
        label: tr('total', 'Total'),
        value: fmtMoney(amountUsd, amountKhr),
        tone: 'accent',
        hint: tr('stats_fees_total_hint', 'Sum of expense amounts in the range. Expenses are recorded in USD or KHR, so both totals are shown. The breakdown lists the days with the most spend.'),
        details: days.slice(0, 8).map((day) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day.date || ''))
          return {
            label: m ? `${m[3]}/${m[2]}/${m[1]}` : String(day.date || ''),
            value: `${Number(day.count) || 0} · ${fmtMoney(Number(day.amount_usd) || 0, Number(day.amount_khr) || 0)}`,
          }
        }),
      },
    ]
  }, [fmtMoney, stripData, t, tr])

  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const fees = result.fees || []
  const feeDayGroups = useMemo(() => groupFeesByDate(fees), [fees])

  const feeTypeLabel = useCallback((type: string): string => {
    const option = FEE_TYPE_OPTIONS.find((opt) => opt.value === type)
    return option ? (t(option.labelKey) || option.fallback) : type
  }, [t])

  const openFeeExport = useCallback(async (
    scope: 'visible' | 'filtered' | 'all',
  ): Promise<void> => {
    if (!canExportFeeRef.current || exportInFlightRef.current) return
    exportInFlightRef.current = true
    try {
      const sourceRows = scope === 'visible'
        ? fees
        : await getAllFeesForExport(scope === 'filtered' ? {
          search: search.trim() || undefined,
          fee_type: typeFilter !== 'all' ? typeFilter : undefined,
          from: stripRange.startDate || undefined,
          to: stripRange.endDate || undefined,
          branch_id: branchFilter || undefined,
        } : {})
      // A fetch begun while allowed must not open an export result after the
      // permission is revoked. The live ref also protects a stale menu callback.
      if (!canExportFeeRef.current) return
      if (!sourceRows.length) {
        notify(tr('no_data_to_export', 'No data to export'), 'error')
        return
      }
      setExportDialog({
        rows: buildFeeExportRows(sourceRows, feeTypeLabel),
        baseName: scope === 'all' ? 'expenses-all' : scope === 'filtered' ? 'expenses-filtered' : 'expenses-visible',
      })
    } catch (error) {
      if (canExportFeeRef.current) notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      exportInFlightRef.current = false
    }
  }, [branchFilter, feeTypeLabel, fees, notify, search, stripRange.endDate, stripRange.startDate, tr, typeFilter])

  const exportItems = useMemo(() => ([
    { label: tr('export_visible', 'Export visible page'), onClick: () => { void openFeeExport('visible') } },
    { label: tr('export_filtered_time_range', 'Export all matching filters'), onClick: () => { void openFeeExport('filtered') } },
    { label: tr('export_all', 'Export all expenses'), onClick: () => { void openFeeExport('all') } },
  ]), [openFeeExport, tr])

  const openAdd = () => { if (canAddFee) { setFeeFormLocked(false); setSelected(null); setModal('form') } }
  const openDetail = (fee: FeeRecord) => { setSelected(fee); setModal('detail') }
  const openEdit = (fee: FeeRecord) => { if (canEditFeeRef.current) { setFeeFormLocked(false); setSelected(fee); setModal('form') } }
  const openLabelManager = useCallback(() => {
    if (canEditFeeRef.current) setShowLabelManager(true)
  }, [])
  const closeModal = () => { setFeeFormLocked(false); setModal(null); setSelected(null) }

  const restoreFeeForm = useCallback(async (entry: MinimizedWorkEntry): Promise<boolean> => {
    const rawFeeId = entry.payload?.feeId
    const feeId = typeof rawFeeId === 'number' || typeof rawFeeId === 'string' ? Number(rawFeeId) : 0
    const isEdit = Number.isFinite(feeId) && feeId > 0
    if ((isEdit && !canEditFee) || (!isEdit && !canAddFee)) {
      reparkDeniedRestore(entry)
      notify(tr('access_denied', 'Access denied'), 'warning')
      return false
    }
    if (!isEdit) {
      setFeeFormLocked(false)
      setSelected(null)
      setModal('form')
      return true
    }
    try {
      const result = await getFeeRequest(feeId)
      if (!result?.fee) throw new Error('fee missing')
      setFeeFormLocked(false)
      setSelected(result.fee)
      setModal('form')
      return true
    } catch {
      reparkDeniedRestore(entry)
      notify(tr('failed_to_load_data', 'Failed to load data'), 'warning')
      return false
    }
  }, [canAddFee, canEditFee, notify, tr])

  useEffect(() => {
    const pending = consumePendingRestore('fee_form')
    if (pending) {
      void restoreFeeForm(pending).then((restored) => {
        if (restored) markRestoreHandled('fee_form')
      })
    }
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.kind !== 'fee_form') return
      const entry = detail.entry as MinimizedWorkEntry | undefined
      if (!entry) return
      void restoreFeeForm(entry).then((restored) => {
        if (restored) markRestoreHandled('fee_form')
      })
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
  }, [restoreFeeForm])

  const handleSave = async (payload: FeePayload) => {
    try {
      if (selected) {
        await withLoaderTimeout(
          () => updateFeeRequest(selected.id, { ...payload, expectedUpdatedAt: selected.updated_at }),
          'fees:update',
          FEES_MUTATION_TIMEOUT_MS,
        )
        notify(tr('fee_updated', 'Expense updated'), 'success')
      } else {
        // createFee owns its uncertain-outcome lifecycle. Wrapping it in a
        // UI timeout would reject while the underlying request kept running,
        // allowing a late success to clear the receipt behind an "unknown"
        // form and turn the next Save into a duplicate request.
        await createFeeRequest(payload, user?.id)
        notify(tr('fee_created', 'Expense added'), 'success')
      }
      await load(true)
    } catch (error) {
      // AppContext's global sync:conflict listener already shows a
      // notification for this exact error (route() in http.ts dispatches
      // it for every write-conflict, not just fees) -- notifying again
      // here would double it up. Reload instead so the list reflects the
      // latest server state, same pattern Sales.tsx/EditReturnModal.tsx
      // already use for this case.
      if (isWriteConflictError(error) || String((error as { code?: unknown } | null)?.code || '') === 'idempotency_conflict') {
        await load(true)
      } else {
        notify(error instanceof Error ? error.message : String(error || ''), 'error')
      }
      throw error
    }
  }

  const feeDraftKey = scopedWorkDraftKey(feeFormDraftBaseKey(selected?.id))
  const canMinimizeFeeForm = selected ? canEditFee : canAddFee
  const preserveFeeForm = () => {
    if (feeFormLocked) return
    flushPendingWorkDraft(feeDraftKey)
    const isEdit = selected != null
    minimizeWork({
      key: feeFormWorkKey(selected?.id),
      kind: 'fee_form',
      pageId: 'sales',
      anchor: 'hub:sales:fees',
      label: isEdit
        ? `${tr('edit_fee', 'Edit Expense')} — ${selected.label || selected.id}`
        : tr('add_fee', 'Add Expense'),
      payload: { feeId: selected?.id ?? null },
      draftKey: feeDraftKey,
      requiredPermission: { permissionKey: 'fees', actionKey: isEdit ? 'edit' : 'add' },
    })
    closeModal()
  }

  const handleDelete = async (fee: FeeRecord): Promise<boolean> => {
    return performExpenseDelete({
      canDelete: () => canDeleteFeeRef.current,
      confirmDelete: () => window.confirm(tr('delete_fee_confirm', 'Delete this expense record? This cannot be undone.')),
      begin: () => beginKeyedAction(deleteActionRef, fee.id),
      onStart: () => setDeletingId(fee.id),
      remove: () => withLoaderTimeout(
        () => deleteFeeRequest(fee.id),
        'fees:delete',
        FEES_MUTATION_TIMEOUT_MS,
      ),
      onSuccess: async () => {
        notify(tr('fee_deleted', 'Expense deleted'), 'success')
        await load(true)
      },
      onError: (error) => notify(error instanceof Error ? error.message : String(error || ''), 'error'),
      onFinish: () => {
        finishKeyedAction(deleteActionRef, fee.id)
        setDeletingId(null)
      },
    })
  }

  const activeFilterCount = useMemo(
    () => [typeFilter !== 'all', !!branchFilter].filter(Boolean).length,
    [typeFilter, branchFilter],
  )

  const filterSections = useMemo(() => ([
    {
      id: 'type',
      label: tr('fee_type', 'Type'),
      options: [
        { id: 'all', label: tr('all_types', 'All Types'), active: typeFilter === 'all', onClick: () => setTypeFilter('all') },
        ...FEE_TYPE_OPTIONS.map((opt): FilterOption => ({
          id: opt.value,
          label: t(opt.labelKey) || opt.fallback,
          active: typeFilter === opt.value,
          onClick: () => setTypeFilter(opt.value),
        })),
      ],
    },
    // The date filter is gone from this menu: the Start→End range row above
    // the search bar (stripRange) is the single date scope now and drives the
    // list directly, so a second date control here would only disagree with it.
    {
      id: 'branch',
      label: tr('branch', 'Branch'),
      options: [
        { id: '', label: tr('all_branches', 'All Branches'), active: branchFilter === '', onClick: () => setBranchFilter('') },
        ...branches.map((branch): FilterOption => ({
          id: String(branch.id),
          label: branch.name || String(branch.id),
          active: branchFilter === String(branch.id),
          onClick: () => setBranchFilter(String(branch.id)),
        })),
      ],
    },
  ]), [tr, t, typeFilter, branchFilter, branches])

  return (
    <div className={`${embedded ? '' : 'page-scroll '}flex flex-col p-3 sm:p-6`}>
      {/* Page title removed (Aug 19 2026 UI request): no other page in the
          app repeats its own name in an h1 here -- the sidebar nav item
          already names the page -- so Fees having one was the odd one out,
          not a deliberate design choice. Hint text kept (it's page-usage
          guidance, not a title) but now only rendered when there's nothing
          else to anchor the row, so an empty state doesn't look bare. */}
      {/* The foldable stats strip (shared StatsStrip, the app-wide stats
          pattern) replaces the old lone Total pill: range-scoped mini cards
          (default today) whose folds carry the by-type and by-day
          breakdowns. */}
      <StatsStrip
        className="mb-3"
        cards={stripCards}
        loading={stripLoading}
        t={t}
        iconOnly
        compactRange
        rangeActions={(
          <>
            {canExportFee ? <SectionExportAction>
              <ExportMenu
                label={tr('export', 'Export')}
                items={exportItems}
                iconOnly
                triggerClassName={`${toolbarIconButtonClassName} !h-10 !min-h-10 !w-10 !rounded-full !border-0 !bg-transparent !p-0`}
              />
            </SectionExportAction> : null}
          </>
        )}
        actions={canAddFee ? (
          // Fit-to-content, not the wide toolbar-width button ("the add
          // button for fees are too wide, can make fit") — and it shares
          // the range row to save a row.
          <button
            type="button"
            className={`${toolbarIconButtonClassName} border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500`}
            onClick={openAdd}
            aria-label={tr('add_fee', 'Add Expense')}
            title={tr('add_fee', 'Add Expense')}
          >
            <Plus className="h-5 w-5" />
          </button>
        ) : null}
        range={stripRange}
        onRangeChange={setStripRange}
      />

      {exportDialog && canExportFee ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={tr('export_options_title', 'Export options')}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey="expenses"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}

      <div className="sticky top-2 z-30 -mx-1 mb-4 space-y-2 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <SearchInput
            id="fees-search"
            name="fees_search"
            value={search}
            onChange={setSearch}
            placeholder={tr('search_fees_placeholder', 'Search expenses by label or notes')}
            className="min-w-0 flex-1"
          />
          <FilterMenu
            label={tr('filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={filterSections}
            onClear={() => { setTypeFilter('all'); setBranchFilter('') }}
            compact
          />
          {/* Add Fee lives in the stats strip's shared range/action row. */}
        </div>
        <PagerActionRow
          leading={(
            <ShiftHistoryModal
              label={<><History className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{tr('shift_code', 'Shift')}</span></>}
              buttonClassName="btn-secondary inline-flex h-10 w-10 min-w-10 items-center justify-center p-0"
            />
          )}
          trailing={canEditFee ? (
            <button
              type="button"
              className={toolbarIconButtonClassName}
              onClick={openLabelManager}
              aria-label={tr('manage_expense_labels', 'Manage expense labels')}
              title={tr('manage_expense_labels', 'Manage expense labels')}
            >
              <Tags className="h-4 w-4" />
            </button>
          ) : null}
        >
          <PaginationControls
            compact
            rangeAsPageSize
            compactCentered
            page={page}
            pageSize={pageSize}
            totalItems={result.total}
            t={t}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </PagerActionRow>
      </div>

      {loadError ? (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
          <button type="button" className="ml-2 font-medium underline" onClick={() => load()}>
            {tr('try_again', 'Try again')}
          </button>
        </div>
      ) : null}

      {loading && !hasLoadedOnce ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70" />
          ))}
        </div>
      ) : fees.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-slate-400">
          <Receipt className="h-8 w-8 text-slate-300" />
          <span>{tr('no_fees', 'No expenses recorded yet.')}</span>
          {canAddFee ? <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('add_fee', 'Add Expense')}
          </button> : null}
        </div>
      ) : (
        <>
          {/* Rows open a single read-only detail surface. Mutating actions live
              there rather than competing with the record facts in this list. */}
          <div className="dense-data-shell hidden overflow-x-auto md:block">
            <table className="dense-data-table min-w-[720px]">
              <colgroup><col className="w-[7rem]" /><col className="w-[7rem]" /><col /><col className="w-[9rem]" /><col className="w-[12rem]" /></colgroup>
              <thead>
                <tr>
                  <th>{tr('time', 'Time')}</th>
                  <th data-tone="violet">{tr('type', 'Type')}</th>
                  <th data-tone="blue">{tr('expense_category', 'Category')}</th>
                  <th data-tone="emerald" className="text-right">{tr('amount', 'Amount')}</th>
                  <th>{tr('details', 'Details')}</th>
                </tr>
              </thead>
              {feeDayGroups.map((group) => (
                <tbody key={group.date || 'unknown'}>
                  <tr className="bg-slate-50/90 dark:bg-slate-800/80">
                    <td colSpan={5} className="!py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200">{formatFeeDate(group.date)}</td>
                  </tr>
                  {group.rows.map((fee) => (
                  <tr key={fee.id} data-clickable="true" tabIndex={0} onClick={() => openDetail(fee)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(fee) } }}>
                    <td className="whitespace-nowrap text-slate-500 dark:text-slate-400">{fmtClock24(fee.created_at)}</td>
                    <td className="whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${feeTypeToneClass(fee.fee_type)}`}>
                        {feeTypeLabel(fee.fee_type)}
                      </span>
                    </td>
                    <td><span className="dense-cell-truncate font-medium text-blue-700 dark:text-blue-300" title={fee.label || ''}>{fee.label || ''}</span></td>
                    <td className="whitespace-nowrap text-right font-semibold text-emerald-700 dark:text-emerald-300">
                      {fmtMoney(Number(fee.amount_usd) || 0, Number(fee.amount_khr) || 0)}
                    </td>
                    <td>
                      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                        {fee.sale_receipt_number || fee.sale_id ? (
                          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <Receipt className="h-3 w-3 shrink-0" />
                            <span className="truncate">{fee.sale_receipt_number ? `${fee.sale_receipt_number} · Sale ID #${fee.sale_id}` : `Sale ID #${fee.sale_id}`}</span>
                          </span>
                        ) : null}
                        {fee.created_by_name ? (
                          <span className="truncate text-[11px] text-slate-400">{fee.created_by_name}</span>
                        ) : null}
                        {fee.branch_name ? (
                          <span className="truncate text-[11px] text-slate-400">{fee.branch_name}</span>
                        ) : null}
                        {fee.delivery_contact_name ? (
                          <span className="truncate text-[11px] text-slate-400">{fee.delivery_contact_name}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          {/* Card layout for narrow screens -- the dense table doesn't
              fit comfortably below sm, same pattern as the other list pages
              in this app (Branches, Returns). */}
          <div className="space-y-3 md:hidden">
            {feeDayGroups.map((group) => (
              <section key={group.date || 'unknown'} className="space-y-1.5" aria-label={formatFeeDate(group.date)}>
                <div className="sticky top-[7.25rem] z-10 rounded-md bg-slate-100/95 px-2 py-1 text-xs font-semibold text-slate-600 backdrop-blur dark:bg-slate-800/95 dark:text-slate-200">
                  {formatFeeDate(group.date)}
                </div>
                {group.rows.map((fee) => (
              <button type="button" key={fee.id} data-expense-card="" onClick={() => openDetail(fee)} className="block w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/20">
                <div data-expense-line="primary" className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-xs text-slate-400">{fmtClock24(fee.created_at)}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold ${feeTypeToneClass(fee.fee_type)}`}>
                    {feeTypeLabel(fee.fee_type)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{fee.label || ''}</span>
                  <span className="ml-auto shrink-0 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmtMoney(Number(fee.amount_usd) || 0, Number(fee.amount_khr) || 0)}
                  </span>
                </div>
                <div data-expense-line="secondary" className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-normal text-slate-700 dark:text-slate-200">
                  {fee.created_by_name ? <span className="min-w-0 truncate" aria-label={`${tr('cashier', 'Cashier')}: ${fee.created_by_name}`}>{fee.created_by_name}</span> : null}
                  {fee.created_by_name && fee.branch_name ? <span aria-hidden="true" className="shrink-0">·</span> : null}
                  {fee.branch_name ? <span className="min-w-0 truncate" aria-label={`${tr('branch', 'Branch')}: ${fee.branch_name}`}>{fee.branch_name}</span> : null}
                </div>
              </button>
                ))}
              </section>
            ))}
          </div>

          <div className="mt-3 flex justify-center">
            <PaginationControls
              compact
              rangeAsPageSize
              compactCentered
              page={page}
              pageSize={pageSize}
              totalItems={result.total}
              t={t}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />
          </div>
        </>
      )}

      {modal === 'detail' && selected ? (
        <Modal
          title={tr('details', 'Details')}
          onClose={closeModal}
          size="sm"
          closeDisabled={deletingId === selected.id}
          unsavedChanges="read-only"
        >
          <div data-expense-detail="" className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold ${feeTypeToneClass(selected.fee_type)}`}>
                      {feeTypeLabel(selected.fee_type)}
                    </span>
                    <span className="min-w-0 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{selected.label || '—'}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formatFeeDate(selected.fee_date)} · {fmtClock24(selected.created_at)}
                  </p>
                </div>
                <span className="shrink-0 text-base font-bold text-emerald-700 dark:text-emerald-300">
                  {fmtMoney(Number(selected.amount_usd) || 0, Number(selected.amount_khr) || 0)}
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-slate-500 dark:text-slate-400">{tr('cashier', 'Cashier')}</dt>
              <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">{selected.created_by_name || '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">{tr('branch', 'Branch')}</dt>
              <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">{selected.branch_name || '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">{tr('receipt', 'Receipt')}</dt>
              <dd className="min-w-0 break-all font-mono text-slate-800 dark:text-slate-100">
                {selected.sale_receipt_number
                  ? `${selected.sale_receipt_number}${selected.sale_id ? ` · ${tr('sale', 'Sale')} #${selected.sale_id}` : ''}`
                  : selected.sale_id ? `${tr('sale', 'Sale')} #${selected.sale_id}` : '—'}
              </dd>
              <dt className="text-slate-500 dark:text-slate-400">{tr('delivery', 'Delivery')}</dt>
              <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">{selected.delivery_contact_name || '—'}</dd>
              <dt className="text-slate-500 dark:text-slate-400">{tr('notes', 'Notes')}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{selected.notes || '—'}</dd>
            </dl>

            <div data-expense-detail-actions="" className="flex items-stretch justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              {canEditFee ? (
                <button type="button" onClick={() => openEdit(selected)} disabled={deletingId === selected.id} className="btn-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-50">
                  <Pencil className="h-4 w-4" />
                  <span>{tr('edit', 'Edit')}</span>
                </button>
              ) : null}
              {canDeleteFee ? (
                <button
                  type="button"
                  onClick={() => { void handleDelete(selected).then((accepted) => { if (accepted) closeModal() }) }}
                  disabled={deletingId === selected.id}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  aria-label={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')}
                  title={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')}
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')}</span>
                </button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === 'form' ? (
        <Modal
          title={selected ? tr('edit_fee', 'Edit Expense') : tr('add_fee', 'Add Expense')}
          onClose={closeModal}
          closeDisabled={feeFormLocked}
          onMinimize={canMinimizeFeeForm && !feeFormLocked ? preserveFeeForm : undefined}
          headerExtra={canMinimizeFeeForm ? <MinimizeButton tr={(key, fallback) => tr(key, fallback)} onMinimize={preserveFeeForm} disabled={feeFormLocked} /> : null}
          size="sm"
          unsavedChanges={{ workKey: feeFormWorkKey(selected?.id) }}
        >
          <FeeForm
            key={`${selected?.id ?? 'new'}:${user?.id ?? 'anonymous'}`}
            fee={selected}
            actorId={user?.id}
            labelSuggestions={[...new Set(fees.map((row) => String(row.label || '').trim()).filter(Boolean))].sort()}
            onSave={handleSave}
            onClose={closeModal}
            onInteractionLockChange={setFeeFormLocked}
          />
        </Modal>
      ) : null}

      {showLabelManager && canEditFee ? (
        <Suspense fallback={null}>
          <ExpenseLabelManagerModal
            canEdit={() => canEditFeeRef.current}
            onClose={() => setShowLabelManager(false)}
            onChanged={() => load(true)}
            notify={notify}
            t={t}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
