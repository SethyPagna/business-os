'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, broadcast, logOp } = require('../helpers')
const { authToken, requirePermission } = require('../middleware')
const { WriteConflictError, normalizeUpdatedAt, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const { sanitizeSettingsSnapshot } = require('../settingsSnapshot')

const router = express.Router()

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeBrandOptionsValue(rawValue) {
  if (rawValue === undefined || rawValue === null) return rawValue
  let parsed = rawValue
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue)
    } catch (_) {
      return rawValue
    }
  }
  if (!Array.isArray(parsed)) return rawValue
  const normalized = new Map()
  parsed
    .map((entry) => String(entry || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .forEach((entry) => {
      const key = normalizeLookup(entry)
      if (!normalized.has(key)) normalized.set(key, entry)
    })
  return JSON.stringify(
    Array.from(normalized.values()).sort((left, right) => left.localeCompare(right)),
  )
}

function settingsHasUpdatedAt() {
  try {
    return db.prepare(`
      SELECT 1 AS exists
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `).get('settings', 'updated_at')?.exists === 1
  } catch (_) {
    return false
  }
}

function getSettingsSnapshot() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const obj  = {}
  rows.forEach(r => { obj[r.key] = r.value })
  return sanitizeSettingsSnapshot(obj)
}

function getSettingsUpdatedAt() {
  if (!settingsHasUpdatedAt()) {
    return normalizeUpdatedAt(new Date().toISOString()) || null
  }
  const row = db.prepare(`
    SELECT MAX(COALESCE(updated_at::text, CURRENT_TIMESTAMP::text)) AS updated_at
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
router.post('/', authToken, requirePermission('settings'), (req, res) => {
  const t0      = Date.now()
  const updates = req.body || {}
  const expectedUpdatedAt = getExpectedUpdatedAt(updates)
  const hasUpdatedAt = settingsHasUpdatedAt()
  const upsert  = hasUpdatedAt
    ? db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    : db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
  try {
    db.transaction(() => {
      const currentUpdatedAt = getSettingsUpdatedAt()
      if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
        throw new WriteConflictError('settings', { updated_at: currentUpdatedAt }, expectedUpdatedAt, 'updated')
      }

      Object.entries(updates)
        .filter(([k]) => !['expectedUpdatedAt', 'expected_updated_at', 'updated_at', 'updatedAt'].includes(k))
        .forEach(([k, v]) => {
          const normalizedValue = k === 'product_brand_options'
            ? normalizeBrandOptionsValue(v)
            : v
          upsert.run(k, String(normalizedValue))
        })
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
