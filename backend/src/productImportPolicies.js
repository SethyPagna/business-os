'use strict'

const { parseImportNumericValue } = require('./importParsing')

function parseImportNumber(row, field, fallbackValue, { allowNegative = false } = {}) {
  return parseImportNumericValue(row?.[field], fallbackValue, {
    allowNegative,
    field,
    strict: true,
  })
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
  return ['keep_existing', 'use_imported', 'merge_blank_only', 'clear_value', 'append_unique'].includes(rule)
    ? rule
    : fallback
}

function splitUniqueImportValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  const raw = String(value ?? '').trim()
  if (!raw) return []
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    } catch (_) {}
  }
  return raw
    .split(/[|;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function appendUniqueImportValue(existingValue, incomingValue, hasIncomingValue) {
  if (!hasIncomingValue) return existingValue
  const existingItems = splitUniqueImportValues(existingValue)
  const incomingItems = splitUniqueImportValues(incomingValue)
  if (!incomingItems.length) return existingValue
  if (!existingItems.length) return incomingItems.join(' | ')
  const seen = new Set(existingItems.map((item) => item.toLowerCase()))
  const merged = [...existingItems]
  incomingItems.forEach((item) => {
    const key = item.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    merged.push(item)
  })
  return merged.join(' | ')
}

function resolveImportValue(existingValue, incomingValue, hasIncomingValue, rule, fallbackRule = 'use_imported') {
  const effectiveRule = normalizeFieldRule(rule, fallbackRule)
  if (effectiveRule === 'keep_existing') return existingValue
  if (effectiveRule === 'clear_value') return null
  if (effectiveRule === 'append_unique') return appendUniqueImportValue(existingValue, incomingValue, hasIncomingValue)
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
  appendUniqueImportValue,
}
