'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken } = require('../middleware')

// ── Units ─────────────────────────────────────────────────────────────────────
const unitsRouter = express.Router()

unitsRouter.get('/', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM units ORDER BY name').all())
})

unitsRouter.post('/', authToken, (req, res) => {
  const body = req.body || {}
  const { name, userId, userName } = typeof body === 'string' ? { name: body } : body
  if (!name?.trim()) return err(res, 'Name required')
  try {
    const r = db.prepare('INSERT INTO units (name) VALUES (?)').run(name.trim())
    audit(userId, userName, 'create', 'unit', r.lastInsertRowid, { name })
    broadcast('units')
    ok(res, { id: r.lastInsertRowid })
  } catch { err(res, 'Unit already exists') }
})

unitsRouter.delete('/:id', authToken, (req, res) => {
  const { userId, userName } = req.query
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id)
  audit(userId, userName, 'delete', 'unit', req.params.id)
  broadcast('units')
  ok(res, {})
})

// ── Custom fields ─────────────────────────────────────────────────────────────
const customFieldsRouter = express.Router()

customFieldsRouter.get('/', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM custom_fields ORDER BY entity_type, field_name').all())
})

customFieldsRouter.post('/', authToken, (req, res) => {
  const { entity_type, field_name, field_type, field_options, userId, userName } = req.body || {}
  try {
    const r = db.prepare(
      'INSERT INTO custom_fields (entity_type, field_name, field_type, field_options) VALUES (?,?,?,?)'
    ).run(entity_type, field_name, field_type || 'text', field_options || null)
    audit(userId, userName, 'create', 'custom_field', r.lastInsertRowid, { entity_type, field_name })
    broadcast('customFields')
    ok(res, { id: r.lastInsertRowid })
  } catch { err(res, 'Custom field already exists') }
})

customFieldsRouter.put('/:id', authToken, (req, res) => {
  const { field_name, field_type, field_options, userId, userName } = req.body || {}
  db.prepare('UPDATE custom_fields SET field_name = ?, field_type = ?, field_options = ? WHERE id = ?')
    .run(field_name, field_type, field_options || null, req.params.id)
  audit(userId, userName, 'update', 'custom_field', req.params.id)
  broadcast('customFields')
  ok(res, {})
})

customFieldsRouter.delete('/:id', authToken, (req, res) => {
  const { userId, userName } = req.query
  db.prepare('DELETE FROM custom_fields WHERE id = ?').run(req.params.id)
  audit(userId, userName, 'delete', 'custom_field', req.params.id)
  broadcast('customFields')
  ok(res, {})
})

module.exports = { unitsRouter, customFieldsRouter }
