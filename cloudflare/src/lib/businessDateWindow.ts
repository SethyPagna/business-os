// Cambodia is the app's single fixed business timezone: Asia/Phnom_Penh,
// UTC+07:00, no DST (see receiptNumber.ts's BUSINESS_UTC_OFFSET_MS and the
// project date conventions). Sale/return/movement `created_at` is stored in
// UTC, so any "which calendar day did this happen on" bucketing MUST be taken
// in UTC+7, never in UTC and never from a viewer-supplied offset -- user
// directive Sep 1 2026: "the system should be based on UTC+7 ... all Cambodia
// ... not other timezone." Without the +7h shift, `date(created_at)` returns
// the UTC date, so a sale rung up at 00:30 local (17:30 UTC the previous day)
// lands on the previous calendar day and "Today" silently under-counts the
// morning.
//
// FORMAT ROBUSTNESS (critical): production `created_at` is a MIX of shapes --
// verified against prod D1: ALL sales are ISO `YYYY-MM-DDTHH:MM:SS.sssZ`, while
// most inventory_movements (and server CURRENT_TIMESTAMP writes) are space-
// separated `YYYY-MM-DD HH:MM:SS`. SQLite's date()/datetime()/strftime() parse
// BOTH, but a RAW STRING comparison against a datetime bound does NOT: at
// position 10 'T' (0x54) sorts after ' ' (0x20), so an ISO timestamp compared
// against a space-formatted datetime bound at the same instant misfiles (the
// row is dropped from its own day). So the PRECISE day predicate always
// normalizes through `date(col, '+7 hours')` (a real local calendar date,
// shape-agnostic). To keep it index-usable we AND in a redundant, permissive,
// DATE-ONLY pre-filter on the raw column: a bare `YYYY-MM-DD` bound is a prefix
// that sorts correctly against any same-or-later timestamp of either shape, so
// `col >= date(param,'-1 day')` / `col < date(param,'+1 day')` give the planner
// a sargable range on idx_*_created_pg while never excluding a valid row (a
// local day D lives entirely within the UTC dates {D-1, D}). The date()
// predicate then trims that superset to the exact local range.
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

/** Local (UTC+7) year-month bucket of a UTC timestamp column. */
export function localMonthExpr(col: string): string {
  return `strftime('%Y-%m', ${col}, '${BUSINESS_TZ_FORWARD}')`
}

/** Local (UTC+7) ISO-ish year-week bucket of a UTC timestamp column. */
export function localWeekExpr(col: string): string {
  return `strftime('%Y-W%W', ${col}, '${BUSINESS_TZ_FORWARD}')`
}

/**
 * SQL expression for the CURRENT calendar date in the business timezone
 * (UTC+7). `date('now')` alone yields the UTC date, so during Cambodia's
 * 00:00-07:00 (still the previous UTC day) it would name yesterday.
 */
export function localTodayExpr(): string {
  return `date('now', '${BUSINESS_TZ_FORWARD}')`
}

/**
 * "`col`'s local (UTC+7) calendar date is on or after `param`" (a `YYYY-MM-DD`
 * bound param, or any SQL expression yielding one). The first term is the exact,
 * shape-agnostic check; the second is a redundant sargable date-only floor on
 * the raw column so idx_*_created_pg is used. A local day D's earliest UTC
 * instant is D-1 17:00, so the floor is `date(param, '-1 day')`.
 */
export function localDateAtOrAfter(col: string, param = '@startDate'): string {
  return `${localDateExpr(col)} >= ${param} AND ${col} >= date(${param}, '-1 day')`
}

/**
 * "`col`'s local (UTC+7) calendar date is on or before `param`". Exact check
 * plus a redundant sargable date-only ceiling on the raw column. A local day D's
 * latest UTC instant is D 16:59, so the ceiling `< date(param, '+1 day')` admits
 * all of the end day and never clips a valid row.
 */
export function localDateAtOrBefore(col: string, param = '@endDate'): string {
  return `${localDateExpr(col)} <= ${param} AND ${col} < date(${param}, '+1 day')`
}

/**
 * Full "`col`'s local (UTC+7) date is within [startParam, endParam]" clause:
 * exact date()-normalized bounds (shape-agnostic) AND-ed with a sargable
 * date-only pre-filter that keeps the created_at index usable.
 */
export function localDateRangeClause(col: string, startParam = '@startDate', endParam = '@endDate'): string {
  return `${localDateAtOrAfter(col, startParam)} AND ${localDateAtOrBefore(col, endParam)}`
}

/**
 * "`col` falls on the CURRENT local (UTC+7) day" -- the "today" boundary taken
 * in the business timezone (a 00:30-local sale, 17:30 UTC the previous day,
 * still counts as today). Exact date() equality plus the sargable date-only
 * window around the current local date. Needs no bound param.
 */
export function localTodayRangeClause(col: string): string {
  const today = localTodayExpr()
  return `${localDateExpr(col)} = ${today} AND ${col} >= date(${today}, '-1 day') AND ${col} < date(${today}, '+1 day')`
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
