// Formatters
// Shared date/time/number formatters used across multiple components.

import { BUSINESS_TIME_ZONE } from '../constants.ts'

export type TimestampInput = string | number | Date | null | undefined

function normalizeTimestampInput(raw: TimestampInput): string {
  if (!raw) return ''
  if (typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString()
  }
  const value = String(raw).trim()
  if (!value) return ''
  // Every stored stamp starts yyyy-mm-dd. Anything else (a leftover slash
  // value such as "03/04/2026") is NOT handed to Date: V8 reads a slash string
  // month-first, so it used to come out of fmtDateTime24 as "04/03/2026 07:00"
  // -- a real-looking day-first stamp for the OTHER day, with an invented clock.
  // Unreadable input is reported as unreadable (callers show a dash or the raw
  // text) instead of being guessed into a date.
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return ''
  const normalizedBase = value.includes('T') ? value : value.replace(' ', 'T')
  // Check DATE-ONLY before offset suffixes. A valid date such as 2026-09-01
  // also ends in "-01", which otherwise looks like a short timezone
  // offset and becomes the invalid string "2026-09-01:00". Imported and
  // legacy date-only rows must stay a real calendar date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedBase)) return `${normalizedBase}T00:00:00Z`
  if (/Z$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{4}$/i.test(normalizedBase)) {
    return normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  }
  if (/[+-]\d{2}$/i.test(normalizedBase)) return `${normalizedBase}:00`
  return `${normalizedBase}Z`
}

/**
 * Epoch milliseconds for a server timestamp, treating a timezone-less value
 * as UTC (SQLite's CURRENT_TIMESTAMP writes "YYYY-MM-DD HH:MM:SS" in UTC
 * with no marker). A bare Date.parse on that shape is interpreted as LOCAL
 * time, which made every server stamp look hours old to a UTC+7 viewer --
 * the Y8 false "this import may have stopped" warning. NaN for unparseable
 * input, so callers decide their own fallback.
 */
export function parseServerTimestampMs(raw: TimestampInput): number {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return Number.NaN
  return Date.parse(normalized)
}

/**
 * The historical name of the instant formatter. There is ONE instant shape in
 * the app -- "dd/mm/yyyy HH:mm", 24-hour, business time -- and it lives in
 * fmtDateTime24. This used to be a second body that wrote
 * "dd/mm/yyyy, HH:mm" (a comma), so one stored instant read two ways
 * depending on which helper the screen happened to call (DATE-CONSISTENCY
 * sweep D23, owner rule 6 Oct 2026: "we can't have different logics").
 * Kept as a thin alias because ~23 call sites and several source-shape tests
 * name it; new code should call fmtDateTime24 directly.
 */
export function fmtTime(raw: TimestampInput): string {
  return fmtDateTime24(raw)
}

/**
 * Format a UTC timestamp into a local date string (no time).
 * @param {string|Date} raw - Raw timestamp or date string
 * @returns {string}
 */
/**
 * dd/mm/yyyy for DATE-ONLY values ('2026-08-28' or a datetime whose date
 * part is what's shown). Pure string reorder -- deliberately NOT routed
 * through new Date(): a bare date string parses as UTC midnight, so
 * formatting it in the business timezone can shift it a day. Used by the
 * surfaces that used to print raw ISO slices (batch received/expiry dates,
 * credit due dates) -- the whole app shows dd/mm/yyyy by request
 * (Aug 25 2026 numeric-everywhere, day-first since Sep 4 2026).
 */
export function fmtDateOnly(raw: unknown): string {
  const text = String(raw ?? '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[3]}/${match[2]}/${match[1]}`
  if (!text) return '—'
  // Not a stored ISO date. Showing it bare would let a leftover month-first
  // value such as "03/04/2026" pass for a day-first date that the reader then
  // takes as 3 April (DATE-CONSISTENCY sweep 3b). It still has to be shown --
  // hiding a stored value is its own lie -- so it carries a warning mark that
  // no real date ever has.
  return `${UNREADABLE_DATE_MARK} ${text}`
}

/** Prefix fmtDateOnly puts on a stored value it cannot read as yyyy-mm-dd. */
export const UNREADABLE_DATE_MARK = '⚠'

export function fmtDate(raw: TimestampInput): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    // See fmtTime above for why this is numeric and why the day/month/year
    // order is assembled here rather than delegated to a locale.
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    return `${get('day')}/${get('month')}/${get('year')}`
  } catch {
    return String(raw || '')
  }
}

