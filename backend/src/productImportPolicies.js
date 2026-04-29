'use strict'

function parseImportNumber(row, field, fallbackValue, { allowNegative = false } = {}) {
  const raw = row?.[field]
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallbackValue
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${field}`)
  }
  if (!allowNegative && parsed < 0) {
    throw new Error(`${field} cannot be negative`)
  }
  return parsed
}

function parseImportFlag(row, field, fallbackValue = 0) {
  const raw = row?.[field]
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallbackValue
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(value)) return 1
  if (['0', 'false', 'no', 'n'].includes(value)) return 0
  return fallbackValue
}

function hasImportValue(row, field) {
  const raw = row?.[field]
  return !(raw === undefined || raw === null || String(raw).trim() === '')
}

function normalizeFieldRule(value, fallback) {
  const rule = String(value || fallback || '').trim().toLowerCase()
  return ['keep_existing', 'use_imported', 'merge_blank_only', 'clear_value'].includes(rule)
    ? rule
    : fallback
}

function resolveImportValue(existingValue, incomingValue, hasIncomingValue, rule, fallbackRule = 'use_imported') {
  const effectiveRule = normalizeFieldRule(rule, fallbackRule)
  if (effectiveRule === 'keep_existing') return existingValue
  if (effectiveRule === 'clear_value') return null
  if (effectiveRule === 'merge_blank_only') {
    if (existingValue === undefined || existingValue === null || existingValue === '') {
      return hasIncomingValue ? incomingValue : existingValue
    }
    return existingValue
  }
  return hasIncomingValue ? incomingValue : existingValue
}

function normalizeImageConflictMode(mode, action, hasIncomingImages) {
  const value = String(mode || '').trim().toLowerCase()
  if (value === 'keep' || value === 'keep_existing') return 'keep_existing'
  if (value === 'append' || value === 'append_csv') return 'append_csv'
  if (value === 'replace' || value === 'replace_with_csv') return 'replace_with_csv'
  if (!hasIncomingImages) return 'keep_existing'
  if (action === 'override_add' || action === 'override_replace' || action === 'new') return 'replace_with_csv'
  return 'keep_existing'
}

module.exports = {
  parseImportNumber,
  parseImportFlag,
  hasImportValue,
  normalizeFieldRule,
  resolveImportValue,
  normalizeImageConflictMode,
}
