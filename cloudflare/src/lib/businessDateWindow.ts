// Cambodia is the app's single fixed business timezone: Asia/Phnom_Penh,
// UTC+07:00, no DST (see receiptNumber.ts's BUSINESS_UTC_OFFSET_MS and the
// project date conventions). Sale/return `created_at` is stored in UTC
// ("YYYY-MM-DD HH:MM:SS", see lib/clientTimestamp.ts), so any "which calendar
// day did this happen on" bucketing MUST be taken in UTC+7, never in UTC and
// never from a viewer-supplied offset -- user directive Sep 1 2026: "the system
// should be based on UTC+7 ... all Cambodia ... not other timezone."
//
// Without the shift, `date(created_at)` returns the UTC date, so a sale rung up
// at 00:30 local (17:30 UTC the previous day) lands on the previous calendar
// day and "Today" silently under-counts the morning. The same +7h convention is
// already used for invoice_date/deleted_at in routes/contacts.ts and
// routes/compat.ts; this module is the single source of truth for the SALES /
// RETURNS `created_at` sites, which historically compared raw UTC.
//
// Two shapes are provided:
//  - localDateExpr()/localMonthExpr()/localWeekExpr(): wrap the column, for
//    GROUP BY / SELECT of the local day/month/week bucket.
//  - localDayLowerBound()/localDayUpperBoundExclusive(): shift the BOUNDS
//    instead of the column, so a range filter stays sargable and the
//    created_at index still serves date-ranged reports. A local day D spans the
//    UTC half-open interval [D 00:00 - 7h, (D+1) 00:00 - 7h).
//
// `col`/`param` are trusted SQL fragments (a column reference, a bound-param
// placeholder) -- never user input -- so string-building them is injection-safe.

/** Minutes east of UTC for the fixed business timezone (Asia/Phnom_Penh). */
export const BUSINESS_UTC_OFFSET_MINUTES = 420

/** SQLite datetime modifier that shifts a stored UTC timestamp to local time. */
export const BUSINESS_TZ_FORWARD = '+7 hours'
/** SQLite datetime modifier that shifts a local wall-clock instant back to UTC. */
export const BUSINESS_TZ_BACK = '-7 hours'

/** Local (UTC+7) calendar date of a UTC timestamp column, e.g. for GROUP BY. */
export function localDateExpr(col: string): string {
  return `date(${col}, '${BUSINESS_TZ_FORWARD}')`
}

/** Local (UTC+7) hour-of-day ('00'..'23') of a UTC timestamp column. */
export function localHourExpr(col: string): string {
  return `strftime('%H', ${col}, '${BUSINESS_TZ_FORWARD}')`
}

/**
 * SQL expression for the CURRENT calendar date in the business timezone
 * (UTC+7). `date('now')` alone yields the UTC date, so during Cambodia's
 * 00:00-07:00 (still the previous UTC day) it would name yesterday.
 */
export function localTodayExpr(): string {
  return `date('now', '${BUSINESS_TZ_FORWARD}')`
}

/** Local (UTC+7) year-month bucket of a UTC timestamp column. */
export function localMonthExpr(col: string): string {
  return `strftime('%Y-%m', ${col}, '${BUSINESS_TZ_FORWARD}')`
}

/** Local (UTC+7) ISO-ish year-week bucket of a UTC timestamp column. */
export function localWeekExpr(col: string): string {
  return `strftime('%Y-W%W', ${col}, '${BUSINESS_TZ_FORWARD}')`
}

/**
 * Sargable lower bound: the UTC instant at which the local day named by
 * `param` (a `YYYY-MM-DD` bound param) begins. Use as `col >= <this>`.
 */
export function localDayLowerBound(param = '@startDate'): string {
  return `datetime(${param}, '${BUSINESS_TZ_BACK}')`
}

/**
 * Sargable EXCLUSIVE upper bound: the UTC instant at which the day AFTER the
 * local day named by `param` begins (so the whole end day is included). Use as
 * `col < <this>`.
 */
export function localDayUpperBoundExclusive(param = '@endDate'): string {
  return `datetime(date(${param}, '+1 day'), '${BUSINESS_TZ_BACK}')`
}

/**
 * Full sargable "`col`'s local date is within [startParam, endParam]" clause,
 * bucketed in UTC+7. Equivalent local-day row set to
 * `localDateExpr(col) BETWEEN startParam AND endParam`, but index-usable.
 */
export function localDateRangeClause(col: string, startParam = '@startDate', endParam = '@endDate'): string {
  return `${col} >= ${localDayLowerBound(startParam)} AND ${col} < ${localDayUpperBoundExclusive(endParam)}`
}

/**
 * Sargable "`col` falls on the CURRENT local (UTC+7) day" clause, with the
 * "today" boundary taken in the business timezone (so a 00:30-local sale, which
 * is 17:30 UTC the previous day, still counts as today). Needs no bound param.
 */
export function localTodayRangeClause(col: string): string {
  return `${col} >= ${localDayLowerBound(localTodayExpr())} AND ${col} < ${localDayUpperBoundExclusive(localTodayExpr())}`
}

/**
 * The current calendar date in the business timezone (UTC+7), 'YYYY-MM-DD', for
 * JS-side "today" DEFAULTS (e.g. an omitted date-range param). Mirrors
 * receiptNumber.ts's BUSINESS_UTC_OFFSET_MS; `new Date().toISOString()` alone
 * gives the UTC date, which names yesterday during Cambodia's 00:00-07:00.
 */
export function businessToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10)
}
