'use strict'

const fs = require('fs')
const path = require('path')
const { UPLOADS_PATH } = require('./config')
const { isObjectStorageEnabled, objectExists } = require('./objectStore')

function normalizeUploadPublicPath(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) {
    const [cleanPath] = raw.split(/[?#]/, 1)
    return cleanPath || raw
  }
  if (raw.startsWith('uploads/')) {
    const [cleanPath] = raw.split(/[?#]/, 1)
    return cleanPath ? `/${cleanPath}` : `/${raw}`
  }
  return raw
}

function isUploadPublicPath(value) {
  const normalized = normalizeUploadPublicPath(value)
  return normalized.startsWith('/uploads/')
}

function toUploadObjectKey(value) {
  const normalized = normalizeUploadPublicPath(value)
  if (!normalized.startsWith('/uploads/')) return ''
  const fileName = normalized.split('?')[0].split('#')[0].replace(/^\/uploads\//, '').trim()
  return fileName ? `uploads/${fileName}` : ''
}

function sanitizeMediaPath(value, emptyValue = '') {
  const normalized = normalizeUploadPublicPath(value)
  if (!normalized) return emptyValue
  if (!normalized.startsWith('/uploads/')) return normalized
  if (isObjectStorageEnabled()) return normalized
  return uploadPublicPathExists(normalized) ? normalized : emptyValue
}

async function sanitizeMediaPathAsync(value, emptyValue = '', existenceCache = null) {
  const normalized = normalizeUploadPublicPath(value)
  if (!normalized) return emptyValue
  if (!normalized.startsWith('/uploads/')) return normalized
  if (!isObjectStorageEnabled()) {
    return uploadPublicPathExists(normalized) ? normalized : emptyValue
  }
  const cacheKey = normalized
  if (existenceCache instanceof Map && existenceCache.has(cacheKey)) {
    return existenceCache.get(cacheKey) ? normalized : emptyValue
  }
  const exists = await objectExists(toUploadObjectKey(normalized))
  if (existenceCache instanceof Map) existenceCache.set(cacheKey, exists)
  return exists ? normalized : emptyValue
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

async function sanitizeMediaListAsync(values = [], existenceCache = null) {
  const items = Array.isArray(values) ? values : []
  const seen = new Set()
  const sanitized = []
  for (const value of items) {
    const nextValue = await sanitizeMediaPathAsync(value, '', existenceCache)
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

async function sanitizeSettingValueAsync(value, existenceCache = null) {
  return sanitizeMediaPathAsync(value, '', existenceCache)
}

function sanitizeSettingsSnapshot(snapshot = {}) {
  const next = { ...snapshot }
  Object.keys(next).forEach((key) => {
    next[key] = sanitizeSettingValue(next[key])
  })
  return next
}

async function sanitizeSettingsSnapshotAsync(snapshot = {}) {
  const next = { ...snapshot }
  const existenceCache = new Map()
  await Promise.all(Object.keys(next).map(async (key) => {
    next[key] = await sanitizeSettingValueAsync(next[key], existenceCache)
  }))
  return next
}

module.exports = {
  isUploadPublicPath,
  normalizeUploadPublicPath,
  sanitizeMediaList,
  sanitizeMediaListAsync,
  sanitizeMediaPath,
  sanitizeMediaPathAsync,
  sanitizeSettingValue,
  sanitizeSettingValueAsync,
  sanitizeSettingsSnapshot,
  sanitizeSettingsSnapshotAsync,
  toUploadObjectKey,
  uploadPublicPathExists,
}
