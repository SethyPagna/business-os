'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Writable } = require('stream')
const { pipeline } = require('stream/promises')
const { BACKUP_TABLES, BACKUP_VERSION, buildBackupSummaryFromCounts } = require('../backupSchema')
const { DATA_ROOT, S3_BUCKET, OBJECT_STORAGE_DRIVER } = require('../config')
const { putObject, listObjects, getObjectStorageDriver, getObjectStream } = require('../objectStore')

const OBJECT_COPY_CONCURRENCY = 2
const PROGRESS_MIN_INTERVAL_MS = 350
const PROGRESS_PERCENT_STEP = 2

function getDb() {
  return require('../database').db
}

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function nowSafeId() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function createSha256() {
  return crypto.createHash('sha256')
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createSha256()
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function readTableRows(tableName, { limit = 500, offset = 0 } = {}) {
  try {
    return getDb().prepare(`SELECT * FROM ${q(tableName)} ORDER BY id ASC LIMIT ? OFFSET ?`).all(limit, offset)
  } catch (_) {
    try {
      return getDb().prepare(`SELECT * FROM ${q(tableName)} LIMIT ? OFFSET ?`).all(limit, offset)
    } catch (_) {
      return []
    }
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Job cancelled')
    error.code = 'job_cancelled'
    throw error
  }
}

function getManagedWritableState(stream) {
  if (!stream) return null
  if (stream.__businessOsManagedWritableState) return stream.__businessOsManagedWritableState
  const state = {
    error: null,
    drainWaiters: new Set(),
  }
  stream.on('error', (error) => {
    state.error = error || new Error('Writable stream failed')
    const waiters = Array.from(state.drainWaiters)
    state.drainWaiters.clear()
    waiters.forEach(({ reject }) => {
      try { reject(state.error) } catch (_) {}
    })
  })
  stream.on('drain', () => {
    const waiters = Array.from(state.drainWaiters)
    state.drainWaiters.clear()
    waiters.forEach(({ resolve }) => {
      try { resolve() } catch (_) {}
    })
  })
  Object.defineProperty(stream, '__businessOsManagedWritableState', {
    value: state,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return state
}

function writeStream(stream, hash, chunk) {
  hash?.update(chunk)
  const state = getManagedWritableState(stream)
  if (state?.error) return Promise.reject(state.error)
  if (stream.write(chunk)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (state?.error) {
      reject(state.error)
      return
    }
    state?.drainWaiters.add({ resolve, reject })
  })
}

function closeWriteStream(stream) {
  const state = getManagedWritableState(stream)
  if (state?.error) return Promise.reject(state.error)
  return new Promise((resolve, reject) => {
    const handleFinish = () => {
      cleanup()
      if (state?.error) reject(state.error)
      else resolve()
    }
    const handleError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      stream.off('finish', handleFinish)
      stream.off('error', handleError)
    }
    stream.on('finish', handleFinish)
    stream.on('error', handleError)
    stream.end()
  })
}

function createProgressReporter(progress) {
  if (typeof progress !== 'function') {
    return () => {}
  }
  let lastReport = {
    at: 0,
    phase: '',
    message: '',
    progress: -1,
    retryCount: -1,
  }
  return (patch = {}, options = {}) => {
    const now = Date.now()
    const phase = String(patch.phase || '')
    const message = String(patch.message || '')
    const progressValue = Number.isFinite(Number(patch.progress)) ? Number(patch.progress) : lastReport.progress
    const retryCount = Number(patch.retry_count || patch.metrics?.retryCount || 0) || 0
    const force = options.force === true
      || ['completed', 'failed', 'cancelled'].includes(phase)
      || progressValue >= 100
    const shouldSend = force
      || !lastReport.at
      || phase !== lastReport.phase
      || message !== lastReport.message
      || retryCount !== lastReport.retryCount
      || Math.abs(progressValue - lastReport.progress) >= PROGRESS_PERCENT_STEP
      || (now - lastReport.at) >= PROGRESS_MIN_INTERVAL_MS
    if (!shouldSend) return
    lastReport = {
      at: now,
      phase,
      message,
      progress: progressValue,
      retryCount,
    }
    progress(patch)
  }
}

function getSafeTableCount(tableName) {
  try {
    return Number(getDb().prepare(`SELECT COUNT(*) AS count FROM ${q(tableName)}`).get()?.count || 0)
  } catch (_) {
    return 0
  }
}

async function streamBackupDataFile(filePath, { progress, signal, throwIfCancelled } = {}) {
  const reportProgress = createProgressReporter(progress)
  const hash = createSha256()
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' })
  const tableCounts = {}
  const fileAssets = []
  const chunkSize = 500
  const totalTables = Math.max(1, BACKUP_TABLES.length)
  let rowsProcessed = 0
  await writeStream(stream, hash, '{"tables":{')
  for (let tableIndex = 0; tableIndex < BACKUP_TABLES.length; tableIndex += 1) {
    throwIfAborted(signal)
    throwIfCancelled?.()
    const tableName = BACKUP_TABLES[tableIndex]
    const totalRows = getSafeTableCount(tableName)
    tableCounts[tableName] = totalRows
    if (tableIndex > 0) await writeStream(stream, hash, ',')
    await writeStream(stream, hash, `${JSON.stringify(tableName)}:[`)
    let written = 0
    let offset = 0
    while (offset < totalRows || (totalRows === 0 && offset === 0)) {
      throwIfAborted(signal)
      throwIfCancelled?.()
      const rows = totalRows > 0 ? readTableRows(tableName, { limit: chunkSize, offset }) : []
      if (!rows.length) break
      for (const row of rows) {
        if (written > 0) await writeStream(stream, hash, ',')
        await writeStream(stream, hash, JSON.stringify(row))
        if (tableName === 'file_assets') fileAssets.push(row)
        written += 1
        rowsProcessed += 1
      }
      offset += rows.length
      reportProgress({
        phase: 'database',
        progress: 10 + Math.round(((tableIndex + Math.min(1, offset / Math.max(1, totalRows))) / totalTables) * 32),
        message: `Streaming ${tableName} (${Math.min(offset, totalRows)} of ${totalRows})`,
        metrics: {
          currentTable: tableName,
          rowsProcessed,
          currentTableRows: Math.min(offset, totalRows),
          currentTableTotal: totalRows,
        },
      })
      await yieldToEventLoop()
    }
    await writeStream(stream, hash, ']')
    if (totalRows === 0) await yieldToEventLoop()
  }
  await writeStream(stream, hash, '}}')
  await closeWriteStream(stream)
  return {
    checksum: hash.digest('hex'),
    tableCounts,
    fileAssets,
  }
}

function buildObjectManifest(fileAssets = []) {
  return (Array.isArray(fileAssets) ? fileAssets : [])
    .filter((asset) => asset?.public_path)
    .map((asset) => {
      const objectKey = String(asset.public_path || '').replace(/^\/+/, '')
      return {
        public_path: asset.public_path,
        object_key: objectKey,
        stored_name: asset.stored_name || '',
        original_name: asset.original_name || '',
        media_type: asset.media_type || '',
        mime_type: asset.mime_type || '',
        byte_size: asset.byte_size || null,
      }
    })
}

function buildPackageMetadata({ packageId, actor = {}, summary = {}, objectManifest = [], dataChecksum = '', objectsChecksum = '', restorePlanChecksum = '' } = {}) {
  const createdAt = new Date().toISOString()
  const restorePlan = {
    packageId,
    createdAt,
    source: {
      database: 'postgres',
      objectStorage: OBJECT_STORAGE_DRIVER,
      bucket: S3_BUCKET || null,
    },
    steps: [
      'validate_manifest',
      'create_pre_restore_snapshot',
      'restore_postgres_tables',
      'verify_object_manifest',
      'reconcile_counts',
    ],
  }
  const checksums = {
    'data.json': dataChecksum,
    'objects-manifest.jsonl': objectsChecksum,
    'restore-plan.json': restorePlanChecksum || sha256(JSON.stringify(restorePlan, null, 2)),
  }
  const manifest = {
    format: `business-os-backup-v${BACKUP_VERSION}`,
    packageId,
    created_at: createdAt,
    app: 'Business OS',
    streaming: true,
    storage: {
      driver: getObjectStorageDriver(),
      bucket: S3_BUCKET || null,
    },
    actor: {
      userId: actor.userId || null,
      userName: actor.userName || '',
    },
    summary,
    files: [
      'manifest.json',
      'data.json',
      'objects-manifest.jsonl',
      'checksums.json',
      'restore-plan.json',
    ],
  }
  const files = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'checksums.json': JSON.stringify(checksums, null, 2),
    'restore-plan.json': JSON.stringify(restorePlan, null, 2),
  }
  return { manifest, summary, files, objectManifest, restorePlan, checksums }
}

