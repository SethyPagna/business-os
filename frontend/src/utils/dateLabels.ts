// Shared month/axis wording for every place that prints a MONTH or a chart
// period instead of a full date. One module, so the Dashboard charts, the
// grouped record headers and anything that follows them name months the same
// way, in the viewer's language, and write days day-first.
//
// DATE-CONSISTENCY sweep D2/D15 (owner rule, 6 Oct 2026: "we can't have
// different logics in the system"): BarChart and LineChart each carried a
// private copy of the axis formatter that wrote days month-first ("10-06"),
// months as the English "Jan '26", and the grouped record headers used
// `toLocaleString('en-US', { month: 'long' })` -- an English month name on a
// Khmer screen. The month NAMES come from the `date_month_N` keys both packs
// already carry (the date picker uses them).

import { fmtDateOnly } from './formatters.ts'

export type MonthTranslate = (key: string) => string | undefined

const ENGLISH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Short month name for month 1-12 in the viewer's language. With no
 * translator (or a missing key) it falls back to the English short name, but
 * NEVER to the raw `date_month_9` key a missing pack entry would otherwise
 * surface. Out-of-range input returns the number so a bad value stays visible.
 */
export function monthShortName(month: number, t?: MonthTranslate): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return String(month)
  const key = `date_month_${month}`
  const translated = t?.(key)
  return translated && translated !== key ? translated : ENGLISH_MONTHS[month - 1]
}

const UNKNOWN_PERIOD_FALLBACK = { year: 'Unknown year', month: 'Unknown month', day: 'Unknown day' } as const

/**
 * The heading for a record whose date cannot be read, in the viewer's
 * language (date_unknown_year / _month / _day). English only when no
 * translator is passed or the pack lacks the key -- never the raw key.
 */
export function unknownPeriodLabel(kind: 'year' | 'month' | 'day', t?: MonthTranslate): string {
  const key = `date_unknown_${kind}`
  const translated = t?.(key)
  return translated && translated !== key ? translated : UNKNOWN_PERIOD_FALLBACK[kind]
}

/** "Sep 2026" / "កញ្ញា 2026" -- a month heading or axis tick that carries its year. */
export function monthYearLabel(year: number | string, month: number, t?: MonthTranslate): string {
  return `${monthShortName(month, t)} ${year}`
}

/**
 * An hour of the business day as the app's 24-hour clock: 0 -> "00:00",
 * 14 -> "14:00". The Dashboard's busy-hours card used to print "2 PM" /
 * "12 AM" (sweep D1) while every other clock in the app is 24-hour.
 */
export function formatHourOfDay(hourValue: unknown): string {
  const hour = ((Number(hourValue) % 24) + 24) % 24
  return `${String(hour).padStart(2, '0')}:00`
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_MONTH = /^(\d{4})-(\d{2})$/
const ISO_YEAR = /^\d{4}$/

/** True when the period labels span more than one calendar year (so ticks must say which). */
export function chartLabelsNeedYear(labels: string[]): boolean {
  const years = new Set<string>()
  labels.forEach((label) => {
    const match = String(label || '').match(/^(\d{4})(?:-\d{2})?(?:-\d{2})?$/)
    if (match) years.add(match[1])
  })
  return years.size > 1
}

/**
 * The short x-axis tick for one chart period: a day is "dd/mm" ("dd/mm/yy"
 * when the chart spans years), a month is "Sep" ("Sep 2026" across years), a
 * year is the year. Anything else keeps the old tail-slice so an unforeseen
 * period shape stays legible instead of throwing.
 */
export function formatChartAxisLabel(value: unknown, includeYear = false, t?: MonthTranslate): string {
  const raw = String(value || '')
  const day = ISO_DAY.exec(raw)
  if (day) return includeYear ? `${day[3]}/${day[2]}/${day[1].slice(2)}` : `${day[3]}/${day[2]}`
  const month = ISO_MONTH.exec(raw)
  if (month) {
    const name = monthShortName(Number(month[2]), t)
    return includeYear ? `${name} ${month[1]}` : name
  }
  if (ISO_YEAR.test(raw)) return raw
  return raw.length > 5 ? raw.slice(-5) : raw
}

/** The full tooltip heading for one chart period: dd/mm/yyyy, "Sep 2026", or the year. */
export function formatChartTooltipLabel(value: unknown, t?: MonthTranslate): string {
  const raw = String(value || '')
  if (ISO_DAY.test(raw)) return fmtDateOnly(raw)
  const month = ISO_MONTH.exec(raw)
  if (month) return monthYearLabel(month[1], Number(month[2]), t)
  return raw
}
