'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { UPLOADS_PATH } = require('./config')
const { deleteObject, isObjectStorageEnabled, putObject } = require('./objectStore')
const { loadSharp } = require('./optionalSharp')
const { validateUploadedBuffer } = require('./uploadSecurity')
const { repairMissingUploadReferences } = require('./uploadReferenceCleanup')

const sharp = loadSharp()

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
const MAX_IMAGE_ASSET_BYTES = 40 * 1024
const IMAGE_TARGET_DIMENSIONS = [1200, 900, 720, 540, 420, 320, 240, 180]
const IMAGE_TARGET_QUALITIES = [82, 66, 50, 38, 30]
let cachedFfmpegPath = undefined

function getDb() {
  return require('./database').db
}

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
  const safeName = sanitizeOriginalFileName(originalName)
  const ext = path.extname(safeName) || '.bin'
  const base = path.basename(safeName, ext) || 'file'
  if (isObjectStorageEnabled()) {
    return `${base}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
  }
  ensureUploadsDirectory()
  let candidate = `${base}${ext}`
  let suffix = 2
  while (fs.existsSync(path.join(UPLOADS_PATH, candidate))) {
    candidate = `${base}-${suffix}${ext}`
    suffix += 1
  }
  return candidate
}

function shouldCompressImage(fileName = '', mimeType = '') {
  const ext = String(path.extname(String(fileName || '')).toLowerCase() || '')
  if (!String(mimeType || '').toLowerCase().startsWith('image/')) return false
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp'
}

async function compressBufferForAsset(buffer, { fileName = '', mimeType = '' } = {}) {
  const isImageAsset = getMediaType({ mimeType, fileName }) === 'image'
  const baseResult = {
    buffer,
    original_byte_size: buffer?.length || null,
    optimized_byte_size: buffer?.length || null,
    optimization_status: 'not_optimized',
    optimization_note: '',
    over_budget: false,
  }
  if (isImageAsset && Number(buffer?.length || 0) <= MAX_IMAGE_ASSET_BYTES) {
    return { ...baseResult, optimization_status: 'already_within_budget' }
  }
  if (!sharp) {
    const overBudget = isImageAsset && Number(buffer?.length || 0) > MAX_IMAGE_ASSET_BYTES
    return {
      ...baseResult,
      optimization_status: overBudget ? 'over_budget' : baseResult.optimization_status,
      optimization_note: 'Sharp unavailable',
      over_budget: overBudget,
    }
  }
  if (!shouldCompressImage(fileName, mimeType)) {
    const overBudget = isImageAsset && Number(buffer?.length || 0) > MAX_IMAGE_ASSET_BYTES
    return {
      ...baseResult,
      optimization_status: isImageAsset
        ? (overBudget ? 'over_budget' : 'already_within_budget')
        : 'not_applicable',
      optimization_note: overBudget
        ? 'Image format cannot be recompressed and is above the 40KB budget'
        : '',
      over_budget: overBudget,
    }
  }
  try {
    const ext = String(path.extname(String(fileName || '')).toLowerCase() || '.jpg')
    let best = buffer
    for (const dimension of IMAGE_TARGET_DIMENSIONS) {
      for (const quality of IMAGE_TARGET_QUALITIES) {
        const candidate = await encodeImageCandidate(buffer, { ext, dimension, quality })
        if (candidate.length < best.length) best = candidate
        if (candidate.length <= MAX_IMAGE_ASSET_BYTES) {
          return {
            buffer: candidate,
            original_byte_size: buffer.length,
            optimized_byte_size: candidate.length,
            optimization_status: candidate.length < buffer.length ? 'optimized' : 'already_within_budget',
            optimization_note: '',
            over_budget: false,
          }
        }
      }
    }
    if (!best || best.length >= buffer.length) {
      return {
        ...baseResult,
        optimization_status: 'kept_original',
        optimization_note: buffer.length <= MAX_IMAGE_ASSET_BYTES
          ? 'Original image already fits the 40KB budget'
          : 'Optimized output was not smaller',
        over_budget: buffer.length > MAX_IMAGE_ASSET_BYTES,
      }
    }
    const overBudget = best.length > MAX_IMAGE_ASSET_BYTES
    return {
      buffer: best,
      original_byte_size: buffer.length,
      optimized_byte_size: best.length,
      optimization_status: overBudget ? 'optimized_over_budget' : 'optimized',
      optimization_note: overBudget
        ? `Best clear output is ${(best.length / 1024).toFixed(1)}KB; still above the 40KB budget`
        : '',
      over_budget: overBudget,
    }
  } catch (error) {
    return {
      ...baseResult,
      optimization_status: 'failed',
      optimization_note: error?.message || 'Image optimization failed',
    }
  }
}

async function encodeImageCandidate(buffer, { ext = '.jpg', dimension = 1200, quality = 72 } = {}) {
  const pipeline = sharp(buffer)
    .rotate()
    .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
  if (ext === '.png') {
    return pipeline.png({
      compressionLevel: 9,
      palette: true,
      quality: Math.max(20, quality),
      effort: 10,
      colors: quality <= 42 ? 128 : 256,
    }).toBuffer()
  }
  if (ext === '.webp') {
    return pipeline.webp({
      quality,
      alphaQuality: Math.max(60, quality),
      effort: 6,
      smartSubsample: true,
    }).toBuffer()
  }
  return pipeline.jpeg({
    quality,
    progressive: true,
    mozjpeg: true,
    chromaSubsampling: '4:2:0',
  }).toBuffer()
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

function getFfmpegPath() {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath
  const candidate = String(process.env.FFMPEG_PATH || 'ffmpeg').trim()
  const result = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  cachedFfmpegPath = result.status === 0 ? candidate : null
  return cachedFfmpegPath
}

function buildVideoOptimizationArgs({ inputPath, outputPath } = {}) {
  return [
    '-y',
    '-i', inputPath,
    '-map', '0:v:0?',
    '-map', '0:a?',
    '-map_metadata', '-1',
    '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '24',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath,
  ]
}

function optimizeStoredVideo(filePath, { mimeType = '', fileName = '' } = {}) {
  const originalSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : null
  const baseResult = {
    original_byte_size: originalSize,
    optimized_byte_size: originalSize,
    optimization_status: 'not_optimized',
    optimization_note: '',
    duration_seconds: null,
  }
  const ext = String(path.extname(String(fileName || filePath)).toLowerCase())
  if (getMediaType({ mimeType, fileName }) !== 'video') return { ...baseResult, optimization_status: 'not_applicable' }
  if (ext !== '.mp4') return { ...baseResult, optimization_status: 'not_applicable', optimization_note: 'Video format is stored without recompression' }
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) return { ...baseResult, optimization_note: 'ffmpeg unavailable' }

  const tempPath = `${filePath}.optimized-${Date.now()}.mp4`
  try {
    const result = spawnSync(ffmpeg, buildVideoOptimizationArgs({
      inputPath: filePath,
      outputPath: tempPath,
    }), { encoding: 'utf8', timeout: 120000, windowsHide: true })
    if (result.status !== 0 || !fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch (_) {}
      return {
        ...baseResult,
        optimization_status: 'failed',
        optimization_note: String(result.stderr || result.error?.message || 'ffmpeg video optimization failed').slice(0, 500),
      }
    }
    const optimizedSize = fs.statSync(tempPath).size
    if (!originalSize || optimizedSize >= originalSize) {
      try { fs.unlinkSync(tempPath) } catch (_) {}
      return {
        ...baseResult,
        optimization_status: 'kept_original',
        optimization_note: 'Optimized output was not smaller',
      }
    }
    fs.copyFileSync(tempPath, filePath)
    fs.unlinkSync(tempPath)
    return {
      original_byte_size: originalSize,
      optimized_byte_size: optimizedSize,
      optimization_status: 'optimized',
      optimization_note: '',
      duration_seconds: null,
    }
  } catch (error) {
    try { fs.unlinkSync(tempPath) } catch (_) {}
    return {
      ...baseResult,
      optimization_status: 'failed',
      optimization_note: error?.message || 'Video optimization failed',
    }
  }
}

function createFileAssetRecord(payload = {}) {
  const statement = getDb().prepare(`
    INSERT INTO file_assets (
      original_name,
      stored_name,
      public_path,
      mime_type,
      media_type,
      byte_size,
      original_byte_size,
      optimized_byte_size,
      optimization_status,
      optimization_note,
      width,
      height,
      duration_seconds,
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
      @original_byte_size,
      @optimized_byte_size,
      @optimization_status,
      @optimization_note,
      @width,
      @height,
      @duration_seconds,
      @source,
      @created_by_id,
      @created_by_name,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(public_path) DO UPDATE SET
      original_name = excluded.original_name,
      stored_name = excluded.stored_name,
      mime_type = excluded.mime_type,
      media_type = excluded.media_type,
      byte_size = excluded.byte_size,
      original_byte_size = excluded.original_byte_size,
      optimized_byte_size = excluded.optimized_byte_size,
      optimization_status = excluded.optimization_status,
      optimization_note = excluded.optimization_note,
      width = excluded.width,
      height = excluded.height,
      duration_seconds = excluded.duration_seconds,
      source = excluded.source,
      created_by_id = COALESCE(excluded.created_by_id, file_assets.created_by_id),
      created_by_name = COALESCE(excluded.created_by_name, file_assets.created_by_name),
      updated_at = CURRENT_TIMESTAMP
  `)
  statement.run({
    original_name: payload.original_name,
    stored_name: payload.stored_name,
    public_path: payload.public_path,
    mime_type: payload.mime_type,
    media_type: payload.media_type,
    byte_size: payload.byte_size,
    original_byte_size: payload.original_byte_size || payload.byte_size || null,
    optimized_byte_size: payload.optimized_byte_size || payload.byte_size || null,
    optimization_status: payload.optimization_status || 'not_optimized',
    optimization_note: payload.optimization_note || null,
    width: payload.width,
    height: payload.height,
    duration_seconds: payload.duration_seconds || null,
    source: payload.source || 'upload',
    created_by_id: payload.created_by_id || null,
    created_by_name: payload.created_by_name || null,
  })
  return getFileAssetByPublicPath(payload.public_path)
}

function getFileAssetByPublicPath(publicPath) {
  return getDb().prepare(`
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
  return getDb().prepare(`
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
    ORDER BY created_at DESC, id DESC
  `).all(params)
}

function getUploadFilePath(publicPath = '') {
  const relative = String(publicPath || '').replace(/^\/uploads\//, '')
  return path.join(UPLOADS_PATH, relative)
}

function collectUsage(publicPath) {
  const usages = []
  const settingsRows = getDb().prepare(`
    SELECT key
    FROM settings
    WHERE value = ? OR value LIKE '%' || ? || '%'
  `).all(publicPath, publicPath)
  settingsRows.forEach((row) => usages.push({ type: 'settings', label: row.key }))

  const productRows = getDb().prepare(`SELECT id, name FROM products WHERE image_path = ?`).all(publicPath)
  productRows.forEach((row) => usages.push({ type: 'product', label: row.name || `Product #${row.id}` }))

  const galleryRows = getDb().prepare(`
    SELECT p.id, p.name
    FROM product_images pi
    LEFT JOIN products p ON p.id = pi.product_id
    WHERE pi.image_path = ?
  `).all(publicPath)
  galleryRows.forEach((row) => usages.push({ type: 'product_gallery', label: row.name || `Product #${row.id}` }))

  const userRows = getDb().prepare(`SELECT id, name, username FROM users WHERE avatar_path = ?`).all(publicPath)
  userRows.forEach((row) => usages.push({ type: 'user_avatar', label: row.name || row.username || `User #${row.id}` }))

  const submissionRows = getDb().prepare(`SELECT id FROM customer_share_submissions WHERE screenshots_json LIKE '%' || ? || '%'`).all(publicPath)
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
  optimization = null,
}) {
  const publicPath = `/uploads/${storedName}`
  const absPath = path.join(UPLOADS_PATH, storedName)
  const mediaType = getMediaType({ mimeType, fileName: storedName })
  let imageOptimization = null
  if (mediaType === 'image' && !optimization && fs.existsSync(absPath) && shouldCompressImage(storedName, mimeType || getMimeTypeFromName(storedName))) {
    try {
      const originalBuffer = fs.readFileSync(absPath)
      imageOptimization = await compressBufferForAsset(originalBuffer, {
        fileName: storedName,
        mimeType: mimeType || getMimeTypeFromName(storedName),
      })
      if (imageOptimization?.buffer && imageOptimization.buffer !== originalBuffer) {
        fs.writeFileSync(absPath, imageOptimization.buffer)
      }
    } catch (error) {
      imageOptimization = {
        original_byte_size: fs.existsSync(absPath) ? fs.statSync(absPath).size : null,
        optimized_byte_size: fs.existsSync(absPath) ? fs.statSync(absPath).size : null,
        optimization_status: 'failed',
        optimization_note: error?.message || 'Image optimization failed',
      }
    }
  }
  const videoOptimization = mediaType === 'video' && !optimization
    ? optimizeStoredVideo(absPath, { mimeType, fileName: storedName })
    : null
  const effectiveOptimization = optimization || imageOptimization || videoOptimization
  if (mediaType === 'image' && effectiveOptimization?.over_budget && source !== 'backfill') {
    throw new Error('Images and logos must compress to 40KB or less. Please upload a smaller or clearer source image.')
  }
  const stats = fs.existsSync(absPath) ? fs.statSync(absPath) : null
  const dimensions = mediaType === 'image' ? await readImageDimensions(absPath) : { width: null, height: null }
  if (isObjectStorageEnabled() && fs.existsSync(absPath)) {
    await putObject(`uploads/${storedName}`, fs.createReadStream(absPath), {
      contentType: mimeType || getMimeTypeFromName(storedName),
    })
    try { fs.unlinkSync(absPath) } catch (_) {}
  }
  return serializeAssetRow(createFileAssetRecord({
    original_name: preserveOriginalDisplayName(originalName || storedName),
    stored_name: storedName,
    public_path: publicPath,
    mime_type: mimeType || getMimeTypeFromName(storedName),
    media_type: mediaType,
    byte_size: stats?.size || null,
    original_byte_size: effectiveOptimization?.original_byte_size || stats?.size || null,
    optimized_byte_size: effectiveOptimization?.optimized_byte_size || stats?.size || null,
    optimization_status: effectiveOptimization?.optimization_status || (mediaType === 'image' ? 'not_optimized' : 'not_applicable'),
    optimization_note: effectiveOptimization?.optimization_note || null,
    duration_seconds: effectiveOptimization?.duration_seconds || null,
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
    optimization: file.optimization || null,
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
  const optimized = await compressBufferForAsset(buffer, { fileName: normalizedOriginalName, mimeType })
  if (optimized?.over_budget) {
    throw new Error('Images and logos must compress to 40KB or less. Please upload a smaller or clearer source image.')
  }
  fs.writeFileSync(path.join(UPLOADS_PATH, storedName), optimized.buffer)
  return registerStoredAsset({
    storedName,
    originalName: displayOriginalName,
    mimeType,
    createdById,
    createdByName,
    source,
    optimization: optimized,
  })
}

async function backfillUploadAssets() {
  if (isObjectStorageEnabled()) return
  ensureUploadsDirectory()
  const files = fs.readdirSync(UPLOADS_PATH, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  for (const storedName of files) {
    const publicPath = `/uploads/${storedName}`
    const exists = getDb().prepare('SELECT id FROM file_assets WHERE public_path = ? LIMIT 1').get(publicPath)
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
  repairMissingUploadReferences(getDb())
  await backfillUploadAssets()
  return listAssetRows(search, mediaType).map(serializeAssetRow)
}

function getFileAssetById(id) {
  const row = getDb().prepare('SELECT * FROM file_assets WHERE id = ? LIMIT 1').get(id)
  return row ? serializeAssetRow(row) : null
}

async function deleteFileAsset(id) {
  const asset = getFileAssetById(id)
  if (!asset) throw new Error('File not found')
  if (asset.usageCount > 0) {
    throw new Error('File is still in use and cannot be deleted')
  }
  const absPath = getUploadFilePath(asset.public_path)
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
  if (isObjectStorageEnabled()) await deleteObject(String(asset.public_path || '').replace(/^\/+/, ''))
  getDb().prepare('DELETE FROM file_assets WHERE id = ?').run(id)
  return asset
}

module.exports = {
  MAX_IMAGE_ASSET_BYTES,
  buildVideoOptimizationArgs,
  buildUniqueStoredName,
  compressBufferForAsset,
  getFileAssetById,
  getFileAssetByPublicPath,
  getMimeTypeFromName,
  getMediaType,
  listFileAssets,
  registerStoredAsset,
  registerUploadFromRequest,
  sanitizeOriginalFileName,
  storeDataUrlAsset,
  deleteFileAsset,
}
