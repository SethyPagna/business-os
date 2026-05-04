'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')
const { BACKUP_TABLES, BACKUP_VERSION, buildBackupSummary } = require('../backupSchema')
const { DATA_ROOT, S3_BUCKET, OBJECT_STORAGE_DRIVER } = require('../config')
const { putObject, listObjects, getObjectStorageDriver, getObjectStream } = require('../objectStore')

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

function readTableRows(tableName) {
  try {
    return getDb().prepare(`SELECT * FROM ${q(tableName)}`).all()
  } catch (_) {
    return []
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function readBackupTables(progress) {
  const tables = {}
  for (let index = 0; index < BACKUP_TABLES.length; index += 1) {
    const tableName = BACKUP_TABLES[index]
    progress?.({
      phase: 'database',
      progress: 10 + Math.round(((index + 1) / BACKUP_TABLES.length) * 30),
      message: `Reading ${tableName}`,
    })
    await yieldToEventLoop()
    tables[tableName] = readTableRows(tableName)
  }
  return tables
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

function buildPackagePayload({ packageId, actor = {}, tables = {}, objectManifest = [] } = {}) {
  const createdAt = new Date().toISOString()
  const summary = buildBackupSummary({
    tables,
    uploads: objectManifest,
    customTableRows: {},
  })
  const dataJson = JSON.stringify({ tables }, null, 2)
  const objectsJsonl = objectManifest.map((item) => JSON.stringify(item)).join('\n')
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
    'data.json': sha256(dataJson),
    'objects-manifest.jsonl': sha256(objectsJsonl),
    'restore-plan.json': sha256(JSON.stringify(restorePlan, null, 2)),
  }
  const manifest = {
    format: `business-os-backup-v${BACKUP_VERSION}`,
    packageId,
    created_at: createdAt,
    app: 'Business OS',
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
    'data.json': dataJson,
    'objects-manifest.jsonl': objectsJsonl,
    'checksums.json': JSON.stringify(checksums, null, 2),
    'restore-plan.json': JSON.stringify(restorePlan, null, 2),
  }
  return { manifest, summary, files, objectManifest }
}

async function writePackageFiles({ files, packageId, destinationDir, progress } = {}) {
  const prefix = `backups/${packageId}`
  const localPath = destinationDir
    ? path.join(path.resolve(destinationDir), packageId)
    : path.join(DATA_ROOT, 'backups', packageId)
  fs.mkdirSync(localPath, { recursive: true })
  const entries = Object.entries(files || {})
  for (let index = 0; index < entries.length; index += 1) {
    const [fileName, contents] = entries[index]
    progress?.({
      phase: 'writing',
      progress: 45 + Math.round(((index + 1) / entries.length) * 40),
      message: `Writing ${fileName}`,
    })
    await yieldToEventLoop()
    fs.writeFileSync(path.join(localPath, fileName), contents, 'utf8')
    await putObject(`${prefix}/${fileName}`, Buffer.from(contents, 'utf8'), {
      contentType: fileName.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    })
  }
  return { prefix, localPath }
}

async function copyPackageObjects({ objectManifest = [], packageId, localPath, progress } = {}) {
  const safeObjects = Array.isArray(objectManifest) ? objectManifest : []
  if (!safeObjects.length) return { copied: 0, failed: 0, errors: [] }
  const prefix = `backups/${packageId}/objects`
  const objectRoot = path.join(localPath, 'objects')
  fs.mkdirSync(objectRoot, { recursive: true })
  const errors = []
  let copied = 0
  for (let index = 0; index < safeObjects.length; index += 1) {
    const item = safeObjects[index] || {}
    const sourceKey = String(item.object_key || '').replace(/^\/+/, '')
    if (!sourceKey) continue
    progress?.({
      phase: 'objects',
      progress: 86 + Math.round(((index + 1) / safeObjects.length) * 9),
      message: `Copying object ${index + 1} of ${safeObjects.length}`,
    })
    await yieldToEventLoop()
    const relativeKey = sourceKey.replace(/^\.\//, '').replace(/\.\./g, '_')
    const localObjectPath = path.join(objectRoot, relativeKey)
    try {
      fs.mkdirSync(path.dirname(localObjectPath), { recursive: true })
      const object = await getObjectStream(sourceKey)
      if (!object?.body) throw new Error('Object returned no data')
      await pipeline(object.body, fs.createWriteStream(localObjectPath))
      await putObject(`${prefix}/${relativeKey}`, fs.createReadStream(localObjectPath), {
        contentType: object.contentType || item.mime_type || 'application/octet-stream',
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
  if (errors.length) {
    fs.writeFileSync(
      path.join(localPath, 'objects-errors.json'),
      JSON.stringify(errors, null, 2),
      'utf8',
    )
  }
  return { copied, failed: errors.length, errors }
}

async function createFinalBackupPackage({ destinationDir = '', actor = {}, progress = null } = {}) {
  const packageId = `datasync-${nowSafeId()}`
  progress?.({ phase: 'starting', progress: 5, message: 'Preparing final backup package' })
  const tables = await readBackupTables(progress)
  await yieldToEventLoop()
  const objectManifest = buildObjectManifest(tables.file_assets)
  const payload = buildPackagePayload({ packageId, actor, tables, objectManifest })
  const writeResult = await writePackageFiles({
    files: payload.files,
    packageId,
    destinationDir,
    progress,
  })
  const objectCopy = await copyPackageObjects({
    objectManifest,
    packageId,
    localPath: writeResult.localPath,
    progress,
  })
  progress?.({ phase: 'completed', progress: 100, message: 'Backup package created' })
  return {
    packageId,
    manifest: payload.manifest,
    summary: payload.summary,
    objectPrefix: writeResult.prefix,
    localPath: writeResult.localPath,
    objectsCopied: objectCopy.copied,
    objectsFailed: objectCopy.failed,
    storageDriver: getObjectStorageDriver(),
    bucket: S3_BUCKET || null,
  }
}

function validateLocalBackupPackage(sourceDir) {
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
    const actual = sha256(fs.readFileSync(filePath))
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
