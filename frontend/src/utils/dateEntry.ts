// Typed-date entry normalizer -- the one place that turns whatever a member
// of staff types into the app's DD/MM/YYYY display string and an ISO
// YYYY-MM-DD value.
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". Staff type bare digit runs on a numeric keypad; every date
// field in the app must read them the same way.
//
// DAY-FIRST since Sep 4 2026 (user: "change the whole app to dd-mm-yyy, just
// receipt id stays yyyy-mm-dd"). That direction re-cuts the SAME keystrokes:
// '9032026' still auto-formats to '09/03/2026', but that string now means
// 9 March, where it used to mean 3 September. Nothing here can detect the
// difference -- a day-first field and a month-first typist produce identical
// digits -- which is exactly why the reading order is stated once, here, and
// every field in the app shares it rather than each guessing locally.
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
  /** Display form, 'DD/MM/YYYY'. null when the text is empty or unreadable. */
  value: string | null
  /** Storage form, 'YYYY-MM-DD'. null when the text is empty or unreadable. */
  iso: string | null
  /**
   * True when the digit run had MORE THAN ONE valid reading and this result
   * is the documented-precedence one (e.g. '122026' reads as 1/2/2026 by the
   * D-M-YYYY rule, but 12/20/26 is also a real date). Callers may surface it
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

/**
 * Readings of a bare digit run, in the order this module commits to.
 *
 * Day-first throughout, EXCEPT a run that opens with a century ('19'/'20'),
 * which is tried as ISO-order YYYYMMDD first. That exception is safe rather
 * than lucky: a YYYYMMDD reading and a DDMMYYYY reading of the same 8 digits
 * are almost never both valid, because whichever one is wrong lands a month
 * above 12 or a year below 1970. '20260904' reads only as 2026-09-04 (as
 * DDMMYYYY its month would be 26); '19122026' reads only as 19/12/2026 (as
 * YYYYMMDD its month would be 20). Where both DO read, the ISO one wins --
 * the operator typed a year first, so they meant a year first.
 */
function digitCandidates(digits: string, defaultYear: number): Array<Ymd | null> {
  const d = digits
  const startsWithCentury = /^(19|20)/.test(d)
  switch (d.length) {
    case 8:
      // 8 digits starting 19/20 are read as YYYYMMDD ('20260903'); everything
      // else is the keypad-native DDMMYYYY ('03092026').
      return startsWithCentury
        ? [candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)), candidateFromStrings(d.slice(4, 8), d.slice(2, 4), d.slice(0, 2))]
        : [candidateFromStrings(d.slice(4, 8), d.slice(2, 4), d.slice(0, 2)), candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 8))]
    case 7:
      // '9032026' -> D MM YYYY (9 March). DD M YYYY second.
      return [
        candidateFromStrings(d.slice(3, 7), d.slice(1, 3), d.slice(0, 1)),
        candidateFromStrings(d.slice(3, 7), d.slice(2, 3), d.slice(0, 2)),
        startsWithCentury ? candidateFromStrings(d.slice(0, 4), d.slice(4, 5), d.slice(5, 7)) : null,
        startsWithCentury ? candidateFromStrings(d.slice(0, 4), d.slice(4, 6), d.slice(6, 7)) : null,
      ]
    case 6:
      // '932026' -> D M YYYY. '251226' -> DDMMYY as the fallback reading.
      return [
        candidateFromStrings(d.slice(2, 6), d.slice(1, 2), d.slice(0, 1)),
        candidateFromStrings(d.slice(4, 6), d.slice(2, 4), d.slice(0, 2)),
      ]
    case 5:
      return [
        candidateFromStrings(d.slice(3, 5), d.slice(1, 3), d.slice(0, 1)),
        candidateFromStrings(d.slice(3, 5), d.slice(2, 3), d.slice(0, 2)),
      ]
    case 4:
      // Year defaulted from `today` -- DDMM.
      return [candidate(defaultYear, Number(d.slice(2, 4)), Number(d.slice(0, 2)))]
    case 3:
      // Year defaulted from `today` -- '903' -> 9 March <this year>.
      return [
        candidate(defaultYear, Number(d.slice(1, 3)), Number(d.slice(0, 1))),
        candidate(defaultYear, Number(d.slice(2, 3)), Number(d.slice(0, 2))),
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
  const result: DateEntryResult = { value: `${pad2(first.day)}/${pad2(first.month)}/${String(first.year).padStart(4, '0')}`, iso }
  if (distinct.size > 1) result.ambiguous = true
  return result
}

