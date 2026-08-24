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
function businessNow(): Date {
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
