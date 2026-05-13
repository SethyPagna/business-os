'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const { pipeline } = require('stream/promises')
const { UPLOADS_PATH, PUBLIC_BASE_URL, CLOUDFLARE_PUBLIC_URL, R2_PUBLIC_BASE_URL } = require('./config')
const { deleteObject, deleteObjects, getObjectStream, isObjectStorageEnabled, listObjects, putObject } = require('./objectStore')
const { loadSharp } = require('./optionalSharp')
const { validateUploadedBuffer } = require('./uploadSecurity')
const { repairMissingUploadReferences } = require('./uploadReferenceCleanup')
const { isUploadPublicPath, normalizeUploadPublicPath } = require('./settingsSnapshot')

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
const IMAGE_TARGET_DIMENSIONS = [900, 720, 540, 420, 320, 240]
const IMAGE_TARGET_QUALITIES = [78, 58, 42, 30]
const MAX_SYNC_VIDEO_OPTIMIZATION_BYTES = 8 * 1024 * 1024
let cachedFfmpegPath = undefined
let uploadStorageReconcilePromise = null
let lastUploadStorageReconcileAt = 0
let fileAssetListingWarmPromise = null
let lastFileAssetListingWarmAt = 0
const FILE_ASSET_LISTING_WARM_TTL_MS = 15 * 60 * 1000

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
      effort: 6,
      colors: quality <= 42 ? 128 : 256,
    }).toBuffer()
  }
  if (ext === '.webp') {
    return pipeline.webp({
      quality,
      alphaQuality: Math.max(60, quality),
      effort: 4,
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
  const outputExt = String(path.extname(String(outputPath || '')).toLowerCase() || '.mp4')
  const baseArgs = [
    '-y',
    '-i', inputPath,
    '-map', '0:v:0?',
    '-map', '0:a?',
    '-map_metadata', '-1',
    '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
  ]
  if (outputExt === '.webm') {
    return [
      ...baseArgs,
      '-c:v', 'libvpx-vp9',
      '-crf', '34',
      '-b:v', '0',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-row-mt', '1',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'libopus',
      '-b:a', '80k',
      outputPath,
    ]
  }
  return [
    ...baseArgs,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '26',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath,
  ]
}

function optimizeStoredVideo(filePath, { mimeType = '', fileName = '', force = false } = {}) {
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
  if (!['.mp4', '.mov', '.webm'].includes(ext)) {
    return { ...baseResult, optimization_status: 'not_applicable', optimization_note: 'Video format is stored without recompression' }
  }
  if (!force && Number(originalSize || 0) > MAX_SYNC_VIDEO_OPTIMIZATION_BYTES) {
    return {
      ...baseResult,
      optimization_status: 'deferred',
      optimization_note: 'Stored immediately; large video optimization is skipped during upload to keep the page responsive',
    }
  }
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) return { ...baseResult, optimization_note: 'ffmpeg unavailable' }

  const tempPath = `${filePath}.optimized-${Date.now()}.mp4`
  try {
    const result = spawnSync(ffmpeg, buildVideoOptimizationArgs({
      inputPath: filePath,
      outputPath: tempPath,
    }), { encoding: 'utf8', timeout: force ? 15 * 60 * 1000 : 120000, windowsHide: true })
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

function buildFileAssetFilterParams(search = '', mediaType = 'all') {
  return {
    search: `%${String(search || '').trim().toLowerCase()}%`,
    mediaType: String(mediaType || 'all').trim().toLowerCase(),
  }
}

function listAssetRows(search = '', mediaType = 'all', { limit = 24, offset = 0 } = {}) {
  const params = {
    ...buildFileAssetFilterParams(search, mediaType),
    limit: Math.max(1, Number(limit || 24) || 24),
    offset: Math.max(0, Number(offset || 0) || 0),
  }
  return getDb().prepare(`
    SELECT *
    FROM file_assets
    WHERE public_path LIKE '/uploads/%'
    AND (
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
    LIMIT @limit OFFSET @offset
  `).all(params)
}

function countAssetRows(search = '', mediaType = 'all') {
  const params = buildFileAssetFilterParams(search, mediaType)
  const row = getDb().prepare(`
    SELECT COUNT(*) AS total
    FROM file_assets
    WHERE public_path LIKE '/uploads/%'
    AND (
      @search = '%%'
      OR lower(coalesce(original_name, '')) LIKE @search
      OR lower(coalesce(stored_name, '')) LIKE @search
      OR lower(coalesce(public_path, '')) LIKE @search
    )
    AND (
      @mediaType = 'all'
      OR media_type = @mediaType
    )
  `).get(params)
  return Number(row?.total || 0)
}

async function writeObjectBodyToFile(body, filePath) {
  if (!body) throw new Error('Object storage read returned no body')
  if (Buffer.isBuffer(body)) {
    fs.writeFileSync(filePath, body)
    return
  }
  if (typeof body.pipe === 'function') {
    await pipeline(body, fs.createWriteStream(filePath))
    return
  }
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray()
    fs.writeFileSync(filePath, Buffer.from(bytes))
    return
  }
  throw new Error('Unsupported object storage body type')
}

async function ensureStoredAssetAvailableLocally(storedName) {
  ensureUploadsDirectory()
  const absPath = path.join(UPLOADS_PATH, storedName)
  if (fs.existsSync(absPath)) return absPath
  if (!isObjectStorageEnabled()) return absPath
  const object = await getObjectStream(`uploads/${storedName}`)
  await writeObjectBodyToFile(object?.body, absPath)
  return absPath
}

function collectUploadPathsFromValue(value, referenced) {
  if (value == null) return
  if (Array.isArray(value)) {
    value.forEach((entry) => collectUploadPathsFromValue(entry, referenced))
    return
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((entry) => collectUploadPathsFromValue(entry, referenced))
    return
  }
  const raw = String(value || '').trim()
  if (!raw) return
  const normalized = normalizeUploadPublicPath(raw)
  if (isUploadPublicPath(normalized)) {
    referenced.add(normalized)
    return
  }
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      collectUploadPathsFromValue(JSON.parse(raw), referenced)
    } catch (_) {}
  }
}