/**
 * Turn typed text into DD/MM/YYYY + ISO.
 *
 * Accepted (all day-first; '09/03/2026' means 9 March 2026):
 *   '09032026' / '9032026' / '932026' / '90326' -> 09/03/2026
 *   '20260309' (8 digits led by 19/20 = YYYYMMDD) -> 09/03/2026
 *   '09/03/2026', '9/3/2026', '9-3-2026', '9.3.2026', '2026-03-09'
 *   '9/3/26' (2-digit years are 20yy)
 *   '903' / '0903' / '9/3'  -- year defaulted from `today` (see below)
 *   a trailing 24-hour time ('09/03/2026 14:30') is tolerated and dropped
 *
 * A 4-digit FIRST group is still read as ISO year-first ('2026/03/09'), which
 * is the one form that cannot be confused with either order and is what D1
 * stores. Everything else is day-first with no fallback to month-first: a
 * parser that tried both would turn a typo into a plausible wrong date, and
 * for every day <= 12 there is no signal to tell the two apart.
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

  // Drop a trailing 24-hour time -- slash-formatted datetimes reach these
  // fields from pasted exports and migration files (batchCode.ts tolerates
  // the same).
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
      // A 4-digit first group is ISO year-first; anything else is day-first.
      if (a.length === 4) return resolve([candidateFromStrings(a, b, c)])
      return resolve([candidateFromStrings(c, b, a)])
    }
    if (parts.length === 2) {
      const [a, b] = parts
      return resolve([candidate(defaultYear, Number(b), Number(a))])
    }
    return EMPTY
  }

  return resolve(digitCandidates(unified, defaultYear))
}

/** ISO 'YYYY-MM-DD' -> 'DD/MM/YYYY' (string surgery only, never a Date). */
export function isoToDisplayDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

/**
 * As-you-type mask for DateEntryInput.
 *
 * Day-first: it inserts the slashes only where they cannot be wrong -- after
 * a 2-digit group that is a possible DAY, then after a 2-digit group that is
 * a real MONTH. A run whose first two digits are not a day (a YYYYMMDD run,
 * which opens '19'/'20' -- both real days, so this only catches years like
 * '2026' at the '20' stage and resolves on completion) is left exactly as
 * typed and normalised on Enter/blur instead, because masking it would fight
 * the typist. A complete 8-digit run IS formatted live, because 8 digits is
 * a finished date -- and that is what disambiguates a leading '20' between
 * "the 20th" and "the year 20xx".
 *
 * `deleting` suppresses the trailing slash so backspacing over one is not
 * instantly undone.
 */
export function applyDateEntryMask(raw: string, options?: { deleting?: boolean; today?: Date }): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 8)
  if (!digits) return ''
  // 8 digits is a finished date: let the full normalizer decide between
  // YYYYMMDD and DDMMYYYY rather than masking on the leading pair alone.
  if (digits.length === 8) {
    const normalized = normalizeDateEntry(digits, options?.today)
    if (normalized.value) return normalized.value
    return digits
  }
  const day = digits.slice(0, 2)
  const dayComplete = day.length === 2 && Number(day) >= 1 && Number(day) <= 31
  if (!dayComplete) return digits
  if (digits.length <= 2) return options?.deleting ? day : `${day}/`
  const month = digits.slice(2, 4)
  const monthComplete = month.length === 2 && Number(month) >= 1 && Number(month) <= 12
  if (!monthComplete) return `${day}/${month}`
  if (digits.length <= 4) return options?.deleting ? `${day}/${month}` : `${day}/${month}/`
  return `${day}/${month}/${digits.slice(4)}`
}

