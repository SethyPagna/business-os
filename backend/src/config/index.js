'use strict'

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const {
  trim,
  buildOrganizationFolderName,
  extractOrganizationPublicId,
  findOrganizationFolderByPublicId,
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

function pathExists(targetPath) {
  try { return !!targetPath && fs.existsSync(targetPath) } catch (_) { return false }
}

function normalizeOrganizationSeed(seed = {}) {
  const publicId = trim(seed.publicId || seed.public_id || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId) || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId
  const name = trim(seed.name || seed.organization_name || DEFAULT_ORGANIZATION_BOOTSTRAP.name) || DEFAULT_ORGANIZATION_BOOTSTRAP.name
  const slug = trim(seed.slug || seed.organization_slug || DEFAULT_ORGANIZATION_BOOTSTRAP.slug) || DEFAULT_ORGANIZATION_BOOTSTRAP.slug
  return { publicId, name, slug }
}

function readPrimaryOrganizationSeed(dbPath) {
  if (!pathExists(dbPath)) return null
  let sqlite = null
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    const table = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'organizations'
      LIMIT 1
    `).get()
    if (!table) return null
    const row = sqlite.prepare(`
      SELECT public_id, name, slug
      FROM organizations
      WHERE public_id IS NOT NULL AND trim(public_id) != ''
      ORDER BY id ASC
      LIMIT 1
    `).get()
    if (!row) return null
    return normalizeOrganizationSeed({
      publicId: row.public_id,
      name: row.name,
      slug: row.slug,
    })
  } catch (_) {
    return null
  } finally {
    try { sqlite?.close?.() } catch (_) {}
  }
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true })
}

function copyTree(sourcePath, targetPath) {
  if (!pathExists(sourcePath)) return
  const stats = fs.statSync(sourcePath)
  if (stats.isDirectory()) {
    ensureDirectory(targetPath)
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      copyTree(path.join(sourcePath, entry.name), path.join(targetPath, entry.name))
    }
    return
  }
  if (!stats.isFile()) return
  ensureDirectory(path.dirname(targetPath))
  fs.copyFileSync(sourcePath, targetPath)
}

function normalizePathForCompare(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase()
}

function isSamePath(a, b) {
  return normalizePathForCompare(a) === normalizePathForCompare(b)
}

function getOrganizationDbPath(runtimeRoot) {
  return path.join(runtimeRoot, 'db', 'business.db')
}

function isHealthySqliteDatabase(dbPath) {
  if (!pathExists(dbPath)) return false
  let sqlite = null
  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    return sqlite.pragma('integrity_check', { simple: true }) === 'ok'
  } catch (_) {
    return false
  } finally {
    try { sqlite?.close?.() } catch (_) {}
  }
}

function isOrganizationRuntimeRoot(root) {
  const resolved = path.resolve(String(root || ''))
  return path.basename(path.dirname(resolved)).toLowerCase() === 'organizations'
}

function ensureOrganizationRuntimeLayout(runtimeRoot) {
  ;['db', 'uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta'].forEach((folder) => {
    ensureDirectory(path.join(runtimeRoot, folder))
  })
}

function writeMigrationMarker(targetRoot, payload = {}) {
  try {
    ensureDirectory(path.join(targetRoot, 'meta'))
    fs.writeFileSync(path.join(targetRoot, 'meta', 'bootstrap-migration.json'), JSON.stringify({
      migratedAt: new Date().toISOString(),
      ...payload,
    }, null, 2), 'utf8')
  } catch (_) {}
}

function moveOrganizationRootPreservingSource(sourceRoot, targetRoot, reason) {
  ensureOrganizationRuntimeLayout(targetRoot)
  if (isSamePath(sourceRoot, targetRoot)) return targetRoot
  if (!pathExists(sourceRoot)) return targetRoot

  try {
    if (!pathExists(targetRoot)) {
      ensureDirectory(path.dirname(targetRoot))
      fs.renameSync(sourceRoot, targetRoot)
      writeMigrationMarker(targetRoot, {
        sourceRoot,
        targetRoot,
        reason,
        note: 'Organization runtime folder renamed into the canonical public_id (name) format.',
      })
      return targetRoot
    }
  } catch (_) {}

  for (const name of ['db', 'uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta']) {
    copyTree(path.join(sourceRoot, name), path.join(targetRoot, name))
  }
  writeMigrationMarker(targetRoot, {
    sourceRoot,
    targetRoot,
    reason,
    note: 'Organization runtime files were copied into the canonical public_id (name) folder. The source folder was left untouched for safety.',
  })
  return targetRoot
}

function migrateLegacySharedRootToOrganization(storageRoot, targetRoot) {
  const sourceRoot = path.resolve(storageRoot)
  const targetDbPath = path.join(targetRoot, 'db', 'business.db')
  const sourceDbPath = path.join(sourceRoot, 'db', 'business.db')

  ensureOrganizationRuntimeLayout(targetRoot)
  if (!pathExists(sourceDbPath) || pathExists(targetDbPath)) return targetRoot

  for (const name of ['db', 'uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta']) {
    copyTree(path.join(sourceRoot, name), path.join(targetRoot, name))
  }
  writeMigrationMarker(targetRoot, {
    sourceRoot,
    targetRoot,
    reason: 'legacy-shared-root',
    note: 'Legacy shared runtime data was copied into the canonical organization runtime root. The source folder was left untouched for safety.',
  })
  return targetRoot
}

function detectExistingOrganizationRuntimeRoot(storageRoot, publicId = '') {
  const organizationsRoot = path.join(storageRoot, 'organizations')
  const byPublicId = findOrganizationFolderByPublicId(organizationsRoot, publicId)
  if (byPublicId && pathExists(path.join(byPublicId, 'db', 'business.db'))) return byPublicId
  if (!pathExists(organizationsRoot)) return null
  const candidates = fs.readdirSync(organizationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(organizationsRoot, entry.name))
    .filter((candidate) => pathExists(path.join(candidate, 'db', 'business.db')))
  return candidates[0] || null
}

const STORAGE_ROOT = (() => {
  const located = readDataLocation()
  if (located) return located
  if (trim(process.env.DATA_ROOT)) return path.resolve(process.env.DATA_ROOT.trim())
  return DEFAULT_STORAGE_ROOT
})()

const LEGACY_DB_PATH = path.join(STORAGE_ROOT, 'db', 'business.db')
const PRIMARY_ORGANIZATION_SEED = (() => {
  if (isOrganizationRuntimeRoot(STORAGE_ROOT)) {
    const folderName = path.basename(path.resolve(STORAGE_ROOT))
    const publicId = folderName.split(' (')[0] || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId
    return normalizeOrganizationSeed({
      publicId,
      name: folderName.includes(' (')
        ? folderName.slice(folderName.indexOf(' (') + 2, folderName.lastIndexOf(')'))
        : DEFAULT_ORGANIZATION_BOOTSTRAP.name,
      slug: DEFAULT_ORGANIZATION_BOOTSTRAP.slug,
    })
  }
  return readPrimaryOrganizationSeed(LEGACY_DB_PATH)
    || normalizeOrganizationSeed({ publicId: extractOrganizationPublicId(path.basename(detectExistingOrganizationRuntimeRoot(STORAGE_ROOT) || '')) })
    || normalizeOrganizationSeed(DEFAULT_ORGANIZATION_BOOTSTRAP)
})()

const ORGANIZATION_PUBLIC_ID = PRIMARY_ORGANIZATION_SEED.publicId
const ORGANIZATION_DISPLAY_NAME = PRIMARY_ORGANIZATION_SEED.name || PRIMARY_ORGANIZATION_SEED.slug
const ORGANIZATION_FOLDER_NAME = buildOrganizationFolderName(ORGANIZATION_PUBLIC_ID, ORGANIZATION_DISPLAY_NAME)
const ORGANIZATIONS_ROOT = isOrganizationRuntimeRoot(STORAGE_ROOT)
  ? path.dirname(path.resolve(STORAGE_ROOT))
  : path.join(STORAGE_ROOT, 'organizations')

const DATA_ROOT = (() => {
  if (isOrganizationRuntimeRoot(STORAGE_ROOT)) {
    ensureOrganizationRuntimeLayout(STORAGE_ROOT)
    return STORAGE_ROOT
  }

  const canonicalRoot = path.join(ORGANIZATIONS_ROOT, ORGANIZATION_FOLDER_NAME)
  const legacyExactRoot = path.join(ORGANIZATIONS_ROOT, ORGANIZATION_PUBLIC_ID)
  const existingRoot = detectExistingOrganizationRuntimeRoot(STORAGE_ROOT, ORGANIZATION_PUBLIC_ID)
  const canonicalDbPath = getOrganizationDbPath(canonicalRoot)
  const legacyExactDbPath = getOrganizationDbPath(legacyExactRoot)

  if (pathExists(canonicalDbPath) && isHealthySqliteDatabase(canonicalDbPath)) {
    ensureOrganizationRuntimeLayout(canonicalRoot)
    return canonicalRoot
  }

  if (pathExists(canonicalDbPath) && !isHealthySqliteDatabase(canonicalDbPath)) {
    if (pathExists(legacyExactDbPath) && isHealthySqliteDatabase(legacyExactDbPath)) {
      ensureOrganizationRuntimeLayout(legacyExactRoot)
      writeMigrationMarker(legacyExactRoot, {
        sourceRoot: canonicalRoot,
        targetRoot: legacyExactRoot,
        reason: 'canonical-db-corrupt-fallback',
        note: 'Canonical organization DB failed integrity check, so runtime fell back to the healthy legacy organization folder.',
      })
      return legacyExactRoot
    }
  }

  if (existingRoot && !isSamePath(existingRoot, canonicalRoot)) {
    return moveOrganizationRootPreservingSource(existingRoot, canonicalRoot, 'canonical-folder-name')
  }
  if (existingRoot) {
    ensureOrganizationRuntimeLayout(existingRoot)
    return existingRoot
  }

  return migrateLegacySharedRootToOrganization(STORAGE_ROOT, canonicalRoot)
})()

const DB_PATH = trim(process.env.DB_PATH)
  ? path.resolve(process.env.DB_PATH.trim())
  : path.join(DATA_ROOT, 'db', 'business.db')

const UPLOADS_PATH = trim(process.env.UPLOADS_PATH)
  ? path.resolve(process.env.UPLOADS_PATH.trim())
  : path.join(DATA_ROOT, 'uploads')

const EXTERNAL_FRONTEND_DIST = path.join(RUNTIME_DIR, 'frontend', 'dist')
const EMBEDDED_FRONTEND_DIST = path.resolve(__dirname, '../../frontend-dist')
const FRONTEND_DIST = fs.existsSync(EXTERNAL_FRONTEND_DIST)
  ? EXTERNAL_FRONTEND_DIST
  : EMBEDDED_FRONTEND_DIST

const PORT = parseInt(process.env.PORT || '4000', 10)
const SYNC_TOKEN = trim(process.env.SYNC_TOKEN)
const TAILSCALE_URL = trim(process.env.TAILSCALE_URL)
const GOOGLE_DRIVE_CLIENT_ID = trim(process.env.GOOGLE_DRIVE_CLIENT_ID)
const GOOGLE_DRIVE_CLIENT_SECRET = trim(process.env.GOOGLE_DRIVE_CLIENT_SECRET)
const GOOGLE_DRIVE_OAUTH_REDIRECT_URI = trim(process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI)

if (!process.env._BOS_CONFIG_LOGGED) {
  process.env._BOS_CONFIG_LOGGED = '1'
  console.log(`[config] RUNTIME_DIR  : ${RUNTIME_DIR}`)
  console.log(`[config] STORAGE_ROOT : ${STORAGE_ROOT}`)
  console.log(`[config] DATA_ROOT    : ${DATA_ROOT}`)
  console.log(`[config] DB_PATH      : ${DB_PATH}`)
  console.log(`[config] UPLOADS_PATH : ${UPLOADS_PATH}`)
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
  TAILSCALE_URL,
  DB_PATH,
  UPLOADS_PATH,
  FRONTEND_DIST,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET,
  GOOGLE_DRIVE_OAUTH_REDIRECT_URI,
  normalizeSelectedDataDir,
  readDataLocation,
  writeDataLocation,
}
