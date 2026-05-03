'use strict'

const fs = require('fs')
const path = require('path')
const {
  trim,
  buildOrganizationFolderName,
} = require('../storage/organizationFolders')

const IS_PKG = typeof process.pkg !== 'undefined'
const RUNTIME_DIR = trim(process.env.BUSINESS_OS_RUNTIME_DIR)
  ? path.resolve(process.env.BUSINESS_OS_RUNTIME_DIR.trim())
  : IS_PKG
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, '../../..')

const SOURCE_ENV_FILE = path.join(RUNTIME_DIR, 'backend', '.env')
const RUNTIME_ENV_FILE = path.join(RUNTIME_DIR, '.env')
const ENV_CANDIDATES = [
  process.env.DOTENV_PATH || '',
  SOURCE_ENV_FILE,
  RUNTIME_ENV_FILE,
].filter(Boolean)

let ACTIVE_ENV_FILE = ''
for (const envPath of ENV_CANDIDATES) {
  if (!fs.existsSync(envPath)) continue
  require('dotenv').config({ path: envPath })
  ACTIVE_ENV_FILE = envPath
  break
}

if (!ACTIVE_ENV_FILE) {
  ACTIVE_ENV_FILE = IS_PKG ? RUNTIME_ENV_FILE : SOURCE_ENV_FILE
}

const DATA_LOCATION_FILE = path.join(RUNTIME_DIR, 'data-location.json')
const DATA_FOLDER_NAME = 'business-os-data'
const DEFAULT_STORAGE_ROOT = path.join(RUNTIME_DIR, DATA_FOLDER_NAME)
const DEFAULT_ORGANIZATION_BOOTSTRAP = {
  name: 'Leang Cosmetics',
  slug: 'leangcosmetics',
  publicId: 'org_leangcosmetics',
}

function isDefaultDataMarker(value) {
  const marker = trim(value).toLowerCase()
  return marker === '__default__' || marker === 'default'
}

function resolveStoredDataDir(rawValue) {
  const value = trim(rawValue)
  if (!value || isDefaultDataMarker(value)) return null
  if (path.isAbsolute(value)) return path.normalize(value)
  return path.resolve(RUNTIME_DIR, value)
}

function normalizeSelectedDataDir(rawValue) {
  const value = trim(rawValue)
  if (!value || isDefaultDataMarker(value)) return null
  const resolved = path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(RUNTIME_DIR, value)
  if (path.basename(resolved).toLowerCase() === DATA_FOLDER_NAME.toLowerCase()) {
    return resolved
  }
  return path.join(resolved, DATA_FOLDER_NAME)
}

function readDataLocation() {
  try {
    if (!fs.existsSync(DATA_LOCATION_FILE)) return null
    const parsed = JSON.parse(fs.readFileSync(DATA_LOCATION_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return resolveStoredDataDir(parsed.dataDir)
  } catch (_) {
    return null
  }
}

function writeDataLocation(newDir) {
  const raw = trim(newDir)
  if (!raw || isDefaultDataMarker(raw)) {
    fs.writeFileSync(DATA_LOCATION_FILE, JSON.stringify({ dataDir: '__DEFAULT__' }, null, 2), 'utf8')
    return
  }

  const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(RUNTIME_DIR, raw)
  const relative = path.relative(RUNTIME_DIR, absolute)
  const isInsideRuntime = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  const payload = isInsideRuntime
    ? { dataDir: relative.split(path.sep).join('/') }
    : { dataDir: absolute }
  fs.writeFileSync(DATA_LOCATION_FILE, JSON.stringify(payload, null, 2), 'utf8')
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true })
}

function ensureOrganizationRuntimeLayout(runtimeRoot) {
  ;['uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta', 'snapshots'].forEach((folder) => {
    ensureDirectory(path.join(runtimeRoot, folder))
  })
}

