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
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import Modal from '../shared/Modal'
import SearchInput from '../shared/SearchInput'
import FilterMenu, { type FilterOption } from '../shared/FilterMenu'
import PaginationControls, { PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
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
  getAllFeesForExport,
  getFees as getFeesRequest,
  getFeesReport,
  updateFee as updateFeeRequest,
  type FeeListResult,
  type FeePayload,
  type FeeRecord,
  type FeeType,
} from '../../api/feesTransport.ts'
import FeeForm, { FEE_TYPE_OPTIONS } from './FeeForm.tsx'
import StatsStrip, { statsPresetRange, type StatCardDef } from '../shared/StatsStrip.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import ExportMenu from '../shared/ExportMenu.tsx'
import { makeReportMoneyFormatter } from '../../utils/reportMoney.ts'
import type { DateTimeRange } from '../shared/DateTimeRangePicker'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'

const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'fees-export-options')

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: unknown, type?: string, duration?: number) => void

interface FeesAppContextValue {
  // Tier-aware read (utils/permissions.ts). Fees needs the TIER rather than
  // a per-action boolean, because nothing here is blocked -- it needs to
  // know whether a delete will queue, not whether it is allowed.
  getPermissionTier: (key: string) => string
  t: TranslateFn
  notify: NotifyFn
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
  khrToUsd: (value: unknown) => number
  usdToKhr: (value: unknown) => number
  displayCurrency: string
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

type FeeModal = 'form' | null
type FeeTypeFilter = FeeType | 'all'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatFeeDate(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
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
  const { getPermissionTier, t, notify, fmtUSD, fmtKHR, khrToUsd, usdToKhr, displayCurrency } = useApp()
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
  // range that could disagree with it. Default today. (Strip data state is
  // declared further down.)
  const [stripRange, setStripRange] = useState<DateTimeRange>(() => statsPresetRange('today'))
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<FeeBranchOption[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  const [modal, setModal] = useState<FeeModal>(null)
  const [selected, setSelected] = useState<FeeRecord | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)

  const loadRequestRef = useRef(0)
  const deleteActionRef = useRef<Set<string>>(new Set())
  const exportInFlightRef = useRef(false)

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
      setResult(response || EMPTY_RESULT)
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
  // range-scoped (default TODAY) with per-card fold breakdowns from
  // GET /api/fees/report -- by type, and the range's busiest days.
  type FeesStripPayload = {
    totals?: { count?: number; amount_usd?: number; amount_khr?: number }
    days?: Array<{ date?: string; count?: number; amount_usd?: number; amount_khr?: number }>
    by_type?: Array<{ fee_type?: string; count?: number; amount_usd?: number; amount_khr?: number }>
  }
  const [stripData, setStripData] = useState<FeesStripPayload | null>(null)
  const [stripLoading, setStripLoading] = useState(false)
  const stripRequestRef = useRef(0)
  const loadStatsStrip = useCallback(async (): Promise<void> => {
    if (!isActive || !stripRange.startDate || !stripRange.endDate) return
    const requestId = ++stripRequestRef.current
    setStripLoading(true)
    try {
      const result = await getFeesReport({ startDate: stripRange.startDate, endDate: stripRange.endDate })
      if (stripRequestRef.current !== requestId) return
      setStripData((result || {}) as FeesStripPayload)
    } catch {
      if (stripRequestRef.current !== requestId) return
      setStripData(null)
    } finally {
      if (stripRequestRef.current === requestId) setStripLoading(false)
    }
  }, [isActive, stripRange.endDate, stripRange.startDate])
  useEffect(() => { void loadStatsStrip() }, [loadStatsStrip])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'fees') void loadStatsStrip()
  }, [isActive, loadStatsStrip, syncChannel?.channel, syncChannel?.ts])

  const stripCards = useMemo<StatCardDef[]>(() => {
    const totals = stripData?.totals || {}
    const byType = stripData?.by_type || []
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
        key: 'total',
        label: tr('total', 'Total'),
        value: fmtMoney(amountUsd, amountKhr),
        tone: 'accent',
        hint: tr('stats_fees_total_hint', 'Sum of expense amounts in the range. Expenses are recorded in USD or KHR, so both totals are shown. The breakdown lists the days with the most spend.'),
        details: days.slice(0, 8).map((day) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day.date || ''))
          return {
            label: m ? `${m[2]}/${m[3]}/${m[1]}` : String(day.date || ''),
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

  const feeTypeLabel = useCallback((type: string): string => {
    const option = FEE_TYPE_OPTIONS.find((opt) => opt.value === type)
    return option ? (t(option.labelKey) || option.fallback) : type
  }, [t])

  const openFeeExport = useCallback(async (
    scope: 'visible' | 'filtered' | 'all',
  ): Promise<void> => {
    if (exportInFlightRef.current) return
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
      if (!sourceRows.length) {
        notify(tr('no_data_to_export', 'No data to export'), 'error')
        return
      }
      setExportDialog({
        rows: buildFeeExportRows(sourceRows, feeTypeLabel),
        baseName: scope === 'all' ? 'expenses-all' : scope === 'filtered' ? 'expenses-filtered' : 'expenses-visible',
      })
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      exportInFlightRef.current = false
    }
  }, [branchFilter, feeTypeLabel, fees, notify, search, stripRange.endDate, stripRange.startDate, tr, typeFilter])

  const exportItems = useMemo(() => ([
    { label: tr('export_visible', 'Export visible page'), onClick: () => { void openFeeExport('visible') } },
    { label: tr('export_filtered_time_range', 'Export all matching filters'), onClick: () => { void openFeeExport('filtered') } },
    { label: tr('export_all', 'Export all expenses'), onClick: () => { void openFeeExport('all') } },
  ]), [openFeeExport, tr])

  const openAdd = () => { setSelected(null); setModal('form') }
  const openEdit = (fee: FeeRecord) => { setSelected(fee); setModal('form') }
  const closeModal = () => { setModal(null); setSelected(null) }

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
        await withLoaderTimeout(
          () => createFeeRequest(payload),
          'fees:create',
          FEES_MUTATION_TIMEOUT_MS,
        )
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
      if (isWriteConflictError(error)) {
        await load(true)
      } else {
        notify(error instanceof Error ? error.message : String(error || ''), 'error')
      }
      throw error
    }
  }

  const handleDelete = async (fee: FeeRecord) => {
    if (!window.confirm(tr('delete_fee_confirm', 'Delete this expense record? This cannot be undone.'))) return
    if (!beginKeyedAction(deleteActionRef, fee.id)) return
    setDeletingId(fee.id)
    try {
      await withLoaderTimeout(
        () => deleteFeeRequest(fee.id),
        'fees:delete',
        FEES_MUTATION_TIMEOUT_MS,
      )
      notify(tr('fee_deleted', 'Expense deleted'), 'success')
      await load(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      finishKeyedAction(deleteActionRef, fee.id)
      setDeletingId(null)
    }
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
        rangeActions={(
          <ExportMenu label={tr('export', 'Export')} items={exportItems} triggerClassName="h-8 px-2.5 text-xs" />
        )}
        actions={(
          // Fit-to-content, not the wide toolbar-width button ("the add
          // button for fees are too wide, can make fit") — and it shares
          // the range row to save a row.
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            onClick={openAdd}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {tr('add_fee', 'Add Expense')}
          </button>
        )}
      />

      {exportDialog ? (
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

      <div className="sticky top-2 z-30 -mx-1 mb-4 space-y-3 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        {/* The Start→End range that scopes the stats strip above now leads
            this pinned toolbar as its own row, directly above the search bar
            (user, Aug 31: "fish out the start date and end date from the stats
            button ... right above the search bar row"). Same range state
            (stripRange) still feeds the strip's cards. */}
        <StatsRangeRow className="pt-1" range={stripRange} onRangeChange={setStripRange} t={t} />
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
          {/* Add Fee moved into the stats strip's range row above ("date
              start and end date is one row with the add buttons"). */}
        </div>
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
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('add_fee', 'Add Expense')}
          </button>
        </div>
      ) : (
        <>
          {/* One Amount column (display-currency aware, the raw USD/KHR pair
              folded by reportMoney) and one Details column (receipt-style
              sale chip + branch, stacked, simply BLANK when unset) replace
              the old USD / KHR / Sale ID / Branch four-some -- almost every
              imported row has no branch, no sale and only one currency, so
              that layout was mostly "--" cells (user: "no need such weird
              not consistent breakdown"). */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 sm:block">
            <table className="min-w-[680px] w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
                <tr>
                  <th className="px-3 py-2">{tr('date', 'Date')}</th>
                  <th className="px-3 py-2">{tr('type', 'Type')}</th>
                  <th className="px-3 py-2">{tr('fee_label', 'Label')}</th>
                  <th className="px-3 py-2 text-right">{tr('amount', 'Amount')}</th>
                  <th className="px-3 py-2">{tr('details', 'Details')}</th>
                  <th className="px-3 py-2 text-right">{tr('actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {fees.map((fee) => (
                  <tr key={fee.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatFeeDate(fee.fee_date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {feeTypeLabel(fee.fee_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fee.label || ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-slate-700 dark:text-slate-200">
                      {fmtMoney(Number(fee.amount_usd) || 0, Number(fee.amount_khr) || 0)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-0.5">
                        {fee.sale_receipt_number || fee.sale_id ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Receipt className="h-3 w-3 shrink-0" />
                            {fee.sale_receipt_number || `#${fee.sale_id}`}
                          </span>
                        ) : null}
                        {fee.branch_name ? (
                          <span className="text-xs text-slate-400">{fee.branch_name}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(fee)}
                          aria-label={tr('edit', 'Edit')}
                          title={tr('edit', 'Edit')}
                          className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(fee)}
                          disabled={deletingId === fee.id}
                          aria-label={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')}
                          title={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')}
                          className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card layout for narrow screens -- the 7-column table doesn't
              fit comfortably below sm, same pattern as the other list pages
              in this app (Branches, Returns). */}
          <div className="space-y-2 sm:hidden">
            {fees.map((fee) => (
              <div key={fee.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {feeTypeLabel(fee.fee_type)}
                      </span>
                      <span className="text-xs text-slate-400">{formatFeeDate(fee.fee_date)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{fee.label || '--'}</p>
                    {fee.branch_name ? (
                      <p className="mt-0.5 truncate text-xs text-slate-400">{fee.branch_name}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => openEdit(fee)} aria-label={tr('edit', 'Edit')} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDelete(fee)} disabled={deletingId === fee.id} aria-label={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')} title={feesNeedsApproval ? tr('delete_needs_approval', 'Delete (needs approval)') : tr('delete', 'Delete')} className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {fmtMoney(Number(fee.amount_usd) || 0, Number(fee.amount_khr) || 0)}
                  </span>
                  {fee.sale_receipt_number || fee.sale_id ? (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <Receipt className="h-3 w-3 shrink-0" />
                      <span className="truncate">{fee.sale_receipt_number || `#${fee.sale_id}`}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-center">
            <PaginationControls
              compact
              rangeAsPageSize
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

      {modal === 'form' ? (
        <Modal title={selected ? tr('edit_fee', 'Edit Expense') : tr('add_fee', 'Add Expense')} onClose={closeModal} size="sm">
          <FeeForm
            fee={selected}
            labelSuggestions={[...new Set(fees.map((row) => String(row.label || '').trim()).filter(Boolean))].sort()}
            onSave={handleSave}
            onClose={closeModal}
          />
        </Modal>
      ) : null}
    </div>
  )
}
