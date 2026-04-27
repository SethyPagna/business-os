'use strict'
const express = require('express')
const { db } = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')

const router = express.Router()

function humanizeTableName(tableName = '') {
  return String(tableName || '')
    .replace(/^ct_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Custom Table'
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
  return db.prepare('SELECT * FROM custom_tables WHERE name = ? LIMIT 1').get(tableName) || null
}

router.get('/', authToken, requirePermission('settings'), (req, res) => {
  const rows = db.prepare('SELECT * FROM custom_tables ORDER BY name').all()
  res.json(rows.map(serializeCustomTable))
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
  const columns = schema
    .map((col) => `"${String(col?.name || '').replace(/"/g, '')}" ${typeMap[col?.type] || 'TEXT'}`)
    .join(', ')

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columns}, created_at TEXT DEFAULT (datetime('now')))` )
    const r = db.prepare('INSERT INTO custom_tables (name, columns) VALUES (?,?)')
      .run(tableName, JSON.stringify(schema))
    audit(actor.userId, actor.userName, 'create', 'custom_table', r.lastInsertRowid, {
      name: tableName,
      display_name: String(display_name || name || '').trim() || humanizeTableName(tableName),
    })
    broadcast('customTables')
    ok(res, {
      id: r.lastInsertRowid,
      name: tableName,
      display_name: String(display_name || name || '').trim() || humanizeTableName(tableName),
      schema: JSON.stringify(schema),
    })
  } catch (e) {
    err(res, e.message)
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
    const keys = Object.keys(data)
    const cols = keys.map((k) => `"${k}"`).join(', ')
    const vals = keys.map(() => '?').join(', ')
    const r = db.prepare(`INSERT INTO "${table.name}" (${cols}) VALUES (${vals})`).run(...keys.map((k) => data[k]))
    audit(actor.userId, actor.userName, 'create', 'custom_table_row', r.lastInsertRowid, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, { id: r.lastInsertRowid })
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
    const keys = Object.keys(data).filter((k) => k !== 'id')
    const sets = keys.map((k) => `"${k}" = ?`).join(', ')
    db.prepare(`UPDATE "${table.name}" SET ${sets} WHERE id = ?`)
      .run(...keys.map((k) => data[k]), req.params.id)
    audit(actor.userId, actor.userName, 'update', 'custom_table_row', req.params.id, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, {})
  } catch (e) {
    err(res, e.message)
  }
})

router.delete('/:name/rows/:id', authToken, requirePermission('settings'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const table = resolveCustomTableRow(req.params.name)
    if (!table) return err(res, 'Custom table not found', 404)
    db.prepare(`DELETE FROM "${table.name}" WHERE id = ?`).run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'custom_table_row', req.params.id, {
      table_name: table.name,
    })
    broadcast('customTables')
    ok(res, {})
  } catch (e) {
    err(res, e.message)
  }
})

module.exports = router
