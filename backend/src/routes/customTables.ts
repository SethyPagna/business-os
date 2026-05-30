'use strict'
const express = require('express')
const { db } = require('../database.ts')
const { ok, err, audit, broadcast } = require('../helpers.ts')
const { authToken, requirePermission, getAuditActor } = require('../middleware.ts')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl.ts')
const { hasColumn, markColumnPresent } = require('../schemaMetadata.ts')

const router = express.Router()
const CUSTOM_TABLE_COLUMN_TYPES = new Set(['text', 'long_text', 'number', 'decimal', 'boolean', 'date', 'timestamp', 'dropdown'])
const CUSTOM_TABLE_SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt'])

function humanizeTableName(tableName = '') {
  const parts = []
  for (const part of String(tableName || '').replace(/^ct_/, '').split('_')) {
    if (part) parts.push(part.charAt(0).toUpperCase() + part.slice(1))
  }
  return parts.join(' ') || 'Custom Table'
}

function serializeCustomTable(row = {}) {
  return {
    ...row,
    display_name: humanizeTableName(row.name),
    schema: row.schema || row.columns || '[]',
  }
}

function sanitizeCustomTableName(value = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  return `ct_${raw.replace(/\W+/g, '_').replace(/^ct_+/, '').slice(0, 40)}`
}

function resolveCustomTableRow(name) {
  const tableName = sanitizeCustomTableName(name)
  if (!tableName) return null
  const row = db.prepare('SELECT * FROM custom_tables WHERE name = ? LIMIT 1').get(tableName) || null
  if (!row) return null
  ensureCustomTableRowVersioning(row.name)
  return row
}

function escapeIdentifier(value = '') {
  return String(value || '').replace(/"/g, '""')
}

function normalizeCustomTableSchema(schema = []) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error('At least one column is required')
  }
  const seenNames = new Set()
  const normalized = []
  for (const column of schema) {
    const name = String(column?.name || '').trim()
    const type = String(column?.type || 'text').trim().toLowerCase()
    if (!name) throw new Error('Every column needs a name')
    const normalizedName = name.toLowerCase()
    if (seenNames.has(normalizedName)) throw new Error(`Duplicate column name: ${name}`)
    seenNames.add(normalizedName)
    if (!CUSTOM_TABLE_COLUMN_TYPES.has(type)) throw new Error(`Unsupported column type: ${type}`)
    normalized.push({
      name,
      type,
      required: !!column?.required,
    })
  }
  return normalized
}

function tableHasColumn(tableName, columnName) {
  return hasColumn(tableName, columnName)
}

function ensureCustomTableRowVersioning(tableName) {
  const safeTableName = escapeIdentifier(tableName)
  if (!tableHasColumn(tableName, 'updated_at')) {
    db.exec(`ALTER TABLE "${safeTableName}" ADD COLUMN "updated_at" TIMESTAMPTZ`)
    db.exec(`
      UPDATE "${safeTableName}"
      SET updated_at = COALESCE(
        NULLIF(updated_at::text, '')::timestamptz,
        NULLIF(created_at::text, '')::timestamptz,
        CURRENT_TIMESTAMP
      )
      WHERE updated_at IS NULL
    `)
    markColumnPresent(tableName, 'updated_at')
  }
}

function getWritableCustomTableKeys(data = {}) {
  const keys = []
  for (const key in data) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue
    if (CUSTOM_TABLE_SYSTEM_FIELDS.has(key)) continue
    keys.push(key)
  }
  return keys
}

router.get('/', authToken, requirePermission('settings'), (req, res) => {
  const rows = db.prepare('SELECT * FROM custom_tables ORDER BY name').all()
  const payload = []
  for (const row of rows) payload.push(serializeCustomTable(row))
  res.json(payload)
})

