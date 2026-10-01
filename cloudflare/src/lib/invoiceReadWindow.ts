import { localDateAtOrAfter, localDateAtOrBefore } from './businessDateWindow'
import { continuousReadWindowSql, parseContinuousReadWindow } from './continuousReadWindow'

export function invoiceReadWindow(column: string, query: Record<string, string | undefined>): { sql: string; params: Record<string, string> } {
  const from = String(query.from || '').slice(0, 10), to = String(query.to || '').slice(0, 10)
  if (query.startTime || query.endTime) throw new RangeError('Use paired continuous timestamps for invoice hours')
  const window = parseContinuousReadWindow(query)
  const dateClauses: string[] = [], params: Record<string, string> = {}
  if (from) { dateClauses.push(localDateAtOrAfter(column, '@from')); params.from = from }
  if (to) { dateClauses.push(localDateAtOrBefore(column, '@to')); params.to = to }
  if (!window) return { sql: dateClauses.join(' AND '), params }
  const validDay = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }
  if (!validDay(from) || !validDay(to) || from > to) throw new RangeError('Invoice hours require both valid ordered dates')
  Object.assign(params, window)
  const unknownClock = `length(trim(${column})) = 10 AND ${dateClauses.join(' AND ')}`
  const recordedClock = `length(trim(${column})) > 10 AND ${dateClauses.join(' AND ')} AND ${continuousReadWindowSql(column)}`
  return { sql: `((${unknownClock}) OR (${recordedClock}))`, params }
}
