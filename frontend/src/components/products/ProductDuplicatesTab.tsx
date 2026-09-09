import { useEffect, useMemo, useRef, useState } from 'react'
import { useFormDirty } from '../../utils/formDirty.ts'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import InfoHint from '../shared/InfoHint.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import { ProductImg } from './shared/primitives.tsx'
import {
  getPossiblySameProducts,
  dismissProductDuplicateCluster,
  createSelectedConflictGroupReview,
  applySelectedConflictGroupReview,
  finalizeSelectedConflictGroupReview,
  getSelectedConflictGroupReviewPage,
  makeSelectedConflictGroupApplyBody,
  makeSelectedConflictMergeApplyBody,
  previewSelectedConflictMerges,
  runSelectedConflictMergeBatch,
  updateProduct,
  type SelectedConflictMergeApplyBody,
  type SelectedConflictMergeApplyResult,
  type SelectedConflictMergePreviewResult,
  type SelectedConflictGroupReviewResult,
  type SelectedConflictGroupFinalizeResult,
  type SelectedConflictGroupApplyBody,
  type SelectedConflictGroupApplyResult,
} from '../../api/productWriteTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { normalizeProductGroupName } from '../../utils/productGrouping.ts'
import { useMergeStockChoice } from './useMergeStockChoice.tsx'
import Modal from '../shared/Modal'
import SelectedConflictMergeReviewModal, { SelectedConflictGroupReviewModal } from './SelectedConflictMergeReviewModal.tsx'
import {
  createSelectedConflictRequestCoordinator,
  partitionSelectedConflictClusters,
  mergeSelectedConflictCommittedCases,
  preserveSelectedConflictChoices,
  selectedConflictCanResumeSameRequest,
  selectedConflictCaseKey,
  selectedConflictChangedCases,
  selectedConflictOutcomeIsUnknown,
  type ProductConflictCluster,
  type ProductConflictProduct,
  type SelectedConflictLocalSkip,
  type SelectedConflictStockChoice,
} from '../../utils/selectedConflictMerge.ts'
import {
  buildSelectedConflictGroupReviewRequest,
  buildSelectedConflictGroupFinalizeRequest,
  SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT,
  type SelectedConflictGroupResolutionChoice,
} from '../../utils/selectedConflictActionReview.ts'

// Products → Duplicates: the human-review residue the identity rule can't
// settle on its own. Mirrors the contacts Possible Duplicates panel
// (contacts/DuplicatesTab.tsx) -- same severity-tinted cluster cards, the
// same two-tap "Keep this" merge, the same server-persisted Dismiss -- so
// one review pattern covers every table (the cross-surface rule). Data
// comes from GET /api/products/possible-duplicates; merging folds stock,
// lots (identity preserved), images and history exactly like the
// merge-duplicates cleanup, because it IS the same server-side fold.

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

type Severity = ProductConflictCluster['severity']
type ClusterProduct = ProductConflictProduct
type Cluster = ProductConflictCluster

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

