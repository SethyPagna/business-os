// Ported from backend/src/importParsing.ts (Khmer/Arabic-Indic digit
// normalization, thousands/decimal separator detection, currency-noise
// stripping) plus backend/src/money.ts's normalizePriceValue. Exact
// behavioral port -- no native/Node dependencies in the original either.

const KHMER_ZERO = 0x17e0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0

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

export function parseImportNumericValue(
  value: unknown,
  fallbackValue = 0,
  options: { allowNegative?: boolean; field?: string; strict?: boolean } = {},
): number {
  const { allowNegative = false, field = 'number', strict = false } = options
  if (value === undefined || value === null || String(value).trim() === '') return fallbackValue
  const normalized = normalizeNumberSeparators(value)
  const parsed = normalized ? Number(normalized) : Number.NaN
  if (!Number.isFinite(parsed)) {
    if (strict) throw new Error(`Invalid ${field}`)
    return fallbackValue
  }
  if (!allowNegative && parsed < 0) {
    if (strict) throw new Error(`${field} cannot be negative`)
    return fallbackValue
  }
  return parsed
}

function roundUpToDecimals(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  const scaled = value * factor
  const epsilon = 1e-9
  if (value >= 0) return Math.ceil(scaled - epsilon) / factor
  return Math.floor(scaled + epsilon) / factor
}

export function normalizeImportMoney(value: unknown, fallbackValue = 0): number {
  return roundUpToDecimals(parseImportNumericValue(value, fallbackValue), 2)
}
