// The rule for closing a shift left open on an earlier Cambodia day (owner A74, A75, A76, 23 Nov 2026).
// Pure: no imports, so every test harness can load it. The route supplies today's date and the permission map.
// frontend/src/components/shifts/shiftLateClose.ts mirrors it; the fixture cloudflare/scripts/fixtures/shift-late-close-cases.json pins both.

export const LATE_REASON_MAX = 500
export const LATE_CLOSE_PERMISSION = 'shift_close_forgotten'
const DAY_MS = 24 * 60 * 60 * 1000

export type LateCloseBounds = { startMs: number; lastSecondMs: number; endExclusiveMs: number }

/** A shift is closed late when its business day is before today (both 'YYYY-MM-DD', Cambodia time). */
export function isLateClose(businessDate: string, todayKh: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(businessDate) && businessDate < todayKh
}

/** The shift's own Cambodia day: its first instant, its last chosen second (23:59:59) and the next midnight (exclusive). */
export function lateCloseBounds(businessDate: string, offsetMinutes: number): LateCloseBounds | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return null
  const midnightUtc = Date.parse(`${businessDate}T00:00:00Z`)
  if (!Number.isFinite(midnightUtc)) return null
  const startMs = midnightUtc - offsetMinutes * 60 * 1000
  return { startMs, lastSecondMs: startMs + DAY_MS - 1000, endExclusiveMs: startMs + DAY_MS }
}

/** The typed reason: trimmed, 1 to 500 characters. Null when blank, not text or too long. */
export function lateReason(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= LATE_REASON_MAX ? text : null
}

/** The text the amendment and the audit line carry for a late close. */
export function lateAmendmentReason(reason: string): string {
  return `Late close: ${reason}`
}

/** An administrator always may; anyone else only with the stored value exactly true (a string, a 1 or a missing key is off). */
export function holdsLateClosePermission(merged: Record<string, unknown>, isAdministrator: boolean): boolean {
  return isAdministrator || merged[LATE_CLOSE_PERMISSION] === true
}
