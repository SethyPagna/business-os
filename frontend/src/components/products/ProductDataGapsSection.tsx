import { useCallback, useEffect, useRef, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../shared/ConflictIcon.ts'
import { ProductImg } from './shared/primitives.tsx'
import {
  getProductDataGapCounts,
  getProductDataGaps,
  type ProductDataGapCounts,
  type ProductDataGapKind,
  type ProductDataGapRow,
} from '../../api/productWriteTransport.ts'

// Products -> Conflicts, second block: the two gaps no merge can settle, only an edit (owner, 14 Oct 2026).
// A NULL cost is unknown and a typed 0 is a recorded $0 (so $0 is never listed); an empty barcode leaves a row
// with no identity. The flag is per product row (a name group's child row), because the row carries its own cost
// and barcode and is what gets edited. A tap opens the same product preview a Products row opens, which has Edit.

type TranslateFn = (key: string) => string | undefined

const KINDS: ReadonlyArray<{ kind: ProductDataGapKind; labelKey: string; labelFallback: string; emptyKey: string; emptyFallback: string }> = [
  { kind: 'unknown_cost', labelKey: 'conflict_type_unknown_cost', labelFallback: 'Unknown cost', emptyKey: 'product_data_gaps_none_unknown_cost', emptyFallback: 'No products with an unknown cost.' },
  { kind: 'empty_barcode', labelKey: 'conflict_type_empty_barcode', labelFallback: 'No barcode', emptyKey: 'product_data_gaps_none_empty_barcode', emptyFallback: 'No products without a barcode.' },
]

export function ProductDataGapRowCard({ row, kind, t, onOpen }: {
  row: ProductDataGapRow
  kind: ProductDataGapKind
  t: TranslateFn
  onOpen?: (productId: number) => void
}) {
  const name = row.name || `#${row.id}`
  const gapLabel = kind === 'unknown_cost'
    ? t('conflict_unknown_cost_catalog') || 'Product cost unknown'
    : t('conflict_type_empty_barcode') || 'No barcode'
  return (
    <button
      type="button"
      data-product-data-gap-row={row.id}
      onClick={() => onOpen?.(row.id)}
      disabled={!onOpen}
      aria-label={`${t('product_preview_open') || 'Open product preview'}: ${name}`}
      className="flex w-full min-w-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left transition hover:bg-amber-100 disabled:cursor-default disabled:hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
    >
      <ProductImg src={row.image_path || ''} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block whitespace-normal break-words text-sm font-medium leading-relaxed text-gray-900 [overflow-wrap:anywhere] dark:text-white">{name}</span>
        <span className="scroll-x-clean mt-0.5 block text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-x-2 whitespace-nowrap">
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
              <ConflictIcon aria-hidden="true" className={`h-3 w-3 shrink-0 ${CONFLICT_ICON_CLASS}`} />
              {gapLabel}
            </span>
            {row.barcode && row.barcode.trim() ? <span>{row.barcode}</span> : null}
            {row.sku ? <span>{row.sku}</span> : null}
            <span>{Number(row.stock_quantity) || 0} {t('pcs') || 'pcs'}</span>
          </span>
        </span>
      </span>
    </button>
  )
}

export default function ProductDataGapsSection({ t, notify, onPreviewProduct, refreshToken = 0 }: {
  t: TranslateFn
  notify: (message: string, tone?: string) => void
  onPreviewProduct?: (productId: number) => void
  /** The tab's own Refresh bumps this; the section re-reads instead of carrying a second Refresh button. */
  refreshToken?: number
}) {
  const [kind, setKind] = useState<ProductDataGapKind>('unknown_cost')
  const [rows, setRows] = useState<ProductDataGapRow[]>([])
  const [nextAfter, setNextAfter] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [counts, setCounts] = useState<ProductDataGapCounts | null>(null)
  // The last request wins: a slow page of the previous kind must not land in the new kind's list.
  const requestRef = useRef(0)

  const loadPage = useCallback(async (nextKind: ProductDataGapKind, after: number | null) => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const page = await getProductDataGaps(nextKind, after)
      if (request !== requestRef.current) return
      setRows((current) => (after ? [...current, ...page.items] : page.items))
      setHasMore(Boolean(page.has_more))
      setNextAfter(page.next_after ?? null)
      setLoaded(true)
    } catch {
      if (request !== requestRef.current) return
      notify(t('product_data_gaps_load_failed') || 'Could not load these products', 'error')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [notify, t])

  const reload = useCallback((nextKind: ProductDataGapKind) => {
    setRows([])
    setHasMore(false)
    setNextAfter(null)
    setLoaded(false)
    void loadPage(nextKind, null)
    void getProductDataGapCounts().then(setCounts).catch(() => { /* the chips simply show no count */ })
  }, [loadPage])

  useEffect(() => { reload(kind) }, [kind, refreshToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreLabel = t('load_more') || 'Load more'
  const active = KINDS.find((item) => item.kind === kind) || KINDS[0]

  return (
    <section data-product-data-gaps className="space-y-2 border-t border-gray-100 pt-3 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-1.5">
        <ConflictIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${CONFLICT_ICON_CLASS}`} />
        <div role="group" aria-label={t('type') || 'Type'} className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none]">
          {KINDS.map((item) => {
            const count = counts ? counts[item.kind] : null
            return (
              <button
                key={item.kind}
                type="button"
                data-product-data-gap-kind={item.kind}
                aria-pressed={kind === item.kind}
                onClick={() => setKind(item.kind)}
                className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold leading-relaxed transition-colors ${kind === item.kind ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'}`}
              >
                {t(item.labelKey) || item.labelFallback}{count != null && count > 0 ? ` · ${count}` : ''}
              </button>
            )
          })}
        </div>
      </div>

      {!loaded ? (
        <div className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t(active.emptyKey) || active.emptyFallback}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => <ProductDataGapRowCard key={row.id} row={row} kind={kind} t={t} onOpen={onPreviewProduct} />)}
          </div>
          {hasMore ? (
            <div className="flex justify-center">
              <button
                type="button"
                data-product-data-gap-more
                onClick={() => void loadPage(kind, nextAfter)}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
              >
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
                {loadMoreLabel}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
