'use strict'

/**
 * @typedef {Record<string, unknown> & { updated_at?: unknown }} ConflictRecord
 * @typedef {{ status(code: number): { json(payload: Record<string, unknown>): unknown } }} JsonResponse
 */

class WriteConflictError extends Error {
  /**
   * @param {string} entity
   * @param {ConflictRecord | null | undefined} currentRecord
   * @param {unknown} expectedUpdatedAt
   * @param {'updated' | 'deleted'} [reason]
   */
  constructor(entity, currentRecord, expectedUpdatedAt, reason = 'updated') {
    super(reason === 'deleted'
      ? `This ${entity} was removed on another device. Refresh and try again.`
      : `This ${entity} changed on another device. Refresh and try again.`)
    this.name = 'WriteConflictError'
    this.entity = entity
    this.currentRecord = currentRecord || null
    this.expectedUpdatedAt = normalizeUpdatedAt(expectedUpdatedAt)
    this.reason = reason
    this.status = 409
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeUpdatedAt(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

/**
 * @param {Record<string, unknown>} [payload]
 * @returns {string | null}
 */
function getExpectedUpdatedAt(payload = {}) {
  return normalizeUpdatedAt(
    payload.expectedUpdatedAt
    || payload.expected_updated_at
    || payload.updated_at
    || payload.updatedAt,
  )
}

/**
 * @param {string} entity
 * @param {ConflictRecord | null | undefined} currentRecord
 * @param {unknown} expectedUpdatedAt
 * @returns {void}
 */
function assertUpdatedAtMatch(entity, currentRecord, expectedUpdatedAt) {
  const expected = normalizeUpdatedAt(expectedUpdatedAt)
  if (!expected) return
  if (!currentRecord) {
    throw new WriteConflictError(entity, null, expected, 'deleted')
  }
  const actual = normalizeUpdatedAt(currentRecord.updated_at)
  if (!actual || actual !== expected) {
    throw new WriteConflictError(entity, currentRecord, expected, 'updated')
  }
}

/**
 * @param {JsonResponse} res
 * @param {WriteConflictError} error
 * @returns {unknown}
 */
function sendWriteConflict(res, error) {
  return res.status(error.status || 409).json({
    success: false,
    error: error.message,
    code: 'write_conflict',
    conflict: true,
    entity: error.entity || null,
    reason: error.reason || 'updated',
    expectedUpdatedAt: error.expectedUpdatedAt || null,
    current: error.currentRecord || null,
    actualUpdatedAt: normalizeUpdatedAt(error.currentRecord?.updated_at),
  })
}

/**
 * @param {JsonResponse} res
 * @param {WriteConflictError} error
 * @param {{ currentSettings?: Record<string, unknown>, attempted?: Record<string, unknown> }} [options]
 * @returns {unknown}
 */
function sendSettingsConflict(res, error, { currentSettings = {}, attempted = {} } = {}) {
  return res.status(error.status || 409).json({
    success: false,
    error: error.message,
    code: 'settings_conflict',
    conflict: true,
    entity: 'settings',
    reason: error.reason || 'updated',
    expectedUpdatedAt: error.expectedUpdatedAt || null,
    current: error.currentRecord || null,
    actualUpdatedAt: normalizeUpdatedAt(error.currentRecord?.updated_at),
    currentSettings: currentSettings || {},
    attempted: attempted || {},
  })
}

module.exports = {
  WriteConflictError,
  normalizeUpdatedAt,
  getExpectedUpdatedAt,
  assertUpdatedAtMatch,
  sendWriteConflict,
  sendSettingsConflict,
}
