'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
let sharp = null
try { sharp = require('sharp') } catch (_) {}
const { db } = require('./database')
const { UPLOADS_PATH } = require('./config')
const { validateUploadedBuffer } = require('./uploadSecurity')
const { repairMissingUploadReferences } = require('./uploadReferenceCleanup')

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

const MIME_TO_EXT = {
  ...IMAGE_MIME_TO_EXT,
  ...VIDEO_MIME_TO_EXT,
  ...DOCUMENT_MIME_TO_EXT,
}

const MAX_ORIGINAL_FILE_NAME_LENGTH = 180

const ASSET_EXT_TO_MIME = Object.entries(MIME_TO_EXT).reduce((map, [mime, ext]) => {
  map[ext] = mime
  return map
}, {})

function ensureUploadsDirectory() {
  fs.mkdirSync(UPLOADS_PATH, { recursive: true })
}

function getMimeTypeFromName(fileName = '') {
  const ext = String(path.extname(String(fileName || '')).toLowerCase() || '')
  return ASSET_EXT_TO_MIME[ext] || 'application/octet-stream'
}

function getMediaType({ mimeType = '', fileName = '' } = {}) {
  const lowered = String(mimeType || '').toLowerCase()
  const ext = String(path.extname(String(fileName || '')).toLowerCase() || '')
  if (lowered.startsWith('image/') || IMAGE_MIME_TO_EXT[lowered] || Object.values(IMAGE_MIME_TO_EXT).includes(ext)) return 'image'
  if (lowered.startsWith('video/') || VIDEO_MIME_TO_EXT[lowered] || Object.values(VIDEO_MIME_TO_EXT).includes(ext)) return 'video'
  if (lowered === 'application/pdf' || lowered === 'text/csv' || lowered === 'application/csv' || lowered === 'application/vnd.ms-excel' || ext === '.pdf' || ext === '.csv') return 'document'
  return 'file'
}

function sanitizeOriginalFileName(originalName = '') {
  const raw = String(originalName || '').trim()
  const ext = String(path.extname(raw || '').toLowerCase() || '')
  const fallbackExt = ext || '.bin'
  const base = path.basename(raw || `file${fallbackExt}`, ext)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, MAX_ORIGINAL_FILE_NAME_LENGTH)
  return `${base || 'file'}${fallbackExt}`
}

function preserveOriginalDisplayName(originalName = '') {
  const raw = path.basename(String(originalName || '').trim())
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, MAX_ORIGINAL_FILE_NAME_LENGTH)
    .trim()
  return raw || sanitizeOriginalFileName(originalName)
}

function buildUniqueStoredName(originalName = '') {
  ensureUploadsDirectory()
  const safeName = sanitizeOriginalFileName(originalName)
  const ext = path.extname(safeName) || '.bin'
  let candidate = `${crypto.randomUUID()}${ext}`
  while (fs.existsSync(path.join(UPLOADS_PATH, candidate))) {
    candidate = `${crypto.randomUUID()}${ext}`
  }
  return candidate
}

function shouldCompressImage(fileName = '', mimeType = '') {
  const ext = String(path.extname(String(fileName || '')).toLowerCase() || '')
  if (!String(mimeType || '').toLowerCase().startsWith('image/')) return false
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp'
}

async function compressBufferForAsset(buffer, { fileName = '', mimeType = '' } = {}) {
  if (!sharp) return buffer
  if (!shouldCompressImage(fileName, mimeType)) return buffer
  try {
    const ext = String(path.extname(String(fileName || '')).toLowerCase() || '.jpg')
    const pipeline = sharp(buffer).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    let compressed = null
    if (ext === '.png') compressed = await pipeline.png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 }).toBuffer()
    else if (ext === '.webp') compressed = await pipeline.webp({ quality: 82, alphaQuality: 100, effort: 5 }).toBuffer()
    else compressed = await pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer()
    return compressed && compressed.length < buffer.length ? compressed : buffer
  } catch (_) {
    return buffer
  }
}

async function readImageDimensions(filePath) {
  if (!sharp) return { width: null, height: null }
  try {
    const metadata = await sharp(filePath, { animated: true }).metadata()
    return {
      width: Number(metadata?.width || 0) || null,
      height: Number(metadata?.height || 0) || null,
    }
  } catch (_) {
    return { width: null, height: null }
  }
}

