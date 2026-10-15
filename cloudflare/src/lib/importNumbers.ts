// Ported from backend/src/importParsing.ts (Khmer/Arabic-Indic digit
// normalization, thousands/decimal separator detection, currency-noise
// stripping) plus backend/src/money.ts's normalizePriceValue. Exact
// behavioral port -- no native/Node dependencies in the original either.

import { MAX_MONEY_ABS, roundMoney4, sellingPriceCeilCent } from './moneyPrecision'

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

export function normalizeImportMoney(value: unknown, fallbackValue = 0): number {
  // Legacy sale imports retain their existing policy until versioned sale
  // settlement is activated. Cost writers opt into the explicit helper below.
  const parsed = parseImportNumericValue(value, fallbackValue)
  return parsed >= 0 ? Math.ceil(parsed * 100 - 1e-9) / 100 : Math.floor(parsed * 100 + 1e-9) / 100
}

// A cost cell that is blank, absent or unreadable is UNKNOWN: pass fallbackValue null to get null back (never
// 0, which is a recorded free cost). A typed 0 still returns 0.
export function normalizeImportCost4(value: unknown, fallbackValue: number): number
export function normalizeImportCost4(value: unknown, fallbackValue: null): number | null
export function normalizeImportCost4(value: unknown): number
export function normalizeImportCost4(value: unknown, fallbackValue: number | null = 0): number | null {
  if (fallbackValue === null) {
    const parsed = parseImportNumericValue(value, Number.NaN)
    return Number.isFinite(parsed) ? roundMoney4(parsed) : null
  }
  return roundMoney4(parseImportNumericValue(value, fallbackValue))
}

/** Catalog selling/wholesale defaults only; round original input directly. */
export function normalizeImportSellingPrice(value: unknown, fallbackValue = 0): number {
  return sellingPriceCeilCent(parseImportNumericValue(value, fallbackValue))
}

export function parseImportCost(value: unknown): number | null | 'invalid' {
  if (value == null || String(value).trim() === '' || /^null$/i.test(String(value).trim())) return null
  const text = normalizeNumericText(value).replace(/[\u17DB$€£¥₩฿]|(?:usd|khr|riel|reil|dollars?)/gi, '').trim()
  if (!/^[+\-]?[\d.,\s]+$/.test(text) || !/\d/.test(text)) return 'invalid'
  const number = parseImportNumericValue(value, NaN)
  if (!Number.isFinite(number) || number < 0 || number > MAX_MONEY_ABS || !Number.isSafeInteger(Math.round(number * 10000))) return 'invalid'
  try { return roundMoney4(number) } catch { return 'invalid' }
}

export function importCostSource(row: Record<string, unknown>, fields: readonly string[]): unknown {
  const field = fields.find(key => Object.hasOwn(row, key))
  return field === undefined ? undefined : row[field]
}
