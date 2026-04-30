'use strict'

const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { UPLOADS_PATH } = require('./config')
const { authorizeProtectedRequest, isPublicApiRequest } = require('./accessControl')
const { buildUniqueStoredName, getMediaType, sanitizeOriginalFileName } = require('./fileAssets')
const { getSessionUser } = require('./sessionAuth')
const { checkRateLimit } = require('./security')
const { validateUploadedPath, validateUploadedBuffer } = require('./uploadSecurity')

let sharp = null
try { sharp = require('sharp') } catch (_) {}

function authToken(req, res, next) {
  const sessionUser = getSessionUser(req)
  if (sessionUser) {
    req.user = sessionUser
    return next()
  }
  return res.status(401).json({
    success: false,
    error: 'Please sign in again to continue.',
    code: 'invalid_session',
  })
}

function networkAccessGuard(req, res, next) {
  if (isPublicApiRequest(req)) return next()
  return next()
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
  const originalSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : null
  const baseResult = {
    original_byte_size: originalSize,
    optimized_byte_size: originalSize,
    optimization_status: 'not_optimized',
    optimization_note: '',
  }
  if (!sharp) return { ...baseResult, optimization_note: 'Sharp unavailable' }
  if (getMediaType({ mimeType: file?.mimetype, fileName: file?.originalname || filePath }) !== 'image') return { ...baseResult, optimization_status: 'not_applicable' }
  if (!compressibleImageFormat(file)) return { ...baseResult, optimization_status: 'not_applicable', optimization_note: 'Image format is not recompressed' }

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
    if (!buffer || buffer.length >= originalBuffer.length) {
      return {
        ...baseResult,
        original_byte_size: originalBuffer.length,
        optimized_byte_size: originalBuffer.length,
        optimization_status: 'kept_original',
        optimization_note: 'Optimized output was not smaller',
      }
    }
    fs.writeFileSync(filePath, buffer)
    return {
      original_byte_size: originalBuffer.length,
      optimized_byte_size: buffer.length,
      optimization_status: 'optimized',
      optimization_note: '',
    }
  } catch (error) {
    return {
      ...baseResult,
      optimization_status: 'failed',
      optimization_note: error?.message || 'Image optimization failed',
    }
  }
}

async function compressImageBuffer(buffer, file = {}) {
  const originalSize = buffer?.length || 0
  const baseResult = {
    buffer,
    original_byte_size: originalSize,
    optimized_byte_size: originalSize,
    optimization_status: 'not_optimized',
    optimization_note: '',
  }
  if (!sharp) return { ...baseResult, optimization_note: 'Sharp unavailable' }
  if (getMediaType({ mimeType: file?.mimetype, fileName: file?.originalname }) !== 'image') return { ...baseResult, optimization_status: 'not_applicable' }
  if (!compressibleImageFormat(file)) return { ...baseResult, optimization_status: 'not_applicable', optimization_note: 'Image format is not recompressed' }
  try {
    const ext = resolveExtension(file, ALLOWED_IMAGE_EXT, '.jpg')
    const pipeline = sharp(buffer).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    let compressed = null
    if (ext === '.png') {
      compressed = await pipeline.png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 }).toBuffer()
    } else if (ext === '.webp') {
      compressed = await pipeline.webp({ quality: 82, alphaQuality: 100, effort: 5 }).toBuffer()
    } else {
      compressed = await pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer()
    }
    if (!compressed || compressed.length >= buffer.length) {
      return {
        ...baseResult,
        optimization_status: 'kept_original',
        optimization_note: 'Optimized output was not smaller',
      }
    }
    return {
      buffer: compressed,
      original_byte_size: buffer.length,
      optimized_byte_size: compressed.length,
      optimization_status: 'optimized',
      optimization_note: '',
    }
  } catch (error) {
    return {
      ...baseResult,
      optimization_status: 'failed',
      optimization_note: error?.message || 'Image optimization failed',
    }
  }
}

