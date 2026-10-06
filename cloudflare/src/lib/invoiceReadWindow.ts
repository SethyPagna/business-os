import { isIsoCalendarDay, localDateAtOrAfter, localDateAtOrBefore, localDateExpr } from './businessDateWindow'
import { continuousReadWindowSql, parseContinuousReadWindow } from './continuousReadWindow'

export function invoiceReadWindow(column: string, query: Record<string, string | undefined>): { sql: string; params: Record<string, string> } {
  const from = String(query.from || '').slice(0, 10), to = String(query.to || '').slice(0, 10)
  if (query.startTime || query.endTime) throw new RangeError('Use paired continuous timestamps for invoice hours')
  const window = parseContinuousReadWindow(query)
  const dateClauses: string[] = [], params: Record<string, string> = {}
  if (from) { dateClauses.push(localDateAtOrAfter(column, '@from')); params.from = from }
  if (to) { dateClauses.push(localDateAtOrBefore(column, '@to')); params.to = to }
  if (!window) return { sql: dateClauses.join(' AND '), params }
  if (!isIsoCalendarDay(from) || !isIsoCalendarDay(to) || from > to) throw new RangeError('Invoice hours require both valid ordered dates')
  Object.assign(params, window)
  const unknownClock = `length(trim(${column})) = 10 AND ${dateClauses.join(' AND ')}`
  const recordedDay = localDateExpr(column)
  const recordedClock = `length(trim(${column})) > 10 AND ${recordedDay} >= @from AND ${recordedDay} <= @to AND ${continuousReadWindowSql(column)}`
  return { sql: `((${unknownClock}) OR (${recordedClock}))`, params }
}
