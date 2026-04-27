// ── CSV Export Utility ─────────────────────────────────────────────────────────
// Shared CSV download helper used across Dashboard, Products, Contacts, and Utils.

/**
 * Trigger a browser CSV download from an array of row objects.
 * Column headers are derived from the keys of the first row.
 * @param {string} filename - Desired download filename (e.g. 'products-2024-01-01.csv')
 * @param {Object[]} rows   - Array of plain objects (all rows must share the same keys)
 */
export function downloadCSV(filename, rows) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = v => {
    if (v == null) return ''
    let s = String(v)
    if (/^[=+\-@]/.test(s) || /^[\t\r]/.test(s)) {
      s = `'${s}`
    }
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
