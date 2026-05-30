'use strict'

const { parseImportNumericValue } = require('./importParsing')

/**
 * @typedef {'keep_existing' | 'use_imported' | 'merge_blank_only' | 'clear_value' | 'append_unique'} ImportFieldRule
 * @typedef {'keep_existing' | 'append_csv' | 'replace_with_csv'} ImageConflictMode
 */

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string} field
 * @param {number} fallbackValue
 * @param {{ allowNegative?: boolean }} [options]
 * @returns {number}
 */
function parseImportNumber(row, field, fallbackValue, { allowNegative = false } = {}) {
  return parseImportNumericValue(row?.[field], fallbackValue, {
    allowNegative,
    field,
    strict: true,
  })
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string} field
 * @param {number} [fallbackValue]
 * @returns {0 | 1 | number}
 */
function parseImportFlag(row, field, fallbackValue = 0) {
  const raw = row?.[field]
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallbackValue
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(value)) return 1
  if (['0', 'false', 'no', 'n'].includes(value)) return 0
  return fallbackValue
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string} field
 * @returns {boolean}
 */
function hasImportValue(row, field) {
  const raw = row?.[field]
  return !(raw === undefined || raw === null || String(raw).trim() === '')
}

/**
 * @param {unknown} value
 * @param {ImportFieldRule} fallback
 * @returns {ImportFieldRule}
 */
function normalizeFieldRule(value, fallback) {
  const rule = String(value || fallback || '').trim().toLowerCase()
  return ['keep_existing', 'use_imported', 'merge_blank_only', 'clear_value', 'append_unique'].includes(rule)
    ? rule
    : fallback
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function splitUniqueImportValues(value) {
  if (Array.isArray(value)) return collectImportListValues(value)
  const raw = String(value ?? '').trim()
  if (!raw) return []
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return collectImportListValues(parsed)
    } catch (_) {}
  }
  return collectImportListValues(raw.split(/[|;\n]/))
}

/**
 * @param {unknown[]} [values]
 * @returns {string[]}
 */
function collectImportListValues(values = []) {
  const items = []
  for (const item of Array.isArray(values) ? values : []) {
    const value = String(item || '').trim()
    if (value) items.push(value)
  }
  return items
}

/**
 * @param {string[]} [values]
 * @returns {Set<string>}
 */
function buildLowercaseSet(values = []) {
  const seen = new Set()
  for (const value of values || []) {
    seen.add(value.toLowerCase())
  }
  return seen
}

/**
 * @param {unknown} existingValue
 * @param {unknown} incomingValue
 * @param {boolean} hasIncomingValue
 * @returns {unknown}
 */
function appendUniqueImportValue(existingValue, incomingValue, hasIncomingValue) {
  if (!hasIncomingValue) return existingValue
  const existingItems = splitUniqueImportValues(existingValue)
  const incomingItems = splitUniqueImportValues(incomingValue)
  if (!incomingItems.length) return existingValue
  if (!existingItems.length) return incomingItems.join(' | ')
  const seen = buildLowercaseSet(existingItems)
  const merged = [...existingItems]
  for (const item of incomingItems) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged.join(' | ')
}

/**
 * @param {unknown} existingValue
 * @param {unknown} incomingValue
 * @param {boolean} hasIncomingValue
 * @param {unknown} rule
 * @param {ImportFieldRule} [fallbackRule]
 * @returns {unknown}
 */
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

/**
 * @param {unknown} mode
 * @param {unknown} action
 * @param {boolean} hasIncomingImages
 * @returns {ImageConflictMode}
 */
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
