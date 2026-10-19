import { useCallback, useEffect, useRef, useState } from 'react'
import EntityLink from '../shared/EntityLink.tsx'
import ConfirmDialog from '../shared/ConfirmDialog'
import { getHubDestinations, hubAnchor } from '../shared/hubNavigation.ts'
import { REVIEW_TIER_KEYS } from '../../utils/permissions.ts'
import { entityFieldLabel } from '../../utils/entityRecords.ts'
import { buildAuditFieldDiff } from '../../utils/auditLogFieldDiff.ts'
import AuditFieldDiffLine from '../utils-settings/AuditFieldDiffLine.tsx'
import { fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
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
  REVIEW_REASON_MAX_LENGTH,
  isBranchReviewUpdate,
  localizeBranchReviewError,
  reviewApprovalRefusalText,
  reviewRejectReasonRefusalText,
  reviewStaleDecision,
  reviewStaleDecisionText,
} from '../../api/branchRuleErrors.ts'
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

// The reject dialog's state: the request being rejected, the reason typed so far, and the Worker's refusal of
// that reason (reason_too_long / invalid_reason) once it has been sent, shown beside the field.
type RejectDraft = { row: PendingActionRow; reason: string; refusal: string }

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '--'
  // The queue's stamps are D1's UTC with no offset: validate with the shared parser and pass the raw stamp to the shared
  // formatter, which states it in the business zone (a bare new Date(value) would read it in the device zone).
  if (Number.isNaN(parseServerTimestampMs(value))) return String(value)
  // Shared dd/mm/yyyy 24-hour formatter -- the old en-US call without
  // hour12:false rendered 12-hour AM/PM (Part-77 finding).
  return fmtDateTime24(value)
}

function reviewPayload(row: PendingActionRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.payload_json || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind === 'product.remove.pending') return {}
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_') && key !== 'offline_owner'))
  } catch { return {} }
}

