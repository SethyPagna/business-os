import { useEffect, useMemo, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import InfoHint from '../shared/InfoHint.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import { ProductImg } from './shared/primitives.tsx'
import { getPossiblySameProducts, dismissProductDuplicateCluster, mergePossiblySameProducts, updateProduct } from '../../api/productWriteTransport.ts'
import { normalizeProductGroupName } from '../../utils/productGrouping.ts'
import Modal from '../shared/Modal'

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

type Severity = 'same_barcode' | 'same_name' | 'similar_name'

type ClusterProduct = {
  id: number
  name: string | null
  barcode: string | null
  cost_price_usd: number | null
  selling_price_usd: number | null
  stock_quantity: number | null
  image_path: string | null
}

type Cluster = {
  type: 'barcode' | 'name' | 'similar'
  value: string
  severity: Severity
  products: ClusterProduct[]
}

const SEVERITY_STYLE: Record<Severity, string> = {
  same_barcode: 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30',
  same_name: 'border-[var(--ui-line)] bg-[var(--ui-surface-2)]',
  similar_name: 'border-violet-200 bg-violet-50 dark:border-violet-900/40 dark:bg-violet-950/30',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  same_barcode: 'text-amber-800 dark:text-amber-300',
  same_name: 'text-[var(--ui-ink-2)]',
  similar_name: 'text-violet-700 dark:text-violet-300',
}

const SEVERITY_LABEL_KEY: Record<Severity, [string, string]> = {
  same_barcode: ['product_dup_same_barcode', 'Same barcode'],
  same_name: ['product_dup_same_name', 'Same name'],
  similar_name: ['product_dup_similar_name', 'Similar name'],
}

function clusterKey(cluster: Cluster): string {
  return `${cluster.type}:${cluster.value}`
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

function ClusterCard({
  cluster, t, dismissing, merging, selected, selectable, isExact, onToggleSelect, onDismiss, onApplyDecisions, onEdit,
}: {
  cluster: Cluster
  t: TranslateFn
  dismissing: boolean
  merging: boolean
  selected: boolean
  selectable: boolean
  // Same barcode AND same name -> the Resolve (edit) button is hidden; the
  // Keep this / Keep both decision is the only sane next step (spec item #3).
  isExact: boolean
  onToggleSelect: () => void
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
  const [decisions, setDecisions] = useState<Record<number, 'keep' | 'remove'>>({})
  // A long product name truncates to "..." in the fixed row width, and
  // hover-only `title` tooltips don't exist on touch -- so the name (and
  // the cluster's shared value chip) toggle to full, wrapped text on
  // click/tap (user, Aug 31: "if product name is long it uses '...' and
  // can't click to view details").
  const [expandedNames, setExpandedNames] = useState<Record<number, boolean>>({})
  const [valueExpanded, setValueExpanded] = useState(false)
  const busy = dismissing || merging

  const decide = (productId: number, decision: 'keep' | 'remove') => {
    setDecisions((current) => {
      const next: Record<number, 'keep' | 'remove'> = { ...current }
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
  const removals = cluster.products.filter((product) => decisions[product.id] === 'remove')
  const everyDecided = cluster.products.every((product) => decisions[product.id])
  const canApply = Boolean(keeper) && everyDecided && removals.length > 0 && !busy

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-shadow ${SEVERITY_STYLE[cluster.severity]} ${busy ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-[var(--ui-accent)]' : ''}`}>
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
          return (
            <div key={product.id} className="flex items-center gap-2 text-sm">
              <ProductImg src={product.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpandedNames((current) => ({ ...current, [product.id]: !current[product.id] }))}
                  className={`block w-full text-left font-medium text-gray-900 dark:text-white ${expandedNames[product.id] ? 'whitespace-normal break-words' : 'truncate'}`}
                  title={product.name || ''}
                >
                  {product.name || `#${product.id}`}
                </button>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {cluster.type !== 'barcode' && product.barcode ? <span>{product.barcode}</span> : null}
                  <span>{money(product.cost_price_usd)} → {money(product.selling_price_usd)}</span>
                  <span>{Number(product.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
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
                  onClick={() => decide(product.id, 'remove')}
                  disabled={busy}
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${decision === 'remove'
                    ? 'bg-rose-600 text-white'
                    : 'text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/20'}`}
                >
                  {t('remove') || 'Remove'}
                </button>
                {isExact ? null : (
                  <button
                    type="button"
                    onClick={() => onEdit(product)}
                    disabled={busy}
                    title={t('resolve_duplicate_inline_hint') || 'Edit this product right here — name, barcode and prices — without leaving the review'}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ui-accent-ink)] transition hover:bg-[var(--ui-accent-soft)] disabled:opacity-50"
                  >
                    {t('resolve') || 'Resolve'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-black/5 pt-1.5 dark:border-white/10">
        <span className="text-[11px] text-gray-400">
          {everyDecided
            ? (keeper
              ? `${t('keep') || 'Keep'} "${keeper.name || `#${keeper.id}`}" · ${removals.length} ${t('remove') || 'remove'}`
              : (t('dup_pick_one_keep') || 'Pick one Keep'))
            : (t('dup_decide_all_hint') || 'Decide every row (Keep / Remove) to apply')}
        </span>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => keeper && onApplyDecisions(keeper, removals)}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Merge className="h-3 w-3" />
          {merging ? (t('merging') || 'Merging...') : (t('apply') || 'Apply')}
        </button>
      </div>
    </div>
  )
}

export default function ProductDuplicatesTab({ t, notify }: {
  t: TranslateFn
  notify: NotifyFn
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
  // "Merging 3/8…" -- bulk runs are sequential server calls, so tell the
  // reviewer where it is instead of freezing on a bare disabled button.
  const [bulkProgress, setBulkProgress] = useState('')

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

  // Apply the group's explicit decisions (ONE keeper + the rows marked
  // Remove); one pair per call, stopping on the first failure so nothing
  // half-merges silently. Undecided rows (in an odd partial state) are
  // never touched -- but the card only arms Apply when every row is
  // decided, so normally removals covers the whole rest of the group.
  const handleApplyDecisions = async (cluster: Cluster, keeper: ClusterProduct, removals: ClusterProduct[]) => {
    if (!removals.length) return
    const id = clusterKey(cluster)
    setMergingId(id)
    try {
      for (const other of removals) {
        await mergePossiblySameProducts(keeper.id, other.id)
      }
      notify(t('product_duplicate_merged') || 'Merged -- stock, lots and images were carried onto the kept product')
      removeCluster(id)
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
    if (failed) {
      notify(replaceVars(t('bulk_dismiss_partial_failure') || '{count} of the selected duplicates could not be dismissed', { count: failed }), 'error')
    } else {
      notify(t('bulk_dismiss_success') || 'Dismissed the selected duplicates')
    }
  }

  // Bulk Merge -- only automated for exactly-2-product clusters, where
  // "keep the older record" (lower id, created first) is an unambiguous,
  // defensible default; its sales/lot history is the longer one. A 3+
  // cluster genuinely needs a human to pick the survivor (the per-row
  // "Keep this" flow), so those are skipped here and reported, never
  // guessed at -- identical rule to the contacts panel's bulk merge.
  const bulkMerge = async () => {
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(cluster)))
    if (!targets.length || bulkBusy) return
    const mergeable = targets.filter((cluster) => cluster.products.length === 2)
    const skipped = targets.length - mergeable.length
    setBulkBusy(true)
    let failed = 0
    let done = 0
    for (const cluster of mergeable) {
      setBulkProgress(replaceVars(t('bulk_merging_progress') || 'Merging {done}/{total}…', { done: done + 1, total: mergeable.length }))
      const [keeper, other] = [...cluster.products].sort((a, b) => a.id - b.id)
      try {
        await mergePossiblySameProducts(keeper.id, other.id)
        removeCluster(clusterKey(cluster))
      } catch {
        failed += 1
      }
      done += 1
    }
    setBulkBusy(false)
    setBulkProgress('')
    setSelectedKeys(new Set())
    if (failed || skipped) {
      const parts = []
      if (failed) parts.push(replaceVars(t('bulk_merge_partial_failure') || '{count} could not be merged', { count: failed }))
      if (skipped) parts.push(replaceVars(t('bulk_merge_skipped_multiway') || '{count} group(s) with 3+ records were skipped -- merge those individually', { count: skipped }))
      notify(parts.join('. '), failed ? 'error' : 'info')
    } else {
      notify(t('bulk_merge_success') || 'Merged the selected duplicates')
    }
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
    const result: Record<Severity, number> = { same_barcode: 0, same_name: 0, similar_name: 0 }
    for (const cluster of clusters) result[cluster.severity] += 1
    return result
  }, [clusters])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <InfoHint
          label={t('product_duplicates_how') || 'How this review works'}
          text={t('product_duplicates_hint') || 'Products that share one real barcode (strong same-item evidence — but an EDP/EDT pair or two shades can genuinely share one), one display name with different barcodes (usually genuinely different SKUs), or a similar name — the same name re-typed with different punctuation, accents or word order, each with its own barcode. Keep this = the other rows merge into it: stock, lots and photos carry over, old sales stay valid. Dismiss = reviewed, genuinely different items — it stays dismissed for everyone.'}
        />
        <div className="flex items-center gap-1">
          {(['all', 'same_barcode', 'same_name', 'similar_name'] as const).map((severity) => {
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
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-[var(--ui-accent)] focus:ring-2 focus:ring-[var(--ui-accent-soft)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
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
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--ui-accent-ink)] hover:bg-[var(--ui-accent-soft)] disabled:opacity-50"
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
              className="ml-auto text-[var(--ui-accent-ink)] hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {t('select_all') || 'Select all'}
            </button>
            {selectedKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                disabled={bulkBusy}
                className="text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
              >
                {t('clear_selection') || 'Clear selection'}
              </button>
            ) : null}
          </div>

          {selectedKeys.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-surface-2)] px-3 py-2 text-xs">
              <span className="font-medium text-[var(--ui-ink-2)]">
                {bulkProgress || replaceVars(t('duplicates_bulk_selected_count') || '{count} selected', { count: selectedKeys.size })}
              </span>
              <button
                type="button"
                onClick={() => void bulkMerge()}
                disabled={bulkBusy}
                title={t('bulk_merge_products_hint') || 'Each selected pair merges into its older record (created first); groups of 3+ are skipped — pick their keeper by hand'}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <Merge className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('saving') || 'Saving...') : (t('duplicates_bulk_merge_action') || 'Merge selected')}
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
                  onToggleSelect={() => toggleSelected(id)}
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
        <Modal title={`${t('resolve') || 'Resolve'} — ${editTarget.name || `#${editTarget.id}`}`} onClose={() => setEditTarget(null)} draggable>
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
    </div>
  )
}
