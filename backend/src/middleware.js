'use strict'

const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { UPLOADS_PATH } = require('./config')
const { authorizeProtectedRequest, isPublicApiRequest } = require('./accessControl')
const { buildUniqueStoredName, getMediaType, sanitizeOriginalFileName } = require('./fileAssets')
const { getSessionUser } = require('./sessionAuth')

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

function bufferStartsWith(buffer, bytes = []) {
  return bytes.every((value, index) => buffer[index] === value)
}

function isLikelyCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false
  let invalidControls = 0
  let separators = 0
  for (const byte of buffer) {
    if (byte === 0) return false
    if (byte === 44 || byte === 59 || byte === 9) separators += 1
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13
    if (byte < 32 && !isAllowedControl) invalidControls += 1
  }
  return invalidControls === 0 && separators > 0
}

function detectStoredFileKind(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 8192)
  if (!header.length) return 'unknown'
  if (bufferStartsWith(header, [0xFF, 0xD8, 0xFF])) return 'image'
  if (bufferStartsWith(header, [0x89, 0x50, 0x4E, 0x47])) return 'image'
  if (bufferStartsWith(header, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (bufferStartsWith(header, [0x42, 0x4D])) return 'image'
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'image'
  if (header.subarray(0, 5).toString('ascii') === '%PDF-') return 'document'
  if (header.subarray(0, 4).toString('hex').toLowerCase() === '1a45dfa3') return 'video'
  if (header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') return 'video'
  if (isLikelyCsvBuffer(header)) return 'document'
  return 'unknown'
}

function getExpectedUploadedKind(file = {}) {
  const mediaType = getMediaType({ mimeType: file?.mimetype, fileName: file?.originalname || file?.filename || '' })
  if (mediaType === 'image') return 'image'
  if (mediaType === 'video') return 'video'
  if (mediaType === 'document') return 'document'
  return 'unknown'
}

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

function validateUploadedFile(req, _res, next) {
  const filePath = String(req?.file?.path || '')
  if (!filePath) return next()
  try {
    const expectedKind = getExpectedUploadedKind(req.file)
    const actualKind = detectStoredFileKind(filePath)
    if (expectedKind !== 'unknown' && actualKind !== expectedKind) {
      try { fs.unlinkSync(filePath) } catch (_) {}
      return next(new Error('Uploaded file contents do not match the selected file type. Please choose a valid image, video, PDF, or CSV file.'))
    }
  } catch (error) {
    try { fs.unlinkSync(filePath) } catch (_) {}
    return next(new Error(error?.message || 'Failed to validate uploaded file.'))
  }
  return next()
}

module.exports = { authToken, networkAccessGuard, upload, assetUpload, compressUpload, validateUploadedFile, sanitiseFilename, compressImageBuffer }
