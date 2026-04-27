'use strict'

function normalizeClientRequestId(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (normalized.length > 120) return normalized.slice(0, 120)
  return normalized
}

module.exports = {
  normalizeClientRequestId,
}
