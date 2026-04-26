'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, broadcast } = require('../helpers')
const { authToken } = require('../middleware')

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

// GET /api/custom-tables
router.get('/', authToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM custom_tables ORDER BY name').all()
  res.json(rows.map(serializeCustomTable))
})

// POST /api/custom-tables  — create table + schema record
router.post('/', authToken, (req, res) => {
  const { name, display_name, schema } = req.body || {}
  if (!name?.trim() || !Array.isArray(schema)) return err(res, 'name and schema required')

  const tableName = 'ct_' + name.toLowerCase().replace(/\W+/g, '_').slice(0, 40)
  const TYPE_MAP  = { text: 'TEXT', long_text: 'TEXT', number: 'INTEGER', decimal: 'REAL',
                      boolean: 'INTEGER', date: 'TEXT', timestamp: 'TEXT', dropdown: 'TEXT' }
  const columns   = schema
    .map(col => `"${col.name.replace(/"/g, '')}" ${TYPE_MAP[col.type] || 'TEXT'}`)
    .join(', ')

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}"
      (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columns}, created_at TEXT DEFAULT (datetime('now')))`)
    const r = db.prepare('INSERT INTO custom_tables (name, columns) VALUES (?,?)')
      .run(tableName, JSON.stringify(schema))
    broadcast('customTables')
    ok(res, {
      id: r.lastInsertRowid,
      name: tableName,
      display_name: String(display_name || name || '').trim() || humanizeTableName(tableName),
      schema: JSON.stringify(schema),
    })
  } catch (e) { err(res, e.message) }
})

// GET /api/custom-tables/:name/data
router.get('/:name/data', authToken, (req, res) => {
  try {
    res.json(db.prepare(`SELECT * FROM "${req.params.name}" ORDER BY id DESC LIMIT 1000`).all())
  } catch { res.json([]) }
})

// POST /api/custom-tables/:name/rows
router.post('/:name/rows', authToken, (req, res) => {
  const { data } = req.body || {}
  if (!data) return err(res, 'data required')
  try {
    const keys = Object.keys(data)
    const cols = keys.map(k => `"${k}"`).join(', ')
    const vals = keys.map(() => '?').join(', ')
    const r = db.prepare(`INSERT INTO "${req.params.name}" (${cols}) VALUES (${vals})`).run(...keys.map(k => data[k]))
    broadcast('customTables')
    ok(res, { id: r.lastInsertRowid })
  } catch (e) { err(res, e.message) }
})

// PUT /api/custom-tables/:name/rows/:id
router.put('/:name/rows/:id', authToken, (req, res) => {
  const { data } = req.body || {}
  if (!data) return err(res, 'data required')
  try {
    const keys = Object.keys(data).filter(k => k !== 'id')
    const sets = keys.map(k => `"${k}" = ?`).join(', ')
    db.prepare(`UPDATE "${req.params.name}" SET ${sets} WHERE id = ?`)
      .run(...keys.map(k => data[k]), req.params.id)
    broadcast('customTables')
    ok(res, {})
  } catch (e) { err(res, e.message) }
})

// DELETE /api/custom-tables/:name/rows/:id
router.delete('/:name/rows/:id', authToken, (req, res) => {
  try {
    db.prepare(`DELETE FROM "${req.params.name}" WHERE id = ?`).run(req.params.id)
    broadcast('customTables')
    ok(res, {})
  } catch (e) { err(res, e.message) }
})

module.exports = router
