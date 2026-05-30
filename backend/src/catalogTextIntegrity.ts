'use strict'

const SUSPICIOUS_REPEATED_QUESTION_RE = /\?{2,}/
const SUSPICIOUS_MOJIBAKE_RE = /(?:Ã¯Â¿|Ã¢â‚¬|Ã¢â€š|Ãƒ[\x80-\xBF]|Ã‚[\x80-\xBF])/i
const SUSPICIOUS_SINGLE_QUESTION_RE = /(?:[A-Za-z\u00C0-\u024F]\?[A-Za-z\u00C0-\u024F])|(?:[A-Za-z\u00C0-\u024F]'\?[A-Za-z\u00C0-\u024F])|(?:^\?+$)/u

/**
 * @typedef {{ defaultValue?: string, preserveNull?: boolean }} CatalogTextOptions
 */

/**
 * @param {unknown} value
 * @param {CatalogTextOptions} [options]
 * @returns {string | null}
 */
function normalizeCatalogText(value, { defaultValue = '', preserveNull = false } = {}) {
  if (value === undefined || value === null) return preserveNull ? null : defaultValue
  const normalized = String(value)
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  return normalized || (preserveNull ? null : defaultValue)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasSuspiciousCatalogText(value) {
  if (typeof value !== 'string') return false
  const normalized = normalizeCatalogText(value)
  if (!normalized) return false
  if (normalized.includes('\ufffd')) return true
  if (SUSPICIOUS_REPEATED_QUESTION_RE.test(normalized)) return true
  if (SUSPICIOUS_SINGLE_QUESTION_RE.test(normalized)) return true
  return SUSPICIOUS_MOJIBAKE_RE.test(normalized)
}

/**
 * @param {Record<string, unknown>} [record]
 * @param {unknown[]} [fields]
 * @returns {string[]}
 */
function listSuspiciousCatalogFields(record = {}, fields = []) {
  const suspiciousFields = []
  for (const value of Array.isArray(fields) ? fields : []) {
    const field = String(value || '').trim()
    if (field && hasSuspiciousCatalogText(record?.[field])) {
      suspiciousFields.push(field)
    }
  }
  return suspiciousFields
}

/**
 * @param {Record<string, unknown>} [record]
 * @param {unknown[]} [fields]
 * @param {string} [label]
 * @returns {void}
 */
function assertCatalogTextIntegrity(record = {}, fields = [], label = 'catalog text') {
  const suspiciousFields = listSuspiciousCatalogFields(record, fields)
  if (!suspiciousFields.length) return
  throw new Error(`${label} looks corrupted in: ${suspiciousFields.join(', ')}`)
}

/**
 * @param {unknown[]} [values]
 * @returns {string[]}
 */
function normalizeOptionList(values = []) {
  const canonical = new Map()
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = normalizeCatalogText(rawValue)
    if (!value) continue
    const key = value.toLocaleLowerCase()
    if (!canonical.has(key)) canonical.set(key, value)
  }
  const normalized = []
  for (const value of canonical.values()) {
    normalized.push(value)
  }
  normalized.sort((left, right) => left.localeCompare(right))
  return normalized
}

module.exports = {
  assertCatalogTextIntegrity,
  hasSuspiciousCatalogText,
  listSuspiciousCatalogFields,
  normalizeCatalogText,
  normalizeOptionList,
}
