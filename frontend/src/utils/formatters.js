// ── Formatters ─────────────────────────────────────────────────────────────────
// Shared date/time/number formatters used across multiple components.

/**
 * Format a UTC timestamp from the database into a human-readable local date+time string.
 * @param {string} raw - Raw timestamp string from DB
 * @returns {string}
 */
export function fmtTime(raw) {
  if (!raw) return '—'
  const value = String(raw).trim()
  const iso = value.includes('T') || value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return raw }
}

/**
 * Format a UTC timestamp into a local date string (no time).
 * @param {string} d - Raw timestamp or date string
 * @returns {string}
 */
export function fmtDate(d) {
  if (!d) return '—'
  try {
    const date = new Date(d.includes('T') ? d : d + 'Z')
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return d }
}

/**
 * Format a monetary value as a short abbreviated string (e.g. $1.2k, $3.5M).
 * @param {number} n
 * @returns {string}
 */
export function fmtShort(n) {
  if (n === undefined || n === null) return ''
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1000)    return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + n.toFixed(0)
}

/**
 * Format a count as a short abbreviated string (e.g. 1.2k).
 * @param {number} n
 * @returns {string}
 */
export function fmtCount(n) {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(Math.round(n))
}