function normalizeOrganizationSeed(seed = {}) {
  const publicId = trim(seed.publicId || seed.public_id || process.env.BUSINESS_OS_ORGANIZATION_PUBLIC_ID || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId) || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId
  const name = trim(seed.name || seed.organization_name || process.env.BUSINESS_OS_ORGANIZATION_NAME || DEFAULT_ORGANIZATION_BOOTSTRAP.name) || DEFAULT_ORGANIZATION_BOOTSTRAP.name
  const slug = trim(seed.slug || seed.organization_slug || process.env.BUSINESS_OS_ORGANIZATION_SLUG || DEFAULT_ORGANIZATION_BOOTSTRAP.slug) || DEFAULT_ORGANIZATION_BOOTSTRAP.slug
  return { publicId, name, slug }
}

const STORAGE_ROOT = (() => {
  const located = readDataLocation()
  if (located) return located
  if (trim(process.env.DATA_ROOT)) return path.resolve(process.env.DATA_ROOT.trim())
  return DEFAULT_STORAGE_ROOT
})()

const PRIMARY_ORGANIZATION_SEED = normalizeOrganizationSeed()
const ORGANIZATION_PUBLIC_ID = PRIMARY_ORGANIZATION_SEED.publicId
const ORGANIZATION_DISPLAY_NAME = PRIMARY_ORGANIZATION_SEED.name || PRIMARY_ORGANIZATION_SEED.slug
const ORGANIZATION_FOLDER_NAME = buildOrganizationFolderName(ORGANIZATION_PUBLIC_ID, ORGANIZATION_DISPLAY_NAME)
const ORGANIZATIONS_ROOT = path.join(STORAGE_ROOT, 'organizations')
const DATA_ROOT = path.join(ORGANIZATIONS_ROOT, ORGANIZATION_FOLDER_NAME)

ensureOrganizationRuntimeLayout(DATA_ROOT)

const UPLOADS_PATH = trim(process.env.UPLOADS_PATH)
  ? path.resolve(process.env.UPLOADS_PATH.trim())
  : path.join(DATA_ROOT, 'uploads')

const IMPORTS_PATH = trim(process.env.IMPORTS_PATH)
  ? path.resolve(process.env.IMPORTS_PATH.trim())
  : path.join(DATA_ROOT, 'imports')

ensureDirectory(UPLOADS_PATH)
ensureDirectory(IMPORTS_PATH)

const DATABASE_DRIVER = trim(process.env.DATABASE_DRIVER || 'postgres').toLowerCase()
const OBJECT_STORAGE_DRIVER = trim(process.env.OBJECT_STORAGE_DRIVER || 'r2').toLowerCase()
const JOB_QUEUE_DRIVER = trim(process.env.JOB_QUEUE_DRIVER || 'bullmq').toLowerCase()
const ANALYTICS_ENGINE = trim(process.env.ANALYTICS_ENGINE || 'duckdb').toLowerCase()
const PARQUET_STORE = trim(process.env.PARQUET_STORE || OBJECT_STORAGE_DRIVER).toLowerCase()

if (DATABASE_DRIVER !== 'postgres') {
  throw new Error(`Unsupported database driver "${DATABASE_DRIVER}". Business OS final release requires Postgres.`)
}
const SUPPORTED_OBJECT_STORAGE_DRIVERS = new Set(['r2', 'minio'])
if (!SUPPORTED_OBJECT_STORAGE_DRIVERS.has(OBJECT_STORAGE_DRIVER)) {
  throw new Error(`Unsupported object storage driver "${OBJECT_STORAGE_DRIVER}". Business OS final release requires R2 or emergency MinIO.`)
}

