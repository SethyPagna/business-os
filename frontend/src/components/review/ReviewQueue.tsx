import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import XCircle from 'lucide-react/dist/esm/icons/x-circle.js'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginKeyedAction, finishKeyedAction } from '../../utils/actionGuards.ts'
import {
  approvePendingAction,
  getPendingActions as getPendingActionsRequest,
  rejectPendingAction,
  type PendingActionRow,
  type PendingActionStatus,
} from '../../api/reviewQueueTransport.ts'

// The Review/Approval page itself -- step (3) of progress.md's
// "Permissions UI redesign" item. Lists pending_actions rows created by
// lib/reviewGate.ts's maybeQueueForReview() (currently: fees delete only,
// see routes/fees.ts + lib/reviewApply.ts's registered applier) and lets
// a Full-Access `review`-permission user approve or reject each one.
// Gated Full Access only at the route/nav level (App.tsx/AppContext.tsx/
// navigationConfig.ts), same pattern Users already uses -- nothing
// further to check inside this component itself.
//
// A 501 response from approve ("no applier registered yet for this
// section/action/entity") is a real, expected outcome for any section
// beyond fees today (products/inventory/returns/contacts/library all
// have REVIEW_TIER_KEYS entries but no wired write route or applier
// yet) -- surfaced as a plain error notification rather than treated as
// a bug, since it genuinely means "this can't be approved yet."

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: unknown, type?: string, duration?: number) => void

interface ReviewAppContextValue {
  t: TranslateFn
  notify: NotifyFn
  getPermissionTier: (key: string) => string
}

interface ReviewSyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: unknown
  } | null
}

const useApp = useAppHook as unknown as () => ReviewAppContextValue
const useSync = useSyncHook as unknown as () => ReviewSyncContextValue

const REVIEW_LOAD_TIMEOUT_MS = 12000
const REVIEW_MUTATION_TIMEOUT_MS = 12000

type StatusFilter = PendingActionStatus | 'all'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  // Shared mm/dd/yyyy 24-hour formatter -- the old en-US call without
  // hour12:false rendered 12-hour AM/PM (Part-77 finding).
  return fmtDateTime24(date)
}

function formatPayload(row: PendingActionRow): string {
  try {
    const parsed = JSON.parse(row.payload_json || '{}')
    return JSON.stringify(parsed, null, 2)
  } catch {
    return row.payload_json || '{}'
  }
}

function statusBadgeClass(status: PendingActionStatus): string {
  if (status === 'approved') return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
  if (status === 'rejected') return 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
  return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
}

