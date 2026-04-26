// ── Date Helpers ───────────────────────────────────────────────────────────────
// Local-date helpers used by the Dashboard date-range picker.
// These use the device's LOCAL date (not UTC) intentionally so that
// "today" and "this month" reflect the user's wall-clock date.

/**
 * Return today's date as a YYYY-MM-DD string in local time.
 * @returns {string}
 */
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Return a YYYY-MM-DD string offset by `days` from today (negative = past).
 * @param {number} days - Positive or negative integer
 * @returns {string}
 */
export function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
