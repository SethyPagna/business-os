'use strict'
const express = require('express')
const { db }  = require('../database.ts')
const { ok, err, broadcast, logOp, audit } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, normalizeUpdatedAt, getExpectedUpdatedAt, sendSettingsConflict } = require('../conflictControl.ts')
const { sanitizeSettingsSnapshotAsync } = require('../settingsSnapshot.ts')
const { requestUploadStorageReconcile } = require('../fileAssets')
const { hasColumn } = require('../schemaMetadata.ts')
const {
  assertCatalogTextIntegrity,
  hasSuspiciousCatalogText,
  normalizeCatalogText,
  normalizeOptionList,
} = require('../catalogTextIntegrity.ts')

const router = express.Router()
const SETTINGS_CONFLICT_CODE = 'settings_conflict'
const SETTINGS_METADATA_KEYS = new Set(['expectedUpdatedAt', 'expected_updated_at', 'updated_at', 'updatedAt'])

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
  const cleanValues = []
  for (const entry of parsed) {
    const value = normalizeCatalogText(entry)
    if (value) cleanValues.push(value)
  }
  if (hasSuspiciousCatalogValue(cleanValues)) {
    throw new Error('Brand library contains corrupted text. Fix or remove the damaged entries before saving.')
  }
  return JSON.stringify(normalizeOptionList(cleanValues))
}

function hasSuspiciousCatalogValue(values = []) {
  for (const value of values) {
    if (hasSuspiciousCatalogText(value)) return true
  }
  return false
}

function normalizeBrandColorMapValue(rawValue, normalizedBrandOptions = []) {
  if (rawValue === undefined || rawValue === null) return rawValue
  let parsed = rawValue
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue)
    } catch (_) {
      return rawValue
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawValue
  const allowedKeys = new Set()
  for (const value of normalizedBrandOptions || []) {
    allowedKeys.add(normalizeLookup(value))
  }
  const next = {}
  for (const rawKey in parsed) {
    if (!Object.prototype.hasOwnProperty.call(parsed, rawKey)) continue
    const rawColor = parsed[rawKey]
    const key = normalizeLookup(rawKey)
    if (!key || !allowedKeys.has(key)) continue
    const normalizedKey = normalizeCatalogText(rawKey)
    if (hasSuspiciousCatalogText(normalizedKey)) continue
    const color = String(rawColor || '').trim()
    if (/^#[0-9a-fA-F]{6}$/.test(color)) next[key] = color.toLowerCase()
  }
  return JSON.stringify(next)
}

function settingsHasUpdatedAt() {
  return hasColumn('settings', 'updated_at')
}

async function getSettingsSnapshot() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const obj  = {}
  for (const row of rows) obj[row.key] = row.value
  return sanitizeSettingsSnapshotAsync(obj)
}

function collectAttemptedSettings(updates = {}) {
  const attempted = {}
  const keys = []
  for (const key in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue
    if (SETTINGS_METADATA_KEYS.has(key)) continue
    attempted[key] = updates[key]
    keys.push(key)
  }
  return { attempted, keys }
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
router.get('/', authToken, async (req, res) => {
  res.json({
    ...(await getSettingsSnapshot()),
    updatedAt: getSettingsUpdatedAt(),
  })
})

// GET /api/settings/meta
router.get('/meta', authToken, (req, res) => {
  res.json({
    updatedAt: getSettingsUpdatedAt(),
  })
})

// POST /api/settings
router.post('/', authToken, requirePermission('settings'), async (req, res) => {
  const t0      = Date.now()
  const updates = req.body || {}
  const actor = getAuditActor(req, updates)
  const { attempted, keys: attemptedKeys } = collectAttemptedSettings(updates)
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

      let normalizedBrandOptions = null
      for (const key of attemptedKeys) {
        const value = attempted[key]
        if (key === 'product_brand_options') {
          normalizedBrandOptions = JSON.parse(normalizeBrandOptionsValue(value) || '[]')
        }
      }
      for (const k of attemptedKeys) {
        const v = attempted[k]
        let normalizedValue = v
        if (k === 'product_brand_options') {
          normalizedValue = JSON.stringify(normalizedBrandOptions || [])
        } else if (k === 'product_brand_color_map') {
          normalizedValue = normalizeBrandColorMapValue(v, normalizedBrandOptions || [])
        } else if (k === 'default_product_brand' || k === 'receipt_brand_name') {
          const candidate = normalizeCatalogText(v, { defaultValue: '' })
          assertCatalogTextIntegrity({ value: candidate }, ['value'], k)
          normalizedValue = candidate
        }
        upsert.run(k, String(normalizedValue))
      }
    })()
    const updatedAt = getSettingsUpdatedAt()
    logOp('settings:set', Date.now() - t0)
    broadcast('settings')
    audit(actor.userId, actor.userName, 'update', 'settings', null, {
      keys: attemptedKeys,
      count: attemptedKeys.length,
    }, {
      tableName: 'settings',
      recordId: null,
      deviceName: actor.deviceName || null,
      deviceTz: actor.deviceTz || null,
      clientTime: actor.clientTime || null,
      oldValue: { updatedAt: expectedUpdatedAt || null },
      newValue: { updatedAt },
    })
    setImmediate(() => {
      requestUploadStorageReconcile({ force: true }).catch(() => {})
    })
    ok(res, { updatedAt })
  } catch (error) {
    if (error instanceof WriteConflictError) {
      return sendSettingsConflict(res, error, {
        code: SETTINGS_CONFLICT_CODE,
        currentSettings: await getSettingsSnapshot(),
        attempted,
      })
    }
    return err(res, error?.message || 'Failed to save settings')
  }
})

module.exports = router
