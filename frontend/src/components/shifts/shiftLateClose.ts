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

type GrantUser = { role_code?: unknown; permissions?: unknown; role_permissions?: unknown } | null | undefined

/** One level of stored JSON, as the Worker reads it: a string is parsed once and must hold an object. */
function permissionMap(value: unknown): Record<string, unknown> {
  let parsed = value
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return {} } }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

/** Whether this user may close a shift left open on an earlier day: the Worker's grant check (a user setting wins over the role's). */
export function holdsForgottenCloseGrant(user: GrantUser): boolean {
  if (!user) return false
  const merged = { ...permissionMap(user.role_permissions), ...permissionMap(user.permissions) }
  return holdsLateClosePermission(merged, String(user.role_code || '').trim().toLowerCase() === 'admin' || merged.all === true)
}

/** Whether the screen offers the late-close form to this person for this row. */
export function offersLateClose(input: { isOwner: boolean; isAdministrator: boolean; merged: Record<string, unknown> }): boolean {
  return input.isOwner || holdsLateClosePermission(input.merged, input.isAdministrator)
}

const MINUTE_MS = 60 * 1000

/**
 * The picker's starting 'HH:mm': 23:59 of the shift's own day, or a minute before the next segment's opening when that
 * opened earlier the same day, and never before the row's own opening. The Worker still checks the last money record.
 */
export function lateCloseDefaultTime(businessDate: string, closeBefore: string | null | undefined, ownOpenedAt: string | null | undefined): string {
  const bounds = lateCloseBounds(businessDate)
  if (!bounds) return LATE_CLOSE_DEFAULT_TIME
  let ms = bounds.startMs + (24 * 60 - 1) * MINUTE_MS
  const beforeMs = closeBefore ? Date.parse(closeBefore) : NaN
  if (Number.isFinite(beforeMs)) ms = Math.min(ms, Math.floor((beforeMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS)
  const ownMs = ownOpenedAt ? Date.parse(ownOpenedAt) : NaN
  if (Number.isFinite(ownMs)) ms = Math.max(ms, Math.ceil(ownMs / MINUTE_MS) * MINUTE_MS)
  ms = Math.min(Math.max(ms, bounds.startMs), bounds.startMs + (24 * 60 - 1) * MINUTE_MS)
  const minutes = Math.round((ms - bounds.startMs) / MINUTE_MS)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