function pruneInvalidReferenceBackfillAssets() {
  getDb().prepare(`
    DELETE FROM file_assets
    WHERE source = 'reference_backfill'
      AND (public_path IS NULL OR public_path NOT LIKE '/uploads/%')
  `).run()
}

function collectReferencedUploadPaths() {
  const referenced = new Set()
  const add = (value) => collectUploadPathsFromValue(value, referenced)

  getDb().prepare('SELECT value FROM settings WHERE value IS NOT NULL AND trim(value) != \'\'').all().forEach((row) => add(row.value))
  getDb().prepare('SELECT image_path FROM products WHERE image_path IS NOT NULL AND trim(image_path) != \'\'').all().forEach((row) => add(row.image_path))
  getDb().prepare('SELECT image_path FROM product_images WHERE image_path IS NOT NULL AND trim(image_path) != \'\'').all().forEach((row) => add(row.image_path))
  getDb().prepare('SELECT avatar_path FROM users WHERE avatar_path IS NOT NULL AND trim(avatar_path) != \'\'').all().forEach((row) => add(row.avatar_path))
  getDb().prepare('SELECT screenshots_json FROM customer_share_submissions WHERE screenshots_json IS NOT NULL AND trim(screenshots_json) != \'\'').all().forEach((row) => add(row.screenshots_json))

  return [...referenced]
}