function getClientKey(req, suffix = 'upload') {
  const xForwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = xForwardedFor || req.ip || req.connection?.remoteAddress || 'unknown-ip'
  return `${ip}|${String(suffix || 'upload').trim().toLowerCase()}`
}

function routeRateLimit({ name, max, windowMs, message }) {
  return (req, res, next) => {
    const result = checkRateLimit(String(name || 'route'), getClientKey(req, name || 'route'), Math.max(1, Number(max || 20)), Math.max(1000, Number(windowMs || 60_000)))
    if (result.allowed) return next()
    res.setHeader('Retry-After', String(result.retryAfterSeconds))
    return res.status(429).json({
      success: false,
      error: `${String(message || 'Too many requests.')} Try again in ${result.retryAfterSeconds} seconds.`,
    })
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
    limits: {
      fileSize,
      files: 1,
      fields: 40,
      parts: 45,
      fieldSize: 1024 * 1024,
      fieldNameSize: 120,
    },
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

function parsePermissionsValue(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value || '{}'))
  } catch (_) {
    return {}
  }
}

function getMergedPermissions(user) {
  if (!user) return {}
  const rolePermissions = parsePermissionsValue(user.role_permissions)
  const userPermissions = parsePermissionsValue(user.permissions)
  return { ...rolePermissions, ...userPermissions }
}

function isAdminControlUser(user) {
  if (!user) return false
  const username = String(user.username || '').trim().toLowerCase()
  const roleCode = String(user.role_code || '').trim().toLowerCase()
  const permissions = getMergedPermissions(user)
  return username === 'admin' || roleCode === 'admin' || !!permissions.all
}

function hasPermission(user, key) {
  if (!key) return !!user
  if (isAdminControlUser(user)) return true
  const permissions = getMergedPermissions(user)
  return !!permissions[String(key || '').trim()]
}

function requirePermission(key) {
  return (req, res, next) => {
    if (hasPermission(req.user, key)) return next()
    return res.status(403).json({
      success: false,
      error: 'No permission',
      code: 'forbidden',
      permission: key,
    })
  }
}

function requireAnyPermission(keys = []) {
  const requiredKeys = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean)
  return (req, res, next) => {
    if (requiredKeys.some((key) => hasPermission(req.user, key))) return next()
    return res.status(403).json({
      success: false,
      error: 'No permission',
      code: 'forbidden',
      permissions: requiredKeys,
    })
  }
}

function getAuditActor(req, fallback = {}) {
  if (req?.user?.id) {
    return {
      userId: req.user.id,
      userName: req.user.name || req.user.username || null,
    }
  }
  return {
    userId: fallback.userId || null,
    userName: fallback.userName || null,
  }
}

async function compressUpload(req, _res, next) {
  if (req.file) {
    const result = await compressImageFile(req.file.path, req.file).catch((error) => ({
      original_byte_size: req.file?.size || null,
      optimized_byte_size: req.file?.size || null,
      optimization_status: 'failed',
      optimization_note: error?.message || 'Image optimization failed',
    }))
    req.file.optimization = result
    if (req.file.path && fs.existsSync(req.file.path)) req.file.size = fs.statSync(req.file.path).size
  }
  next()
}

function validateUploadedFile(req, _res, next) {
  const filePath = String(req?.file?.path || '')
  if (!filePath) return next()
  validateUploadedPath(filePath, req.file)
    .then(() => next())
    .catch((error) => {
      try { fs.unlinkSync(filePath) } catch (_) {}
      next(new Error(error?.message || 'Failed to validate uploaded file.'))
    })
}

async function validateUploadBufferPayload(buffer, file = {}) {
  await validateUploadedBuffer(buffer, file)
}

module.exports = {
  authToken,
  networkAccessGuard,
  upload,
  assetUpload,
  compressUpload,
  validateUploadedFile,
  sanitiseFilename,
  compressImageBuffer,
  routeRateLimit,
  validateUploadBufferPayload,
  getMergedPermissions,
  isAdminControlUser,
  hasPermission,
  requirePermission,
  requireAnyPermission,
  getAuditActor,
}