function createFileAssetRecord(payload = {}) {
  const statement = db.prepare(`
    INSERT INTO file_assets (
      original_name,
      stored_name,
      public_path,
      mime_type,
      media_type,
      byte_size,
      width,
      height,
      source,
      created_by_id,
      created_by_name,
      created_at,
      updated_at
    ) VALUES (
      @original_name,
      @stored_name,
      @public_path,
      @mime_type,
      @media_type,
      @byte_size,
      @width,
      @height,
      @source,
      @created_by_id,
      @created_by_name,
      datetime('now'),
      datetime('now')
    )
    ON CONFLICT(public_path) DO UPDATE SET
      original_name = excluded.original_name,
      stored_name = excluded.stored_name,
      mime_type = excluded.mime_type,
      media_type = excluded.media_type,
      byte_size = excluded.byte_size,
      width = excluded.width,
      height = excluded.height,
      source = excluded.source,
      created_by_id = COALESCE(excluded.created_by_id, file_assets.created_by_id),
      created_by_name = COALESCE(excluded.created_by_name, file_assets.created_by_name),
      updated_at = datetime('now')
  `)
  statement.run({
    original_name: payload.original_name,
    stored_name: payload.stored_name,
    public_path: payload.public_path,
    mime_type: payload.mime_type,
    media_type: payload.media_type,
    byte_size: payload.byte_size,
    width: payload.width,
    height: payload.height,
    source: payload.source || 'upload',
    created_by_id: payload.created_by_id || null,
    created_by_name: payload.created_by_name || null,
  })
  return getFileAssetByPublicPath(payload.public_path)
}

function getFileAssetByPublicPath(publicPath) {
  return db.prepare(`
    SELECT *
    FROM file_assets
    WHERE public_path = ?
    LIMIT 1
  `).get(publicPath)
}

function listAssetRows(search = '', mediaType = 'all') {
  const params = {
    search: `%${String(search || '').trim().toLowerCase()}%`,
    mediaType: String(mediaType || 'all').trim().toLowerCase(),
  }
  return db.prepare(`
    SELECT *
    FROM file_assets
    WHERE (
      @search = '%%'
      OR lower(coalesce(original_name, '')) LIKE @search
      OR lower(coalesce(stored_name, '')) LIKE @search
      OR lower(coalesce(public_path, '')) LIKE @search
    )
    AND (
      @mediaType = 'all'
      OR media_type = @mediaType
    )
    ORDER BY datetime(created_at) DESC, id DESC
  `).all(params)
}

