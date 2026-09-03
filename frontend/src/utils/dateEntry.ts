// Typed-date entry normalizer -- the one place that turns whatever a member
// of staff types into the app's MM/DD/YYYY display string and an ISO
// YYYY-MM-DD value.
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". Staff type bare digit runs on a numeric keypad; every date
// field in the app must read them the same way.
//
// Timezone safety: NOTHING here goes through `new Date(string)` or
// Date.UTC(). A calendar date is validated against a plain leap-year table
// and the ISO string is assembled from padded parts, so a device west of
// UTC can never shift the day (the trap Part 388 and DateTimeRangePicker's
// header comment both call out). The only Date this module ever reads is
// the optional `today` argument, and only its LOCAL getFullYear() -- used
// solely to default a year the operator did not type.
//
// Companion: DateEntryInput.tsx (the shared field) and
// tests/dateEntry.test.ts (the table of accepted/rejected forms).

export interface DateEntryResult {
  /** Display form, 'MM/DD/YYYY'. null when the text is empty or unreadable. */
  value: string | null
  /** Storage form, 'YYYY-MM-DD'. null when the text is empty or unreadable. */
  iso: string | null
  /**
   * True when the digit run had MORE THAN ONE valid reading and this result
   * is the documented-precedence one (e.g. '122026' reads as 1/2/2026 by the
   * M-D-YYYY rule, but 12/20/26 is also a real date). Callers may surface it
   * as an advisory; it never blocks the value.
   */
  ambiguous?: boolean
}

const EMPTY: DateEntryResult = { value: null, iso: null }

// Same window DateTimeRangePicker's own parseManualDate has always accepted,
// kept identical so adopting this helper there is not a behaviour change.
const MIN_YEAR = 1970
const MAX_YEAR = 2999

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month1: number): number {
  if (month1 < 1 || month1 > 12) return 0
  if (month1 === 2 && isLeapYear(year)) return 29
  return MONTH_DAYS[month1 - 1]
}

function isRealDate(year: number, month1: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return false
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  if (month1 < 1 || month1 > 12) return false
  return day >= 1 && day <= daysInMonth(year, month1)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** '2026' -> 2026, '26' -> 2026 (2-digit years are always 20yy). Anything else -> NaN. */
function expandYear(raw: string): number {
  if (/^\d{4}$/.test(raw)) return Number(raw)
  if (/^\d{2}$/.test(raw)) return 2000 + Number(raw)
  return NaN
}

type Ymd = { year: number; month: number; day: number }

function candidate(year: number, month: number, day: number): Ymd | null {
  return isRealDate(year, month, day) ? { year, month, day } : null
}

function candidateFromStrings(year: string, month: string, day: string): Ymd | null {
  const y = expandYear(year)
  if (!Number.isFinite(y)) return null
  return candidate(y, Number(month), Number(day))
}

/** Readings of a bare digit run, in the order this module commits to. */
function digitCandidates(digits: string, defaultYear: number): Array<Ymd | null> {
  const d = digits
  const startsWithCentury = /^(19|20)/.test(d)
  switch (d.length) {
    case 8:
      // 8 digits starting 19/20 are read as YYYYMMDD ('20260903'); everything
      // else is the keypad-native MMDDYYYY ('09032026').
      return startsWithCentury
        ? [candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)), candidateFromStrings(d.slice(4, 8), d.slice(0, 2), d.slice(2, 4))]
        : [candidateFromStrings(d.slice(4, 8), d.slice(0, 2), d.slice(2, 4)), candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 8))]
    case 7:
      // '9032026' -> M DD YYYY (the user's own example). MM D YYYY second.
      return [
        candidateFromStrings(d.slice(3, 7), d.slice(0, 1), d.slice(1, 3)),
        candidateFromStrings(d.slice(3, 7), d.slice(0, 2), d.slice(2, 3)),
        startsWithCentury ? candidateFromStrings(d.slice(0, 4), d.slice(4, 5), d.slice(5, 7)) : null,
        startsWithCentury ? candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 7)) : null,
      ]
    case 6:
      // '932026' -> M D YYYY. '122526' -> MMDDYY as the fallback reading.
      return [
        candidateFromStrings(d.slice(2, 6), d.slice(0, 1), d.slice(1, 2)),
        candidateFromStrings(d.slice(4, 6), d.slice(0, 2), d.slice(2, 4)),
      ]
    case 5:
      return [
        candidateFromStrings(d.slice(3, 5), d.slice(0, 1), d.slice(1, 3)),
        candidateFromStrings(d.slice(3, 5), d.slice(0, 2), d.slice(2, 3)),
      ]
    case 4:
      // Year defaulted from `today` -- MMDD.
      return [candidate(defaultYear, Number(d.slice(0, 2)), Number(d.slice(2, 4)))]
    case 3:
      // Year defaulted from `today` -- '903' -> 09/03/<this year>.
      return [
        candidate(defaultYear, Number(d.slice(0, 1)), Number(d.slice(1, 3))),
        candidate(defaultYear, Number(d.slice(0, 2)), Number(d.slice(2, 3))),
      ]
    default:
      return []
  }
}

