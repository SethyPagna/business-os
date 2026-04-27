'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, broadcast, logOp } = require('../helpers')
const { authToken } = require('../middleware')
const { WriteConflictError, normalizeUpdatedAt, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

const router = express.Router()

function getSettingsSnapshot() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const obj  = {}
  rows.forEach(r => { obj[r.key] = r.value })
  return obj
}

function getSettingsUpdatedAt() {
  const row = db.prepare(`
    SELECT MAX(COALESCE(updated_at, datetime('now'))) AS updated_at
    FROM settings
  `).get()
  return normalizeUpdatedAt(row?.updated_at) || normalizeUpdatedAt(new Date().toISOString()) || null
}

// GET /api/settings
router.get('/', authToken, (req, res) => {
  res.json(getSettingsSnapshot())
})

// GET /api/settings/meta
router.get('/meta', authToken, (req, res) => {
  res.json({
    updatedAt: getSettingsUpdatedAt(),
  })
})

// POST /api/settings
router.post('/', authToken, (req, res) => {
  const t0      = Date.now()
  const updates = req.body || {}
  const expectedUpdatedAt = getExpectedUpdatedAt(updates)
  const upsert  = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  )
  try {
    db.transaction(() => {
      const currentUpdatedAt = getSettingsUpdatedAt()
      if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
        throw new WriteConflictError('settings', { updated_at: currentUpdatedAt }, expectedUpdatedAt, 'updated')
      }

      Object.entries(updates)
        .filter(([k]) => !['expectedUpdatedAt', 'expected_updated_at', 'updated_at', 'updatedAt'].includes(k))
        .forEach(([k, v]) => upsert.run(k, String(v)))
    })()
    const updatedAt = getSettingsUpdatedAt()
    logOp('settings:set', Date.now() - t0)
    broadcast('settings')
    ok(res, { updatedAt })
  } catch (error) {
    if (error instanceof WriteConflictError) {
      return sendWriteConflict(res, error)
    }
    return err(res, error?.message || 'Failed to save settings')
  }
})

module.exports = router