function reviewDestination(row: PendingActionRow): { page: string; section: string } | null {
  if (row.section === 'products') return { page: 'products', section: 'products' }
  if (row.section === 'inventory') return { page: 'products', section: 'products' }
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
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null)

  const loadRequestRef = useRef(0)
  const actionRef = useRef<Set<string>>(new Set())
  const productReviewEpochRef = useRef(0)

  // `fresh` clears the read cache first. A refusal that says the queue is out of date (reviewStaleDecision) did
  // not go through the write path that normally clears it, and a cached list would show the same dead row again.
  const load = useCallback(async (silent = false, fresh = false) => {
    if (fresh) cacheInvalidate('review')
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

  // The reject dialog goes with the page, and Escape closes it: ConfirmDialog leaves Escape to its host
  // (useConfirmDialog answers it for the awaitable form; this dialog holds state, so the same lives here).
  const rejectOpen = rejectDraft !== null
  useEffect(() => {
    if (!isActive) setRejectDraft(null)
  }, [isActive])
  useEffect(() => {
    if (!rejectOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setRejectDraft(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [rejectOpen])

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
          const refusal = reviewApprovalRefusalText((failure as { code?: string } | undefined)?.code, row.section, (key) => tr(key, ''), (failure as { permission?: unknown } | undefined)?.permission)
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
      // The request changed under the reviewer or was decided by someone else. Say which, and re-read
      // the queue from the server so the row is not left on screen with live buttons.
      const stale = reviewStaleDecision(error)
      if (stale) {
        notify(reviewStaleDecisionText(stale, (key) => tr(key, '')), 'warning')
        await load(true, true)
        return
      }
      // Every other refusal the Worker codes (self-approval, a missing grant and which one, no approval rule, ...) reads
      // in the operator's language; anything uncoded keeps its own text.
      const detail = error as { code?: unknown; permission?: unknown } | null
      notify(reviewApprovalRefusalText(detail?.code, row.section, (key) => tr(key, ''), detail?.permission) ?? localizeBranchReviewError(row, error, (key) => tr(key, '')), 'error')
    } finally {
      finishKeyedAction(actionRef, row.id)
      setBusyId(null)
    }
  }

  // Reject asks for its optional reason in the shared compact dialog (the browser's prompt() could neither be
  // translated, nor show a counter, nor be capped). The dialog renders its real content -- the request, its status
  // before and after, and the reason field with its counter -- from first paint.
  const handleReject = (row: PendingActionRow) => {
    if (!canReview) { notify(tr('perm_view_only_generic', 'View only: you do not have permission to make this change.'), 'error'); return }
    setRejectDraft({ row, reason: '', refusal: '' })
  }

  const submitReject = async () => {
    const draft = rejectDraft
    if (!draft) return
    const { row } = draft
    if (!canReview) { setRejectDraft(null); notify(tr('perm_view_only_generic', 'View only: you do not have permission to make this change.'), 'error'); return }
    // Trimmed, and never longer than the field allows; blank is "no reason" (optional), sent as null.
    const reason = draft.reason.trim()
    if (!beginKeyedAction(actionRef, row.id)) return
    setBusyId(row.id)
    try {
      await withLoaderTimeout(
        () => rejectPendingAction(row.id, reason || null),
        'review:reject',
        REVIEW_MUTATION_TIMEOUT_MS,
      )
      setRejectDraft(null)
      notify(tr('pending_action_rejected', 'Rejected'), 'success')
      await load(true)
    } catch (error) {
      // A reason the Worker refused leaves the request open -- keep the dialog and the typed text, and say why.
      const reasonRefusal = reviewRejectReasonRefusalText(error, (key) => tr(key, ''))
      if (reasonRefusal) {
        setRejectDraft((current) => (current && current.row.id === row.id ? { ...current, refusal: reasonRefusal } : current))
        return
      }
      setRejectDraft(null)
      const stale = reviewStaleDecision(error)
      if (stale) {
        notify(reviewStaleDecisionText(stale, (key) => tr(key, '')), 'warning')
        await load(true, true)
        return
      }
      const detail = error as { code?: unknown; permission?: unknown } | null
      notify(reviewApprovalRefusalText(detail?.code, row.section, (key) => tr(key, ''), detail?.permission) ?? (error instanceof Error ? error.message : String(error || '')), 'error')
    } finally {
      finishKeyedAction(actionRef, row.id)
      setBusyId(null)
    }
  }

  const rowTitle = (row: PendingActionRow): string => row.summary || `${entityFieldLabel(row.entity_type, tr)}${row.entity_id != null ? ` #${row.entity_id}` : ''}`

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
            const content = buildAuditFieldDiff(null, JSON.stringify(payload), key => entityFieldLabel(key, tr))
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
                      {rowTitle(row)}
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

      {rejectDraft ? (
        <ConfirmDialog
          t={t}
          title={tr('reject', 'Reject')}
          message={rowTitle(rejectDraft.row)}
          items={[{ label: tr('status', 'Status'), value: `${tr('open', 'Open')} \u2192 ${tr('rejected', 'Rejected')}` }]}
          confirmLabel={tr('reject', 'Reject')}
          danger
          working={busyId === rejectDraft.row.id}
          onConfirm={() => { void submitReject() }}
          onClose={() => setRejectDraft(null)}
        >
          <div>
            <label htmlFor="review-reject-reason" className="mb-1 block text-xs font-medium leading-relaxed text-gray-600 dark:text-gray-300">
              {tr('reject_reason_prompt', 'Reason for rejecting (optional):')}
            </label>
            <textarea
              id="review-reject-reason"
              name="review_reject_reason"
              className="input resize-none leading-relaxed"
              rows={2}
              autoFocus
              maxLength={REVIEW_REASON_MAX_LENGTH}
              value={rejectDraft.reason}
              disabled={busyId === rejectDraft.row.id}
              aria-describedby="review-reject-reason-count"
              onChange={(event) => {
                const reason = event.target.value.slice(0, REVIEW_REASON_MAX_LENGTH)
                setRejectDraft((current) => (current ? { ...current, reason, refusal: '' } : current))
              }}
            />
            <div className="mt-1 flex items-start gap-2">
              {rejectDraft.refusal ? (
                <p role="alert" className="min-w-0 flex-1 text-xs leading-relaxed text-red-600 dark:text-red-300">{rejectDraft.refusal}</p>
              ) : null}
              <span
                id="review-reject-reason-count"
                className={`ml-auto shrink-0 text-xs leading-relaxed tabular-nums ${rejectDraft.reason.length >= REVIEW_REASON_MAX_LENGTH ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}
              >
                {`${rejectDraft.reason.length}/${REVIEW_REASON_MAX_LENGTH}`}
              </span>
            </div>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