async function writeTextFileWithChecksum(filePath, contents) {
  await fs.promises.writeFile(filePath, contents, 'utf8')
  return sha256(contents)
}

async function writeJsonLinesFileWithChecksum(filePath, rows = []) {
  const hash = createSha256()
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' })
  const safeRows = Array.isArray(rows) ? rows : []
  for (let index = 0; index < safeRows.length; index += 1) {
    if (index > 0) await writeStream(stream, hash, '\n')
    await writeStream(stream, hash, JSON.stringify(safeRows[index]))
    if (index > 0 && index % 500 === 0) await yieldToEventLoop()
  }
  await closeWriteStream(stream)
  return hash.digest('hex')
}

async function uploadPackageFile({ packageId, localPath, fileName, contentType }) {
  const absolutePath = path.join(localPath, fileName)
  const stats = await fs.promises.stat(absolutePath)
  await putObject(`backups/${packageId}/${fileName}`, fs.createReadStream(absolutePath), {
    contentType,
    contentLength: stats.size,
  })
}

async function writeAndUploadMetadataFiles({ files, packageId, localPath, progress, signal, throwIfCancelled } = {}) {
  const reportProgress = createProgressReporter(progress)
  const entries = Object.entries(files || {})
  for (let index = 0; index < entries.length; index += 1) {
    throwIfAborted(signal)
    throwIfCancelled?.()
    const [fileName, contents] = entries[index]
    reportProgress({
      phase: 'writing',
      progress: 45 + Math.round(((index + 1) / Math.max(1, entries.length)) * 30),
      message: `Writing ${fileName}`,
      metrics: { currentFile: fileName, filesProcessed: index + 1, filesTotal: entries.length },
    })
    await yieldToEventLoop()
    await fs.promises.writeFile(path.join(localPath, fileName), contents, 'utf8')
    await uploadPackageFile({
      packageId,
      localPath,
      fileName,
      contentType: fileName.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    })
  }
}

