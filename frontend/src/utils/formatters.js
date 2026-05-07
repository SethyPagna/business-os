// Formatters
// Shared date/time/number formatters used across multiple components.

function normalizeTimestampInput(raw) {
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
export function fmtTime(raw) {
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
export function fmtDate(raw) {
  const normalized = normalizeTimestampInput(raw)
  if (!normalized) return '—'
  try {
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return String(raw || '')
  }
}

/**
 * Format a monetary value as a short abbreviated string (e.g. $1.2k, $3.5M).
 * @param {number} n
 * @returns {string}
 */
export function fmtShort(n) {
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
export function fmtCount(n) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}
