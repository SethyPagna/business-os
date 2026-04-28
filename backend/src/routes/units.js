'use strict'

const express = require('express')
const { db } = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')

const unitsRouter = express.Router()
const DEFAULT_UNIT_COLOR = '#6366f1'

function normalizeUnitColor(value) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : DEFAULT_UNIT_COLOR
}

unitsRouter.get('/', authToken, requirePermission('products'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM units ORDER BY name').all())
})

unitsRouter.post('/', authToken, requirePermission('products'), (req, res) => {
  const body = req.body || {}
  const { name, color } = typeof body === 'string' ? { name: body } : body
  const actor = getAuditActor(req)
  const trimmedName = String(name || '').trim()
  if (!trimmedName) return err(res, 'Name required')

  try {
    const normalizedColor = normalizeUnitColor(color)
    const result = db.prepare('INSERT INTO units (name, color) VALUES (?, ?)').run(trimmedName, normalizedColor)
    audit(actor.userId, actor.userName, 'create', 'unit', result.lastInsertRowid, { name: trimmedName, color: normalizedColor })
    broadcast('units')
    ok(res, { id: result.lastInsertRowid })
  } catch {
    err(res, 'Unit already exists')
  }
})

function updateUnitHandler(req, res) {
  const actor = getAuditActor(req)
  const unitId = Number(req.params.id || 0)
  const trimmedName = String(req.body?.name || '').trim()
  if (!unitId) return err(res, 'Invalid unit')
  if (!trimmedName) return err(res, 'Name required')

  try {
    const normalizedColor = normalizeUnitColor(req.body?.color)
    db.prepare('UPDATE units SET name = ?, color = ? WHERE id = ?').run(trimmedName, normalizedColor, unitId)
    audit(actor.userId, actor.userName, 'update', 'unit', unitId, { name: trimmedName, color: normalizedColor })
    broadcast('units')
    ok(res, {})
  } catch {
    err(res, 'Unit already exists')
  }
}

unitsRouter.put('/:id', authToken, requirePermission('products'), updateUnitHandler)
unitsRouter.patch('/:id', authToken, requirePermission('products'), updateUnitHandler)

unitsRouter.delete('/:id', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id)
  audit(actor.userId, actor.userName, 'delete', 'unit', req.params.id)
  broadcast('units')
  ok(res, {})
})

module.exports = { unitsRouter }
