'use strict'

const express = require('express')
const { authToken, assetUpload, compressUpload, validateUploadedFile, routeRateLimit } = require('../middleware')
const { ok, err, audit, broadcast } = require('../helpers')
const {
  deleteFileAsset,
  listFileAssets,
  registerUploadFromRequest,
} = require('../fileAssets')

const router = express.Router()

function getActor(req) {
  return {
    userId: Number(req?.user?.id || 0) || null,
    userName: String(req?.user?.name || req?.user?.username || '').trim() || null,
  }
}

function getDeviceMeta(req) {
  return {
    deviceName: String(req.body?.deviceName || req.body?.device_name || req.headers['x-device-name'] || '').trim() || null,
    deviceTz: String(req.body?.deviceTz || req.body?.device_tz || req.headers['x-device-tz'] || '').trim() || null,
    clientTime: String(req.body?.clientTime || req.body?.client_time || req.headers['x-client-time'] || '').trim() || null,
  }
}

router.get('/', authToken, async (req, res) => {
  try {
    const files = await listFileAssets({
      search: req.query?.search || '',
      mediaType: req.query?.mediaType || 'all',
    })
    ok(res, { items: files })
  } catch (error) {
    err(res, error.message || 'Failed to load files')
  }
})

router.post('/upload', authToken, routeRateLimit({ name: 'files:upload', max: 30, windowMs: 5 * 60 * 1000, message: 'Too many file uploads.' }), assetUpload.single('file'), validateUploadedFile, compressUpload, async (req, res) => {
  try {
    if (!req.file) return err(res, 'No file uploaded')
    const actor = getActor(req)
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

router.delete('/:id', authToken, (req, res) => {
  try {
    const actor = getActor(req)
    const asset = deleteFileAsset(Number(req.params.id))
    audit(actor.userId, actor.userName, 'delete', 'file_asset', asset.id, {
      original_name: asset.original_name,
      public_path: asset.public_path,
    })
    broadcast('files')
    ok(res, asset)
  } catch (error) {
    err(res, error.message || 'Failed to delete file')
  }
})

module.exports = router