const DATABASE_URL = trim(process.env.DATABASE_URL)
const DB_PATH = DATABASE_URL || 'postgres://business_os@postgres:5432/business_os'
const BUSINESS_OS_REQUIRE_SCALE_SERVICES = true
const WORKER_RUNTIME = trim(process.env.WORKER_RUNTIME || 'auto').toLowerCase()
const REDIS_URL = trim(process.env.REDIS_URL || 'redis://127.0.0.1:6379')
const CACHE_REDIS_URL = trim(process.env.CACHE_REDIS_URL || 'redis://127.0.0.1:6380')
const RUNTIME_CACHE_ENABLED = !['0', 'false', 'no', 'off', 'disabled'].includes(
  trim(process.env.RUNTIME_CACHE_ENABLED || '1').toLowerCase()
)
const S3_ENDPOINT = trim(process.env.S3_ENDPOINT || 'http://127.0.0.1:9000')
const S3_ACCESS_KEY_ID = trim(process.env.S3_ACCESS_KEY_ID || process.env.MINIO_ROOT_USER)
const S3_SECRET_ACCESS_KEY = trim(process.env.S3_SECRET_ACCESS_KEY || process.env.MINIO_ROOT_PASSWORD)
const S3_BUCKET = trim(process.env.S3_BUCKET || 'business-os-assets')
const S3_REGION = trim(process.env.S3_REGION || (OBJECT_STORAGE_DRIVER === 'r2' ? 'auto' : 'us-east-1'))
const R2_PUBLIC_BASE_URL = trim(process.env.R2_PUBLIC_BASE_URL || '')
const MINIO_LICENSE_FILE = trim(process.env.MINIO_LICENSE_FILE || path.join(RUNTIME_DIR, 'minio.license'))

const IMPORT_ROW_BATCH_SIZE = Math.min(500, Math.max(50, parseInt(process.env.IMPORT_ROW_BATCH_SIZE || '400', 10) || 400))
const IMPORT_IMAGE_CONCURRENCY = Math.min(8, Math.max(1, parseInt(process.env.IMPORT_IMAGE_CONCURRENCY || '3', 10) || 3))
const IMPORT_QUEUE_CONCURRENCY = Math.min(4, Math.max(1, parseInt(process.env.IMPORT_QUEUE_CONCURRENCY || '2', 10) || 2))
const MEDIA_QUEUE_CONCURRENCY = Math.min(4, Math.max(1, parseInt(process.env.MEDIA_QUEUE_CONCURRENCY || '3', 10) || 3))
const IMPORT_BATCH_PAUSE_MS = Math.min(1000, Math.max(0, parseInt(process.env.IMPORT_BATCH_PAUSE_MS || process.env.IMPORT_WORKER_PAUSE_MS || '0', 10) || 0))
const MEDIA_IMAGE_MAX_WIDTH = Math.min(4096, Math.max(320, parseInt(process.env.MEDIA_IMAGE_MAX_WIDTH || '1600', 10) || 1600))
const MEDIA_IMAGE_QUALITY = Math.min(92, Math.max(45, parseInt(process.env.MEDIA_IMAGE_QUALITY || '72', 10) || 72))
const UPLOAD_CHUNK_MB = Math.min(64, Math.max(1, parseInt(process.env.UPLOAD_CHUNK_MB || '12', 10) || 12))
const IMPORT_MAX_CSV_MB = Math.min(512, Math.max(1, parseInt(process.env.IMPORT_MAX_CSV_MB || '80', 10) || 80))
const IMPORT_MAX_ZIP_MB = Math.min(4096, Math.max(1, parseInt(process.env.IMPORT_MAX_ZIP_MB || '2048', 10) || 2048))

const EXTERNAL_FRONTEND_DIST = path.join(RUNTIME_DIR, 'frontend', 'dist')
const EMBEDDED_FRONTEND_DIST = path.resolve(__dirname, '../../frontend-dist')
const FRONTEND_DIST = fs.existsSync(EXTERNAL_FRONTEND_DIST)
  ? EXTERNAL_FRONTEND_DIST
  : EMBEDDED_FRONTEND_DIST

