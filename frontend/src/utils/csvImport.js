import { normalizeDiscountPercent, normalizePriceValue } from './pricing.js'

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

export function normalizeNumericText(value) {
  return String(value ?? '')
    .replace(/[\u17E0-\u17E9\u0660-\u0669\u06F0-\u06F9]/g, normalizeDigit)
    .replace(/\u00A0/g, ' ')
    .trim()
}

function countDelimiter(line, delimiter) {
  let count = 0
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
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

export function detectCsvDelimiter(text) {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] || ''
  const candidates = [',', '\t', ';']
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ','
}

export function splitCsvLine(line, delimiter = ',') {
  const result = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < String(line || '').length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

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
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

export function parseDelimitedRows(text, { delimiter = detectCsvDelimiter(text) } = {}) {
  const source = stripBom(text)
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

export function normalizeCsvKey(value) {
  return stripBom(value)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

export function parseCsvRows(text, options = {}) {
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
        row[header] = String(values[headerIndex] ?? '').trim()
      })
      return row
    })
    .filter((row) => Object.entries(row).some(([key, value]) => key !== '_rowNumber' && String(value || '').trim() !== ''))
}

function removeCurrencyNoise(value) {
  return normalizeNumericText(value)
    .replace(/[\u17DB$€£¥₩฿]|(?:usd|khr|riel|reil|dollar|dollars)/gi, '')
    .replace(/[^\d.,+\-\s()]/g, '')
    .trim()
}

function normalizeNumberSeparators(value) {
  let text = removeCurrencyNoise(value)
  if (!text) return ''
  const negativeByParens = /^\(.*\)$/.test(text)
  text = text.replace(/[()]/g, '')
  const negative = negativeByParens || /^-/.test(text)
  text = text.replace(/[+-]/g, '').replace(/\s+/g, ' ')

  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  let decimalSeparator = ''
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? '.' : ','
  } else if (lastComma >= 0) {
    const after = text.slice(lastComma + 1).replace(/\D/g, '')
    const before = text.slice(0, lastComma)
    const hasSpaceGrouping = /\d\s+\d/.test(before)
    const commaCount = (text.match(/,/g) || []).length
    const looksLikeThousands = !hasSpaceGrouping && commaCount === 1 && after.length === 3 && before.replace(/\D/g, '').length <= 3
    decimalSeparator = looksLikeThousands ? '' : ','
  } else if (lastDot >= 0) {
    const after = text.slice(lastDot + 1).replace(/\D/g, '')
    const dotCount = (text.match(/\./g) || []).length
    const looksLikeThousands = dotCount > 1 && after.length === 3
    decimalSeparator = looksLikeThousands ? '' : '.'
  }

  let normalized = ''
  for (const char of text) {
    if (/\d/.test(char)) normalized += char
    else if (decimalSeparator && char === decimalSeparator) normalized += '.'
  }
  if (!normalized) return ''
  return `${negative ? '-' : ''}${normalized}`
}

export function parseCsvNumber(value, fallback = 0, options = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const normalized = normalizeNumberSeparators(value)
  if (!normalized) return fallback
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return fallback
  if (options.allowNegative === false && numeric < 0) return fallback
  return numeric
}

export function parseRequiredCsvNumber(value, field, options = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return options.fallback ?? 0
  const normalized = normalizeNumberSeparators(value)
  const numeric = normalized ? Number(normalized) : Number.NaN
  if (!Number.isFinite(numeric)) throw new Error(`Invalid ${field}`)
  if (options.allowNegative === false && numeric < 0) throw new Error(`${field} cannot be negative`)
  return numeric
}

export function normalizeCsvMoney(value, fallback = 0) {
  return normalizePriceValue(parseCsvNumber(value, fallback), fallback)
}

export function normalizeCsvPercent(value, fallback = 0) {
  return normalizeDiscountPercent(parseCsvNumber(value, fallback))
}
