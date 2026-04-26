'use strict'

const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { UPLOADS_PATH } = require('./config')
const { authorizeProtectedRequest, isPublicApiRequest } = require('./accessControl')
const { buildUniqueStoredName, getMediaType, sanitizeOriginalFileName } = require('./fileAssets')

let sharp = null
try { sharp = require('sharp') } catch (_) {}

function authToken(req, res, next) {
  const result = authorizeProtectedRequest(req)
  if (result.allowed) return next()
  return res.status(result.status || 401).json({
    success: false,
    error: result.message || 'Unauthorized - wrong or missing access token',
    code: result.code || 'unauthorized',
  })
}

function networkAccessGuard(req, res, next) {
  if (isPublicApiRequest(req)) return next()
  return authToken(req, res, next)
}

function sanitiseFilename(originalname) {
  return sanitizeOriginalFileName(originalname)
}

const IMAGE_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

const VIDEO_MIME_TO_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

const DOCUMENT_MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/csv': '.csv',
  'application/vnd.ms-excel': '.csv',
}

const ALLOWED_IMAGE_EXT = new Set(Object.values(IMAGE_MIME_TO_EXT))
const ALLOWED_ASSET_EXT = new Set([
  ...Object.values(IMAGE_MIME_TO_EXT),
  ...Object.values(VIDEO_MIME_TO_EXT),
  ...Object.values(DOCUMENT_MIME_TO_EXT),
])

function resolveExtension(file, allowedSet = ALLOWED_ASSET_EXT, fallback = '.bin') {
  const byMime = {
    ...IMAGE_MIME_TO_EXT,
    ...VIDEO_MIME_TO_EXT,
    ...DOCUMENT_MIME_TO_EXT,
  }[String(file?.mimetype || '').toLowerCase()]
  if (byMime && allowedSet.has(byMime)) return byMime
  const ext = String(path.extname(String(file?.originalname || '')).toLowerCase() || '')
  if (allowedSet.has(ext)) return ext
  return fallback
}

function compressibleImageFormat(file = {}) {
  const ext = resolveExtension(file, ALLOWED_IMAGE_EXT, '.jpg')
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp'
}

async function compressImageFile(filePath, file = {}) {
  if (!sharp) return
  if (getMediaType({ mimeType: file?.mimetype, fileName: file?.originalname || filePath }) !== 'image') return
  if (!compressibleImageFormat(file)) return

  try {
    const originalBuffer = fs.readFileSync(filePath)
    const ext = resolveExtension(file, ALLOWED_IMAGE_EXT, '.jpg')
    const pipeline = sharp(originalBuffer).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    let buffer = null
    if (ext === '.png') {
      buffer = await pipeline.png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 }).toBuffer()
    } else if (ext === '.webp') {
      buffer = await pipeline.webp({ quality: 82, alphaQuality: 100, effort: 5 }).toBuffer()
    } else {
      buffer = await pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer()
    }
    if (!buffer || buffer.length >= originalBuffer.length) return
    fs.writeFileSync(filePath, buffer)
  } catch (_) {}
}

async function compressImageBuffer(buffer, file = {}) {
  if (!sharp) return buffer
  if (getMediaType({ mimeType: file?.mimetype, fileName: file?.originalname }) !== 'image') return buffer
  if (!compressibleImageFormat(file)) return buffer
  try {
    const ext = resolveExtension(file, ALLOWED_IMAGE_EXT, '.jpg')
    const pipeline = sharp(buffer).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    if (ext === '.png') {
      const compressed = await pipeline.png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 }).toBuffer()
      return compressed.length < buffer.length ? compressed : buffer
    }
    if (ext === '.webp') {
      const compressed = await pipeline.webp({ quality: 82, alphaQuality: 100, effort: 5 }).toBuffer()
      return compressed.length < buffer.length ? compressed : buffer
    }
    const compressed = await pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer()
    return compressed.length < buffer.length ? compressed : buffer
  } catch (_) {
    return buffer
  }
}

function createStorage() {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS_PATH, { recursive: true })
      cb(null, UPLOADS_PATH)
    },
    filename: (_req, file, cb) => {
      try {
        cb(null, buildUniqueStoredName(file?.originalname || 'upload.bin'))
      } catch (error) {
        cb(error)
      }
    },
  })
}

function buildUpload({ fileSize, allowAssets }) {
  return multer({
    storage: createStorage(),
    limits: { fileSize },
    fileFilter: (_req, file, cb) => {
      const mime = String(file?.mimetype || '').toLowerCase()
      const ext = String(path.extname(String(file?.originalname || '')).toLowerCase() || '')
      const allowedSet = allowAssets ? ALLOWED_ASSET_EXT : ALLOWED_IMAGE_EXT
      const mimeLookup = allowAssets
        ? { ...IMAGE_MIME_TO_EXT, ...VIDEO_MIME_TO_EXT, ...DOCUMENT_MIME_TO_EXT }
        : IMAGE_MIME_TO_EXT
      const hasAllowedMime = !!mimeLookup[mime]
      const hasAllowedExt = allowedSet.has(ext)
      if (hasAllowedMime || (!mime && hasAllowedExt)) return cb(null, true)
      const message = allowAssets
        ? 'Unsupported file type. Please upload an image, video, PDF, or CSV file.'
        : 'Unsupported file type. Please upload an image (jpg, png, webp, gif, bmp).'
      cb(new Error(message))
    },
  })
}

const upload = buildUpload({ fileSize: 25 * 1024 * 1024, allowAssets: false })
const assetUpload = buildUpload({ fileSize: 100 * 1024 * 1024, allowAssets: true })

async function compressUpload(req, _res, next) {
  if (req.file) await compressImageFile(req.file.path, req.file).catch(() => {})
  next()
}

module.exports = { authToken, networkAccessGuard, upload, assetUpload, compressUpload, sanitiseFilename, compressImageBuffer }
