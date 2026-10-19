import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange, type DateTimeRangeSource } from './DateTimeRangePicker.tsx'
import { activeStatsPreset, statsPresetRange, STATS_PRESETS } from './statsStripPresets.ts'

type TranslateFn = (key: string) => string | undefined

/** One stable control row; presets remain reachable while Stats is folded. */
export default function StatsRangeRow({
  range, onRangeChange, t, leading, actions, showTime = false, continuous = false,
  showPresets = true, compactRange = false, layout = 'wrap', className = '',
}: {
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange, source?: DateTimeRangeSource) => void
  t: TranslateFn
  leading?: ReactNode
  actions?: ReactNode
  showTime?: boolean
  continuous?: boolean
  showPresets?: boolean
  compactRange?: boolean
  layout?: 'wrap' | 'scroll'
  className?: string
}) {
  const active = activeStatsPreset(range)
  const scrolling = layout === 'scroll'
  const presets = showPresets ? (
    <div className={scrolling ? 'flex shrink-0 flex-nowrap gap-1' : 'stats-date-presets mt-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto overscroll-x-contain pb-1'} data-date-presets>
      {STATS_PRESETS.map(({ id, key, fallback }) => {
        const label = t(key)
        return (
          <button key={id} type="button" aria-pressed={active === id}
            className={`h-10 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${active === id ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}
            onClick={() => {
              const next = statsPresetRange(id)
              onRangeChange(showTime ? next : { ...next, startTime: '', endTime: '' }, id)
            }}>
            {label && label !== key ? label : fallback}
          </button>
        )
      })}
    </div>
  ) : null
  return (
    <div className={`min-w-0 ${className}`}>
      {/* Existing action-heavy callers wrap so dates retain a readable minimum width. */}
      <div className={scrolling ? 'stats-date-presets flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain pb-1' : 'flex min-w-0 flex-wrap items-center gap-1'} data-stats-range-controls>
        {leading}
        <DateTimeRangePicker
          value={range} onChange={onRangeChange} t={t} showTime={showTime} continuous={continuous}
          showCalendarIcon={false}
          compactTriggerLabels={compactRange}
          showQuickRanges={!showPresets}
          className={scrolling ? 'w-56 min-w-[14rem] shrink-0' : 'min-w-[10.5rem] flex-1'}
          triggerClassName={compactRange
            ? 'flex h-10 !min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md px-1 py-0 text-[11px]'
            : 'flex h-10 !min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md px-1 py-0 sm:gap-2 sm:px-3'}
        />
        {scrolling ? presets : null}
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div> : null}
      </div>
      {!scrolling ? presets : null}
    </div>
  )
}
