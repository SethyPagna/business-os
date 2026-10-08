import { useCallback, useEffect, useRef, useState } from 'react'
import EntityLink from '../shared/EntityLink.tsx'
import { getHubDestinations, hubAnchor } from '../shared/hubNavigation.ts'
import { REVIEW_TIER_KEYS } from '../../utils/permissions.ts'
import { entityFieldLabel } from '../../utils/entityRecords.ts'
import { buildAuditFieldDiff } from '../../utils/auditLogFieldDiff.ts'
import AuditFieldDiffLine from '../utils-settings/AuditFieldDiffLine.tsx'
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
import { isBranchReviewUpdate, localizeBranchReviewError, reviewApprovalRefusalText } from '../../api/branchRuleErrors.ts'
import { cacheInvalidate } from '../../api/http.ts'
import { captureActorReadScope, isActorReadScopeCurrent } from '../../api/actorReadScope.ts'
import { isConfirmedProductCreateApproval, isProductCreateReviewState } from '../../utils/productCreateOutcome.ts'
import {
  approvePendingAction,
  approveProductCreatePendingAction,
  reconcileProductCreatePendingAction,
  getPendingActions as getPendingActionsRequest,
  rejectPendingAction,
  type PendingActionRow,
  type PendingActionStatus,
} from '../../api/reviewQueueTransport.ts'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: unknown, type?: string, duration?: number) => void

interface ReviewAppContextValue {
  t: TranslateFn
  notify: NotifyFn
  getPermissionTier: (key: string) => string
  can: (key: string, action: string) => boolean
  hasPermission: (key: string) => boolean
  navigateTo: (page: string, anchor?: string) => void
  user?: { id?: number | string | null } | null
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
  // Shared dd/mm/yyyy 24-hour formatter -- the old en-US call without
  // hour12:false rendered 12-hour AM/PM (Part-77 finding).
  return fmtDateTime24(date)
}

