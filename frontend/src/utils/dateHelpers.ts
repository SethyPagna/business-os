// Local-date helpers used by the Dashboard date-range picker.
// These resolve to the business's timezone (Asia/Phnom_Penh, see
// BUSINESS_TIME_ZONE in constants.ts), not the device's own timezone, so
// "Today"/"This Month"/"This Year" presets mean the same calendar date for
// every user regardless of where their device thinks it is.

import { BUSINESS_TIME_ZONE } from '../constants.ts'

// Returns a Date whose getFullYear()/getMonth()/getDate() reflect the
// current wall-clock date in BUSINESS_TIME_ZONE. Re-parsing a
// timeZone-formatted string is the standard zero-dependency way to read a
// fixed IANA zone's wall-clock fields in JS.
export function businessNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: BUSINESS_TIME_ZONE }))
}

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  return toLocalDateString(businessNow())
}

export function offsetDate(days: number): string {
  const d = businessNow()
  d.setDate(d.getDate() + days)
  return toLocalDateString(d)
}

// Current year/month in the business timezone, for range presets like
// "This Month" / "This Year" that build a start-of-period date string.
export function businessYear(): number {
  return businessNow().getFullYear()
}

export function businessMonth(): number {
  return businessNow().getMonth() + 1
}

/**
 * Whole calendar days from today (business timezone) to a stored yyyy-mm-dd
 * date: 0 = today, negative = already past. null for anything that is not a
 * stored ISO date. Both ends are calendar days, so the device's own timezone
 * and the time of day cannot move the answer -- the product expiry badge used
 * to compare the device-local midnight of the expiry with Date.now().
 */
export function daysUntilBusinessDate(isoDate: unknown, today: string = todayStr()): number | null {
  const toUtcDay = (value: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  }
  const target = toUtcDay(String(isoDate ?? ''))
  const origin = toUtcDay(today)
  if (target === null || origin === null) return null
  return Math.round((target - origin) / 86400000)
}
