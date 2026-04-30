'use strict'

const { normalizePriceValue } = require('./money')

const KHMER_ZERO = 0x17E0
const ARABIC_INDIC_ZERO = 0x0660
const EXTENDED_ARABIC_INDIC_ZERO = 0x06F0

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

function parseImportNumericValue(value, fallbackValue = 0, { allowNegative = false, field = 'number', strict = false } = {}) {
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

function normalizeImportMoney(value, fallbackValue = 0) {
  return normalizePriceValue(parseImportNumericValue(value, fallbackValue))
}

module.exports = {
  normalizeNumericText,
  parseImportNumericValue,
  normalizeImportMoney,
}
