import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange, type DateTimeRangeSource } from './DateTimeRangePicker.tsx'
import { activeStatsPreset, statsPresetRange, STATS_PRESETS } from './statsStripPresets.ts'

type TranslateFn = (key: string) => string | undefined

/** One stable control row; presets remain reachable while Stats is folded. */
export default function StatsRangeRow({
  range, onRangeChange, t, leading, actions, showTime = false, continuous = false,
  showPresets = true, compactRange = false, className = '',
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
  className?: string
}) {
  const active = activeStatsPreset(range)
  return (
    <div className={`min-w-0 ${className}`}>
      {/* P9 (Sep 16 2026), owner verbatim on the live app/small screens: "the
          date start and date end are not responsive in the button row. too
          small and out of bounds." `flex-nowrap` used to force the picker to
          shrink to whatever sliver was left once `leading` (Stats chip) and
          `actions` (History/Export/etc, shrink-0) claimed their space -- on a
          360-400px phone that could be under 100px, and the trigger's own
          vw-based font clamp does not know its box got that narrow, so the
          text overflowed the row. `flex-wrap` + a real min-width on the
          picker fixes the root cause: the picker keeps a legible minimum
          width and, when the row is too narrow for everything, the ACTIONS
          wrap to their own line below it (ml-auto then re-centers them on
          that new line) -- the dates never shrink below readable, and never
          spill outside the row. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1" data-stats-range-controls>
        {leading}
        <DateTimeRangePicker
          value={range} onChange={onRangeChange} t={t} showTime={showTime} continuous={continuous}
          showCalendarIcon={false}
          compactTriggerLabels={compactRange}
          showQuickRanges={!showPresets}
          className="min-w-[10.5rem] flex-1"
          triggerClassName={compactRange
            ? 'flex h-10 !min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md px-1 py-0 text-[11px]'
            : 'flex h-10 !min-h-10 min-w-0 w-full items-center justify-center gap-1 rounded-md px-1 py-0 sm:gap-2 sm:px-3'}
        />
        {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div> : null}
      </div>
      {showPresets ? (
        <div className="stats-date-presets mt-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto overscroll-x-contain pb-1" data-date-presets>
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
      ) : null}
    </div>
  )
}
