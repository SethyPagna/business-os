import { normalizeDiscountPercent, normalizePriceValue } from './pricing.ts'

const KHMER_ZERO = 0x17E0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06F0

type DecodeInput = ArrayBuffer | ArrayBufferView | Uint8Array | null | undefined
type CsvRow = Record<string, string | number>

interface Utf16Detection {
  encoding: '' | 'utf-16le' | 'utf-16be'
  offset: number
}

interface ParseDelimitedOptions {
  delimiter?: string
}

interface ParseCsvNumberOptions {
  allowNegative?: boolean
  fallback?: number
}

function stripBom(value: unknown): string {
  return String(value || '').replace(/^\uFEFF/, '')
}

function toUint8Array(value: DecodeInput): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array()
}

function detectUtf16Encoding(bytes: Uint8Array): Utf16Detection {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { encoding: 'utf-16le', offset: 2 }
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { encoding: 'utf-16be', offset: 2 }
  }

  const sampleLength = Math.min(bytes.length, 256)
  let evenNulls = 0
  let oddNulls = 0
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0x00) continue
    if (index % 2 === 0) evenNulls += 1
    else oddNulls += 1
  }

  const threshold = Math.max(4, Math.floor(sampleLength / 10))
  if (oddNulls >= threshold && oddNulls >= evenNulls * 2) return { encoding: 'utf-16le', offset: 0 }
  if (evenNulls >= threshold && evenNulls >= oddNulls * 2) return { encoding: 'utf-16be', offset: 0 }
  return { encoding: '', offset: 0 }
}

function decodeUtf16Be(bytes: Uint8Array): string {
  const safeLength = bytes.length - (bytes.length % 2)
  const swapped = new Uint8Array(safeLength)
  for (let index = 0; index < safeLength; index += 2) {
    swapped[index] = bytes[index + 1]
    swapped[index + 1] = bytes[index]
  }
  return new TextDecoder('utf-16le').decode(swapped)
}

export function decodeTextBuffer(value: DecodeInput): string {
  const bytes = toUint8Array(value)
  if (!bytes.length) return ''

  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return stripBom(new TextDecoder('utf-8').decode(bytes)).normalize('NFC')
  }

  const { encoding, offset } = detectUtf16Encoding(bytes)
  if (encoding === 'utf-16le') {
    return stripBom(new TextDecoder('utf-16le').decode(bytes.subarray(offset))).normalize('NFC')
  }
  if (encoding === 'utf-16be') {
    return stripBom(decodeUtf16Be(bytes.subarray(offset))).normalize('NFC')
  }

  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).normalize('NFC')
  } catch (_) {
    return stripBom(new TextDecoder('utf-8').decode(bytes)).normalize('NFC')
  }
}

function normalizeDigit(char: string): string {
  const code = char.charCodeAt(0)
  if (code >= KHMER_ZERO && code <= KHMER_ZERO + 9) return String(code - KHMER_ZERO)
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO)
  if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) return String(code - EXTENDED_ARABIC_INDIC_ZERO)
  return char
}

export function normalizeNumericText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u17E0-\u17E9\u0660-\u0669\u06F0-\u06F9]/g, normalizeDigit)
    .replace(/\u00A0/g, ' ')
    .trim()
}

function countDelimiter(line: string, delimiter: string): number {
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

export function detectCsvDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] || ''
  const candidates = [',', '\t', ';']
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ','
}

export function splitCsvLine(line: unknown, delimiter = ','): string[] {
  const result: string[] = []
  const source = String(line || '')
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
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

export function parseDelimitedRows(text: string, { delimiter = detectCsvDelimiter(text) }: ParseDelimitedOptions = {}): string[][] {
  const source = stripBom(text)
  const rows: string[][] = []
  let row: string[] = []
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

export function normalizeCsvKey(value: unknown): string {
  return stripBom(value)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

// Reverses csv.ts's forceExcelText() -- a value shaped exactly like
// ="text" (no embedded quotes) is that deliberate Excel-text wrap, not a
// real formula a user typed, so unwrap it back to the plain value here.
// This also covers files a user has protected the same well-known way
// manually in Excel (typing ="0012345678905" into a barcode cell so it
// round-trips through Excel as text) -- without this, either case would
// import the literal ="..." text instead of the value it represents.
function unwrapExcelFormulaText(value: string): string {
  const match = /^="([^"]*)"$/.exec(value)
  return match ? match[1] : value
}

// Real import-file audit (Aug 22 2026) flagged this as a genuine gap: a
// file with duplicate-looking headers (most commonly an Excel/CSV
// re-export artifact, e.g. `discount_ends_at` and `discount_ends_at.1`
// after a spreadsheet round-trip) currently imports silently -- each
// normalized key just overwrites the previous one in parseCsvRows' row
// object with no signal to the operator that data was dropped. This is a
// read-only detector (doesn't change parseCsvRows' own behavior/callers)
// so a caller can surface a warning before import, e.g. in
// productImportPlanner.ts's analysis output.
// Matches Excel/CSV's own duplicate-header re-export suffix, e.g. a sheet
// with two "Discount Ends At" columns re-saved as CSV becomes
// `discount_ends_at` + `discount_ends_at.1` (normalizeCsvKey lowercases but
// doesn't touch this suffix, so the two don't collide as the same key --
// `.1` just becomes its own silently-unrecognized extra column instead).
const EXCEL_DUPLICATE_SUFFIX_PATTERN = /\.\d+$/

export function getDuplicateCsvHeaders(text: string, options: ParseDelimitedOptions = {}): string[] {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, { delimiter })
  if (!rows.length) return []
  const normalizedKeys = rows[0].map((value) => normalizeCsvKey(value)).filter(Boolean)
  const keySet = new Set(normalizedKeys)
  const duplicates = new Set<string>()

  // Case 1: two headers that normalize to the exact same key -- a real
  // silent overwrite, the last one wins in parseCsvRows' row object.
  const seen = new Set<string>()
  normalizedKeys.forEach((key) => {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  })

  // Case 2: an Excel-style `.1`/`.2` suffixed header whose base name is
  // also present -- not an overwrite, but a silently-ignored extra column
  // that almost always means the same data got split across two headers.
  normalizedKeys.forEach((key) => {
    if (!EXCEL_DUPLICATE_SUFFIX_PATTERN.test(key)) return
    const base = key.replace(EXCEL_DUPLICATE_SUFFIX_PATTERN, '')
    if (base && keySet.has(base)) duplicates.add(key)
  })

  return [...duplicates]
}

