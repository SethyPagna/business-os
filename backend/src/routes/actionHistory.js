'use strict'

const express = require('express')
const { db } = require('../database')
const { ok, err, audit } = require('../helpers')
const { authToken, getAuditActor, hasPermission } = require('../middleware')

const router = express.Router()

function parseJson(value, fallback = {}) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function normalizeLimit(value) {
  const num = parseInt(value, 10)
  return Math.min(20, Math.max(1, Number.isFinite(num) ? num : 3))
}

function normalizeText(value, fallback, maxLength) {
  const text = String(value || fallback || '').trim()
  return text.slice(0, Math.max(1, Number(maxLength || 120)))
}

function serializePayload(value) {
  if (!value || typeof value !== 'object') return '{}'
  const serialized = JSON.stringify(value)
  if (serialized.length > 20_000) {
    throw new Error('Action history payload is too large')
  }
  return serialized
}

function canReadAllHistory(user, requestedAll = false) {
  return !!requestedAll && (hasPermission(user, 'settings') || hasPermission(user, 'backup'))
}

function getOwnedHistoryRow(req, id) {
  const actionId = Number(id || 0)
  if (!Number.isInteger(actionId) || actionId <= 0) return null
  return db.prepare('SELECT * FROM action_history WHERE id = ? AND created_by_id = ?').get(actionId, req.user?.id || 0)
}

function mapRow(row) {
  return {
    ...row,
    reversible: !!row.reversible,
    undo_payload: parseJson(row.undo_payload),
    redo_payload: parseJson(row.redo_payload),
  }
}

router.get('/', authToken, (req, res) => {
  try {
    const scope = normalizeText(req.query.scope, 'global', 80) || 'global'
    const limit = normalizeLimit(req.query.limit)
    const includeAll = ['1', 'true', 'yes'].includes(String(req.query.all || '').trim().toLowerCase())
    const rows = canReadAllHistory(req.user, includeAll)
      ? db.prepare(`
        SELECT *
        FROM action_history
        WHERE scope = ?
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT ?
      `).all(scope, limit)
      : db.prepare(`
        SELECT *
        FROM action_history
        WHERE scope = ? AND created_by_id = ?
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT ?
      `).all(scope, req.user?.id || 0, limit)
    ok(res, { items: rows.map(mapRow) })
  } catch (error) {
    err(res, error.message || 'Failed to load action history')
  }
})

router.post('/', authToken, (req, res) => {
  const body = req.body || {}
  const actor = getAuditActor(req, body)
  try {
    const label = normalizeText(body.label, '', 200)
    if (!label) return err(res, 'Action label required')
    const result = db.prepare(`
      INSERT INTO action_history (
        scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
        undo_payload, redo_payload, created_by_id, created_by_name
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      normalizeText(body.scope, 'global', 80) || 'global',
      body.entity ? normalizeText(body.entity, '', 80) : null,
      body.entity_id != null ? normalizeText(body.entity_id, '', 120) : null,
      label,
      body.undo_label ? normalizeText(body.undo_label, '', 200) : null,
      body.redo_label ? normalizeText(body.redo_label, '', 200) : null,
      body.reversible === false ? 0 : 1,
      body.reversible === false ? 'recorded' : 'undoable',
      serializePayload(body.undo_payload),
      serializePayload(body.redo_payload),
      actor.userId,
      actor.userName,
    )
    ok(res, { id: result.lastInsertRowid })
  } catch (error) {
    err(res, error.message || 'Failed to record action history')
  }
})

router.patch('/:id', authToken, (req, res) => {
  const body = req.body || {}
  const status = String(body.status || '').trim()
  if (!['undoable', 'redoable', 'recorded', 'failed'].includes(status)) return err(res, 'Invalid action history status')
  const actor = getAuditActor(req, body)
  try {
    const existing = getOwnedHistoryRow(req, req.params.id)
    if (!existing) return err(res, 'Action history item not found', 404)
    db.prepare(`
      UPDATE action_history
      SET status = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, body.last_error ? String(body.last_error) : null, req.params.id)
    if (existing && (status === 'redoable' || status === 'undoable')) {
      audit(
        actor.userId,
        actor.userName,
        status === 'redoable' ? 'action_undo' : 'action_redo',
        existing.entity || 'action_history',
        existing.entity_id || existing.id,
        {
          actionHistoryId: existing.id,
          scope: existing.scope,
          label: existing.label,
          status,
        },
      )
    }
    ok(res, {})
  } catch (error) {
    err(res, error.message || 'Failed to update action history')
  }
})

module.exports = router