// ---------------------------------------------------------------------------
// The TIME half of the same kernel.
//
// A shift is amended and closed at a date AND a wall-clock minute, and until
// Sep 6 2026 those three fields were the app's last native
// <input type="datetime-local"> -- the very control DateEntryInput.tsx exists
// to replace. The native control rejects the keypad run this project's staff
// actually type ('9032026'), and it renders the date part in the DEVICE
// locale, so a phone set to en-US silently swaps day and month on a
// historical shift close that a cashier cannot skip.
//
// So the time is typed as bare digits too, on the same terms as the date:
// '930' is 09:30, '1430' is 14:30, '9' is 09:00. 24-hour throughout -- the
// app's stated convention, and the one reading that has no am/pm to lose.
//
// Timezone safety is inherited: nothing here constructs a Date either. The
// pair is joined as the plain local string 'YYYY-MM-DDTHH:mm', which is the
// exact shape shiftTransport.shiftLocalDateTimeToIso already consumes and
// stamps with the shop's +07:00 offset, so the one place that decides what a
// typed wall clock MEANS is still that function and not this one.
// ---------------------------------------------------------------------------

export interface TimeEntryResult {
  /** Display and storage form, 'HH:mm' (24-hour). null when empty or unreadable. */
  value: string | null
  /** Minutes since midnight, 0-1439. null when empty or unreadable. */
  minutes: number | null
}

const EMPTY_TIME: TimeEntryResult = { value: null, minutes: null }

function timeCandidate(hour: number, minute: number): TimeEntryResult {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return EMPTY_TIME
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return EMPTY_TIME
  return { value: `${pad2(hour)}:${pad2(minute)}`, minutes: hour * 60 + minute }
}

/**
 * Turn typed text into 'HH:mm' + minutes-since-midnight.
 *
 * Accepted (24-hour, never am/pm):
 *   '9' / '09' -> 09:00        a bare hour means the hour
 *   '930' -> 09:30             3 digits are H MM
 *   '1430' / '0930' -> HH MM
 *   '9:30', '9.30', '9h30', '14 30'  -- one separator alphabet, like the date
 *   '14:30:00' / '143000'      a seconds group is dropped, not rejected
 *
 * Rejected (returns nulls, so the caller shows an error rather than storing
 * a guess): hour 24+, minute 60+, letters, and any digit run that is not one
 * of the lengths above. There is deliberately NO 12-hour reading: '0130'
 * means half past one in the morning, and a parser that also accepted
 * '1:30pm' would make the same four keystrokes mean two different minutes.
 */
export function normalizeTimeEntry(raw: string): TimeEntryResult {
  const text = String(raw ?? '').trim()
  if (!text) return EMPTY_TIME
  // Same separator alphabet as the date half, plus 'h' for '9h30'.
  const unified = text.replace(/[:.\-\s_hH]+/g, ':').replace(/^:+|:+$/g, '')
  if (!unified || !/^[0-9:]+$/.test(unified)) return EMPTY_TIME

  if (unified.includes(':')) {
    // The operator (or the as-you-type mask) put the separator in, so honour
    // the grouping literally rather than re-cutting the digits.
    const parts = unified.split(':')
    if (parts.length === 3 && /^\d{1,2}$/.test(parts[2])) parts.pop()
    if (parts.length !== 2) return EMPTY_TIME
    const [hour, minute] = parts
    if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return EMPTY_TIME
    return timeCandidate(Number(hour), Number(minute))
  }

  switch (unified.length) {
    case 1:
    case 2:
      return timeCandidate(Number(unified), 0)
    case 3:
      return timeCandidate(Number(unified.slice(0, 1)), Number(unified.slice(1, 3)))
    case 4:
    case 6:
      // 6 digits are HHMMSS; the seconds are dropped for the same reason the
      // date half drops a trailing time -- pasted exports carry them.
      return timeCandidate(Number(unified.slice(0, 2)), Number(unified.slice(2, 4)))
    default:
      return EMPTY_TIME
  }
}

