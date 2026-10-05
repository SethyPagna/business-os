import { useApp } from '../../AppContext'
import { canViewAcquisitionCosts, canEditAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import type { PermissionUser } from '../../utils/permissions.ts'
import { canOverrideMergePrice } from '../../utils/productMergePriceAccess.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../shared/ConflictIcon.ts'
import AppSelect from '../shared/AppSelect.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { ProductImg } from './shared/primitives.tsx'
import {
  getPossiblySameProducts,
  dismissProductDuplicateCluster,
  createSelectedConflictGroupReview,
  applySelectedConflictGroupReview,
  finalizeSelectedConflictGroupReview,
  getSelectedConflictGroupReviewPage,
  makeSelectedConflictGroupApplyBody,
  type SelectedConflictGroupReviewResult,
  type SelectedConflictGroupFinalizeResult,
  type SelectedConflictGroupApplyBody,
  type SelectedConflictGroupApplyResult,
} from '../../api/productWriteTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import ResolveModal, { type ResolveDraft } from '../shared/ResolveModal.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { COPY_SELECTOR, deferCopySurfaceAction } from '../shared/textAffordances.ts'
import { createProductResolveAdapter } from './productResolveAdapter.ts'
import { SelectedConflictGroupReviewModal } from './SelectedConflictMergeReviewModal.tsx'
import {
  RESTORE_WORK_EVENT,
  consumePendingRestore,
  markRestoreHandled,
  minimizeWork,
  reparkDeniedRestore,
  type MinimizedWorkEntry,
} from '../../utils/minimizedWork.ts'
import {
  createSelectedConflictRequestCoordinator,
  selectedConflictCaseKey,
  selectedConflictOutcomeIsUnknown,
  type ProductConflictCluster,
  type ProductConflictProduct,
} from '../../utils/selectedConflictMerge.ts'
import {
  buildSelectedConflictGroupReviewRequest,
  buildSelectedConflictGroupFinalizeRequest,
  SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT,
  type SelectedConflictGroupResolutionChoice,
} from '../../utils/selectedConflictActionReview.ts'

// Products -> Conflicts: the human-review residue the identity rule cannot
// settle on its own. The card mirrors the contacts Conflicts card
// (contacts/DuplicatesTab.tsx): one Resolve per group opens the shared
// Resolve grid with every product of the group, where each field is picked
// and the Final column shows the result; Dismiss (keep separate) confirms
// with before and after. Merging folds stock, received-date records, images
// and history exactly like the merge-duplicates cleanup: it is the same fold.

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

type Severity = ProductConflictCluster['severity']
type ClusterProduct = ProductConflictProduct
type Cluster = ProductConflictCluster

// The group open in the Resolve grid, and the choices a restored chip brings back.
type ResolveTarget = { cluster: Cluster; draft?: ResolveDraft }

const SEVERITY_STYLE: Record<Severity, string> = {
  leading_zero: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30',
  same_barcode: 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30',
  same_name: 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30',
  similar_name: 'border-violet-200 bg-violet-50 dark:border-violet-900/40 dark:bg-violet-950/30',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  leading_zero: 'text-emerald-700 dark:text-emerald-300',
  same_barcode: 'text-amber-800 dark:text-amber-300',
  same_name: 'text-blue-700 dark:text-blue-300',
  similar_name: 'text-violet-700 dark:text-violet-300',
}

const SEVERITY_LABEL_KEY: Record<Severity, [string, string]> = {
  leading_zero: ['product_dup_leading_zero', 'Same barcode, extra zero'],
  same_barcode: ['product_dup_same_barcode', 'Same barcode'],
  same_name: ['product_dup_same_name', 'Same name'],
  similar_name: ['product_dup_similar_name', 'Similar name'],
}

function clusterKey(cluster: Cluster): string {
  return selectedConflictCaseKey(cluster)
}

function replaceVars(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values?.[key] ?? ''))
}

