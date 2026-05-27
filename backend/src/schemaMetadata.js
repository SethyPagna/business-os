'use strict'

const { db } = require('./database')

const columnPresenceCache = new Map()
const firstColumnCache = new Map()

function normalizeName(value) {
  return String(value || '').trim().toLowerCase()
}

function columnKey(tableName, columnName) {
  return `${normalizeName(tableName)}:${normalizeName(columnName)}`
}

function normalizeNames(values = []) {
  const names = []
  for (const value of values || []) {
    const name = normalizeName(value)
    if (name) names.push(name)
  }
  return names
}

function normalizeColumnRows(rows = []) {
  const names = []
  for (const row of rows || []) {
    const name = normalizeName(row?.name)
    if (name) names.push(name)
  }
  return names
}

function candidateKey(tableName, columnNames = []) {
  return `${normalizeName(tableName)}:${normalizeNames(columnNames).join('|')}`
}

function listColumns(tableName) {
  return db.prepare(`
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ?
    ORDER BY ordinal_position
  `).all(tableName)
}

function hasColumn(tableName, columnName) {
  const key = columnKey(tableName, columnName)
  if (columnPresenceCache.has(key)) return columnPresenceCache.get(key)
  try {
    const target = normalizeName(columnName)
    let present = false
    for (const column of listColumns(tableName)) {
      if (normalizeName(column?.name) === target) {
        present = true
        break
      }
    }
    columnPresenceCache.set(key, present)
    return present
  } catch (_) {
    columnPresenceCache.set(key, false)
    return false
  }
}

function firstExistingColumn(tableName, columnNames = []) {
  const candidates = normalizeNames(columnNames)
  const key = candidateKey(tableName, candidates)
  if (firstColumnCache.has(key)) return firstColumnCache.get(key)
  try {
    const present = new Set(normalizeColumnRows(listColumns(tableName)))
    let match = null
    for (const candidate of candidates) {
      if (present.has(candidate)) {
        match = candidate
        break
      }
    }
    firstColumnCache.set(key, match)
    for (const candidate of candidates) {
      columnPresenceCache.set(columnKey(tableName, candidate), present.has(candidate))
    }
    return match
  } catch (_) {
    firstColumnCache.set(key, null)
    for (const candidate of candidates) {
      columnPresenceCache.set(columnKey(tableName, candidate), false)
    }
    return null
  }
}

function markColumnPresent(tableName, columnName) {
  const table = normalizeName(tableName)
  const column = normalizeName(columnName)
  if (!table || !column) return
  columnPresenceCache.set(columnKey(table, column), true)
  for (const [key, selectedColumn] of firstColumnCache.entries()) {
    if (key.startsWith(`${table}:`) && !selectedColumn) firstColumnCache.delete(key)
  }
}

module.exports = {
  firstExistingColumn,
  hasColumn,
  markColumnPresent,
}