function reviewPayload(row: PendingActionRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.payload_json || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

function reviewDestination(row: PendingActionRow): { page: string; section: string } | null {
  if (row.section === 'products') return { page: 'products', section: 'products' }
  if (row.section === 'inventory') return { page: 'branches', section: 'products' }
  if (row.section === 'branches') return { page: 'branches', section: 'overview' }
  if (row.section === 'fees' || row.section === 'returns') return { page: 'sales', section: row.section }
  if (row.section === 'contacts') return { page: 'contacts', section: row.entity_type === 'supplier' ? 'suppliers' : row.entity_type === 'delivery_contact' ? 'delivery' : 'customers' }
  return null
}

function statusBadgeClass(status: PendingActionStatus): string {
  if (status === 'approved') return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
  if (status === 'rejected') return 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
  return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
}

export default function ReviewQueue() {
  const { t, notify, getPermissionTier, can, hasPermission, navigateTo, user } = useApp()
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
  const productReviewEpochRef = useRef(0)

  const load = useCallback(async (silent = false) => {
    const actorScope = captureActorReadScope('review')
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
      if (!isTrackedRequestCurrent(loadRequestRef, requestId) || !isActorReadScopeCurrent(actorScope, false)) return
      setRows(response?.data || [])
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId) || !isActorReadScopeCurrent(actorScope, false)) return
      setLoadError(error instanceof Error ? error.message : String(error || ''))
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId) && isActorReadScopeCurrent(actorScope, false)) {
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
    if (syncChannel.channel === 'pendingActions' || syncChannel.channel === 'users') void load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
    productReviewEpochRef.current++
  }, [])

  // N12: the server (POST /review/:id/approve) refuses self-approval and a reviewer
  // without Full access to the request's section, with these codes. Mirrored here so the
  // Approve button is not offered where the answer is known, and so a refusal that does
  // arrive is explained in the user's language instead of surfacing as a bare 403.
  const refusalText = (code: unknown, section: string): string | null => reviewApprovalRefusalText(code, section, (key) => tr(key, ''))
  const approveRefusalCode = (row: PendingActionRow): string | null => {
    if (row.requested_by != null && user?.id != null && Number(row.requested_by) === Number(user.id)) return 'review_self_approval'
    if (getPermissionTier(row.section) !== 'full') return 'review_section_full_required'
    return null
  }

  const sectionOptions = ['', ...REVIEW_TIER_KEYS].sort((a, b) => Number(b === sectionFilter) - Number(a === sectionFilter))
  const statusOptions = (['open', 'approved', 'rejected', 'all'] as StatusFilter[]).sort((a, b) => Number(b === statusFilter) - Number(a === statusFilter))

  const handleProductCreateApprove = async (row: PendingActionRow) => {
    const pendingId = row.id
    const actorScope = captureActorReadScope('review')
    const epoch = productReviewEpochRef.current
    if (!beginKeyedAction(actionRef, pendingId)) return
    const current = () => epoch === productReviewEpochRef.current && isActorReadScopeCurrent(actorScope, false)
    const unconfirmed = () => tr('product_create_approval_unconfirmed', 'The approval result could not be confirmed. Refresh the review queue before retrying this same request.')
    let confirmed = false
    const publish = async (status: 'approved' | 'rejected') => {
      if (!current() || confirmed) return
      confirmed = true
      notify(status === 'approved' ? tr('pending_action_approved', 'Approved -- the change has been applied') : tr('pending_action_rejected', 'Rejected'), status === 'approved' ? 'success' : 'info')
      await load(true)
    }
    let reconciliation: Promise<void> | null = null
    const reconcile = (failure?: unknown): Promise<void> => {
      if (reconciliation) return reconciliation
      reconciliation = (async () => {
        if (!current() || confirmed) return
        let response: Awaited<ReturnType<typeof reconcileProductCreatePendingAction>> | undefined
        try { response = await reconcileProductCreatePendingAction(pendingId, actorScope) } catch {}
        if (!current() || confirmed) return
        if (isProductCreateReviewState(pendingId, response?.data, 'approved')) await publish('approved')
        else if (isProductCreateReviewState(pendingId, response?.data, 'rejected')) await publish('rejected')
        else {
          const refusal = reviewApprovalRefusalText((failure as { code?: string } | undefined)?.code, row.section, (key) => tr(key, ''))
          notify(refusal ? refusal : (failure as { code?: string } | undefined)?.code === 'receiving_branch_inactive'
            ? tr('receiving_branch_inactive', 'This branch is inactive. Choose an active branch for new stock. Previously submitted lines keep their original branch.')
            : unconfirmed(), 'error')
          await load(true)
        }
      })().finally(() => { reconciliation = null })
      return reconciliation
    }
    setBusyId(pendingId)
    const physical = (async () => {
      try {
        let response: unknown
        let failure: unknown
        try { response = await approveProductCreatePendingAction(pendingId, actorScope) } catch (error) { failure = error }
        if (!current()) return
        cacheInvalidate('products')
        if (isConfirmedProductCreateApproval(pendingId, response)) await publish('approved')
        else await reconcile(failure)
      } finally {
        finishKeyedAction(actionRef, pendingId)
        if (current()) setBusyId(id => id === pendingId ? null : id)
      }
    })()
    try { await withLoaderTimeout(physical, 'review:approve', REVIEW_MUTATION_TIMEOUT_MS) } catch {
      if (current() && !confirmed) {
        cacheInvalidate('products')
        await reconcile()
      }
    }
  }

  const handleApprove = async (row: PendingActionRow) => {
    if (!canReview) { notify(tr('perm_view_only_generic', 'View only: you do not have permission to make this change.'), 'error'); return }
    if (row.section === 'products' && row.action_type === 'create' && row.entity_type === 'product') {
      await handleProductCreateApprove(row)
      return
    }
    if (!beginKeyedAction(actionRef, row.id)) return
    setBusyId(row.id)
    try {
      const response = await withLoaderTimeout(
        () => approvePendingAction(row.id),
        'review:approve',
        REVIEW_MUTATION_TIMEOUT_MS,
      )
      if (isBranchReviewUpdate(row) && (!response?.success || response.data?.id !== row.id || response.data?.status !== 'approved')) {
        throw Object.assign(new Error('The result could not be confirmed. Retry the same approval request.'), { code: 'unknown_outcome' })
      }
      notify(tr('pending_action_approved', 'Approved -- the change has been applied'), 'success')
      await load(true)
    } catch (error) {
      notify(reviewApprovalRefusalText((error as { code?: unknown } | null)?.code, row.section, (key) => tr(key, '')) ?? localizeBranchReviewError(row, error, (key) => tr(key, '')), 'error')
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
    <div className="page-scroll flex min-w-0 flex-col p-3 sm:p-6">
      <div className="sticky top-2 z-30 mb-4 min-w-0 space-y-2 bg-gray-50 pb-2 dark:bg-gray-900">
        <div role="group" aria-label={tr('sections', 'Sections')} className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          <span className="shrink-0 text-xs font-semibold text-slate-500">{tr('sections', 'Sections')}:</span>
          {sectionOptions.map((section) => (
            <button key={section || 'all'} type="button" aria-pressed={sectionFilter === section} onClick={() => setSectionFilter(section)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${sectionFilter === section ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'}`}>
              {section ? tr(section, section) : tr('all', 'All')}
            </button>
          ))}
        </div>
        <div role="group" aria-label={tr('status', 'Status')} className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          <span className="shrink-0 text-xs font-semibold text-slate-500">{tr('status', 'Status')}:</span>
          {statusOptions.map((status) => (
            <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs ${statusFilter === status ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              {tr(status, status)}
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
            const payload = reviewPayload(row)
            const content = buildAuditFieldDiff(null, row.payload_json, key => entityFieldLabel(key, tr))
            const destination = reviewDestination(row)
            const canNavigate = destination && can(row.section, 'view') && getHubDestinations(destination.page, { getPermissionTier, hasPermission, can }).some(item => item.id === destination.section)
            const search = row.section === 'products' ? String(payload.barcode || payload.name || '') : row.section === 'contacts' ? String(payload.phone || payload.name || '') : undefined
            const approveRefusal = row.status === 'open' ? approveRefusalCode(row) : null
            return (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {tr(row.section, row.section)}
                      </span>
                      <span className="text-xs text-slate-400">{tr(row.action_type, row.action_type)} / {entityFieldLabel(row.entity_type, tr)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.status)}`}>
                        {tr(row.status, row.status)}
                      </span>
                    </div>
                    <p className="mt-1 detail-scroll-text text-sm font-medium text-slate-700 dark:text-slate-200">
                      {row.summary || `${entityFieldLabel(row.entity_type, tr)}${row.entity_id != null ? ` #${row.entity_id}` : ''}`}
                      {canNavigate && destination ? <> · <EntityLink page={destination.page} anchor={hubAnchor(destination.page, destination.section)} search={search} navigate={navigateTo}>{tr('view_details', 'View details')}</EntityLink></> : null}
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
                    <div className="mt-2 min-w-0 space-y-1 [overflow-wrap:anywhere]">
                      {(expanded ? content : content.slice(0, 3)).map(field => <AuditFieldDiffLine key={field.key} row={field} />)}
                      {!content.length ? <p className="text-xs text-slate-400">{tr('historical_details_unavailable', 'Historical details unavailable')}</p> : null}
                    </div>
                    {content.length > 3 ? <button type="button" aria-expanded={expanded} className="mt-1 text-xs font-medium text-blue-600 underline dark:text-blue-400" onClick={() => setExpandedId(expanded ? null : row.id)}>
                      {expanded ? tr('hide_details', 'Hide details') : tr('view_details', 'View details')}
                    </button> : null}
                  </div>
                  {row.status === 'open' && canReview ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {approveRefusal ? (
                        <span className="max-w-[16rem] text-xs text-slate-400">{refusalText(approveRefusal, row.section)}</span>
                      ) : (
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
                      )}
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