function money(value: number | null | undefined): string {
  const n = Number(value) || 0
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`
}

function selectedConflictErrorMessage(t: TranslateFn, error: unknown, fallbackKey: string, fallback: string): string {
  const code = String((error as { code?: unknown } | null)?.code || '').trim().toLowerCase()
  if (code) {
    const translated = t(`selected_conflict_${code}`)
    if (translated && translated !== `selected_conflict_${code}`) return translated
  }
  if (error instanceof Error && error.message) return error.message
  return t(fallbackKey) || fallback
}

function ClusterCard({
  cluster, t, dismissing, merging, selected, selectable, canRemoveProduct, removalReasons, onToggleSelect, onRemovalChange, onDismiss, onResolve, onPreview,
}: {
  cluster: Cluster
  t: TranslateFn
  dismissing: boolean
  merging: boolean
  selected: boolean
  selectable: boolean
  canRemoveProduct: boolean
  removalReasons: Readonly<Record<number, string>>
  onToggleSelect: () => void
  onRemovalChange: (productId: number, reason: string | null) => void
  onDismiss: () => void
  onResolve: () => void
  // N2: a tap on the product opens its preview (Products' detail view).
  onPreview?: (product: ClusterProduct) => void
}) {
  const [key, fallback] = SEVERITY_LABEL_KEY[cluster.severity]
  const canViewCosts = canViewAcquisitionCosts((useApp() as { user: PermissionUser }).user)
  const copyTranslate = useMemo(() => (copyKey: string, copyFallback?: string) => t(copyKey) || copyFallback || copyKey, [t])
  const copyFloat = useCopyFloat(copyTranslate)
  // Inside the name <button> only the copy MARKER goes on the span (no second
  // role/tab stop inside a button), the same as ResolveGrid.tsx copyMarker.
  const copyMarker = (value: string) => {
    const props = copyFloat(value)
    return { 'data-copy-value': props['data-copy-value'], 'data-copy-success': props['data-copy-success'], title: props.title }
  }
  // A tap opens the preview; a double-click (pointer) or a hold (touch) on the
  // name opens the shared copy float with the full name instead, so the tap
  // waits out the double-click window exactly like a Products row does.
  const openPreview = (event: ReactMouseEvent<HTMLButtonElement>, product: ClusterProduct) => {
    if (!onPreview) return
    const copyTarget = (event.target as Element | null)?.closest?.(COPY_SELECTOR)
    if (copyTarget) deferCopySurfaceAction(copyTarget, () => onPreview(product))
    else onPreview(product)
  }
  // The shared value truncates; a tap shows it whole (no hover on touch).
  const [valueExpanded, setValueExpanded] = useState(false)
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const busy = dismissing || merging
  const dismissLabel = t('dismiss_duplicate') || 'Dismiss -- reviewed, not actually a duplicate'

  return (
    <div data-conflict-card={clusterKey(cluster)} className={`rounded-xl border px-3 py-2.5 transition-shadow ${SEVERITY_STYLE[cluster.severity]} ${busy ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={!selectable || busy}
          aria-label={t('select_duplicate_cluster') || 'Select this duplicate group'}
        />
        <ConflictIcon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${CONFLICT_ICON_CLASS}`} />
        <span className={`shrink-0 text-xs font-semibold ${SEVERITY_TEXT[cluster.severity]}`}>{t(key) || fallback}</span>
        <span aria-hidden="true" className="text-[11px] text-gray-400">·</span>
        <button
          type="button"
          onClick={() => setValueExpanded((open) => !open)}
          className={`min-w-0 flex-1 text-left text-[11px] text-gray-500 dark:text-gray-400 ${valueExpanded ? 'whitespace-normal break-words' : 'truncate'}`}
          title={cluster.value}
        >
          {cluster.type === 'barcode' ? cluster.value : `"${cluster.value}"`}
        </button>
        <button
          type="button"
          onClick={() => setConfirmDismiss(true)}
          disabled={busy}
          title={dismissLabel}
          aria-label={dismissLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-black/5 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
        >
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {cluster.products.map((product) => {
          const removeIndependently = Object.prototype.hasOwnProperty.call(removalReasons, product.id)
          return (
            <div key={product.id} data-conflict-row={product.id} className="rounded-lg border border-black/5 p-1.5 dark:border-white/10">
              {/* N2 (owner, 23 Sep 2026), every width: the name takes its own
                  full row and wraps, never an ellipsis. A tap opens the product
                  preview; a hold shows the full name in the copy float. */}
              <button
                type="button"
                data-conflict-name
                onClick={(event) => openPreview(event, product)}
                disabled={!onPreview}
                aria-label={`${t('product_preview_open') || 'Open product preview'}: ${product.name || `#${product.id}`}`}
                className="flex w-full min-w-0 items-start gap-2 rounded-md text-left text-sm transition hover:bg-black/5 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/5"
              >
                <ProductImg src={product.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
                <span className="min-w-0 flex-1 whitespace-normal break-words font-medium text-gray-900 [overflow-wrap:anywhere] dark:text-white" {...copyMarker(product.name || `#${product.id}`)}>
                  {product.name || `#${product.id}`}
                </span>
              </button>
              {/* One row that scrolls sideways: barcode, cost, selling, stock and
                  the branch split. .scroll-x-clean is a block scroller, so the
                  items sit in their own inline-flex line inside it. */}
              <div data-conflict-meta className="scroll-x-clean mt-1 pl-10 text-[11px] text-gray-500 dark:text-gray-400">
                <div className="inline-flex items-center gap-x-2 whitespace-nowrap">
                  {product.barcode ? <span {...copyFloat(product.barcode)}>{product.barcode}</span> : null}
                  {canViewCosts ? <span>{t('cost') || 'Cost'} {money(product.cost_price_usd)}</span> : null}
                  <span>{t('selling') || 'Selling'} {money(product.selling_price_usd)}</span>
                  <span data-conflict-stock>{Number(product.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
                  {(product.branch_stock || []).map((line) => (
                    <span key={line.branch_id} className="rounded bg-black/5 px-1 dark:bg-white/10">
                      {line.branch_name || `#${line.branch_id}`} {line.quantity}
                    </span>
                  ))}
                </div>
              </div>
              {selected && canRemoveProduct ? (
                <div className="mt-1.5 border-t border-black/5 pt-1.5 dark:border-white/10">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                    <input type="checkbox" checked={removeIndependently} disabled={busy} onChange={(event) => onRemovalChange(product.id, event.target.checked ? '' : null)} />
                    {t('selected_conflict_remove_independently') || 'Remove independently in the global review'}
                  </label>
                  {removeIndependently ? (
                    <input
                      className="input mt-1 w-full text-xs"
                      maxLength={500}
                      value={removalReasons[product.id] || ''}
                      placeholder={t('selected_conflict_remove_reason') || 'Reason for removing this product'}
                      onChange={(event) => onRemovalChange(product.id, event.target.value)}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div data-conflict-footer className="mt-2 flex justify-end border-t border-black/5 pt-1.5 dark:border-white/10">
        <button
          type="button"
          onClick={onResolve}
          disabled={busy || cluster.products.length < 2}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
        >
          <Merge aria-hidden="true" className="h-4 w-4" />
          {t('resolve') || 'Resolve'}
        </button>
      </div>
      {confirmDismiss ? (
        <ConfirmDialog
          title={t('confirm_keep') || 'Confirm keep separate'}
          message={t('keep_review_message') || 'These records will remain separate and leave the review queue.'}
          items={[
            { label: t('before') || 'Before', value: t('needs_review') || 'Needs review' },
            { label: t('after') || 'After', value: t('kept_separate') || 'Kept as separate records' },
          ]}
          confirmLabel={t('keep') || 'Keep'}
          working={dismissing}
          onConfirm={() => { setConfirmDismiss(false); onDismiss() }}
          onClose={() => setConfirmDismiss(false)}
          t={t}
        />
      ) : null}
    </div>
  )
}

export default function ProductDuplicatesTab({ t, notify, canRemoveProduct, onMergeLeadingZero, reviewProductIds, onReviewProductIdsConsumed, onPreviewProduct }: {
  t: TranslateFn
  notify: NotifyFn
  canRemoveProduct: boolean
  onMergeLeadingZero?: () => void
  /** N2: open the product preview for a conflict row. */
  onPreviewProduct?: (productId: number) => void
  reviewProductIds?: readonly [number, number] | null
  onReviewProductIdsConsumed?: () => void
}) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const { user, can } = useApp() as { user: PermissionUser; can?: (permissionKey: string, actionKey: string) => boolean }
  const canMergeRef = useRef(true)
  canMergeRef.current = can ? can('products', 'merge_duplicates') : true
  const canViewCosts = canViewAcquisitionCosts(user)
  const canEditCosts = canEditAcquisitionCosts(user)
  const canEditProducts = can ? can('products', 'edit') : false
  // Owner, 5 Oct 2026: the merge rule picks the highest price; choosing another needs Edit product at FULL tier + the price action.
  const canOverridePrices = canOverrideMergePrice(user)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)
  // Multi-select for bulk actions -- keyed by clusterKey(), the same
  // identity dismissingId/mergingId use, and the same selection model the
  // contacts Possible Duplicates panel ships (cross-surface rule).
  // Cleared after any bulk action (selections referencing a now-gone
  // cluster are meaningless).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const [groupReviewPages, setGroupReviewPages] = useState<SelectedConflictGroupReviewResult[]>([])
  const [groupReviewPageIndex, setGroupReviewPageIndex] = useState(0)
  const [groupReviewChoices, setGroupReviewChoices] = useState<Record<string, SelectedConflictGroupResolutionChoice>>({})
  const [groupRemovalReasons, setGroupRemovalReasons] = useState<Record<number, string>>({})
  const [groupFinalizeResult, setGroupFinalizeResult] = useState<SelectedConflictGroupFinalizeResult | null>(null)
  const [groupApplyBody, setGroupApplyBody] = useState<SelectedConflictGroupApplyBody | null>(null)
  const [groupApplyResult, setGroupApplyResult] = useState<SelectedConflictGroupApplyResult | null>(null)
  const [groupApplyGroups, setGroupApplyGroups] = useState<SelectedConflictGroupApplyResult['groups']>([])
  const [groupApplyRemovals, setGroupApplyRemovals] = useState<SelectedConflictGroupApplyResult['removals']>([])
  const [groupApplyError, setGroupApplyError] = useState<{ code: string; message: string } | null>(null)
  const [groupUnknownOutcome, setGroupUnknownOutcome] = useState(false)
  const groupReviewRequestRef = useRef(createSelectedConflictRequestCoordinator())
  const groupWriteInFlightRef = useRef(false)

  const load = async () => {
    setLoading(true)
    try {
      const result = await getPossiblySameProducts() as { clusters?: Cluster[] }
      setClusters(Array.isArray(result?.clusters) ? result.clusters : [])
      setLoaded(true)
    } catch {
      notify(t('could_not_load_duplicates') || 'Could not load possible duplicates', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // Manual-refresh review panel, same as the contacts one -- the sweep
    // only changes when someone edits/merges a product.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    groupReviewRequestRef.current.cancel()
  }, [])

  const removeCluster = (id: string) => {
    setClusters((current) => current.filter((cluster) => clusterKey(cluster) !== id))
    setSelectedKeys((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const toggleSelected = (id: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDismiss = async (cluster: Cluster) => {
    const id = clusterKey(cluster)
    setDismissingId(id)
    try {
      await dismissProductDuplicateCluster(cluster.type, cluster.value)
      removeCluster(id)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('dismiss_duplicate_failed') || 'Could not dismiss this duplicate'), 'error')
    } finally {
      setDismissingId(null)
    }
  }

  // Resolve opens the ONE conflict resolver (owner ruling 24 Sep 2026) on
  // every product of the group: the reviewer picks each field in the grid and
  // the confirm shows before and after for every conflict type -- a name or
  // barcode difference is never a "failed" or "different" dead end. What
  // happens to each merged product's stock (Carry or Write off) is answered in
  // the grid, per product, before anything is written.
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const openResolve = useCallback((cluster: Cluster, draft?: ResolveDraft) => {
    if (!canMergeRef.current || cluster.products.length < 2) return
    setResolving({ cluster, draft })
  }, [])
  const resolveAdapter = useMemo(() => (resolving ? createProductResolveAdapter({
    cluster: resolving.cluster,
    t: (key) => t(key),
    canViewCosts,
    canEditCosts,
    canEditProducts,
    canOverridePrices,
    canMerge: () => canMergeRef.current,
    onWritten: () => setMergingId(clusterKey(resolving.cluster)),
    imageDisplay: (path) => <ProductImg src={path} alt="" className="h-10 w-10 rounded-lg object-cover" />,
  }) : null), [resolving, t, canViewCosts, canEditCosts, canEditProducts, canOverridePrices])
  const resolveName = useMemo(() => {
    const first = resolving ? [...resolving.cluster.products].sort((a, b) => Number(a.id) - Number(b.id))[0] : null
    return first ? String(first.name || '').trim() || `#${first.id}` : ''
  }, [resolving])
  const resolveTitle = `${t('resolve') || 'Resolve'} · ${resolveName}`
  const closeResolve = () => {
    setResolving(null)
    setMergingId(null)
    void load()
  }

  // Minimize parks the grid as a chip carrying the group and the choices made
  // so far. Restoring reads the records again, so the grid never shows a
  // parked copy of them.
  const parkResolve = (draft: ResolveDraft) => {
    if (!resolving) return
    minimizeWork({
      key: `product_resolve:${clusterKey(resolving.cluster)}`,
      kind: 'product_resolve',
      pageId: 'products',
      anchor: 'hub:products:duplicates',
      label: resolveTitle,
      payload: { cluster: resolving.cluster, draft },
      requiredPermission: { permissionKey: 'products', actionKey: 'merge_duplicates' },
    })
    setResolving(null)
    setMergingId(null)
  }

  const restoreResolve = useCallback((entry: MinimizedWorkEntry): boolean => {
    const parked = entry.payload as Partial<ResolveTarget> | undefined
    if (!Array.isArray(parked?.cluster?.products) || parked.cluster.products.length < 2) return false
    if (!canMergeRef.current) {
      reparkDeniedRestore(entry)
      notify(t('access_denied') || 'Access denied', 'warning')
      return false
    }
    openResolve(parked.cluster, parked.draft)
    return true
  }, [notify, openResolve, t])

  // A chip restored before this tab mounted waits as pending; one restored
  // while it is mounted arrives as the event.
  useEffect(() => {
    const pending = consumePendingRestore('product_resolve')
    if (pending && restoreResolve(pending)) markRestoreHandled('product_resolve')
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.kind !== 'product_resolve' || !detail.entry) return
      if (restoreResolve(detail.entry as MinimizedWorkEntry)) markRestoreHandled('product_resolve')
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
  }, [restoreResolve])

  // Bulk Dismiss -- safe for every selected cluster regardless of size
  // (dismissing never touches a product record, just the reviewed flag).
  // Continues past individual failures and reports once at the end, same
  // as the contacts panel.
  const bulkDismiss = async () => {
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster)))
    if (!targets.length || bulkBusy) return
    setBulkBusy(true)
    let failed = 0
    let done = 0
    for (const cluster of targets) {
      setBulkProgress(replaceVars(t('bulk_dismissing_progress') || 'Dismissing {done}/{total}…', { done: done + 1, total: targets.length }))
      try {
        await dismissProductDuplicateCluster(cluster.type, cluster.value)
        removeCluster(clusterKey(cluster))
      } catch {
        failed += 1
      }
      done += 1
    }
    setBulkBusy(false)
    setBulkProgress('')
    setSelectedKeys(new Set())
    setGroupRemovalReasons({})
    if (failed) {
      notify(replaceVars(t('bulk_dismiss_partial_failure') || '{count} of the selected duplicates could not be dismissed', { count: failed }), 'error')
    } else {
      notify(t('bulk_dismiss_success') || 'Dismissed the selected duplicates')
    }
  }

  const updateGroupRemoval = (productId: number, reason: string | null) => {
    setGroupRemovalReasons((current) => {
      const next = { ...current }
      if (reason == null) delete next[productId]
      else next[productId] = reason
      return next
    })
  }

  const openSelectedGroupReview = async (
    targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster))),
    removalReasons: Readonly<Record<number, string>> = groupRemovalReasons,
  ) => {
    if (!targets.length || bulkBusy) return
    let body
    try {
      body = buildSelectedConflictGroupReviewRequest(targets, createClientRequestId('product-conflict-group-review'), removalReasons)
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : (t('selected_conflict_group_review_failed') || 'Could not create the group review'), 'error')
      return
    }
    if (!body.merge_groups.length && !body.remove_rows.length) {
      notify(t('selected_conflict_group_none_reviewable') || 'None of the selected groups contains a merge group or an independent removal.', 'info')
      return
    }
    const request = groupReviewRequestRef.current.begin()
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_loading_group_review') || 'Creating one combined group review…')
    try {
      const review = await createSelectedConflictGroupReview(body, { signal: request.signal })
      if (!request.isCurrent()) return
      setGroupReviewPages([review])
      setGroupReviewPageIndex(0)
      setGroupReviewChoices({})
      setGroupFinalizeResult(null)
      setGroupApplyBody(null)
      setGroupApplyResult(null)
      setGroupApplyGroups([])
      setGroupApplyRemovals([])
      setGroupApplyError(null)
      setGroupUnknownOutcome(false)
    } catch (error: unknown) {
      if (request.isCurrent()) notify(selectedConflictErrorMessage(t, error, 'selected_conflict_group_review_failed', 'Could not create the group review'), 'error')
    } finally {
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  // An edit collision is only a request to review persisted evidence. Never
  // copy the rejected draft barcode into a product or add unrelated siblings.
  const consumedCollisionRef = useRef<readonly [number, number] | null>(null)
  useEffect(() => {
    if (!reviewProductIds || !loaded || loading || bulkBusy || groupReviewPages.length
      || consumedCollisionRef.current === reviewProductIds) return
    consumedCollisionRef.current = reviewProductIds
    const ids = new Set(reviewProductIds)
    const cluster = ids.size === 2 && [...ids].every((id) => Number.isSafeInteger(id) && id > 0)
      ? clusters.find((candidate) => [...ids].every((id) => candidate.products.some((product) => Number(product.id) === id)))
      : undefined
    if (cluster) {
      void openSelectedGroupReview([{ ...cluster, products: cluster.products.filter((product) => ids.has(Number(product.id))) }], {})
    } else {
      notify(t('product_collision_review_unavailable') || 'No saved conflict group contains both products. Verify their identities before merging.', 'error')
    }
    onReviewProductIdsConsumed?.()
    // The fresh loaded catalog is the evidence; no automatic identity edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewProductIds, loaded, loading, bulkBusy, groupReviewPages.length, clusters])

  const closeSelectedGroupReview = () => {
    const writeWillReconcileWhenSettled = groupWriteInFlightRef.current
    groupReviewRequestRef.current.cancel()
    setGroupReviewPages([])
    setGroupReviewPageIndex(0)
    setGroupReviewChoices({})
    setGroupFinalizeResult(null)
    setGroupApplyBody(null)
    setGroupApplyResult(null)
    setGroupApplyGroups([])
    setGroupApplyRemovals([])
    setGroupApplyError(null)
    setGroupUnknownOutcome(false)
    setBulkBusy(false)
    setBulkProgress('')
    if (!writeWillReconcileWhenSettled) void load()
  }

  const showNextGroupReviewPage = async () => {
    const current = groupReviewPages[groupReviewPageIndex]
    if (!current || bulkBusy) return
    if (groupReviewPageIndex < groupReviewPages.length - 1) {
      setGroupReviewPageIndex((index) => index + 1)
      return
    }
    const cursor = current.page.next_cursor
    if (cursor == null) return
    const request = groupReviewRequestRef.current.begin()
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_loading_next_page') || 'Loading the next review page…')
    try {
      const next = await getSelectedConflictGroupReviewPage(current.review_id, cursor, SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT, { signal: request.signal })
      if (!request.isCurrent()) return
      const sameReview = next.review_id === current.review_id
        && next.draft_digest === current.draft_digest
        && next.resolution_version === current.resolution_version
      if (!sameReview || next.page.cursor !== cursor) throw new Error(t('selected_conflict_review_page_mismatch') || 'The review page did not match the saved review. Close and start again.')
      setGroupReviewPages((pages) => [...pages, next])
      setGroupReviewPageIndex((index) => index + 1)
    } catch (error: unknown) {
      if (request.isCurrent()) notify(selectedConflictErrorMessage(t, error, 'selected_conflict_group_review_failed', 'Could not load the next review page'), 'error')
    } finally {
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  const finalizeSelectedGroupReview = async () => {
    const review = groupReviewPages[0]
    if (!review || bulkBusy || groupFinalizeResult) return Boolean(groupFinalizeResult)
    const groups = groupReviewPages.flatMap((page) => page.page.groups)
    let body
    try {
      body = buildSelectedConflictGroupFinalizeRequest(review, groups, groupReviewChoices)
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : (t('selected_conflict_finalize_failed') || 'Complete the review before continuing.'), 'error')
      return false
    }
    const request = groupReviewRequestRef.current.begin()
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_finalizing_review') || 'Freezing the reviewed choices…')
    try {
      const finalized = await finalizeSelectedConflictGroupReview(review.review_id, body, { signal: request.signal })
      if (!request.isCurrent()) return false
      if (finalized.review_id !== review.review_id || !finalized.manifest_digest) {
        throw new Error(t('selected_conflict_review_page_mismatch') || 'The finalized review did not match the saved review.')
      }
      setGroupFinalizeResult(finalized)
      setGroupApplyBody(makeSelectedConflictGroupApplyBody(finalized))
      setGroupApplyError(null)
      return true
    } catch (error: unknown) {
      if (request.isCurrent()) notify(selectedConflictErrorMessage(t, error, 'selected_conflict_finalize_failed', 'Could not finalize the reviewed actions.'), 'error')
      return false
    } finally {
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  const executeSelectedGroupApply = async (body: SelectedConflictGroupApplyBody) => {
    const finalized = groupFinalizeResult
    if (!finalized || bulkBusy) return
    const request = groupReviewRequestRef.current.begin()
    groupWriteInFlightRef.current = true
    setBulkBusy(true)
    setGroupApplyError(null)
    setGroupUnknownOutcome(false)
    const totalWork = Number(finalized.counts.merge_folds || 0) + Number(finalized.counts.ready_removals || 0)
    const callCeiling = Math.max(1, Math.min(4002, totalWork + 2))
    let calls = 0
    let previousProgress = 0
    let lastResult: SelectedConflictGroupApplyResult | null = null
    try {
      while (calls < callCeiling) {
        calls += 1
        const result = await applySelectedConflictGroupReview(body, { signal: request.signal })
        lastResult = result
        if (!request.isCurrent()) return
        if (result.review_id !== body.review_id || result.manifest_digest !== body.manifest_digest) {
          throw new Error(t('selected_conflict_review_page_mismatch') || 'The apply receipt did not match the confirmed review.')
        }
        setGroupApplyResult(result)
        setGroupApplyGroups((current) => {
          const next = new Map(current.map((row) => [row.group_key, row]))
          for (const row of result.groups) next.set(row.group_key, row)
          return [...next.values()]
        })
        setGroupApplyRemovals((current) => {
          const next = new Map(current.map((row) => [row.action_ordinal, row]))
          for (const row of result.removals) next.set(row.action_ordinal, row)
          return [...next.values()].sort((left, right) => left.action_ordinal - right.action_ordinal)
        })
        const progress = result.counts.committed_folds + result.counts.completed_removals
          + result.counts.approval_pending_removals + result.counts.refused_folds + result.counts.refused_removals
        setBulkProgress(replaceVars(t('selected_conflict_group_apply_progress') || '{done} processed · {total} reviewed actions', { done: progress, total: totalWork }))
        if (!result.continuation_required) {
          if (result.status === 'completed') {
            setSelectedKeys(new Set())
            setGroupRemovalReasons({})
            notify(t('selected_conflict_group_apply_complete') || 'The reviewed product actions are complete.')
          } else if (result.approval_required) {
            notify(t('selected_conflict_group_approval_pending') || 'Removal requests were submitted for approval. No pending removal was reported as completed.', 'info')
          } else if (result.status === 'interrupted') {
            setGroupApplyError({
              code: String(result.interruption_code || 'review_interrupted'),
              message: String(result.interruption_message || t('selected_conflict_group_apply_interrupted') || 'The review stopped before every action completed.'),
            })
          }
          break
        }
        if (progress <= previousProgress) {
          const stalled = new Error(t('selected_conflict_group_apply_stalled') || 'The review made no progress. Check its status before resuming.') as Error & { code?: string; status?: number }
          stalled.code = 'review_stalled'
          stalled.status = 409
          throw stalled
        }
        previousProgress = progress
      }
      if (calls >= callCeiling && lastResult?.continuation_required) {
        const limited = new Error(t('selected_conflict_group_apply_limit') || 'The bounded continuation limit was reached. Check the review before resuming.') as Error & { code?: string; status?: number }
        limited.code = 'review_call_limit'
        limited.status = 409
        throw limited
      }
    } catch (error: unknown) {
      if (!request.isCurrent()) return
      const code = String((error as { code?: unknown } | null)?.code || '')
      const unknown = selectedConflictOutcomeIsUnknown(error)
      setGroupUnknownOutcome(unknown)
      setGroupApplyError({ code, message: selectedConflictErrorMessage(t, error, 'selected_conflict_group_apply_failed', 'The reviewed actions could not continue.') })
      notify(selectedConflictErrorMessage(t, error, 'selected_conflict_group_apply_failed', 'The reviewed actions could not continue.'), 'error')
    } finally {
      groupWriteInFlightRef.current = false
      await load()
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  const applySelectedGroupReview = async () => {
    if (!groupApplyBody || bulkBusy) return
    await executeSelectedGroupApply(groupApplyBody)
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleClusters = useMemo(() => clusters.filter((cluster) => {
    if (severityFilter !== 'all' && cluster.severity !== severityFilter) return false
    if (!normalizedSearch) return true
    const haystack = [cluster.value, ...cluster.products.flatMap((p) => [p.name, p.barcode])]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(normalizedSearch)
  }), [clusters, normalizedSearch, severityFilter])

  const counts = useMemo(() => {
    const result: Record<Severity, number> = { leading_zero: 0, same_barcode: 0, same_name: 0, similar_name: 0 }
    for (const cluster of clusters) result[cluster.severity] += 1
    return result
  }, [clusters])

  const severityOptions = (['all', 'leading_zero', 'same_barcode', 'same_name', 'similar_name'] as const).map((severity) => {
    const [key, fallback] = severity === 'all' ? ['all_severities', 'All'] : SEVERITY_LABEL_KEY[severity]
    const count = severity === 'all' ? 0 : counts[severity]
    return { value: severity, label: <span className="text-xs">{`${t(key) || fallback}${count > 0 ? ` · ${count}` : ''}`}</span> }
  })
  const refreshLabel = t('refresh') || 'Refresh'
  const leadingZeroLabel = t('merge_leading_zero_products') || 'Merge leading-zero barcode duplicates'
  const bulkMergeLabel = t('duplicates_bulk_merge_action') || 'Merge selected'
  const bulkDismissLabel = t('duplicates_bulk_dismiss_action') || 'Dismiss selected'

  return (
    <div className="space-y-2">
      {/* One row (it wraps only on the narrowest phones): search, scan,
          refresh, the conflict type and the leading-zero shortcut. */}
      <div data-conflict-toolbar className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[9rem] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_product_duplicates_placeholder') || 'Filter by name or barcode...'}
            aria-label={t('search_product_duplicates_placeholder') || 'Filter by name or barcode...'}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
          />
        </div>
        <ScanSearchButton
          onDetected={setSearch}
          t={(key) => t(key) || key}
          className={toolbarIconButtonClassName}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title={refreshLabel}
          aria-label={refreshLabel}
          className={`${toolbarIconButtonClassName} disabled:opacity-50`}
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <AppSelect
          value={severityFilter}
          options={severityOptions}
          onChange={(value) => setSeverityFilter(value as Severity | 'all')}
          ariaLabel={t('type') || 'Type'}
          className="shrink-0"
          buttonClassName="h-10 min-h-10 !rounded-xl !px-2.5"
        />
        {onMergeLeadingZero && counts.leading_zero > 0 ? (
          <button
            type="button"
            onClick={() => void openSelectedGroupReview(clusters.filter((cluster) => cluster.severity === 'leading_zero'), {})}
            disabled={loading || bulkBusy}
            title={leadingZeroLabel}
            aria-label={leadingZeroLabel}
            className={`${toolbarIconButtonClassName} text-emerald-700 disabled:opacity-50 dark:text-emerald-300`}
          >
            <Merge aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {loading && !loaded ? (
        <div className="py-8 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
      ) : clusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t('no_possible_duplicates_found') || 'No possible duplicates found.'}
        </div>
      ) : visibleClusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t('no_duplicates_match_filter') || 'No duplicates match this filter.'}
        </div>
      ) : (
        <>
          {/* One row: the count (or the selection with its two bulk actions,
              icon-only), then Select all / Clear. */}
          <div data-conflict-selection className={`flex min-h-10 flex-wrap items-center gap-2 rounded-xl px-2 text-xs ${selectedKeys.size > 0 ? 'border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30' : 'text-gray-500 dark:text-gray-400'}`}>
            {selectedKeys.size > 0 ? (
              <>
                <span className="font-medium text-blue-700 dark:text-blue-300">
                  {bulkProgress || replaceVars(t('duplicates_bulk_selected_count') || '{count} selected', { count: selectedKeys.size })}
                </span>
                {/* One button opens the durable group review: it already works
                    out merge / blocked with a reason for every selected group
                    and shows before/after before anything is written. */}
                <button
                  type="button"
                  onClick={() => void openSelectedGroupReview()}
                  disabled={bulkBusy}
                  title={bulkMergeLabel}
                  aria-label={bulkMergeLabel}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/40"
                >
                  <Merge aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void bulkDismiss()}
                  disabled={bulkBusy}
                  title={bulkDismissLabel}
                  aria-label={bulkDismissLabel}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/40"
                >
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                </button>
              </>
            ) : (
              <span>{visibleClusters.length} {t('duplicate_groups_shown') || 'group(s) shown'}</span>
            )}
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set(visibleClusters.map((cluster) => clusterKey(cluster))))}
              disabled={bulkBusy || !visibleClusters.length}
              className="ml-auto text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline dark:text-blue-400"
            >
              {t('select_all') || 'Select all'}
            </button>
            {selectedKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => { setSelectedKeys(new Set()); setGroupRemovalReasons({}) }}
                disabled={bulkBusy}
                className="text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
              >
                {t('clear_selection') || 'Clear selection'}
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleClusters.map((cluster) => {
              const id = clusterKey(cluster)
              return (
                <ClusterCard
                  key={id}
                  cluster={cluster}
                  t={t}
                  dismissing={dismissingId === id}
                  merging={mergingId === id}
                  selected={selectedKeys.has(id)}
                  selectable={!bulkBusy}
                  canRemoveProduct={canRemoveProduct}
                  removalReasons={groupRemovalReasons}
                  onToggleSelect={() => toggleSelected(id)}
                  onRemovalChange={updateGroupRemoval}
                  onDismiss={() => void handleDismiss(cluster)}
                  onResolve={() => openResolve(cluster)}
                  onPreview={onPreviewProduct ? (product) => onPreviewProduct(product.id) : undefined}
                />
              )
            })}
          </div>
        </>
      )}

      {resolving && resolveAdapter ? (
        <ResolveModal
          key={clusterKey(resolving.cluster)}
          title={resolveTitle}
          adapter={resolveAdapter}
          initialDraft={resolving.draft}
          onClose={closeResolve}
          onMinimize={parkResolve}
          onApplied={() => { notify(t('product_duplicate_merged') || 'Merged -- stock, received-date records and images were carried onto the kept product') }}
        />
      ) : null}
      {groupReviewPages.length ? (
        <SelectedConflictGroupReviewModal
          pages={groupReviewPages}
          pageIndex={groupReviewPageIndex}
          choices={groupReviewChoices}
          working={bulkBusy}
          finalized={groupFinalizeResult}
          applyResult={groupApplyResult}
          appliedGroups={groupApplyGroups}
          appliedRemovals={groupApplyRemovals}
          applyError={groupApplyError}
          unknownOutcome={groupUnknownOutcome}
          onChoice={(groupKey, patch) => {
            if (!groupFinalizeResult) setGroupReviewChoices((current) => ({ ...current, [groupKey]: { ...current[groupKey], ...patch } }))
          }}
          onPreviousPage={() => setGroupReviewPageIndex((index) => Math.max(0, index - 1))}
          onNextPage={() => void showNextGroupReviewPage()}
          onFinalize={finalizeSelectedGroupReview}
          onApply={() => void applySelectedGroupReview()}
          onResume={() => void applySelectedGroupReview()}
          onClose={closeSelectedGroupReview}
          t={t}
        />
      ) : null}
    </div>
  )
}

// The conflict card on its own, for the layout browser test
// (tests/productConflictRowLayout.test.ts): N2 is a layout promise.
export { ClusterCard as ProductConflictClusterCard }
