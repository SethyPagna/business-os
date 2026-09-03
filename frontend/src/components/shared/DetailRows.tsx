import type { ReactNode } from 'react'

/**
 * DetailRows -- the ONE label/value rhythm every record-detail surface shares.
 *
 * Why this exists (user, Sep 3 2026, about opening a sale from the Sales
 * list): "sales the click to view details has [so] many not converted to
 * excel style like totals, discounts, customers, cashier etc... i don't mean
 * it has to be excel style but a row view is better instead of current broken
 * view".
 *
 * The sale detail was half-converted: the Totals block was already a
 * label-on-the-left / amount-on-the-right row list, while Sale and Customer
 * were stacked label-ABOVE-value blocks, so the same modal read in two
 * different shapes at once -- and each stacked field burned two lines, which
 * is what made the phone view feel endless. The money block had its own
 * defect: every KHR figure rendered as a bare right-aligned line UNDER its USD
 * row with no label of its own, so a reader met naked numbers.
 *
 * So: `DetailRow` for identity/metadata fields, `MoneyRow` for a money line
 * that belongs in the SAME table as the line items (which is what makes the
 * amounts column-align under the line totals instead of merely being
 * right-aligned inside a separate box).
 *
 * Styling reuses the tokens already in use across the app -- `text-xs
 * text-gray-400` labels and `text-sm text-gray-800 dark:text-gray-200` values,
 * the same pair ProductDetailModal's local Row and the sale detail's old
 * InfoBlock both used -- so nothing new is invented here, it is only made
 * shared and consistent.
 */

interface DetailRowProps {
  label: string
  /** Plain value. Rendered only when non-empty, matching the old InfoBlock. */
  value?: string | number | null
  /** Rich value (badge, button, nested list). Takes precedence over `value`. */
  children?: ReactNode
  mono?: boolean
  /** Render `value` inside the app's blue pill (payment method, etc.). */
  badge?: boolean
  valueClassName?: string
}

export function DetailRow({ label, value, children, mono = false, badge = false, valueClassName = '' }: DetailRowProps) {
  const hasChildren = children != null && children !== false
  if (!hasChildren && (value == null || value === '')) return null
  return (
    <div className="flex min-w-0 items-baseline gap-3 py-1.5">
      {/* Fixed label column = the values line up down the card. 6.5rem clears
          the longest ordinary label ("Payment Method", "Customer Name") at
          text-xs without wrapping, and still leaves a phone card ~200px for
          the value itself. */}
      <span className="w-[6.5rem] flex-shrink-0 text-xs text-gray-400 sm:w-28">{label}</span>
      <div className={`min-w-0 flex-1 break-words text-sm font-medium text-gray-800 dark:text-gray-200 ${mono ? 'font-mono' : ''} ${valueClassName}`}>
        {hasChildren ? children : (badge ? <span className="badge-blue text-xs">{value}</span> : value)}
      </div>
    </div>
  )
}

/**
 * The container that turns a run of DetailRows into something scannable: one
 * hairline between rows, so the eye tracks a label across to its value the
 * way it does in a table, without drawing a full grid.
 */
export function DetailRowGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-gray-100 dark:divide-gray-700/60">{children}</div>
}

type MoneyTone = 'default' | 'muted' | 'discount' | 'credit' | 'refund' | 'due' | 'change'

const MONEY_TONE_CLASS: Record<MoneyTone, string> = {
  default: 'text-gray-700 dark:text-gray-200',
  muted: 'text-gray-500 dark:text-gray-400',
  discount: 'text-red-600 dark:text-red-400',
  credit: 'text-emerald-600 dark:text-emerald-400',
  refund: 'text-orange-600 dark:text-orange-400',
  due: 'text-amber-600 dark:text-amber-400',
  change: 'text-blue-600 dark:text-blue-400',
}

interface MoneyRowProps {
  label: string
  /** Primary (USD) amount -- already formatted by the caller's fmtUSD. */
  amount: ReactNode
  /** Secondary (KHR) amount. Rendered UNDER the primary IN THE SAME CELL, so
   *  it stays attached to this row's own label instead of floating free. */
  sub?: ReactNode
  tone?: MoneyTone
  /** The grand total: heavier type and a rule above it. */
  strong?: boolean
  /** How many leading item columns the label spans. */
  labelSpan?: number
  /** A bare `data-*` attribute name stamped on the row, for surfaces that
   *  need to distinguish two totals rows that look alike but mean different
   *  things -- the replacement-sale total vs. a historical exchange
   *  settlement on a return. Keeps those rows on this shared rhythm instead
   *  of hand-rolling a second row shape just to carry the marker. */
  marker?: string
  /** Extra note rendered under the label (e.g. a credit due date). */
  note?: ReactNode
}

export function MoneyRow({ label, amount, sub, tone = 'default', strong = false, labelSpan = 3, note, marker }: MoneyRowProps) {
  const toneClass = MONEY_TONE_CLASS[tone]
  const border = strong ? 'border-t border-gray-200 dark:border-gray-700' : ''
  return (
    <tr className={`${toneClass} ${border}`} {...(marker ? { [marker]: '' } : {})}>
      <td colSpan={labelSpan} className={`px-2 py-1 text-right ${strong ? 'text-sm font-bold sm:text-base' : 'text-xs'}`}>
        {label}
        {note ? <span className="ml-1 text-[11px] font-normal opacity-80">{note}</span> : null}
      </td>
      <td className={`whitespace-nowrap px-2 py-1 text-right tabular-nums ${strong ? 'text-sm font-bold sm:text-base' : 'text-xs font-semibold'}`}>
        {amount}
        {sub ? <div className="text-[11px] font-normal text-gray-400 dark:text-gray-500">{sub}</div> : null}
      </td>
    </tr>
  )
}

export default DetailRow
