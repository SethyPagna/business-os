import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange } from './DateTimeRangePicker.tsx'
import { activeStatsPreset, statsPresetRange, STATS_PRESETS } from './statsStripPresets.ts'

type TranslateFn = (key: string) => string | undefined

/** One stable control row; presets remain reachable while Stats is folded. */
export default function StatsRangeRow({
  range, onRangeChange, t, leading, actions, showTime = false,
  showPresets = true, className = '',
}: {
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange) => void
  t: TranslateFn
  leading?: ReactNode
  actions?: ReactNode
  showTime?: boolean
  showPresets?: boolean
  className?: string
}) {
  const active = activeStatsPreset(range)
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex min-w-0 flex-nowrap items-center gap-1" data-stats-range-controls>
        {leading}
        <DateTimeRangePicker
          value={range} onChange={onRangeChange} t={t} showTime={showTime}
          className="min-w-0 flex-1"
          triggerClassName="flex h-10 !min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md px-1 py-0 sm:gap-2 sm:px-3"
        />
        {actions ? <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1">{actions}</div> : null}
      </div>
      {showPresets ? (
        <div className="mt-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto overscroll-x-contain pb-1" data-date-presets>
          {STATS_PRESETS.map(({ id, key, fallback }) => {
            const label = t(key)
            return (
              <button key={id} type="button" aria-pressed={active === id}
                className={`h-10 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${active === id ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}
                onClick={() => {
                  const next = statsPresetRange(id)
                  onRangeChange(showTime ? next : { ...next, startTime: '', endTime: '' })
                }}>
                {label && label !== key ? label : fallback}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
