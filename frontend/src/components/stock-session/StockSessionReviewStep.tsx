import type { StockLineReview } from '../../utils/stockSessionDraft.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

function Change({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline">
      {label ? <span className="text-gray-400">{label} </span> : null}
      <span className="tabular-nums">{before}</span>
      <span aria-hidden="true" className="px-0.5 text-gray-400">→</span>
      <span className="min-w-0 max-w-full break-words font-semibold tabular-nums text-gray-900 dark:text-gray-100">{after}</span>
    </span>
  )
}

/**
 * The last step (spec 4.3): the session's facts, then before -> after per line.
 * It is the review the confirm-dialog rule asks for, so no popup follows it.
 */
export default function StockSessionReviewStep({ tr, usdSymbol, canViewCosts, summary, reviews }: {
  tr: Translate
  usdSymbol: string
  canViewCosts: boolean
  /** One or two short lines: "Shop · Supplier X", "30/09/2026 · Paid $123.45". */
  summary: string[]
  reviews: StockLineReview[]
}) {
  const stockLabel = tr('stock', 'Stock')
  const cost4 = (value: number | null): string => (value == null ? tr('cost_unknown', 'Unknown cost') : `${usdSymbol}${value.toFixed(4)}`)
  const money2 = (value: number | null): string => (value == null ? '—' : `${usdSymbol}${value.toFixed(2)}`)
  return (
    <div className="space-y-2" data-stock-session-review>
      <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        {summary.map((line) => <div key={line} className="break-words">{line}</div>)}
      </div>
      {canViewCosts && reviews.some(review => review.mode === 'add') ? <p className="break-words text-[11px] text-gray-500">{tr('stock_cost_estimate_advisory', 'Estimate from current received lots. The saved cost may change before completion.')}</p> : null}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {reviews.map((review) => {
          const lot = review.lotBefore != null && review.lotAfter != null
            ? <Change label={review.lotLabel} before={String(review.lotBefore)} after={String(review.lotAfter)} />
            : null
          const stock = <Change label={stockLabel} before={String(review.stockBefore)} after={String(review.stockAfter)} />
          return (
            <li key={review.key} className="px-3 py-1.5 text-sm">
              <div className="break-words font-medium text-gray-900 dark:text-gray-100">
                {review.name}
                {review.mode === 'add' && review.freeQuantity > 0 ? <span className="ml-1.5 text-xs font-normal text-emerald-700 dark:text-emerald-300">{tr('stock_free_suffix', '{n} free').replace('{n}', String(review.freeQuantity))}</span> : null}
              </div>
              {review.barcode ? <span className="block break-all dense-id text-[10px] text-gray-400">{review.barcode}</span> : null}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                {review.mode === 'set' ? <>{lot}{lot ? <span aria-hidden="true">·</span> : null}{stock}</> : null}
                {review.mode === 'remove' ? <>{stock}{lot ? <><span aria-hidden="true">·</span>{lot}</> : null}<span aria-hidden="true">·</span><span>{review.tag || tr('stock_remove_entirely', 'Remove entirely')}</span></> : null}
                {review.mode === 'add' ? (
                  <>
                    {stock}
                    {canViewCosts ? <><span aria-hidden="true">·</span><span aria-live="polite"><Change label={tr('stock_cost_estimate', 'Cost estimate')} before={cost4(review.costBefore)} after={review.costPreview?.status === 'ready' ? cost4(review.costAfter) : review.costPreview?.status === 'calculating' ? tr('stock_cost_estimate_calculating', 'Calculating…') : tr('stock_cost_estimate_unavailable', 'Estimate unavailable')} /></span></> : null}
                    {review.priceAfter != null ? <><span aria-hidden="true">·</span><Change label={tr('price', 'Price')} before={money2(review.priceBefore)} after={money2(review.priceAfter)} /></> : null}
                    {review.tag ? <><span aria-hidden="true">·</span><span>{review.tag}</span></> : null}
                  </>
                ) : null}
              </div>
              {review.reason ? <div className="break-words text-[11px] text-gray-400">{review.reason}</div> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