// An EXACT duplicate cluster (user spec item #3): products that share BOTH a
// real barcode AND the same name. Only a barcode cluster can qualify (a name
// cluster has, by definition, differing barcodes), and only when EVERY member
// normalizes to one name. For these the per-row Resolve (edit) button is
// hidden -- editing another copy of a proven duplicate is exactly what the
// Keep this / Keep both decision replaces.
function clusterIsExact(cluster: Cluster): boolean {
  if (cluster.type !== 'barcode') return false
  const names = new Set(cluster.products.map((product) => normalizeProductGroupName(product.name || '')))
  return names.size === 1 && !names.has('')
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
  cluster, t, dismissing, merging, selected, selectable, isExact, canRemoveProduct, removalReasons, onToggleSelect, onRemovalChange, onDismiss, onApplyDecisions, onEdit,
}: {
  cluster: Cluster
  t: TranslateFn
  dismissing: boolean
  merging: boolean
  selected: boolean
  selectable: boolean
  canRemoveProduct: boolean
  removalReasons: Readonly<Record<number, string>>
  // Same barcode AND same name -> the Resolve (edit) button is hidden; the
  // Keep this / Keep both decision is the only sane next step (spec item #3).
  isExact: boolean
  onToggleSelect: () => void
  onRemovalChange: (productId: number, reason: string | null) => void
  onDismiss: () => void
  onApplyDecisions: (keeper: ClusterProduct, removals: ClusterProduct[]) => void
  onEdit: (product: ClusterProduct) => void
}) {
  const [key, fallback] = SEVERITY_LABEL_KEY[cluster.severity]
  // Decide-all-then-apply (user, Aug 30: "only allow changes after all in
  // one conflict is fully decided, remove, keep, resolve"): every product
  // in the group takes an explicit Keep/Remove decision; Apply arms only
  // when EVERY row is decided and exactly ONE row is kept. Editing a row
  // (the in-place Resolve) never leaves this section.
  const [decisions, setDecisions] = useState<Record<number, 'keep' | 'merge'>>({})
  // The cluster's shared value chip still toggles to full, wrapped text on
  // click/tap because hover-only tooltips do not exist on touch. Product names
  // scroll horizontally in place like the rest of the Products surface.
  const [valueExpanded, setValueExpanded] = useState(false)
  const busy = dismissing || merging

  const decide = (productId: number, decision: 'keep' | 'merge') => {
    setDecisions((current) => {
      const next: Record<number, 'keep' | 'merge'> = { ...current }
      if (current[productId] === decision) {
        delete next[productId]
        return next
      }
      if (decision === 'keep') {
        // One keeper per group -- picking a new Keep demotes the old one
        // back to undecided (not auto-Remove; removal stays explicit).
        for (const id of Object.keys(next)) {
          if (next[Number(id)] === 'keep') delete next[Number(id)]
        }
      }
      next[productId] = decision
      return next
    })
  }

  const keeper = cluster.products.find((product) => decisions[product.id] === 'keep') || null
  const merges = cluster.products.filter((product) => decisions[product.id] === 'merge')
  const everyDecided = cluster.products.every((product) => decisions[product.id])
  const canApply = Boolean(keeper) && everyDecided && merges.length > 0 && !busy

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-shadow ${SEVERITY_STYLE[cluster.severity]} ${busy ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={!selectable || busy}
            aria-label={t('select_duplicate_cluster') || 'Select this duplicate group'}
          />
          <span className={`text-xs font-semibold ${SEVERITY_TEXT[cluster.severity]}`}>{t(key) || fallback}</span>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setValueExpanded((open) => !open)}
            className={`text-left text-[11px] text-gray-400 ${valueExpanded ? 'whitespace-normal break-words' : 'max-w-[10rem] truncate'}`}
            title={cluster.value}
          >
            {cluster.type === 'barcode' ? cluster.value : `"${cluster.value}"`}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            title={t('dismiss_duplicate') || 'Dismiss -- I\'ve reviewed this, these are genuinely different items'}
            className="rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {cluster.products.map((product) => {
          const decision = decisions[product.id]
          const removeIndependently = Object.prototype.hasOwnProperty.call(removalReasons, product.id)
          return (
            <div key={product.id} className="rounded-lg border border-black/5 p-1.5 dark:border-white/10">
              <div className="flex items-center gap-2 text-sm">
                <ProductImg src={product.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="scroll-x-clean font-medium text-gray-900 dark:text-white">{product.name || `#${product.id}`}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
                    {cluster.type !== 'barcode' && product.barcode ? <span>{product.barcode}</span> : null}
                    <span>{money(product.cost_price_usd)} → {money(product.selling_price_usd)}</span>
                    <span>{Number(product.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
                    {(product.branch_stock || []).map((line) => (
                      <span key={line.branch_id} className="rounded bg-black/5 px-1 dark:bg-white/10">
                        {line.branch_name || `#${line.branch_id}`} {line.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => decide(product.id, 'keep')}
                    disabled={busy}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${decision === 'keep'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20'}`}
                  >
                    {t('keep') || 'Keep'}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(product.id, 'merge')}
                    disabled={busy}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${decision === 'merge'
                      ? 'bg-blue-600 text-white'
                      : 'text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20'}`}
                  >
                    {t('merge') || 'Merge'}
                  </button>
                  {isExact ? null : (
                    <button
                      type="button"
                      onClick={() => onEdit(product)}
                      disabled={busy}
                      title={t('resolve_duplicate_inline_hint') || 'Edit this product right here — name, barcode and prices — without leaving the review'}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                    >
                      {t('resolve') || 'Resolve'}
                    </button>
                  )}
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
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-black/5 pt-1.5 dark:border-white/10">
        <span className="text-[11px] text-gray-400">
          {everyDecided
            ? (keeper
              ? `${t('keep') || 'Keep'} "${keeper.name || `#${keeper.id}`}" · ${merges.length} ${t('merge') || 'merge'}`
              : (t('dup_pick_one_keep') || 'Pick one Keep'))
            : (t('dup_decide_all_hint') || 'Decide every row (Keep / Merge) to apply')}
        </span>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => keeper && onApplyDecisions(keeper, merges)}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Merge className="h-3 w-3" />
          {merging ? (t('merging') || 'Merging...') : (t('apply') || 'Apply')}
        </button>
      </div>
    </div>
  )
}

export default function ProductDuplicatesTab({ t, notify, canRemoveProduct }: {
  t: TranslateFn
  notify: NotifyFn
  canRemoveProduct: boolean
}) {
  const [clusters, setClusters] = useState<Cluster[]>([])
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
  const [batchPreview, setBatchPreview] = useState<SelectedConflictMergePreviewResult | null>(null)
  const [batchLocalSkipped, setBatchLocalSkipped] = useState<SelectedConflictLocalSkip[]>([])
  const [batchChoices, setBatchChoices] = useState<Record<string, SelectedConflictStockChoice>>({})
  const [batchResult, setBatchResult] = useState<SelectedConflictMergeApplyResult | null>(null)
  const [batchApplyBody, setBatchApplyBody] = useState<SelectedConflictMergeApplyBody | null>(null)
  const [batchCommittedCases, setBatchCommittedCases] = useState<SelectedConflictMergeApplyResult['committedCases']>([])
  const [batchChangedCases, setBatchChangedCases] = useState<Record<string, SelectedConflictMergePreviewResult['cases'][number]>>({})
  const [batchUnknownOutcome, setBatchUnknownOutcome] = useState(false)
  const [batchNeedsRefresh, setBatchNeedsRefresh] = useState(false)
  const batchRequestRef = useRef(createSelectedConflictRequestCoordinator())
  const batchWriteInFlightRef = useRef(false)
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
    batchRequestRef.current.cancel()
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

  // The one shared "keep this, what happens to the other's stock?" flow, used
  // by every surface that resolves a twin (see useMergeStockChoice).
  const { mergeWithChoice, mergeStockChoiceDialog } = useMergeStockChoice(t)

  // Apply the group's explicit decisions (ONE keeper + the rows marked
  // Remove); one pair per call, stopping on the first failure so nothing
  // half-merges silently. Undecided rows (in an odd partial state) are
  // never touched -- but the card only arms Apply when every row is
  // decided, so normally removals covers the whole rest of the group.
  //
  // Marking a row Remove used to fold its stock onto the keeper anyway: the
  // word said one thing and the write did the other. Each removal that still
  // holds stock now asks -- merge the quantities across, or write them off --
  // before anything is written, one question per row, since two rows in one
  // group can hold different stock and deserve different answers. Cancelling
  // stops the whole Apply where it stands rather than continuing down the list.
  const handleApplyDecisions = async (cluster: Cluster, keeper: ClusterProduct, removals: ClusterProduct[]) => {
    if (!removals.length) return
    const id = clusterKey(cluster)
    setMergingId(id)
    try {
      let merged = 0
      for (const other of removals) {
        const outcome = await mergeWithChoice(keeper, other)
        if (outcome === 'cancelled') break
        merged += 1
      }
      if (!merged) return
      notify(t('product_duplicate_merged') || 'Merged -- stock, received-date records and images were carried onto the kept product')
      if (merged === removals.length) removeCluster(id)
      else void load()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('merge_duplicate_failed') || 'Could not merge these records'), 'error')
    } finally {
      setMergingId(null)
    }
  }

  // In-place Resolve (user, Aug 30: "should not bring you to other
  // sections ... edit in duplicates right there"): a small float editing
  // the identity fields the clusters group by. Saving refreshes the sweep
  // -- a renamed/re-barcoded product simply drops out of its cluster.
  const [editTarget, setEditTarget] = useState<ClusterProduct | null>(null)
  const [editForm, setEditForm] = useState<{ name: string; barcode: string; cost: string; price: string }>({ name: '', barcode: '', cost: '', price: '' })
  // S4-21: re-baselined per product, because one modal instance is
  // reused for every row -- otherwise loading row B's values into a form
  // baselined on row A reads as dirty without anyone typing.
  const { dirty: editFormDirty } = useFormDirty(editTarget ? editForm : null, editTarget?.id ?? null)
  const [editSaving, setEditSaving] = useState(false)
  const openEdit = (product: ClusterProduct) => {
    setEditTarget(product)
    setEditForm({
      name: String(product.name || ''),
      barcode: String(product.barcode || ''),
      cost: String(Number(product.cost_price_usd) || 0),
      price: String(Number(product.selling_price_usd) || 0),
    })
  }
  const saveEdit = async () => {
    if (!editTarget || editSaving) return
    setEditSaving(true)
    try {
      await updateProduct(editTarget.id, {
        name: editForm.name.trim(),
        barcode: editForm.barcode.trim(),
        cost_price_usd: Number(editForm.cost) || 0,
        selling_price_usd: Number(editForm.price) || 0,
      })
      notify(t('product_updated') || 'Product updated')
      setEditTarget(null)
      void load()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('update_failed') || 'Could not save changes'), 'error')
    } finally {
      setEditSaving(false)
    }
  }

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

  const openSelectedMergeReview = async () => {
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster)))
    if (!targets.length || bulkBusy) return
    const partition = partitionSelectedConflictClusters(targets)
    if (!partition.cases.length) {
      const reasons = [...new Set(partition.skipped.map((item) => t(`selected_conflict_${item.code}`) || item.code))]
      notify([t('selected_conflict_none_eligible') || 'None of the selected groups is an eligible two-product merge.', ...reasons].join(' '), 'info')
      return
    }
    const request = batchRequestRef.current.begin()
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_loading_preview') || 'Loading combined review…')
    setBatchResult(null)
    setBatchApplyBody(null)
    setBatchCommittedCases([])
    setBatchChangedCases({})
    setBatchUnknownOutcome(false)
    setBatchNeedsRefresh(false)
    try {
      const preview = await previewSelectedConflictMerges(partition.cases, { signal: request.signal })
      if (!request.isCurrent()) return
      setBatchPreview(preview)
      setBatchLocalSkipped(partition.skipped)
      setBatchChoices({})
    } catch (error: unknown) {
      if (request.isCurrent()) notify(selectedConflictErrorMessage(t, error, 'selected_conflict_preview_failed', 'Could not load the combined merge review'), 'error')
    } finally {
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
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

  const openSelectedGroupReview = async () => {
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster)))
    if (!targets.length || bulkBusy) return
    let body
    try {
      body = buildSelectedConflictGroupReviewRequest(targets, createClientRequestId('product-conflict-group-review'), groupRemovalReasons)
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

  const refreshSelectedMergeReview = async () => {
    if (!batchPreview || bulkBusy) return
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster)))
    const partition = partitionSelectedConflictClusters(targets)
    if (!partition.cases.length) {
      const reasons = [...new Set(partition.skipped.map((item) => t(`selected_conflict_${item.code}`) || item.code))]
      notify([t('selected_conflict_none_eligible') || 'None of the selected groups is an eligible two-product merge.', ...reasons].join(' '), 'info')
      closeSelectedMergeReview()
      return
    }
    const previous = batchPreview
    const request = batchRequestRef.current.begin()
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_loading_preview') || 'Loading combined review…')
    try {
      const preview = await previewSelectedConflictMerges(partition.cases, { signal: request.signal })
      if (!request.isCurrent()) return
      setBatchChoices((current) => preserveSelectedConflictChoices(previous.cases, preview.cases, current))
      setBatchChangedCases(selectedConflictChangedCases(previous.cases, preview.cases))
      setBatchPreview(preview)
      setBatchLocalSkipped(partition.skipped)
      setBatchResult(null)
      setBatchApplyBody(null)
      setBatchUnknownOutcome(false)
      setBatchNeedsRefresh(false)
    } catch (error: unknown) {
      if (request.isCurrent()) notify(selectedConflictErrorMessage(t, error, 'selected_conflict_preview_failed', 'Could not load the combined merge review'), 'error')
    } finally {
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  const closeSelectedMergeReview = () => {
    const writeWillReconcileWhenSettled = batchWriteInFlightRef.current
    batchRequestRef.current.cancel()
    setBatchPreview(null)
    setBatchLocalSkipped([])
    setBatchChoices({})
    setBatchResult(null)
    setBatchApplyBody(null)
    setBatchCommittedCases([])
    setBatchChangedCases({})
    setBatchUnknownOutcome(false)
    setBatchNeedsRefresh(false)
    setBulkBusy(false)
    setBulkProgress('')
    if (!writeWillReconcileWhenSettled) void load()
  }

  const executeSelectedMergeBody = async (body: SelectedConflictMergeApplyBody) => {
    const request = batchRequestRef.current.begin()
    batchWriteInFlightRef.current = true
    setBulkBusy(true)
    setBulkProgress(t('selected_conflict_merging_progress') || 'Merging reviewed pairs…')
    try {
      const result = await runSelectedConflictMergeBatch(body, {
        signal: request.signal,
        onProgress: (progress) => {
          if (!request.isCurrent()) return
          const committed = progress.committedCases.length
          const remaining = progress.remainingCaseCount == null ? (t('unknown') || 'Unknown') : progress.remainingCaseCount
          setBulkProgress(replaceVars(t('selected_conflict_progress_counts') || '{committed} committed · {remaining} remaining', { committed, remaining }))
        },
      })
      if (!request.isCurrent()) return
      setBatchResult(result)
      setBatchUnknownOutcome(false)
      setBatchNeedsRefresh(false)
      setBatchCommittedCases((current) => mergeSelectedConflictCommittedCases(current, result.committedCases))
      setSelectedKeys((current) => {
        const next = new Set(current)
        for (const item of result.committedCases) next.delete(item.caseKey)
        return next
      })
      if (result.complete && !result.refusals.length) notify(t('bulk_merge_success') || 'Merged the selected duplicates')
    } catch (error: unknown) {
      if (!request.isCurrent()) return
      const unknown = selectedConflictOutcomeIsUnknown(error)
      setBatchUnknownOutcome(unknown)
      if (!unknown) {
        setBatchNeedsRefresh(true)
      }
      notify(selectedConflictErrorMessage(
        t,
        unknown && !(error as { code?: unknown } | null)?.code ? null : error,
        unknown ? 'selected_conflict_apply_failed' : 'selected_conflict_preview_stale',
        unknown
          ? 'The selected merge outcome is unknown. Product data will be refreshed.'
          : 'The review changed. Product data was refreshed; refresh the review before confirming.',
      ), 'error')
    } finally {
      batchWriteInFlightRef.current = false
      // The same-request Resume action is enabled only after the cache was
      // invalidated by the transport and this authoritative reload settled.
      await load()
      if (request.finish()) {
        setBulkBusy(false)
        setBulkProgress('')
      }
    }
  }

  const applySelectedMergeReview = async () => {
    if (!batchPreview || bulkBusy || batchResult || batchUnknownOutcome || batchNeedsRefresh) return
    const body = makeSelectedConflictMergeApplyBody(batchPreview, batchChoices, createClientRequestId('product-conflict-merge'))
    if (!body.cases.length) return
    setBatchApplyBody(body)
    await executeSelectedMergeBody(body)
  }

  const resumeSelectedMergeReview = async () => {
    if (!batchApplyBody || bulkBusy) return
    setBatchResult(null)
    setBatchUnknownOutcome(false)
    setBatchNeedsRefresh(false)
    await executeSelectedMergeBody(batchApplyBody)
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <InfoHint
          label={t('product_duplicates_how') || 'How this review works'}
          text={t('product_duplicates_hint') || 'Products that share one real barcode (strong same-item evidence — but an EDP/EDT pair or two shades can genuinely share one), one display name with different barcodes (usually genuinely different SKUs), or a similar name — the same name re-typed with different punctuation, accents or word order, each with its own barcode. Keep this = the other rows fold into it: received-date records, photos, sales and returns carry over and old sales stay valid. If a row you are removing still holds stock you are asked what happens to it — move the received-date records onto the kept product, or write them off against the ledger. Dismiss = reviewed, genuinely different items — it stays dismissed for everyone.'}
        />
        <div className="flex items-center gap-1">
          {(['all', 'leading_zero', 'same_barcode', 'same_name', 'similar_name'] as const).map((severity) => {
            const [key, fallback] = severity === 'all' ? ['all_severities', 'All'] : SEVERITY_LABEL_KEY[severity]
            return (
              <button
                key={severity}
                onClick={() => setSeverityFilter(severity)}
                className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  severityFilter === severity
                    ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
                }`}
              >
                {t(key) || fallback}
                {severity !== 'all' && counts[severity] > 0 ? ` · ${counts[severity]}` : ''}
              </button>
            )
          })}
        </div>
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_product_duplicates_placeholder') || 'Filter by name or barcode...'}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
          />
        </div>
        <ScanSearchButton
          onDetected={setSearch}
          t={(key) => t(key) || key}
          className="h-8 w-8 rounded-lg"
        />
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-900/20"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh') || 'Refresh'}
        </button>
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span>{visibleClusters.length} {t('duplicate_groups_shown') || 'group(s) shown'}</span>
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

          {selectedKeys.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/30">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                {bulkProgress || replaceVars(t('duplicates_bulk_selected_count') || '{count} selected', { count: selectedKeys.size })}
              </span>
              <button
                type="button"
                onClick={() => void openSelectedGroupReview()}
                disabled={bulkBusy}
                title={t('selected_conflict_group_review_hint') || 'Review every selected merge group and independent removal in one durable, paged server review.'}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <Search className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('loading') || 'Loading...') : (t('selected_conflict_group_review_action') || 'Review selected actions')}
              </button>
              <button
                type="button"
                onClick={() => void openSelectedMergeReview()}
                disabled={bulkBusy}
                title={t('bulk_merge_products_hint') || 'Review exact two-product matches together. Ineligible groups stay selected for individual review.'}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <Merge className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('saving') || 'Saving...') : `${t('duplicates_bulk_merge_action') || 'Merge selected'} · ${t('selected_conflict_merge_exact_pairs') || 'exact pairs'}`}
              </button>
              <button
                type="button"
                onClick={() => void bulkDismiss()}
                disabled={bulkBusy}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <EyeOff className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('saving') || 'Saving...') : (t('duplicates_bulk_dismiss_action') || 'Dismiss selected')}
              </button>
            </div>
          ) : null}

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
                  isExact={clusterIsExact(cluster)}
                  canRemoveProduct={canRemoveProduct}
                  removalReasons={groupRemovalReasons}
                  onToggleSelect={() => toggleSelected(id)}
                  onRemovalChange={updateGroupRemoval}
                  onDismiss={() => void handleDismiss(cluster)}
                  onApplyDecisions={(keeper, removals) => void handleApplyDecisions(cluster, keeper, removals)}
                  onEdit={openEdit}
                />
              )
            })}
          </div>
        </>
      )}

      {editTarget ? (
        <Modal title={`${t('resolve') || 'Resolve'} — ${editTarget.name || `#${editTarget.id}`}`} onClose={() => setEditTarget(null)} draggable unsavedChanges={{ dirty: editFormDirty }}>
          <div className="space-y-2.5">
            {([
              ['name', t('name') || 'Name', 'text'],
              ['barcode', t('barcode') || 'Barcode', 'text'],
              ['cost', t('cost_price') || 'Cost (USD)', 'number'],
              ['price', t('selling_price') || 'Selling price (USD)', 'number'],
            ] as const).map(([field, label, type]) => (
              <label key={field} className="block">
                <span className="mb-0.5 block text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
                <input
                  type={type}
                  className="input w-full text-sm"
                  value={editForm[field]}
                  onChange={(event) => setEditForm((current) => ({ ...current, [field]: event.target.value }))}
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditTarget(null)} disabled={editSaving}>
                {t('cancel') || 'Cancel'}
              </button>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => void saveEdit()} disabled={editSaving}>
                {editSaving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* The stock merge/remove decision. Rendered here so it floats above the
          review grid; the Apply and bulk flows AWAIT it (the shared
          ConfirmDialog, never window.confirm). */}
      {mergeStockChoiceDialog}
      {batchPreview ? (
        <SelectedConflictMergeReviewModal
          preview={batchPreview}
          localSkipped={batchLocalSkipped}
          choices={batchChoices}
          working={bulkBusy}
          result={batchResult}
          committedCases={batchCommittedCases}
          changedCases={batchChangedCases}
          choicesFrozen={Boolean(batchApplyBody)}
          unknownOutcome={batchUnknownOutcome}
          needsRefresh={batchNeedsRefresh}
          canResume={Boolean(batchApplyBody) && (batchUnknownOutcome || selectedConflictCanResumeSameRequest(batchResult))}
          canRepreview={batchResult?.interruptionCode === 'merge_state_conflict'}
          onChoice={(caseKey, choice) => { if (!batchApplyBody) setBatchChoices((current) => ({ ...current, [caseKey]: choice })) }}
          onConfirm={() => void applySelectedMergeReview()}
          onResume={() => void resumeSelectedMergeReview()}
          onRefresh={() => void refreshSelectedMergeReview()}
          onClose={closeSelectedMergeReview}
          t={t}
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
