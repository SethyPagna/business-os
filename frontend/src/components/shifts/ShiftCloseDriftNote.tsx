import History from 'lucide-react/dist/esm/icons/history.js'
import { useApp } from '../../AppContext.tsx'
import EntityLink from '../shared/EntityLink.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { shiftCloseDriftView, type ShiftDriftSaleView } from './shiftReportModel.ts'
import type { Shift } from '../../api/shiftTransport.ts'

/**
 * N4 (LOOPHOLE-REVIEW-20261006): what moved after a shift closed.
 *
 * The cash breakdown above it is the drawer the shift CLOSED on, stored at the
 * close and never recomputed. This block is everything that has changed since
 * -- a tender relabel, a cancelled or settled sale, a sale backdated into the
 * window, an amended count -- with today's figure beside the stored one and a
 * link to each sale. Nothing is hidden from the admin and nothing silently
 * rewrites the closed drawer. Rendered only when the server reported drift.
 */
type Props = { shift: Shift; className?: string }

type Pair = { usd: number | null; khr: number | null } | null

export default function ShiftCloseDriftNote({ shift, className = '' }: Props) {
  const { t, fmtUSD, fmtKHR, navigateTo } = useApp() as {
    t: (key: string) => string
    fmtUSD: (value: unknown) => string
    fmtKHR: (value: unknown) => string
    navigateTo?: (page: string, anchor?: string) => void
  }
  const view = shiftCloseDriftView(shift)
  if (!view) return null
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  // Riel only where it is not zero: most lines are dollars only.
  const pair = (value: Pair) => {
    if (!value) return '—'
    const usd = value.usd == null ? '—' : fmtUSD(value.usd)
    return value.khr ? `${usd} · ${fmtKHR(value.khr)}` : usd
  }
  const moved = (label: string, before: Pair, after: Pair) =>
    JSON.stringify(before) === JSON.stringify(after) ? null : `${label} ${pair(before)} → ${pair(after)}`
  const saleText = (sale: ShiftDriftSaleView) => {
    if (sale.change === 'removed') return tr('shift_drift_removed', 'No longer in this shift')
    const parts = [
      moved(tr('cash', 'Cash'), sale.cash.before, sale.cash.after),
      moved(tr('other', 'Other'), sale.other.before, sale.other.after),
    ].filter(Boolean)
    return [sale.change === 'added' ? tr('shift_drift_added', 'Added after close') : null, ...parts].filter(Boolean).join(' · ')
  }

  return (
    <div className={`min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-900 dark:bg-amber-950/30 ${className}`}>
      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {tr('shift_changed_after_close', 'Changed after close')}
        <InfoHint text={tr('shift_changed_after_close_hint', "Records in this shift's window changed after it closed. The breakdown above stays as closed; today's figures are shown here for comparison.")} label={tr('shift_changed_after_close', 'Changed after close')} />
      </div>
      {view.components.length ? (
        <dl className="mt-1.5 min-w-0 divide-y divide-amber-100 dark:divide-amber-900/50">
          {view.components.map((component) => (
            <div key={component.key} className="flex min-w-0 items-baseline justify-between gap-3 py-0.5">
              <dt className="shrink-0 text-amber-800 dark:text-amber-300">{t(component.labelKey)}</dt>
              <dd className="min-w-0 break-words text-right font-medium tabular-nums text-amber-950 dark:text-amber-100">
                {pair(component.stored)} → {pair(component.current)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {view.sales.length ? (
        <ul className="mt-1.5 min-w-0 space-y-0.5 border-t border-amber-100 pt-1.5 dark:border-amber-900/50">
          {view.sales.map((sale) => (
            <li key={sale.saleId} className="flex min-w-0 items-baseline gap-2">
              <EntityLink page="sales" anchor="hub:sales:sales" search={sale.receipt} navigate={navigateTo}
                className="shrink-0 font-mono text-amber-900 underline-offset-2 hover:underline dark:text-amber-200" title={tr('open_sale', 'Open sale')}>
                {sale.receipt}
              </EntityLink>
              {sale.cancelled ? <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{tr('cancelled', 'Cancelled')}</span> : null}
              <span className="min-w-0 break-words tabular-nums text-amber-950 dark:text-amber-100">{saleText(sale)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.more > 0 ? <p className="mt-1 text-amber-800 dark:text-amber-300">{tr('shift_drift_more', '+{count} more sales').replace('{count}', String(view.more))}</p> : null}
      {view.salesUnavailable ? <p className="mt-1 text-amber-800 dark:text-amber-300">{tr('shift_drift_sales_unavailable', 'Too many sales to list one by one.')}</p> : null}
    </div>
  )
}
