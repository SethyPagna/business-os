'use strict'

const SUSPICIOUS_REPEATED_QUESTION_RE = /\?{2,}/
const SUSPICIOUS_MOJIBAKE_RE = /(?:Ã¯Â¿|Ã¢â‚¬|Ã¢â€š|Ãƒ[\x80-\xBF]|Ã‚[\x80-\xBF])/i
const SUSPICIOUS_SINGLE_QUESTION_RE = /(?:[A-Za-z\u00C0-\u024F]\?[A-Za-z\u00C0-\u024F])|(?:[A-Za-z\u00C0-\u024F]'\?[A-Za-z\u00C0-\u024F])|(?:^\?+$)/u

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

function hasSuspiciousCatalogText(value) {
  if (typeof value !== 'string') return false
  const normalized = normalizeCatalogText(value)
  if (!normalized) return false
  if (normalized.includes('\ufffd')) return true
  if (SUSPICIOUS_REPEATED_QUESTION_RE.test(normalized)) return true
  if (SUSPICIOUS_SINGLE_QUESTION_RE.test(normalized)) return true
  return SUSPICIOUS_MOJIBAKE_RE.test(normalized)
}

function listSuspiciousCatalogFields(record = {}, fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => String(field || '').trim())
    .filter(Boolean)
    .filter((field) => hasSuspiciousCatalogText(record?.[field]))
}

function assertCatalogTextIntegrity(record = {}, fields = [], label = 'catalog text') {
  const suspiciousFields = listSuspiciousCatalogFields(record, fields)
  if (!suspiciousFields.length) return
  throw new Error(`${label} looks corrupted in: ${suspiciousFields.join(', ')}`)
}

function normalizeOptionList(values = []) {
  const canonical = new Map()
  ;(Array.isArray(values) ? values : [])
    .map((value) => normalizeCatalogText(value))
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLocaleLowerCase()
      if (!canonical.has(key)) canonical.set(key, value)
    })
  return Array.from(canonical.values()).sort((left, right) => left.localeCompare(right))
}

module.exports = {
  assertCatalogTextIntegrity,
  hasSuspiciousCatalogText,
  listSuspiciousCatalogFields,
  normalizeCatalogText,
  normalizeOptionList,
}
