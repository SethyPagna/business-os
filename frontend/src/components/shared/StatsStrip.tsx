import { useState, type ReactNode } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import DateTimeRangePicker, { type DateTimeRange, EMPTY_DATE_TIME_RANGE } from './DateTimeRangePicker.tsx'
import InfoHint from './InfoHint.tsx'

// THE stats surface for data pages (user, Aug 30: "for each of data full
// pages ... mini stats cards folded in them, to explain and show more
// stats ... based on date range. default per day ... do so for all
// pages"). The WHOLE stats block is folded behind a "Stats" chip —
// "stats should be folded into stats click to open" (user, Aug 31) —
// so a page opens compact: one row with the Stats chip and the page
// actions, nothing else. Clicking the chip opens the range row and the
// mini stat cards; the cards WRAP instead of scrolling sideways —
// "should not do scroll in one row, can do 2 stats per row for smaller
// screens" (user, Aug 31) — 2-up on phones, widening with the
// viewport. Tapping a card folds open ONE detail panel below the grid
// carrying that figure's explanation and its breakdown rows. The strip
// is driven by a date range whose default is per-day (today). Every
// data page renders THIS component rather than its own tile grid, so
// stats read identically app-wide (the cross-surface rule); pages with
// an existing page-level range (Dashboard) pass no range props and
// keep their own control.

type TranslateFn = (key: string) => string | undefined

export interface StatDetail {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'crit' | 'muted'
}

export interface StatCardDef {
  key: string
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'ok' | 'warn' | 'crit' | 'accent'
  /** Plain-English explanation shown at the top of the fold (and as the
   * card's info affordance for screen readers). */
  hint?: string
  /** Breakdown rows revealed when the card folds open. A card with no
   * details renders as a plain (non-folding) figure. */
  details?: StatDetail[]
  /** Percent change vs the previous period (Dashboard-style); rendered as
   * a small signed line under the value. */
  trend?: number | null
}

export { statsPresetRange, activeStatsPreset, type StatsPresetKey } from './statsStripPresets.ts'
import { statsPresetRange, activeStatsPreset, type StatsPresetKey } from './statsStripPresets.ts'

const PRESETS: Array<{ key: StatsPresetKey; langKey: string; fallback: string }> = [
  { key: 'today', langKey: 'range_today', fallback: 'Today' },
  { key: '7d', langKey: 'range_7d', fallback: '7 Days' },
  { key: 'month', langKey: 'range_this_month', fallback: 'This Month' },
  { key: 'year', langKey: 'range_this_year', fallback: 'This Year' },
]

const VALUE_TONE: Record<NonNullable<StatCardDef['tone']>, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  crit: 'text-red-600 dark:text-red-400',
  accent: 'text-blue-600 dark:text-blue-400',
}

const DETAIL_TONE: Record<NonNullable<StatDetail['tone']>, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  crit: 'text-red-600 dark:text-red-400',
  muted: 'text-gray-500 dark:text-gray-400',
}

