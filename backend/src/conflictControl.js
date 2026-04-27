'use strict'

class WriteConflictError extends Error {
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

function normalizeUpdatedAt(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function getExpectedUpdatedAt(payload = {}) {
  return normalizeUpdatedAt(
    payload.expectedUpdatedAt
    || payload.expected_updated_at
    || payload.updated_at
    || payload.updatedAt,
  )
}

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

module.exports = {
  WriteConflictError,
  normalizeUpdatedAt,
  getExpectedUpdatedAt,
  assertUpdatedAtMatch,
  sendWriteConflict,
}