/**
 * THE instant formatter: dd/mm/yyyy HH:mm in 24-hour BUSINESS time (e.g.
 * "22/08/2026 20:00"), whatever shape the stored stamp has (a stamp with no
 * zone marker -- SQLite's "YYYY-MM-DD HH:MM:SS" -- is read as UTC). fmtTime
 * delegates here, so there is one instant shape in the app. Uses `hourCycle: 'h23'` rather than
 * `hour12: false` -- some JS engines render hour12:false's midnight as
 * "24:00" instead of "00:00", h23 avoids that.
 * @param {string|Date} raw - Raw timestamp from DB
 * @returns {string}
 */
export function fmtDateTime24(raw: TimestampInput, options: { seconds?: boolean } = {}): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: options.seconds ? '2-digit' : undefined,
      hourCycle: 'h23',
      timeZone: BUSINESS_TIME_ZONE,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    // `seconds` is the SAME shape plus ":ss", never a different one. Only two
    // surfaces ask for it, both because seconds are the point of the screen:
    // the audit log (which of two actions in one minute came first) and the
    // Server page clock probe (client-vs-server drift).
    const clock = `${get('hour')}:${get('minute')}${options.seconds ? `:${get('second')}` : ''}`
    return `${get('day')}/${get('month')}/${get('year')} ${clock}`
  } catch {
    return String(raw || '')
  }
}

/**
 * fmtDateTime24 for a stored value that may not be a timestamp at all (a log
 * row, a sync status, a portal review): the same canonical shape, but a value
 * it cannot read is shown AS STORED rather than collapsing to a dash, so a bad
 * row stays visible instead of looking empty. Blank input gives `empty`.
 */
export function fmtDateTime24OrRaw(raw: TimestampInput, options: { seconds?: boolean; empty?: string } = {}): string {
  if (raw === null || raw === undefined || String(raw).trim() === '') return options.empty ?? '—'
  const shown = fmtDateTime24(raw, { seconds: options.seconds })
  return shown === '—' ? String(raw) : shown
}

/**
 * The SAME instant as fmtDateTime24, in the same business timezone and the
 * same 24-hour clock, but written ISO-first: "2026-08-28 14:30".
 *
 * This is NOT a display formatter and must not be used as one -- it exists
 * for machine-readable cells that are read back by a parser, where a
 * day/month order would be ambiguous. The sales export's `sale_date` is the
 * case that forced it: that column is round-tripped through the importer
 * (cloudflare/src/lib/importEngine.ts's parseSalesImportDateTime), whose
 * slash branch reads month-first and must keep doing so, because every
 * spreadsheet the shop already owns was written under that meaning. Emitting
 * the day-first display string into that column would have re-imported the
 * 8th of December as the 12th of August -- silently, for any day <= 12 -- and
 * thrown for the rest. ISO is unambiguous, is the form the importer's own
 * error message advertises ("Use YYYY-MM-DD HH:mm"), and is what the Worker
 * side of the same export already ships.
 */
export function fmtBusinessIsoDateTime(raw: TimestampInput): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return ''
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return ''
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: BUSINESS_TIME_ZONE,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
  } catch {
    return String(raw || '')
  }
}

/**
 * Just the wall clock, HH:mm in 24-hour business time (e.g. "20:00").
 * The time-only companion to fmtDateTime24 -- used where the DATE is
 * already carried by a surrounding day header (the Stock Changes ledger's
 * day-grouped cards) so each row need only show its time. Same h23 +
 * business-timezone rules as fmtDateTime24 so the two never disagree.
 */
export function fmtClock24(raw: TimestampInput): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: BUSINESS_TIME_ZONE,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    return `${get('hour')}:${get('minute')}`
  } catch {
    return String(raw || '')
  }
}

