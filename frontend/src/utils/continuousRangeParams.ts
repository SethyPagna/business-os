import { reportUtcBound } from './businessTimeBounds.ts'

export type ContinuousRange = { startDate?: string; endDate?: string; startTime?: string; endTime?: string }

export function continuousRangeParams(range: ContinuousRange): { startDate?: string; endDate?: string; createdFrom?: string; createdTo?: string } {
  const startDate = String(range.startDate || '').trim(), endDate = String(range.endDate || '').trim()
  const params: { startDate?: string; endDate?: string; createdFrom?: string; createdTo?: string } = {
    ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}),
  }
  if (!range.startTime && !range.endTime) return params
  if (!startDate || !endDate) throw new RangeError('Continuous hours require both dates')
  const createdFrom = reportUtcBound(startDate, range.startTime || '00:00')
  const createdTo = reportUtcBound(endDate, range.endTime || '23:59', 1)
  if (!createdFrom || !createdTo || createdFrom >= createdTo) throw new RangeError('A valid ordered date/time range is required')
  return { ...params, createdFrom, createdTo }
}
