import type { ReactNode } from 'react'
import InfoHint from '../shared/InfoHint.tsx'

type MiniStatProps = {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  color?: string
  trend?: number | null
  onClick?: () => void
  className?: string
  /**
   * Plain-English explanation of what this figure means, optionally followed
   * by a blank line and how it is calculated. Rendered behind a small info
   * affordance rather than printed on the card.
   *
   * This exists so a stat card can stay small while still being
   * understandable: the alternative was a "Formula"/"Example" row inside the
   * drill-down list, which put paragraphs of prose in a list of figures and
   * made the list long enough that the actual numbers were hard to find.
   */
  info?: string
  /** Names the hint for screen readers, e.g. "Revenue - what this means". */
  infoLabel?: string
}

export default function MiniStat({ label, value, sub, color, trend, onClick, className = '', info, infoLabel }: MiniStatProps) {
  const trendUp = typeof trend === 'number' && trend > 0
  const trendNone = trend === undefined || trend === null
  const subIsText = typeof sub === 'string'
  const hasSub = Boolean(sub)
  const normalizedSub = subIsText ? sub.trim() : sub
  const subLineClass = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-3.5 text-gray-500 dark:text-gray-400'
  const classNames = `card relative flex flex-col gap-0 px-3 py-2 text-left sm:px-3.5 sm:py-2.5 ${onClick ? 'transition focus-within:ring-2 focus-within:ring-blue-200 hover:ring-2 hover:ring-blue-200 dark:focus-within:ring-blue-800/60 dark:hover:ring-blue-800/60' : ''} ${className}`

  const content = (
    <>
      {/* pr-5 keeps the label clear of the info affordance in the corner. */}
      <div className="pr-5 text-[11px] font-medium leading-4 text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-bold leading-6 tracking-tight sm:text-[1.2rem] ${color || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {hasSub ? (
        <div
          className={subIsText ? subLineClass : 'min-w-0 overflow-hidden text-[11px] leading-4 text-gray-500 dark:text-gray-400'}
          // No `title` when there is a real info hint: the browser draws its
          // own black tooltip from `title`, so the two would overlap saying
          // different things. The truncated sub-line still gets one when
          // there is no hint, since that is the only way to read it in full.
          title={subIsText && !info ? String(normalizedSub) : undefined}
        >
          {normalizedSub}
        </div>
      ) : null}
      {!trendNone ? (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold leading-4 ${trendUp ? 'text-green-600' : Number(trend) < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          <span>{trendUp ? '->' : Number(trend) < 0 ? '<-' : '--'}</span>
          <span>{Math.abs(Number(trend)).toFixed(1)}% vs prev period</span>
        </div>
      ) : null}
    </>
  )

  const hint = info ? (
    <InfoHint className="absolute right-0.5 top-0.5" label={infoLabel || String(label)} text={info} />
  ) : null

  // With a hint present the card becomes a container holding BOTH the hint
  // and a clickable region, rather than being one big <button>. InfoHint is
  // itself a <button>, and a button nested inside a button is invalid HTML --
  // the browser drops one of them, which silently breaks either the hint or
  // the drill-down.
  if (onClick && hint) {
    return (
      <div className={classNames}>
        {hint}
        <button type="button" onClick={onClick} className="flex min-w-0 flex-col gap-0 text-left">
          {content}
        </button>
      </div>
    )
  }

  return onClick ? (
    <button type="button" onClick={onClick} className={classNames}>
      {content}
    </button>
  ) : (
    <div className={classNames}>
      {hint}
      {content}
    </div>
  )
}
