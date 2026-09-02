// Minimal dependency-free CSV reader/writer. Deliberately not shared with
// ops/scripts/migration/official-name-recertification.mjs's parseCsv/
// stringifyCsv -- that module's helpers are tied to its own fixed 20-column
// REVIEW_HEADERS schema for the ids-6032-6104 apply workflow; this one is
// generic (any header list) because verify-products.mjs both reads an
// arbitrary product-export schema and writes its own review-sheet schema.
// The parsing algorithm (RFC4180-ish: quoted fields, doubled-quote escaping,
// CRLF/LF tolerant) is the same shape on purpose.

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const source = String(text ?? '')
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1 }
      else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field')
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row) }
  if (!rows.length) return []
  const headers = rows[0].slice()
  if (headers.length) headers[0] = headers[0].replace(/^﻿/, '')
  return rows.slice(1)
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function stringifyCsv(rows, headers) {
  const columns = headers || (rows.length ? Object.keys(rows[0]) : [])
  const lines = [columns, ...rows.map((row) => columns.map((header) => row[header] ?? ''))]
  return `${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`
}