function resolve(candidates: Array<Ymd | null>): DateEntryResult {
  const valid = candidates.filter((entry): entry is Ymd => entry !== null)
  if (!valid.length) return EMPTY
  const first = valid[0]
  const iso = `${String(first.year).padStart(4, '0')}-${pad2(first.month)}-${pad2(first.day)}`
  const distinct = new Set(valid.map((entry) => `${entry.year}-${entry.month}-${entry.day}`))
  const result: DateEntryResult = { value: `${pad2(first.month)}/${pad2(first.day)}/${String(first.year).padStart(4, '0')}`, iso }
  if (distinct.size > 1) result.ambiguous = true
  return result
}

/**
 * Turn typed text into MM/DD/YYYY + ISO.
 *
 * Accepted:
 *   '09032026' / '9032026' / '932026' / '90326' -> 09/03/2026
 *   '20260903' (8 digits led by 19/20 = YYYYMMDD) -> 09/03/2026
 *   '09/03/2026', '9/3/2026', '9-3-2026', '9.3.2026', '2026-09-03'
 *   '9/3/26' (2-digit years are 20yy)
 *   '903' / '0903' / '9/3'  -- year defaulted from `today` (see below)
 *   a trailing 24-hour time ('09/03/2026 14:30') is tolerated and dropped
 *
 * Rejected (returns nulls, so the caller shows an error rather than storing
 * garbage or silently clearing): month 13, day 32, Feb 30, years outside
 * 1970-2999, letters, and anything that does not read as a real calendar day.
 *
 * `today` is used for ONE thing: defaulting the year when the operator typed
 * no year at all (the 3/4-digit and M/D forms). Callers should pass a Date
 * whose LOCAL fields are the business-timezone wall clock -- DateEntryInput
 * builds one from dateHelpers.todayStr(). It is never used for validation,
 * so every other form is fully deterministic.
 */
export function normalizeDateEntry(raw: string, today?: Date): DateEntryResult {
  const text = String(raw ?? '').trim()
  if (!text) return EMPTY

  // Drop a trailing 24-hour time -- mm/dd/yyyy datetimes reach these fields
  // from pasted exports and migration files (batchCode.ts tolerates the same).
  const withoutTime = text.replace(/[ T]\d{1,2}:\d{2}(?::\d{2})?$/, '').trim()
  if (!withoutTime) return EMPTY

  // One separator alphabet: / - . space _ backslash all mean "next field".
  const unified = withoutTime.replace(/[-./\\_\s]+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!unified || !/^[0-9/]+$/.test(unified)) return EMPTY

  const defaultYear = (today ?? new Date()).getFullYear()

  if (unified.includes('/')) {
    // The operator (or the as-you-type mask) put the separators in, so honour
    // the grouping literally -- never silently re-cut the digits into some
    // other reading, which would turn a typo into a plausible wrong date.
    const parts = unified.split('/')
    if (parts.length === 3) {
      const [a, b, c] = parts
      if (a.length === 4) return resolve([candidateFromStrings(a, b, c)])
      return resolve([candidateFromStrings(c, a, b)])
    }
    if (parts.length === 2) {
      const [a, b] = parts
      return resolve([candidate(defaultYear, Number(a), Number(b))])
    }
    return EMPTY
  }

  return resolve(digitCandidates(unified, defaultYear))
}

/** ISO 'YYYY-MM-DD' -> 'MM/DD/YYYY' (string surgery only, never a Date). */
export function isoToDisplayDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  return match ? `${match[2]}/${match[3]}/${match[1]}` : ''
}

/**
 * As-you-type mask for DateEntryInput.
 *
 * It inserts the slashes only where they cannot be wrong: after a 2-digit
 * group that is a real month, then after a 2-digit group that is a possible
 * day. A run whose first two digits are not a month (the user's own
 * '9032026', or a YYYYMMDD run) is left exactly as typed and normalised on
 * Enter/blur instead -- masking it into '90/32/026' would fight the typist.
 * A complete 8-digit run with no month prefix IS formatted live, because 8
 * digits is a finished date.
 *
 * `deleting` suppresses the trailing slash so backspacing over one is not
 * instantly undone.
 */
export function applyDateEntryMask(raw: string, options?: { deleting?: boolean; today?: Date }): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 8)
  if (!digits) return ''
  const month = digits.slice(0, 2)
  const monthComplete = month.length === 2 && Number(month) >= 1 && Number(month) <= 12
  if (!monthComplete) {
    if (digits.length === 8) {
      const normalized = normalizeDateEntry(digits, options?.today)
      if (normalized.value) return normalized.value
    }
    return digits
  }
  if (digits.length <= 2) return options?.deleting ? month : `${month}/`
  const day = digits.slice(2, 4)
  const dayComplete = day.length === 2 && Number(day) >= 1 && Number(day) <= 31
  if (!dayComplete) return `${month}/${day}`
  if (digits.length <= 4) return options?.deleting ? `${month}/${day}` : `${month}/${day}/`
  return `${month}/${day}/${digits.slice(4)}`
}