export default function StatsStrip({
  cards,
  t,
  loading = false,
  range,
  onRangeChange,
  actions,
  rangeActions,
  className = '',
}: {
  cards: StatCardDef[]
  t: TranslateFn
  loading?: boolean
  /** Omit both range props to control the range from the page (Dashboard). */
  range?: DateTimeRange
  onRangeChange?: (range: DateTimeRange) => void
  /** PRIMARY page actions (Add buttons) — always on the chip row, so the
   * page's main action stays reachable whether stats are open or folded
   * ("make add button clear", user Aug 31: explicit labels, always
   * visible). */
  actions?: ReactNode
  /** SECONDARY controls (History / Export / Manage). Folded: they sit on
   * the chip row beside `actions`. Open: they move to the dedicated
   * full-width date row ("start and end date can do one row fully plus
   * history icon/button — make use of full row", user Aug 31) — UNLESS the
   * page has only a few stat cards (≤3), in which case they merge into the
   * stats row instead ("if stats are not many like only two, no need merge
   * the history/export buttons in date, just merge with the stats"). */
  rangeActions?: ReactNode
  className?: string
}) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  // The whole stats block is folded until the Stats chip is clicked
  // ("click to open", user Aug 31). Default closed on every mount so
  // pages open compact.
  const [statsOpen, setStatsOpen] = useState(false)
  // ONE fold open at a time; tapping the open card closes it.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const openCard = cards.find((card) => card.key === openKey && card.details?.length) || null
  const activePreset = range ? activeStatsPreset(range) : null

  return (
    <div className={`min-w-0 ${className}`}>
      {/* Row 1 (always): the Stats chip + page actions — actions stay
          reachable while stats are folded. When open, the range picker +
          presets join this same row ("the date start and end date is one
          row with the add buttons, to save space", user Aug 30). */}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <button
          type="button"
          aria-expanded={statsOpen}
          onClick={() => setStatsOpen((current) => !current)}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
            statsOpen
              ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 shrink-0" />
          {tr('stats', 'Stats')}
        </button>
        {statsOpen && range && onRangeChange ? (
          <>
            <DateTimeRangePicker value={range} onChange={onRangeChange} t={t} showTime={false} />
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onRangeChange(statsPresetRange(preset.key))}
                className={`hidden rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors sm:inline-flex ${
                  activePreset === preset.key
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
                }`}
              >
                {tr(preset.langKey, preset.fallback)}
              </button>
            ))}
          </>
        ) : null}
        {actions ? <div className="ml-auto flex min-w-0 items-center gap-1">{actions}</div> : null}
      </div>

      {statsOpen ? (
      // The cards WRAP — 2 per row on phones, widening with the viewport;
      // never a sideways scroll (user, Aug 31).
      <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {cards.map((card) => {
            const foldable = Boolean(card.details?.length)
            const isOpen = openKey === card.key && foldable
            return (
              <button
                key={card.key}
                type="button"
                disabled={!foldable}
                aria-expanded={foldable ? isOpen : undefined}
                onClick={() => setOpenKey((current) => (current === card.key ? null : card.key))}
                className={`flex min-w-0 flex-col rounded-lg border px-2 py-1 text-left transition-colors ${
                  isOpen
                    ? 'border-blue-300 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/40'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
                } ${foldable ? 'cursor-pointer hover:border-blue-300 dark:hover:border-blue-700' : 'cursor-default'}`}
              >
                <span className="flex items-center gap-1 text-[10.5px] font-medium leading-4 text-gray-500 dark:text-gray-400">
                  {card.label}
                  {foldable ? (
                    <ChevronDown className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  ) : null}
                </span>
                <span className={`max-w-full truncate text-[15px] font-bold leading-5 tracking-tight ${loading ? 'animate-pulse text-gray-300 dark:text-gray-600' : (card.tone ? VALUE_TONE[card.tone] : 'text-gray-900 dark:text-white')}`}>
                  {loading ? '···' : card.value}
                </span>
                {card.sub ? (
                  <span className="max-w-full truncate text-[10px] leading-3.5 text-gray-400 dark:text-gray-500">{card.sub}</span>
                ) : null}
                {typeof card.trend === 'number' ? (
                  <span className={`text-[10px] font-semibold leading-3.5 ${card.trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : card.trend < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}`}>
                    {card.trend > 0 ? '+' : ''}{card.trend.toFixed(1)}%
                  </span>
                ) : null}
              </button>
            )
          })}
      </div>
      ) : null}

      {statsOpen && openCard ? (
        <div className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-blue-200 bg-blue-50/40 px-3 py-2 dark:border-blue-900/50 dark:bg-blue-950/20">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{openCard.label}</span>
            {openCard.hint ? (
              <InfoHint label={openCard.label} text={openCard.hint} />
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
            {(openCard.details || []).map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-blue-100/70 py-0.5 last:border-b-0 dark:border-blue-900/30">
                <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{detail.label}</span>
                <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${detail.tone ? DETAIL_TONE[detail.tone] : 'text-gray-800 dark:text-gray-100'}`}>{detail.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
