// The screen's copy of the Worker rule for closing a shift left open on an earlier Cambodia day
// (cloudflare/src/lib/shiftLateClose.ts). tests/shiftLateCloseParity.test.ts gives both the same fixture rows.

export const LATE_REASON_MAX = 500
export const LATE_CLOSE_PERMISSION = 'shift_close_forgotten'
export const LATE_CLOSE_OFFSET_MINUTES = 420
export const LATE_CLOSE_DEFAULT_TIME = '23:59'
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type LateCloseBounds = { startMs: number; lastSecondMs: number; endExclusiveMs: number }

export function isLateClose(businessDate: string, todayKh: string): boolean {
  return DATE_PATTERN.test(businessDate) && businessDate < todayKh
}

export function lateCloseBounds(businessDate: string, offsetMinutes: number = LATE_CLOSE_OFFSET_MINUTES): LateCloseBounds | null {
  if (!DATE_PATTERN.test(businessDate)) return null
  const midnightUtc = Date.parse(`${businessDate}T00:00:00Z`)
  if (!Number.isFinite(midnightUtc)) return null
  const startMs = midnightUtc - offsetMinutes * 60 * 1000
  return { startMs, lastSecondMs: startMs + DAY_MS - 1000, endExclusiveMs: startMs + DAY_MS }
}

export function lateReason(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= LATE_REASON_MAX ? text : null
}

/** An administrator always may; anyone else only with the stored value exactly true. */
export function holdsLateClosePermission(merged: Record<string, unknown>, isAdministrator: boolean): boolean {
  return isAdministrator || merged[LATE_CLOSE_PERMISSION] === true
}

/** Whether a chosen close instant lies on the shift's own day, no later than 23:59:59. */
export function lateCloseTimeOnDay(businessDate: string, closeMs: number): boolean {
  const bounds = lateCloseBounds(businessDate)
  return !!bounds && Number.isFinite(closeMs) && closeMs >= bounds.startMs && closeMs <= bounds.lastSecondMs
}

/**
 * The close instant (ISO) for an 'HH:mm' picked on the shift's own day, or null when the time is not on that day.
 * The default 23:59 sends nothing: the Worker then stamps 23:59:59.
 */
export function lateCloseIsoForTime(businessDate: string, time: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const bounds = lateCloseBounds(businessDate)
  if (!bounds) return null
  const ms = bounds.startMs + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60 * 1000
  return lateCloseTimeOnDay(businessDate, ms) ? new Date(ms).toISOString() : null
}

/** Whether the screen offers the late-close form to this person for this row. */
export function offersLateClose(input: { isOwner: boolean; isAdministrator: boolean; merged: Record<string, unknown> }): boolean {
  return input.isOwner || holdsLateClosePermission(input.merged, input.isAdministrator)
}
