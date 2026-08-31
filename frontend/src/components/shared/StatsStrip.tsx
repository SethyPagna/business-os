import { useEffect, useState, type ReactNode } from 'react'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import DateTimeRangePicker, { type DateTimeRange } from './DateTimeRangePicker.tsx'
import InfoHint from './InfoHint.tsx'
import Modal from './Modal.tsx'

// THE stats surface for data pages (user, Aug 30: "for each of data full
// pages ... mini stats cards folded in them, to explain and show more
// stats ... based on date range. default per day ... do so for all
// pages"). The WHOLE stats block is folded behind a "Stats" chip —
// "stats should be folded into stats click to open" (user, Aug 31) —
// so a page opens compact: one row with the Stats chip, its secondary
// controls (History/Manage), and the page actions — all of which stay on
// that row whether the strip is folded or open. Clicking the chip opens
// the range row and the mini stat cards BELOW it; the cards WRAP instead
// of scrolling sideways — "should not do scroll in one row, can do 2 stats
// per row for smaller screens" (user, Aug 31) — 2-up on phones, widening
// with the viewport. Tapping a card opens ONE detail FLOAT (a Modal
// layered above the page) carrying that figure's explanation and its
// breakdown rows, rather than an inline panel that pushes the list down
// (user, Aug 31: "click to show details … a float above layer"). The strip
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
  summary,
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
  /** A one-line headline (e.g. "42 sales · $1,204") shown next to the Stats
   * chip and visible whether the cards are folded or open — "stats can show
   * outside button stats" (user, Aug 31): the key figure stays on screen
   * without opening the fold. */
  summary?: ReactNode
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
  // Closing the strip dismisses any open card float too, so reopening the
  // strip doesn't silently resurface a detail dialog the user had moved past.
  useEffect(() => {
    if (!statsOpen) setOpenKey(null)
  }, [statsOpen])
  // The secondary controls (History / Manage / Export) ALWAYS stay on the
  // Stats-chip row (row 1), whether the strip is folded or open (user, Aug 31:
  // "move [the buttons] to same row as the stats so when stat button expands
  // it doesn't affect"). They used to relocate onto the cards row on expand,
  // which shifted them under the user mid-interaction; anchoring them to the
  // chip row keeps them put. The date row and cards row therefore carry only
  // their own content.

  return (
    <div className={`min-w-0 ${className}`}>
      {/* Row 1 (always): the Stats chip + the secondary controls (History/
          Manage/Export) + the PRIMARY page actions. Everything on this row
          stays put whether the strip is folded or open — expanding the strip
          only adds rows BELOW it, it never relocates these controls. */}
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
        {summary ? (
          <span className="min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">{summary}</span>
        ) : null}
        {rangeActions || actions ? (
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            {rangeActions}
            {actions}
          </div>
        ) : null}
      </div>

      {statsOpen && range && onRangeChange ? (
        // The date row carries the picker + its presets, sized to content and
        // left-aligned (the dashboard shape: picker then preset chips, spare
        // width trailing). The secondary buttons live on the chip row above,
        // not here — expanding the strip never moves them (user, Aug 31).
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          <DateTimeRangePicker value={range} onChange={onRangeChange} t={t} showTime={false} />
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onRangeChange(statsPresetRange(preset.key))}
              className={`inline-flex rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
                activePreset === preset.key
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
              }`}
            >
              {tr(preset.langKey, preset.fallback)}
            </button>
          ))}
        </div>
      ) : null}

      {statsOpen ? (
        // ONE cards row for every card count. Each card is sized to its own
        // content (2-up on phones via w-[calc(50%-…)], ~10rem from sm up),
        // wrapping — never stretched across a fixed grid that leaves empty
        // tracks, and never a sideways scroll (user, Aug 31). A card with a
        // breakdown opens it as a FLOAT (Modal) above the page rather than an
        // inline panel that pushes the list down (user, Aug 31: "instead of
        // expand options … click to show details another page … a float above
        // layer so it doesn't push down other details").
        <div className="mt-1.5 flex min-w-0 flex-wrap items-stretch gap-1.5">
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
                className={`flex w-[calc(50%-0.375rem)] min-w-0 flex-col rounded-lg border px-2 py-1 text-left transition-colors sm:w-40 ${
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
        // The breakdown opens as a floating dialog (Modal, portalled to
        // document.body) so it layers ABOVE the page instead of expanding
        // inline and shoving the list down (user, Aug 31). Closing it or the
        // ✕ clears the open card.
        <Modal
          title={(
            <span className="flex items-center gap-1.5">
              <span className="text-base font-bold text-gray-900 dark:text-white">{openCard.label}</span>
              {openCard.hint ? <InfoHint label={openCard.label} text={openCard.hint} /> : null}
            </span>
          )}
          onClose={() => setOpenKey(null)}
          size="sm"
          draggable
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {(openCard.details || []).map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-gray-100 py-1 last:border-b-0 dark:border-gray-700">
                <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{detail.label}</span>
                <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${detail.tone ? DETAIL_TONE[detail.tone] : 'text-gray-800 dark:text-gray-100'}`}>{detail.value}</span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