export default function ReviewQueue() {
  const { t, notify, getPermissionTier } = useApp()
  // Part 557 slice 5: 'review' is a view-tier section. A View-only grant reads
  // the pending queue but Approve/Reject are hidden here and refused by the
  // backend (both re-check strict hasPermission('review')). Full only.
  const canReview = getPermissionTier('review') === 'full'
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('review')
  const tr = useCallback((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])

  const [rows, setRows] = useState<PendingActionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [sectionFilter, setSectionFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadRequestRef = useRef(0)
  const actionRef = useRef<Set<string>>(new Set())

  const load = useCallback(async (silent = false) => {
    const requestId = beginTrackedRequest(loadRequestRef)
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const response = await withLoaderTimeout(
        () => getPendingActionsRequest({
          status: statusFilter,
          section: sectionFilter || undefined,
        }),
        'review:list',
        REVIEW_LOAD_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setRows(response?.data || [])
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setLoadError(error instanceof Error ? error.message : String(error || ''))
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) {
        setLoading(false)
        setHasLoadedOnce(true)
      }
    }
  }, [statusFilter, sectionFilter])

  useEffect(() => {
    if (!isActive) return
    void load()
  }, [isActive, load])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'pendingActions') void load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const sectionOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((row) => { if (row.section) set.add(row.section) })
    return Array.from(set).sort()
  }, [rows])

  const handleApprove = async (row: PendingActionRow) => {
    if (!canReview) { notify(tr('perm_view_only_generic', 'View only: you do not have permission to make this change.'), 'error'); return }
    if (!beginKeyedAction(actionRef, row.id)) return
    setBusyId(row.id)
    try {
      await withLoaderTimeout(
        () => approvePendingAction(row.id),
        'review:approve',
        REVIEW_MUTATION_TIMEOUT_MS,
      )
      notify(tr('pending_action_approved', 'Approved -- the change has been applied'), 'success')
      await load(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      finishKeyedAction(actionRef, row.id)
      setBusyId(null)
    }
  }

  const handleReject = async (row: PendingActionRow) => {
    if (!canReview) { notify(tr('perm_view_only_generic', 'View only: you do not have permission to make this change.'), 'error'); return }
    const reason = window.prompt(tr('reject_reason_prompt', 'Reason for rejecting (optional):')) ?? undefined
    if (reason === undefined) return
    if (!beginKeyedAction(actionRef, row.id)) return
    setBusyId(row.id)
    try {
      await withLoaderTimeout(
        () => rejectPendingAction(row.id, reason || null),
        'review:reject',
        REVIEW_MUTATION_TIMEOUT_MS,
      )
      notify(tr('pending_action_rejected', 'Rejected'), 'success')
      await load(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error || ''), 'error')
    } finally {
      finishKeyedAction(actionRef, row.id)
      setBusyId(null)
    }
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {tr('review_queue', 'Review Queue')}
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {tr('review_queue_hint', 'Approve or reject changes submitted by Review Required users.')}
          </p>
        </div>
      </div>

      <div className="sticky top-2 z-30 -mx-1 mb-4 space-y-3 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 text-xs font-semibold text-slate-500">{tr('sections', 'Sections')}:</span>
          {['', ...sectionOptions].map((section) => (
            <button key={section || 'all'} type="button" onClick={() => setSectionFilter(section)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${sectionFilter === section ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'}`}>
              {section || tr('all', 'All')}
            </button>
          ))}
          <span className="ml-2 mr-1 text-xs font-semibold text-slate-500">{tr('status', 'Status')}:</span>
          {(['open', 'approved', 'rejected', 'all'] as StatusFilter[]).map((status) => (
            <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-lg px-2.5 py-1.5 text-xs ${statusFilter === status ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              {status === 'all' ? tr('all', 'All') : tr(status, status)}
            </button>
          ))}
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
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-slate-400">
          <ClipboardCheck className="h-8 w-8 text-slate-300" />
          <span>{tr('no_pending_actions', 'No pending requests here.')}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const expanded = expandedId === row.id
            const isBusy = busyId === row.id
            return (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {row.section}
                      </span>
                      <span className="text-xs text-slate-400">{row.action_type} / {row.entity_type}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                        {tr(row.status, row.status)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {row.summary || `#${row.entity_id ?? '--'}`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {tr('requested_by', 'Requested by')}: {row.requested_by_name || '--'} · {formatDateTime(row.created_at)}
                    </p>
                    {row.status !== 'open' ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {tr('reviewed_by', 'Reviewed by')}: {row.reviewed_by_name || '--'} · {formatDateTime(row.reviewed_at)}
                        {row.reject_reason ? ` — ${row.reject_reason}` : ''}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-blue-600 underline dark:text-blue-400"
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      {expanded ? tr('hide_details', 'Hide details') : tr('view_details', 'View details')}
                    </button>
                    {expanded ? (
                      <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        {formatPayload(row)}
                      </pre>
                    ) : null}
                  </div>
                  {row.status === 'open' && canReview ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleApprove(row)}
                        disabled={isBusy}
                        aria-label={tr('approve', 'Approve')}
                        title={tr('approve', 'Approve')}
                        className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-950/40 dark:text-green-300"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {tr('approve', 'Approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(row)}
                        disabled={isBusy}
                        aria-label={tr('reject', 'Reject')}
                        title={tr('reject', 'Reject')}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {tr('reject', 'Reject')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