// Real-file audit (Aug 23 2026, chat) -- found via the user's own uploaded
// customers-template-final.csv: column index 2 (between membership_number
// and email) had a genuinely BLANK header cell, but every data row under it
// held a real phone number -- a stale/hand-edited template where the header
// text got deleted but the column of data didn't. `parseCsvRows` below (and
// the backend's identical `csvValuesToRow` in cloudflare/src/lib/importCsv.ts)
// both `if (!header) continue`/`return` on a blank header, which silently
// drops that entire column's data with zero signal to the operator -- a
// different failure mode than getDuplicateCsvHeaders' two-headers-same-name
// case above (there, at least one of the two columns survives; here, the
// data vanishes outright). This is a read-only detector, same shape as
// getDuplicateCsvHeaders, so a caller can surface a warning before import
// instead of the data disappearing unexplained. Only flags a blank header
// that actually has data under it -- a genuinely empty spare column (no
// header, no data, common at the ragged right edge of a hand-edited sheet)
// is not a bug and stays silent.
export function getBlankCsvHeaderColumns(text: string, options: ParseDelimitedOptions = {}): number[] {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, { delimiter })
  if (rows.length < 2) return []
  const headers = rows[0].map((value) => normalizeCsvKey(value))
  const blankColumns: number[] = []
  headers.forEach((header, columnIndex) => {
    if (header) return
    const hasData = rows.slice(1).some((row) => String(row[columnIndex] ?? '').trim() !== '')
    if (hasData) blankColumns.push(columnIndex + 1) // 1-based, matches spreadsheet column numbering
  })
  return blankColumns
}

export function parseCsvRows(text: string, options: ParseDelimitedOptions = {}): CsvRow[] {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, { delimiter })
  if (rows.length < 2) return []
  const headers = rows[0].map((value) => normalizeCsvKey(value))

  return rows
    .slice(1)
    .map((values, index) => {
      const row: CsvRow = { _rowNumber: index + 2 }
      headers.forEach((header, headerIndex) => {
        if (!header) return
        row[header] = unwrapExcelFormulaText(String(values[headerIndex] ?? '').trim())
      })
      return row
    })
    .filter((row) => Object.entries(row).some(([key, value]) => key !== '_rowNumber' && String(value || '').trim() !== ''))
}

function removeCurrencyNoise(value: unknown): string {
  return normalizeNumericText(value)
    .replace(/[\u17DB$€£¥₩฿]|(?:usd|khr|riel|reil|dollar|dollars)/gi, '')
    .replace(/[^\d.,+\-\s()]/g, '')
    .trim()
}

function normalizeNumberSeparators(value: unknown): string {
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

export function parseCsvNumber(value: unknown, fallback = 0, options: ParseCsvNumberOptions = {}): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const normalized = normalizeNumberSeparators(value)
  if (!normalized) return fallback
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return fallback
  if (options.allowNegative === false && numeric < 0) return fallback
  return numeric
}

export function parseRequiredCsvNumber(value: unknown, field: string, options: ParseCsvNumberOptions = {}): number {
  if (value === undefined || value === null || String(value).trim() === '') return options.fallback ?? 0
  const normalized = normalizeNumberSeparators(value)
  const numeric = normalized ? Number(normalized) : Number.NaN
  if (!Number.isFinite(numeric)) throw new Error(`Invalid ${field}`)
  if (options.allowNegative === false && numeric < 0) throw new Error(`${field} cannot be negative`)
  return numeric
}

export function normalizeCsvMoney(value: unknown, fallback = 0): number {
  return normalizePriceValue(parseCsvNumber(value, fallback), fallback)
}

export function normalizeCsvPercent(value: unknown, fallback = 0): number {
  return normalizeDiscountPercent(parseCsvNumber(value, fallback))
}