async function retryOperation(operation, { retries = 3, onRetry = null } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      onRetry?.(attempt, error)
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
  throw lastError
}

function writeDestinationChunk(destination, chunk) {
  const state = getManagedWritableState(destination)
  if (state?.error) return Promise.reject(state.error)
  if (destination.write(chunk)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (state?.error) {
      reject(state.error)
      return
    }
    state?.drainWaiters.add({ resolve, reject })
  })
}

function endDestination(destination) {
  const state = getManagedWritableState(destination)
  if (state?.error) return Promise.reject(state.error)
  return new Promise((resolve, reject) => {
    const handleFinish = () => {
      cleanup()
      if (state?.error) reject(state.error)
      else resolve()
    }
    const handleError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      destination.off('finish', handleFinish)
      destination.off('error', handleError)
    }
    destination.on('finish', handleFinish)
    destination.on('error', handleError)
    destination.end()
  })
}

async function copyOnePackageObject({ item, packageId, localPath, signal, throwIfCancelled }) {
  const sourceKey = String(item.object_key || '').replace(/^\/+/, '')
  if (!sourceKey) return false
  const prefix = `backups/${packageId}/objects`
  const objectRoot = path.join(localPath, 'objects')
  const relativeKey = sourceKey.replace(/^\.\//, '').replace(/\.\./g, '_')
  const localObjectPath = path.join(objectRoot, relativeKey)
  fs.mkdirSync(path.dirname(localObjectPath), { recursive: true })
  const object = await getObjectStream(sourceKey)
  if (!object?.body) throw new Error('Object returned no data')
  throwIfCancelled?.()
  const localStream = fs.createWriteStream(localObjectPath)
  const abortCopy = () => {
    const error = new Error('Job cancelled')
    error.code = 'job_cancelled'
    try { object.body?.destroy?.(error) } catch (_) {}
    try { localStream.destroy(error) } catch (_) {}
  }
  if (signal) signal.addEventListener('abort', abortCopy, { once: true })
  try {
    await pipeline(object.body, localStream)
  } finally {
    if (signal) signal.removeEventListener('abort', abortCopy)
  }
  throwIfAborted(signal)
  throwIfCancelled?.()
  const localStats = await fs.promises.stat(localObjectPath)
  await putObject(`${prefix}/${relativeKey}`, fs.createReadStream(localObjectPath), {
    contentType: object.contentType || item.mime_type || 'application/octet-stream',
    contentLength: localStats.size,
  })
  return true
}

async function copyPackageObjects({ objectManifest = [], packageId, localPath, progress, signal, throwIfCancelled } = {}) {
  const reportProgress = createProgressReporter(progress)
  const safeObjects = Array.isArray(objectManifest) ? objectManifest : []
  if (!safeObjects.length) return { copied: 0, failed: 0, errors: [] }
  const objectRoot = path.join(localPath, 'objects')
  fs.mkdirSync(objectRoot, { recursive: true })
  const errors = []
  let copied = 0
  let cursor = 0
  async function worker() {
    while (cursor < safeObjects.length) {
      throwIfAborted(signal)
      throwIfCancelled?.()
      const index = cursor
      cursor += 1
      const item = safeObjects[index] || {}
      const sourceKey = String(item.object_key || '').replace(/^\/+/, '')
      if (!sourceKey) continue
      reportProgress({
        phase: 'objects',
        progress: 76 + Math.round(((index + 1) / safeObjects.length) * 19),
        message: `Copying object ${index + 1} of ${safeObjects.length}`,
        metrics: { currentFile: sourceKey, filesProcessed: index + 1, filesTotal: safeObjects.length },
      })
      await yieldToEventLoop()
      try {
        await retryOperation(() => copyOnePackageObject({ item, packageId, localPath, signal, throwIfCancelled }), {
          retries: 3,
          onRetry: (attempt) => reportProgress({ retry_count: attempt, metrics: { currentFile: sourceKey, retryCount: attempt } }, { force: true }),
        })
        copied += 1
      } catch (error) {
        errors.push({
          object_key: sourceKey,
          public_path: item.public_path || '',
          error: error?.message || 'Object copy failed',
        })
      }
    }
  }
  await Promise.all(Array.from({ length: OBJECT_COPY_CONCURRENCY }, () => worker()))
  if (errors.length) {
    fs.writeFileSync(
      path.join(localPath, 'objects-errors.json'),
      JSON.stringify(errors, null, 2),
      'utf8',
    )
  }
  return { copied, failed: errors.length, errors }
}

async function createFinalBackupPackage({ destinationDir = '', actor = {}, progress = null, signal = null, throwIfCancelled = null } = {}) {
  const reportProgress = createProgressReporter(progress)
  const packageId = `datasync-${nowSafeId()}`
  reportProgress({ phase: 'starting', progress: 5, message: 'Preparing final backup package' }, { force: true })
  const localPath = destinationDir
    ? path.join(path.resolve(destinationDir), packageId)
    : path.join(DATA_ROOT, 'backups', packageId)
  fs.mkdirSync(localPath, { recursive: true })
  const dataResult = await streamBackupDataFile(path.join(localPath, 'data.json'), { progress, signal, throwIfCancelled })
  await uploadPackageFile({ packageId, localPath, fileName: 'data.json', contentType: 'application/json; charset=utf-8' })
  await yieldToEventLoop()
  const objectManifest = buildObjectManifest(dataResult.fileAssets)
  const objectsChecksum = await writeJsonLinesFileWithChecksum(path.join(localPath, 'objects-manifest.jsonl'), objectManifest)
  await uploadPackageFile({ packageId, localPath, fileName: 'objects-manifest.jsonl', contentType: 'application/x-ndjson; charset=utf-8' })
  const summary = buildBackupSummaryFromCounts({
    tableCounts: dataResult.tableCounts,
    uploads: objectManifest,
    customTableRows: {},
  })
  const restorePlanPreview = {
    packageId,
    createdAt: new Date().toISOString(),
    source: {
      database: 'postgres',
      objectStorage: OBJECT_STORAGE_DRIVER,
      bucket: S3_BUCKET || null,
    },
    steps: [
      'validate_manifest',
      'create_pre_restore_snapshot',
      'restore_postgres_tables',
      'verify_object_manifest',
      'reconcile_counts',
    ],
  }
  const payload = buildPackageMetadata({
    packageId,
    actor,
    summary,
    objectManifest,
    dataChecksum: dataResult.checksum,
    objectsChecksum,
    restorePlanChecksum: sha256(JSON.stringify(restorePlanPreview, null, 2)),
  })
  payload.files['restore-plan.json'] = JSON.stringify(restorePlanPreview, null, 2)
  payload.files['checksums.json'] = JSON.stringify({
    'data.json': dataResult.checksum,
    'objects-manifest.jsonl': objectsChecksum,
    'restore-plan.json': sha256(payload.files['restore-plan.json']),
  }, null, 2)
  await writeAndUploadMetadataFiles({
    files: payload.files,
    packageId,
    localPath,
    progress,
    signal,
    throwIfCancelled,
  })
  const objectCopy = await copyPackageObjects({
    objectManifest,
    packageId,
    localPath,
    progress,
    signal,
    throwIfCancelled,
  })
  reportProgress({
    phase: 'completed',
    progress: 100,
    message: 'Backup package created',
    metrics: {
      filesProcessed: objectCopy.copied,
      filesTotal: objectManifest.length,
      failedObjects: objectCopy.failed,
    },
  }, { force: true })
  return {
    packageId,
    manifest: payload.manifest,
    summary,
    objectPrefix: `backups/${packageId}`,
    localPath,
    objectsCopied: objectCopy.copied,
    objectsFailed: objectCopy.failed,
    storageDriver: getObjectStorageDriver(),
    bucket: S3_BUCKET || null,
  }
}

async function validateLocalBackupPackage(sourceDir) {
  const root = path.resolve(String(sourceDir || ''))
  const manifestPath = path.join(root, 'manifest.json')
  const dataPath = path.join(root, 'data.json')
  const checksumsPath = path.join(root, 'checksums.json')
  const objectsPath = path.join(root, 'objects-manifest.jsonl')
  const restorePlanPath = path.join(root, 'restore-plan.json')
  for (const required of [manifestPath, dataPath, checksumsPath, objectsPath, restorePlanPath]) {
    if (!fs.existsSync(required)) throw new Error(`Backup package is missing ${path.basename(required)}.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!String(manifest.format || '').startsWith('business-os-backup-v')) {
    throw new Error('Unsupported backup format. Choose a final Business OS backup package or Google Drive datasync version.')
  }
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'))
  for (const [fileName, expected] of Object.entries(checksums || {})) {
    const filePath = path.join(root, fileName)
    if (!fs.existsSync(filePath)) throw new Error(`Backup package is missing ${fileName}.`)
    const actual = await sha256File(filePath)
    if (actual !== expected) throw new Error(`Backup checksum failed for ${fileName}.`)
  }
  return { root, manifest }
}

async function listBackupVersions({ limit = 50 } = {}) {
  const objects = await listObjects('backups/', { maxKeys: Math.max(1, Math.min(1000, Number(limit || 50) * 5)) })
  const versions = new Map()
  objects.forEach((object) => {
    const match = String(object.key || '').match(/^backups\/([^/]+)\//)
    if (!match) return
    const packageId = match[1]
    const current = versions.get(packageId) || { packageId, objectPrefix: `backups/${packageId}`, objects: 0, bytes: 0, updatedAt: object.lastModified || null }
    current.objects += 1
    current.bytes += Number(object.size || 0)
    current.updatedAt = object.lastModified || current.updatedAt
    versions.set(packageId, current)
  })
  return Array.from(versions.values())
    .sort((a, b) => String(b.packageId).localeCompare(String(a.packageId)))
    .slice(0, Math.max(1, Math.min(100, Number(limit || 50))))
}

module.exports = {
  createFinalBackupPackage,
  listBackupVersions,
  validateLocalBackupPackage,
}
