import { reportUtcBound } from '../../utils/businessTimeBounds.ts'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

export type DashboardRangeQuery = { startDate: string; endDate: string; createdFrom?: string; createdTo?: string }

function utcMinute(date: string, time: string, end = false): string {
  if (date < '1970-01-01' || date > '2999-12-31') throw new RangeError('Invalid dashboard date')
  const bound = reportUtcBound(date, time, end ? 1 : 0)
  if (!bound) throw new RangeError('Invalid dashboard date/time')
  return bound
}

export function dashboardRangeQuery(range: DateTimeRange): DashboardRangeQuery {
  const { startDate, endDate } = range
  const startTime = range.startTime || '00:00'
  const endTime = range.endTime || '23:59'
  if (!startDate && !endDate && !range.startTime && !range.endTime) return { startDate, endDate }
  const createdFrom = utcMinute(startDate, startTime)
  const createdTo = utcMinute(endDate, endTime, true)
  if (createdFrom >= createdTo) throw new RangeError('Dashboard end date/time must not precede start')
  return startTime === '00:00' && (endTime === '23:59' || endTime === '24:00')
    ? { startDate, endDate }
    : { startDate, endDate, createdFrom, createdTo }
}

export function dashboardRangeLabel(range: DateTimeRange): string {
  if (!range.startTime && !range.endTime) return `${range.startDate || '…'} - ${range.endDate || '…'}`
  return `${range.startDate} ${range.startTime || '00:00'} - ${range.endDate} ${range.endTime || '23:59'} (UTC+7)`
}
