type AnyRow = Record<string, any>

export interface TimeParts {
  date: Date | null
  year: number | ''
  month: number | ''
  day?: number
  yearLabel: string
  monthLabel: string
  monthKey: string
  dayKey: string
  dayLabel: string
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct
  const isoLike = raw.replace(' ', 'T')
  const normalizedIso = /[+-]\d{2}$/i.test(isoLike)
    ? `${isoLike}:00`
    : /[+-]\d{4}$/i.test(isoLike)
      ? isoLike.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
      : isoLike
  const parsedIso = new Date(normalizedIso)
  if (!Number.isNaN(parsedIso.getTime())) return parsedIso
  const needsUtcSuffix = !/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$|[+-]\d{2}$/.test(normalizedIso)
  const parsedUtc = new Date(needsUtcSuffix ? `${normalizedIso}Z` : normalizedIso)
  return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc
}

export function getTimeParts(value: unknown): TimeParts {
  const parsed = toDate(value)
  if (!parsed) {
    return {
      date: null,
      year: '',
      month: '',
      yearLabel: 'Unknown year',
      monthLabel: 'Unknown month',
      monthKey: 'unknown-month',
      dayKey: 'unknown-day',
      dayLabel: 'Unknown day',
    }
  }

  const year = parsed.getFullYear()
  const month = parsed.getMonth() + 1
  const day = parsed.getDate()

  return {
    date: parsed,
    year,
    month,
    day,
    yearLabel: String(year),
    monthLabel: parsed.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    // dd/mm/yyyy day-first (Sep 4 2026). dayKey/monthKey above stay ISO --
    // they are sort and grouping keys, not display text.
    dayLabel: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
  }
}

export type MultiFilterValue = 'all' | string | number | Array<string | number> | Set<string | number> | null | undefined

/**
 * Normalizes a filter value into either `null` (meaning "no constraint",
 * i.e. 'all') or a Set of string tokens to match against with OR semantics.
 * Accepts the legacy single-value shape ('all' | string | number) as well
 * as an array or Set of values, so existing single-select callers keep
 * working unchanged while new multi-select UIs can pass multiple values.
 */
export function toMultiFilterSet(value: MultiFilterValue): Set<string> | null {
  if (value == null || value === 'all') return null
  if (value instanceof Set) {
    if (!value.size) return null
    return new Set([...value].map((entry) => String(entry)))
  }
  if (Array.isArray(value)) {
    if (!value.length) return null
    return new Set(value.map((entry) => String(entry)))
  }
  return new Set([String(value)])
}

function normalizeMonthToken(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const num = Number(raw)
  if (Number.isFinite(num) && num >= 1 && num <= 12) return String(num).padStart(2, '0')
  return raw
}

export function matchesYearMonthFilters(
  value: unknown,
  { year = 'all', month = 'all' }: { year?: MultiFilterValue; month?: MultiFilterValue } = {},
): boolean {
  const parts = getTimeParts(value)
  const yearSet = toMultiFilterSet(year)
  const monthSet = toMultiFilterSet(month)
  if (yearSet && !yearSet.has(String(parts.yearLabel))) return false
  if (monthSet) {
    // monthSet entries may come in as '01'-'12' (zero-padded, e.g. from
    // CREATED_MONTH_OPTIONS) while parts.month is a raw 1-12 number; compare
    // using a normalized zero-padded token on both sides so single-digit
    // months (Jan-Sep) match correctly instead of silently never matching.
    const normalizedMonthSet = new Set([...monthSet].map(normalizeMonthToken))
    if (!normalizedMonthSet.has(normalizeMonthToken(parts.month))) return false
  }
  return true
}

export function getAvailableYears<T extends AnyRow = AnyRow>(
  items: T[] = [],
  getDate: (item: T) => unknown = (item) => item?.created_at,
): string[] {
  const years = new Set<string>()
  for (const item of Array.isArray(items) ? items : []) {
    const parts = getTimeParts(getDate(item))
    if (parts.yearLabel && parts.yearLabel !== 'Unknown year') years.add(parts.yearLabel)
  }
  return [...years].sort((left, right) => Number(right) - Number(left))
}

export function getTimeGroupingMode(year: string | number = 'all', month: string | number = 'all'): 'year' | 'month' | 'day' {
  if (month !== 'all') return 'day'
  if (year !== 'all') return 'month'
  return 'year'
}

/** Toggles a single value in/out of a multi-select filter Set. Returns a new Set. */
export function toggleMultiFilterValue(currentSet: Set<string> | null | undefined, value: string | number): Set<string> {
  const next = new Set(currentSet || [])
  const key = String(value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function toggleIdSet(currentSet: Iterable<any> | null | undefined, ids: any[] = [], checked: boolean): Set<any> {
  const next = new Set(currentSet || [])
  for (const id of ids) {
    if (id === null || id === undefined) continue
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}
