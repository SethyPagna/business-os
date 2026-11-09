// What the CLOSED date-range trigger prints for each endpoint. Pure and free of
// .tsx imports so the node test runner can pin it without mounting the picker.
//
// A surface that filters by time (`showTime`) must show that time next to the
// date on the button the user actually sees: "04/11/2026 00:00 -> 04/11/2026
// 23:59". Dropping the time from the button (Sep 20) left Dashboard, Sales,
// Returns and every other timed page looking date-only while they filtered by
// hour. Range values are wall-clock strings in business time already, so they
// are printed as typed -- never pushed through an instant formatter, which
// would shift them by the viewer's zone.

import { fmtDateOnly } from '../../utils/formatters.ts'
import type { DateTimeRange } from './statsStripPresets.ts'

export const DATE_PLACEHOLDER = 'DD/MM/YYYY'
export const TIME_PLACEHOLDER = 'HH:MM'
// A blank side of a picked range means the day's edges: the same defaults the
// picker's own validation and every range reader apply (00:00, and 23:59 as
// the last minute of the end day).
export const START_OF_DAY = '00:00'
export const END_OF_DAY = '23:59'

export interface TriggerEndpoint {
  date: string
  /** '' when the surface does not filter by time. */
  time: string
}

function clock(raw: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
}

function endpoint(date: string, time: string, blankTime: string, showTime: boolean): TriggerEndpoint {
  const printedDate = date ? fmtDateOnly(date) : DATE_PLACEHOLDER
  if (!showTime) return { date: printedDate, time: '' }
  const printedTime = clock(time)
  if (printedTime) return { date: printedDate, time: printedTime }
  return { date: printedDate, time: date ? blankTime : TIME_PLACEHOLDER }
}

export function rangeTriggerEndpoints(
  value: DateTimeRange,
  showTime: boolean,
): { start: TriggerEndpoint; end: TriggerEndpoint } {
  return {
    start: endpoint(value.startDate, value.startTime, START_OF_DAY, showTime),
    end: endpoint(value.endDate, value.endTime, END_OF_DAY, showTime),
  }
}