/**
 * As-you-type mask for the time half.
 *
 * It inserts the colon only where it cannot be wrong: after a 2-digit group
 * that is a real HOUR (00-23). A run whose first two digits are not an hour
 * ('93' on the way to '930') is left exactly as typed and normalised on
 * Enter/blur instead -- the same contract applyDateEntryMask keeps, so a
 * keypad run never fights the typist.
 *
 * `deleting` suppresses the trailing colon so backspacing over one is not
 * instantly undone.
 */
export function applyTimeEntryMask(raw: string, options?: { deleting?: boolean }): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  const hour = digits.slice(0, 2)
  const hourComplete = hour.length === 2 && Number(hour) <= 23
  if (!hourComplete) return digits
  if (digits.length <= 2) return options?.deleting ? hour : `${hour}:`
  return `${hour}:${digits.slice(2)}`
}

/** The local wall-clock pair the shift transport consumes: 'YYYY-MM-DDTHH:mm'. */
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/

/**
 * Split a stored 'YYYY-MM-DDTHH:mm' into its two typed halves. Anything else
 * -- including a half-entered value -- splits to two empty strings, so a
 * caller never renders a fragment it cannot round-trip.
 */
export function splitLocalDateTime(local: string | null | undefined): { date: string; time: string } {
  const match = LOCAL_DATE_TIME.exec(String(local ?? '').trim())
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' }
}

/**
 * Join an ISO date and a typed time back into 'YYYY-MM-DDTHH:mm'.
 *
 * Returns '' unless BOTH halves are real. A date with no time must never
 * default to midnight: on the shift close form that would silently invent a
 * closing minute the cashier never entered, which is the one thing
 * shift_close_time_hint promises the app does not do.
 */
export function joinLocalDateTime(isoDate: string | null | undefined, time: string | null | undefined): string {
  const date = String(isoDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = normalizeTimeEntry(String(time ?? ''))
  return parsed.value ? `${date}T${parsed.value}` : ''
}

/** The two halves of a typed pair, plus whether either is showing text it could not read. */
export interface LocalDateTimePair {
  date: string
  time: string
  /** True while the date half holds text that did not normalise. */
  dateUnreadable?: boolean
  /** True while the time half holds text that did not normalise. */
  timeUnreadable?: boolean
}

/**
 * What a date+time pair may publish upward: 'YYYY-MM-DDTHH:mm', or ''.
 *
 * joinLocalDateTime alone answers "are both halves PRESENT". That is not the
 * whole question for a typed field, because a typed field deliberately keeps
 * its last committed value while the operator's unreadable text sits on
 * screen (DateEntryInput never clears what was typed). On a filter box that
 * is right. On the shift close it is not: a cashier retyping a wrong day and
 * stopping halfway would leave the OLD timestamp stored, the Save button
 * live, and the drawer would close at a minute printed nowhere on the
 * screen -- which is the same class of silent wrong timestamp the native
 * datetime-local control was removed for.
 *
 * So an unreadable half WITHDRAWS the pair. The half keeps its text (the
 * operator has to see it to fix it) and the owning form's blocker row says
 * what is missing.
 */
export function localDateTimePairValue(pair: LocalDateTimePair): string {
  if (pair.dateUnreadable || pair.timeUnreadable) return ''
  return joinLocalDateTime(pair.date, pair.time)
}

/**
 * The display text DateEntryInput shows for a stored value.
 *
 * The field's contract is ISO 'YYYY-MM-DD' in and ISO out; a legacy
 * slash-form string is tolerated on the way in by running it through the
 * same reader Enter uses. Anything neither shape is handed back untouched --
 * the field then shows it as the unreadable text it is rather than guessing.
 *
 * It lives here rather than inside the component because the display rule
 * and the commit rule are one rule, and a second copy of it inside the
 * component is how the two drift apart.
 */
export function dateEntryDisplayValue(value: string | null | undefined, today?: Date): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const iso = isoToDisplayDate(raw)
  if (iso) return iso
  const parsed = normalizeDateEntry(raw, today)
  return parsed.value || raw
}
