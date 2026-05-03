'use strict'

const NAMED_PARAM = /@([A-Za-z_][A-Za-z0-9_]*)/g

const NUMERIC_FIELD_PATTERNS = [
  /^id$/,
  /_id$/,
  /^count$/,
  /^total$/,
  /_count$/,
  /^quantity$/,
  /quantity$/,
  /^stock_/,
  /_quantity$/,
  /_price_/,
  /price_/,
  /_cost_/,
  /cost_/,
  /_amount_/,
  /amount_/,
  /_total_/,
  /total_/,
  /_threshold$/,
  /threshold$/,
  /^is_/,
  /_enabled$/,
  /_verified$/,
  /_active$/,
  /_default$/,
  /_system$/,
  /_percent$/,
  /percent$/,
  /_rate$/,
  /^page$/,
  /^pageSize$/,
  /^totalPages$/,
]

const TEXT_NUMERIC_EXCEPTIONS = new Set([
  'barcode',
  'sku',
  'phone',
  'phone_lookup',
  'membership_number',
  'token_hash',
  'code',
  'public_id',
  'zip',
  'postal_code',
])

const INSERT_TABLES_WITHOUT_ID_RETURNING = new Set([
  'branch_stock',
  'settings',
])

function countPositionalPlaceholders(sql = '') {
  let count = 0
  let quote = ''
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          index += 1
        } else {
          quote = ''
        }
      }
      continue
    }
    if (char === '\'' || char === '"') {
      quote = char
      continue
    }
    if (char === '?') count += 1
  }
  return count
}

function stripTrailingSemicolon(sql = '') {
  return String(sql || '').trim().replace(/;\s*$/, '')
}

function replacePositionalParams(sql, values, startIndex = 1) {
  let paramIndex = startIndex
  let quote = ''
  let output = ''
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]
    if (quote) {
      output += char
      if (char === quote) {
        if (next === quote) {
          output += next
          index += 1
        } else {
          quote = ''
        }
      }
      continue
    }
    if (char === '\'' || char === '"') {
      quote = char
      output += char
      continue
    }
    if (char === '?') {
      output += `$${paramIndex}`
      paramIndex += 1
      continue
    }
    output += char
  }
  return { sql: output, nextIndex: paramIndex, values }
}

function normalizePortableSqlFunctions(sql = '') {
  return String(sql || '')
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bdatetime\s*\(\s*([^)]+?)\s*\)/gi, '$1')
    .replace(/\bdate\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\)/gi, "NULLIF($1::text, '')::timestamptz::date")
    .replace(/\bCOALESCE\s*\(\s*trim\s*\(([^)]+)\)\s*,\s*''\s*\)/gi, "COALESCE(trim($1), '')")
    .replace(/\s+COLLATE\s+NOCASE\b/gi, '')
    .replace(/\bMAX\s*\(\s*0\s*,/gi, 'GREATEST(0,')
    .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
}

function translateInsertOrIgnore(sql = '') {
  return String(sql || '').replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
}

function translateParameters(sql, params) {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const values = []
    const seen = new Map()
    const translated = sql.replace(NAMED_PARAM, (_token, key) => {
      if (!seen.has(key)) {
        seen.set(key, values.length + 1)
        values.push(params[key])
      }
      return `$${seen.get(key)}`
    })
    const positionalCount = countPositionalPlaceholders(translated)
    if (positionalCount > 0) {
      const positionalValues = Array.isArray(params.__positional) ? params.__positional : []
      const merged = [...values, ...positionalValues]
      const replaced = replacePositionalParams(translated, merged, values.length + 1)
      return { sql: replaced.sql, values: merged }
    }
    return { sql: translated, values }
  }
  const values = Array.isArray(params) ? params : []
  const replaced = replacePositionalParams(sql, values, 1)
  return { sql: replaced.sql, values }
}

function appendReturning(sql, mode) {
  const trimmed = stripTrailingSemicolon(sql)
  if (/\bRETURNING\b/i.test(trimmed)) return trimmed
  if (mode === 'run_insert') {
    const table = getInsertTableName(trimmed)
    if (INSERT_TABLES_WITHOUT_ID_RETURNING.has(table)) return `${trimmed} RETURNING 1 AS __changed`
    return `${trimmed} RETURNING id`
  }
  if (mode === 'run_change') return `${trimmed} RETURNING 1 AS __changed`
  return trimmed
}

function getInsertTableName(sql = '') {
  const match = String(sql || '').match(/^\s*INSERT\s+INTO\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i)
  return String(match?.[1] || match?.[2] || '').toLowerCase()
}

function translateSql(sql, params = [], options = {}) {
  let normalized = normalizePortableSqlFunctions(stripTrailingSemicolon(sql))
  let isInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(normalized)
  normalized = translateInsertOrIgnore(normalized)
  if (isInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(normalized)) {
    normalized = `${normalized} ON CONFLICT DO NOTHING`
  }
  const { sql: parameterized, values } = translateParameters(normalized, params)
  const firstToken = parameterized.trim().split(/\s+/)[0]?.toUpperCase()
  const mode = options.mode || ''
  let finalSql = parameterized
  if (mode === 'run') {
    if (firstToken === 'INSERT') finalSql = appendReturning(finalSql, 'run_insert')
    else if (firstToken === 'UPDATE' || firstToken === 'DELETE') finalSql = appendReturning(finalSql, 'run_change')
  }
  return { sql: finalSql, values, returnsRows: firstToken === 'SELECT' || /\bRETURNING\b/i.test(finalSql) }
}

function coerceRowValue(key, value) {
  if (value === null || value === undefined) return value
  const field = String(key || '')
  if (TEXT_NUMERIC_EXCEPTIONS.has(field)) return value
  if (!NUMERIC_FIELD_PATTERNS.some((pattern) => pattern.test(field))) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return value
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return value
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) || Number.isFinite(parsed) ? parsed : value
}

function coerceRow(row = {}) {
  const out = {}
  Object.entries(row || {}).forEach(([key, value]) => {
    out[key] = coerceRowValue(key, value)
  })
  return out
}

module.exports = {
  coerceRow,
  countPositionalPlaceholders,
  translateSql,
}
