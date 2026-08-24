// Formatters
// Shared date/time/number formatters used across multiple components.

import { BUSINESS_TIME_ZONE } from '../constants.ts'

type TimestampInput = string | number | Date | null | undefined

function normalizeTimestampInput(raw: TimestampInput): string {
  if (!raw) return ''
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString()
  }
  const value = String(raw).trim()
  if (!value) return ''
  const normalizedBase = value.includes('T') ? value : value.replace(' ', 'T')
  if (/Z$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{4}$/i.test(normalizedBase)) {
    return normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  }
  if (/[+-]\d{2}$/i.test(normalizedBase)) return `${normalizedBase}:00`
  return `${normalizedBase}Z`
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
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: BUSINESS_TIME_ZONE,
    })
  } catch {
    return String(raw || '')
  }
}

/**
 * Format a UTC timestamp into a local date string (no time).
 * @param {string|Date} raw - Raw timestamp or date string
 * @returns {string}
 */
export function fmtDate(raw: TimestampInput): string {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: BUSINESS_TIME_ZONE,
    })
  } catch {
    return String(raw || '')
  }
}

/**
 * Format a UTC timestamp as mm/dd/yyyy HH:mm in 24-hour time (e.g.
 * "08/22/2026 20:00"). Used where a numeric, sortable-looking date +
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
    return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}`
  } catch {
    return String(raw || '')
  }
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
