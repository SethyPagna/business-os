import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import TruncatedText from './TruncatedText.tsx'
import { getProductCostBreakdown } from '../../api/productReadTransport.ts'
import { fmtDate } from '../../utils/formatters.ts'
import {
  formatCostFormula,
  costExclusionLabelKey,
  costRowPrimaryText,
  costRowMeta,
  normalizeCostBreakdown,
  type CostBreakdown,
} from '../../utils/costBreakdownFormat.ts'

type TranslateFn = (key: string, fallback: string) => string

export type CostCalculationFloatProps = {
  productId: number | string
  productName?: string
  onClose: () => void
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  t: TranslateFn
}

// P10-6 (owner ruling, 2026-09-16, verbatim): "when clicked on cost price it
// opens a page that tells us the calculated cost price (n_i + n_{i+1} +
// ... + n_{i+k}) / i". One shared float, opened from every clickable cost
// price display in the app -- see the display sites listed in the lane task.
// Renders its real content from first paint (per the standing no-stub-float
// rule): it fetches on mount and shows a loading state, never a shell that
// waits on some prior action.
export default function CostCalculationFloat({ productId, productName, onClose, fmtUSD, fmtKHR, t }: CostCalculationFloatProps) {
  const tr = (key: string, fallback: string): string => t(key, fallback) || fallback
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    setLoading(true)
    setError('')
    getProductCostBreakdown(productId)
      .then((result) => {
        if (!aliveRef.current) return
        const normalized = normalizeCostBreakdown(result)
        if (!normalized) throw new Error('empty')
        setBreakdown(normalized)
      })
      .catch(() => {
        if (aliveRef.current) setError(tr('cost_breakdown_failed', 'Could not load the cost calculation'))
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false)
      })
    return () => { aliveRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  const formula = breakdown ? formatCostFormula(breakdown.distinct_usd, breakdown.mean_usd) : ''

  return (
    <Modal title={tr('cost_breakdown_title', 'Calculated cost price')} onClose={onClose} size="sm" unsavedChanges="read-only">
      <div className="space-y-3 text-sm">
        {productName ? <div className="min-w-0 truncate text-xs font-medium text-gray-500 dark:text-gray-400">{productName}</div> : null}

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ) : error ? (
          <p role="alert" className="text-red-600">{error}</p>
        ) : breakdown ? (
          <>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
              {breakdown.inputs.length ? breakdown.inputs.map((input, index) => {
                const excludedKey = costExclusionLabelKey(input.excluded)
                const excludedLabel = excludedKey ? tr(excludedKey, excludedKey) : ''
                const isManual = input.source === 'manual'
                const formattedDate = isManual
                  ? (input.recorded_at ? fmtDate(input.recorded_at) : null)
                  : (input.received_at ? fmtDate(input.received_at) : null)
                const primaryText = isManual ? tr('cost_breakdown_manual_tag', 'Override') : costRowPrimaryText(input, formattedDate)
                const meta = costRowMeta(input, formattedDate)
                return (
                  // ONE compact row per entry (P10-11 ruling): the lot
                  // code/date or the "Manual" tag on the left with its
                  // muted meta strip on the same line, the cost on the
                  // right -- never a two-line "list number · shop" card.
                  <li
                    key={`${input.source}-${input.lot_code || input.recorded_at || input.label}-${index}`}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${input.excluded ? 'opacity-50' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <TruncatedText
                        text={`${primaryText}${meta ? ` · ${meta}` : ''}`}
                        className={`block truncate text-sm ${isManual ? 'font-medium text-indigo-600 dark:text-indigo-400' : 'text-gray-800 dark:text-gray-200'}`}
                      />
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block font-medium">{input.cost_usd == null ? '—' : fmtUSD(input.cost_usd)}</span>
                      {excludedLabel ? <span className="block text-[11px] text-gray-400">{excludedLabel}</span> : null}
                    </span>
                  </li>
                )
              }) : (
                <li className="px-2.5 py-2 text-xs text-gray-400">{tr('cost_breakdown_no_lots', 'No lot costs recorded yet -- showing the catalog cost.')}</li>
              )}
            </ul>

            {formula ? (
              <div className="rounded-lg bg-gray-50 p-2.5 font-mono text-xs tabular-nums text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
                {formula}
              </div>
            ) : null}

            {breakdown.outlier_guard.fired ? (
              <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                {tr('cost_breakdown_outlier_note', 'One recorded cost was far outside the others (more than double), so the highest recorded cost is used instead of the average.')}
              </p>
            ) : null}

            <div className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{tr('cost_breakdown_result_label', 'Catalog cost price')}</div>
              <div className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">{fmtUSD(breakdown.result_usd)}</div>
              {breakdown.result_khr > 0 ? (
                <div className="text-xs text-gray-400">
                  {fmtKHR(breakdown.result_khr)}
                  <span className="ml-1">({tr('cost_breakdown_khr_note', 'recorded KHR cost, not averaged from lots')})</span>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
