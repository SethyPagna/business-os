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
