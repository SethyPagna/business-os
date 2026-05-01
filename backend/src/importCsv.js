'use strict'

const KHMER_ZERO = 0x17E0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06F0

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '')
}

function normalizeDigit(char) {
  const code = char.charCodeAt(0)
  if (code >= KHMER_ZERO && code <= KHMER_ZERO + 9) return String(code - KHMER_ZERO)
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO)
  if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) return String(code - EXTENDED_ARABIC_INDIC_ZERO)
  return char
}

function normalizeNumericText(value) {
  return String(value ?? '')
    .replace(/[\u17E0-\u17E9\u0660-\u0669\u06F0-\u06F9]/g, normalizeDigit)
    .replace(/\u00A0/g, ' ')
    .trim()
}

function countDelimiter(line, delimiter) {
  let count = 0
  let inQuotes = false
  for (let index = 0; index < String(line || '').length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]
    if (char === '"' && inQuotes && nextChar === '"') {
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) count += 1
  }
  return count
}

function detectCsvDelimiter(text) {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] || ''
  return [',', '\t', ';']
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ','
}

function parseDelimitedRows(text, { delimiter = detectCsvDelimiter(text) } = {}) {
  const source = stripBom(String(text || ''))
  const rows = []
  let row = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(current)
      if (row.some((value) => String(value || '').trim() !== '')) rows.push(row)
      row = []
      current = ''
      continue
    }

    current += char
  }

  row.push(current)
  if (row.some((value) => String(value || '').trim() !== '')) rows.push(row)
  return rows
}

function normalizeCsvKey(value) {
  return stripBom(value)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

function parseCsvRows(text, options = {}) {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, { delimiter })
  if (rows.length < 2) return []
  const headers = rows[0].map((value) => normalizeCsvKey(value))
  return rows
    .slice(1)
    .map((values, index) => {
      const row = { _rowNumber: index + 2 }
      headers.forEach((header, headerIndex) => {
        if (!header) return
        const value = values[headerIndex]
        row[header] = typeof value === 'string' ? value.normalize('NFC').trim() : value
      })
      return row
    })
    .filter((row) => Object.entries(row).some(([key, value]) => key !== '_rowNumber' && String(value || '').trim() !== ''))
}

module.exports = {
  detectCsvDelimiter,
  normalizeCsvKey,
  normalizeNumericText,
  parseCsvRows,
  parseDelimitedRows,
}
