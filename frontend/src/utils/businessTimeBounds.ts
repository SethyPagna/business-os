// Business-time -> UTC bound shared by the Reports model and the API
// transports (fees, returns). It lives in this dependency-free leaf, pinned to
// the always-loaded 'shared-formatters' chunk (build/chunkBoundaries.ts),
// because importing it from reportModel.ts made Rollup hoist the whole
// Reports model plus financialPrecision into the 'returns-read-api' manual
// chunk -- and the storefront's boot path then fetched that chunk for this one
// function (perf-budget.spec.ts "requests before the storefront paints").

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const BUSINESS_UTC_OFFSET_HOURS = 7

/**
 * Convert one Cambodia wall-clock minute to the canonical UTC timestamp shape
 * accepted by SalesFilters.createdFrom/createdTo. The conversion is fixed at
 * UTC+07 and never depends on the browser/device timezone.
 */
export function reportUtcBound(date: string, time: string, plusMinutes = 0): string | null {
  const dateMatch = DATE_RE.exec(date)
  const timeMatch = CLOCK_RE.exec(time)
  if (!dateMatch || !timeMatch || !Number.isInteger(plusMinutes)) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const dateProbe = new Date(Date.UTC(year, month - 1, day))
  if (dateProbe.getUTCFullYear() !== year || dateProbe.getUTCMonth() !== month - 1 || dateProbe.getUTCDate() !== day) return null
  const utc = new Date(Date.UTC(year, month - 1, day, hour - BUSINESS_UTC_OFFSET_HOURS, minute + plusMinutes, 0))
  return utc.toISOString().slice(0, 19).replace('T', ' ')
}
