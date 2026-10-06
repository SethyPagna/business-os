import { isIsoCalendarDay } from './businessDateWindow'

export type ContinuousReadWindow = { createdFrom: string; createdTo: string }

export function parseContinuousReadWindow(query: Record<string, string | undefined>): ContinuousReadWindow | null {
  const from = String(query.createdFrom || '').trim()
  const to = String(query.createdTo || '').trim()
  if (!from && !to) return null
  if (!from || !to) throw new RangeError('createdFrom and createdTo must be provided together')
  if (query.startTime || query.endTime) throw new RangeError('Continuous timestamps and recurring hours cannot be combined')
  const bound = (value: string): string => {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?([zZ]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value)
    if (!match) throw new RangeError('createdFrom and createdTo must be valid timestamps')
    if (!isIsoCalendarDay(match[1])) throw new RangeError('createdFrom and createdTo must contain valid dates')
    const parsed = new Date(match[2] ? value.replace(' ', 'T') : `${value.replace(' ', 'T')}Z`)
    if (!Number.isFinite(parsed.getTime())) throw new RangeError('createdFrom and createdTo must be valid timestamps')
    return parsed.toISOString().slice(0, 19).replace('T', ' ')
  }
  const createdFrom = bound(from), createdTo = bound(to)
  if (createdFrom >= createdTo) throw new RangeError('createdTo must be after createdFrom')
  return { createdFrom, createdTo }
}

export function continuousReadWindowSql(column: string): string {
  return `datetime(${column}) >= @createdFrom AND datetime(${column}) < @createdTo`
}
