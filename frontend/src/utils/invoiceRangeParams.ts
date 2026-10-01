import { continuousRangeParams, type ContinuousRange } from './continuousRangeParams.ts'

export function invoiceRangeParams(range: ContinuousRange): { from: string; to: string; createdFrom?: string; createdTo?: string } {
  const from = String(range.startDate || '').trim(), to = String(range.endDate || '').trim()
  const startTime = range.startTime || '00:00', endTime = range.endTime || '23:59'
  if (startTime === '00:00' && endTime === '23:59') return { from, to }
  const { createdFrom, createdTo } = continuousRangeParams({ startDate: from, endDate: to, startTime, endTime })
  return { from, to, createdFrom, createdTo }
}
