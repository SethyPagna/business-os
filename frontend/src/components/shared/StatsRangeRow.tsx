import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange } from './DateTimeRangePicker.tsx'
import { statsPresetRange, activeStatsPreset, type StatsPresetKey } from './statsStripPresets.ts'

// The dedicated Start→End date-range row (user, Aug 31: "fish out the start
// date and end date from the stats button ... right above the search bar row
// ... applies to all section, mini sections, and pages"). The Start → End
// picker used to live INSIDE the folded StatsStrip, only visible once the
// Stats chip was opened; the user wanted it lifted out to be its own
// always-visible row directly above the search bar, while the Stats chip
// stays at the top and its cards still read this same range. Each page
// renders THIS component for that row so the control reads identically
// app-wide (the cross-surface rule).
//
// It carries the compact Start → End pill (the shared DateTimeRangePicker)
// plus the Today / 7 Days / This Month / This Year preset chips that snap the
// range — the same markup the strip used to render, verbatim, so relocating
// it changed placement only, not look. A page adopts it by rendering
// <StatsRangeRow> above its search bar and no longer passing range/
// onRangeChange to <StatsStrip> (StatsStrip only draws its own internal date
// row when a caller still passes those, which keeps not-yet-migrated callers
// working). An optional `actions` slot lets a page hang a fit-sized control
// (e.g. an Add button) on the tail of the row.

type TranslateFn = (key: string) => string | undefined

const PRESETS: Array<{ key: StatsPresetKey; langKey: string; fallback: string }> = [
  { key: 'today', langKey: 'range_today', fallback: 'Today' },
  { key: '7d', langKey: 'range_7d', fallback: '7 Days' },
  { key: 'month', langKey: 'range_this_month', fallback: 'This Month' },
  { key: 'year', langKey: 'range_this_year', fallback: 'This Year' },
]

export default function StatsRangeRow({
  range,
  onRangeChange,
  t,
  actions,
  className = '',
}: {
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange) => void
  t: TranslateFn
  /** Fit-sized trailing controls (e.g. an Add button) that share the row. */
  actions?: ReactNode
  className?: string
}) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const activePreset = activeStatsPreset(range)
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
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
      {actions ? (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div>
      ) : null}
    </div>
  )
}
