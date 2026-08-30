import { useEffect, useMemo, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import ArrowRightCircle from 'lucide-react/dist/esm/icons/arrow-right-circle.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import InfoHint from '../shared/InfoHint.tsx'
import { ProductImg } from './shared/primitives.tsx'
import { getPossiblySameProducts, dismissProductDuplicateCluster, mergePossiblySameProducts } from '../../api/productWriteTransport.ts'

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

type Severity = 'same_barcode' | 'same_name'

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
  type: 'barcode' | 'name'
  value: string
  severity: Severity
  products: ClusterProduct[]
}

const SEVERITY_STYLE: Record<Severity, string> = {
  same_barcode: 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30',
  same_name: 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  same_barcode: 'text-amber-800 dark:text-amber-300',
  same_name: 'text-blue-700 dark:text-blue-300',
}

const SEVERITY_LABEL_KEY: Record<Severity, [string, string]> = {
  same_barcode: ['product_dup_same_barcode', 'Same barcode'],
  same_name: ['product_dup_same_name', 'Same name'],
}

function clusterKey(cluster: Cluster): string {
  return `${cluster.type}:${cluster.value}`
}

function money(value: number | null | undefined): string {
  const n = Number(value) || 0
  return `$${n % 1 === 0 ? n : n.toFixed(2)}`
}

function ClusterCard({
  cluster, t, dismissing, merging, onDismiss, onMergeInto, onResolve,
}: {
  cluster: Cluster
  t: TranslateFn
  dismissing: boolean
  merging: boolean
  onDismiss: () => void
  onMergeInto: (keeper: ClusterProduct) => void
  onResolve: (term: string) => void
}) {
  const [key, fallback] = SEVERITY_LABEL_KEY[cluster.severity]
  // Two-tap keeper confirm, same pattern as the contacts panel: first tap
  // picks the survivor, second tap on the SAME row confirms; tapping
  // another row restarts the choice.
  const [pendingKeeperId, setPendingKeeperId] = useState<number | null>(null)
  const busy = dismissing || merging

  const clickMerge = (product: ClusterProduct) => {
    if (pendingKeeperId === product.id) {
      onMergeInto(product)
      setPendingKeeperId(null)
    } else {
      setPendingKeeperId(product.id)
    }
  }

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${SEVERITY_STYLE[cluster.severity]} ${busy ? 'opacity-60' : ''}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${SEVERITY_TEXT[cluster.severity]}`}>{t(key) || fallback}</span>
        <div className="flex items-center gap-1">
          <span className="max-w-[10rem] truncate text-[11px] text-gray-400" title={cluster.value}>
            {cluster.type === 'barcode' ? cluster.value : `"${cluster.value}"`}
          </span>
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
          const isPendingKeeper = pendingKeeperId === product.id
          return (
            <div key={product.id} className="flex items-center gap-2 text-sm">
              <ProductImg src={product.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-900 dark:text-white" title={product.name || ''}>
                  {product.name || `#${product.id}`}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {cluster.type !== 'barcode' && product.barcode ? <span>{product.barcode}</span> : null}
                  <span>{money(product.cost_price_usd)} → {money(product.selling_price_usd)}</span>
                  <span>{Number(product.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => clickMerge(product)}
                  disabled={busy}
                  title={isPendingKeeper
                    ? (t('merge_confirm_hint') || 'Tap again to confirm -- the other product(s) merge into this one: stock, lots and images carry over, sales history stays valid')
                    : (t('merge_into_hint') || 'Keep this one, merge the other(s) into it')}
                  className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${
                    isPendingKeeper
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
                  }`}
                >
                  <Merge className="h-3 w-3" />
                  {merging && isPendingKeeper
                    ? (t('merging') || 'Merging...')
                    : isPendingKeeper
                      ? (t('confirm') || 'Confirm')
                      : (t('keep_this_one') || 'Keep this')}
                </button>
                {product.name ? (
                  <button
                    type="button"
                    onClick={() => onResolve(product.name as string)}
                    title={t('resolve_product_duplicate_hint') || 'Open the product list filtered to this name to compare or edit by hand'}
                    className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <ArrowRightCircle className="h-3 w-3" />
                    {t('resolve') || 'Open'}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ProductDuplicatesTab({ t, notify, onResolve }: {
  t: TranslateFn
  notify: NotifyFn
  onResolve: (searchTerm: string) => void
}) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all')
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)

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

  // One pair per call (the server merge is keepId+mergeId); a 3+ cluster
  // folds every non-keeper in sequence, stopping on the first failure so
  // nothing half-merges silently.
  const handleMergeInto = async (cluster: Cluster, keeper: ClusterProduct) => {
    const others = cluster.products.filter((product) => product.id !== keeper.id)
    if (!others.length) return
    const id = clusterKey(cluster)
    setMergingId(id)
    try {
      for (const other of others) {
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

  const normalizedSearch = search.trim().toLowerCase()
  const visibleClusters = useMemo(() => clusters.filter((cluster) => {
    if (severityFilter !== 'all' && cluster.severity !== severityFilter) return false
    if (!normalizedSearch) return true
    const haystack = [cluster.value, ...cluster.products.flatMap((p) => [p.name, p.barcode])]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(normalizedSearch)
  }), [clusters, normalizedSearch, severityFilter])

  const counts = useMemo(() => {
    const result = { same_barcode: 0, same_name: 0 }
    for (const cluster of clusters) result[cluster.severity] += 1
    return result
  }, [clusters])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <InfoHint
          label={t('product_duplicates_how') || 'How this review works'}
          text={t('product_duplicates_hint') || 'Products that share one real barcode (strong same-item evidence — but an EDP/EDT pair or two shades can genuinely share one) or one display name with different barcodes (usually genuinely different SKUs). Keep this = the other rows merge into it: stock, lots and photos carry over, old sales stay valid. Dismiss = reviewed, genuinely different items — it stays dismissed for everyone.'}
        />
        <div className="flex items-center gap-1">
          {(['all', 'same_barcode', 'same_name'] as const).map((severity) => {
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
                onDismiss={() => void handleDismiss(cluster)}
                onMergeInto={(keeper) => void handleMergeInto(cluster, keeper)}
                onResolve={onResolve}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
