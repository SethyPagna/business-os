'use strict'

const express = require('express')
const { authToken, assetUpload, compressUpload, validateUploadedFile, routeRateLimit, requirePermission, getAuditActor } = require('../middleware')
const { ok, err, audit, broadcast } = require('../helpers')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const {
  deleteFileAsset,
  getFileAssetById,
  listFileAssets,
  registerUploadFromRequest,
} = require('../fileAssets')

const router = express.Router()
const ALLOWED_MEDIA_TYPES = new Set(['all', 'image', 'video', 'document', 'file'])
const MAX_FILE_SEARCH_LENGTH = 120

function parseFileAssetId(value) {
  const id = Number.parseInt(String(value || ''), 10)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid file id')
  }
  return id
}

function getFileListFilters(req) {
  const search = String(req.query?.search || '').trim()
  if (search.length > MAX_FILE_SEARCH_LENGTH) {
    throw new Error(`Search must be ${MAX_FILE_SEARCH_LENGTH} characters or fewer`)
  }
  const mediaType = String(req.query?.mediaType || 'all').trim().toLowerCase()
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error('Invalid media type filter')
  }
  return { search, mediaType }
}

function getDeviceMeta(req) {
  return {
    deviceName: String(req.body?.deviceName || req.body?.device_name || req.headers['x-device-name'] || '').trim().slice(0, 120) || null,
    deviceTz: String(req.body?.deviceTz || req.body?.device_tz || req.headers['x-device-tz'] || '').trim().slice(0, 80) || null,
    clientTime: String(req.body?.clientTime || req.body?.client_time || req.headers['x-client-time'] || '').trim().slice(0, 80) || null,
  }
}

router.get('/', authToken, requirePermission('settings'), async (req, res) => {
  try {
    const filters = getFileListFilters(req)
    const files = await listFileAssets(filters)
    ok(res, { items: files })
  } catch (error) {
    err(res, error.message || 'Failed to load files')
  }
})

router.post('/upload', authToken, requirePermission('settings'), routeRateLimit({ name: 'files:upload', max: 30, windowMs: 5 * 60 * 1000, message: 'Too many file uploads.' }), assetUpload.single('file'), validateUploadedFile, compressUpload, async (req, res) => {
  try {
    if (!req.file) return err(res, 'No file uploaded')
    const actor = getAuditActor(req)
    const deviceMeta = getDeviceMeta(req)
    const asset = await registerUploadFromRequest(req.file, actor)
    audit(actor.userId, actor.userName, 'upload', 'file_asset', asset.id, {
      original_name: asset.original_name,
      public_path: asset.public_path,
      media_type: asset.media_type,
    }, deviceMeta)
    broadcast('files')
    ok(res, asset)
  } catch (error) {
    err(res, error.message || 'File upload failed')
  }
})

router.delete('/:id', authToken, requirePermission('settings'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const assetId = parseFileAssetId(req.params.id)
    const current = getFileAssetById(assetId)
    if (!current) return err(res, 'File not found', 404)
    assertUpdatedAtMatch('file asset', current, getExpectedUpdatedAt(req.body || req.query || {}))
    const asset = deleteFileAsset(assetId)
    audit(actor.userId, actor.userName, 'delete', 'file_asset', asset.id, {
      original_name: asset.original_name,
      public_path: asset.public_path,
    })
    broadcast('files')
    ok(res, asset)
  } catch (error) {
    if (error instanceof WriteConflictError) return sendWriteConflict(res, error)
    err(res, error.message || 'Failed to delete file')
  }
})

module.exports = router