const PORT = parseInt(process.env.PORT || '4000', 10)
const SYNC_TOKEN = trim(process.env.SYNC_TOKEN)
const REMOTE_ACCESS_PROVIDER = trim(process.env.BUSINESS_OS_REMOTE_PROVIDER || 'cloudflare').toLowerCase()
const TAILSCALE_URL = trim(process.env.TAILSCALE_URL)
const CLOUDFLARE_PUBLIC_URL = trim(process.env.CLOUDFLARE_PUBLIC_URL)
const CLOUDFLARE_ADMIN_URL = trim(process.env.CLOUDFLARE_ADMIN_URL)
const PUBLIC_BASE_URL = trim(process.env.PUBLIC_BASE_URL) || CLOUDFLARE_PUBLIC_URL || (REMOTE_ACCESS_PROVIDER === 'tailscale' ? TAILSCALE_URL : '')
const GOOGLE_DRIVE_CLIENT_ID = trim(process.env.GOOGLE_DRIVE_CLIENT_ID)
const GOOGLE_DRIVE_CLIENT_SECRET = trim(process.env.GOOGLE_DRIVE_CLIENT_SECRET)
const GOOGLE_DRIVE_OAUTH_REDIRECT_URI = trim(process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI)

if (!process.env._BOS_CONFIG_LOGGED) {
  process.env._BOS_CONFIG_LOGGED = '1'
  console.log(`[config] RUNTIME_DIR  : ${RUNTIME_DIR}`)
  console.log(`[config] STORAGE_ROOT : ${STORAGE_ROOT}`)
  console.log(`[config] DATA_ROOT    : ${DATA_ROOT}`)
  console.log(`[config] DB           : Postgres`)
  console.log(`[config] UPLOADS_PATH : ${UPLOADS_PATH}`)
  console.log(`[config] IMPORTS_PATH : ${IMPORTS_PATH}`)
  console.log(`[config] FRONTEND_DIST: ${FRONTEND_DIST}`)
}

module.exports = {
  IS_PKG,
  RUNTIME_DIR,
  ACTIVE_ENV_FILE,
  STORAGE_ROOT,
  DATA_ROOT,
  DEFAULT_STORAGE_ROOT,
  DATA_FOLDER_NAME,
  DATA_LOCATION_FILE,
  DEFAULT_ORGANIZATION_BOOTSTRAP,
  ORGANIZATIONS_ROOT,
  ORGANIZATION_PUBLIC_ID,
  ORGANIZATION_DISPLAY_NAME,
  ORGANIZATION_FOLDER_NAME,
  PORT,
  SYNC_TOKEN,
  REMOTE_ACCESS_PROVIDER,
  TAILSCALE_URL,
  CLOUDFLARE_PUBLIC_URL,
  CLOUDFLARE_ADMIN_URL,
  PUBLIC_BASE_URL,
  DB_PATH,
  UPLOADS_PATH,
  IMPORTS_PATH,
  FRONTEND_DIST,
  BUSINESS_OS_REQUIRE_SCALE_SERVICES,
  JOB_QUEUE_DRIVER,
  WORKER_RUNTIME,
  REDIS_URL,
  CACHE_REDIS_URL,
  RUNTIME_CACHE_ENABLED,
  DATABASE_DRIVER,
  DATABASE_URL,
  OBJECT_STORAGE_DRIVER,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  R2_PUBLIC_BASE_URL,
  ANALYTICS_ENGINE,
  PARQUET_STORE,
  MINIO_LICENSE_FILE,
  IMPORT_ROW_BATCH_SIZE,
  IMPORT_IMAGE_CONCURRENCY,
  IMPORT_QUEUE_CONCURRENCY,
  MEDIA_QUEUE_CONCURRENCY,
  IMPORT_BATCH_PAUSE_MS,
  MEDIA_IMAGE_MAX_WIDTH,
  MEDIA_IMAGE_QUALITY,
  UPLOAD_CHUNK_MB,
  IMPORT_MAX_CSV_MB,
  IMPORT_MAX_ZIP_MB,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET,
  GOOGLE_DRIVE_OAUTH_REDIRECT_URI,
  normalizeSelectedDataDir,
  readDataLocation,
  writeDataLocation,
}
