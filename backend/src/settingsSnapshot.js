'use strict'

const fs = require('fs')
const path = require('path')
const { UPLOADS_PATH } = require('./config')

function normalizeUploadPublicPath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return raw
  if (raw.startsWith('uploads/')) return `/${raw}`
  return raw
}

function isUploadPublicPath(value) {
  const normalized = normalizeUploadPublicPath(value)
  return normalized.startsWith('/uploads/')
}

function sanitizeMediaPath(value, emptyValue = '') {
  const normalized = normalizeUploadPublicPath(value)
  if (!normalized) return emptyValue
  if (!normalized.startsWith('/uploads/')) return normalized
  return uploadPublicPathExists(normalized) ? normalized : emptyValue
}

function sanitizeMediaList(values = []) {
  const items = Array.isArray(values) ? values : []
  const seen = new Set()
  const sanitized = []
  for (const value of items) {
    const nextValue = sanitizeMediaPath(value, '')
    if (!nextValue || seen.has(nextValue)) continue
    seen.add(nextValue)
    sanitized.push(nextValue)
  }
  return sanitized
}

function uploadPublicPathExists(value) {
  const normalized = normalizeUploadPublicPath(value)
  if (!normalized.startsWith('/uploads/')) return false
  const fileName = normalized.split('?')[0].split('#')[0].replace(/^\/uploads\//, '').trim()
  if (!fileName) return false
  try {
    return fs.existsSync(path.join(UPLOADS_PATH, fileName))
  } catch (_) {
    return false
  }
}

function sanitizeSettingValue(value) {
  return sanitizeMediaPath(value, '')
}

function sanitizeSettingsSnapshot(snapshot = {}) {
  const next = { ...snapshot }
  Object.keys(next).forEach((key) => {
    next[key] = sanitizeSettingValue(next[key])
  })
  return next
}

module.exports = {
  isUploadPublicPath,
  normalizeUploadPublicPath,
  sanitizeMediaList,
  sanitizeMediaPath,
  sanitizeSettingValue,
  sanitizeSettingsSnapshot,
  uploadPublicPathExists,
}