function ensureReferencedAssetsRegistered() {
  const refs = collectReferencedUploadPaths()
  if (!refs.length) return
  refs.forEach((publicPath) => {
    if (getFileAssetByPublicPath(publicPath)) return
    const storedName = String(publicPath || '').replace(/^\/uploads\//, '').trim()
    if (!storedName) return
    const absPath = path.join(UPLOADS_PATH, storedName)
    const mediaType = getMediaType({ fileName: storedName, mimeType: getMimeTypeFromName(storedName) })
    const stats = fs.existsSync(absPath) ? fs.statSync(absPath) : null
    createFileAssetRecord({
      original_name: preserveOriginalDisplayName(storedName),
      stored_name: storedName,
      public_path: publicPath,
      mime_type: getMimeTypeFromName(storedName),
      media_type: mediaType,
      byte_size: stats?.size || null,
      original_byte_size: stats?.size || null,
      optimized_byte_size: stats?.size || null,
      optimization_status: isObjectStorageEnabled() ? 'stored' : 'backfilled',
      optimization_note: isObjectStorageEnabled()
        ? 'Recovered from persisted references while object storage is enabled.'
        : 'Recovered from persisted references.',
      width: null,
      height: null,
      duration_seconds: null,
      source: 'reference_backfill',
      created_by_id: null,
      created_by_name: null,
    })
  })
}

function getUploadFilePath(publicPath = '') {
  const relative = String(publicPath || '').replace(/^\/uploads\//, '')
  return path.join(UPLOADS_PATH, relative)
}

function toUploadPublicPathFromObjectKey(key = '') {
  const normalized = String(key || '').replace(/^\/+/, '').replace(/\\/g, '/')
  if (!normalized.startsWith('uploads/')) return null
  return `/${normalized}`
}

function findUploadStorageOrphans(objectKeys = [], trackedPublicPaths = []) {
  const tracked = new Set((Array.isArray(trackedPublicPaths) ? trackedPublicPaths : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))
  return (Array.isArray(objectKeys) ? objectKeys : [])
    .map((key) => ({ key: String(key || '').trim(), publicPath: toUploadPublicPathFromObjectKey(key) }))
    .filter((entry) => entry.key && entry.publicPath && !tracked.has(entry.publicPath))
    .map((entry) => entry.key)
}

function collectTrackedUploadPublicPaths() {
  const tracked = new Set()
  const add = (value) => {
    const normalized = normalizeUploadPublicPath(value)
    if (isUploadPublicPath(normalized)) tracked.add(normalized)
  }
  getDb().prepare(`
    SELECT public_path
    FROM file_assets
    WHERE public_path LIKE '/uploads/%'
  `).all().forEach((row) => add(row.public_path))
  collectReferencedUploadPaths().forEach(add)
  return [...tracked]
}

async function reconcileUploadStorage({ force = false } = {}) {
  const now = Date.now()
  if (!force && uploadStorageReconcilePromise) return uploadStorageReconcilePromise
  if (!force && lastUploadStorageReconcileAt && (now - lastUploadStorageReconcileAt) < (5 * 60 * 1000)) {
    return {
      ok: true,
      skipped: true,
      tracked: 0,
      scanned: 0,
      deleted: 0,
    }
  }

  uploadStorageReconcilePromise = (async () => {
    pruneInvalidReferenceBackfillAssets()
    repairMissingUploadReferences(getDb())
    ensureReferencedAssetsRegistered()

    const trackedPublicPaths = collectTrackedUploadPublicPaths()
    let scanned = 0
    let deleted = 0

    if (isObjectStorageEnabled()) {
      const objects = await listObjects('uploads/', { maxKeys: 1000 })
      const orphanKeys = findUploadStorageOrphans(objects.map((item) => item.key), trackedPublicPaths)
      scanned = objects.length
      if (orphanKeys.length) {
        deleted += await deleteObjects(orphanKeys)
      }
    } else {
      ensureUploadsDirectory()
      const files = fs.readdirSync(UPLOADS_PATH, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
      const tracked = new Set(trackedPublicPaths)
      scanned = files.length
      files.forEach((storedName) => {
        const publicPath = `/uploads/${storedName}`
        if (tracked.has(publicPath)) return
        try {
          fs.unlinkSync(path.join(UPLOADS_PATH, storedName))
          deleted += 1
        } catch (_) {}
      })
    }

    lastUploadStorageReconcileAt = Date.now()
    return {
      ok: true,
      skipped: false,
      tracked: trackedPublicPaths.length,
      scanned,
      deleted,
    }
  })()
    .finally(() => {
      uploadStorageReconcilePromise = null
    })

  return uploadStorageReconcilePromise
}

function requestUploadStorageReconcile(options = {}) {
  return reconcileUploadStorage(options)
}

async function ensureFileAssetListingWarm({ force = false } = {}) {
  const now = Date.now()
  if (!force && fileAssetListingWarmPromise) return fileAssetListingWarmPromise
  if (!force && lastFileAssetListingWarmAt && (now - lastFileAssetListingWarmAt) < FILE_ASSET_LISTING_WARM_TTL_MS) {
    return
  }
  fileAssetListingWarmPromise = (async () => {
    pruneInvalidReferenceBackfillAssets()
    repairMissingUploadReferences(getDb())
    ensureReferencedAssetsRegistered()
    await backfillUploadAssets()
    lastFileAssetListingWarmAt = Date.now()
  })().finally(() => {
    fileAssetListingWarmPromise = null
  })
  return fileAssetListingWarmPromise
}

async function prewarmFileAssetListing() {
  await ensureFileAssetListingWarm()
  if (isObjectStorageEnabled()) {
    await requestUploadStorageReconcile()
  }
  serializeAssetRows(listAssetRows('', 'all', { limit: 24, offset: 0 }))
  countAssetRows('', 'all')
}

async function deleteAllStoredUploads() {
  let deleted = 0
  if (isObjectStorageEnabled()) {
    const objects = await listObjects('uploads/', { maxKeys: 1000 })
    if (objects.length) {
      deleted = await deleteObjects(objects.map((item) => item.key))
    }
    return { deleted, storage: 'object' }
  }
  try {
    if (!fs.existsSync(UPLOADS_PATH)) return { deleted: 0, storage: 'local' }
    for (const fileName of fs.readdirSync(UPLOADS_PATH)) {
      try {
        fs.unlinkSync(path.join(UPLOADS_PATH, fileName))
        deleted += 1
      } catch (_) {}
    }
  } catch (_) {}
  return { deleted, storage: 'local' }
}

function buildInClausePlaceholders(values = []) {
  return values.map(() => '?').join(', ')
}

function collectUsagesByPublicPath(publicPaths = []) {
  const uniquePaths = [...new Set((Array.isArray(publicPaths) ? publicPaths : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
  const usageMap = new Map(uniquePaths.map((publicPath) => [publicPath, []]))
  if (!uniquePaths.length) return usageMap

  const addUsage = (publicPath, usage) => {
    const key = String(publicPath || '').trim()
    if (!key || !usageMap.has(key)) return
    usageMap.get(key).push(usage)
  }

  const db = getDb()
  const placeholders = buildInClausePlaceholders(uniquePaths)

  db.prepare(`
    SELECT key, value
    FROM settings
    WHERE value IS NOT NULL AND trim(value) != ''
  `).all().forEach((row) => {
    const value = String(row?.value || '')
    uniquePaths.forEach((publicPath) => {
      if (value === publicPath || value.includes(publicPath)) {
        addUsage(publicPath, { type: 'settings', label: row.key })
      }
    })
  })

  db.prepare(`
    SELECT id, name, image_path
    FROM products
    WHERE image_path IN (${placeholders})
  `).all(...uniquePaths).forEach((row) => {
    addUsage(row.image_path, { type: 'product', label: row.name || `Product #${row.id}` })
  })

  db.prepare(`
    SELECT p.id, p.name, pi.image_path
    FROM product_images pi
    LEFT JOIN products p ON p.id = pi.product_id
    WHERE pi.image_path IN (${placeholders})
  `).all(...uniquePaths).forEach((row) => {
    addUsage(row.image_path, { type: 'product_gallery', label: row.name || `Product #${row.id}` })
  })

  db.prepare(`
    SELECT id, name, username, avatar_path
    FROM users
    WHERE avatar_path IN (${placeholders})
  `).all(...uniquePaths).forEach((row) => {
    addUsage(row.avatar_path, { type: 'user_avatar', label: row.name || row.username || `User #${row.id}` })
  })

  db.prepare(`
    SELECT id, screenshots_json
    FROM customer_share_submissions
    WHERE screenshots_json IS NOT NULL AND trim(screenshots_json) != ''
  `).all().forEach((row) => {
    const screenshots = String(row?.screenshots_json || '')
    uniquePaths.forEach((publicPath) => {
      if (screenshots.includes(publicPath)) {
        addUsage(publicPath, { type: 'submission', label: `Submission #${row.id}` })
      }
    })
  })

  return usageMap
}

function collectUsage(publicPath) {
  return collectUsagesByPublicPath([publicPath]).get(String(publicPath || '').trim()) || []
}

function resolveBrowserPublicPath(publicPath = '') {
  const normalized = normalizeUploadPublicPath(publicPath)
  if (!isUploadPublicPath(normalized)) return normalized
  const base = String(R2_PUBLIC_BASE_URL || PUBLIC_BASE_URL || CLOUDFLARE_PUBLIC_URL || '').trim().replace(/\/$/, '')
  return base ? `${base}${normalized}` : normalized
}

function serializeAssetRow(row = {}, usageMap = null) {
  const usages = usageMap instanceof Map
    ? (usageMap.get(String(row.public_path || '').trim()) || [])
    : collectUsage(row.public_path)
  return {
    ...row,
    browser_public_path: resolveBrowserPublicPath(row.public_path),
    usageCount: usages.length,
    usages,
    canDelete: usages.length === 0,
  }
}

function serializeAssetRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : []
  const usageMap = collectUsagesByPublicPath(safeRows.map((row) => row?.public_path))
  return safeRows.map((row) => serializeAssetRow(row, usageMap))
}

async function registerStoredAsset({
  storedName,
  originalName,
  mimeType,
  createdById = null,
  createdByName = null,
  source = 'upload',
  optimization = null,
  deferOptimization = false,
}) {
  const publicPath = `/uploads/${storedName}`
  const absPath = path.join(UPLOADS_PATH, storedName)
  const mediaType = getMediaType({ mimeType, fileName: storedName })
  let imageOptimization = null
  if (!deferOptimization && mediaType === 'image' && !optimization && fs.existsSync(absPath) && shouldCompressImage(storedName, mimeType || getMimeTypeFromName(storedName))) {
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
  const videoOptimization = !deferOptimization && mediaType === 'video' && !optimization
    ? optimizeStoredVideo(absPath, { mimeType, fileName: storedName })
    : null
  const deferredOptimization = deferOptimization && ['image', 'video'].includes(mediaType)
    ? {
        original_byte_size: fs.existsSync(absPath) ? fs.statSync(absPath).size : null,
        optimized_byte_size: fs.existsSync(absPath) ? fs.statSync(absPath).size : null,
        optimization_status: 'queued',
        optimization_note: 'Stored immediately; optimization runs in the media worker.',
      }
    : null
  const effectiveOptimization = optimization || imageOptimization || videoOptimization || deferredOptimization
  if (mediaType === 'image' && effectiveOptimization?.over_budget && source !== 'backfill') {
    throw new Error('Images and logos must compress to 40KB or less. Please upload a smaller or clearer source image.')
  }
  const stats = fs.existsSync(absPath) ? fs.statSync(absPath) : null
  const dimensions = mediaType === 'image' ? await readImageDimensions(absPath) : { width: null, height: null }
  if (isObjectStorageEnabled() && fs.existsSync(absPath)) {
    await putObject(`uploads/${storedName}`, fs.createReadStream(absPath), {
      contentType: mimeType || getMimeTypeFromName(storedName),
      contentLength: stats?.size || undefined,
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

async function registerUploadFromRequest(file, actor = {}, options = {}) {
  if (!file?.filename) throw new Error('No uploaded file to register')
  return registerStoredAsset({
    storedName: file.filename,
    originalName: file.originalname || file.filename,
    mimeType: file.mimetype || getMimeTypeFromName(file.filename),
    createdById: actor.userId || null,
    createdByName: actor.userName || null,
    source: 'upload',
    optimization: file.optimization || null,
    deferOptimization: !!options.deferOptimization,
  })
}

async function optimizeStoredAssetFromQueue({
  storedName,
  originalName,
  mimeType,
  createdById = null,
  createdByName = null,
  source = 'upload',
} = {}) {
  if (!storedName) throw new Error('No stored asset name provided')
  const absPath = await ensureStoredAssetAvailableLocally(storedName)
  const mediaType = getMediaType({ mimeType, fileName: storedName })
  let optimization = null
  if (mediaType === 'image') {
    const originalBuffer = fs.readFileSync(absPath)
    optimization = await compressBufferForAsset(originalBuffer, { fileName: storedName, mimeType })
    if (optimization?.buffer && optimization.buffer !== originalBuffer) {
      fs.writeFileSync(absPath, optimization.buffer)
    }
  } else if (mediaType === 'video') {
    optimization = optimizeStoredVideo(absPath, { mimeType, fileName: storedName, force: true })
  }
  return registerStoredAsset({
    storedName,
    originalName: originalName || storedName,
    mimeType,
    createdById,
    createdByName,
    source,
    optimization,
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

async function listFileAssets({ search = '', mediaType = 'all', page = 1, pageSize = 24, offset = 0 } = {}) {
  setImmediate(() => {
    ensureFileAssetListingWarm().catch(() => {})
  })
  if (isObjectStorageEnabled()) {
    setImmediate(() => {
      requestUploadStorageReconcile().catch(() => {})
    })
  }
  const items = serializeAssetRows(listAssetRows(search, mediaType, { limit: pageSize, offset }))
  const total = countAssetRows(search, mediaType)
  return {
    items,
    total,
    page: Math.max(1, Number(page || 1) || 1),
    pageSize: Math.max(1, Number(pageSize || 24) || 24),
    hasMore: offset + items.length < total,
  }
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
  prewarmFileAssetListing,
  findUploadStorageOrphans,
  optimizeStoredAssetFromQueue,
  requestUploadStorageReconcile,
  registerStoredAsset,
  registerUploadFromRequest,
  deleteAllStoredUploads,
  sanitizeOriginalFileName,
  storeDataUrlAsset,
  toUploadPublicPathFromObjectKey,
  deleteFileAsset,
}
