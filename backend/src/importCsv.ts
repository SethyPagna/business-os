'use strict'

const fs = require('fs')

const KHMER_ZERO = 0x17E0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06F0

/**
 * @typedef {{ delimiter?: string }} CsvParseOptions
 * @typedef {{ delimiter?: string, batchSize?: string | number, highWaterMark?: number }} CsvBatchOptions
 * @typedef {Record<string, unknown> & { _rowNumber?: number }} ParsedCsvRow
 */

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '')
}

/**
 * @param {string} char
 */
function normalizeDigit(char) {
  const code = char.charCodeAt(0)
  if (code >= KHMER_ZERO && code <= KHMER_ZERO + 9) return String(code - KHMER_ZERO)
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO)
  if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) return String(code - EXTENDED_ARABIC_INDIC_ZERO)
  return char
}

/**
 * @param {unknown} value
 */
function normalizeNumericText(value) {
  return String(value ?? '')
    .replace(/[\u17E0-\u17E9\u0660-\u0669\u06F0-\u06F9]/g, normalizeDigit)
    .replace(/\u00A0/g, ' ')
    .trim()
}

/**
 * @param {unknown} line
 * @param {string} delimiter
 */
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

/**
 * @param {unknown} text
 */
function detectCsvDelimiter(text) {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] || ''
  const delimiters = [',', '\t', ';']
  let bestDelimiter = ','
  let bestCount = -1
  for (const delimiter of delimiters) {
    const count = countDelimiter(firstLine, delimiter)
    if (count > bestCount) {
      bestDelimiter = delimiter
      bestCount = count
    }
  }
  return bestDelimiter
}

/**
 * @param {unknown} text
 * @param {CsvParseOptions} options
 */
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
      if (hasDelimitedRowContent(row)) rows.push(row)
      row = []
      current = ''
      continue
    }

    current += char
  }

  row.push(current)
  if (hasDelimitedRowContent(row)) rows.push(row)
  return rows
}

function normalizeCsvKey(value) {
  return stripBom(value)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

/**
 * @param {unknown[]} values
 */
function normalizeCsvHeaders(values = []) {
  const headers = []
  for (const value of values || []) {
    headers.push(normalizeCsvKey(value))
  }
  return headers
}

/**
 * @param {unknown[]} values
 */
function hasDelimitedRowContent(values = []) {
  for (const value of values || []) {
    if (String(value || '').trim() !== '') return true
  }
  return false
}

/**
 * @param {ParsedCsvRow} row
 */
function hasParsedCsvRowContent(row = {}) {
  for (const [key, value] of Object.entries(row || {})) {
    if (key !== '_rowNumber' && String(value || '').trim() !== '') return true
  }
  return false
}

/**
 * @param {unknown[][]} rows
 */
function buildParsedCsvRows(rows = []) {
  const parsedRows = []
  const headers = normalizeCsvHeaders(rows[0] || [])
  for (let index = 1; index < rows.length; index += 1) {
    const row = csvValuesToRow(rows[index], headers, index + 1)
    if (hasParsedCsvRowContent(row)) parsedRows.push(row)
  }
  return parsedRows
}

/**
 * @param {unknown} text
 * @param {CsvParseOptions} options
 */
function parseCsvRows(text, options = {}) {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, { delimiter })
  if (rows.length < 2) return []
  return buildParsedCsvRows(rows)
}

/**
 * @param {string} filePath
 */
async function detectCsvDelimiterFromFile(filePath) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const result = await handle.read(buffer, 0, buffer.length, 0)
    return detectCsvDelimiter(buffer.slice(0, result.bytesRead).toString('utf8'))
  } finally {
    await handle.close()
  }
}

/**
 * @param {unknown[]} values
 * @param {string[]} headers
 * @param {number} rowNumber
 */
function csvValuesToRow(values, headers, rowNumber) {
  const row = { _rowNumber: rowNumber }
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const header = headers[headerIndex]
    if (!header) continue
    const value = values[headerIndex]
    row[header] = typeof value === 'string' ? value.normalize('NFC').trim() : value
  }
  return row
}

/**
 * @param {unknown} values
 */
function hasCsvContent(values) {
  return Array.isArray(values) && hasDelimitedRowContent(values)
}

/**
 * @param {string} filePath
 * @param {CsvBatchOptions} options
 */
async function* parseCsvRowBatchesFromFile(filePath, options = {}) {
  const delimiter = options.delimiter || await detectCsvDelimiterFromFile(filePath)
  const batchSize = Math.max(1, Math.min(5000, Number(options.batchSize || 250)))
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: options.highWaterMark || 64 * 1024 })
  let headers = null
  let row = []
  let current = ''
  let inQuotes = false
  let initialized = false
  let carry = ''
  let skipNextLf = false
  let recordNumber = 0
  let batch = []

  const emitRecord = async function* () {
    row.push(current)
    current = ''
    if (hasCsvContent(row)) {
      recordNumber += 1
      if (!headers) {
        headers = normalizeCsvHeaders(row)
      } else {
        batch.push(csvValuesToRow(row, headers, recordNumber))
        if (batch.length >= batchSize) {
          yield batch
          batch = []
        }
      }
    }
    row = []
  }

  async function* processChunk(sourceChunk, flush = false) {
    let source = sourceChunk
    if (!initialized) {
      source = stripBom(source)
      initialized = true
    }
    if (carry) {
      source = carry + source
      carry = ''
    }
    if (!flush && (source.endsWith('"') || source.endsWith('\r'))) {
      carry = source.slice(-1)
      source = source.slice(0, -1)
    }

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index]
      const nextChar = source[index + 1]

      if (skipNextLf && char === '\n') {
        skipNextLf = false
        continue
      }
      skipNextLf = false

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
        if (char === '\r') skipNextLf = true
        yield* emitRecord()
        continue
      }

      current += char
    }
  }

  for await (const chunk of stream) {
    yield* processChunk(String(chunk || ''))
  }
  if (carry) yield* processChunk('', true)
  row.push(current)
  if (hasCsvContent(row)) {
    recordNumber += 1
    if (!headers) {
      headers = normalizeCsvHeaders(row)
    } else {
      batch.push(csvValuesToRow(row, headers, recordNumber))
    }
  }
  if (batch.length) yield batch
}

module.exports = {
  detectCsvDelimiter,
  detectCsvDelimiterFromFile,
  normalizeCsvKey,
  normalizeNumericText,
  parseCsvRowBatchesFromFile,
  parseCsvRows,
  parseDelimitedRows,
}
