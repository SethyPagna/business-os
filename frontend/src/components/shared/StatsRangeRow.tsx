import { type ReactNode } from 'react'
import DateTimeRangePicker, { type DateTimeRange } from './DateTimeRangePicker.tsx'

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
// It carries the compact Start → End date/time pill (the shared
// DateTimeRangePicker). The old Today / 7 Days / This Month / This Year preset
// chips were removed at the user's direction; every page starts on today and
// the picker is the one place to change the range. A page adopts it by rendering
// <StatsRangeRow> above its search bar and no longer passing range/
// onRangeChange to <StatsStrip> (StatsStrip only draws its own internal date
// row when a caller still passes those, which keeps not-yet-migrated callers
// working). An optional `actions` slot lets a page hang a fit-sized control
// (e.g. an Add button) on the tail of the row.

type TranslateFn = (key: string) => string | undefined

export default function StatsRangeRow({
  range,
  onRangeChange,
  t,
  actions,
  showTime = false,
  className = '',
}: {
  range: DateTimeRange
  onRangeChange: (range: DateTimeRange) => void
  t: TranslateFn
  /** Fit-sized trailing controls (e.g. an Add button) that share the row. */
  actions?: ReactNode
  /** Enable only when the backing endpoint stores timestamps and honors the
   * time bounds. Date-only ledgers must not advertise a fake time filter. */
  showTime?: boolean
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      {/* On small screens the Start→End picker takes the whole row; from `sm`
          up it shrinks back to the compact pill. */}
      <DateTimeRangePicker
        value={range}
        onChange={onRangeChange}
        t={t}
        showTime={showTime}
        className="w-full sm:w-auto"
        triggerClassName="flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 sm:inline-flex sm:w-auto sm:justify-start sm:gap-2.5 sm:px-4 sm:py-2.5 sm:min-w-[21rem]"
      />
      {actions ? (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div>
      ) : null}
    </div>
  )
}
