// Formatters
// Shared date/time/number formatters used across multiple components.

import { BUSINESS_TIME_ZONE } from '../constants.ts'

type TimestampInput = string | number | Date | null | undefined

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
 * Format a UTC timestamp from the database into a human-readable local date+time string.
 * @param {string|Date} raw - Raw timestamp from DB
 * @returns {string}
 */
export function fmtTime(raw: TimestampInput): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    // dd/mm/yyyy, not "Aug 22, 2026". The whole app uses one numeric date
    // format by request (Aug 25 2026: "all date format uses mm/dd/yyyy
    // throughout app"; day-first since Sep 4 2026 -- "change the whole app
    // to dd-mm-yyy, just receipt id stays yyyy-mm-dd"), so a short-month
    // form here would be the odd one out wherever it sits next to a date
    // rendered by fmtDate/fmtDateTime24.
    //
    // The parts are assembled by hand rather than left to a locale. No
    // `Intl` locale is BOTH day-first AND 24-hour AND slash-separated
    // reliably across engines, and picking one that happens to be today
    // (en-GB) would silently follow that locale's future CLDR changes --
    // exactly the "swap day and month without failing" bug the old comment
    // here warned about, just from the other direction. `en-US` is still
    // the formatter locale because only its FIELD VALUES are read; the
    // order is ours.
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
    return `${get('day')}/${get('month')}/${get('year')}, ${get('hour')}:${get('minute')}`
  } catch {
    return String(raw || '')
  }
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
  const match = String(raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return String(raw ?? '') || '—'
  return `${match[3]}/${match[2]}/${match[1]}`
}

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
 * Format a UTC timestamp as dd/mm/yyyy HH:mm in 24-hour time (e.g.
 * "22/08/2026 20:00"). Used where a numeric, sortable-looking date +
 * time is wanted (contacts' Added/Created column) rather than fmtTime's
 * "Aug 22, 2026, 20:00" long form. Uses `hourCycle: 'h23'` rather than
 * `hour12: false` -- some JS engines render hour12:false's midnight as
 * "24:00" instead of "00:00", h23 avoids that.
 * @param {string|Date} raw - Raw timestamp from DB
 * @returns {string}
 */
export function fmtDateTime24(raw: TimestampInput): string {
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
      hourCycle: 'h23',
      timeZone: BUSINESS_TIME_ZONE,
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
  } catch {
    return String(raw || '')
  }
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
