import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
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
  getFees as getFeesRequest,
  updateFee as updateFeeRequest,
  type FeeListResult,
  type FeePayload,
  type FeeRecord,
  type FeeType,
} from '../../api/feesTransport.ts'
import FeeForm, { FEE_TYPE_OPTIONS } from './FeeForm.tsx'
import { primaryToolbarButtonClassName } from '../shared/toolbarButtonStyles'

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

export default function FeesPage() {
  const { getPermissionTier, t, notify, fmtUSD, fmtKHR } = useApp()
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
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<FeeBranchOption[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  const [modal, setModal] = useState<FeeModal>(null)
  const [selected, setSelected] = useState<FeeRecord | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const loadRequestRef = useRef(0)
  const deleteActionRef = useRef<Set<string>>(new Set())

  const load = useCallback(async (silent = false) => {
    const requestId = beginTrackedRequest(loadRequestRef)
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const response = await withLoaderTimeout(
        () => getFeesRequest({
          search: search.trim() || undefined,
          fee_type: typeFilter !== 'all' ? typeFilter : undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
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
  }, [search, typeFilter, fromDate, toDate, branchFilter, page, pageSize])

  useEffect(() => {
    if (!isActive) return
    void load()
  }, [isActive, load])

  // Reset to page 1 whenever a filter changes underneath an existing page
  // position, so a narrowed result set never lands on an empty out-of-range
  // page.
  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, fromDate, toDate, branchFilter])

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

  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const fees = result.fees || []
  const summaryRows = result.summary || []
  const totalUsd = summaryRows.reduce((sum, row) => sum + Number(row.total_usd || 0), 0)
  const totalKhr = summaryRows.reduce((sum, row) => sum + Number(row.total_khr || 0), 0)

  const feeTypeLabel = useCallback((type: string): string => {
    const option = FEE_TYPE_OPTIONS.find((opt) => opt.value === type)
    return option ? (t(option.labelKey) || option.fallback) : type
  }, [t])

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
        notify(tr('fee_updated', 'Fee updated'), 'success')
      } else {
        await withLoaderTimeout(
          () => createFeeRequest(payload),
          'fees:create',
          FEES_MUTATION_TIMEOUT_MS,
        )
        notify(tr('fee_created', 'Fee added'), 'success')
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
    if (!window.confirm(tr('delete_fee_confirm', 'Delete this fee record? This cannot be undone.'))) return
    if (!beginKeyedAction(deleteActionRef, fee.id)) return
    setDeletingId(fee.id)
    try {
      await withLoaderTimeout(
        () => deleteFeeRequest(fee.id),
        'fees:delete',
        FEES_MUTATION_TIMEOUT_MS,
      )
      notify(tr('fee_deleted', 'Fee deleted'), 'success')
      await load(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      finishKeyedAction(deleteActionRef, fee.id)
      setDeletingId(null)
    }
  }

  const activeFilterCount = useMemo(
    () => [typeFilter !== 'all', !!fromDate, !!toDate, !!branchFilter].filter(Boolean).length,
    [typeFilter, fromDate, toDate, branchFilter],
  )

  const filterSections = useMemo(() => ([
    {
      id: 'type',
      label: tr('fee_type', 'Fee Type'),
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
    {
      id: 'date',
      label: tr('date', 'Date'),
      summary: fromDate || toDate
        ? `${fromDate || '…'} – ${toDate || '…'}`
        : tr('all_time', 'All time'),
      active: !!fromDate || !!toDate,
      // Unified range control (same Start → End pill the Dashboard/reports
      // use) instead of two loose raw date inputs.
      render: () => (
        <div className="p-1">
          <DateTimeRangePicker
            value={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
            onChange={(range) => {
              setFromDate(range.startDate || '')
              setToDate(range.endDate || '')
            }}
            t={t}
            showTime={false}
            triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2"
          />
        </div>
      ),
    },
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
  ]), [tr, t, typeFilter, fromDate, toDate, branchFilter, branches])

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      {/* Page title removed (Aug 19 2026 UI request): no other page in the
          app repeats its own name in an h1 here -- the sidebar nav item
          already names the page -- so Fees having one was the odd one out,
          not a deliberate design choice. Hint text kept (it's page-usage
          guidance, not a title) but now only rendered when there's nothing
          else to anchor the row, so an empty state doesn't look bare. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {summaryRows.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {tr('fees_page_hint', 'Track tax, delivery, and other charges, optionally matched to a sale.')}
          </p>
        ) : <div />}
        {summaryRows.length > 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <Receipt className="h-3.5 w-3.5 text-slate-400" />
            <span>{tr('total', 'Total')}:</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtUSD(totalUsd)}</span>
            {totalKhr > 0 ? <span className="text-slate-400">/ {fmtKHR(totalKhr)}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="sticky top-2 z-30 -mx-1 mb-4 space-y-3 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-1 sm:flex-nowrap">
          <SearchInput
            id="fees-search"
            name="fees_search"
            value={search}
            onChange={setSearch}
            placeholder={tr('search_fees_placeholder', 'Search fees by label or notes')}
            className="min-w-0 flex-1"
          />
          <FilterMenu
            label={tr('filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={filterSections}
            onClear={() => { setTypeFilter('all'); setFromDate(''); setToDate(''); setBranchFilter('') }}
            compact
          />
          <button
            type="button"
            // Was plain `.btn-primary flex-shrink-0 text-sm` with no
            // shared sizing -- this was the button named explicitly in
            // the "manage/add buttons... too wide/long in some places
            // and too small in others" feedback (Aug 23 2026). Now uses
            // the same fixed height/padding every other page's primary
            // toolbar button uses (shared/toolbarButtonStyles.ts), so it
            // matches Products' "Product" button and Users' "Add user"
            // instead of falling back to `.btn-primary`'s own bare
            // min-height and looking undersized next to them.
            className={primaryToolbarButtonClassName}
            onClick={openAdd}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{tr('add_fee', 'Add Fee')}</span>
          </button>
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
          <span>{tr('no_fees', 'No fees recorded yet.')}</span>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {tr('add_fee', 'Add Fee')}
          </button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 sm:block">
            <table className="min-w-[860px] w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
                <tr>
                  <th className="px-3 py-2">{tr('date', 'Date')}</th>
                  <th className="px-3 py-2">{tr('fee_type', 'Fee Type')}</th>
                  <th className="px-3 py-2">{tr('fee_label', 'Label')}</th>
                  <th className="px-3 py-2 text-right">{tr('amount_usd', 'Amount (USD)')}</th>
                  <th className="px-3 py-2 text-right">{tr('amount_khr', 'Amount (KHR)')}</th>
                  <th className="px-3 py-2">{tr('fee_matched_sale_id', 'Matched Sale ID (optional)')}</th>
                  <th className="px-3 py-2">{tr('branch', 'Branch')}</th>
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
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fee.label || '--'}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-700 dark:text-slate-200">{fee.amount_usd ? fmtUSD(fee.amount_usd) : '--'}</td>
                    <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">{fee.amount_khr ? fmtKHR(fee.amount_khr) : '--'}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                      {fee.sale_receipt_number || fee.sale_id || '--'}
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                      {fee.branch_name || '--'}
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
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{fee.amount_usd ? fmtUSD(fee.amount_usd) : '--'}</span>
                  {fee.amount_khr ? <span className="text-slate-400">{fmtKHR(fee.amount_khr)}</span> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-end">
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
        <Modal title={selected ? tr('edit_fee', 'Edit Fee') : tr('add_fee', 'Add Fee')} onClose={closeModal} size="sm">
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
