import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange, type DateTimeRangeSource } from './DateTimeRangePicker.tsx'
import { activeStatsPreset, statsPresetRange, STATS_PRESETS } from './statsStripPresets.ts'
import ChipRail, { RailChip } from './kit/ChipRail.tsx'

type TranslateFn = (key: string) => string | undefined

/** One stable control row; presets remain reachable while Stats is folded. */
export default function StatsRangeRow({
  range, onRangeChange, t, leading, actions, showTime = false, continuous = false,
  showPresets = true, compactRange = false, layout = 'wrap', disabled = false, className = '',
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
  /** Dates and presets stay visible but inert; `leading` and `actions` keep working. */
  disabled?: boolean
  className?: string
}) {
  const active = activeStatsPreset(range)
  const scrolling = layout === 'scroll'
  const quickRangeLabel = t('quick_range')
  const presetChips = STATS_PRESETS.map(({ id, key, fallback }) => {
    const label = t(key)
    return (
      <RailChip key={id} selected={active === id} disabled={disabled}
        onClick={() => {
          const next = statsPresetRange(id)
          onRangeChange(showTime ? next : { ...next, startTime: '', endTime: '' }, id)
        }}>
        {label && label !== key ? label : fallback}
      </RailChip>
    )
  })
  const presetLabel = quickRangeLabel && quickRangeLabel !== 'quick_range' ? quickRangeLabel : 'Quick range'
  const presets = showPresets ? (
    scrolling
      ? <div className="flex shrink-0 flex-nowrap gap-1" data-date-presets>{presetChips}</div>
      : <ChipRail label={presetLabel} className="mt-1" data-date-presets>{presetChips}</ChipRail>
  ) : null
  const rangeLabel = t('date_time_range')
  const controls = (
    <>
      {/* Existing action-heavy callers wrap so dates retain a readable minimum width. */}
      {leading}
      <DateTimeRangePicker
        value={range} onChange={onRangeChange} t={t} showTime={showTime} continuous={continuous} disabled={disabled}
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
    </>
  )
  return (
    <div className={`min-w-0 ${className}`}>
      {scrolling
        ? <ChipRail label={rangeLabel && rangeLabel !== 'date_time_range' ? rangeLabel : 'Date range'} className="[--chip-rail-h:2.5rem]" data-stats-range-controls>{controls}</ChipRail>
        : <div className="flex min-w-0 flex-wrap items-center gap-1" data-stats-range-controls>{controls}</div>}
      {!scrolling ? presets : null}
    </div>
  )
}
