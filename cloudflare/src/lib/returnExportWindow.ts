/** Export-only admission. Ordinary Returns list/report ranges remain unchanged. */
export type ReturnExportWindow = { createdFrom: string; createdTo: string }
const BUSINESS_OFFSET_MS = 7 * 60 * 60 * 1000

function dateMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms)
    || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new RangeError('A valid start and end date are required for a return statement')
  }
  return ms
}

function exactMs(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:00(?:[zZ]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value)
  if (!match) throw new RangeError('Return statement bounds must be valid minute-aligned timestamps')
  dateMs(match[1])
  const iso = value.replace(' ', 'T')
  const ms = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
  if (!Number.isFinite(ms)) throw new RangeError('Invalid return statement timestamp')
  return ms
}

function sqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Full days include the selected final day; exact createdTo is the exclusive
 * minute after the selected end minute. Compare the SQL interval itself.
 * A leap-day anniversary clamps to February 28, never overflows into March.
 */
export function returnExportWindow(query: Record<string, string>): ReturnExportWindow {
  const startDate = String(query.startDate || '').trim()
  const endDate = String(query.endDate || '').trim()
  const startDay = dateMs(startDate), endDay = dateMs(endDate)
  if (startDay > endDay) throw new RangeError('Return statement end date must not precede its start date')
  if (query.startTime || query.endTime) throw new RangeError('Use paired createdFrom and createdTo for statement times')
  const from = String(query.createdFrom || '').trim(), to = String(query.createdTo || '').trim()
  if (!!from !== !!to) throw new RangeError('Statement createdFrom and createdTo must be provided together')
  const start = from ? exactMs(from) : startDay - BUSINESS_OFFSET_MS
  const end = to ? exactMs(to) : endDay + 86400000 - BUSINESS_OFFSET_MS
  if (end <= start) throw new RangeError('Return statement end must be after its start')
  const localStart = new Date(start + BUSINESS_OFFSET_MS)
  const localEndMinute = new Date(end - 60000 + BUSINESS_OFFSET_MS)
  if (localStart.toISOString().slice(0, 10) !== startDate || localEndMinute.toISOString().slice(0, 10) !== endDate) {
    throw new RangeError('Statement dates must match the exact business-time interval')
  }
  const anniversary = new Date(localStart.getTime())
  const month = anniversary.getUTCMonth()
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0)
  if (end + BUSINESS_OFFSET_MS > anniversary.getTime()) {
    throw new RangeError('Return statements may cover at most one calendar year; use separate downloads for longer periods')
  }
  return { createdFrom: sqlUtc(start), createdTo: sqlUtc(end) }
}
