// Local-date helpers used by the Dashboard date-range picker.
// These use the device's local date, not UTC, so dashboard presets reflect the user's wall-clock date.

function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  const d = new Date()
  return toLocalDateString(d)
}

export function offsetDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toLocalDateString(d)
}
