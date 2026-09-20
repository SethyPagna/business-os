import { reportUtcBound } from '../components/sales/reports/reportModel.ts'

export type ReturnsStatementRange = {
  startDate: string
  endDate: string
  startTime?: string
  endTime?: string
}

/** Frontend counterpart of returnExportWindow; shared parity vectors test both.
 * Custom dates are primary. Presets need not be aligned to calendar blocks. */
export function returnsStatementParams(range: ReturnsStatementRange): Record<string, string> {
  // Make the existing reportUtcBound Date.UTC domain explicit on both sides.
  if (![range.startDate, range.endDate].every(value => /^(?:0[1-9]\d{2}|[1-9]\d{3})-\d{2}-\d{2}$/.test(value))) {
    throw new RangeError('Return statement business dates must use years 0100 through 9999')
  }
  const startTime = range.startTime || '00:00', endTime = range.endTime || '23:59'
  const createdFrom = reportUtcBound(range.startDate, startTime)
  const createdTo = reportUtcBound(range.endDate, endTime, 1)
  if (!createdFrom || !createdTo || createdFrom >= createdTo) {
    throw new RangeError('A valid start and end date/time are required for a return statement')
  }
  const localStart = new Date(`${range.startDate}T${startTime}:00Z`)
  const anniversary = new Date(localStart.getTime())
  const month = anniversary.getUTCMonth()
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0)
  const localEndExclusive = Date.parse(`${range.endDate}T${endTime}:00Z`) + 60000
  if (localEndExclusive > anniversary.getTime()) {
    throw new RangeError('Return statements may cover at most one calendar year; use separate downloads for longer periods')
  }
  return { startDate: range.startDate, endDate: range.endDate, createdFrom, createdTo }
}
