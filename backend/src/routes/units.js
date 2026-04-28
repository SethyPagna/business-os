'use strict'

const express = require('express')
const { db } = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

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
    const result = db.prepare('INSERT INTO units (name, color, updated_at) VALUES (?, ?, ?)').run(trimmedName, normalizedColor, new Date().toISOString())
    audit(actor.userId, actor.userName, 'create', 'unit', result.lastInsertRowid, { name: trimmedName, color: normalizedColor })
    broadcast('units')
    ok(res, db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid))
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
    const current = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId)
    if (!current) return err(res, 'Unit not found', 404)
    assertUpdatedAtMatch('unit', current, getExpectedUpdatedAt(req.body || {}))
    const normalizedColor = normalizeUnitColor(req.body?.color)
    db.prepare('UPDATE units SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(trimmedName, normalizedColor, new Date().toISOString(), unitId)
    audit(actor.userId, actor.userName, 'update', 'unit', unitId, { name: trimmedName, color: normalizedColor })
    broadcast('units')
    ok(res, db.prepare('SELECT * FROM units WHERE id = ?').get(unitId))
  } catch (error) {
    if (error instanceof WriteConflictError) return sendWriteConflict(res, error)
    err(res, 'Unit already exists')
  }
}

unitsRouter.put('/:id', authToken, requirePermission('products'), updateUnitHandler)
unitsRouter.patch('/:id', authToken, requirePermission('products'), updateUnitHandler)

unitsRouter.delete('/:id', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  try {
    const current = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Unit not found', 404)
    assertUpdatedAtMatch('unit', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'unit', req.params.id)
    broadcast('units')
    ok(res, {})
  } catch (error) {
    if (error instanceof WriteConflictError) return sendWriteConflict(res, error)
    err(res, error?.message || 'Failed to delete unit')
  }
})

module.exports = { unitsRouter }