router.post('/', authToken, requirePermission('settings'), (req, res) => {
  const { name, display_name, schema } = req.body || {}
  const actor = getAuditActor(req)
  if (!name?.trim() || !Array.isArray(schema)) return err(res, 'name and schema required')

  const tableName = sanitizeCustomTableName(name)
  if (!tableName) return err(res, 'Valid table name required')

  const typeMap = {
    text: 'TEXT',
    long_text: 'TEXT',
    number: 'INTEGER',
    decimal: 'REAL',
    boolean: 'INTEGER',
    date: 'TEXT',
    timestamp: 'TEXT',
    dropdown: 'TEXT',
  }

  let normalizedSchema = null
  try {
    normalizedSchema = normalizeCustomTableSchema(schema)
  } catch (error) {
    return err(res, error.message || 'Invalid custom table schema')
  }

  const columnParts = []
  for (const column of normalizedSchema) {
    columnParts.push(`"${escapeIdentifier(column.name)}" ${typeMap[column.type] || 'TEXT'}`)
  }
  const columns = columnParts.join(', ')

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (id SERIAL PRIMARY KEY, ${columns}, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)` )
    markColumnPresent(tableName, 'updated_at')
    const now = new Date().toISOString()
    const r = db.prepare('INSERT INTO custom_tables (name, columns, updated_at) VALUES (?,?,?)')
      .run(tableName, JSON.stringify(normalizedSchema), now)
    audit(actor.userId, actor.userName, 'create', 'custom_table', r.lastInsertRowid, {
      name: tableName,
      display_name: String(display_name || name || '').trim() || humanizeTableName(tableName),
    })
    broadcast('customTables')
    ok(res, {
      id: r.lastInsertRowid,
      name: tableName,
      display_name: String(display_name || name || '').trim() || humanizeTableName(tableName),
      schema: JSON.stringify(normalizedSchema),
      updated_at: now,
    })
  } catch (e) {
    err(res, e.message.includes('UNIQUE') ? 'Custom table already exists' : e.message)
  }
})

router.get('/:name/data', authToken, requirePermission('settings'), (req, res) => {
  try {
    const table = resolveCustomTableRow(req.params.name)
    if (!table) return res.json([])
    res.json(db.prepare(`SELECT * FROM "${table.name}" ORDER BY id DESC LIMIT 1000`).all())
  } catch {
    res.json([])
  }
})

router.post('/:name/rows', authToken, requirePermission('settings'), (req, res) => {
  const { data } = req.body || {}
  const actor = getAuditActor(req)
  if (!data) return err(res, 'data required')
  try {
    const table = resolveCustomTableRow(req.params.name)
    if (!table) return err(res, 'Custom table not found', 404)
    const keys = getWritableCustomTableKeys(data)
    const columns = []
    const placeholders = []
    const values = []
    for (const key of keys) {
      columns.push(`"${escapeIdentifier(key)}"`)
      placeholders.push('?')
      values.push(data[key])
    }
    const now = new Date().toISOString()
    columns.push('"updated_at"')
    placeholders.push('?')
    values.push(now)
    const r = db.prepare(`INSERT INTO "${table.name}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values)
    audit(actor.userId, actor.userName, 'create', 'custom_table_row', r.lastInsertRowid, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, db.prepare(`SELECT * FROM "${table.name}" WHERE id = ?`).get(r.lastInsertRowid))
  } catch (e) {
    err(res, e.message)
  }
})

router.put('/:name/rows/:id', authToken, requirePermission('settings'), (req, res) => {
  const { data } = req.body || {}
  const actor = getAuditActor(req)
  if (!data) return err(res, 'data required')
  try {
    const table = resolveCustomTableRow(req.params.name)
    if (!table) return err(res, 'Custom table not found', 404)
    const current = db.prepare(`SELECT * FROM "${table.name}" WHERE id = ?`).get(req.params.id)
    if (!current) return err(res, 'Custom table row not found', 404)
    assertUpdatedAtMatch('custom table row', current, getExpectedUpdatedAt({ ...(req.body || {}), ...(data || {}) }))
    const keys = getWritableCustomTableKeys(data)
    const sets = []
    const values = []
    for (const key of keys) {
      sets.push(`"${escapeIdentifier(key)}" = ?`)
      values.push(data[key])
    }
    sets.push('"updated_at" = ?')
    values.push(new Date().toISOString())
    values.push(req.params.id)
    db.prepare(`UPDATE "${table.name}" SET ${sets} WHERE id = ?`)
      .run(...values)
    audit(actor.userId, actor.userName, 'update', 'custom_table_row', req.params.id, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, db.prepare(`SELECT * FROM "${table.name}" WHERE id = ?`).get(req.params.id))
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.delete('/:name/rows/:id', authToken, requirePermission('settings'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const table = resolveCustomTableRow(req.params.name)
    if (!table) return err(res, 'Custom table not found', 404)
    const current = db.prepare(`SELECT * FROM "${table.name}" WHERE id = ?`).get(req.params.id)
    if (!current) return err(res, 'Custom table row not found', 404)
    assertUpdatedAtMatch('custom table row', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare(`DELETE FROM "${table.name}" WHERE id = ?`).run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'custom_table_row', req.params.id, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

module.exports = router