function getUploadFilePath(publicPath = '') {
  const relative = String(publicPath || '').replace(/^\/uploads\//, '')
  return path.join(UPLOADS_PATH, relative)
}

function collectUsage(publicPath) {
  const usages = []
  const settingsRows = db.prepare(`
    SELECT key
    FROM settings
    WHERE value = ? OR value LIKE '%' || ? || '%'
  `).all(publicPath, publicPath)
  settingsRows.forEach((row) => usages.push({ type: 'settings', label: row.key }))

  const productRows = db.prepare(`SELECT id, name FROM products WHERE image_path = ?`).all(publicPath)
  productRows.forEach((row) => usages.push({ type: 'product', label: row.name || `Product #${row.id}` }))

  const galleryRows = db.prepare(`
    SELECT p.id, p.name
    FROM product_images pi
    LEFT JOIN products p ON p.id = pi.product_id
    WHERE pi.image_path = ?
  `).all(publicPath)
  galleryRows.forEach((row) => usages.push({ type: 'product_gallery', label: row.name || `Product #${row.id}` }))

  const userRows = db.prepare(`SELECT id, name, username FROM users WHERE avatar_path = ?`).all(publicPath)
  userRows.forEach((row) => usages.push({ type: 'user_avatar', label: row.name || row.username || `User #${row.id}` }))

  const submissionRows = db.prepare(`SELECT id FROM customer_share_submissions WHERE screenshots_json LIKE '%' || ? || '%'`).all(publicPath)
  submissionRows.forEach((row) => usages.push({ type: 'submission', label: `Submission #${row.id}` }))

  return usages
}

function serializeAssetRow(row = {}) {
  const usages = collectUsage(row.public_path)
  return {
    ...row,
    usageCount: usages.length,
    usages,
    canDelete: usages.length === 0,
  }
}

async function registerStoredAsset({
  storedName,
  originalName,
  mimeType,
  createdById = null,
  createdByName = null,
  source = 'upload',
}) {
  const publicPath = `/uploads/${storedName}`
  const absPath = path.join(UPLOADS_PATH, storedName)
  const stats = fs.existsSync(absPath) ? fs.statSync(absPath) : null
  const mediaType = getMediaType({ mimeType, fileName: storedName })
  const dimensions = mediaType === 'image' ? await readImageDimensions(absPath) : { width: null, height: null }
  return serializeAssetRow(createFileAssetRecord({
    original_name: preserveOriginalDisplayName(originalName || storedName),
    stored_name: storedName,
    public_path: publicPath,
    mime_type: mimeType || getMimeTypeFromName(storedName),
    media_type: mediaType,
    byte_size: stats?.size || null,
    width: dimensions.width,
    height: dimensions.height,
    source,
    created_by_id: createdById,
    created_by_name: createdByName,
  }))
}

async function registerUploadFromRequest(file, actor = {}) {
  if (!file?.filename) throw new Error('No uploaded file to register')
  return registerStoredAsset({
    storedName: file.filename,
    originalName: file.originalname || file.filename,
    mimeType: file.mimetype || getMimeTypeFromName(file.filename),
    createdById: actor.userId || null,
    createdByName: actor.userName || null,
    source: 'upload',
  })
}

async function storeDataUrlAsset({ dataUrl, fileName, createdById = null, createdByName = null, source = 'upload' }) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL')
  const mimeType = String(match[1] || '').toLowerCase()
  const base64 = String(match[2] || '')
  const buffer = Buffer.from(base64, 'base64')
  await validateUploadedBuffer(buffer, { mimetype: mimeType, originalname: fileName || `upload${MIME_TO_EXT[mimeType] || '.bin'}` })
  const normalizedOriginalName = sanitizeOriginalFileName(fileName || `upload${MIME_TO_EXT[mimeType] || '.bin'}`)
  const displayOriginalName = preserveOriginalDisplayName(fileName || normalizedOriginalName)
  const storedName = buildUniqueStoredName(normalizedOriginalName)
  const compressed = await compressBufferForAsset(buffer, { fileName: normalizedOriginalName, mimeType })
  fs.writeFileSync(path.join(UPLOADS_PATH, storedName), compressed)
  return registerStoredAsset({
    storedName,
    originalName: displayOriginalName,
    mimeType,
    createdById,
    createdByName,
    source,
  })
}

async function backfillUploadAssets() {
  ensureUploadsDirectory()
  const files = fs.readdirSync(UPLOADS_PATH, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  for (const storedName of files) {
    const publicPath = `/uploads/${storedName}`
    const exists = db.prepare('SELECT id FROM file_assets WHERE public_path = ? LIMIT 1').get(publicPath)
    if (exists) continue
    await registerStoredAsset({
      storedName,
      originalName: storedName,
      mimeType: getMimeTypeFromName(storedName),
      source: 'backfill',
    })
  }
}

async function listFileAssets({ search = '', mediaType = 'all' } = {}) {
  repairMissingUploadReferences(db)
  await backfillUploadAssets()
  return listAssetRows(search, mediaType).map(serializeAssetRow)
}

function getFileAssetById(id) {
  const row = db.prepare('SELECT * FROM file_assets WHERE id = ? LIMIT 1').get(id)
  return row ? serializeAssetRow(row) : null
}

function deleteFileAsset(id) {
  const asset = getFileAssetById(id)
  if (!asset) throw new Error('File not found')
  if (asset.usageCount > 0) {
    throw new Error('File is still in use and cannot be deleted')
  }
  const absPath = getUploadFilePath(asset.public_path)
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
  db.prepare('DELETE FROM file_assets WHERE id = ?').run(id)
  return asset
}

module.exports = {
  buildUniqueStoredName,
  getFileAssetById,
  getFileAssetByPublicPath,
  getMediaType,
  listFileAssets,
  registerStoredAsset,
  registerUploadFromRequest,
  sanitizeOriginalFileName,
  storeDataUrlAsset,
  deleteFileAsset,
}
