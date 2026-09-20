import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'

export type DashboardRangeQuery = { startDate: string; endDate: string; createdFrom?: string; createdTo?: string }

function utcMinute(date: string, time: string, end = false): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('Invalid dashboard date/time')
  const probe = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(probe.getTime()) || probe.toISOString().slice(0, 10) !== date || date < '1970-01-01' || date > '2999-12-31') throw new RangeError('Invalid dashboard date')
  // Fixed business UTC+7, independent of the browser's timezone. End minute
  // includes its seconds, represented by an exclusive next-minute boundary.
  const instant = Date.parse(`${date}T${time}:00+07:00`) + (end ? 60_000 : 0)
  return new Date(instant).toISOString().slice(0, 19).replace('T', ' ')
}

export function dashboardRangeQuery(range: DateTimeRange): DashboardRangeQuery {
  const { startDate, endDate } = range
  const startTime = range.startTime || '00:00'
  const endTime = range.endTime || '23:59'
  if (!startDate && !endDate && !range.startTime && !range.endTime) return { startDate, endDate }
  const createdFrom = utcMinute(startDate, startTime)
  const createdTo = utcMinute(endDate, endTime, true)
  if (createdFrom >= createdTo) throw new RangeError('Dashboard end date/time must not precede start')
  return startTime === '00:00' && endTime === '23:59'
    ? { startDate, endDate }
    : { startDate, endDate, createdFrom, createdTo }
}

export function dashboardRangeLabel(range: DateTimeRange): string {
  if (!range.startTime && !range.endTime) return `${range.startDate || '…'} - ${range.endDate || '…'}`
  return `${range.startDate} ${range.startTime || '00:00'} - ${range.endDate} ${range.endTime || '23:59'} (UTC+7)`
}