/**
 * Day-first rendering for a CALLER-CHOSEN option set -- the escape hatch for
 * the handful of surfaces that need their own timezone, their own field list
 * or a zone label, and so cannot use fmtDate/fmtDateTime24 above.
 *
 * It exists because those surfaces used to call
 * `date.toLocaleString('en-US', { month: '2-digit', day: '2-digit', ... })`
 * directly, and en-US puts the MONTH first. The audit log, the backup list and
 * the Settings timezone preview each printed 09/03/2026 for the day every
 * other screen in the app called 03/09/2026 -- one instant, two orders, and
 * for any day <= 12 nothing about the string reveals which is which.
 *
 * The locale stays 'en-US' and only its field VALUES are read; the ORDER is
 * assembled here. No Intl locale is reliably day-first AND 24-hour AND
 * slash-separated across engines, and pinning one that happens to be today
 * would silently follow that locale's future CLDR changes.
 *
 * An option set whose date fields are NOT all numeric (a month name, a
 * weekday, time-only) is handed straight to Intl: there is no day/month order
 * to fix when the fields are not interchangeable digits.
 *
 * fmtDate/fmtDateTime24 keep their own bodies on purpose -- each pins one
 * exact shape ("dd/mm/yyyy" / "dd/mm/yyyy HH:mm") that their callers and tests
 * depend on, and routing them through a general assembler would put those
 * shapes at the mercy of one shared branch. This helper's "dd/mm/yyyy,
 * HH:mm" comma form is for the option-driven escape-hatch callers only.
 */
export function fmtDayFirst(value: Date, options: Intl.DateTimeFormatOptions = {}): string {
  // hour12:false renders midnight as "24:00" on some engines; h23 does not.
  const resolved: Intl.DateTimeFormatOptions = { ...options }
  if (resolved.hour && resolved.hour12 === false && !resolved.hourCycle) {
    delete resolved.hour12
    resolved.hourCycle = 'h23'
  }
  const formatter = new Intl.DateTimeFormat('en-US', resolved)
  const numeric = (field: unknown) => field === 'numeric' || field === '2-digit'
  if (!numeric(resolved.month) || !numeric(resolved.day)) return formatter.format(value)
  const parts = formatter.formatToParts(value)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  const datePart = [get('day'), get('month'), get('year')].filter(Boolean).join('/')
  const timePart = [get('hour'), get('minute'), get('second')].filter(Boolean).join(':')
  const zonePart = get('timeZoneName')
  return [[datePart, timePart].filter(Boolean).join(', '), zonePart].filter(Boolean).join(' ')
}

/**
 * Display label for a captured IANA timezone. Asia/Bangkok and
 * Asia/Phnom_Penh share the identical UTC+07:00 wall clock (no DST), and
 * devices in Cambodia routinely report Asia/Bangkok -- the business is in
 * Phnom Penh, so the label says so (user, Aug 30 2026: "name the time and
 * region zone to Phnom Penh...not bangkok...no difference but name
 * change"). Display-only: stored device_tz values are never rewritten, so
 * historical rows normalize too.
 */
export function fmtTimezoneLabel(raw: unknown): string {
  const value = String(raw ?? '').trim()
  return value === 'Asia/Bangkok' ? 'Asia/Phnom_Penh' : value
}

/**
 * Hours to add to a UTC hour to get the business timezone's wall-clock
 * hour (Asia/Phnom_Penh, see BUSINESS_TIME_ZONE). Computed via Intl rather
 * than hardcoded so it stays correct if BUSINESS_TIME_ZONE ever changes to
 * a zone that observes DST; Phnom Penh itself does not, so this is a fixed
 * +7 in practice.
 * @returns {number}
 */
export function getBusinessTimezoneOffsetHours(): number {
  const now = new Date()
  const utcMillis = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzMillis = new Date(now.toLocaleString('en-US', { timeZone: BUSINESS_TIME_ZONE })).getTime()
  return Math.round((tzMillis - utcMillis) / 3600000)
}

/**
 * Format a monetary value as a short abbreviated string (e.g. $1.2k, $3.5M).
 * @param {number} n
 * @returns {string}
 */
export function fmtShort(n: number | null | undefined): string {
  if (n === undefined || n === null) return ''
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

/**
 * Format a count as a short abbreviated string (e.g. 1.2k).
 * @param {number} n
 * @returns {string}
 */
export function fmtCount(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}
